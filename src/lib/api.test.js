import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { fetchBounded, fetchPaginated } from './api.js';

const QUERY = 'query Pages($first: Int!, $after: String) { node { items { nodes pageInfo } } }';
const getPage = result => result.node.items;

/**
 * Mock the global fetch used by @octokit/graphql with a page per cursor:
 * `pages.start` answers the first request, `pages[cursor]` a request made
 * with `after: cursor`. Records every request's variables on `calls`.
 */
function mockPages(t, pages, calls) {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body.variables);
    const page = pages[body.variables.after ?? 'start'];
    assert.ok(page, `no page mocked for cursor ${body.variables.after}`);
    return {
      status: 200,
      url: 'https://api.github.com/graphql',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ data: { node: { items: page } } })
    };
  });
}

describe('fetchBounded', () => {
  it('reads one page sized to the limit when that page fills it, and reports the pages left', async (t) => {
    const calls = [];
    mockPages(t, {
      start: { nodes: [{ id: 1 }, { id: 2 }], pageInfo: { hasNextPage: true, endCursor: 'c2' } }
    }, calls);

    process.env.GITHUB_API_TOKEN = 'test-token';
    const result = await fetchBounded(QUERY, { first: 100 }, getPage, undefined, { limit: 2 });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].first, 2);
    assert.ok(!('after' in calls[0]));
    assert.deepEqual(result.nodes.map(n => n.id), [1, 2]);
    assert.equal(result.hasNextPage, true);
    assert.equal(result.endCursor, 'c2');
  });

  it('asks the next page for the nodes still missing when keep rejects some', async (t) => {
    const calls = [];
    mockPages(t, {
      start: { nodes: [{ id: 1, ok: false }, { id: 2, ok: true }], pageInfo: { hasNextPage: true, endCursor: 'c2' } },
      c2: { nodes: [{ id: 3, ok: true }], pageInfo: { hasNextPage: true, endCursor: 'c3' } }
    }, calls);

    process.env.GITHUB_API_TOKEN = 'test-token';
    const result = await fetchBounded(QUERY, { first: 100 }, getPage, undefined, { limit: 2, keep: n => n.ok });

    assert.deepEqual(calls.map(c => [c.first, c.after ?? null]), [[2, null], [1, 'c2']]);
    assert.deepEqual(result.nodes.map(n => n.id), [2, 3]);
    assert.equal(result.hasNextPage, true);
    assert.equal(result.endCursor, 'c3');
  });

  it('never asks for more than the caller\'s page size', async (t) => {
    const calls = [];
    mockPages(t, {
      start: { nodes: [{ id: 1 }], pageInfo: { hasNextPage: false, endCursor: 'c1' } }
    }, calls);

    process.env.GITHUB_API_TOKEN = 'test-token';
    await fetchBounded(QUERY, { first: 100 }, getPage, undefined, { limit: 500 });

    assert.equal(calls[0].first, 100);
  });

  it('reads every page at the caller\'s page size when the limit is 0', async (t) => {
    const calls = [];
    mockPages(t, {
      start: { nodes: [{ id: 1 }], pageInfo: { hasNextPage: true, endCursor: 'c1' } },
      c1: { nodes: [{ id: 2 }], pageInfo: { hasNextPage: false, endCursor: 'c2' } }
    }, calls);

    process.env.GITHUB_API_TOKEN = 'test-token';
    const result = await fetchBounded(QUERY, { first: 100 }, getPage, undefined, { limit: 0 });

    assert.deepEqual(calls.map(c => c.first), [100, 100]);
    assert.deepEqual(result.nodes.map(n => n.id), [1, 2]);
    assert.equal(result.hasNextPage, false);
  });

  it('does not report a cut when the limit is met on the last page', async (t) => {
    const calls = [];
    mockPages(t, {
      start: { nodes: [{ id: 1 }], pageInfo: { hasNextPage: false, endCursor: 'c1' } }
    }, calls);

    process.env.GITHUB_API_TOKEN = 'test-token';
    const result = await fetchBounded(QUERY, { first: 100 }, getPage, undefined, { limit: 1 });

    assert.equal(result.nodes.length, 1);
    assert.equal(result.hasNextPage, false);
  });

  it('continues from the given cursor', async (t) => {
    const calls = [];
    mockPages(t, {
      c5: { nodes: [{ id: 6 }], pageInfo: { hasNextPage: false, endCursor: 'c6' } }
    }, calls);

    process.env.GITHUB_API_TOKEN = 'test-token';
    const result = await fetchBounded(QUERY, { first: 100 }, getPage, undefined, { after: 'c5', limit: 10 });

    assert.equal(calls[0].after, 'c5');
    assert.deepEqual(result.nodes.map(n => n.id), [6]);
  });

  it('ends at a page that announces a next page without a cursor instead of repeating it', async (t) => {
    const calls = [];
    mockPages(t, {
      start: { nodes: [{ id: 1 }], pageInfo: { hasNextPage: true } }
    }, calls);

    process.env.GITHUB_API_TOKEN = 'test-token';
    const result = await fetchBounded(QUERY, { first: 100 }, getPage);

    assert.equal(calls.length, 1);
    assert.equal(result.hasNextPage, false);
    assert.equal(result.endCursor, null);
  });
});

describe('fetchPaginated', () => {
  it('returns the nodes of every page', async (t) => {
    const calls = [];
    mockPages(t, {
      start: { nodes: [{ id: 1 }, { id: 2 }], pageInfo: { hasNextPage: true, endCursor: 'c2' } },
      c2: { nodes: [{ id: 3 }], pageInfo: { hasNextPage: false, endCursor: 'c3' } }
    }, calls);

    process.env.GITHUB_API_TOKEN = 'test-token';
    const nodes = await fetchPaginated(QUERY, { first: 100 }, getPage);

    assert.equal(calls.length, 2);
    assert.deepEqual(nodes.map(n => n.id), [1, 2, 3]);
  });
});
