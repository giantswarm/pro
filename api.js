import { graphql } from '@octokit/graphql';

// Ensure GitHub token is set in environment variables
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) {
  console.error('Error: GITHUB_TOKEN environment variable is not set.');
  process.exit(1);
}

// Configure graphql client with authentication
const graphQLWithAuth = graphql.defaults({
  headers: {
    authorization: `bearer ${GITHUB_TOKEN}`
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
    const result = await graphQLWithAuth(query, callVars);
    const { nodes, pageInfo } = extractData(result);
    allResults.push(...nodes);
    after = pageInfo.hasNextPage ? pageInfo.endCursor : null;
  } while (after);
  return allResults;
}

export { graphQLWithAuth, fetchPaginated };
