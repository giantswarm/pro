import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { listItems, resolveItemIssues, getItemByID } from './items.js';

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

  it('maps iteration titles and dates into fields next to single-select names', async (t) => {
    const item = makeItem();
    item.fieldValues.nodes = [
      { name: 'Done ✅', field: { name: 'Status' } },
      { title: 'Q4/2026', field: { name: 'Quarter' } },
      { date: '2026-12-31', field: { name: 'Target Date' } },
      { text: 'a note', field: { name: 'Note' } }
    ];
    mockGraphQLFetch(t, { node: { items: { nodes: [item], pageInfo: { hasNextPage: false } } } }, []);

    process.env.GITHUB_API_TOKEN = 'test-token';
    const result = await listItems({ boardId: 'board-1' });

    assert.deepEqual(result.data[0].fields, { Status: 'Done ✅', Quarter: 'Q4/2026', 'Target Date': '2026-12-31' });
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

describe('listItems - dependency counts', () => {
  /** Answer the list request with `items` and the counts request with `counts` ({ data, errors }). */
  function mockListAndCounts(t, items, counts, calls = []) {
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      const answer = body.query.includes('GetDependencyCounts')
        ? counts(body.variables)
        : { data: { node: { items: { nodes: items, pageInfo: { hasNextPage: false } } } } };
      return {
        status: 200,
        url: 'https://api.github.com/graphql',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(answer)
      };
    });
    return calls;
  }
  const issue = (id, n) => ({ ...makeItem({ id: `I_${n}`, number: n }), id });

  it('carries openBlockedBy/openBlocking counts only when non-zero', async (t) => {
    const calls = mockListAndCounts(t, [issue('item-1', 1), issue('item-2', 2)], () => ({
      data: {
        nodes: [
          { id: 'I_1', issueDependenciesSummary: { blockedBy: 2, blocking: 0 } },
          { id: 'I_2', issueDependenciesSummary: { blockedBy: 0, blocking: 0 } }
        ]
      }
    }));

    process.env.GITHUB_API_TOKEN = 'test-token';
    const result = await listItems({ boardId: 'board-1' });

    assert.equal(result.data[0].openBlockedBy, 2);
    assert.ok(!('openBlocking' in result.data[0]));
    assert.ok(!('openBlockedBy' in result.data[1]) && !('openBlocking' in result.data[1]));
    assert.ok(!('dependencyCountsError' in result));
    // Not in the list query: an error on one summary would null that item's content.
    assert.doesNotMatch(calls[0].query, /issueDependenciesSummary/);
    assert.deepEqual(calls[1].variables, { ids: ['I_1', 'I_2'] });
  });

  it('keeps the list and the other counts when one issue\'s counts fail', async (t) => {
    mockListAndCounts(t, [issue('item-1', 1), issue('item-2', 2)], () => ({
      data: { nodes: [null, { id: 'I_2', issueDependenciesSummary: { blockedBy: 0, blocking: 3 } }] },
      errors: [{ type: 'FORBIDDEN', path: ['nodes', 0, 'issueDependenciesSummary'], message: 'no access' }]
    }));

    process.env.GITHUB_API_TOKEN = 'test-token';
    const result = await listItems({ boardId: 'board-1' });

    assert.equal(result.status, 'success');
    assert.equal(result.data.length, 2);
    assert.ok(!('openBlockedBy' in result.data[0]) && !('openBlocking' in result.data[0]));
    assert.equal(result.data[1].openBlocking, 3);
    assert.ok(!('dependencyCountsError' in result));
  });

  it('keeps the list when the counts request fails, naming it in dependencyCountsError', async (t) => {
    mockListAndCounts(t, [issue('item-1', 1)], () => ({
      data: null,
      errors: [{ type: 'RATE_LIMITED', message: 'rate limited' }]
    }));

    process.env.GITHUB_API_TOKEN = 'test-token';
    const result = await listItems({ boardId: 'board-1' });

    assert.equal(result.status, 'success');
    assert.equal(result.data.length, 1);
    assert.ok(!('openBlockedBy' in result.data[0]));
    assert.match(result.dependencyCountsError, /rate limited/);
  });

  it('keeps the counts of the pages read when another page fails', async (t) => {
    const items = Array.from({ length: 150 }, (_, i) => issue(`item-${i}`, i));
    mockListAndCounts(t, items, ({ ids }) => ids.length === 100
      ? { data: { nodes: ids.map(id => ({ id, issueDependenciesSummary: { blockedBy: 1, blocking: 0 } })) } }
      : { data: null, errors: [{ type: 'RATE_LIMITED', message: 'rate limited' }] });

    process.env.GITHUB_API_TOKEN = 'test-token';
    const result = await listItems({ boardId: 'board-1', limit: 0 });

    assert.equal(result.data.length, 150);
    assert.equal(result.data.filter(entry => entry.openBlockedBy === 1).length, 100);
    assert.match(result.dependencyCountsError, /rate limited/);
  });

  it('asks for at most 4 count pages at once', async (t) => {
    const items = Array.from({ length: 950 }, (_, i) => issue(`item-${i}`, i));
    let inFlight = 0;
    let peak = 0;
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      const body = JSON.parse(init.body);
      let answer = { data: { node: { items: { nodes: items, pageInfo: { hasNextPage: false } } } } };
      if (body.query.includes('GetDependencyCounts')) {
        peak = Math.max(peak, ++inFlight);
        await new Promise(resolve => setTimeout(resolve, 1));
        inFlight--;
        answer = { data: { nodes: body.variables.ids.map(id => ({ id, issueDependenciesSummary: { blockedBy: 1, blocking: 0 } })) } };
      }
      return {
        status: 200,
        url: 'https://api.github.com/graphql',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(answer)
      };
    });

    process.env.GITHUB_API_TOKEN = 'test-token';
    const result = await listItems({ boardId: 'board-1', limit: 0 });

    assert.equal(peak, 4);
    assert.ok(result.data.every(entry => entry.openBlockedBy === 1));
  });

  it('asks for counts in pages of 100 issues and not at all for an empty list', async (t) => {
    const items = Array.from({ length: 150 }, (_, i) => issue(`item-${i}`, i));
    const calls = mockListAndCounts(t, items, ({ ids }) => ({
      data: { nodes: ids.map(id => ({ id, issueDependenciesSummary: { blockedBy: 1, blocking: 0 } })) }
    }));

    process.env.GITHUB_API_TOKEN = 'test-token';
    const result = await listItems({ boardId: 'board-1', limit: 0 });

    const countCalls = calls.filter(c => c.query.includes('GetDependencyCounts'));
    assert.deepEqual(countCalls.map(c => c.variables.ids.length), [100, 50]);
    assert.ok(result.data.every(entry => entry.openBlockedBy === 1));

    const emptyCalls = [];
    t.mock.restoreAll();
    mockListAndCounts(t, [], () => assert.fail('no counts request for an empty list'), emptyCalls);
    await listItems({ boardId: 'board-1' });
    assert.equal(emptyCalls.length, 1);
  });
});

describe('getItemByID - relations', () => {
  /** Answer the details request with `details` and the relations request with `relations` ({ data, errors }). */
  function mockDetailsAndRelations(t, details, relations) {
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      const body = JSON.parse(init.body);
      const answer = body.query.includes('GetItemRelations') ? relations : { data: details };
      return {
        status: 200,
        url: 'https://api.github.com/graphql',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(answer)
      };
    });
  }
  const details = { node: { id: 'PVTI_1', fieldValues: { nodes: [] }, content: { __typename: 'Issue', ...makeItem().content } } };
  const prDetails = { node: { id: 'PVTI_1', fieldValues: { nodes: [] }, content: { __typename: 'PullRequest' } } };
  const related = n => ({ number: n, title: `T${n}`, url: `https://github.com/o/r/issues/${n}`, state: 'OPEN', repository: { nameWithOwner: 'o/r' } });
  const lists = (blockedBy, blocking = { totalCount: 0, nodes: [] }) => ({ blockedBy, blocking, relatesTo: { totalCount: 0, nodes: [] } });

  it('returns blockedBy, blocking and relatesTo of the issue', async (t) => {
    mockDetailsAndRelations(t, details, { data: { node: { content: { __typename: 'Issue', ...lists({ totalCount: 1, nodes: [related(7)] }, { totalCount: 60, pageInfo: { hasNextPage: true }, nodes: [related(8)] }) } } } });
    process.env.GITHUB_API_TOKEN = 'test-token';
    const item = await getItemByID('PVTI_1');

    assert.deepEqual(item.blockedBy, { issues: [{ number: 7, title: 'T7', url: 'https://github.com/o/r/issues/7', state: 'open', repository: 'o/r' }] });
    assert.equal(item.blocking.truncated, true);
    assert.equal(item.blocking.totalCount, 60);
    assert.deepEqual(item.relatesTo, { issues: [] });
    assert.ok(!('relationsError' in item));
  });

  it('counts a related issue the token cannot read as hidden', async (t) => {
    mockDetailsAndRelations(t, details, {
      data: { node: { content: { __typename: 'Issue', ...lists({ totalCount: 1, nodes: [null] }) } } },
      errors: [{ type: 'FORBIDDEN', path: ['node', 'content', 'blockedBy', 'nodes', 0], message: 'no access' }]
    });
    process.env.GITHUB_API_TOKEN = 'test-token';
    const item = await getItemByID('PVTI_1');
    assert.deepEqual(item.blockedBy, { issues: [], hidden: 1 });
  });

  it('keeps the details when a whole relation list fails, naming it in relationsError', async (t) => {
    // The lists are non-null in GitHub's schema: an error on one nulls the issue.
    mockDetailsAndRelations(t, details, {
      data: { node: { content: null } },
      errors: [{ type: 'FORBIDDEN', path: ['node', 'content', 'blocking'], message: 'timeout' }]
    });
    process.env.GITHUB_API_TOKEN = 'test-token';
    const item = await getItemByID('PVTI_1');
    assert.equal(item.title, 'Some issue');
    assert.equal(item.relationsError, 'timeout');
    assert.ok(!('blockedBy' in item));
  });

  it('names the error on the whole relation list, not one on an issue inside another list', async (t) => {
    mockDetailsAndRelations(t, details, {
      data: { node: { content: null } },
      errors: [
        { type: 'FORBIDDEN', path: ['node', 'content', 'blockedBy', 'nodes', 0], message: 'no access' },
        { type: 'FORBIDDEN', path: ['node', 'content', 'relatesTo'], message: 'timeout' }
      ]
    });
    process.env.GITHUB_API_TOKEN = 'test-token';
    const item = await getItemByID('PVTI_1');
    assert.equal(item.relationsError, 'timeout');
  });

  it('takes an error on a list\'s pageInfo or totalCount for one on the whole list', async (t) => {
    mockDetailsAndRelations(t, details, {
      data: { node: { content: null } },
      errors: [
        { type: 'FORBIDDEN', path: ['node', 'content', 'blockedBy', 'nodes', 0], message: 'no access' },
        { type: 'INTERNAL', path: ['node', 'content', 'blocking', 'pageInfo'], message: 'timeout' }
      ]
    });
    process.env.GITHUB_API_TOKEN = 'test-token';
    const item = await getItemByID('PVTI_1');
    assert.equal(item.relationsError, 'timeout');
  });

  it('carries no relationsError for a pull request whose relations request fails', async (t) => {
    mockDetailsAndRelations(t, prDetails, {
      data: { node: null },
      errors: [{ type: 'INTERNAL', path: ['node'], message: 'timeout' }]
    });
    process.env.GITHUB_API_TOKEN = 'test-token';
    const item = await getItemByID('PVTI_1');
    assert.ok(!('relationsError' in item) && !('blockedBy' in item));
  });

  it('carries no relations for a pull request', async (t) => {
    mockDetailsAndRelations(t, prDetails, { data: { node: { content: { __typename: 'PullRequest' } } } });
    process.env.GITHUB_API_TOKEN = 'test-token';
    const item = await getItemByID('PVTI_1');
    assert.ok(!('blockedBy' in item) && !('relationsError' in item));
  });
});

describe('listItems - unreadable items', () => {
  it('drops items with null content or content without a title and counts them as hidden', async (t) => {
    const calls = [];
    const readable = makeItem();
    const nullContent = { id: 'item-2', fieldValues: { nodes: [] }, content: null };
    const noTitle = { id: 'item-3', fieldValues: { nodes: [] }, content: { __typename: 'Issue' } };
    mockGraphQLFetch(t, {
      node: { items: { totalCount: 3, nodes: [readable, nullContent, noTitle], pageInfo: { hasNextPage: false } } }
    }, calls);

    process.env.GITHUB_API_TOKEN = 'test-token';
    const result = await listItems({ boardId: 'board-1' });

    assert.equal(result.status, 'success');
    assert.deepEqual(result.data.map(e => e.id), ['item-1']);
    assert.equal(result.hidden, 2);
    assert.equal(result.totalCount, 3);
  });

  it('drops draft issues and pull requests without counting them as hidden', async (t) => {
    const calls = [];
    const draft = { id: 'item-2', fieldValues: { nodes: [] }, content: { __typename: 'DraftIssue' } };
    const pr = { id: 'item-3', fieldValues: { nodes: [] }, content: { __typename: 'PullRequest' } };
    mockGraphQLFetch(t, {
      node: { items: { totalCount: 3, nodes: [makeItem(), draft, pr], pageInfo: { hasNextPage: false } } }
    }, calls);

    process.env.GITHUB_API_TOKEN = 'test-token';
    const result = await listItems({ boardId: 'board-1' });

    assert.deepEqual(result.data.map(e => e.id), ['item-1']);
    assert.equal(result.hidden, 0);
    assert.equal(result.totalCount, 3);
  });

  it('reports hidden: 0 and passes GitHub totalCount through when every item is readable', async (t) => {
    const calls = [];
    mockGraphQLFetch(t, {
      node: { items: { totalCount: 1, nodes: [makeItem()], pageInfo: { hasNextPage: false } } }
    }, calls);

    process.env.GITHUB_API_TOKEN = 'test-token';
    const result = await listItems({ boardId: 'board-1' });

    assert.equal(result.hidden, 0);
    assert.equal(result.totalCount, 1);
    assert.equal(result.data.length, 1);
  });

  it('does not count items removed by the emptyFields filter as hidden', async (t) => {
    const withTeam = makeItem();
    withTeam.fieldValues.nodes = [{ name: 'Planeteers', field: { name: 'Team' } }];
    const fieldsResponse = {
      node: { fields: { nodes: [{ __typename: 'ProjectV2SingleSelectField', id: 'F_1', name: 'Team', options: [] }], pageInfo: { hasNextPage: false } } }
    };
    const itemsResponse = {
      node: { items: { totalCount: 3, nodes: [
        withTeam,
        { id: 'item-2', fieldValues: { nodes: [] }, content: null },
        { id: 'item-3', fieldValues: { nodes: [{ name: 'Planeteers', field: { name: 'Team' } }] }, content: null }
      ], pageInfo: { hasNextPage: false } } }
    };
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      const body = JSON.parse(init.body);
      const data = body.query.includes('GetProjectItems') ? itemsResponse : fieldsResponse;
      return {
        status: 200,
        url: 'https://api.github.com/graphql',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ data })
      };
    });

    process.env.GITHUB_API_TOKEN = 'test-token';
    const result = await listItems({ boardId: 'board-1', emptyFields: ['Team'] });

    assert.equal(result.status, 'success', result.error);
    assert.equal(result.data.length, 0);
    assert.equal(result.hidden, 1);
  });
});

describe('listItems - limit and paging', () => {
  it('asks for one page of limit items and reports the cut with the cursor to continue', async (t) => {
    const calls = [];
    mockGraphQLFetch(t, {
      node: { items: { totalCount: 2900, nodes: [makeItem()], pageInfo: { hasNextPage: true, endCursor: 'c1' } } }
    }, calls);

    process.env.GITHUB_API_TOKEN = 'test-token';
    const result = await listItems({ boardId: 'board-1', limit: 1 });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].variables.first, 1);
    assert.equal(result.status, 'success');
    assert.equal(result.data.length, 1);
    assert.equal(result.totalCount, 2900);
    assert.equal(result.truncated, true);
    assert.equal(result.nextCursor, 'c1');
  });

  it('reads whole pages and is never cut without a limit', async (t) => {
    const calls = [];
    mockGraphQLFetch(t, {
      node: { items: { totalCount: 1, nodes: [makeItem()], pageInfo: { hasNextPage: false, endCursor: 'c1' } } }
    }, calls);

    process.env.GITHUB_API_TOKEN = 'test-token';
    const result = await listItems({ boardId: 'board-1' });

    assert.equal(calls[0].variables.first, 100);
    assert.equal(result.truncated, false);
    assert.ok(!('nextCursor' in result), 'nextCursor is only given for a cut result');
  });

  it('continues from the given cursor', async (t) => {
    const calls = [];
    mockGraphQLFetch(t, {
      node: { items: { nodes: [], pageInfo: { hasNextPage: false } } }
    }, calls);

    process.env.GITHUB_API_TOKEN = 'test-token';
    await listItems({ boardId: 'board-1', limit: 5, after: 'c9' });

    assert.equal(calls[0].variables.after, 'c9');
  });

  it('does not count hidden items toward the limit and asks the next page for the rest', async (t) => {
    const calls = [];
    const second = makeItem();
    second.id = 'item-2';
    const pages = {
      start: { totalCount: 5, nodes: [{ id: 'item-h', fieldValues: { nodes: [] }, content: null }, makeItem()], pageInfo: { hasNextPage: true, endCursor: 'c2' } },
      c2: { totalCount: 5, nodes: [second], pageInfo: { hasNextPage: true, endCursor: 'c3' } }
    };
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body.variables);
      return {
        status: 200,
        url: 'https://api.github.com/graphql',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ data: { node: { items: pages[body.variables.after ?? 'start'] } } })
      };
    });

    process.env.GITHUB_API_TOKEN = 'test-token';
    const result = await listItems({ boardId: 'board-1', limit: 2 });

    assert.deepEqual(calls.map(c => [c.first, c.after ?? null]), [[2, null], [1, 'c2']]);
    assert.deepEqual(result.data.map(e => e.id), ['item-1', 'item-2']);
    assert.equal(result.hidden, 1);
    assert.equal(result.totalCount, 5);
    assert.equal(result.truncated, true);
    assert.equal(result.nextCursor, 'c3');
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

/**
 * Answer every GraphQL call by its operation: the board's fields, a page of
 * items, a page of item ids, or items by id. Records each request body.
 */
function mockBoardFetch(t, { fields = [], pages = {}, idPages = {}, itemsById = {}, dependencies = {} }, calls) {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    let data;
    if (body.query.includes('GetDependencyCounts')) {
      data = { nodes: body.variables.ids.map(id => ({ id, issueDependenciesSummary: dependencies[id] ?? { blockedBy: 0, blocking: 0 } })) };
    } else if (body.query.includes('GetProjectItemsById')) {
      data = { nodes: body.variables.ids.map(id => itemsById[id] ?? null) };
    } else if (body.query.includes('GetProjectItemIds')) {
      data = { node: { items: idPages[body.variables.after] } };
    } else if (body.query.includes('GetProjectItems')) {
      data = { node: { items: pages[body.variables.after ?? 'start'] ?? { nodes: [], pageInfo: { hasNextPage: false } } } };
    } else {
      data = { node: { fields: { nodes: fields, pageInfo: { hasNextPage: false } } } };
    }
    return {
      status: 200,
      url: 'https://api.github.com/graphql',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ data })
    };
  });
}

describe('listItems - a full read (#194)', () => {
  it('reads the pages after the first by id, in parallel, in board order', async (t) => {
    const item = id => ({ ...makeItem(), id });
    const calls = [];
    mockBoardFetch(t, {
      pages: { start: { totalCount: 5, nodes: [item('i1')], pageInfo: { hasNextPage: true, endCursor: 'c1' } } },
      idPages: {
        c1: { nodes: [{ id: 'i2' }, { id: 'i3' }], pageInfo: { hasNextPage: true, endCursor: 'c2' } },
        c2: { nodes: [{ id: 'i4' }, { id: 'gone' }, { id: 'hidden' }], pageInfo: { hasNextPage: false, endCursor: 'c3' } }
      },
      itemsById: {
        i2: item('i2'), i3: item('i3'), i4: item('i4'),
        hidden: { id: 'hidden', fieldValues: { nodes: [] }, content: null }
      }
    }, calls);

    process.env.GITHUB_API_TOKEN = 'test-token';
    const result = await listItems({ boardId: 'board-1', limit: 0, filters: {} });

    assert.equal(result.status, 'success', result.error);
    assert.deepEqual(result.data.map(e => e.id), ['i1', 'i2', 'i3', 'i4']);
    assert.equal(result.hidden, 1);
    assert.equal(result.totalCount, 5);
    assert.equal(result.truncated, false);
    const byId = calls.filter(c => c.query.includes('GetProjectItemsById')).map(c => c.variables.ids);
    assert.deepEqual(byId, [['i2', 'i3'], ['i4', 'gone', 'hidden']]);
    const walk = calls.filter(c => c.query.includes('GetProjectItemIds')).map(c => c.variables.after);
    assert.deepEqual(walk, ['c1', 'c2']);
  });

  it('carries the open dependency counts of items read by id', async (t) => {
    const item = (id, issueId) => ({ ...makeItem({ id: issueId }), id });
    const calls = [];
    mockBoardFetch(t, {
      pages: { start: { totalCount: 2, nodes: [item('i1', 'I_1')], pageInfo: { hasNextPage: true, endCursor: 'c1' } } },
      idPages: { c1: { nodes: [{ id: 'i2' }], pageInfo: { hasNextPage: false } } },
      itemsById: { i2: item('i2', 'I_2') },
      dependencies: { I_1: { blockedBy: 1, blocking: 0 }, I_2: { blockedBy: 0, blocking: 3 } }
    }, calls);

    process.env.GITHUB_API_TOKEN = 'test-token';
    const result = await listItems({ boardId: 'board-1', limit: 0 });

    assert.equal(result.status, 'success', result.error);
    assert.deepEqual(result.data.map(e => [e.id, e.openBlockedBy, e.openBlocking]), [['i1', 1, undefined], ['i2', undefined, 3]]);
    // One request per page read, each sent as soon as its page is read.
    const counted = calls.filter(c => c.query.includes('GetDependencyCounts')).map(c => c.variables.ids);
    assert.deepEqual(counted, [['I_1'], ['I_2']]);
  });

  it('reports an error when a read by id fails', async (t) => {
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      const body = JSON.parse(init.body);
      const data = body.query.includes('GetProjectItemIds')
        ? { node: { items: { nodes: [{ id: 'i2' }], pageInfo: { hasNextPage: false } } } }
        : { node: { items: { nodes: [makeItem()], pageInfo: { hasNextPage: true, endCursor: 'c1' } } } };
      const failed = body.query.includes('GetProjectItemsById');
      return {
        status: failed ? 502 : 200,
        url: 'https://api.github.com/graphql',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(failed ? { message: 'Bad gateway' } : { data })
      };
    });

    process.env.GITHUB_API_TOKEN = 'test-token';
    const result = await listItems({ boardId: 'board-1' });

    assert.equal(result.status, 'error');
  });
});

describe('listItems - a full read, failures (#194 review)', () => {
  function respond(body, status = 200) {
    return {
      status,
      url: 'https://api.github.com/graphql',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify(body)
    };
  }
  const firstPage = { data: { node: { items: { totalCount: 3, nodes: [makeItem()], pageInfo: { hasNextPage: true, endCursor: 'c1' } } } } };

  it('lists the others when an item is deleted between the walk and the read', async (t) => {
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      const body = JSON.parse(init.body);
      if (body.query.includes('GetProjectItemIds')) {
        return respond({ data: { node: { items: { nodes: [{ id: 'i2' }, { id: 'gone' }], pageInfo: { hasNextPage: false } } } } });
      }
      if (body.query.includes('GetProjectItemsById')) {
        return respond({
          data: { nodes: [{ ...makeItem(), id: 'i2' }, null] },
          errors: [{ type: 'NOT_FOUND', path: ['nodes', 1], message: 'Could not resolve to a node' }]
        });
      }
      return respond(firstPage);
    });

    process.env.GITHUB_API_TOKEN = 'test-token';
    const result = await listItems({ boardId: 'board-1' });

    assert.equal(result.status, 'success', result.error);
    assert.deepEqual(result.data.map(e => e.id), ['item-1', 'i2']);
  });

  it('asks for no dependency counts of pages read after a read failed', async (t) => {
    const counted = [];
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      const body = JSON.parse(init.body);
      if (body.query.includes('GetDependencyCounts')) {
        counted.push(...body.variables.ids);
        return respond({ data: { nodes: [] } });
      }
      if (body.query.includes('GetProjectItemIds')) {
        return respond({ data: { node: { items: { nodes: [{ id: 'fails' }, { id: 'later' }].slice(body.variables.after === 'c1' ? 0 : 1, body.variables.after === 'c1' ? 1 : 2), pageInfo: { hasNextPage: body.variables.after === 'c1', endCursor: 'c2' } } } } });
      }
      if (body.query.includes('GetProjectItemsById')) {
        if (body.variables.ids[0] === 'fails') return respond({ message: 'Bad gateway' }, 502);
        // This page arrives after the first read failed.
        await new Promise(resolve => setTimeout(resolve, 30));
        return respond({ data: { nodes: [{ ...makeItem({ id: 'I_later' }), id: 'later' }] } });
      }
      return respond({ data: { node: { items: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'c1' } } } } });
    });

    process.env.GITHUB_API_TOKEN = 'test-token';
    const result = await listItems({ boardId: 'board-1' });
    await new Promise(resolve => setTimeout(resolve, 60));

    assert.equal(result.status, 'error');
    assert.deepEqual(counted, []);
  });

  it('stops the walk and reports the error when a read fails while the walk goes on', async (t) => {
    const walked = [];
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      const body = JSON.parse(init.body);
      if (body.query.includes('GetProjectItemIds')) {
        walked.push(body.variables.after);
        // The next page of ids arrives after the read of this one failed.
        await new Promise(resolve => setTimeout(resolve, 20));
        const next = `c${walked.length + 1}`;
        return respond({ data: { node: { items: { nodes: [{ id: `i${walked.length}` }], pageInfo: { hasNextPage: walked.length < 5, endCursor: next } } } } });
      }
      if (body.query.includes('GetProjectItemsById')) {
        return respond({ message: 'Bad gateway' }, 502);
      }
      return respond(firstPage);
    });

    process.env.GITHUB_API_TOKEN = 'test-token';
    const result = await listItems({ boardId: 'board-1' });

    assert.equal(result.status, 'error');
    assert.ok(walked.length < 5, `walked ${walked.length} pages after a failed read`);
  });
});

describe('listItems - field filters of every type (#17), issue filters (#20) and exclude (#21)', () => {
  const fields = [
    { __typename: 'ProjectV2SingleSelectField', name: 'Status', dataType: 'SINGLE_SELECT', options: [{ id: 's1', name: 'Done ✅' }, { id: 's2', name: 'Inbox 📥' }, { id: 's3', name: '🔥' }] },
    { __typename: 'ProjectV2IterationField', name: 'Quarter', dataType: 'ITERATION', configuration: {
      iterations: [{ id: 'q4', title: 'Q4/2026' }],
      completedIterations: [{ id: 'q3', title: 'Q3/2026' }]
    } },
    { __typename: 'ProjectV2Field', name: 'Target Date', dataType: 'DATE' },
    { __typename: 'ProjectV2Field', name: 'Priority', dataType: 'NUMBER' },
    { __typename: 'ProjectV2Field', name: 'Note', dataType: 'TEXT' },
    { __typename: 'ProjectV2Field', name: 'Title', dataType: 'TITLE' },
    { __typename: 'ProjectV2Field', name: 'Labels', dataType: 'LABELS' },
    { __typename: 'ProjectV2Field', name: 'Repository', dataType: 'REPOSITORY' },
    { __typename: 'ProjectV2Field', name: 'Milestone', dataType: 'MILESTONE' }
  ];

  async function queryFor(t, options) {
    const calls = [];
    mockBoardFetch(t, { fields }, calls);
    process.env.GITHUB_API_TOKEN = 'test-token';
    const result = await listItems({ boardId: 'board-1', ...options });
    const listCall = calls.find(c => c.query.includes('GetProjectItems'));
    return { result, filterQuery: listCall?.variables.filterQuery };
  }

  const cases = [
    ['an iteration title, current or completed', { filters: { Quarter: 'q3/2026' } }, 'quarter:"Q3/2026"'],
    ['an iteration keyword', { filters: { Quarter: '@current' } }, 'quarter:@current'],
    ['a date comparison', { filters: { 'Target Date': '>2026-01-01' } }, 'target-date:>2026-01-01'],
    ['a number range', { filters: { Priority: '1..3' } }, 'priority:1..3'],
    ['a text value, quoted', { filters: { Note: 'needs review' } }, 'note:"needs review"'],
    ['single-select options for OR', { filters: { Status: 'done, inbox' } }, 'status:"Done ✅","Inbox 📥"'],
    ['an emoji-only option by its exact name', { filters: { Status: '🔥' } }, 'status:"🔥"'],
    ['a field standing for an issue attribute', { filters: { Milestone: 'CAPI RC' } }, 'milestone:"CAPI RC"'],
    ['milestone, type and parentIssue', { milestone: 'v1', type: 'Bug,Task', parentIssue: 'https://github.com/giantswarm/roadmap/issues/12' },
      'milestone:v1 type:Bug,Task parent-issue:giantswarm/roadmap#12'],
    ['an excluded field', { exclude: { Status: 'Done' } }, '-status:"Done ✅"'],
    ['an excluded issue filter, repository resolved', { exclude: { repository: 'roadmap', label: 'wontfix,needs info' } },
      '-repo:giantswarm/roadmap -label:wontfix,"needs info"'],
    ['nonEmptyFields', { nonEmptyFields: ['Quarter'] }, 'has:quarter'],
    ['comparisons without their whitespace', { updated: '2026-01-01 .. 2026-02-01', exclude: { 'Target Date': '> 2026-01-01' } },
      'updated:2026-01-01..2026-02-01 -target-date:>2026-01-01'],
    ['iteration keywords next to titles', { filters: { Quarter: 'Q3/2026,@current' } }, 'quarter:"Q3/2026",@current'],
    ['no term for a list without values', { assignee: ' , ', label: 'bug' }, 'label:bug'],
    ['no term for fields without values', { filters: { Status: ',', Quarter: ' , ' }, exclude: { Status: ',' }, label: 'bug' }, 'label:bug'],
    ['an issue filter name in any case', { exclude: { Label: 'wontfix' } }, '-label:wontfix']
  ];
  for (const [what, options, expected] of cases) {
    it(`sends ${what}`, async (t) => {
      const { result, filterQuery } = await queryFor(t, options);
      assert.equal(result.status, 'success', result.error);
      assert.equal(filterQuery, expected);
    });
  }

  const errors = [
    ['an unknown iteration', { filters: { Quarter: 'Q9' } }, /filters: iteration 'Q9' not found for field 'Quarter'. Available iterations: Q4\/2026, Q3\/2026/],
    ['an unknown option', { filters: { Status: 'Doing' } }, /filters: value 'Doing' not found for field 'Status'/],
    ['the title field', { filters: { Title: 'x' } }, /field 'Title' cannot be filtered on; use keyword/],
    ['an issue filter name under filters', { filters: { label: 'bug' } }, /filters: field 'label' not found/],
    ['punctuation that would match an emoji-only option', { filters: { Status: '!' } }, /value '!' not found for field 'Status'/],
    ['an inherited object key', { exclude: { constructor: 'x' } }, /exclude: field 'constructor' not found/],
    ['a misspelled iteration after a keyword', { filters: { Quarter: '@current,Q9' } }, /iteration 'Q9' not found/],
    ['an unknown exclude key', { exclude: { Nope: 'x' } }, /exclude: field 'Nope' not found.*or one of repository, assignee/],
    ['an unknown nonEmptyFields name', { nonEmptyFields: ['Nope'] }, /nonEmptyFields: field 'Nope' not found/],
    ['a parent issue that is no issue reference', { parentIssue: 'roadmap' }, /Issue reference/i]
  ];
  for (const [what, options, pattern] of errors) {
    it(`refuses ${what}`, async (t) => {
      const { result } = await queryFor(t, options);
      assert.equal(result.status, 'error');
      assert.match(result.error, pattern);
    });
  }
});
