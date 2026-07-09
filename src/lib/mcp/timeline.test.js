import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.GITHUB_API_TOKEN = 'test-token';

const { octokit } = await import('../rest-api.js');
const {
  handleGetIssueTimeline,
  getIssueTimelineTool,
  timelineTools,
  timelineToolHandlers
} = await import('./timeline.js');

function parseResult(result) {
  return JSON.parse(result.content[0].text);
}

/**
 * getItemByID (used to resolve a PVTI item to its owner/repo/number) goes
 * through the GraphQL client, which is not mockable via t.mock.method since
 * it's a fresh @octokit/graphql instance per call (no shared exported
 * object). Mock at the fetch layer instead -- @octokit/request calls
 * globalThis.fetch directly.
 */
function fetchResponseFor(body) {
  const text = JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    url: 'https://api.github.com/graphql',
    headers: new Map([['content-type', 'application/json']]),
    text: async () => text,
    json: async () => body
  };
}

function mockItemFetch(t, { number, nameWithOwner, isPrivate = false }) {
  t.mock.method(globalThis, 'fetch', async () => fetchResponseFor({
    data: {
      node: {
        fieldValues: { nodes: [] },
        content: {
          number,
          title: 'Some issue',
          url: `https://github.com/${nameWithOwner}/issues/${number}`,
          repository: { nameWithOwner, isPrivate, url: `https://github.com/${nameWithOwner}` },
          author: { login: 'someone' },
          body: '',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          closedAt: null,
          assignees: { nodes: [] },
          comments: { nodes: [] },
          labels: { nodes: [] },
          projectsV2: { nodes: [] }
        }
      }
    }
  }));
}

function mockItemFetchNotFound(t) {
  t.mock.method(globalThis, 'fetch', async () => fetchResponseFor({ data: { node: null } }));
}

/**
 * A resolvable node whose content is null (e.g. a draft issue) -- getItemByID
 * returns successfully with default/empty repository & number, without throwing.
 */
function mockItemFetchUnresolvableContent(t) {
  t.mock.method(globalThis, 'fetch', async () => fetchResponseFor({
    data: { node: { fieldValues: { nodes: [] }, content: null } }
  }));
}

// ---------------------------------------------------------------------------
// Export structure
// ---------------------------------------------------------------------------

describe('timeline exports', () => {
  it('exports 1 tool descriptor', () => {
    assert.strictEqual(timelineTools.length, 1);
    assert.deepStrictEqual(timelineTools.map(t => t.name), ['get_issue_timeline']);
  });

  it('has a handler for the tool', () => {
    for (const tool of timelineTools) {
      assert.strictEqual(typeof timelineToolHandlers[tool.name], 'function');
    }
  });

  it('has a valid inputSchema requiring itemId', () => {
    assert.strictEqual(getIssueTimelineTool.inputSchema.type, 'object');
    assert.ok(getIssueTimelineTool.inputSchema.properties.itemId);
    assert.deepStrictEqual(getIssueTimelineTool.inputSchema.required, ['itemId']);
  });
});

// ---------------------------------------------------------------------------
// handleGetIssueTimeline
// ---------------------------------------------------------------------------

describe('handleGetIssueTimeline', () => {
  it('resolves the item to owner/repo/number and returns compact events', async (t) => {
    mockItemFetch(t, { number: 42, nameWithOwner: 'giantswarm/roadmap' });
    t.mock.method(octokit, 'request', async () => ({
      data: [
        { event: 'labeled', actor: { login: 'octocat' }, created_at: '2026-01-01T00:00:00Z', label: { name: 'bug' } }
      ]
    }));

    const result = await handleGetIssueTimeline({ itemId: 'PVTI_xxx' });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.count, 1);
    assert.strictEqual(parsed.truncated, false);
    assert.strictEqual(parsed.events[0].type, 'labeled');
    assert.strictEqual(parsed.events[0].detail.label, 'bug');

    const [route, params] = octokit.request.mock.calls[0].arguments;
    assert.match(route, /timeline/);
    assert.strictEqual(params.owner, 'giantswarm');
    assert.strictEqual(params.repo, 'roadmap');
    assert.strictEqual(params.issue_number, 42);
  });

  it('forwards since/until/eventTypes to getIssueTimeline', async (t) => {
    mockItemFetch(t, { number: 1, nameWithOwner: 'o/r', isPrivate: true });
    t.mock.method(octokit, 'request', async () => ({
      data: [
        { event: 'labeled', created_at: '2026-01-01T00:00:00Z' },
        { event: 'closed', created_at: '2026-06-01T00:00:00Z' }
      ]
    }));

    const result = await handleGetIssueTimeline({
      itemId: 'PVTI_yyy',
      since: '2026-02-01T00:00:00Z',
      eventTypes: ['closed']
    });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.count, 1);
    assert.strictEqual(parsed.events[0].type, 'closed');
  });

  it('returns an error when the item cannot be resolved to a repository/number', async (t) => {
    mockItemFetchNotFound(t);

    const result = await handleGetIssueTimeline({ itemId: 'PVTI_missing' });
    assert.ok(result.error);
  });

  it('returns the "Could not resolve item" guard error when content is null (e.g. draft issue)', async (t) => {
    mockItemFetchUnresolvableContent(t);

    const result = await handleGetIssueTimeline({ itemId: 'PVTI_draft' });
    assert.ok(result.error);
    assert.match(result.error, /Could not resolve item/);
  });

  it('returns an error for a malformed `since` value', async (t) => {
    mockItemFetch(t, { number: 1, nameWithOwner: 'o/r' });

    const result = await handleGetIssueTimeline({ itemId: 'PVTI_bad_since', since: 'not-a-date' });
    assert.ok(result.error);
    assert.match(result.error, /since/i);
  });
});
