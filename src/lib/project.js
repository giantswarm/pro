// Export GraphQL queries and mutations for project operations
export const ROADMAP_BOARD_ID = 'PVT_kwDOAHNM9M4ABvWx';
export const TEAM_FIELD_ID = 'PVTSSF_lADOAHNM9M4ABvWxzgBApUw';
export const KIND_FIELD_ID = 'PVTSSF_lADOAHNM9M4ABvWxzgFLAfM';
export const FUNCTION_FIELD_ID = 'PVTSSF_lADOAHNM9M4ABvWxzgNtoms';
export const WORKSTREAM_FIELD_ID = 'PVTSSF_lADOAHNM9M4ABvWxzgN0pGg';
export const SIG_FIELD_ID = 'PVTSSF_lADOAHNM9M4ABvWxzgNt6n0';
export const WG_FIELD_ID = 'PVTSSF_lADOAHNM9M4ABvWxzgNpxdA';

// Fetch repository id
const REPO_ID_QUERY = `
  query ($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      id
    }
  }
`;

// List items in a project
const LIST_ITEMS_QUERY = `
  query GetProjectItems($projectId: ID!, $first: Int!, $after: String) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: $first, after: $after) {
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

// Query to get project items with their labels
const LIST_ITEMS_WITH_LABELS_QUERY = `
query ListProjectItems($projectId: ID!, $first: Int!, $after: String) {
  node(id: $projectId) {
    ... on ProjectV2 {
      items(first: $first, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          fieldValues(first: 100) {
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
              id
              number
              title
              url
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

// Show field details (reuse LIST_FIELDS_QUERY for pagination)
const SHOW_FIELD_QUERY = LIST_FIELDS_QUERY;

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

const ISSUE_DETAIL_QUERY = `
  query($id: ID!) {
    node(id: $id) {
      ... on ProjectV2Item {
        content {
          ... on Issue {
            bodyText
            author { login }
            assignees (first: 10) {
              nodes { login }
            }
            comments (first: 100) {
              nodes { bodyText }
            }
            projectsV2 (first: 10) {
              nodes { title }
            }
          }
        }
      }
    }
  }
`;

const POST_ISSUE_COMMENT_MUTATION = `
  mutation($issueId: ID!, $body: String!) {
    addComment(input: { subjectId: $issueId, body: $body }) {
      commentEdge {
        node {
          id
        }
      }
    }
  }
`;

export {
  REPO_ID_QUERY,
  LIST_ITEMS_QUERY,
  LIST_ITEMS_WITH_LABELS_QUERY,
  LIST_FIELDS_QUERY,
  SHOW_FIELD_QUERY,
  UPDATE_ITEM_FIELD_MUTATION,
  ISSUE_DETAIL_QUERY,
  POST_ISSUE_COMMENT_MUTATION
};
