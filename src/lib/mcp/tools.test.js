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
