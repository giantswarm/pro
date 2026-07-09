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
  const allItems = [];
  let hasNextPage = true;
  let after = null;

  while (hasNextPage) {
    const queryVars = { ...variables };
    if (after) {
      queryVars.after = after;
    }

    const result = await graphQLWithAuth(query, queryVars, token);
    const pageInfo = getNextPage(result);

    if (pageInfo.nodes && Array.isArray(pageInfo.nodes)) {
      allItems.push(...pageInfo.nodes);
    }

    hasNextPage = pageInfo.pageInfo && pageInfo.pageInfo.hasNextPage;
    after = pageInfo.pageInfo && pageInfo.pageInfo.endCursor;
  }

  return allItems;
}
