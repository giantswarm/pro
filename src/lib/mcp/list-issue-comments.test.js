import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.GITHUB_API_TOKEN = 'test-token';

const { octokit } = await import('../rest-api.js');
const {
  listIssueCommentsTool,
  handleListIssueComments,
  tools,
  toolHandlers
} = await import('./tools.js');

function parseResult(result) {
  return JSON.parse(result.content[0].text);
}

/** Build a fetch-compatible Response wrapping a GraphQL {data: ...} body. */
function graphqlResponse(dataObj) {
  return new Response(JSON.stringify({ data: dataObj }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe('list_issue_comments registration', () => {
  it('is registered in tools and toolHandlers', () => {
    assert.ok(tools.some(t => t.name === 'list_issue_comments'));
    assert.strictEqual(typeof toolHandlers.list_issue_comments, 'function');
    assert.strictEqual(toolHandlers.list_issue_comments, handleListIssueComments);
  });

  it('requires itemIds and exposes since/maxPerIssue as optional', () => {
    assert.deepStrictEqual(listIssueCommentsTool.inputSchema.required, ['itemIds']);
    assert.ok(listIssueCommentsTool.inputSchema.properties.since);
    assert.ok(listIssueCommentsTool.inputSchema.properties.maxPerIssue);
    assert.ok(listIssueCommentsTool.inputSchema.properties.itemIds);
  });

  it('is board-independent -- does not declare a board parameter (resolves purely by itemId)', () => {
    assert.strictEqual(listIssueCommentsTool.inputSchema.properties.board, undefined);
  });
});

// ---------------------------------------------------------------------------
// handleListIssueComments
// ---------------------------------------------------------------------------

describe('handleListIssueComments', () => {
  it('returns comments per item on success', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => graphqlResponse({
      nodes: [{ id: 'PVTI_1', content: { number: 7, repository: { nameWithOwner: 'giantswarm/pro' } } }]
    }));
    t.mock.method(octokit, 'request', async () => ({
      data: [{ user: { login: 'bob' }, created_at: '2026-01-01T00:00:00Z', body: 'hello' }],
      headers: {}
    }));

    const result = await handleListIssueComments({ itemIds: ['PVTI_1'] });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.itemCount, 1);
    assert.strictEqual(parsed.items[0].repository, 'giantswarm/pro');
    assert.strictEqual(parsed.items[0].issueNumber, 7);
    assert.strictEqual(parsed.items[0].comments[0].author, 'bob');
  });

  it('returns an error for an empty itemIds array', async () => {
    const result = await handleListIssueComments({ itemIds: [] });
    assert.ok(result.error);
  });

  it('returns a clear error when itemIds exceeds the documented cap', async () => {
    const ids = Array.from({ length: 26 }, (_, i) => `PVTI_${i}`);
    const result = await handleListIssueComments({ itemIds: ids });
    assert.match(result.error, /Too many itemIds/);
  });
});
