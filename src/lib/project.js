/**
 * Project Configuration and GraphQL Queries Module
 *
 * WHY:
 * - GitHub Projects API requires specific GraphQL queries and mutations
 * - Centralizing these queries improves maintainability and consistency
 * - Specific project IDs and field IDs need to be accessible throughout the application
 *
 * HOW:
 * - Defines GraphQL queries and mutations as string constants
 * - Exports these queries for use by other modules
 * - Provides project-specific constants (board ID, field IDs)
 *
 * WHAT:
 * - Contains all GraphQL queries needed for GitHub Projects operations
 * - Defines constants for project board ID and field IDs
 * - Includes queries for fetching items, fields, and metadata
 * - Provides mutations for updating item fields and other operations
 */

// Export GraphQL queries and mutations for project operations
const ROADMAP_BOARD_ID = 'PVT_kwDOAHNM9M4ABvWx';
const CUSTOMER_BOARD_ID = 'PVT_kwDOAHNM9M4AHBOF';

/**
 * Default board key used when no board is specified.
 */
export const DEFAULT_BOARD = 'roadmap';

/**
 * Board registry mapping human-readable keys to project IDs and metadata.
 */
export const BOARDS = {
  roadmap: { id: ROADMAP_BOARD_ID, name: 'Roadmap Board' },
  customer: { id: CUSTOMER_BOARD_ID, name: 'Customer Board' }
};

/**
 * Resolve a board key (e.g. "roadmap", "customer") to its GitHub project node ID.
 * Defaults to DEFAULT_BOARD when boardKey is null/undefined/empty.
 * @param {string} [boardKey] - Board key to resolve
 * @returns {string} - GitHub project node ID
 * @throws {Error} - If the board key is unknown
 */
export function resolveBoardId(boardKey) {
  const key = (boardKey || DEFAULT_BOARD).toLowerCase();
  const entry = BOARDS[key];
  if (!entry) {
    throw new Error(`Unknown board '${boardKey}'. Valid boards: ${Object.keys(BOARDS).join(', ')}`);
  }
  return entry.id;
}

// Fetch repository id
const REPO_ID_QUERY = `
  query ($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      id
    }
  }
`;

// Lightweight query for overview statistics (Status + repository only).
// Skips text, date, iteration, milestone fields, assignees, and labels
// to stay well within MCP resource timeouts on large boards.
const LIST_ITEMS_OVERVIEW_QUERY = `
  query GetProjectItemsOverview($projectId: ID!, $first: Int!, $after: String) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: $first, after: $after) {
          totalCount
          pageInfo {
            endCursor
            hasNextPage
          }
          nodes {
            fieldValues(first: 8) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field {
                    ... on ProjectV2FieldCommon {
                      name
                    }
                  }
                }
              }
            }
            content {
              ... on Issue {
                title
                repository {
                  nameWithOwner
                }
              }
            }
          }
        }
      }
    }
  }
`;

// List items in a project
const LIST_ITEMS_QUERY = `
  query GetProjectItems($projectId: ID!, $first: Int!, $after: String, $filterQuery: String) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: $first, after: $after, query: $filterQuery) {
          totalCount
          pageInfo {
            endCursor
            hasNextPage
            startCursor
          }
          nodes {
            id
            fieldValues(first: 100) {
              nodes {
                ... on ProjectV2ItemFieldTextValue {
                  text
                  field {
                    ... on ProjectV2FieldCommon {
                      name
                    }
                  }
                }
                ... on ProjectV2ItemFieldDateValue {
                  date
                  field {
                    ... on ProjectV2FieldCommon {
                      name
                    }
                  }
                }
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field {
                    ... on ProjectV2FieldCommon {
                      name
                    }
                  }
                }
                ... on ProjectV2ItemFieldIterationValue {
                  duration
                  iterationId
                  startDate
                  title
                  field {
                    ... on ProjectV2FieldCommon {
                      name
                    }
                  }
                }
                ... on ProjectV2ItemFieldMilestoneValue {
                  milestone {
                    title
                    description
                    dueOn
                  }
                  field {
                    ... on ProjectV2FieldCommon {
                      name
                    }
                  }
                }
              }
            }
            content {
              ... on Issue {
                title
                number
                url
                state
                createdAt
                updatedAt
                closedAt
                repository {
                  nameWithOwner
                  isPrivate
                  url
                }
                assignees(first: 100) {
                  nodes {
                    login
                  }
                }
                labels(first: 100) {
                  nodes {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

// List fields in a project
const LIST_FIELDS_QUERY = `
  query ($projectId: ID!, $first: Int!, $after: String) {
    node(id: $projectId) {
      ... on ProjectV2 {
        fields(first: $first, after: $after) {
          nodes {
            __typename
            ... on ProjectV2Field { id name dataType }
            ... on ProjectV2SingleSelectField { id name dataType options { id name color description } }
            ... on ProjectV2IterationField { id name dataType configuration { duration startDay iterations { id title duration startDate } } }
          }
          pageInfo { endCursor hasNextPage }
        }
      }
    }
  }
`;

// Mutation to update a field value for a project item
const UPDATE_ITEM_FIELD_MUTATION = `
mutation UpdateProjectV2ItemField($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
  updateProjectV2ItemFieldValue(
    input: {
      projectId: $projectId,
      itemId: $itemId,
      fieldId: $fieldId,
      value: $value
    }
  ) {
    projectV2Item {
      id
    }
  }
}
`;

const CLEAR_ITEM_FIELD_MUTATION = `
mutation ClearProjectV2ItemField($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
  clearProjectV2ItemFieldValue(
    input: {
      projectId: $projectId,
      itemId: $itemId,
      fieldId: $fieldId
    }
  ) {
    projectV2Item {
      id
    }
  }
}
`;

const ISSUE_DETAIL_QUERY = `
  query($id: ID!) {
    node(id: $id) {
      ... on ProjectV2Item {
        id
        fieldValues(first: 100) {
          nodes {
            ... on ProjectV2ItemFieldTextValue {
              text
              field {
                ... on ProjectV2FieldCommon {
                  name
                }
              }
            }
            ... on ProjectV2ItemFieldDateValue {
              date
              field {
                ... on ProjectV2FieldCommon {
                  name
                }
              }
            }
            ... on ProjectV2ItemFieldSingleSelectValue {
              name
              field {
                ... on ProjectV2FieldCommon {
                  name
                }
              }
            }
            ... on ProjectV2ItemFieldIterationValue {
              title
              field {
                ... on ProjectV2FieldCommon {
                  name
                }
              }
            }
            ... on ProjectV2ItemFieldMilestoneValue {
              milestone {
                title
              }
              field {
                ... on ProjectV2FieldCommon {
                  name
                }
              }
            }
          }
        }
        content {
          ... on Issue {
            id
            title
            number
            url
            repository {
              nameWithOwner
              isPrivate
              url
            }
            body
            createdAt
            updatedAt
            closedAt
            author { login }
            assignees (first: 10) {
              nodes { login }
            }
            comments (first: 100) {
              nodes {
                body
                createdAt
                author { login }
              }
            }
            projectsV2 (first: 10) {
              nodes { title }
            }
            labels(first: 100) {
              nodes {
                name
              }
            }
          }
        }
      }
    }
  }
`;

// Mutation to create a new issue in a repository
const CREATE_ISSUE_MUTATION = `
  mutation CreateIssue($repositoryId: ID!, $title: String!, $body: String, $assigneeIds: [ID!]) {
    createIssue(input: {
      repositoryId: $repositoryId,
      title: $title,
      body: $body,
      assigneeIds: $assigneeIds
    }) {
      issue {
        id
        number
        url
        title
      }
    }
  }
`;

// Mutation to add an existing issue/PR to a project board
const ADD_ITEM_TO_PROJECT_MUTATION = `
  mutation AddProjectV2ItemById($projectId: ID!, $contentId: ID!) {
    addProjectV2ItemById(input: {
      projectId: $projectId,
      contentId: $contentId
    }) {
      item {
        id
      }
    }
  }
`;

// Mutation to archive a project item
const ARCHIVE_ITEM_MUTATION = `
  mutation ArchiveProjectV2Item($projectId: ID!, $itemId: ID!) {
    archiveProjectV2Item(input: {
      projectId: $projectId,
      itemId: $itemId
    }) {
      item {
        id
      }
    }
  }
`;

// Query to look up an issue node ID from its URL components
const ISSUE_NODE_ID_QUERY = `
  query GetIssueNodeId($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        id
      }
    }
  }
`;

const USER_ID_QUERY = `
  query GetUserNodeId($login: String!) {
    user(login: $login) {
      id
    }
  }
`;

// Batched lookup: resolve a list of ProjectV2Item IDs to their underlying
// issue's node ID, repository + number in a single round trip, using GitHub's
// root-level `nodes(ids:)` query. The response array is in the same order
// as the requested `ids` (entries are null for items that don't resolve to
// an Issue, e.g. deleted or inaccessible content). Includes the repository's
// visibility so callers can gate free-text writes (e.g. comments) to public
// repos behind an explicit confirmation.
const ITEM_ISSUE_REFS_QUERY = `
  query GetItemIssueRefs($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProjectV2Item {
        id
        content {
          ... on Issue {
            id
            number
            repository {
              isPrivate
              nameWithOwner
            }
          }
        }
      }
    }
  }
`;

// Mutation to close an issue
const CLOSE_ISSUE_MUTATION = `
  mutation CloseIssue($issueId: ID!, $stateReason: IssueClosedStateReason) {
    closeIssue(input: { issueId: $issueId, stateReason: $stateReason }) {
      issue {
        id
        number
        state
        stateReason
        url
      }
    }
  }
`;

// Mutation to reopen an issue
const REOPEN_ISSUE_MUTATION = `
  mutation ReopenIssue($issueId: ID!) {
    reopenIssue(input: { issueId: $issueId }) {
      issue {
        id
        number
        state
        url
      }
    }
  }
`;

// Mutation to add a comment to an issue (used to post a comment before
// closing/reopening when the caller supplies one)
const ADD_COMMENT_MUTATION = `
  mutation AddComment($subjectId: ID!, $body: String!) {
    addComment(input: { subjectId: $subjectId, body: $body }) {
      commentEdge {
        node {
          id
          url
        }
      }
    }
  }
`;

export {
  REPO_ID_QUERY,
  LIST_ITEMS_QUERY,
  LIST_ITEMS_OVERVIEW_QUERY,
  LIST_FIELDS_QUERY,
  UPDATE_ITEM_FIELD_MUTATION,
  CLEAR_ITEM_FIELD_MUTATION,
  ISSUE_DETAIL_QUERY,
  CREATE_ISSUE_MUTATION,
  ADD_ITEM_TO_PROJECT_MUTATION,
  ARCHIVE_ITEM_MUTATION,
  ISSUE_NODE_ID_QUERY,
  USER_ID_QUERY,
  ITEM_ISSUE_REFS_QUERY,
  CLOSE_ISSUE_MUTATION,
  REOPEN_ISSUE_MUTATION,
  ADD_COMMENT_MUTATION
};
