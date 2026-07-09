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
