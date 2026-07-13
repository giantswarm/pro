/**
 * Bulk Issue Comments Module
 *
 * Resolves GitHub Projects V2 items to their underlying issues (via the
 * batched resolveItemIssues helper in items.js) and fetches each issue's comments via
 * the REST API, which supports `since` filtering natively. Bounds response
 * size by capping the number of items per call, the number of REST pages
 * fetched per issue (when `since` is absent), the number of comments kept
 * per issue, and truncating long comment bodies.
 *
 * Ordering semantics for the kept comments differ by mode:
 *   - Without `since`: newest by creation order (the REST endpoint's natural
 *     oldest-first order, sliced from the end).
 *   - With `since`: newest by `updated_at`, so a recently-edited older
 *     comment is kept over an untouched newer-created one.
 *
 * Each comment always exposes `createdAt`; `updatedAt` is included only when
 * it differs from `createdAt` (i.e. the comment was edited), so the `since`
 * mode's updated_at-driven retention is observable without bloating the
 * common (unedited) case.
 */

import { getOctokit } from './rest-api.js';
import { resolveItemIssues } from './items.js';
import { logger } from './logger.js';

/** Maximum number of itemIds accepted in a single list_issue_comments call. */
export const MAX_ITEMS_PER_CALL = 25;

/** Default number of newest comments kept per issue when maxPerIssue isn't given. */
export const DEFAULT_MAX_PER_ISSUE = 20;

/** Comment bodies longer than this are truncated with an explicit indicator. */
export const MAX_COMMENT_BODY_LENGTH = 2000;

/**
 * Hard cap on REST pages fetched per issue when `since` is absent. Bounds a
 * single list_issue_comments call to at most MAX_PAGES * 100 REST requests'
 * worth of comments per issue, rather than fetching every page unconditionally.
 * When `since` is supplied this cap does not apply (see fetchIssueComments).
 */
export const MAX_PAGES = 5;

/**
 * Truncate an overly long comment body, appending an explicit indicator of
 * how much was cut so callers can tell the body isn't complete.
 * @param {string} body
 * @returns {string}
 */
function truncateBody(body) {
  if (typeof body !== 'string') return '';
  if (body.length <= MAX_COMMENT_BODY_LENGTH) return body;
  const cut = body.length - MAX_COMMENT_BODY_LENGTH;
  return `${body.slice(0, MAX_COMMENT_BODY_LENGTH)}\n\n[... truncated ${cut} characters ...]`;
}

/**
 * Fetch comments for a single issue via REST. `since` is applied server-side
 * (native GitHub support). The per-issue comments endpoint only returns
 * results oldest-first with no server-side reverse option.
 *
 * When `since` is absent, page fan-out is bounded by MAX_PAGES -- an issue
 * with far more comments than maxPerIssue would otherwise fetch every page
 * just to keep the newest few. When stopping short, `truncatedPages: true`
 * is returned so callers know more comments exist beyond what was fetched.
 * When `since` is supplied, all matching pages are fetched (uncapped, same
 * as before) and the newest-by-`updated_at` comments are kept, so a
 * recently-edited older comment isn't dropped in favor of an untouched
 * newer-created one.
 * @param {{owner: string, repo: string, number: number}} ref
 * @param {{since?: string, maxPerIssue: number, token?: string}} options
 * @returns {Promise<{comments: Array<{author: string, createdAt: string, updatedAt?: string, body: string}>, totalFetched: number, truncatedPages: boolean}>}
 */
export async function fetchIssueComments({ owner, repo, number }, { since, maxPerIssue, token }) {
  const client = getOctokit(token);
  const params = { owner, repo, issue_number: number, per_page: 100 };
  if (since) params.since = since;

  let all = [];
  let truncatedPages = false;

  if (since) {
    all = await client.paginate(
      'GET /repos/{owner}/{repo}/issues/{issue_number}/comments',
      params
    );
  } else {
    let pages = 0;
    const iterator = client.paginate.iterator(
      'GET /repos/{owner}/{repo}/issues/{issue_number}/comments',
      params
    );
    for await (const { data } of iterator) {
      all.push(...data);
      pages += 1;
      if (pages >= MAX_PAGES) {
        truncatedPages = true;
        break;
      }
    }
  }

  let kept = all;
  if (maxPerIssue > 0) {
    kept = since
      ? [...all].sort((a, b) => (a.updated_at || '').localeCompare(b.updated_at || '')).slice(-maxPerIssue)
      : all.slice(-maxPerIssue);
  }

  return {
    comments: kept.map(c => {
      const comment = {
        author: c.user?.login || '',
        createdAt: c.created_at,
        body: truncateBody(c.body || '')
      };
      // Only surface updatedAt when it differs from createdAt (i.e. the
      // comment was edited) -- keeps the common unedited case compact while
      // making the since-mode retention semantics (governed by updated_at)
      // observable when they actually diverge from createdAt.
      if (c.updated_at && c.updated_at !== c.created_at) {
        comment.updatedAt = c.updated_at;
      }
      return comment;
    }),
    totalFetched: all.length,
    truncatedPages
  };
}

/**
 * List comments across multiple board items in one call. Without `since`,
 * kept comments are the newest by creation; with `since`, the newest by
 * `updated_at` (see fetchIssueComments).
 * @param {Object} options
 * @param {string[]} options.itemIds - Project item (PVTI) IDs, max MAX_ITEMS_PER_CALL
 * @param {string} [options.since] - ISO 8601 timestamp; only comments at/after this time
 * @param {number} [options.maxPerIssue] - Newest comments to keep per issue (default DEFAULT_MAX_PER_ISSUE)
 * @param {string} [options.token] - Optional per-request GitHub token
 * @returns {Promise<Array>} - One entry per itemId, in input order
 */
export async function listIssueCommentsForItems({ itemIds, since, maxPerIssue, token } = {}) {
  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    throw new Error('itemIds must be a non-empty array of project item IDs.');
  }
  if (itemIds.length > MAX_ITEMS_PER_CALL) {
    throw new Error(
      `Too many itemIds (${itemIds.length}). Max ${MAX_ITEMS_PER_CALL} per call -- split into multiple calls.`
    );
  }

  const effectiveMaxPerIssue = Number.isFinite(maxPerIssue) && maxPerIssue > 0
    ? Math.floor(maxPerIssue)
    : DEFAULT_MAX_PER_ISSUE;

  const refs = await resolveItemIssues(itemIds, token);

  const results = [];
  for (const itemId of itemIds) {
    const ref = refs.get(itemId);
    if (!ref) {
      results.push({ itemId, error: 'Item not found or is not an issue' });
      continue;
    }

    try {
      const { comments, totalFetched, truncatedPages } = await fetchIssueComments(ref, {
        since,
        maxPerIssue: effectiveMaxPerIssue,
        token
      });
      results.push({
        itemId,
        repository: `${ref.owner}/${ref.repo}`,
        issueNumber: ref.number,
        commentCount: comments.length,
        totalCommentsFetched: totalFetched,
        truncatedPages,
        comments
      });
    } catch (err) {
      logger.error('Error fetching comments for issue', { itemId, error: err.message });
      results.push({ itemId, error: err.message });
    }
  }

  return results;
}
