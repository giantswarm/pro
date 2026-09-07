import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.GITHUB_API_TOKEN = 'test-token';

const {
  listIssuesTool,
  KNOWN_LIST_PARAMS,
  handleCreateIssueInProject,
  handleUpdateIssueLabels,
  tools,
  toolHandlers
} = await import('./tools.js');

describe('listIssuesTool schema', () => {
  it('exposes created and closed date filter params', () => {
    assert.ok(listIssuesTool.inputSchema.properties.created, 'missing created property');
    assert.ok(listIssuesTool.inputSchema.properties.closed, 'missing closed property');
    assert.strictEqual(listIssuesTool.inputSchema.properties.created.type, 'string');
    assert.strictEqual(listIssuesTool.inputSchema.properties.closed.type, 'string');
  });

  it('every schema property is a known top-level list_issues param', () => {
    for (const key of Object.keys(listIssuesTool.inputSchema.properties)) {
      assert.ok(
        KNOWN_LIST_PARAMS.has(key),
        `schema property "${key}" is not in KNOWN_LIST_PARAMS -- it would be misrouted into filters`
      );
    }
  });

  it('KNOWN_LIST_PARAMS includes created and closed', () => {
    assert.ok(KNOWN_LIST_PARAMS.has('created'));
    assert.ok(KNOWN_LIST_PARAMS.has('closed'));
  });
});

// ---------------------------------------------------------------------------
// Export structure
// ---------------------------------------------------------------------------

describe('tools exports', () => {
  it('includes update_issue_labels in the tools array', () => {
    const names = tools.map(t => t.name);
    assert.ok(names.includes('update_issue_labels'));
  });

  it('has a handler for update_issue_labels', () => {
    assert.strictEqual(typeof toolHandlers.update_issue_labels, 'function');
  });

  it('every tool has a valid inputSchema', () => {
    for (const tool of tools) {
      assert.strictEqual(tool.inputSchema.type, 'object');
      assert.ok(tool.inputSchema.properties, `${tool.name} missing properties`);
    }
  });

  // The MCP annotations are what a client -- or muster's read-only toolset
  // preset, an annotation predicate -- uses to tell reads from writes. A tool
  // without them counts as a destructive write by the MCP defaults.
  const readOnlyTools = [
    'list_issues',
    'get_issue_details',
    'list_issue_comments',
    'list_sub_issues',
    'get_parent_issue',
    'get_issue_timeline',
    'get_board_schema',
    'get_item_by_issue'
  ];
  const additiveWrites = ['create_issue_in_project', 'add_existing_issue', 'add_sub_issue'];

  it('every tool declares readOnlyHint, destructiveHint and idempotentHint', () => {
    for (const tool of tools) {
      assert.ok(tool.annotations, `${tool.name} has no annotations`);
      for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint']) {
        assert.strictEqual(typeof tool.annotations[hint], 'boolean', `${tool.name} leaves ${hint} unset`);
      }
    }
  });

  it('exactly the read tools are readOnlyHint true, and none of them destructive', () => {
    const actual = tools.filter((t) => t.annotations.readOnlyHint).map((t) => t.name).sort();
    assert.deepStrictEqual(actual, [...readOnlyTools].sort());
    for (const tool of tools) {
      if (tool.annotations.readOnlyHint) {
        assert.strictEqual(tool.annotations.destructiveHint, false, `${tool.name} is read-only yet destructive`);
        assert.strictEqual(tool.annotations.idempotentHint, true, `${tool.name} is read-only yet not idempotent`);
      }
    }
  });

  it('writes are destructive unless they only add', () => {
    for (const tool of tools) {
      if (tool.annotations.readOnlyHint) continue;
      const additive = additiveWrites.includes(tool.name);
      assert.strictEqual(tool.annotations.destructiveHint, !additive, `${tool.name}: destructiveHint should be ${!additive}`);
    }
  });
});

// ---------------------------------------------------------------------------
// update_issue_labels: GraphQL-free precondition
// ---------------------------------------------------------------------------

describe('handleUpdateIssueLabels', () => {
  it('errors when neither addLabels nor removeLabels is provided', async () => {
    const result = await handleUpdateIssueLabels({ itemId: 'PVTI_xxx' });
    assert.ok(result.error);
    assert.match(result.error, /At least one of addLabels or removeLabels/);
  });

  it('errors when addLabels and removeLabels are both empty arrays', async () => {
    const result = await handleUpdateIssueLabels({ itemId: 'PVTI_xxx', addLabels: [], removeLabels: [] });
    assert.ok(result.error);
  });
});

// ---------------------------------------------------------------------------
// create_issue_in_project: labels validated before issue creation
// ---------------------------------------------------------------------------

describe('handleCreateIssueInProject label validation', () => {
  // NOTE: The case where the repository exists and labels are invalid is
  // covered in tools.handlers.test.js, which mocks graphQLWithAuth so the
  // REPO_ID_QUERY check (now run before label validation) can succeed.

  it('requires confirmPublicSafe before validating labels for giantswarm/roadmap', async () => {
    const result = await handleCreateIssueInProject({
      repository: 'giantswarm/roadmap',
      title: 'Test issue',
      labels: ['bug']
    });

    assert.ok(result.error);
    assert.match(result.error, /confirmPublicSafe/);
  });
});
