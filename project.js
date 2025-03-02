// Export GraphQL queries and mutations for project operations

// List projects for a repository
const LIST_PROJECTS_REPO_QUERY = `
  query ($owner: String!, $repo: String!, $first: Int!, $after: String) {
    repository(owner: $owner, name: $repo) {
      projectsV2(first: $first, after: $after) {
        nodes { id title number }
        pageInfo { endCursor hasNextPage }
      }
    }
  }
`;

// List projects for an organization
const LIST_PROJECTS_ORG_QUERY = `
  query ($org: String!, $first: Int!, $after: String) {
    organization(login: $org) {
      projectsV2(first: $first, after: $after) {
        nodes { id title number }
        pageInfo { endCursor hasNextPage }
      }
    }
  }
`;

// Fetch repository id
const REPO_ID_QUERY = `
  query ($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      id
    }
  }
`;

// Create a project
const CREATE_PROJECT_MUTATION = `
  mutation ($repositoryId: ID!, $title: String!) {
    createProjectV2(input: { repositoryId: $repositoryId, title: $title }) {
      projectV2 { id title }
    }
  }
`;

// Delete a project
const DELETE_PROJECT_MUTATION = `
  mutation ($projectId: ID!) {
    deleteProjectV2(input: { projectId: $projectId }) {
      projectV2 { id }
    }
  }
`;

// Update a project title
const UPDATE_PROJECT_MUTATION = `
  mutation ($projectId: ID!, $title: String!) {
    updateProjectV2(input: { projectId: $projectId, title: $title }) {
      projectV2 { id title }
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
                ... on ProjectV2ItemFieldNumberValue {
                  number
                  field {
                    ... on ProjectV2FieldCommon {
                      name
                    }
                  }
                }
                ... on ProjectV2ItemFieldRepositoryValue {
                  repository {
                    name
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
                repository {
                  name
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
              number
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

module.exports = {
  LIST_PROJECTS_REPO_QUERY,
  LIST_PROJECTS_ORG_QUERY,
  REPO_ID_QUERY,
  CREATE_PROJECT_MUTATION,
  DELETE_PROJECT_MUTATION,
  UPDATE_PROJECT_MUTATION,
  LIST_ITEMS_QUERY,
  LIST_ITEMS_WITH_LABELS_QUERY,
  LIST_FIELDS_QUERY,
  SHOW_FIELD_QUERY,
  UPDATE_ITEM_FIELD_MUTATION
};
