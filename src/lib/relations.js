/**
 * Issue Relations Core Module
 *
 * Plain functions for GitHub's issue relations besides parent/child
 * (sub-issues.js): "blocked by" / "blocking" dependencies and "relates to"
 * links. GitHub exposes them through GraphQL only, by issue node ID, and
 * across repositories.
 *
 * All functions take explicit { owner, repo, issue_number } targets plus an
 * optional per-request token (falls back to GITHUB_API_TOKEN).
 */

import { graphQLWithAuth, withPartialData } from './api.js';
import { logger } from './logger.js';
import {
  ISSUE_RELATIONS_QUERY,
  ITEM_RELATIONS_QUERY,
  RELATION_ISSUE_IDS_QUERY,
  RELATION_FIELDS,
  DEPENDENCY_COUNTS_QUERY,
  DEPENDENCY_COUNTS_PAGE,
  ADD_BLOCKED_BY_MUTATION,
  REMOVE_BLOCKED_BY_MUTATION,
  ADD_RELATES_TO_MUTATION,
  REMOVE_RELATES_TO_MUTATION
} from './project.js';

/**
 * The relations a caller can set, read from the issue it names:
 *   - blocked_by: the related issue blocks the issue
 *   - blocking:   the issue blocks the related issue (blocked_by, reversed)
 *   - relates_to: the two issues are related
 */
export const RELATION_TYPES = ['blocked_by', 'blocking', 'relates_to'];

/**
 * Whether a GraphQL error lies inside a relation list: a related issue the
 * token cannot read, or one that was deleted. It costs that issue, not the
 * answer.
 */
export { RELATION_FIELDS };

export const inRelationList = error => Boolean(error.path?.some(p => RELATION_FIELDS.includes(p)));

/**
 * Whether a GraphQL error is on a whole relation list (the list itself, its
 * totalCount or pageInfo), not on one issue in it.
 */
const onRelationList = error => {
  const at = error.path?.findIndex(p => RELATION_FIELDS.includes(p)) ?? -1;
  return at >= 0 && error.path[at + 1] !== 'nodes';
};

/**
 * Compact one related issue from a relation connection node.
 * @param {Object} node - Issue node ({ number, title, url, state, repository })
 * @returns {{ number: number, title: string, url: string, state: string, repository: string|null }}
 *   - the shape of a sub-issue in sub-issues.js: lowercase state, `repository` as owner/name
 */
export function compactRelatedIssue(node) {
  return {
    number: node.number,
    title: node.title,
    url: node.url,
    state: node.state?.toLowerCase(),
    repository: node.repository?.nameWithOwner ?? null
  };
}

/**
 * Compact a relation connection to its issues. `truncated` and `totalCount`
 * flag a connection with a next page. `hidden` counts the issues the caller
 * cannot see: nodes read as null (no access, deleted) and, on a last page,
 * the issues totalCount counts that GitHub left out of the nodes.
 * @param {{ totalCount?: number, pageInfo?: { hasNextPage: boolean }, nodes?: Array }} [connection]
 * @returns {{ issues: Array, hidden?: number, truncated?: true, totalCount?: number }}
 */
export function compactRelation(connection) {
  const nodes = connection?.nodes ?? [];
  const relation = { issues: nodes.filter(Boolean).map(compactRelatedIssue) };
  const totalCount = connection?.totalCount ?? nodes.length;
  const truncated = Boolean(connection?.pageInfo?.hasNextPage);
  const left = truncated ? 0 : Math.max(totalCount - nodes.length, 0);
  const hidden = nodes.length - relation.issues.length + left;
  if (hidden > 0) relation.hidden = hidden;
  if (truncated) Object.assign(relation, { truncated: true, totalCount });
  return relation;
}

/**
 * The error to report when an issue's relations could not be read at all:
 * the one on a whole relation list, which nulls the issue, rather than one
 * on an issue inside a list.
 * @param {Array} errors - GraphQL errors
 * @returns {Object|undefined}
 */
const relationListError = errors => errors.find(onRelationList) ?? errors[0];

/** GitHub's answer for a missing repository or issue of the ones named. */
const isNotFound = error => error.type === 'NOT_FOUND';
/** The same, for the repository/issue a query is rooted at (`repository`, `issue`, `related`). */
const isRootNotFound = error => isNotFound(error) && (error.path?.length ?? 0) <= 2;

const notFound = ({ owner, repo, issue_number }) =>
  new Error(`Issue ${owner}/${repo}#${issue_number} not found or not accessible`);

/**
 * List an issue's relations (a full page of each kind: RELATIONS_PAGE).
 * @param {{ owner: string, repo: string, issue_number: number }} target
 * @param {string} [token] - Optional per-request GitHub token
 * @returns {Promise<{ issue: Object, blockedBy: Object, blocking: Object, relatesTo: Object }>}
 */
export async function listIssueRelations({ owner, repo, issue_number }, token) {
  // A missing issue is named below; an unreadable related issue is left out
  // of its list and counted as hidden.
  const { data, errors } = await withPartialData(
    graphQLWithAuth(ISSUE_RELATIONS_QUERY, { owner, repo, number: issue_number }, token),
    error => isRootNotFound(error) || inRelationList(error)
  );
  const issue = data?.repository?.issue;
  if (!issue) {
    // An error on a whole relation list nulls the issue too (the lists are
    // non-null); that is no missing issue, so its message is passed on.
    const other = relationListError(errors.filter(e => !isRootNotFound(e)));
    throw other ? Object.assign(new Error(other.message), { errors }) : notFound({ owner, repo, issue_number });
  }
  if (errors.length > 0) {
    logger.warn('Issue relations partly unreadable', { owner, repo, issue_number, errors: errors.map(e => e.message) });
  }
  return {
    issue: compactRelatedIssue(issue),
    blockedBy: compactRelation(issue.blockedBy),
    blocking: compactRelation(issue.blocking),
    relatesTo: compactRelation(issue.relatesTo)
  };
}

/**
 * The relations of a board item's issue (a short page of each), or null when
 * the item holds no issue (a pull request, a draft). An error on a whole
 * relation list is thrown; an unreadable related issue is counted as hidden.
 * @param {string} itemId - The project item ID
 * @param {string} [token] - Optional per-request GitHub token
 * @returns {Promise<{ blockedBy: Object, blocking: Object, relatesTo: Object }|null>}
 */
export async function getItemRelations(itemId, token) {
  const { data, errors } = await withPartialData(
    graphQLWithAuth(ITEM_RELATIONS_QUERY, { id: itemId }, token),
    inRelationList
  );
  const content = data?.node?.content;
  if (!content) {
    if (errors.length > 0) throw Object.assign(new Error(relationListError(errors).message), { errors });
    return null;
  }
  if (content.__typename !== 'Issue') return null;
  if (errors.length > 0) {
    logger.warn('Issue relations partly unreadable', { itemId, errors: errors.map(e => e.message) });
  }
  return {
    blockedBy: compactRelation(content.blockedBy),
    blocking: compactRelation(content.blocking),
    relatesTo: compactRelation(content.relatesTo)
  };
}

/**
 * The open dependency counts of issues, by issue node ID, for list_issues,
 * read in pages of DEPENDENCY_COUNTS_PAGE at once. An issue whose counts
 * cannot be read is left out of the map; a page that fails costs its issues
 * only, and `error` names the first such failure.
 * @param {string[]} issueIds - Issue node IDs
 * @param {string} [token] - Optional per-request GitHub token
 * @returns {Promise<{ counts: Map<string, { blockedBy: number, blocking: number }>, error?: string }>}
 */
export async function getDependencyCounts(issueIds, token) {
  const pages = [];
  for (let i = 0; i < issueIds.length; i += DEPENDENCY_COUNTS_PAGE) {
    pages.push(issueIds.slice(i, i + DEPENDENCY_COUNTS_PAGE));
  }
  const answers = await Promise.allSettled(pages.map(ids => withPartialData(
    graphQLWithAuth(DEPENDENCY_COUNTS_QUERY, { ids }, token),
    // Every node is nullable: an error costs that issue's counts only.
    error => error.path?.[0] === 'nodes' && error.path.length > 1
  )));
  const counts = new Map();
  let error;
  for (const answer of answers) {
    if (answer.status === 'rejected') {
      logger.warn('Dependency counts unreadable', { error: answer.reason?.message });
      error ??= answer.reason?.message ?? String(answer.reason);
      continue;
    }
    const { data, errors } = answer.value;
    if (errors.length > 0) {
      logger.warn('Dependency counts partly unreadable', { errors: errors.map(e => e.message) });
    }
    for (const node of data?.nodes ?? []) {
      if (node?.id && node.issueDependenciesSummary) counts.set(node.id, node.issueDependenciesSummary);
    }
  }
  return { counts, ...(error ? { error } : {}) };
}

async function setIssueRelation(issue, relation, related, remove, token) {
  if (!RELATION_TYPES.includes(relation)) {
    throw new Error(`Unknown relation '${relation}'. Expected one of: ${RELATION_TYPES.join(', ')}`);
  }
  if (issue.owner.toLowerCase() === related.owner.toLowerCase()
    && issue.repo.toLowerCase() === related.repo.toLowerCase()
    && issue.issue_number === related.issue_number) {
    throw new Error('An issue cannot be related to itself');
  }
  const { data: ids } = await withPartialData(graphQLWithAuth(RELATION_ISSUE_IDS_QUERY, {
    owner: issue.owner,
    repo: issue.repo,
    number: issue.issue_number,
    relatedOwner: related.owner,
    relatedRepo: related.repo,
    relatedNumber: related.issue_number
  }, token), isRootNotFound);
  const issueId = ids?.issue?.issue?.id;
  const relatedId = ids?.related?.issue?.id;
  if (!issueId) throw notFound(issue);
  if (!relatedId) throw notFound(related);
  // A renamed or transferred repository can name one issue two ways.
  if (issueId === relatedId) throw new Error('An issue cannot be related to itself');
  if (relation === 'relates_to') {
    const mutation = remove ? REMOVE_RELATES_TO_MUTATION : ADD_RELATES_TO_MUTATION;
    await graphQLWithAuth(mutation, { issueId, relatedIssueId: relatedId }, token);
    return;
  }
  // "blocking" is "blocked by" with the two issues swapped.
  const [blockedId, blockingId] = relation === 'blocked_by' ? [issueId, relatedId] : [relatedId, issueId];
  const mutation = remove ? REMOVE_BLOCKED_BY_MUTATION : ADD_BLOCKED_BY_MUTATION;
  await graphQLWithAuth(mutation, { issueId: blockedId, blockingIssueId: blockingId }, token);
}

/**
 * Set a relation between two issues.
 * @param {{ owner: string, repo: string, issue_number: number }} issue - The issue the relation is read from
 * @param {'blocked_by'|'blocking'|'relates_to'} relation
 * @param {{ owner: string, repo: string, issue_number: number }} related - The other issue
 * @param {string} [token] - Optional per-request GitHub token
 * @returns {Promise<void>}
 */
export async function addIssueRelation(issue, relation, related, token) {
  await setIssueRelation(issue, relation, related, false, token);
}

/**
 * Remove a relation between two issues.
 * @param {{ owner: string, repo: string, issue_number: number }} issue - The issue the relation is read from
 * @param {'blocked_by'|'blocking'|'relates_to'} relation
 * @param {{ owner: string, repo: string, issue_number: number }} related - The other issue
 * @param {string} [token] - Optional per-request GitHub token
 * @returns {Promise<void>}
 */
export async function removeIssueRelation(issue, relation, related, token) {
  await setIssueRelation(issue, relation, related, true, token);
}
