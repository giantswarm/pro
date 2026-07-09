import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.GITHUB_API_TOKEN = 'test-token';

const { octokit } = await import('./rest-api.js');
const {
  resolveItemIssueRefs,
  fetchIssueComments,
  listIssueCommentsForItems,
  MAX_ITEMS_PER_CALL,
  MAX_COMMENT_BODY_LENGTH,
  MAX_PAGES
} = await import('./comments.js');

/** Build a fetch-compatible Response wrapping a GraphQL {data: ...} body. */
function graphqlResponse(dataObj) {
  return new Response(JSON.stringify({ data: dataObj }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

// ---------------------------------------------------------------------------
// resolveItemIssueRefs
// ---------------------------------------------------------------------------

describe('resolveItemIssueRefs', () => {
  it('resolves items to owner/repo/number, preserving input order', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => graphqlResponse({
      nodes: [
        { id: 'PVTI_1', content: { number: 5, repository: { nameWithOwner: 'giantswarm/pro' } } },
        null
      ]
    }));

    const refs = await resolveItemIssueRefs(['PVTI_1', 'PVTI_2']);

    assert.deepStrictEqual(refs.get('PVTI_1'), { owner: 'giantswarm', repo: 'pro', number: 5 });
    assert.strictEqual(refs.get('PVTI_2'), null);
  });

  it('treats a node with no issue content as unresolved', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => graphqlResponse({
      nodes: [{ id: 'PVTI_1', content: null }]
    }));

    const refs = await resolveItemIssueRefs(['PVTI_1']);
    assert.strictEqual(refs.get('PVTI_1'), null);
  });
});

// ---------------------------------------------------------------------------
// fetchIssueComments
// ---------------------------------------------------------------------------

describe('fetchIssueComments', () => {
  it('forwards since/per_page and truncates long bodies with an indicator', async (t) => {
    t.mock.method(octokit, 'request', async (args) => {
      const url = new URL(args.url);
      assert.strictEqual(url.searchParams.get('since'), '2026-01-01T00:00:00Z');
      assert.strictEqual(url.searchParams.get('per_page'), '100');
      return {
        data: [{
          user: { login: 'alice' },
          created_at: '2026-01-02T00:00:00Z',
          body: 'x'.repeat(MAX_COMMENT_BODY_LENGTH + 500)
        }],
        headers: {}
      };
    });

    const { comments, totalFetched } = await fetchIssueComments(
      { owner: 'o', repo: 'r', number: 5 },
      { since: '2026-01-01T00:00:00Z', maxPerIssue: 20 }
    );

    assert.strictEqual(totalFetched, 1);
    assert.strictEqual(comments.length, 1);
    assert.strictEqual(comments[0].author, 'alice');
    assert.strictEqual(comments[0].createdAt, '2026-01-02T00:00:00Z');
    assert.ok(comments[0].body.length < MAX_COMMENT_BODY_LENGTH + 500);
    assert.match(comments[0].body, /truncated 500 characters/);
  });

  it('keeps only the newest maxPerIssue comments across multiple pages', async (t) => {
    let call = 0;
    t.mock.method(octokit, 'request', async () => {
      call += 1;
      if (call === 1) {
        return {
          data: Array.from({ length: 100 }, (_, i) => ({
            user: { login: `u${i}` },
            created_at: `2026-01-01T00:${String(i).padStart(2, '0')}:00Z`,
            body: `c${i}`
          })),
          headers: { link: '<https://api.github.com/next>; rel="next"' }
        };
      }
      return {
        data: Array.from({ length: 10 }, (_, i) => ({
          user: { login: `v${i}` },
          created_at: `2026-01-01T02:${String(i).padStart(2, '0')}:00Z`,
          body: `d${i}`
        })),
        headers: {}
      };
    });

    const { comments, totalFetched } = await fetchIssueComments(
      { owner: 'o', repo: 'r', number: 1 },
      { maxPerIssue: 5 }
    );

    assert.strictEqual(totalFetched, 110);
    assert.strictEqual(comments.length, 5);
    assert.deepStrictEqual(comments.map(c => c.author), ['v5', 'v6', 'v7', 'v8', 'v9']);
  });

  it('includes updatedAt when it differs from createdAt (edited comment)', async (t) => {
    t.mock.method(octokit, 'request', async () => ({
      data: [{
        user: { login: 'alice' },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
        body: 'edited'
      }],
      headers: {}
    }));

    const { comments } = await fetchIssueComments({ owner: 'o', repo: 'r', number: 1 }, { maxPerIssue: 20 });
    assert.strictEqual(comments[0].createdAt, '2026-01-01T00:00:00Z');
    assert.strictEqual(comments[0].updatedAt, '2026-01-02T00:00:00Z');
  });

  it('omits updatedAt when it matches createdAt (unedited comment)', async (t) => {
    t.mock.method(octokit, 'request', async () => ({
      data: [{
        user: { login: 'alice' },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        body: 'never edited'
      }],
      headers: {}
    }));

    const { comments } = await fetchIssueComments({ owner: 'o', repo: 'r', number: 1 }, { maxPerIssue: 20 });
    assert.strictEqual(comments[0].createdAt, '2026-01-01T00:00:00Z');
    assert.strictEqual('updatedAt' in comments[0], false);
  });

  it('falls back to an empty-string author when the comment has no user', async (t) => {
    t.mock.method(octokit, 'request', async () => ({
      data: [{ user: null, created_at: '2026-01-01T00:00:00Z', body: 'hi' }],
      headers: {}
    }));

    const { comments } = await fetchIssueComments({ owner: 'o', repo: 'r', number: 1 }, { maxPerIssue: 20 });
    assert.strictEqual(comments[0].author, '');
  });

  it('omits the since param when not provided', async (t) => {
    t.mock.method(octokit, 'request', async (args) => {
      assert.strictEqual(new URL(args.url).searchParams.has('since'), false);
      return { data: [], headers: {} };
    });

    await fetchIssueComments({ owner: 'o', repo: 'r', number: 1 }, { maxPerIssue: 20 });
  });

  it('caps page fan-out at MAX_PAGES and flags truncatedPages when since is absent', async (t) => {
    let call = 0;
    t.mock.method(octokit, 'request', async () => {
      call += 1;
      return {
        data: Array.from({ length: 100 }, (_, i) => ({
          user: { login: `p${call}u${i}` },
          created_at: `2026-01-01T00:${String(i).padStart(2, '0')}:00Z`,
          body: `c${call}-${i}`
        })),
        // Always signals another page is available -- without a cap this would loop forever.
        headers: { link: '<https://api.github.com/next>; rel="next"' }
      };
    });

    const { comments, totalFetched, truncatedPages } = await fetchIssueComments(
      { owner: 'o', repo: 'r', number: 1 },
      { maxPerIssue: 5 }
    );

    assert.strictEqual(call, MAX_PAGES);
    assert.strictEqual(truncatedPages, true);
    assert.strictEqual(totalFetched, MAX_PAGES * 100);
    assert.strictEqual(comments.length, 5);
  });

  it('does not truncate pages when since is supplied, even past MAX_PAGES', async (t) => {
    let call = 0;
    t.mock.method(octokit, 'request', async () => {
      call += 1;
      if (call <= MAX_PAGES + 1) {
        return {
          data: [{ user: { login: `u${call}` }, created_at: `2026-01-0${call}T00:00:00Z`, updated_at: `2026-01-0${call}T00:00:00Z`, body: `c${call}` }],
          headers: call <= MAX_PAGES ? { link: '<https://api.github.com/next>; rel="next"' } : {}
        };
      }
      return { data: [], headers: {} };
    });

    const { totalFetched, truncatedPages } = await fetchIssueComments(
      { owner: 'o', repo: 'r', number: 1 },
      { since: '2026-01-01T00:00:00Z', maxPerIssue: 20 }
    );

    assert.strictEqual(call, MAX_PAGES + 1);
    assert.strictEqual(truncatedPages, false);
    assert.strictEqual(totalFetched, MAX_PAGES + 1);
  });

  it('keeps a recently-updated older comment over an untouched newer one when since trims by updated_at', async (t) => {
    t.mock.method(octokit, 'request', async () => ({
      data: [
        { user: { login: 'old-edited' }, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-10T00:00:00Z', body: 'edited old' },
        { user: { login: 'new1' }, created_at: '2026-01-05T00:00:00Z', updated_at: '2026-01-05T00:00:00Z', body: 'n1' },
        { user: { login: 'new2' }, created_at: '2026-01-06T00:00:00Z', updated_at: '2026-01-06T00:00:00Z', body: 'n2' }
      ],
      headers: {}
    }));

    const { comments } = await fetchIssueComments(
      { owner: 'o', repo: 'r', number: 1 },
      { since: '2026-01-01T00:00:00Z', maxPerIssue: 2 }
    );

    const authors = comments.map(c => c.author);
    assert.strictEqual(authors.length, 2);
    assert.ok(authors.includes('old-edited'), 'recently-updated old comment should survive the trim');
    assert.ok(!authors.includes('new1'), 'oldest-by-updated_at comment should be dropped');

    const survivor = comments.find(c => c.author === 'old-edited');
    assert.strictEqual(survivor.updatedAt, '2026-01-10T00:00:00Z', 'the surviving edited comment should expose why it outranked a newer-created one');
  });
});

// ---------------------------------------------------------------------------
// listIssueCommentsForItems
// ---------------------------------------------------------------------------

describe('listIssueCommentsForItems', () => {
  it('rejects an empty itemIds array', async () => {
    await assert.rejects(() => listIssueCommentsForItems({ itemIds: [] }), /non-empty/);
  });

  it('rejects missing itemIds', async () => {
    await assert.rejects(() => listIssueCommentsForItems({}), /non-empty/);
  });

  it('rejects more than MAX_ITEMS_PER_CALL itemIds', async () => {
    const ids = Array.from({ length: MAX_ITEMS_PER_CALL + 1 }, (_, i) => `PVTI_${i}`);
    await assert.rejects(() => listIssueCommentsForItems({ itemIds: ids }), /Too many itemIds/);
  });

  it('resolves items then fetches comments per item, marking unresolved items with an error', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => graphqlResponse({
      nodes: [
        { id: 'PVTI_1', content: { number: 5, repository: { nameWithOwner: 'giantswarm/pro' } } },
        null
      ]
    }));
    t.mock.method(octokit, 'request', async () => ({
      data: [{ user: { login: 'alice' }, created_at: '2026-01-02T00:00:00Z', body: 'hi' }],
      headers: {}
    }));

    const results = await listIssueCommentsForItems({ itemIds: ['PVTI_1', 'PVTI_2'] });

    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].repository, 'giantswarm/pro');
    assert.strictEqual(results[0].issueNumber, 5);
    assert.strictEqual(results[0].comments.length, 1);
    assert.ok(results[1].error);
  });

  it('applies the default maxPerIssue when an invalid value is passed', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => graphqlResponse({
      nodes: [{ id: 'PVTI_1', content: { number: 1, repository: { nameWithOwner: 'o/r' } } }]
    }));
    t.mock.method(octokit, 'request', async () => ({
      data: Array.from({ length: 30 }, (_, i) => ({
        user: { login: `u${i}` },
        created_at: `2026-01-01T00:${String(i).padStart(2, '0')}:00Z`,
        body: `c${i}`
      })),
      headers: {}
    }));

    const results = await listIssueCommentsForItems({ itemIds: ['PVTI_1'], maxPerIssue: -5 });
    assert.strictEqual(results[0].comments.length, 20);
  });
});
