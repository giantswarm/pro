import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { listItems, resolveItemIssues } from './items.js';

/**
 * Mock the global fetch used internally by @octokit/graphql so that
 * graphQLWithAuth/fetchPaginated resolve without hitting the network.
 * Captures the raw request body of every call for later inspection.
 * @param {Object} responseBody - The GraphQL `{ data: ... }` payload to return
 * @param {Array} calls - Array that request bodies will be pushed onto
 */
function mockGraphQLFetch(t, responseBody, calls) {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push(JSON.parse(init.body));
    return {
      status: 200,
      url: 'https://api.github.com/graphql',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ data: responseBody })
    };
  });
}

function makeItem(overrides = {}) {
  return {
    id: 'item-1',
    fieldValues: { nodes: [] },
    content: {
      title: 'Some issue',
      number: 42,
      url: 'https://github.com/giantswarm/foo/issues/42',
      state: 'OPEN',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      closedAt: null,
      repository: { nameWithOwner: 'giantswarm/foo', isPrivate: false, url: 'https://github.com/giantswarm/foo' },
      assignees: { nodes: [] },
      labels: { nodes: [] },
      ...overrides
    }
  };
}

describe('listItems - filter query building', () => {
  it('appends a created: term to the composed project query, trimmed', async (t) => {
    const calls = [];
    mockGraphQLFetch(t, {
      node: { items: { nodes: [], pageInfo: { hasNextPage: false } } }
    }, calls);

    process.env.GITHUB_API_TOKEN = 'test-token';
    await listItems({ boardId: 'board-1', created: '  >@today-90d  ' });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].variables.filterQuery, 'created:>@today-90d');
  });

  it('appends a closed: term to the composed project query', async (t) => {
    const calls = [];
    mockGraphQLFetch(t, {
      node: { items: { nodes: [], pageInfo: { hasNextPage: false } } }
    }, calls);

    process.env.GITHUB_API_TOKEN = 'test-token';
    await listItems({ boardId: 'board-1', closed: '>@today-30d' });

    assert.equal(calls[0].variables.filterQuery, 'closed:>@today-30d');
  });

  it('combines created and closed terms with other filters, space-separated', async (t) => {
    const calls = [];
    mockGraphQLFetch(t, {
      node: { items: { nodes: [], pageInfo: { hasNextPage: false } } }
    }, calls);

    process.env.GITHUB_API_TOKEN = 'test-token';
    await listItems({ boardId: 'board-1', state: 'open', created: '>@today-90d', closed: '<@today-1d' });

    assert.equal(calls[0].variables.filterQuery, 'is:open created:>@today-90d closed:<@today-1d');
  });

  it('omits the created/closed terms entirely when only whitespace is given', async (t) => {
    const calls = [];
    mockGraphQLFetch(t, {
      node: { items: { nodes: [], pageInfo: { hasNextPage: false } } }
    }, calls);

    process.env.GITHUB_API_TOKEN = 'test-token';
    await listItems({ boardId: 'board-1', created: '   ', closed: '' });

    assert.equal(calls[0].variables.filterQuery, null);
  });
});

describe('listItems - response mapping', () => {
  it('emits state/createdAt/updatedAt/closedAt for a closed item', async (t) => {
    const calls = [];
    const closedItem = makeItem({ state: 'CLOSED', closedAt: '2026-02-01T00:00:00Z' });
    mockGraphQLFetch(t, {
      node: { items: { nodes: [closedItem], pageInfo: { hasNextPage: false } } }
    }, calls);

    process.env.GITHUB_API_TOKEN = 'test-token';
    const result = await listItems({ boardId: 'board-1' });

    assert.equal(result.status, 'success');
    assert.equal(result.data.length, 1);
    const entry = result.data[0];
    assert.equal(entry.state, 'CLOSED');
    assert.equal(entry.createdAt, '2026-01-01T00:00:00Z');
    assert.equal(entry.updatedAt, '2026-01-02T00:00:00Z');
    assert.equal(entry.closedAt, '2026-02-01T00:00:00Z');
  });

  it('omits closedAt entirely for an open item', async (t) => {
    const calls = [];
    const openItem = makeItem({ state: 'OPEN', closedAt: null });
    mockGraphQLFetch(t, {
      node: { items: { nodes: [openItem], pageInfo: { hasNextPage: false } } }
    }, calls);

    process.env.GITHUB_API_TOKEN = 'test-token';
    const result = await listItems({ boardId: 'board-1' });

    const entry = result.data[0];
    assert.equal(entry.state, 'OPEN');
    assert.ok(!('closedAt' in entry), 'closedAt should be omitted for open items');
  });
});

describe('resolveItemIssues', () => {
  it('resolves items to their issue refs, preserving input order', async (t) => {
    const calls = [];
    mockGraphQLFetch(t, {
      nodes: [
        {
          id: 'PVTI_1',
          content: { id: 'I_1', number: 5, repository: { isPrivate: true, nameWithOwner: 'giantswarm/pro' } }
        },
        null
      ]
    }, calls);

    process.env.GITHUB_API_TOKEN = 'test-token';
    const refs = await resolveItemIssues(['PVTI_1', 'PVTI_2']);

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].variables.ids, ['PVTI_1', 'PVTI_2']);
    assert.deepEqual(refs.get('PVTI_1'), {
      issueId: 'I_1',
      owner: 'giantswarm',
      repo: 'pro',
      number: 5,
      isPrivate: true,
      nameWithOwner: 'giantswarm/pro'
    });
    assert.equal(refs.get('PVTI_2'), null);
  });

  it('carries repository visibility for public repos', async (t) => {
    const calls = [];
    mockGraphQLFetch(t, {
      nodes: [{
        id: 'PVTI_1',
        content: { id: 'I_7', number: 7, repository: { isPrivate: false, nameWithOwner: 'giantswarm/roadmap' } }
      }]
    }, calls);

    process.env.GITHUB_API_TOKEN = 'test-token';
    const refs = await resolveItemIssues(['PVTI_1']);

    assert.equal(refs.get('PVTI_1').isPrivate, false);
    assert.equal(refs.get('PVTI_1').nameWithOwner, 'giantswarm/roadmap');
  });

  it('treats a node with no issue content (e.g. a draft issue) as unresolved', async (t) => {
    const calls = [];
    mockGraphQLFetch(t, {
      nodes: [{ id: 'PVTI_1', content: null }]
    }, calls);

    process.env.GITHUB_API_TOKEN = 'test-token';
    const refs = await resolveItemIssues(['PVTI_1']);
    assert.equal(refs.get('PVTI_1'), null);
  });
});
