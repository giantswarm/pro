/**
 * Issue Timeline Module
 *
 * Provides access to the GitHub Issue Timeline REST API (not available via
 * GraphQL, same reasoning as sub-issues.js). Maps raw timeline events to a
 * compact shape and supports client-side since/until/eventTypes filtering,
 * with an early pagination stop once `until` is exceeded, since the timeline
 * is returned in chronological (oldest-first) order. When more than
 * MAX_TIMELINE_EVENTS qualifying events exist, the most recent ones are kept
 * and `truncated: true` is set.
 */

import { getOctokit } from './rest-api.js';
import { logger } from './logger.js';
import { fetchBounded } from './api.js';
import { BOARDS } from './project.js';

const DEFAULT_PAGE_SIZE = 100;

/**
 * Maximum number of (post-filter) events returned by getIssueTimeline.
 * When more qualifying events exist, the result is truncated and
 * `truncated: true` is set on the return value.
 */
export const MAX_TIMELINE_EVENTS = 200;

/**
 * Extract a GitHub login (or best-effort name) from an actor-like object.
 * @param {Object} [obj]
 * @returns {string|undefined}
 */
function actorLogin(obj) {
  return obj?.login || obj?.name || undefined;
}

/**
 * Best-effort timestamp for a raw timeline event, used both for since/until
 * filtering and as the compact event's createdAt.
 * @param {Object} event
 * @returns {string|null}
 */
function eventTimestamp(event) {
  return event.created_at || event.submitted_at || event.author?.date || event.committer?.date || null;
}

/**
 * Map a single raw timeline event to a compact { type, actor, createdAt, detail } shape.
 * `detail` is only populated for event types where it carries meaningful signal;
 * all other payload fields (bodies, diffs, node IDs, etc.) are dropped.
 * @param {Object} event - Raw event from GET /repos/{owner}/{repo}/issues/{issue_number}/timeline
 * @returns {{ type: string, actor?: string, createdAt: string|null, detail?: Object }|null}
 */
export function compactTimelineEvent(event) {
  const type = event?.event;
  if (!type) return null;

  const base = {
    type,
    actor: actorLogin(event.actor) || actorLogin(event.user) || actorLogin(event.author),
    createdAt: eventTimestamp(event)
  };

  switch (type) {
    case 'labeled':
    case 'unlabeled':
      return { ...base, detail: { label: event.label?.name } };

    case 'closed':
      return event.state_reason
        ? { ...base, detail: { stateReason: event.state_reason } }
        : base;

    case 'cross-referenced': {
      const src = event.source?.issue;
      return {
        ...base,
        actor: actorLogin(event.actor) || actorLogin(src?.user),
        createdAt: event.created_at || src?.created_at || base.createdAt,
        detail: src
          ? {
              ref: `${src.repository?.full_name || ''}#${src.number}`,
              title: src.title,
              isPullRequest: Boolean(src.pull_request)
            }
          : undefined
      };
    }

    case 'assigned':
    case 'unassigned':
      return { ...base, detail: { assignee: actorLogin(event.assignee) } };

    case 'milestoned':
    case 'demilestoned':
      return { ...base, detail: { milestone: event.milestone?.title } };

    case 'renamed':
      return { ...base, detail: { from: event.rename?.from, to: event.rename?.to } };

    case 'referenced':
      return { ...base, detail: { commit: event.commit_id } };

    default:
      return base;
  }
}

/**
 * Fetch and compact the activity timeline for a GitHub issue, paginating
 * via Octokit and filtering client-side (the timeline endpoint has no
 * server-side date/type filters). Stops paginating early once `until` is
 * exceeded, since events are returned in chronological (oldest-first) order.
 * When more than MAX_TIMELINE_EVENTS qualifying events are found, only the
 * most recent MAX_TIMELINE_EVENTS are kept (oldest-first order preserved
 * within that tail) and `truncated: true` is set.
 *
 * @param {Object} params
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number} params.issue_number
 * @param {string} [params.since] - ISO 8601 date/time; only include events at or after this instant
 * @param {string} [params.until] - ISO 8601 date/time; only include events at or before this instant
 * @param {string[]} [params.eventTypes] - Only include events whose raw `type` is in this list
 * @param {string} [token] - Optional per-request GitHub token
 * @returns {Promise<{ events: Array, truncated: boolean } | { error: string }>}
 */
export async function getIssueTimeline({ owner, repo, issue_number, since, until, eventTypes }, token) {
  const sinceDate = since ? new Date(since) : null;
  const untilDate = until ? new Date(until) : null;

  if (sinceDate && Number.isNaN(sinceDate.getTime())) {
    return { error: `Invalid 'since' date/time: '${since}'` };
  }
  if (untilDate && Number.isNaN(untilDate.getTime())) {
    return { error: `Invalid 'until' date/time: '${until}'` };
  }

  const client = getOctokit(token);
  const typeFilter = Array.isArray(eventTypes) && eventTypes.length > 0 ? new Set(eventTypes) : null;

  logger.debug('Fetching issue timeline', { owner, repo, issue_number, since, until, eventTypes });

  const events = [];
  let page = 1;

  outer:
  while (true) {
    const { data } = await client.request(
      'GET /repos/{owner}/{repo}/issues/{issue_number}/timeline',
      { owner, repo, issue_number, per_page: DEFAULT_PAGE_SIZE, page }
    );

    if (!Array.isArray(data) || data.length === 0) break;

    for (const raw of data) {
      const ts = eventTimestamp(raw);
      const tsDate = ts ? new Date(ts) : null;

      // Chronological (oldest-first) order means once we're past `until`,
      // nothing later in the timeline can be in range either.
      if (untilDate && tsDate && tsDate > untilDate) {
        break outer;
      }
      if (sinceDate && tsDate && tsDate < sinceDate) {
        continue;
      }

      const compact = compactTimelineEvent(raw);
      if (!compact) continue;
      if (typeFilter && !typeFilter.has(compact.type)) continue;

      events.push(compact);
    }

    if (data.length < DEFAULT_PAGE_SIZE) break;
    page += 1;
  }

  const truncated = events.length > MAX_TIMELINE_EVENTS;
  const kept = truncated ? events.slice(events.length - MAX_TIMELINE_EVENTS) : events;

  return { events: kept, truncated };
}


// ---------------------------------------------------------------------------
// Status changes across one repository (GraphQL)
// ---------------------------------------------------------------------------

/** Issues read per GraphQL page by listStatusChanges. */
const STATUS_CHANGES_PAGE_SIZE = 50;

/** Status-change events read per issue (the newest ones). */
export const STATUS_CHANGES_PER_ISSUE = 50;

/** Issues scanned by listStatusChanges unless maxIssues says otherwise. */
export const DEFAULT_STATUS_CHANGES_MAX_ISSUES = 300;

const STATUS_CHANGES_QUERY = `
  query($owner: String!, $repo: String!, $first: Int!, $after: String, $states: [IssueState!], $filterSince: DateTime) {
    repository(owner: $owner, name: $repo) {
      issues(first: $first, after: $after, states: $states, filterBy: { since: $filterSince }, orderBy: { field: CREATED_AT, direction: DESC }) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes {
          number
          title
          url
          state
          timelineItems(last: ${STATUS_CHANGES_PER_ISSUE}, itemTypes: [PROJECT_V2_ITEM_STATUS_CHANGED_EVENT]) {
            totalCount
            nodes {
              ... on ProjectV2ItemStatusChangedEvent {
                createdAt
                actor { login }
                previousStatus
                status
                project { number url }
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * The board key of a project, matched on its number and owner (the owner is
 * read from the project URL, https://github.com/orgs/<owner>/projects/<n>).
 * @param {{ number?: number, url?: string }} [project]
 * @returns {string|null}
 */
export function boardKeyOfProject(project) {
  if (!project) return null;
  const owner = /github\.com\/(?:orgs|users)\/([^/]+)\/projects\//.exec(project.url || '')?.[1];
  const entry = Object.entries(BOARDS).find(([, board]) =>
    board.number === project.number && (!owner || board.owner.toLowerCase() === owner.toLowerCase()));
  return entry ? entry[0] : null;
}

/**
 * List the board Status changes of the issues of one repository: every
 * ProjectV2ItemStatusChangedEvent with its previous and new Status and the
 * board it happened on. Project field changes do not bump an issue's
 * updatedAt, so open issues are all scanned (newest first, up to maxIssues);
 * closed issues are narrowed to those updated since \`since\` (closing an
 * issue bumps it).
 *
 * @param {Object} params
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {string} [params.since] - ISO 8601; only changes at or after this instant
 * @param {string} [params.until] - ISO 8601; only changes at or before this instant
 * @param {string} [params.board] - Only changes on this board key
 * @param {'open'|'closed'} [params.state] - Which issues to scan (default open)
 * @param {number} [params.maxIssues] - Issues to scan at most; 0 = all
 * @param {string} [token] - Optional per-request GitHub token
 * @returns {Promise<Object>}
 */
export async function listStatusChanges({ owner, repo, since, until, board, state = 'open', maxIssues = DEFAULT_STATUS_CHANGES_MAX_ISSUES }, token) {
  const sinceDate = since ? new Date(since) : null;
  const untilDate = until ? new Date(until) : null;
  if (sinceDate && Number.isNaN(sinceDate.getTime())) {
    return { error: `Invalid 'since' date/time: '${since}'` };
  }
  if (untilDate && Number.isNaN(untilDate.getTime())) {
    return { error: `Invalid 'until' date/time: '${until}'` };
  }
  if (state !== 'open' && state !== 'closed') {
    return { error: `Invalid 'state': '${state}' (open or closed)` };
  }
  if (board && !BOARDS[board]) {
    return { error: `Unknown board '${board}'` };
  }

  logger.debug('Listing status changes', { owner, repo, since, until, board, state, maxIssues });

  let totalCount = null;
  const { nodes, hasNextPage } = await fetchBounded(
    STATUS_CHANGES_QUERY,
    {
      owner,
      repo,
      first: STATUS_CHANGES_PAGE_SIZE,
      states: [state === 'closed' ? 'CLOSED' : 'OPEN'],
      filterSince: state === 'closed' && sinceDate ? sinceDate.toISOString() : null
    },
    (result) => {
      const issues = result?.repository?.issues;
      if (totalCount === null && typeof issues?.totalCount === 'number') totalCount = issues.totalCount;
      return issues || { nodes: [], pageInfo: { hasNextPage: false } };
    },
    token,
    { limit: maxIssues > 0 ? maxIssues : 0 }
  );

  const changes = [];
  const timelineTruncated = [];
  for (const issue of nodes) {
    const events = (issue.timelineItems?.nodes || []).filter(event => event && event.createdAt);
    if ((issue.timelineItems?.totalCount ?? 0) > events.length) {
      const oldestKept = events[0]?.createdAt;
      if (!sinceDate || !oldestKept || new Date(oldestKept) > sinceDate) timelineTruncated.push(issue.number);
    }
    for (const event of events) {
      const at = new Date(event.createdAt);
      if (sinceDate && at < sinceDate) continue;
      if (untilDate && at > untilDate) continue;
      const eventBoard = boardKeyOfProject(event.project);
      if (board && eventBoard !== board) continue;
      changes.push({
        number: issue.number,
        title: issue.title,
        url: issue.url,
        state: issue.state,
        board: eventBoard,
        projectNumber: event.project?.number ?? null,
        from: event.previousStatus ?? '',
        to: event.status ?? '',
        actor: event.actor?.login,
        createdAt: event.createdAt
      });
    }
  }
  changes.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return {
    repository: `${owner}/${repo}`,
    state,
    since: since || null,
    until: until || null,
    board: board || null,
    issuesScanned: nodes.length,
    issuesTotal: totalCount,
    truncated: hasNextPage,
    timelineTruncated,
    count: changes.length,
    changes
  };
}
