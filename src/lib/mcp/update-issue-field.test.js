import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.GITHUB_API_TOKEN = 'test-token';

const { handleUpdateIssueField, tools } = await import('./tools.js');

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
    const mutation = calls[1];
    assert.match(mutation.query, /clearProjectV2ItemFieldValue/);
    assert.doesNotMatch(mutation.query, /updateProjectV2ItemFieldValue/);
    assert.strictEqual(mutation.variables.fieldId, 'PVTIF_quarter');
    assert.strictEqual(mutation.variables.value, undefined);
  });

  it('clears a single-select field via the clear mutation', async (t) => {
    const calls = mockGraphQLSequence(t, [
      fieldsPage([STATUS_FIELD]),
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

    const mutation = calls[1];
    assert.match(mutation.query, /clearProjectV2ItemFieldValue/);
    assert.strictEqual(mutation.variables.fieldId, 'PVTSSF_status');
  });

  it('returns a clean error when neither value nor clear is provided', async (t) => {
    mockGraphQLSequence(t, [fieldsPage([QUARTER_FIELD])]);

    const result = await handleUpdateIssueField({
      itemId: 'PVTI_x',
      fieldName: 'Quarter'
    });

    assert.ok(result.error, 'expected an error');
    assert.match(result.error, /value is required/i);
    assert.match(result.error, /clear: true/);
  });

  it('treats clear:false like a normal update and still requires a value', async (t) => {
    // Only the fields query should fire -- the missing-value guard returns
    // before any mutation, so no clear/update mutation response is queued.
    const calls = mockGraphQLSequence(t, [fieldsPage([QUARTER_FIELD])]);

    const result = await handleUpdateIssueField({
      itemId: 'PVTI_x',
      fieldName: 'Quarter',
      clear: false
    });

    assert.ok(result.error, 'expected an error');
    assert.match(result.error, /value is required/i);
    // No second GraphQL call -- clear:false did not trigger the clear path.
    assert.strictEqual(calls.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Separator-insensitive matching end-to-end (#123)
// ---------------------------------------------------------------------------

describe('handleUpdateIssueField separator matching (#123)', () => {
  it('resolves a slash-separated value against a space-separated iteration title', async (t) => {
    const calls = mockGraphQLSequence(t, [
      fieldsPage([QUARTER_FIELD]),
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

    const mutation = calls[1];
    assert.match(mutation.query, /updateProjectV2ItemFieldValue/);
    assert.deepStrictEqual(mutation.variables.value, { iterationId: 'iter-q4' });
  });
});
