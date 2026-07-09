import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.GITHUB_API_TOKEN = 'test-token';

const {
  parseIssueRef,
  resolveIssueId,
  findMissingLabels,
  addLabelsToIssue,
  removeLabelFromIssue,
  octokit
} = await import('./rest-api.js');

// ---------------------------------------------------------------------------
// parseIssueRef
// ---------------------------------------------------------------------------

describe('parseIssueRef', () => {
  it('parses a full GitHub URL', () => {
    assert.deepStrictEqual(
      parseIssueRef('https://github.com/giantswarm/roadmap/issues/42'),
      { owner: 'giantswarm', repo: 'roadmap', issue_number: 42 }
    );
  });

  it('parses a URL with trailing slash', () => {
    assert.deepStrictEqual(
      parseIssueRef('https://github.com/giantswarm/roadmap/issues/42/'),
      { owner: 'giantswarm', repo: 'roadmap', issue_number: 42 }
    );
  });

  it('parses an http URL', () => {
    assert.deepStrictEqual(
      parseIssueRef('http://github.com/org/repo/issues/1'),
      { owner: 'org', repo: 'repo', issue_number: 1 }
    );
  });

  it('parses a short ref', () => {
    assert.deepStrictEqual(
      parseIssueRef('giantswarm/roadmap#42'),
      { owner: 'giantswarm', repo: 'roadmap', issue_number: 42 }
    );
  });

  it('trims surrounding whitespace', () => {
    assert.deepStrictEqual(
      parseIssueRef('  giantswarm/roadmap#7  '),
      { owner: 'giantswarm', repo: 'roadmap', issue_number: 7 }
    );
  });

  it('throws on null', () => {
    assert.throws(() => parseIssueRef(null), {
      message: 'Issue reference must be a non-empty string'
    });
  });

  it('throws on empty string', () => {
    assert.throws(() => parseIssueRef(''), {
      message: 'Issue reference must be a non-empty string'
    });
  });

  it('throws on non-string input', () => {
    assert.throws(() => parseIssueRef(42), {
      message: 'Issue reference must be a non-empty string'
    });
  });

  it('throws on invalid format', () => {
    assert.throws(() => parseIssueRef('not-a-valid-ref'), /Invalid issue reference/);
  });

  it('throws on bare issue number (#42)', () => {
    assert.throws(() => parseIssueRef('#42'), /Invalid issue reference/);
  });

  it('throws on URL without issue number', () => {
    assert.throws(
      () => parseIssueRef('https://github.com/owner/repo/issues/'),
      /Invalid issue reference/
    );
  });
});

// ---------------------------------------------------------------------------
// resolveIssueId
// ---------------------------------------------------------------------------

describe('resolveIssueId', () => {
  const ISSUE_DATA = {
    id: 12345,
    number: 42,
    title: 'Test issue',
    html_url: 'https://github.com/giantswarm/roadmap/issues/42',
    state: 'open'
  };

  const EXPECTED = {
    id: 12345,
    number: 42,
    title: 'Test issue',
    state: 'open',
    html_url: 'https://github.com/giantswarm/roadmap/issues/42',
    repository: 'giantswarm/roadmap'
  };

  it('resolves from a URL string', async (t) => {
    t.mock.method(octokit.rest.issues, 'get', async () => ({ data: ISSUE_DATA }));

    const result = await resolveIssueId(
      'https://github.com/giantswarm/roadmap/issues/42'
    );

    assert.deepStrictEqual(result, EXPECTED);
    assert.deepStrictEqual(octokit.rest.issues.get.mock.calls[0].arguments[0], {
      owner: 'giantswarm',
      repo: 'roadmap',
      issue_number: 42
    });
  });

  it('resolves from a short ref', async (t) => {
    t.mock.method(octokit.rest.issues, 'get', async () => ({ data: ISSUE_DATA }));

    const result = await resolveIssueId('giantswarm/roadmap#42');

    assert.strictEqual(result.id, 12345);
    assert.strictEqual(result.repository, 'giantswarm/roadmap');
  });

  it('resolves from explicit owner/repo/issue_number', async (t) => {
    t.mock.method(octokit.rest.issues, 'get', async () => ({
      data: { ...ISSUE_DATA, id: 55555 }
    }));

    const result = await resolveIssueId('giantswarm', 'roadmap', 42);

    assert.strictEqual(result.id, 55555);
    assert.deepStrictEqual(octokit.rest.issues.get.mock.calls[0].arguments[0], {
      owner: 'giantswarm',
      repo: 'roadmap',
      issue_number: 42
    });
  });

  it('propagates API errors', async (t) => {
    t.mock.method(octokit.rest.issues, 'get', async () => {
      throw new Error('Not Found');
    });

    await assert.rejects(
      () => resolveIssueId('owner/repo#999'),
      { message: 'Not Found' }
    );
  });
});

// ---------------------------------------------------------------------------
// findMissingLabels
// ---------------------------------------------------------------------------

describe('findMissingLabels', () => {
  it('returns an empty array when all labels exist', async (t) => {
    t.mock.method(octokit.rest.issues, 'getLabel', async () => ({ data: { name: 'bug' } }));

    const missing = await findMissingLabels('o', 'r', ['bug', 'enhancement']);

    assert.deepStrictEqual(missing, []);
    assert.strictEqual(octokit.rest.issues.getLabel.mock.calls.length, 2);
  });

  it('reports names that 404', async (t) => {
    t.mock.method(octokit.rest.issues, 'getLabel', async (params) => {
      if (params.name === 'bug') {
        return { data: { name: 'bug' } };
      }
      const err = new Error('Not Found');
      err.status = 404;
      throw err;
    });

    const missing = await findMissingLabels('o', 'r', ['bug', 'does-not-exist']);

    assert.deepStrictEqual(missing, ['does-not-exist']);
  });

  it('propagates non-404 errors', async (t) => {
    t.mock.method(octokit.rest.issues, 'getLabel', async () => {
      const err = new Error('Server Error');
      err.status = 500;
      throw err;
    });

    await assert.rejects(
      () => findMissingLabels('o', 'r', ['bug']),
      { message: 'Server Error' }
    );
  });
});

// ---------------------------------------------------------------------------
// addLabelsToIssue
// ---------------------------------------------------------------------------

describe('addLabelsToIssue', () => {
  it('calls the addLabels REST endpoint with the given names', async (t) => {
    t.mock.method(octokit.rest.issues, 'addLabels', async () => ({
      data: [{ name: 'bug' }, { name: 'enhancement' }]
    }));

    const result = await addLabelsToIssue('o', 'r', 5, ['bug', 'enhancement']);

    assert.deepStrictEqual(result, [{ name: 'bug' }, { name: 'enhancement' }]);
    assert.deepStrictEqual(octokit.rest.issues.addLabels.mock.calls[0].arguments[0], {
      owner: 'o',
      repo: 'r',
      issue_number: 5,
      labels: ['bug', 'enhancement']
    });
  });
});

// ---------------------------------------------------------------------------
// removeLabelFromIssue
// ---------------------------------------------------------------------------

describe('removeLabelFromIssue', () => {
  it('calls the removeLabel REST endpoint', async (t) => {
    t.mock.method(octokit.rest.issues, 'removeLabel', async () => ({}));

    await removeLabelFromIssue('o', 'r', 5, 'bug');

    assert.deepStrictEqual(octokit.rest.issues.removeLabel.mock.calls[0].arguments[0], {
      owner: 'o',
      repo: 'r',
      issue_number: 5,
      name: 'bug'
    });
  });

  it('treats a 404 (label not on issue) as a no-op', async (t) => {
    t.mock.method(octokit.rest.issues, 'removeLabel', async () => {
      const err = new Error('Not Found');
      err.status = 404;
      throw err;
    });

    await assert.doesNotReject(() => removeLabelFromIssue('o', 'r', 5, 'bug'));
  });

  it('propagates non-404 errors', async (t) => {
    t.mock.method(octokit.rest.issues, 'removeLabel', async () => {
      const err = new Error('Server Error');
      err.status = 500;
      throw err;
    });

    await assert.rejects(
      () => removeLabelFromIssue('o', 'r', 5, 'bug'),
      { message: 'Server Error' }
    );
  });
});
