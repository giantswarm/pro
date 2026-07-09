/**
 * GitHub REST API Client
 *
 * Provides an authenticated Octokit REST client for GitHub REST-only endpoints
 * not available via GraphQL: sub-issues and issue labels. Includes utilities
 * for parsing issue references, resolving them to integer IDs, and managing
 * labels (validation, add, remove).
 *
 * Supports per-request tokens (for OAuth/HTTP transport) with fallback
 * to the GITHUB_API_TOKEN environment variable (for stdio transport).
 */

import { Octokit } from '@octokit/rest';
import { logger } from './logger.js';

/**
 * Default Octokit instance (uses GITHUB_API_TOKEN env var).
 * Initialized eagerly when the env var is present, otherwise deferred
 * to per-request token usage via getOctokit(token).
 *
 * Exported as `octokit` for backward compatibility and test mocking.
 */
const envToken = process.env.GITHUB_API_TOKEN;
export const octokit = envToken
  ? new Octokit({ auth: envToken, headers: { 'X-GitHub-Api-Version': '2026-03-10' } })
  : null;

/**
 * Get an Octokit REST client. When a per-request token is provided, creates
 * a new instance. Otherwise returns the default singleton (env var based).
 * @param {string} [token] - Optional per-request GitHub API token
 * @returns {Octokit} - Authenticated Octokit instance
 */
export function getOctokit(token) {
  if (token) {
    return new Octokit({
      auth: token,
      headers: {
        'X-GitHub-Api-Version': '2026-03-10'
      }
    });
  }
  if (!octokit) {
    throw new Error(
      'No GitHub token available. Set GITHUB_API_TOKEN or authenticate via OAuth.'
    );
  }
  return octokit;
}

const ISSUE_URL_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/;
const SHORT_REF_RE = /^([^/]+)\/([^#]+)#(\d+)$/;

/**
 * Parse a GitHub issue reference into its component parts.
 * Accepts full URLs or short refs (owner/repo#123).
 * @param {string} input - Issue URL or short reference
 * @returns {{ owner: string, repo: string, issue_number: number }}
 */
export function parseIssueRef(input) {
  if (!input || typeof input !== 'string') {
    throw new Error('Issue reference must be a non-empty string');
  }

  const trimmed = input.trim();

  const urlMatch = trimmed.match(ISSUE_URL_RE);
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2],
      issue_number: parseInt(urlMatch[3], 10)
    };
  }

  const shortMatch = trimmed.match(SHORT_REF_RE);
  if (shortMatch) {
    return {
      owner: shortMatch[1],
      repo: shortMatch[2],
      issue_number: parseInt(shortMatch[3], 10)
    };
  }

  throw new Error(
    `Invalid issue reference: "${input}". ` +
    'Expected a GitHub URL (https://github.com/owner/repo/issues/123) ' +
    'or short ref (owner/repo#123).'
  );
}

/**
 * Resolve an issue reference to its integer ID (required by the sub-issues API).
 *
 * Can be called with:
 *   - A URL or short ref string: resolveIssueId("https://github.com/o/r/issues/1")
 *   - Explicit parts: resolveIssueId("owner", "repo", 123)
 *
 * The last argument may be an options object with a `token` property for per-request auth.
 *
 * @param {string} ownerOrRef - Owner string, issue URL, or short ref
 * @param {string} [repo] - Repository name (when passing explicit parts)
 * @param {number} [issue_number] - Issue number (when passing explicit parts)
 * @param {{ token?: string }} [options] - Options including optional per-request token
 * @returns {Promise<{ id: number, number: number, title: string, html_url: string, state: string, repository: string }>}
 */
export async function resolveIssueId(ownerOrRef, repo, issue_number, options) {
  let owner;

  if (repo !== undefined && issue_number !== undefined) {
    owner = ownerOrRef;
  } else {
    // When called with a single ref string, the second arg may be the options object
    if (typeof repo === 'object' && repo !== null) {
      options = repo;
    }
    const parsed = parseIssueRef(ownerOrRef);
    owner = parsed.owner;
    repo = parsed.repo;
    issue_number = parsed.issue_number;
  }

  const token = options?.token;
  const client = getOctokit(token);

  logger.debug('Resolving issue ID', { owner, repo, issue_number });

  const { data } = await client.rest.issues.get({
    owner,
    repo,
    issue_number
  });

  return {
    id: data.id,
    number: data.number,
    title: data.title,
    state: data.state,
    html_url: data.html_url,
    repository: `${owner}/${repo}`
  };
}

/**
 * Check which of the given label names do not exist in a repository.
 *
 * GitHub's "add labels to issue" REST endpoint silently auto-creates any
 * label name that doesn't already exist, which would let a typo create
 * clutter labels instead of failing loudly. Callers should call this first
 * and reject the request if it returns any missing names.
 *
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string[]} labels - Label names to check
 * @param {string} [token] - Optional per-request GitHub token
 * @returns {Promise<string[]>} - Names that do not exist in the repository
 */
export async function findMissingLabels(owner, repo, labels, token) {
  const client = getOctokit(token);
  const missing = [];
  for (const name of labels) {
    try {
      await client.rest.issues.getLabel({ owner, repo, name });
    } catch (err) {
      if (err.status === 404) {
        missing.push(name);
      } else {
        throw err;
      }
    }
  }
  return missing;
}

/**
 * List the label names currently applied to an issue via REST.
 * Used to snapshot an issue's labels before mutating them, so callers can
 * report which add/remove requests actually changed anything.
 *
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} issue_number - Issue number
 * @param {string} [token] - Optional per-request GitHub token
 * @returns {Promise<string[]>} - Names of labels currently on the issue
 */
export async function listIssueLabels(owner, repo, issue_number, token) {
  const client = getOctokit(token);
  const { data } = await client.rest.issues.listLabelsOnIssue({ owner, repo, issue_number, per_page: 100 });
  return data.map(l => l.name);
}

/**
 * Add labels to an issue via REST.
 * Callers should validate labels with findMissingLabels first to avoid
 * GitHub's auto-create-on-add behavior.
 *
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} issue_number - Issue number
 * @param {string[]} labels - Label names to add
 * @param {string} [token] - Optional per-request GitHub token
 * @returns {Promise<Array>} - The issue's full label list after the update
 */
export async function addLabelsToIssue(owner, repo, issue_number, labels, token) {
  const client = getOctokit(token);
  const { data } = await client.rest.issues.addLabels({ owner, repo, issue_number, labels });
  return data;
}

/**
 * Remove a single label from an issue via REST.
 * Treats a 404 (label not currently applied to the issue) as a no-op rather
 * than an error, since removal is naturally idempotent.
 *
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} issue_number - Issue number
 * @param {string} name - Label name to remove
 * @param {string} [token] - Optional per-request GitHub token
 * @returns {Promise<void>}
 */
export async function removeLabelFromIssue(owner, repo, issue_number, name, token) {
  const client = getOctokit(token);
  try {
    await client.rest.issues.removeLabel({ owner, repo, issue_number, name });
  } catch (err) {
    if (err.status !== 404) {
      throw err;
    }
    logger.debug('removeLabelFromIssue: label already absent from issue', { owner, repo, issue_number, name });
  }
}
