import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.GITHUB_API_TOKEN = 'test-token';

const { octokit } = await import('./rest-api.js');
const { getIssueTimeline, compactTimelineEvent, MAX_TIMELINE_EVENTS } = await import('./timeline.js');

// ---------------------------------------------------------------------------
// compactTimelineEvent — pure mapping unit tests
// ---------------------------------------------------------------------------

describe('compactTimelineEvent', () => {
  it('returns null for events with no `event` field', () => {
    assert.strictEqual(compactTimelineEvent({ id: 1 }), null);
    assert.strictEqual(compactTimelineEvent(null), null);
  });

  it('maps labeled events with label name', () => {
    const result = compactTimelineEvent({
      event: 'labeled',
      actor: { login: 'octocat' },
      created_at: '2026-01-01T00:00:00Z',
      label: { name: 'bug', color: 'ff0000', node_id: 'abc' }
    });
    assert.deepStrictEqual(result, {
      type: 'labeled',
      actor: 'octocat',
      createdAt: '2026-01-01T00:00:00Z',
      detail: { label: 'bug' }
    });
  });

  it('maps unlabeled events with label name', () => {
    const result = compactTimelineEvent({
      event: 'unlabeled',
      actor: { login: 'octocat' },
      created_at: '2026-01-01T00:00:00Z',
      label: { name: 'wontfix' }
    });
    assert.strictEqual(result.detail.label, 'wontfix');
  });

  it('maps closed events with stateReason', () => {
    const result = compactTimelineEvent({
      event: 'closed',
      actor: { login: 'octocat' },
      created_at: '2026-01-02T00:00:00Z',
      state_reason: 'not_planned',
      commit_id: 'deadbeef'
    });
    assert.deepStrictEqual(result.detail, { stateReason: 'not_planned' });
    assert.strictEqual(result.commit_id, undefined);
  });

  it('maps closed events without stateReason to no detail', () => {
    const result = compactTimelineEvent({
      event: 'closed',
      actor: { login: 'octocat' },
      created_at: '2026-01-02T00:00:00Z'
    });
    assert.strictEqual(result.detail, undefined);
  });

  it('maps cross-referenced events with source issue ref', () => {
    const result = compactTimelineEvent({
      event: 'cross-referenced',
      actor: { login: 'octocat' },
      created_at: '2026-01-03T00:00:00Z',
      source: {
        issue: {
          number: 42,
          title: 'Some other issue',
          repository: { full_name: 'giantswarm/other-repo' },
          pull_request: null,
          user: { login: 'someone' },
          created_at: '2026-01-03T00:00:01Z'
        }
      }
    });
    assert.deepStrictEqual(result.detail, {
      ref: 'giantswarm/other-repo#42',
      title: 'Some other issue',
      isPullRequest: false
    });
  });

  it('marks cross-referenced source as a pull request when applicable', () => {
    const result = compactTimelineEvent({
      event: 'cross-referenced',
      created_at: '2026-01-03T00:00:00Z',
      source: {
        issue: {
          number: 7,
          title: 'A PR',
          repository: { full_name: 'giantswarm/repo' },
          pull_request: { url: 'https://api.github.com/...' }
        }
      }
    });
    assert.strictEqual(result.detail.isPullRequest, true);
  });

  it('maps assigned events with assignee login', () => {
    const result = compactTimelineEvent({
      event: 'assigned',
      actor: { login: 'octocat' },
      created_at: '2026-01-04T00:00:00Z',
      assignee: { login: 'assignee-user' }
    });
    assert.deepStrictEqual(result.detail, { assignee: 'assignee-user' });
  });

  it('maps unassigned events with assignee login', () => {
    const result = compactTimelineEvent({
      event: 'unassigned',
      created_at: '2026-01-04T00:00:00Z',
      assignee: { login: 'former-assignee' }
    });
    assert.deepStrictEqual(result.detail, { assignee: 'former-assignee' });
  });

  it('maps milestoned events with milestone title', () => {
    const result = compactTimelineEvent({
      event: 'milestoned',
      created_at: '2026-01-05T00:00:00Z',
      milestone: { title: 'v1.0' }
    });
    assert.deepStrictEqual(result.detail, { milestone: 'v1.0' });
  });

  it('maps demilestoned events with milestone title', () => {
    const result = compactTimelineEvent({
      event: 'demilestoned',
      created_at: '2026-01-05T00:00:00Z',
      milestone: { title: 'v1.0' }
    });
    assert.deepStrictEqual(result.detail, { milestone: 'v1.0' });
  });

  it('maps renamed events with from/to', () => {
    const result = compactTimelineEvent({
      event: 'renamed',
      created_at: '2026-01-06T00:00:00Z',
      rename: { from: 'Old title', to: 'New title' }
    });
    assert.deepStrictEqual(result.detail, { from: 'Old title', to: 'New title' });
  });

  it('maps referenced events with commit id', () => {
    const result = compactTimelineEvent({
      event: 'referenced',
      actor: { login: 'octocat' },
      created_at: '2026-01-07T00:00:00Z',
      commit_id: 'abc123',
      commit_url: 'https://api.github.com/...'
    });
    assert.deepStrictEqual(result.detail, { commit: 'abc123' });
  });

  it('drops noisy payload fields for unmapped event types', () => {
    const result = compactTimelineEvent({
      event: 'commented',
      actor: { login: 'octocat' },
      created_at: '2026-01-08T00:00:00Z',
      body: 'a very long comment body that should not be echoed back',
      body_html: '<p>...</p>',
      reactions: { '+1': 3 }
    });
    assert.deepStrictEqual(result, {
      type: 'commented',
      actor: 'octocat',
      createdAt: '2026-01-08T00:00:00Z'
    });
  });

  it('falls back to user/author login when actor is absent', () => {
    const result = compactTimelineEvent({
      event: 'reviewed',
      user: { login: 'reviewer-user' },
      submitted_at: '2026-01-09T00:00:00Z'
    });
    assert.strictEqual(result.actor, 'reviewer-user');
    assert.strictEqual(result.createdAt, '2026-01-09T00:00:00Z');
  });
});

// ---------------------------------------------------------------------------
// getIssueTimeline — pagination, filtering, capping
// ---------------------------------------------------------------------------

function ev(type, date, extra = {}) {
  return { event: type, actor: { login: 'octocat' }, created_at: date, ...extra };
}

describe('getIssueTimeline', () => {
  it('fetches a single page and compacts all events', async (t) => {
    t.mock.method(octokit, 'request', async () => ({
      data: [
        ev('labeled', '2026-01-01T00:00:00Z', { label: { name: 'bug' } }),
        ev('closed', '2026-01-02T00:00:00Z')
      ]
    }));

    const { events, truncated } = await getIssueTimeline({
      owner: 'o', repo: 'r', issue_number: 1
    });

    assert.strictEqual(events.length, 2);
    assert.strictEqual(truncated, false);
    assert.strictEqual(events[0].type, 'labeled');
    assert.strictEqual(events[1].type, 'closed');
  });

  it('paginates when a full page is returned', async (t) => {
    let calls = 0;
    t.mock.method(octokit, 'request', async (route, params) => {
      calls++;
      if (params.page === 1) {
        const page = [];
        for (let i = 0; i < 100; i++) {
          page.push(ev('labeled', `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`, { label: { name: `l${i}` } }));
        }
        return { data: page };
      }
      return { data: [ev('closed', '2026-01-02T00:00:00Z')] };
    });

    const { events } = await getIssueTimeline({ owner: 'o', repo: 'r', issue_number: 1 });

    assert.strictEqual(calls, 2);
    assert.strictEqual(events.length, 101);
    assert.strictEqual(events[100].type, 'closed');
  });

  it('stops paginating once events exceed `until` (chronological early stop)', async (t) => {
    let calls = 0;
    t.mock.method(octokit, 'request', async (route, params) => {
      calls++;
      if (params.page === 1) {
        const page = [];
        for (let i = 0; i < 100; i++) {
          page.push(ev('labeled', `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`));
        }
        // Last event of page 1 is after `until` -- should trigger early stop.
        page[99] = ev('labeled', '2026-06-01T00:00:00Z');
        return { data: page };
      }
      // Should never be reached.
      calls += 1000;
      return { data: [ev('closed', '2026-07-01T00:00:00Z')] };
    });

    const { events } = await getIssueTimeline({
      owner: 'o', repo: 'r', issue_number: 1, until: '2026-02-01T00:00:00Z'
    });

    assert.strictEqual(calls, 1, 'should not have fetched a second page');
    assert.strictEqual(events.length, 99);
  });

  it('filters out events before `since`', async (t) => {
    t.mock.method(octokit, 'request', async () => ({
      data: [
        ev('labeled', '2026-01-01T00:00:00Z'),
        ev('closed', '2026-03-01T00:00:00Z')
      ]
    }));

    const { events } = await getIssueTimeline({
      owner: 'o', repo: 'r', issue_number: 1, since: '2026-02-01T00:00:00Z'
    });

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'closed');
  });

  it('filters by eventTypes', async (t) => {
    t.mock.method(octokit, 'request', async () => ({
      data: [
        ev('labeled', '2026-01-01T00:00:00Z'),
        ev('commented', '2026-01-02T00:00:00Z'),
        ev('closed', '2026-01-03T00:00:00Z')
      ]
    }));

    const { events } = await getIssueTimeline({
      owner: 'o', repo: 'r', issue_number: 1, eventTypes: ['labeled', 'closed']
    });

    assert.strictEqual(events.length, 2);
    assert.deepStrictEqual(events.map(e => e.type), ['labeled', 'closed']);
  });

  it('caps output at MAX_TIMELINE_EVENTS, keeping the most recent events', async (t) => {
    // 3 full pages (300 events) then a final short page to terminate pagination.
    const TOTAL_PAGES = 3;
    t.mock.method(octokit, 'request', async (route, params) => {
      if (params.page > TOTAL_PAGES) return { data: [] };
      const page = [];
      const base = (params.page - 1) * 100;
      for (let i = 0; i < 100; i++) {
        const seq = base + i;
        // Unique, increasing timestamps so we can assert on which ones survive.
        page.push(ev('labeled', new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(), { seq }));
      }
      return { data: page };
    });

    const { events, truncated } = await getIssueTimeline({ owner: 'o', repo: 'r', issue_number: 1 });

    assert.strictEqual(events.length, MAX_TIMELINE_EVENTS);
    assert.strictEqual(truncated, true);
    // The kept events must be the newest 200 of the 300 generated (seq 100..299),
    // in ascending (oldest-first) order.
    assert.strictEqual(events[0].createdAt, new Date(Date.UTC(2026, 0, 1, 0, 0, 100)).toISOString());
    assert.strictEqual(events[events.length - 1].createdAt, new Date(Date.UTC(2026, 0, 1, 0, 0, 299)).toISOString());
  });

  it('passes owner/repo/issue_number/per_page to the request', async (t) => {
    t.mock.method(octokit, 'request', async () => ({ data: [] }));

    await getIssueTimeline({ owner: 'giantswarm', repo: 'roadmap', issue_number: 42 });

    const [route, params] = octokit.request.mock.calls[0].arguments;
    assert.match(route, /GET .*\/issues\/\{issue_number\}\/timeline/);
    assert.strictEqual(params.owner, 'giantswarm');
    assert.strictEqual(params.repo, 'roadmap');
    assert.strictEqual(params.issue_number, 42);
    assert.strictEqual(params.per_page, 100);
    assert.strictEqual(params.page, 1);
  });

  it('returns empty events with no data', async (t) => {
    t.mock.method(octokit, 'request', async () => ({ data: [] }));

    const { events, truncated } = await getIssueTimeline({ owner: 'o', repo: 'r', issue_number: 1 });

    assert.deepStrictEqual(events, []);
    assert.strictEqual(truncated, false);
  });

  it('returns an error for a malformed `since` value instead of silently disabling filtering', async (t) => {
    const request = t.mock.method(octokit, 'request', async () => ({ data: [] }));

    const result = await getIssueTimeline({ owner: 'o', repo: 'r', issue_number: 1, since: 'not-a-date' });

    assert.match(result.error, /since/i);
    assert.strictEqual(request.mock.calls.length, 0, 'should not fetch when validation fails');
  });

  it('returns an error for a malformed `until` value instead of silently disabling filtering', async (t) => {
    const request = t.mock.method(octokit, 'request', async () => ({ data: [] }));

    const result = await getIssueTimeline({ owner: 'o', repo: 'r', issue_number: 1, until: 'also-not-a-date' });

    assert.match(result.error, /until/i);
    assert.strictEqual(request.mock.calls.length, 0, 'should not fetch when validation fails');
  });
});
