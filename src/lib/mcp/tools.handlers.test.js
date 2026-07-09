/**
 * Handler-level integration tests for tools.js that require mocking
 * GraphQL-backed dependencies (../items.js, ../api.js) rather than just the
 * REST-only helpers in ../rest-api.js.
 *
 * Uses node:test's experimental module mocking (`node --experimental-test-
 * module-mocks`, enabled via the "test" script in package.json) because
 * tools.js imports `resolveItemIssues` and `graphQLWithAuth` as named bindings --
 * mock.module() must run BEFORE tools.js (and therefore its dependency
 * graph) is first imported, otherwise the already-resolved bindings inside
 * tools.js keep pointing at the real implementations. All mocks below are
 * therefore registered up front, with the per-test behavior swapped in via
 * mutable delegate variables that the mocked exports forward to.
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.GITHUB_API_TOKEN = 'test-token';

// ---------------------------------------------------------------------------
// Module-level mocks -- registered before tools.js is imported (see header).
// ---------------------------------------------------------------------------

const realItems = await import('../items.js');
let resolveItemIssuesImpl = async () => {
  throw new Error('resolveItemIssues not stubbed for this test');
};
mock.module(new URL('../items.js', import.meta.url).href, {
  exports: {
    ...realItems,
    resolveItemIssues: (...args) => resolveItemIssuesImpl(...args)
  }
});

const realApi = await import('../api.js');
let graphQLImpl = async (query) => {
  throw new Error(`graphQLWithAuth not stubbed for this test (query started: ${String(query).slice(0, 40)}...)`);
};
mock.module(new URL('../api.js', import.meta.url).href, {
  exports: {
    ...realApi,
    graphQLWithAuth: (...args) => graphQLImpl(...args)
  }
});

const { octokit } = await import('../rest-api.js');
const { REPO_ID_QUERY, CREATE_ISSUE_MUTATION, ADD_ITEM_TO_PROJECT_MUTATION } = await import('../project.js');
const { handleUpdateIssueLabels, handleCreateIssueInProject } = await import('./tools.js');

// ---------------------------------------------------------------------------
// handleUpdateIssueLabels: handler wiring
// ---------------------------------------------------------------------------

describe('handleUpdateIssueLabels (handler wiring)', () => {
  it('resolves owner/repo/number from resolveItemIssues, adds then removes in order, and swallows a remove-404', async (t) => {
    resolveItemIssuesImpl = async (itemIds) => new Map([[itemIds[0], {
      issueId: 'I_1',
      owner: 'giantswarm',
      repo: 'giantswarm',
      number: 42,
      isPrivate: false,
      nameWithOwner: 'giantswarm/giantswarm'
    }]]);

    const calls = [];
    t.mock.method(octokit.rest.issues, 'listLabelsOnIssue', async () => ({
      data: [{ name: 'keep-me' }, { name: 'to-remove' }]
    }));
    t.mock.method(octokit.rest.issues, 'getLabel', async () => ({ data: { name: 'new-label' } }));
    t.mock.method(octokit.rest.issues, 'addLabels', async (params) => {
      calls.push({ op: 'add', ...params });
      return { data: [] };
    });
    t.mock.method(octokit.rest.issues, 'removeLabel', async (params) => {
      calls.push({ op: 'remove', ...params });
      if (params.name === 'to-remove') {
        // Label is present -- real removal succeeds.
        return { data: [] };
      }
      // 'not-applied' is requested for removal but was never on the issue --
      // GitHub returns 404, which removeLabelFromIssue swallows as a no-op.
      const err = new Error('Not Found');
      err.status = 404;
      throw err;
    });

    const result = await handleUpdateIssueLabels({
      itemId: 'PVTI_xxx',
      addLabels: ['new-label'],
      removeLabels: ['to-remove', 'not-applied']
    });

    assert.ok(result.content, `expected success, got error: ${result.error}`);
    const payload = JSON.parse(result.content[0].text);

    assert.strictEqual(payload.success, true);
    assert.strictEqual(payload.repository, 'giantswarm/giantswarm');
    assert.strictEqual(payload.issueNumber, 42);
    assert.deepStrictEqual(payload.added, ['new-label']);

    // Ordering: the add call happens before any remove call.
    const opOrder = calls.map(c => c.op);
    assert.deepStrictEqual(opOrder, ['add', 'remove', 'remove']);

    // The 404 for 'not-applied' was swallowed (no throw), and 'to-remove'
    // was genuinely on the issue beforehand, so only it is reported as
    // effectively removed.
    assert.deepStrictEqual(payload.removed, ['to-remove']);
  });

  it('reports only effective additions when a requested label is already on the issue (case-insensitive)', async (t) => {
    resolveItemIssuesImpl = async (itemIds) => new Map([[itemIds[0], {
      issueId: 'I_1',
      owner: 'giantswarm',
      repo: 'giantswarm',
      number: 42,
      isPrivate: false,
      nameWithOwner: 'giantswarm/giantswarm'
    }]]);
    t.mock.method(octokit.rest.issues, 'listLabelsOnIssue', async () => ({
      data: [{ name: 'Keep-Me' }]
    }));

    let getLabelCalls = 0;
    let addLabelsCall = null;
    // Every requested label exists in the repo, so validation passes.
    t.mock.method(octokit.rest.issues, 'getLabel', async () => {
      getLabelCalls += 1;
      return { data: {} };
    });
    t.mock.method(octokit.rest.issues, 'addLabels', async (params) => {
      addLabelsCall = params;
      return { data: [] };
    });

    const result = await handleUpdateIssueLabels({
      itemId: 'PVTI_xxx',
      // 'keep-me' is already on the issue (differing only in case); GitHub
      // still receives the full requested set, but the response should only
      // report the label that was NOT already present.
      addLabels: ['keep-me', 'new-label']
    });

    assert.ok(result.content, `expected success, got error: ${result.error}`);
    const payload = JSON.parse(result.content[0].text);

    assert.strictEqual(payload.success, true);
    // Both requested labels are still sent to GitHub -- adding an
    // already-present label is a harmless no-op on GitHub's side.
    assert.deepStrictEqual(addLabelsCall.labels, ['keep-me', 'new-label']);
    // But only the genuinely new one is reported as an effective addition.
    assert.deepStrictEqual(payload.added, ['new-label']);
    assert.ok(getLabelCalls > 0);
  });

  it('resolves "Could not resolve the underlying issue" for a draft issue (unresolvable item)', async () => {
    resolveItemIssuesImpl = async (itemIds) => new Map([[itemIds[0], null]]);

    const result = await handleUpdateIssueLabels({
      itemId: 'PVTI_draft',
      addLabels: ['bug']
    });

    assert.ok(result.error);
    assert.match(result.error, /Could not resolve the underlying issue for item 'PVTI_draft'/);
  });
});

// ---------------------------------------------------------------------------
// handleCreateIssueInProject: repo-check ordering + label application
// ---------------------------------------------------------------------------

describe('handleCreateIssueInProject (handler wiring)', () => {
  it('checks repository existence before validating labels', async (t) => {
    t.mock.method(octokit.rest.issues, 'getLabel', async () => {
      throw new Error('findMissingLabels should not run before the repo check');
    });

    graphQLImpl = async (query) => {
      if (query === REPO_ID_QUERY) return { repository: null };
      throw new Error(`unexpected query in this test: ${query.slice(0, 40)}`);
    };

    const result = await handleCreateIssueInProject({
      repository: 'giantswarm/does-not-exist',
      title: 'Test issue',
      labels: ['bug']
    });

    assert.ok(result.error);
    assert.match(result.error, /Repository 'giantswarm\/does-not-exist' not found/);
    assert.strictEqual(octokit.rest.issues.getLabel.mock.calls.length, 0);
  });

  it('rejects non-existent labels (after the repo check passes) without creating an issue', async (t) => {
    t.mock.method(octokit.rest.issues, 'getLabel', async (params) => {
      if (params.name === 'bug') {
        return { data: { name: 'bug' } };
      }
      const err = new Error('Not Found');
      err.status = 404;
      throw err;
    });

    let createIssueCalled = false;
    graphQLImpl = async (query) => {
      if (query === REPO_ID_QUERY) return { repository: { id: 'R_1' } };
      if (query === CREATE_ISSUE_MUTATION) {
        createIssueCalled = true;
        throw new Error('should not create an issue when labels are invalid');
      }
      throw new Error(`unexpected query in this test: ${query.slice(0, 40)}`);
    };

    const result = await handleCreateIssueInProject({
      repository: 'giantswarm/giantswarm',
      title: 'Test issue',
      labels: ['bug', 'does-not-exist']
    });

    assert.ok(result.error);
    assert.match(result.error, /does-not-exist/);
    assert.strictEqual(octokit.rest.issues.getLabel.mock.calls.length, 2);
    assert.strictEqual(createIssueCalled, false);
  });

  it('applies validated labels via addLabelsToIssue after the issue is created and added to the board', async (t) => {
    t.mock.method(octokit.rest.issues, 'getLabel', async () => ({ data: { name: 'bug' } }));

    const addLabelsCalls = [];
    t.mock.method(octokit.rest.issues, 'addLabels', async (params) => {
      addLabelsCalls.push(params);
      return { data: [] };
    });

    graphQLImpl = async (query, vars) => {
      if (query === REPO_ID_QUERY) return { repository: { id: 'R_1' } };
      if (query === CREATE_ISSUE_MUTATION) {
        return { createIssue: { issue: { id: 'I_1', number: 99, url: 'https://github.com/giantswarm/giantswarm/issues/99', title: vars.title } } };
      }
      if (query === ADD_ITEM_TO_PROJECT_MUTATION) {
        return { addProjectV2ItemById: { item: { id: 'PVTI_1' } } };
      }
      throw new Error(`unexpected query in this test: ${query.slice(0, 40)}`);
    };

    const result = await handleCreateIssueInProject({
      repository: 'giantswarm/giantswarm',
      title: 'Test issue',
      labels: ['bug']
    });

    assert.ok(result.content, `expected success, got error: ${result.error}`);
    const payload = JSON.parse(result.content[0].text);
    assert.strictEqual(payload.success, true);
    assert.strictEqual(payload.issueNumber, 99);
    assert.deepStrictEqual(payload.labels, ['bug']);
    assert.strictEqual(payload.warning, undefined);

    assert.strictEqual(addLabelsCalls.length, 1);
    assert.deepStrictEqual(addLabelsCalls[0], {
      owner: 'giantswarm',
      repo: 'giantswarm',
      issue_number: 99,
      labels: ['bug']
    });
  });

  it('returns success with a warning (not an error) when label application fails after creation', async (t) => {
    t.mock.method(octokit.rest.issues, 'getLabel', async () => ({ data: { name: 'bug' } }));
    t.mock.method(octokit.rest.issues, 'addLabels', async () => {
      throw new Error('secondary rate limit exceeded');
    });

    graphQLImpl = async (query, vars) => {
      if (query === REPO_ID_QUERY) return { repository: { id: 'R_1' } };
      if (query === CREATE_ISSUE_MUTATION) {
        return { createIssue: { issue: { id: 'I_1', number: 100, url: 'https://github.com/giantswarm/giantswarm/issues/100', title: vars.title } } };
      }
      if (query === ADD_ITEM_TO_PROJECT_MUTATION) {
        return { addProjectV2ItemById: { item: { id: 'PVTI_2' } } };
      }
      throw new Error(`unexpected query in this test: ${query.slice(0, 40)}`);
    };

    const result = await handleCreateIssueInProject({
      repository: 'giantswarm/giantswarm',
      title: 'Test issue',
      labels: ['bug']
    });

    // The issue was created and added to the board -- this must NOT surface
    // as a top-level error (that would invite a caller to retry and create
    // a duplicate issue).
    assert.ok(result.content, `expected a success payload with a warning, got error: ${result.error}`);
    const payload = JSON.parse(result.content[0].text);
    assert.strictEqual(payload.success, true);
    assert.strictEqual(payload.issueNumber, 100);
    assert.strictEqual(payload.projectItemId, 'PVTI_2');
    // Labels were NOT actually applied, so they must not be echoed back as
    // if they were.
    assert.strictEqual(payload.labels, undefined);
    assert.match(payload.warning, /labels were not applied|applying labels failed/i);
    assert.match(payload.warning, /secondary rate limit exceeded/);
  });
});
