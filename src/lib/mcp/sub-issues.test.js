import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.GITHUB_API_TOKEN = 'test-token';

const { octokit } = await import('../rest-api.js');
const {
  handleListSubIssues,
  handleAddSubIssue,
  handleRemoveSubIssue,
  handleGetParentIssue,
  handleReprioritizeSubIssue,
  handleMigrateTaskList,
  extractIssueRef,
  subIssueTools,
  subIssueToolHandlers
} = await import('./sub-issues.js');

function parseResult(result) {
  return JSON.parse(result.content[0].text);
}

// ---------------------------------------------------------------------------
// Export structure
// ---------------------------------------------------------------------------

describe('subIssue exports', () => {
  it('exports 6 tool descriptors', () => {
    assert.strictEqual(subIssueTools.length, 6);
    assert.deepStrictEqual(subIssueTools.map(t => t.name), [
      'list_sub_issues',
      'add_sub_issue',
      'remove_sub_issue',
      'get_parent_issue',
      'reprioritize_sub_issue',
      'migrate_task_list_to_sub_issues'
    ]);
  });

  it('has a handler for every tool', () => {
    for (const tool of subIssueTools) {
      assert.strictEqual(typeof subIssueToolHandlers[tool.name], 'function');
    }
  });

  it('every tool has a valid inputSchema', () => {
    for (const tool of subIssueTools) {
      assert.strictEqual(tool.inputSchema.type, 'object');
      assert.ok(tool.inputSchema.properties, `${tool.name} missing properties`);
    }
  });
});

// ---------------------------------------------------------------------------
// list_sub_issues
// ---------------------------------------------------------------------------

describe('handleListSubIssues', () => {
  it('returns compact sub-issues for a URL', async (t) => {
    t.mock.method(octokit, 'request', async () => ({
      data: [
        {
          number: 1, title: 'Sub 1',
          html_url: 'https://github.com/o/r/issues/1',
          state: 'open',
          repository: { owner: { login: 'o' }, name: 'r' }
        },
        {
          number: 2, title: 'Sub 2',
          html_url: 'https://github.com/o/r/issues/2',
          state: 'closed',
          repository: { owner: { login: 'o' }, name: 'r' }
        }
      ]
    }));

    const result = await handleListSubIssues({
      issueUrl: 'https://github.com/o/r/issues/10'
    });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.count, 2);
    assert.strictEqual(parsed.sub_issues[0].number, 1);
    assert.strictEqual(parsed.sub_issues[0].repository, 'o/r');
    assert.strictEqual(parsed.sub_issues[1].state, 'closed');
  });

  it('accepts explicit owner/repo/issue_number', async (t) => {
    t.mock.method(octokit, 'request', async () => ({ data: [] }));

    const result = await handleListSubIssues({
      owner: 'o', repo: 'r', issue_number: 1
    });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.count, 0);
    assert.deepStrictEqual(parsed.sub_issues, []);
  });

  it('forwards pagination params', async (t) => {
    t.mock.method(octokit, 'request', async () => ({ data: [] }));

    await handleListSubIssues({
      owner: 'o', repo: 'r', issue_number: 1,
      per_page: 50, page: 3
    });

    const callArgs = octokit.request.mock.calls[0].arguments;
    assert.strictEqual(callArgs[1].per_page, 50);
    assert.strictEqual(callArgs[1].page, 3);
  });

  it('returns error when issue ref is missing', async () => {
    const result = await handleListSubIssues({});
    assert.ok(result.error);
  });
});

// ---------------------------------------------------------------------------
// add_sub_issue
// ---------------------------------------------------------------------------

describe('handleAddSubIssue', () => {
  it('adds by subIssueId without resolving', async (t) => {
    t.mock.method(octokit, 'request', async () => ({
      data: {
        number: 10, title: 'Parent',
        html_url: 'https://github.com/o/r/issues/10', state: 'open'
      }
    }));

    const result = await handleAddSubIssue({
      issueUrl: 'o/r#10', subIssueId: 99999
    });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.success, true);
    assert.strictEqual(parsed.parent.number, 10);

    const reqArgs = octokit.request.mock.calls[0].arguments;
    assert.ok(reqArgs[0].includes('POST'));
    assert.strictEqual(reqArgs[1].sub_issue_id, 99999);
    assert.strictEqual(reqArgs[1].replace_parent, false);
  });

  it('resolves subIssueUrl to integer ID', async (t) => {
    t.mock.method(octokit.rest.issues, 'get', async () => ({
      data: { id: 77777, number: 5, title: 'Child',
              html_url: 'https://github.com/o/r/issues/5', state: 'open' }
    }));
    t.mock.method(octokit, 'request', async () => ({
      data: { number: 10, title: 'Parent',
              html_url: 'https://github.com/o/r/issues/10', state: 'open' }
    }));

    const result = await handleAddSubIssue({
      issueUrl: 'o/r#10', subIssueUrl: 'o/r#5'
    });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.success, true);
    assert.strictEqual(
      octokit.request.mock.calls[0].arguments[1].sub_issue_id,
      77777
    );
  });

  it('errors when neither subIssueUrl nor subIssueId provided', async () => {
    const result = await handleAddSubIssue({ issueUrl: 'o/r#10' });
    assert.ok(result.error);
    assert.match(result.error, /subIssueUrl/);
  });

  it('passes replaceParent: true', async (t) => {
    t.mock.method(octokit, 'request', async () => ({
      data: { number: 10, title: 'P',
              html_url: 'https://github.com/o/r/issues/10', state: 'open' }
    }));

    await handleAddSubIssue({
      issueUrl: 'o/r#10', subIssueId: 1, replaceParent: true
    });

    assert.strictEqual(
      octokit.request.mock.calls[0].arguments[1].replace_parent,
      true
    );
  });
});

// ---------------------------------------------------------------------------
// remove_sub_issue
// ---------------------------------------------------------------------------

describe('handleRemoveSubIssue', () => {
  it('removes by subIssueId and uses DELETE endpoint', async (t) => {
    t.mock.method(octokit, 'request', async () => ({}));

    const result = await handleRemoveSubIssue({
      issueUrl: 'o/r#10', subIssueId: 99999
    });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.success, true);
    assert.strictEqual(parsed.removed, 99999);

    const reqArgs = octokit.request.mock.calls[0].arguments;
    assert.ok(reqArgs[0].includes('DELETE'));
    assert.strictEqual(reqArgs[1].sub_issue_id, 99999);
  });

  it('resolves subIssueUrl to integer ID', async (t) => {
    t.mock.method(octokit.rest.issues, 'get', async () => ({
      data: { id: 88888, number: 3, title: 'Child',
              html_url: 'https://github.com/o/r/issues/3', state: 'open' }
    }));
    t.mock.method(octokit, 'request', async () => ({}));

    await handleRemoveSubIssue({ issueUrl: 'o/r#10', subIssueUrl: 'o/r#3' });

    assert.strictEqual(
      octokit.request.mock.calls[0].arguments[1].sub_issue_id,
      88888
    );
  });

  it('errors when neither subIssueUrl nor subIssueId provided', async () => {
    const result = await handleRemoveSubIssue({ issueUrl: 'o/r#10' });
    assert.ok(result.error);
  });
});

// ---------------------------------------------------------------------------
// get_parent_issue
// ---------------------------------------------------------------------------

describe('handleGetParentIssue', () => {
  it('returns the parent issue', async (t) => {
    t.mock.method(octokit, 'request', async () => ({
      data: {
        number: 5, title: 'Parent',
        html_url: 'https://github.com/o/r/issues/5',
        state: 'open',
        repository: { owner: { login: 'o' }, name: 'r' }
      }
    }));

    const result = await handleGetParentIssue({ issueUrl: 'o/r#10' });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.parent.number, 5);
    assert.strictEqual(parsed.parent.title, 'Parent');
    assert.strictEqual(parsed.parent.repository, 'o/r');
  });

  it('returns null parent on 404', async (t) => {
    const err = new Error('Not Found');
    err.status = 404;
    t.mock.method(octokit, 'request', async () => { throw err; });

    const result = await handleGetParentIssue({ issueUrl: 'o/r#10' });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.parent, null);
  });

  it('returns error on non-404 failures', async (t) => {
    const err = new Error('Server Error');
    err.status = 500;
    t.mock.method(octokit, 'request', async () => { throw err; });

    const result = await handleGetParentIssue({ issueUrl: 'o/r#10' });
    assert.ok(result.error);
  });
});

// ---------------------------------------------------------------------------
// reprioritize_sub_issue
// ---------------------------------------------------------------------------

describe('handleReprioritizeSubIssue', () => {
  it('sends after_id when afterId is provided', async (t) => {
    t.mock.method(octokit, 'request', async () => ({}));

    const result = await handleReprioritizeSubIssue({
      issueUrl: 'o/r#10', subIssueId: 111, afterId: 222
    });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.success, true);
    const reqArgs = octokit.request.mock.calls[0].arguments[1];
    assert.strictEqual(reqArgs.sub_issue_id, 111);
    assert.strictEqual(reqArgs.after_id, 222);
    assert.strictEqual(reqArgs.before_id, undefined);
  });

  it('sends before_id when beforeId is provided', async (t) => {
    t.mock.method(octokit, 'request', async () => ({}));

    const result = await handleReprioritizeSubIssue({
      issueUrl: 'o/r#10', subIssueId: 111, beforeId: 333
    });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.success, true);
    assert.strictEqual(
      octokit.request.mock.calls[0].arguments[1].before_id,
      333
    );
  });

  it('resolves subIssueUrl and afterUrl to integer IDs', async (t) => {
    let getCalls = 0;
    t.mock.method(octokit.rest.issues, 'get', async () => {
      getCalls++;
      if (getCalls === 1) {
        return { data: { id: 111, number: 5, title: 'Sub', html_url: 'u', state: 'open' } };
      }
      return { data: { id: 222, number: 6, title: 'After', html_url: 'u', state: 'open' } };
    });
    t.mock.method(octokit, 'request', async () => ({}));

    const result = await handleReprioritizeSubIssue({
      issueUrl: 'o/r#10', subIssueUrl: 'o/r#5', afterUrl: 'o/r#6'
    });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.success, true);
    const reqArgs = octokit.request.mock.calls[0].arguments[1];
    assert.strictEqual(reqArgs.sub_issue_id, 111);
    assert.strictEqual(reqArgs.after_id, 222);
  });

  it('errors when no position anchor is specified', async () => {
    const result = await handleReprioritizeSubIssue({
      issueUrl: 'o/r#10', subIssueId: 111
    });
    assert.ok(result.error);
    assert.match(result.error, /afterUrl/);
  });

  it('errors when no sub-issue is specified', async () => {
    const result = await handleReprioritizeSubIssue({
      issueUrl: 'o/r#10', afterId: 222
    });
    assert.ok(result.error);
    assert.match(result.error, /subIssueUrl/);
  });
});

// ---------------------------------------------------------------------------
// extractIssueRef — pure parsing unit tests
// ---------------------------------------------------------------------------

describe('extractIssueRef', () => {
  const FB_OWNER = 'giantswarm';
  const FB_REPO = 'roadmap';

  // --- Bare references (entire text is the ref) ---

  it('bare full URL', () => {
    assert.deepStrictEqual(
      extractIssueRef('https://github.com/giantswarm/roadmap/issues/42', FB_OWNER, FB_REPO),
      { owner: 'giantswarm', repo: 'roadmap', issue_number: 42 }
    );
  });

  it('bare full URL with trailing slash', () => {
    assert.deepStrictEqual(
      extractIssueRef('https://github.com/o/r/issues/1/', FB_OWNER, FB_REPO),
      { owner: 'o', repo: 'r', issue_number: 1 }
    );
  });

  it('bare short ref', () => {
    assert.deepStrictEqual(
      extractIssueRef('giantswarm/roadmap#42', FB_OWNER, FB_REPO),
      { owner: 'giantswarm', repo: 'roadmap', issue_number: 42 }
    );
  });

  it('bare same-repo ref', () => {
    assert.deepStrictEqual(
      extractIssueRef('#3932', FB_OWNER, FB_REPO),
      { owner: 'giantswarm', repo: 'roadmap', issue_number: 3932 }
    );
  });

  it('bare same-repo ref with trailing whitespace', () => {
    assert.deepStrictEqual(
      extractIssueRef('#3932 ', FB_OWNER, FB_REPO),
      { owner: 'giantswarm', repo: 'roadmap', issue_number: 3932 }
    );
  });

  // --- Embedded URLs in descriptive text (real pattern from roadmap #4001) ---

  it('URL after descriptive text and colon', () => {
    const text = '`flux-operator` needs to be GA on our MCs: https://github.com/giantswarm/giantswarm/issues/34462';
    assert.deepStrictEqual(
      extractIssueRef(text, FB_OWNER, FB_REPO),
      { owner: 'giantswarm', repo: 'giantswarm', issue_number: 34462 }
    );
  });

  it('URL at end of sentence', () => {
    const text = 'Depends on https://github.com/giantswarm/roadmap/issues/100';
    assert.deepStrictEqual(
      extractIssueRef(text, FB_OWNER, FB_REPO),
      { owner: 'giantswarm', repo: 'roadmap', issue_number: 100 }
    );
  });

  it('URL embedded in middle of text', () => {
    const text = 'See https://github.com/o/r/issues/5 for details';
    assert.deepStrictEqual(
      extractIssueRef(text, FB_OWNER, FB_REPO),
      { owner: 'o', repo: 'r', issue_number: 5 }
    );
  });

  // --- Markdown links (real pattern from roadmap #4251) ---

  it('markdown link to issue URL', () => {
    const text = 'Only show AI buttons if installation has mcp-kubernetes ([roadmap#4226](https://github.com/giantswarm/roadmap/issues/4226))';
    assert.deepStrictEqual(
      extractIssueRef(text, FB_OWNER, FB_REPO),
      { owner: 'giantswarm', repo: 'roadmap', issue_number: 4226 }
    );
  });

  it('markdown link without surrounding text', () => {
    const text = '[roadmap#4226](https://github.com/giantswarm/roadmap/issues/4226)';
    assert.deepStrictEqual(
      extractIssueRef(text, FB_OWNER, FB_REPO),
      { owner: 'giantswarm', repo: 'roadmap', issue_number: 4226 }
    );
  });

  it('markdown link to repo (not issue) returns null', () => {
    const text = '[exception-recommender](https://github.com/giantswarm/exception-recommender)';
    assert.strictEqual(
      extractIssueRef(text, FB_OWNER, FB_REPO),
      null
    );
  });

  it('markdown link to a PR (not issue) returns null', () => {
    const text = '[giantswarm/releases#2215](https://github.com/giantswarm/releases/pull/2215)';
    assert.strictEqual(
      extractIssueRef(text, FB_OWNER, FB_REPO),
      null
    );
  });

  // --- Embedded short refs ---

  it('short ref embedded in parenthetical text', () => {
    const text = 'Parent issue (giantswarm/roadmap#4180)';
    assert.deepStrictEqual(
      extractIssueRef(text, FB_OWNER, FB_REPO),
      { owner: 'giantswarm', repo: 'roadmap', issue_number: 4180 }
    );
  });

  // --- Things that should return null ---

  it('plain task text with no ref', () => {
    assert.strictEqual(
      extractIssueRef('Specify how to deploy a bundle', FB_OWNER, FB_REPO),
      null
    );
  });

  it('task with backticks and em-dash (no ref)', () => {
    assert.strictEqual(
      extractIssueRef('`cloud-provider-aws` — updated for Kubernetes in v35.0.0', FB_OWNER, FB_REPO),
      null
    );
  });

  it('task starting with extra dash', () => {
    assert.strictEqual(
      extractIssueRef('- Build a clear picture of how tests are failing', FB_OWNER, FB_REPO),
      null
    );
  });

  it('empty string', () => {
    assert.strictEqual(extractIssueRef('', FB_OWNER, FB_REPO), null);
  });

  it('whitespace only', () => {
    assert.strictEqual(extractIssueRef('   ', FB_OWNER, FB_REPO), null);
  });

  it('same-repo ref without fallback owner/repo returns null', () => {
    assert.strictEqual(extractIssueRef('#123', undefined, undefined), null);
  });

  it('http (not https) URL', () => {
    assert.deepStrictEqual(
      extractIssueRef('http://github.com/o/r/issues/7', FB_OWNER, FB_REPO),
      { owner: 'o', repo: 'r', issue_number: 7 }
    );
  });

  it('URL with query params should still match', () => {
    const text = 'See https://github.com/o/r/issues/5?utm_source=foo for details';
    const ref = extractIssueRef(text, FB_OWNER, FB_REPO);
    assert.ok(ref);
    assert.strictEqual(ref.issue_number, 5);
  });

  it('short ref with hyphens and dots in owner/repo', () => {
    assert.deepStrictEqual(
      extractIssueRef('my-org/my.repo#99', FB_OWNER, FB_REPO),
      { owner: 'my-org', repo: 'my.repo', issue_number: 99 }
    );
  });

  // --- Strikethrough handling (real pattern from giantswarm/giantswarm#35988) ---

  it('strikethrough-wrapped short ref', () => {
    const text = '~~giantswarm/klaus-operator#57 -- Mount personality SOUL.md~~';
    assert.deepStrictEqual(
      extractIssueRef(text, FB_OWNER, FB_REPO),
      { owner: 'giantswarm', repo: 'klaus-operator', issue_number: 57 }
    );
  });

  it('strikethrough ref with trailing markdown link to different issue', () => {
    const text = '~~giantswarm/klaus-operator#57 -- Mount personality SOUL.md at `/etc/klaus/SOUL.md` via SubPath~~ (PR #59 merged but SubPath does not work with image volumes -- [kubernetes/kubernetes#134894](https://github.com/kubernetes/kubernetes/issues/134894))';
    const ref = extractIssueRef(text, FB_OWNER, FB_REPO);
    assert.ok(ref, 'should extract a ref');
    assert.strictEqual(ref.owner, 'giantswarm');
    assert.strictEqual(ref.repo, 'klaus-operator');
    assert.strictEqual(ref.issue_number, 57, 'should prefer the strikethrough ref over the trailing markdown link');
  });

  it('strikethrough-wrapped same-repo ref', () => {
    assert.deepStrictEqual(
      extractIssueRef('~~#42~~', FB_OWNER, FB_REPO),
      { owner: 'giantswarm', repo: 'roadmap', issue_number: 42 }
    );
  });

  // --- Comma-separated refs (real pattern from giantswarm/giantswarm#35953) ---

  it('short ref followed by comma', () => {
    const text = 'coding: teemow/spiffy-personalities#59, klaus-dev: teemow/spiffy-personalities#62';
    const ref = extractIssueRef(text, FB_OWNER, FB_REPO);
    assert.ok(ref, 'should match at least one ref');
    assert.strictEqual(ref.owner, 'teemow');
    assert.strictEqual(ref.repo, 'spiffy-personalities');
    assert.ok([59, 62].includes(ref.issue_number), 'should match one of the refs');
  });

  // --- Descriptive text with refs (real patterns from Team AI epics) ---

  it('short ref after "Close" prefix', () => {
    const text = 'Close giantswarm/klaus-operator#31 -- Adapt to klaus-oci library redesign';
    assert.deepStrictEqual(
      extractIssueRef(text, FB_OWNER, FB_REPO),
      { owner: 'giantswarm', repo: 'klaus-operator', issue_number: 31 }
    );
  });

  it('short ref at start with " -- description" suffix', () => {
    const text = 'giantswarm/klaus-operator#46 -- Add prompt_instance and get_result MCP tools';
    assert.deepStrictEqual(
      extractIssueRef(text, FB_OWNER, FB_REPO),
      { owner: 'giantswarm', repo: 'klaus-operator', issue_number: 46 }
    );
  });

  it('same-repo ref in parenthetical with tracked-as prefix', () => {
    const text = 'Disable Aliyun mirror push in klaus/muster ecosystem (tracked as #35971, in parallel)';
    const ref = extractIssueRef(text, 'giantswarm', 'giantswarm');
    assert.ok(ref);
    assert.strictEqual(ref.issue_number, 35971);
    assert.strictEqual(ref.owner, 'giantswarm');
    assert.strictEqual(ref.repo, 'giantswarm');
  });

  it('short ref in parenthetical at end of text', () => {
    const text = 'Marge agents should proactively rebase after merging sibling PRs (#36001)';
    const ref = extractIssueRef(text, 'giantswarm', 'giantswarm');
    assert.ok(ref);
    assert.strictEqual(ref.issue_number, 36001);
  });

  it('cross-repo ref embedded in descriptive text', () => {
    const text = 'Move downstream dispatch from CircleCI to GitHub Actions (giantswarm/klaus#118)';
    assert.deepStrictEqual(
      extractIssueRef(text, FB_OWNER, FB_REPO),
      { owner: 'giantswarm', repo: 'klaus', issue_number: 118 }
    );
  });

  it('markdown link to issue with description suffix', () => {
    const text = '[Analyze AuthN/AuthZ for MCP Servers](https://github.com/giantswarm/project-alpha/issues/1) -- OAuth 2.1 implemented (30h)';
    assert.deepStrictEqual(
      extractIssueRef(text, FB_OWNER, FB_REPO),
      { owner: 'giantswarm', repo: 'project-alpha', issue_number: 1 }
    );
  });

  it('acceptance criteria ref at end of text', () => {
    const text = 'pro exposes MCP tools for sub-issue CRUD -- giantswarm/pro#33';
    assert.deepStrictEqual(
      extractIssueRef(text, FB_OWNER, FB_REPO),
      { owner: 'giantswarm', repo: 'pro', issue_number: 33 }
    );
  });

  it('bare ref "closed, replaced by env var approach below" (no ref, just text)', () => {
    const text = 'giantswarm/klaus-operator#58 -- closed, replaced by env var approach below';
    assert.deepStrictEqual(
      extractIssueRef(text, FB_OWNER, FB_REPO),
      { owner: 'giantswarm', repo: 'klaus-operator', issue_number: 58 }
    );
  });

  it('same-repo ref without parens: "-- #36031"', () => {
    const text = 'Model selection decision for May demo (by March 17) -- #36031';
    const ref = extractIssueRef(text, 'giantswarm', 'giantswarm');
    assert.ok(ref);
    assert.strictEqual(ref.issue_number, 36031);
  });

  it('teemow/ namespace ref (non-giantswarm owner)', () => {
    const text = 'teemow/spiffy-plugins#82 -- Direct-to-main pushes (Done)';
    assert.deepStrictEqual(
      extractIssueRef(text, FB_OWNER, FB_REPO),
      { owner: 'teemow', repo: 'spiffy-plugins', issue_number: 82 }
    );
  });

  it('"depends on #N" pattern', () => {
    const text = 'Roll out CLAUDE.md across all ecosystem repos (depends on creator plugin)';
    assert.strictEqual(
      extractIssueRef(text, FB_OWNER, FB_REPO),
      null,
      'no issue ref in this text'
    );
  });

  it('"PR #N" is not an issue ref', () => {
    const text = 'Enhance get_instance with agent-level status querying (PR #60)';
    const ref = extractIssueRef(text, 'giantswarm', 'giantswarm');
    assert.strictEqual(ref.issue_number, 60, 'PR #60 gets treated as same-repo ref');
  });
});

// ---------------------------------------------------------------------------
// migrate_task_list_to_sub_issues
// ---------------------------------------------------------------------------

describe('handleMigrateTaskList', () => {
  it('converts URL task items to sub-issues', async (t) => {
    const body = [
      '## Tasks',
      '- [ ] https://github.com/o/r/issues/1',
      '- [x] https://github.com/o/r/issues/2',
      'Some other text'
    ].join('\n');

    let getCalls = 0;
    t.mock.method(octokit.rest.issues, 'get', async () => {
      getCalls++;
      if (getCalls === 1) return { data: { body } };
      if (getCalls === 2) return { data: { id: 1001, number: 1, title: 'Issue 1', html_url: 'https://github.com/o/r/issues/1', state: 'open' } };
      return { data: { id: 1002, number: 2, title: 'Issue 2', html_url: 'https://github.com/o/r/issues/2', state: 'closed' } };
    });
    t.mock.method(octokit, 'request', async () => ({}));

    const result = await handleMigrateTaskList({ issueUrl: 'o/r#10' });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.converted.length, 2);
    assert.strictEqual(parsed.failed.length, 0);
    assert.strictEqual(parsed.skipped.length, 0);
    assert.strictEqual(parsed.converted[0].number, 1);
    assert.strictEqual(parsed.converted[1].number, 2);
  });

  it('converts short refs and same-repo refs', async (t) => {
    const body = [
      '- [ ] org/other-repo#5',
      '- [ ] #3'
    ].join('\n');

    let getCalls = 0;
    t.mock.method(octokit.rest.issues, 'get', async () => {
      getCalls++;
      if (getCalls === 1) return { data: { body } };
      if (getCalls === 2) return { data: { id: 2001, number: 5, title: 'Cross-repo', html_url: 'https://github.com/org/other-repo/issues/5', state: 'open' } };
      return { data: { id: 2002, number: 3, title: 'Same repo', html_url: 'https://github.com/o/r/issues/3', state: 'open' } };
    });
    t.mock.method(octokit, 'request', async () => ({}));

    const result = await handleMigrateTaskList({ owner: 'o', repo: 'r', issue_number: 10 });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.converted.length, 2);
    assert.strictEqual(parsed.converted[0].repository, 'org/other-repo');
    assert.strictEqual(parsed.converted[1].repository, 'o/r');
  });

  it('skips non-issue task items', async (t) => {
    const body = [
      '- [ ] Some regular task',
      '- [x] Another task without URL'
    ].join('\n');

    t.mock.method(octokit.rest.issues, 'get', async () => ({ data: { body } }));

    const result = await handleMigrateTaskList({ issueUrl: 'o/r#10' });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.converted.length, 0);
    assert.strictEqual(parsed.skipped.length, 2);
    assert.strictEqual(parsed.skipped[0].reason, 'not an issue reference');
  });

  it('removes converted lines when removeTaskList is true', async (t) => {
    const body = [
      '## Tasks',
      '- [ ] https://github.com/o/r/issues/1',
      'Remaining text'
    ].join('\n');

    let getCalls = 0;
    t.mock.method(octokit.rest.issues, 'get', async () => {
      getCalls++;
      if (getCalls === 1) return { data: { body } };
      return { data: { id: 1001, number: 1, title: 'Issue 1', html_url: 'https://github.com/o/r/issues/1', state: 'open' } };
    });
    t.mock.method(octokit, 'request', async () => ({}));
    t.mock.method(octokit.rest.issues, 'update', async () => ({}));

    await handleMigrateTaskList({ issueUrl: 'o/r#10', removeTaskList: true });

    assert.strictEqual(octokit.rest.issues.update.mock.callCount(), 1);
    const updateBody = octokit.rest.issues.update.mock.calls[0].arguments[0].body;
    assert.strictEqual(updateBody, '## Tasks\nRemaining text');
  });

  it('does not update body when removeTaskList is false', async (t) => {
    const body = '- [ ] https://github.com/o/r/issues/1';

    let getCalls = 0;
    t.mock.method(octokit.rest.issues, 'get', async () => {
      getCalls++;
      if (getCalls === 1) return { data: { body } };
      return { data: { id: 1001, number: 1, title: 'I', html_url: 'u', state: 'open' } };
    });
    t.mock.method(octokit, 'request', async () => ({}));
    t.mock.method(octokit.rest.issues, 'update', async () => ({}));

    await handleMigrateTaskList({ issueUrl: 'o/r#10' });

    assert.strictEqual(octokit.rest.issues.update.mock.callCount(), 0);
  });

  it('reports failures for individual issue resolutions', async (t) => {
    const body = '- [ ] https://github.com/o/r/issues/999';

    let getCalls = 0;
    t.mock.method(octokit.rest.issues, 'get', async () => {
      getCalls++;
      if (getCalls === 1) return { data: { body } };
      throw new Error('Not Found');
    });

    const result = await handleMigrateTaskList({ issueUrl: 'o/r#10' });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.converted.length, 0);
    assert.strictEqual(parsed.failed.length, 1);
    assert.match(parsed.failed[0].error, /Not Found/);
  });

  it('handles empty body gracefully', async (t) => {
    t.mock.method(octokit.rest.issues, 'get', async () => ({
      data: { body: '' }
    }));

    const result = await handleMigrateTaskList({ issueUrl: 'o/r#10' });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.converted.length, 0);
    assert.strictEqual(parsed.failed.length, 0);
    assert.strictEqual(parsed.skipped.length, 0);
  });

  it('handles null body gracefully', async (t) => {
    t.mock.method(octokit.rest.issues, 'get', async () => ({
      data: { body: null }
    }));

    const result = await handleMigrateTaskList({ issueUrl: 'o/r#10' });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.converted.length, 0);
  });

  it('includes a summary string in the result', async (t) => {
    const body = [
      '- [ ] https://github.com/o/r/issues/1',
      '- [ ] some task'
    ].join('\n');

    let getCalls = 0;
    t.mock.method(octokit.rest.issues, 'get', async () => {
      getCalls++;
      if (getCalls === 1) return { data: { body } };
      return { data: { id: 1001, number: 1, title: 'I', html_url: 'u', state: 'open' } };
    });
    t.mock.method(octokit, 'request', async () => ({}));

    const result = await handleMigrateTaskList({ issueUrl: 'o/r#10' });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.summary, '1 converted, 0 failed, 1 skipped');
  });
});

// ---------------------------------------------------------------------------
// Real-world issue body scenarios (patterns observed in giantswarm/roadmap)
// ---------------------------------------------------------------------------

describe('handleMigrateTaskList — real-world patterns', () => {
  function makeIssueMock(body) {
    let nextId = 5000;
    return async (args) => {
      if (!args.issue_number || args.issue_number === 10) {
        return { data: { body } };
      }
      nextId++;
      return {
        data: {
          id: nextId,
          number: args.issue_number,
          title: `Issue ${args.issue_number}`,
          html_url: `https://github.com/${args.owner}/${args.repo}/issues/${args.issue_number}`,
          state: 'open'
        }
      };
    };
  }

  it('handles URL after descriptive text (roadmap #4001 pattern)', async (t) => {
    const body = [
      'To make this feature available, we need the following changes:',
      '- [ ] `flux-operator` needs to be GA on our MCs: https://github.com/giantswarm/giantswarm/issues/34462',
      '- [ ] `cluster-*` apps have to be converted to HelmReleases'
    ].join('\n');

    t.mock.method(octokit.rest.issues, 'get', makeIssueMock(body));
    t.mock.method(octokit, 'request', async () => ({}));

    const result = await handleMigrateTaskList({ owner: 'giantswarm', repo: 'roadmap', issue_number: 10 });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.converted.length, 1);
    assert.strictEqual(parsed.converted[0].repository, 'giantswarm/giantswarm');
    assert.strictEqual(parsed.skipped.length, 1);
    assert.match(parsed.skipped[0].text, /cluster/);
  });

  it('handles mixed bare refs and bare URLs (roadmap #3984 pattern)', async (t) => {
    const body = [
      'https://github.com/giantswarm/honeybadger-notepad/blob/main/design-notes/2025-app-platform-changes.md',
      '',
      '- [x] #3932 ',
      '- [x] https://github.com/giantswarm/giantswarm/issues/32678',
      '- [x] https://github.com/giantswarm/roadmap/issues/3946',
      '- [x] https://github.com/giantswarm/giantswarm/issues/33228',
      '- [x] https://github.com/giantswarm/giantswarm/issues/33238'
    ].join('\n');

    t.mock.method(octokit.rest.issues, 'get', makeIssueMock(body));
    t.mock.method(octokit, 'request', async () => ({}));

    const result = await handleMigrateTaskList({ owner: 'giantswarm', repo: 'roadmap', issue_number: 10 });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.converted.length, 5);
    assert.strictEqual(parsed.skipped.length, 0);
    assert.strictEqual(parsed.converted[0].repository, 'giantswarm/roadmap');
    assert.strictEqual(parsed.converted[1].repository, 'giantswarm/giantswarm');
  });

  it('handles markdown-linked issue refs (roadmap #4251 pattern)', async (t) => {
    const body = [
      '### UX and reliability',
      '- [ ] Only show AI buttons if installation has mcp-kubernetes ([roadmap#4226](https://github.com/giantswarm/roadmap/issues/4226))',
      '- [ ] Ensure chat agent produces correct links ([roadmap#4225](https://github.com/giantswarm/roadmap/issues/4225))',
      '- [ ] Naming and visual identity for LLM chat ([roadmap#4183](https://github.com/giantswarm/roadmap/issues/4183))',
      '',
      '### Infrastructure',
      '- [ ] Fix config validation logic to avoid false Sentry warnings',
      '- [ ] Connect portal LLM chat with search-mcp for docs access ([roadmap#4171](https://github.com/giantswarm/roadmap/issues/4171))'
    ].join('\n');

    t.mock.method(octokit.rest.issues, 'get', makeIssueMock(body));
    t.mock.method(octokit, 'request', async () => ({}));

    const result = await handleMigrateTaskList({ owner: 'giantswarm', repo: 'roadmap', issue_number: 10 });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.converted.length, 4);
    assert.strictEqual(parsed.skipped.length, 1);
    assert.match(parsed.skipped[0].text, /Fix config validation/);
  });

  it('skips markdown-linked repo URLs (not issues, roadmap #4191 pattern)', async (t) => {
    const body = [
      '## Affected Apps',
      '- [x] [exception-recommender](https://github.com/giantswarm/exception-recommender)',
      '- [x] [falco-app](https://github.com/giantswarm/falco-app)',
      '- [x] [policy-meta-operator](https://github.com/giantswarm/policy-meta-operator)'
    ].join('\n');

    t.mock.method(octokit.rest.issues, 'get', makeIssueMock(body));

    const result = await handleMigrateTaskList({ owner: 'giantswarm', repo: 'roadmap', issue_number: 10 });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.converted.length, 0);
    assert.strictEqual(parsed.skipped.length, 3);
  });

  it('skips plain tasks and backtick tasks without refs (roadmap #4246 pattern)', async (t) => {
    const body = [
      '### Apps to update',
      '- [x] `cloud-provider-aws` — updated for Kubernetes in v35.0.0',
      '- [ ] `azure-cloud-controller-manager` — updated for Kubernetes in v35.0.0',
      '- [ ] `capa-controllers`'
    ].join('\n');

    t.mock.method(octokit.rest.issues, 'get', makeIssueMock(body));

    const result = await handleMigrateTaskList({ owner: 'giantswarm', repo: 'roadmap', issue_number: 10 });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.converted.length, 0);
    assert.strictEqual(parsed.skipped.length, 3);
  });

  it('handles indented nested tasks (roadmap #4199 pattern)', async (t) => {
    const body = [
      '### Phase 1: Prerequisites',
      '- [x] Replace Custom Providers with Backstage APIs',
      '  - [x] Replace TelemetryProvider with Backstage API',
      '  - [x] Replace ErrorReporterProvider with Backstage API',
      '- [x] Add NFS dependencies'
    ].join('\n');

    t.mock.method(octokit.rest.issues, 'get', makeIssueMock(body));

    const result = await handleMigrateTaskList({ owner: 'giantswarm', repo: 'roadmap', issue_number: 10 });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.converted.length, 0);
    assert.strictEqual(parsed.skipped.length, 4);
  });

  it('handles acceptance criteria with extra dashes (roadmap #4248 pattern)', async (t) => {
    const body = [
      'Acceptance criteria:',
      '- [ ] - Build a clear picture of how tests are failing',
      '- [ ] Depending on the root causes, either tackle issues or create issues'
    ].join('\n');

    t.mock.method(octokit.rest.issues, 'get', makeIssueMock(body));

    const result = await handleMigrateTaskList({ owner: 'giantswarm', repo: 'roadmap', issue_number: 10 });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.converted.length, 0);
    assert.strictEqual(parsed.skipped.length, 2);
  });

  it('ignores markdown link bullets that look like checkbox items (roadmap #4209 pattern)', async (t) => {
    // "- [Parent Issue](url)" is NOT a task-list item (no checkbox).
    // Only "- [ ] CAPA" etc. are task-list items.
    const body = [
      '- [ ] CAPA',
      '- [ ] CAPA-EKS',
      '- [x] CAPZ (already implemented)',
      '',
      '## Links',
      '- [Parent Issue](https://github.com/giantswarm/roadmap/issues/4154)'
    ].join('\n');

    t.mock.method(octokit.rest.issues, 'get', makeIssueMock(body));

    const result = await handleMigrateTaskList({ owner: 'giantswarm', repo: 'roadmap', issue_number: 10 });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.converted.length, 0, 'no task items have issue refs');
    assert.strictEqual(parsed.skipped.length, 3, 'CAPA, CAPA-EKS, CAPZ are skipped');
  });

  it('handles mixed complex body with multiple sections', async (t) => {
    const body = [
      '## Summary',
      'Track all readiness work.',
      '',
      '### LLM provider support',
      '- [ ] Add Azure OpenAI support to ai-chat-backend',
      '',
      '### UX and reliability',
      '- [ ] Only show AI buttons ([roadmap#4226](https://github.com/giantswarm/roadmap/issues/4226))',
      '- [ ] Ensure correct links ([roadmap#4225](https://github.com/giantswarm/roadmap/issues/4225))',
      '',
      '### Infrastructure',
      '- [ ] Fix config validation logic',
      '- [ ] Connect portal LLM chat: https://github.com/giantswarm/roadmap/issues/4171',
      '',
      '### Deployment',
      '- [ ] Document the customer enablement process',
      '- [ ] Validate end-to-end flow'
    ].join('\n');

    t.mock.method(octokit.rest.issues, 'get', makeIssueMock(body));
    t.mock.method(octokit, 'request', async () => ({}));

    const result = await handleMigrateTaskList({ owner: 'giantswarm', repo: 'roadmap', issue_number: 10 });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.converted.length, 3, `Expected 3 converted but got: ${JSON.stringify(parsed.converted)}`);
    assert.strictEqual(parsed.skipped.length, 4, `Expected 4 skipped but got: ${JSON.stringify(parsed.skipped)}`);
  });

  it('does not remove non-converted lines when removeTaskList is true', async (t) => {
    const body = [
      '## Tasks',
      '- [ ] https://github.com/o/r/issues/1',
      '- [ ] plain task that stays',
      '- [x] Some text: https://github.com/o/r/issues/2',
      'Remaining text'
    ].join('\n');

    t.mock.method(octokit.rest.issues, 'get', makeIssueMock(body));
    t.mock.method(octokit, 'request', async () => ({}));
    t.mock.method(octokit.rest.issues, 'update', async () => ({}));

    await handleMigrateTaskList({ owner: 'o', repo: 'r', issue_number: 10, removeTaskList: true });

    assert.strictEqual(octokit.rest.issues.update.mock.callCount(), 1);
    const updatedBody = octokit.rest.issues.update.mock.calls[0].arguments[0].body;
    assert.ok(updatedBody.includes('plain task that stays'));
    assert.ok(updatedBody.includes('## Tasks'));
    assert.ok(updatedBody.includes('Remaining text'));
    assert.ok(!updatedBody.includes('issues/1'));
    assert.ok(!updatedBody.includes('issues/2'));
  });

  it('handles uppercase X checkbox', async (t) => {
    const body = '- [X] https://github.com/o/r/issues/1';

    t.mock.method(octokit.rest.issues, 'get', makeIssueMock(body));
    t.mock.method(octokit, 'request', async () => ({}));

    const result = await handleMigrateTaskList({ owner: 'o', repo: 'r', issue_number: 10 });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.converted.length, 1);
  });

  it('handles cross-repo short ref in task list', async (t) => {
    const body = '- [ ] giantswarm/giantswarm#34462';

    t.mock.method(octokit.rest.issues, 'get', makeIssueMock(body));
    t.mock.method(octokit, 'request', async () => ({}));

    const result = await handleMigrateTaskList({ owner: 'giantswarm', repo: 'roadmap', issue_number: 10 });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.converted.length, 1);
    assert.strictEqual(parsed.converted[0].repository, 'giantswarm/giantswarm');
  });

  it('continues processing after individual failures', async (t) => {
    const body = [
      '- [ ] https://github.com/o/r/issues/1',
      '- [ ] https://github.com/o/r/issues/2',
      '- [ ] https://github.com/o/r/issues/3'
    ].join('\n');

    let getCalls = 0;
    t.mock.method(octokit.rest.issues, 'get', async (args) => {
      getCalls++;
      if (getCalls === 1) return { data: { body } };
      if (args.issue_number === 2) throw new Error('Rate limited');
      return {
        data: {
          id: args.issue_number * 1000,
          number: args.issue_number,
          title: `Issue ${args.issue_number}`,
          html_url: `https://github.com/o/r/issues/${args.issue_number}`,
          state: 'open'
        }
      };
    });
    t.mock.method(octokit, 'request', async () => ({}));

    const result = await handleMigrateTaskList({ owner: 'o', repo: 'r', issue_number: 10 });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.converted.length, 2);
    assert.strictEqual(parsed.failed.length, 1);
    assert.strictEqual(parsed.failed[0].ref, 'o/r#2');
  });

  it('handles lines without task checkboxes (ignores non-task-list lines)', async (t) => {
    const body = [
      '## Summary',
      'Normal paragraph text.',
      '',
      'Another paragraph with https://github.com/o/r/issues/99 inside it.',
      '',
      '- Regular bullet without checkbox',
      '- [ ] https://github.com/o/r/issues/1'
    ].join('\n');

    t.mock.method(octokit.rest.issues, 'get', makeIssueMock(body));
    t.mock.method(octokit, 'request', async () => ({}));

    const result = await handleMigrateTaskList({ owner: 'o', repo: 'r', issue_number: 10 });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.converted.length, 1, 'Only the task-list item should be converted');
    assert.strictEqual(parsed.skipped.length, 0);
  });

  it('handles Windows-style line endings (CRLF)', async (t) => {
    const body = '- [ ] https://github.com/o/r/issues/1\r\n- [ ] https://github.com/o/r/issues/2\r\n';

    t.mock.method(octokit.rest.issues, 'get', makeIssueMock(body));
    t.mock.method(octokit, 'request', async () => ({}));

    const result = await handleMigrateTaskList({ owner: 'o', repo: 'r', issue_number: 10 });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.converted.length, 2);
  });
});

// ---------------------------------------------------------------------------
// Team AI epic bodies -- verbatim from giantswarm/giantswarm issues
// These tests use the exact markdown bodies returned by the GitHub REST API
// to verify the migration tool handles real-world patterns correctly.
// ---------------------------------------------------------------------------

describe('handleMigrateTaskList — Team AI epic bodies', () => {
  function makeIssueMock(body) {
    let nextId = 9000;
    return async (args) => {
      if (!args.issue_number || args.issue_number === 10) {
        return { data: { body } };
      }
      nextId++;
      return {
        data: {
          id: nextId,
          number: args.issue_number,
          title: `Issue ${args.issue_number}`,
          html_url: `https://github.com/${args.owner}/${args.repo}/issues/${args.issue_number}`,
          state: 'open'
        }
      };
    };
  }

  it('handles #35951 — release propagation epic with mixed refs, sub-items, and dependencies section', async (t) => {
    const body = [
      '## Outcome',
      'Any release at any point in the chain cascades automatically.',
      '',
      '## Task list',
      '',
      '- [x] Fix personality dispatch payload mismatches across all ecosystems',
      '  - klaus-toolchains PR #13 -- toolchain -> component, removed continue-on-error (merged 2026-03-07)',
      '  - klaus-toolchains-internal PR #50 -- toolchain -> repository, v prefix, removed continue-on-error (merged 2026-03-07)',
      '',
      '- [ ] Fix public toolchains dispatch from klaus (klaus#109)',
      '  - PR #110 closed (wrong diagnosis). Actual cause: token never added to CircleCI.',
      '  - Tracked as #35970',
      '',
      '- [x] Enable auto-merge for dispatched dependency updates (spiffy ecosystem)',
      '  - spiffy-personalities#24 -- branch protection: require PRs + CI green + squash only',
      '',
      '- [ ] Disable Aliyun mirror push in klaus/muster ecosystem (tracked as #35971, in parallel)',
      '- [ ] architect-orb: go-build skip_tests option for multi-arch workflows (#35933) -- eliminates redundant test runs',
      '- [ ] Move downstream dispatch from CircleCI to GitHub Actions (giantswarm/klaus#118) -- repo-level counterpart of #35970',
      '- [ ] Ensure dispatch to personalities waits for CircleCI image push (giantswarm/klaus-toolchains#14)',
      '- [ ] Same dispatch wait issue in internal ecosystem (giantswarm/klaus-toolchains-internal#55)',
      '- [ ] Validate: toolchain/plugin releases produce personality PRs end-to-end (post-merge trial)',
      '- [ ] Bump klaus base images to v0.0.62 (teemow/spiffy-toolchains#53) -- validates the dispatch chain',
      '- [ ] Marge agents should proactively rebase after merging sibling PRs (#36001) -- dispatch chain reliability',
      '',
      '## Dependencies',
      '',
      '- #35970 -- Move dispatch from CircleCI to GitHub Actions (Task)',
      '- #35971 -- Disable Aliyun mirror push (Task, parallel)',
      '- #35933 -- architect-orb go-build skip_tests (Task)',
      '',
      '## Context',
      'The payload mismatches are now fixed.'
    ].join('\n');

    t.mock.method(octokit.rest.issues, 'get', makeIssueMock(body));
    t.mock.method(octokit, 'request', async () => ({}));

    const result = await handleMigrateTaskList({ owner: 'giantswarm', repo: 'giantswarm', issue_number: 10 });
    const parsed = parseResult(result);

    // Checkbox items with refs:
    //   "Fix personality dispatch..." — no direct issue ref (skipped)
    //   "Fix public toolchains dispatch from klaus (klaus#109)" — NOT a valid ref (no owner/)
    //   "Enable auto-merge..." — no direct issue ref (skipped)
    //   "Disable Aliyun mirror push... (tracked as #35971, in parallel)" — same-repo #35971
    //   "architect-orb... (#35933)" — same-repo #35933
    //   "Move downstream... (giantswarm/klaus#118)" — cross-repo ref
    //   "Ensure dispatch... (giantswarm/klaus-toolchains#14)" — cross-repo ref
    //   "Same dispatch... (giantswarm/klaus-toolchains-internal#55)" — cross-repo ref
    //   "Validate: toolchain/plugin..." — no ref (skipped)
    //   "Bump klaus... (teemow/spiffy-toolchains#53)" — cross-repo ref
    //   "Marge agents... (#36001)" — same-repo ref
    //
    // Dependencies section bullets are NOT checkboxes, so they're ignored.
    // Sub-items (indented "  - ") are NOT checkboxes, so they're ignored.

    assert.strictEqual(parsed.converted.length, 7,
      `Expected 7 converted but got: ${JSON.stringify(parsed.converted.map(c => c.repository + '#' + c.number))}`);
    assert.strictEqual(parsed.skipped.length, 4,
      `Expected 4 skipped but got: ${JSON.stringify(parsed.skipped)}`);
    assert.strictEqual(parsed.failed.length, 0);

    const convertedNums = parsed.converted.map(c => c.number);
    assert.ok(convertedNums.includes(35971));
    assert.ok(convertedNums.includes(35933));
    assert.ok(convertedNums.includes(118));
    assert.ok(convertedNums.includes(14));
    assert.ok(convertedNums.includes(55));
    assert.ok(convertedNums.includes(53));
    assert.ok(convertedNums.includes(36001));
  });

  it('handles #35953 — agent context epic with embedded refs, comma-separated refs, and context section', async (t) => {
    const body = [
      '## Outcome',
      '',
      'Agents understand project conventions.',
      '',
      '## Task list',
      '',
      '- [ ] CLAUDE.md creator plugin',
      '- [ ] Roll out CLAUDE.md across all ecosystem repos (depends on creator plugin)',
      '- [ ] Stop hook quality gate plugin',
      '- [ ] Investigate: agents rarely use plugins unless explicitly instructed',
      '- [x] Validate: git plugin hook-based workflow (stop hook safety net validated in trial 2026-03-10-1315, PR teemow/spiffy-plugins#81 merged)',
      '- [x] Personality git workflow guidance: agent owns commit and PR creation (coding: teemow/spiffy-personalities#59, klaus-dev: teemow/spiffy-personalities#62)',
      '- [ ] Validate: SessionStart hooks',
      '- [ ] Agent auto-commits all changes in stop hook (teemow/spiffy-plugins#75)',
      '- [ ] Generic PR titles intermittently (teemow/spiffy-plugins#71)',
      '- [ ] Agent exhibits scope creep on complex issues (teemow/spiffy-personalities#42)',
      '- [ ] Agent produces plan instead of implementation (teemow/spiffy-personalities#41)',
      '- [ ] Move best practices to upstream plugin-dev plugin (giantswarm/claude-code#64)',
      '- [ ] Stop hook transcript observability (giantswarm/klaus#131)',
      '',
      '## Context',
      '',
      'See the SOUL.md vs CLAUDE.md context model for the split.',
      '- [ ] Mine Cursor plan documents for pre-lab context (giantswarm/giantswarm#35960)',
      '- [ ] Audit global Cursor commands and rules (giantswarm/giantswarm#35961)',
      '- [ ] Mine old Cursor chat history from ecosystem repos (giantswarm/giantswarm#35965)',
      '- [ ] CLI/MCP parity convention enforcement (giantswarm/giantswarm#35967)'
    ].join('\n');

    t.mock.method(octokit.rest.issues, 'get', makeIssueMock(body));
    t.mock.method(octokit, 'request', async () => ({}));

    const result = await handleMigrateTaskList({ owner: 'giantswarm', repo: 'giantswarm', issue_number: 10 });
    const parsed = parseResult(result);

    // 17 checkbox items total:
    //   4 skipped (no ref): CLAUDE.md creator, Roll out, Stop hook quality gate, Investigate,
    //                       Validate: SessionStart hooks
    //   => actually 5 skipped
    //   12 converted: #81, #59 or #62, #75, #71, #42, #41, #64, #131, #35960, #35961, #35965, #35967
    //   => actually the "Validate: git plugin" line has teemow/spiffy-plugins#81 embedded
    //   => the "Personality git workflow" line has comma-separated refs, picks one

    assert.strictEqual(parsed.converted.length, 12,
      `Expected 12 converted but got: ${JSON.stringify(parsed.converted.map(c => c.repository + '#' + c.number))}`);
    assert.strictEqual(parsed.skipped.length, 5,
      `Expected 5 skipped but got: ${JSON.stringify(parsed.skipped)}`);
    assert.strictEqual(parsed.failed.length, 0);
  });

  it('handles #36065 — agent merge workflow with sub-issues section and acceptance criteria', async (t) => {
    const body = [
      '## Problem',
      '',
      'The klaus coding agent merges PRs using `--admin`.',
      '',
      '### Root causes',
      '',
      '1. **No pre-merge review enforcement**',
      '',
      '## Workstreams',
      '',
      '### Git plugin (stop hook)',
      '',
      '- Block direct-to-main pushes',
      '- Add pre-merge review gate',
      '',
      '## Sub-issues',
      '',
      '- [x] teemow/spiffy-plugins#50 -- Stop hook generates poor PR titles',
      '- [x] teemow/spiffy-plugins#82 -- Direct-to-main pushes (Done)',
      '- [ ] teemow/spiffy-plugins#85 -- Stop hook creates generic PR titles on context overflow',
      '- [ ] teemow/spiffy-plugins#86 -- Stop hook should not auto-merge without CI on context overflow',
      '- [ ] giantswarm/klaus#131 -- Stop hook execution invisible in transcript',
      '',
      '## Acceptance criteria',
      '',
      '- [ ] Agents cannot push directly to main/master under any circumstances',
      '- [ ] Code review by sub-agents is verified before merge',
      '- [ ] Agents self-merge PRs only after sub-agent reviews pass and CI is green',
      '- [ ] Review timing in coding personality updated to pre-merge',
      '- [ ] Context overflow auto-commits do not bypass the review gate',
      '- [ ] Context overflow PRs have descriptive titles',
      '- [ ] GitHub rulesets evaluated as branch protection replacement (tracked separately)'
    ].join('\n');

    t.mock.method(octokit.rest.issues, 'get', makeIssueMock(body));
    t.mock.method(octokit, 'request', async () => ({}));

    const result = await handleMigrateTaskList({ owner: 'giantswarm', repo: 'giantswarm', issue_number: 10 });
    const parsed = parseResult(result);

    // Sub-issues section: 5 items with refs -> 5 converted
    // Acceptance criteria: 7 items with no refs -> 7 skipped
    // Workstreams bullets are NOT checkboxes -> ignored

    assert.strictEqual(parsed.converted.length, 5,
      `Expected 5 converted but got: ${JSON.stringify(parsed.converted.map(c => c.repository + '#' + c.number))}`);
    assert.strictEqual(parsed.skipped.length, 7,
      `Expected 7 skipped but got: ${JSON.stringify(parsed.skipped)}`);

    const repos = parsed.converted.map(c => c.repository);
    assert.strictEqual(repos.filter(r => r === 'teemow/spiffy-plugins').length, 4);
    assert.strictEqual(repos.filter(r => r === 'giantswarm/klaus').length, 1);
  });

  it('handles #35988 — klaus-operator epic with strikethrough, markdown links, and sub-sections', async (t) => {
    const body = [
      '## Task list',
      '',
      '### Stale issues',
      '',
      '- [x] Close giantswarm/klaus-operator#31 -- Adapt to klaus-oci library redesign',
      '- [x] Close giantswarm/klaus-operator#32 -- Adapt to klaus-oci v0.0.9 annotations',
      '',
      '### Agent interaction (critical)',
      '',
      '- [x] giantswarm/klaus-operator#46 -- Add `prompt_instance` and `get_result` MCP tools',
      '- [x] giantswarm/klaus-operator#45 -- Add `get_logs` MCP tool for pod log retrieval',
      '',
      '### Enhanced status and create parameters',
      '',
      '- [x] giantswarm/klaus-operator#47 -- Enhance `get_instance` with agent-level status querying (PR #60)',
      '- [x] giantswarm/klaus-operator#48 -- Expose full CRD spec surface in `create_instance` MCP tool (PR #61)',
      '- [x] CLAUDE.md injection -- inject project-level CLAUDE.md into operator instances (parity with klausctl)',
      '',
      '### SOUL.md personality injection',
      '',
      '- [x] ~~giantswarm/klaus-operator#57 -- Mount personality SOUL.md at `/etc/klaus/SOUL.md` via SubPath~~ (PR #59 merged but SubPath does not work with image volumes -- [kubernetes/kubernetes#134894](https://github.com/kubernetes/kubernetes/issues/134894))',
      '- [x] giantswarm/klaus-operator#58 -- closed, replaced by env var approach below',
      '- [ ] giantswarm/klaus#126 -- Add `KLAUS_SOUL_FILE` env var support to `klaus` binary',
      '- [ ] giantswarm/klaus-operator#62 -- Replace SubPath mount with `KLAUS_SOUL_FILE` env var (depends on #126)',
      '',
      '### Instance lifecycle',
      '',
      '- [x] giantswarm/klaus-operator#49 -- Add `stop_instance` and `start_instance` lifecycle MCP tools',
      '- [x] giantswarm/klaus-operator#50 -- Add `run_instance` combined create+prompt MCP tool',
      '',
      '### Documentation and validation',
      '',
      '- [x] Feature gap audit documented in `architecture/klaus-operator.md`',
      '- [ ] giantswarm/klaus-operator#51 -- End-to-end cluster validation trial (depends on code issues above)',
      '',
      '## Acceptance criteria',
      '',
      '- Feature gap audit completed and documented',
      '- Operator supports the full instance lifecycle',
    ].join('\n');

    t.mock.method(octokit.rest.issues, 'get', makeIssueMock(body));
    t.mock.method(octokit, 'request', async () => ({}));

    const result = await handleMigrateTaskList({ owner: 'giantswarm', repo: 'giantswarm', issue_number: 10 });
    const parsed = parseResult(result);

    // Checkbox items with resolvable refs:
    //   #31, #32, #46, #45, #47, #48, ~~#57~~ (strikethrough!), #58, #126, #62, #49, #50, #51
    // Checkbox items without refs:
    //   "CLAUDE.md injection...", "Feature gap audit..."
    // Non-checkbox items:
    //   Acceptance criteria bullets (no checkboxes)
    //
    // The strikethrough item (~~giantswarm/klaus-operator#57~~) must resolve to
    // giantswarm/klaus-operator#57, NOT kubernetes/kubernetes#134894.

    assert.strictEqual(parsed.converted.length, 13,
      `Expected 13 converted but got: ${JSON.stringify(parsed.converted.map(c => c.repository + '#' + c.number))}`);
    assert.strictEqual(parsed.skipped.length, 2,
      `Expected 2 skipped but got: ${JSON.stringify(parsed.skipped)}`);

    const convertedNums = parsed.converted.map(c => c.number);
    assert.ok(convertedNums.includes(57), 'strikethrough ref #57 should be converted');
    assert.ok(!convertedNums.includes(134894), 'kubernetes/kubernetes#134894 markdown link should NOT be extracted');
  });

  it('handles epic with markdown-linked issue URLs and plain text items', async (t) => {
    const body = [
      '## Scope',
      '',
      '### A. Security Analysis',
      '',
      '- [x] [Analyze AuthN/AuthZ for MCP Servers](https://github.com/giantswarm/project-alpha/issues/1) -- OAuth 2.1 implemented (30h)',
      '- [x] [Analyze Base Images & CI/CD](https://github.com/giantswarm/project-alpha/issues/2) -- Multi-arch ARM support (10h)',
      '- [x] [Analyze Policies (RBAC, Network, Kyverno)](https://github.com/giantswarm/project-alpha/issues/3) -- Initial security work (10h)',
      '- [x] [Analyze Secret Management](https://github.com/giantswarm/project-alpha/issues/4) -- Analysis completed (10h)',
      '- [x] [Create Agent Setup Concept (MVP Plan)](https://github.com/giantswarm/project-alpha/issues/5) -- Agent implemented and demoed (70h)',
      '',
      '### B. LLM Evaluation & Deployment',
      '',
      '- [x] [LLM Evaluation for Edge Deployment](https://github.com/giantswarm/project-alpha/issues/6) -- llm-testing framework built (30h), model evaluation next',
      '- [ ] [LLM Quantization/Pruning for Edge Constraints](https://github.com/giantswarm/project-alpha/issues/7)',
      '- [ ] [Secure LLM Containerization](https://github.com/giantswarm/project-alpha/issues/8)',
      '- [ ] [Setup Local Model Registry](https://github.com/giantswarm/project-alpha/issues/9)',
      '- [ ] [Deploy LLM Runtime Environment (vLLM)](https://github.com/giantswarm/project-alpha/issues/10)',
      '- [ ] AI Conformance Testing for Kubernetes -- 20h completed',
      '',
      '### Cross-cutting',
      '',
      '- [ ] Model selection decision for May demo (by March 17) -- #36031',
      '- [ ] Present architecture overview at March 17 meeting',
      '- [x] llm-testing framework deployed on test cluster',
      '',
      '## Links',
      '',
      '- Parent Rock: #35493',
      '- Related: #33239',
    ].join('\n');

    t.mock.method(octokit.rest.issues, 'get', makeIssueMock(body));
    t.mock.method(octokit, 'request', async () => ({}));

    const result = await handleMigrateTaskList({ owner: 'giantswarm', repo: 'giantswarm', issue_number: 10 });
    const parsed = parseResult(result);

    // Markdown-linked items: project-alpha#1-10 (10 items, 10 converted via markdown link regex)
    // Plain text: "AI Conformance Testing..." (1 skipped)
    // Same-repo ref: "Model selection... -- #36031" (1 converted)
    // Plain text: "Present architecture..." (1 skipped)
    // Plain text: "llm-testing framework..." (1 skipped)
    // Non-checkbox: Links section items -> ignored

    assert.strictEqual(parsed.converted.length, 11,
      `Expected 11 converted but got: ${JSON.stringify(parsed.converted.map(c => c.repository + '#' + c.number))}`);
    assert.strictEqual(parsed.skipped.length, 3,
      `Expected 3 skipped but got: ${JSON.stringify(parsed.skipped)}`);
    assert.strictEqual(parsed.failed.length, 0);

    const projectIssues = parsed.converted.filter(c => c.repository === 'giantswarm/project-alpha');
    assert.strictEqual(projectIssues.length, 10, 'All 10 project issues should be converted');
  });

  it('handles #36113 — sub-issues epic with acceptance criteria containing refs', async (t) => {
    const body = [
      '## Problem',
      '',
      'Epics currently track child issues via task lists.',
      '',
      '## Acceptance criteria',
      '',
      '- [ ] pro exposes MCP tools for sub-issue CRUD (list, add, remove, get parent, reprioritize) -- giantswarm/pro#33',
      '- [ ] Migration tool converts existing task lists to sub-issue relationships -- giantswarm/pro#33',
      '- [ ] Epic child relationships are managed via the sub-issues API, not task lists',
      '- [ ] Lab workflow rules and commands updated to use sub-issues tools -- #36114',
      '- [ ] Agents can query parent/child relationships in both directions',
      '- [ ] All active Team AI epics migrated from task lists to sub-issues',
    ].join('\n');

    t.mock.method(octokit.rest.issues, 'get', makeIssueMock(body));
    t.mock.method(octokit, 'request', async () => ({}));

    const result = await handleMigrateTaskList({ owner: 'giantswarm', repo: 'giantswarm', issue_number: 10 });
    const parsed = parseResult(result);

    // Items with refs: giantswarm/pro#33 (appears twice), #36114 -> 3 converted
    // Items without refs: 3 skipped

    assert.strictEqual(parsed.converted.length, 3,
      `Expected 3 converted but got: ${JSON.stringify(parsed.converted.map(c => c.repository + '#' + c.number))}`);
    assert.strictEqual(parsed.skipped.length, 3,
      `Expected 3 skipped but got: ${JSON.stringify(parsed.skipped)}`);
  });

  it('ignores non-checkbox numbered lists and bulleted lists', async (t) => {
    const body = [
      '## Proposed solution',
      '',
      '1. Audit the operator against klausctl',
      '2. Bring the operator up to parity',
      '3. Set up a test cluster',
      '',
      '## Workstreams',
      '',
      '- Block direct-to-main pushes (error instead of silent skip)',
      '- Add pre-merge review gate',
      '- Keep `--admin` merge strategy',
      '',
      '## Task list',
      '',
      '- [ ] giantswarm/klaus-operator#51 -- End-to-end validation'
    ].join('\n');

    t.mock.method(octokit.rest.issues, 'get', makeIssueMock(body));
    t.mock.method(octokit, 'request', async () => ({}));

    const result = await handleMigrateTaskList({ owner: 'giantswarm', repo: 'giantswarm', issue_number: 10 });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.converted.length, 1, 'only the checkbox item should be processed');
    assert.strictEqual(parsed.skipped.length, 0);
    assert.strictEqual(parsed.converted[0].number, 51);
  });

  it('handles duplicate refs appearing in different checkbox items', async (t) => {
    const body = [
      '- [ ] pro exposes MCP tools -- giantswarm/pro#33',
      '- [ ] Migration tool converts task lists -- giantswarm/pro#33',
    ].join('\n');

    let requestCalls = 0;
    t.mock.method(octokit.rest.issues, 'get', makeIssueMock(body));
    t.mock.method(octokit, 'request', async () => {
      requestCalls++;
      if (requestCalls === 2) {
        const err = new Error('Sub-issue already exists');
        err.status = 422;
        throw err;
      }
      return {};
    });

    const result = await handleMigrateTaskList({ owner: 'giantswarm', repo: 'giantswarm', issue_number: 10 });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.converted.length, 1, 'first occurrence converts');
    assert.strictEqual(parsed.failed.length, 1, 'second occurrence fails (duplicate)');
  });

  it('handles "PR #N" in parentheses (not a real issue ref in some contexts)', async (t) => {
    const body = [
      '- [x] giantswarm/klaus-operator#47 -- Enhance get_instance (PR #60)',
      '- [x] giantswarm/klaus-operator#48 -- Expose full CRD spec surface (PR #61)',
    ].join('\n');

    t.mock.method(octokit.rest.issues, 'get', makeIssueMock(body));
    t.mock.method(octokit, 'request', async () => ({}));

    const result = await handleMigrateTaskList({ owner: 'giantswarm', repo: 'giantswarm', issue_number: 10 });
    const parsed = parseResult(result);

    assert.strictEqual(parsed.converted.length, 2);
    assert.strictEqual(parsed.converted[0].number, 47, 'should extract #47, not #60');
    assert.strictEqual(parsed.converted[1].number, 48, 'should extract #48, not #61');
  });
});
