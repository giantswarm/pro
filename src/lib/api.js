/**
 * GitHub API Communication Module
 * 
 * WHY:
 * - Need a consistent interface to interact with GitHub's GraphQL API
 * - GitHub's API often requires pagination to handle large result sets
 * - Authentication and error handling should be centralized
 * 
 * HOW:
 * - Uses Octokit's GraphQL client to make authenticated API requests
 * - Implements pagination helpers to handle large result sets
 * - Verifies API token availability at startup
 * 
 * WHAT:
 * - Exports an authenticated GraphQL client for API operations
 * - Provides a fetchPaginated helper to handle paginated queries
 * - Handles different response formats and error conditions
 */

import { graphql } from '@octokit/graphql';

// Ensure GitHub token is set in environment variables
const GITHUB_API_TOKEN = process.env.GITHUB_API_TOKEN;
if (!GITHUB_API_TOKEN) {
  console.error('Error: GITHUB_API_TOKEN environment variable is not set.');
  process.exit(1);
}

// Configure graphql client with authentication
const graphQLWithAuth = graphql.defaults({
  headers: {
    authorization: `bearer ${GITHUB_API_TOKEN}`
  }
});

// Helper function to paginate results
async function fetchPaginated(query, vars, extractData) {
  let allResults = [];
  let after = vars.cursor || null;
  do {
    const callVars = { ...vars };
    if (after) {
      callVars.after = after;
    } else {
      delete callVars.after;
    }

    try {
      const result = await graphQLWithAuth(query, callVars);
      const extracted = extractData(result);

      // Handle different response formats
      if (extracted && extracted.nodes && extracted.pageInfo) {
        // Standard format with nodes and pageInfo
        const { nodes, pageInfo } = extracted;
        allResults.push(...nodes);
        after = pageInfo.hasNextPage ? pageInfo.endCursor : null;
      } else if (Array.isArray(extracted)) {
        // Direct array of items
        allResults.push(...extracted);
        after = null; // No pagination for this format
      } else {
        // Unknown format, just store the result as is
        allResults.push(extracted);
        after = null;
      }
    } catch (error) {
      console.error('Error fetching data:', error.message);
      after = null; // Stop pagination on error
    }
  } while (after);

  return allResults;
}

export { graphQLWithAuth, fetchPaginated };
