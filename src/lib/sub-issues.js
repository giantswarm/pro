/**
 * Sub-Issues Core Module
 *
 * Plain functions for the GitHub sub-issues REST API (parent/child issue
 * relationships). Used by the MCP tool handlers and importable as part of
 * the @giantswarm-io/pro package (e.g. by the Backstage roadmap backend).
 *
 * All functions take an explicit { owner, repo, issue_number } target plus
 * an optional per-request token (falls back to GITHUB_API_TOKEN).
 */

import { getOctokit } from './rest-api.js';

/**
 * List the sub-issues of a parent issue.
 * @param {{ owner: string, repo: string, issue_number: number, per_page?: number, page?: number }} target
 * @param {string} [token] - Optional per-request GitHub token
 * @returns {Promise<Array>} - Array of sub-issue objects (REST issue shape)
 */
export async function listSubIssues({ owner, repo, issue_number, per_page = 30, page = 1 }, token) {
  const client = getOctokit(token);
  const { data } = await client.request(
    'GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues',
    { owner, repo, issue_number, per_page, page }
  );
  return data;
}

/**
 * Add a sub-issue to a parent issue.
 * @param {{ owner: string, repo: string, issue_number: number, subIssueId: number, replaceParent?: boolean }} target
 *   - subIssueId is the child issue's integer ID (not its number)
 * @param {string} [token] - Optional per-request GitHub token
 * @returns {Promise<Object>} - The updated parent issue (REST issue shape)
 */
export async function addSubIssue({ owner, repo, issue_number, subIssueId, replaceParent = false }, token) {
  const client = getOctokit(token);
  const { data } = await client.request(
    'POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues',
    { owner, repo, issue_number, sub_issue_id: subIssueId, replace_parent: replaceParent }
  );
  return data;
}

/**
 * Remove a sub-issue from a parent issue.
 * @param {{ owner: string, repo: string, issue_number: number, subIssueId: number }} target
 * @param {string} [token] - Optional per-request GitHub token
 * @returns {Promise<void>}
 */
export async function removeSubIssue({ owner, repo, issue_number, subIssueId }, token) {
  const client = getOctokit(token);
  await client.request(
    'DELETE /repos/{owner}/{repo}/issues/{issue_number}/sub_issue',
    { owner, repo, issue_number, sub_issue_id: subIssueId }
  );
}

/**
 * Get the parent issue of a given issue.
 * @param {{ owner: string, repo: string, issue_number: number }} target
 * @param {string} [token] - Optional per-request GitHub token
 * @returns {Promise<Object|null>} - The parent issue, or null if the issue has no parent
 */
export async function getParentIssue({ owner, repo, issue_number }, token) {
  const client = getOctokit(token);
  try {
    const { data } = await client.request(
      'GET /repos/{owner}/{repo}/issues/{issue_number}/parent',
      { owner, repo, issue_number }
    );
    return data;
  } catch (error) {
    if (error.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Reorder a sub-issue within its parent's sub-issue list.
 * Exactly one of afterId or beforeId must be provided.
 * @param {{ owner: string, repo: string, issue_number: number, subIssueId: number, afterId?: number, beforeId?: number }} target
 * @param {string} [token] - Optional per-request GitHub token
 * @returns {Promise<void>}
 */
export async function reprioritizeSubIssue({ owner, repo, issue_number, subIssueId, afterId, beforeId }, token) {
  if (!afterId && !beforeId) {
    throw new Error('Provide either afterId or beforeId to specify the new position.');
  }
  const client = getOctokit(token);
  const body = { sub_issue_id: subIssueId };
  if (afterId) body.after_id = afterId;
  if (beforeId) body.before_id = beforeId;
  await client.request(
    'PATCH /repos/{owner}/{repo}/issues/{issue_number}/sub_issues/priority',
    { owner, repo, issue_number, ...body }
  );
}
