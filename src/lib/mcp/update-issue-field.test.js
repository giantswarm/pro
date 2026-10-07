import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.GITHUB_API_TOKEN = 'test-token';

const { handleUpdateIssueField, handleArchiveItem, tools } = await import('./tools.js');
const { BOARDS } = await import('../project.js');

function parseResult(result) {
  return JSON.parse(result.content[0].text);
}

/**
 * Mock global fetch (used internally by @octokit/graphql) with a queue of
 * GraphQL response bodies, returned in call order. Records the request
 * payloads (parsed) for assertions.
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

// A single fields-query page containing an iteration field ("Quarter") whose
// iteration titles use a space separator.
function fieldsPage(fields) {
  return {
    node: {
      fields: {
        nodes: fields,
        pageInfo: { hasNextPage: false, endCursor: null }
      }
    }
  };
}

const ROADMAP = BOARDS.roadmap;

// The board-item lookup response for an item on the roadmap board.
function boardItem(id = 'PVTI_x', { projectId = ROADMAP.id, projectNumber = ROADMAP.number, issue = { number: 142, repository: { nameWithOwner: 'giantswarm/kagent-upstream' } } } = {}) {
  return { node: { id, project: { id: projectId, number: projectNumber }, content: issue } };
}

const QUARTER_FIELD = {
  __typename: 'ProjectV2IterationField',
  id: 'PVTIF_quarter',
  name: 'Quarter',
  dataType: 'ITERATION',
  configuration: {
    duration: 90,
    startDay: 1,
    iterations: [
      { id: 'iter-q4', title: 'Q4 2026', duration: 90, startDate: '2026-10-01' }
    ]
  }
};

const STATUS_FIELD = {
  __typename: 'ProjectV2SingleSelectField',
  id: 'PVTSSF_status',
  name: 'Status',
  dataType: 'SINGLE_SELECT',
  options: [
    { id: 'opt-todo', name: 'Todo' },
    { id: 'opt-done', name: 'Done' }
  ]
};

// ---------------------------------------------------------------------------
// Tool schema
// ---------------------------------------------------------------------------

describe('update_issue_field tool schema (#124)', () => {
  const tool = tools.find(t => t.name === 'update_issue_field');

  it('no longer requires value (clearing needs only itemId + fieldName)', () => {
    assert.deepStrictEqual(tool.inputSchema.required, ['itemId', 'fieldName']);
  });

  it('exposes a boolean clear flag', () => {
    assert.strictEqual(tool.inputSchema.properties.clear.type, 'boolean');
  });
});

// ---------------------------------------------------------------------------
// Clear path (#124)
// ---------------------------------------------------------------------------

describe('handleUpdateIssueField clear path (#124)', () => {
  it('invokes the clear mutation, not the update mutation', async (t) => {
    const calls = mockGraphQLSequence(t, [
      fieldsPage([QUARTER_FIELD]),
      boardItem(),
      { clearProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_x' } } }
    ]);

    const result = await handleUpdateIssueField({
      itemId: 'PVTI_x',
      fieldName: 'Quarter',
      clear: true
    });

    const payload = parseResult(result);
    assert.strictEqual(payload.success, true);
    assert.strictEqual(payload.cleared, true);
    assert.strictEqual(payload.field, 'Quarter');

    // Second GraphQL call is the clear mutation, carrying the resolved field id
    // and no value input.
    const mutation = calls[2];
    assert.match(mutation.query, /clearProjectV2ItemFieldValue/);
    assert.doesNotMatch(mutation.query, /updateProjectV2ItemFieldValue/);
    assert.strictEqual(mutation.variables.fieldId, 'PVTIF_quarter');
    assert.strictEqual(mutation.variables.value, undefined);
  });

  it('clears a single-select field via the clear mutation', async (t) => {
    const calls = mockGraphQLSequence(t, [
      fieldsPage([STATUS_FIELD]),
      boardItem(),
      { clearProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_x' } } }
    ]);

    const result = await handleUpdateIssueField({
      itemId: 'PVTI_x',
      fieldName: 'Status',
      clear: true
    });

    const payload = parseResult(result);
    assert.strictEqual(payload.success, true);
    assert.strictEqual(payload.cleared, true);

    const mutation = calls[2];
    assert.match(mutation.query, /clearProjectV2ItemFieldValue/);
    assert.strictEqual(mutation.variables.fieldId, 'PVTSSF_status');
  });

  it('returns a clean error when neither value nor clear is provided', async (t) => {
    mockGraphQLSequence(t, [fieldsPage([QUARTER_FIELD]), boardItem()]);

    const result = await handleUpdateIssueField({
      itemId: 'PVTI_x',
      fieldName: 'Quarter'
    });

    assert.ok(result.error, 'expected an error');
    assert.match(result.error, /value is required/i);
    assert.match(result.error, /clear: true/);
  });

  it('treats clear:false like a normal update and still requires a value', async (t) => {
    // Only the fields and item lookups fire -- the missing-value guard returns
    // before any mutation, so no clear/update mutation response is queued.
    const calls = mockGraphQLSequence(t, [fieldsPage([QUARTER_FIELD]), boardItem()]);

    const result = await handleUpdateIssueField({
      itemId: 'PVTI_x',
      fieldName: 'Quarter',
      clear: false
    });

    assert.ok(result.error, 'expected an error');
    assert.match(result.error, /value is required/i);
    // Fields and item lookups only -- clear:false did not trigger the clear path.
    assert.strictEqual(calls.length, 2);
  });
});

// ---------------------------------------------------------------------------
// Separator-insensitive matching end-to-end (#123)
// ---------------------------------------------------------------------------

describe('handleUpdateIssueField separator matching (#123)', () => {
  it('resolves a slash-separated value against a space-separated iteration title', async (t) => {
    const calls = mockGraphQLSequence(t, [
      fieldsPage([QUARTER_FIELD]),
      boardItem(),
      { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_x' } } }
    ]);

    const result = await handleUpdateIssueField({
      itemId: 'PVTI_x',
      fieldName: 'Quarter',
      value: 'Q4/2026'
    });

    const payload = parseResult(result);
    assert.strictEqual(payload.success, true);
    assert.strictEqual(payload.value, 'Q4 2026');

    const mutation = calls[2];
    assert.match(mutation.query, /updateProjectV2ItemFieldValue/);
    assert.deepStrictEqual(mutation.variables.value, { iterationId: 'iter-q4' });
  });
});

// ---------------------------------------------------------------------------
// Named errors for a missing item or field (#178)
// ---------------------------------------------------------------------------

describe('handleUpdateIssueField named errors (#178)', () => {
  it('sets Status on an item of a fork repository resolved by its project item id', async (t) => {
    const calls = mockGraphQLSequence(t, [
      fieldsPage([STATUS_FIELD]),
      boardItem('PVTI_fork'),
      { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_fork' } } }
    ]);

    const result = await handleUpdateIssueField({ itemId: 'PVTI_fork', fieldName: 'Status', value: 'done' });

    const payload = parseResult(result);
    assert.strictEqual(payload.success, true);
    assert.strictEqual(payload.value, 'Done');
    assert.strictEqual(calls[1].variables.itemId, 'PVTI_fork');
    assert.deepStrictEqual(calls[2].variables.value, { singleSelectOptionId: 'opt-done' });
  });

  it('names a missing fieldName instead of throwing a TypeError', async (t) => {
    const calls = mockGraphQLSequence(t, []);

    const result = await handleUpdateIssueField({ itemId: 'PVTI_x', field: 'Status', value: 'Done' });

    assert.match(result.error, /^fieldName is required/);
    assert.match(result.error, /roadmap board \(#273\)/);
    assert.doesNotMatch(result.error, /toLowerCase/);
    assert.strictEqual(calls.length, 0);
  });

  it('names a missing itemId', async (t) => {
    mockGraphQLSequence(t, []);

    const result = await handleUpdateIssueField({ fieldName: 'Status', value: 'Done' });

    assert.match(result.error, /^itemId is required/);
  });

  it('names a field that is not on the board', async (t) => {
    const calls = mockGraphQLSequence(t, [fieldsPage([STATUS_FIELD])]);

    const result = await handleUpdateIssueField({ itemId: 'PVTI_x', fieldName: 'Stage', value: 'Alpha' });

    assert.match(result.error, /^Field 'Stage' not on the roadmap board \(#273\)/);
    assert.strictEqual(calls.length, 1);
  });

  it('skips a field node without a name instead of throwing', async (t) => {
    mockGraphQLSequence(t, [
      fieldsPage([{ __typename: 'ProjectV2Field' }, STATUS_FIELD]),
      boardItem(),
      { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_x' } } }
    ]);

    const result = await handleUpdateIssueField({ itemId: 'PVTI_x', fieldName: 'Status', value: 'Todo' });

    assert.strictEqual(parseResult(result).success, true);
  });

  it('names an item id that resolves to no project item, before any write', async (t) => {
    const calls = mockGraphQLSequence(t, [fieldsPage([STATUS_FIELD]), { node: null }]);

    const result = await handleUpdateIssueField({ itemId: 'PVTI_gone', fieldName: 'Status', value: 'Done' });

    assert.match(result.error, /^No item 'PVTI_gone' on the roadmap board \(#273\)/);
    assert.strictEqual(calls.length, 2);
  });

  it('names an item id GitHub answers with NOT_FOUND', async (t) => {
    let n = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      const body = n++ === 0
        ? { data: fieldsPage([STATUS_FIELD]) }
        : { data: { node: null }, errors: [{ type: 'NOT_FOUND', path: ['node'], message: "Could not resolve to a node with the global id of 'PVTI_bogus'" }] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    });

    const result = await handleUpdateIssueField({ itemId: 'PVTI_bogus', fieldName: 'Status', value: 'Done' });

    assert.match(result.error, /^No item 'PVTI_bogus' on the roadmap board \(#273\)/);
    assert.strictEqual(n, 2);
  });

  it('names the issue when its item belongs to another project', async (t) => {
    const calls = mockGraphQLSequence(t, [
      fieldsPage([STATUS_FIELD]),
      boardItem('PVTI_personal', {
        projectId: 'PVT_other',
        projectNumber: 7,
        issue: { number: 592, repository: { nameWithOwner: 'teemow/beekeeper' } }
      })
    ]);

    const result = await handleUpdateIssueField({ itemId: 'PVTI_personal', fieldName: 'Status', value: 'Done' });

    assert.strictEqual(result.error, "No item for teemow/beekeeper#592 on the roadmap board (#273): item 'PVTI_personal' belongs to project #7.");
    assert.strictEqual(calls.length, 2);
  });
});

describe('handleArchiveItem item lookup (#178)', () => {
  it('names an item that is not on the board instead of archiving', async (t) => {
    const calls = mockGraphQLSequence(t, [
      boardItem('PVTI_y', { projectId: BOARDS.roadmap.id, projectNumber: BOARDS.roadmap.number })
    ]);

    const result = await handleArchiveItem({ itemId: 'PVTI_y', board: 'customer' });

    assert.match(result.error, /^No item for giantswarm\/kagent-upstream#142 on the customer board \(#345\)/);
    assert.strictEqual(calls.length, 1);
  });
});
