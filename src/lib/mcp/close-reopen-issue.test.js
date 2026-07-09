import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.GITHUB_API_TOKEN = 'test-token';

const { handleCloseIssue, handleReopenIssue, tools, toolHandlers } = await import('./tools.js');

function parseResult(result) {
  return JSON.parse(result.content[0].text);
}

/**
 * Mock global fetch (used internally by @octokit/graphql) with a queue of
 * GraphQL response bodies, returned in call order. Also records the request
 * bodies (parsed) for assertions.
 */
function mockGraphQLSequence(t, responses) {
  const calls = [];
  let i = 0;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    calls.push(JSON.parse(opts.body));
    const body = responses[i++];
    return new Response(JSON.stringify({ data: body }), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  });
  return calls;
}

const ISSUE_CONTENT = {
  id: 'I_kwDOtest1',
  number: 42,
  state: 'OPEN',
  url: 'https://github.com/o/r/issues/42',
  repository: { isPrivate: true, nameWithOwner: 'giantswarm/customer1' }
};

const PUBLIC_ISSUE_CONTENT = {
  id: 'I_kwDOtest2',
  number: 7,
  state: 'OPEN',
  url: 'https://github.com/giantswarm/roadmap/issues/7',
  repository: { isPrivate: false, nameWithOwner: 'giantswarm/roadmap' }
};

// ---------------------------------------------------------------------------
// Export structure
// ---------------------------------------------------------------------------

describe('close_issue / reopen_issue exports', () => {
  it('registers close_issue and reopen_issue tools', () => {
    const names = tools.map(t => t.name);
    assert.ok(names.includes('close_issue'));
    assert.ok(names.includes('reopen_issue'));
  });

  it('has a handler for both tools', () => {
    assert.strictEqual(typeof toolHandlers.close_issue, 'function');
    assert.strictEqual(typeof toolHandlers.reopen_issue, 'function');
  });

  it('neither tool accepts an array of item IDs (one item per call)', () => {
    const closeTool = tools.find(t => t.name === 'close_issue');
    const reopenTool = tools.find(t => t.name === 'reopen_issue');
    assert.strictEqual(closeTool.inputSchema.properties.itemId.type, 'string');
    assert.strictEqual(reopenTool.inputSchema.properties.itemId.type, 'string');
  });
});

// ---------------------------------------------------------------------------
// close_issue
// ---------------------------------------------------------------------------

describe('handleCloseIssue', () => {
  it('closes an issue with the default stateReason (completed)', async (t) => {
    const calls = mockGraphQLSequence(t, [
      { node: { content: ISSUE_CONTENT } },
      { closeIssue: { issue: { ...ISSUE_CONTENT, state: 'CLOSED', stateReason: 'COMPLETED' } } }
    ]);

    const result = await handleCloseIssue({ itemId: 'PVTI_item1' });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.success, true);
    assert.strictEqual(parsed.state, 'CLOSED');
    assert.strictEqual(parsed.stateReason, 'COMPLETED');
    assert.strictEqual(parsed.commentPosted, false);

    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[1].variables.stateReason, 'COMPLETED');
    assert.strictEqual(calls[1].variables.issueId, ISSUE_CONTENT.id);
  });

  it('maps stateReason "not_planned" to the NOT_PLANNED enum', async (t) => {
    const calls = mockGraphQLSequence(t, [
      { node: { content: ISSUE_CONTENT } },
      { closeIssue: { issue: { ...ISSUE_CONTENT, state: 'CLOSED', stateReason: 'NOT_PLANNED' } } }
    ]);

    const result = await handleCloseIssue({ itemId: 'PVTI_item1', stateReason: 'not_planned' });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.stateReason, 'NOT_PLANNED');
    assert.strictEqual(calls[1].variables.stateReason, 'NOT_PLANNED');
  });

  it('posts a comment before closing when comment is provided', async (t) => {
    const calls = mockGraphQLSequence(t, [
      { node: { content: ISSUE_CONTENT } },
      { addComment: { commentEdge: { node: { id: 'IC_1', url: 'https://github.com/o/r/issues/42#issuecomment-1' } } } },
      { closeIssue: { issue: { ...ISSUE_CONTENT, state: 'CLOSED', stateReason: 'COMPLETED' } } }
    ]);

    const result = await handleCloseIssue({ itemId: 'PVTI_item1', comment: 'Closing this out' });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.commentPosted, true);
    // Order matters: comment must be posted BEFORE the close mutation.
    assert.strictEqual(calls.length, 3);
    assert.match(calls[1].query, /AddComment/);
    assert.strictEqual(calls[1].variables.body, 'Closing this out');
    assert.strictEqual(calls[1].variables.subjectId, ISSUE_CONTENT.id);
    assert.match(calls[2].query, /CloseIssue/);
  });

  it('returns an error when the item has no underlying issue', async (t) => {
    mockGraphQLSequence(t, [{ node: { content: null } }]);

    const result = await handleCloseIssue({ itemId: 'PVTI_missing' });
    assert.ok(result.error);
    assert.match(result.error, /Could not resolve an underlying issue/);
  });

  it('returns an error for an unrecognized non-empty stateReason without any GraphQL calls', async (t) => {
    const calls = mockGraphQLSequence(t, [{ node: { content: ISSUE_CONTENT } }]);

    const result = await handleCloseIssue({ itemId: 'PVTI_item1', stateReason: 'wontfix' });
    assert.ok(result.error);
    assert.match(result.error, /Invalid stateReason/);
    // stateReason is validated before resolving the item or posting a comment.
    assert.strictEqual(calls.length, 0);
  });

  it('rejects an invalid stateReason before posting a comment (no side effects)', async (t) => {
    const calls = mockGraphQLSequence(t, [{ node: { content: ISSUE_CONTENT } }]);

    const result = await handleCloseIssue({ itemId: 'PVTI_item1', comment: 'Closing this out', stateReason: 'wontfix' });
    assert.ok(result.error);
    assert.match(result.error, /Invalid stateReason/);
    // Neither the item resolution nor the comment should have been attempted.
    assert.strictEqual(calls.length, 0);
  });

  it('requires confirmPublicSafe when posting a comment to a public repo', async (t) => {
    const calls = mockGraphQLSequence(t, [{ node: { content: PUBLIC_ISSUE_CONTENT } }]);

    const result = await handleCloseIssue({ itemId: 'PVTI_item2', comment: 'Closing per request' });
    assert.ok(result.error);
    assert.match(result.error, /confirmPublicSafe/);
    assert.match(result.error, /giantswarm\/roadmap/);
    // Neither the comment nor the close mutation should have been attempted.
    assert.strictEqual(calls.length, 1);
  });

  it('proceeds with a public-repo comment when confirmPublicSafe=true', async (t) => {
    const calls = mockGraphQLSequence(t, [
      { node: { content: PUBLIC_ISSUE_CONTENT } },
      { addComment: { commentEdge: { node: { id: 'IC_3', url: 'https://github.com/giantswarm/roadmap/issues/7#issuecomment-3' } } } },
      { closeIssue: { issue: { ...PUBLIC_ISSUE_CONTENT, state: 'CLOSED', stateReason: 'COMPLETED' } } }
    ]);

    const result = await handleCloseIssue({
      itemId: 'PVTI_item2',
      comment: 'Closing per request',
      confirmPublicSafe: true
    });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.commentPosted, true);
    assert.strictEqual(calls.length, 3);
  });

  it('does not gate a comment on a private repo', async (t) => {
    const calls = mockGraphQLSequence(t, [
      { node: { content: ISSUE_CONTENT } },
      { addComment: { commentEdge: { node: { id: 'IC_4', url: 'https://github.com/o/r/issues/42#issuecomment-4' } } } },
      { closeIssue: { issue: { ...ISSUE_CONTENT, state: 'CLOSED', stateReason: 'COMPLETED' } } }
    ]);

    const result = await handleCloseIssue({ itemId: 'PVTI_item1', comment: 'Closing this out' });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.commentPosted, true);
    assert.strictEqual(calls.length, 3);
  });
});

// ---------------------------------------------------------------------------
// reopen_issue
// ---------------------------------------------------------------------------

describe('handleReopenIssue', () => {
  it('reopens an issue', async (t) => {
    const calls = mockGraphQLSequence(t, [
      { node: { content: { ...ISSUE_CONTENT, state: 'CLOSED' } } },
      { reopenIssue: { issue: { ...ISSUE_CONTENT, state: 'OPEN' } } }
    ]);

    const result = await handleReopenIssue({ itemId: 'PVTI_item1' });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.success, true);
    assert.strictEqual(parsed.state, 'OPEN');
    assert.strictEqual(parsed.commentPosted, false);
    assert.strictEqual(calls[1].variables.issueId, ISSUE_CONTENT.id);
  });

  it('posts a comment before reopening when comment is provided', async (t) => {
    const calls = mockGraphQLSequence(t, [
      { node: { content: { ...ISSUE_CONTENT, state: 'CLOSED' } } },
      { addComment: { commentEdge: { node: { id: 'IC_2', url: 'https://github.com/o/r/issues/42#issuecomment-2' } } } },
      { reopenIssue: { issue: { ...ISSUE_CONTENT, state: 'OPEN' } } }
    ]);

    const result = await handleReopenIssue({ itemId: 'PVTI_item1', comment: 'Reopening, still relevant' });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.commentPosted, true);
    assert.strictEqual(calls.length, 3);
    assert.match(calls[1].query, /AddComment/);
    assert.match(calls[2].query, /ReopenIssue/);
  });

  it('returns an error when the item has no underlying issue', async (t) => {
    mockGraphQLSequence(t, [{ node: { content: null } }]);

    const result = await handleReopenIssue({ itemId: 'PVTI_missing' });
    assert.ok(result.error);
    assert.match(result.error, /Could not resolve an underlying issue/);
  });

  it('requires confirmPublicSafe when posting a comment to a public repo', async (t) => {
    const calls = mockGraphQLSequence(t, [{ node: { content: { ...PUBLIC_ISSUE_CONTENT, state: 'CLOSED' } } }]);

    const result = await handleReopenIssue({ itemId: 'PVTI_item2', comment: 'Reopening, still relevant' });
    assert.ok(result.error);
    assert.match(result.error, /confirmPublicSafe/);
    assert.strictEqual(calls.length, 1);
  });

  it('proceeds with a public-repo comment when confirmPublicSafe=true', async (t) => {
    const calls = mockGraphQLSequence(t, [
      { node: { content: { ...PUBLIC_ISSUE_CONTENT, state: 'CLOSED' } } },
      { addComment: { commentEdge: { node: { id: 'IC_5', url: 'https://github.com/giantswarm/roadmap/issues/7#issuecomment-5' } } } },
      { reopenIssue: { issue: { ...PUBLIC_ISSUE_CONTENT, state: 'OPEN' } } }
    ]);

    const result = await handleReopenIssue({
      itemId: 'PVTI_item2',
      comment: 'Reopening, still relevant',
      confirmPublicSafe: true
    });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.commentPosted, true);
    assert.strictEqual(calls.length, 3);
  });
});
