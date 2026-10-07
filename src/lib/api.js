/**
 * GitHub API Communication Module
 *
 * Provides an authenticated GraphQL client and pagination support
 * for the GitHub Projects V2 API.
 *
 * Supports per-request tokens (for OAuth/HTTP transport) with fallback
 * to the GITHUB_API_TOKEN environment variable (for stdio transport).
 */

import { graphql } from '@octokit/graphql';
import { logger } from './logger.js';

/**
 * Resolve the GitHub token to use for a request.
 * Uses the explicit token if provided, otherwise falls back to the env var.
 * @param {string} [token] - Explicit token for this request
 * @returns {string} - The resolved token
 * @throws {Error} - If no token is available
 */
function resolveToken(token) {
  const resolved = token || process.env.GITHUB_API_TOKEN;
  if (!resolved) {
    throw new Error(
      'No GitHub token available. Set GITHUB_API_TOKEN or authenticate via OAuth.'
    );
  }
  return resolved;
}

/**
 * Create a GraphQL client authenticated with the given token.
 * @param {string} token - GitHub API token
 * @returns {Function} - Configured graphql client
 */
function createGraphQLClient(token) {
  return graphql.defaults({
    headers: {
      authorization: `bearer ${token}`
    }
  });
}

/**
 * Make a GraphQL request to GitHub API with authentication.
 * @param {string} query - GraphQL query
 * @param {Object} variables - Query variables
 * @param {string} [token] - Optional per-request token (falls back to GITHUB_API_TOKEN)
 * @returns {Promise<Object>} - Query result
 */
export async function graphQLWithAuth(query, variables = {}, token) {
  const client = createGraphQLClient(resolveToken(token));
  return await client(query, variables);
}

/**
 * Fetch paginated results.
 * @param {string} query - GraphQL query
 * @param {Object} variables - Query variables
 * @param {Function} getNextPage - Function to extract page info from result
 * @param {string} [token] - Optional per-request token (falls back to GITHUB_API_TOKEN)
 * @returns {Promise<Array>} - All results
 */
export async function fetchPaginated(query, variables, getNextPage, token) {
  const { nodes } = await fetchBounded(query, variables, getNextPage, token);
  return nodes;
}

/**
 * Fetch a cursor-paginated connection page by page, keeping the nodes `keep`
 * accepts, until `limit` nodes are kept (0: every page) or the pages run out.
 * Each page asks GitHub for no more nodes than are still missing, capped at
 * `variables.first`, so a small limit costs one small request. A page that
 * announces a next page without a cursor ends the fetch instead of repeating.
 * @param {string} query - GraphQL query taking $first and $after
 * @param {Object} variables - Query variables; `first` caps the page size
 * @param {Function} getNextPage - Function to extract { nodes, pageInfo } from a result
 * @param {string} [token] - Optional per-request token (falls back to GITHUB_API_TOKEN)
 * @param {Object} [options]
 * @param {string|null} [options.after] - Cursor to continue from (an earlier endCursor)
 * @param {number} [options.limit] - Nodes to keep before stopping; 0 keeps every node
 * @param {Function} [options.keep] - Node predicate; a rejected node does not count
 * @returns {Promise<{nodes: Array, hasNextPage: boolean, endCursor: string|null}>}
 *   `hasNextPage` is true when the fetch stopped at the limit with pages
 *   left; `endCursor` continues from there.
 */
export async function fetchBounded(query, variables, getNextPage, token, { after = null, limit = 0, keep = () => true } = {}) {
  const nodes = [];
  let hasNextPage = true;
  let endCursor = after;

  while (hasNextPage && (limit === 0 || nodes.length < limit)) {
    const queryVars = { ...variables };
    if (endCursor) {
      queryVars.after = endCursor;
    }
    if (limit > 0) {
      queryVars.first = Math.min(variables.first ?? limit, limit - nodes.length);
    }

    const result = await graphQLWithAuth(query, queryVars, token);
    const page = getNextPage(result);

    if (Array.isArray(page.nodes)) {
      nodes.push(...page.nodes.filter(keep));
    }

    endCursor = page.pageInfo?.endCursor || null;
    hasNextPage = Boolean(page.pageInfo?.hasNextPage && endCursor);
  }

  return { nodes, hasNextPage, endCursor };
}
