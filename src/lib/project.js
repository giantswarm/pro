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
 * The owner a short repository name ("myrepo") resolves to on the built-in boards.
 */
const DEFAULT_OWNER = 'giantswarm';

const BUILT_IN_BOARDS = {
  roadmap: { id: ROADMAP_BOARD_ID, number: 273, name: 'Roadmap Board', owner: DEFAULT_OWNER },
  customer: { id: CUSTOMER_BOARD_ID, number: 345, name: 'Customer Board', owner: DEFAULT_OWNER }
};

// A board key is also the scheme of the board's resource URIs ({key}://schema).
const BOARD_KEY_RE = /^[a-z][a-z0-9-]*$/;
const EXTRA_BOARD_PROPERTIES = ['id', 'number', 'owner', 'name'];

/**
 * Parse the boards an installation adds to the built-in ones (PRO_EXTRA_BOARDS):
 * a JSON object of board key -> { id, number, owner, name }.
 *   - id: the project's node ID ("PVT_...")
 *   - number: the project's number, as in its URL
 *   - owner: the user or organization a short repository name resolves to
 *   - name: display name (optional, defaults to "<Key> Board")
 * A mistake fails the start instead of serving a board half configured.
 * @param {string} [json] - The value of PRO_EXTRA_BOARDS
 * @returns {Object} - Board registry entries, keyed by board key
 * @throws {Error} - Naming the entry and what is wrong with it
 */
export function parseExtraBoards(json) {
  if (!json?.trim()) return {};

  const fail = message => { throw new Error(`PRO_EXTRA_BOARDS: ${message}`); };

  let entries;
  try {
    entries = JSON.parse(json);
  } catch (error) {
    fail(`not valid JSON (${error.message})`);
  }
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!isObject(entries)) {
    fail('expected a JSON object of board key -> { id, number, owner, name }');
  }

  const boards = {};
  for (const [key, board] of Object.entries(entries)) {
    if (!BOARD_KEY_RE.test(key)) {
      fail(`board key '${key}' must be lowercase letters, digits and hyphens, starting with a letter`);
    }
    if (BUILT_IN_BOARDS[key]) {
      fail(`'${key}' is a built-in board and cannot be redefined`);
    }
    if (!isObject(board)) {
      fail(`board '${key}' must be an object with id, number and owner`);
    }
    const unknown = Object.keys(board).filter(property => !EXTRA_BOARD_PROPERTIES.includes(property));
    if (unknown.length) {
      fail(`board '${key}' has unknown properties: ${unknown.join(', ')}. Accepted: ${EXTRA_BOARD_PROPERTIES.join(', ')}`);
    }
    if (typeof board.id !== 'string' || !board.id.startsWith('PVT_')) {
      fail(`board '${key}' needs "id", the project's node ID (PVT_...)`);
    }
    if (!Number.isInteger(board.number) || board.number < 1) {
      fail(`board '${key}' needs "number", the project's number as in its URL`);
    }
    if (typeof board.owner !== 'string' || !/^[A-Za-z0-9-]+$/.test(board.owner)) {
      fail(`board '${key}' needs "owner", the user or organization a short repository name resolves to`);
    }
    if (board.name !== undefined && (typeof board.name !== 'string' || !board.name.trim())) {
      fail(`board '${key}': "name" must be a non-empty string`);
    }
    boards[key] = {
      id: board.id,
      number: board.number,
      name: board.name?.trim() || `${key[0].toUpperCase()}${key.slice(1)} Board`,
      owner: board.owner
    };
  }
  return boards;
}

/**
 * Board registry mapping human-readable keys to project IDs and metadata:
 * the built-in boards, then the ones PRO_EXTRA_BOARDS adds.
 */
export const BOARDS = { ...BUILT_IN_BOARDS, ...parseExtraBoards(process.env.PRO_EXTRA_BOARDS) };

/**
 * The board keys, for the `board` argument of the tools.
 */
export const BOARD_NAMES = Object.keys(BOARDS);

/**
 * The board keys as prose ("roadmap or customer"), for tool descriptions.
 */
export const BOARD_NAMES_TEXT = new Intl.ListFormat('en', { type: 'disjunction' }).format(BOARD_NAMES);

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
    throw new Error(`Unknown board '${boardKey}'. Valid boards: ${BOARD_NAMES.join(', ')}`);
  }
  return entry.id;
}

/**
 * The owner a short repository name resolves to on a board.
 * @param {string} boardId - GitHub project node ID
 * @returns {string} - The board's owner; the built-in one for a project outside the registry
 */
export function resolveBoardOwner(boardId) {
  return Object.values(BOARDS).find(board => board.id === boardId)?.owner || DEFAULT_OWNER;
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

// The fields list_issues reads of each item, shared by the paged read and
// the read by item ids (LIST_ITEMS_BY_ID_QUERY).
const LIST_ITEM_SELECTION = `
    id
    fieldValues(first: 100) {
      nodes {
        ... on ProjectV2ItemFieldTextValue {
          text
          field {
            ... on ProjectV2FieldCommon {
              name
              dataType
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
      __typename
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
        id
        labels(first: 100) {
          nodes {
            id
            name
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
            ${LIST_ITEM_SELECTION}
          }
        }
      }
    }
  }
`;

// The ids of a page of matching items, without their content: a cheap walk
// of a long listing whose items are then read in parallel by id.
const LIST_ITEM_IDS_QUERY = `
  query GetProjectItemIds($projectId: ID!, $after: String, $filterQuery: String) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: 100, after: $after, query: $filterQuery) {
          pageInfo {
            endCursor
            hasNextPage
          }
          nodes {
            id
          }
        }
      }
    }
  }
`;

// Items by their project item ids, with the same fields as LIST_ITEMS_QUERY
const LIST_ITEMS_BY_ID_QUERY = `
  query GetProjectItemsById($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProjectV2Item {
        ${LIST_ITEM_SELECTION}
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
            ... on ProjectV2IterationField { id name dataType configuration { duration startDay iterations { id title duration startDate } completedIterations { id title duration startDate } } }
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

// An issue's relation lists: "blocked by", "blocking" and "relates to".
// get_issue_details reads a short page of each, list_issue_relations a full one.
const RELATION_FIELDS = ['blockedBy', 'blocking', 'relatesTo'];
const DETAIL_RELATIONS_PAGE = 50;
const RELATIONS_PAGE = 100;
const relationLists = first => RELATION_FIELDS
  .map(field => `${field}(first: ${first}) { totalCount pageInfo { hasNextPage } nodes { number title url state repository { nameWithOwner } } }`)
  .join('\n');

// Open dependency counts of list_issues' issues, by issue node ID. Not part of
// LIST_ITEMS_QUERY: issueDependenciesSummary is non-null, so an error on one
// issue's summary would null that item's content; here it nulls only its node.
const DEPENDENCY_COUNTS_PAGE = 100;
const DEPENDENCY_COUNTS_QUERY = `
  query GetDependencyCounts($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Issue {
        id
        issueDependenciesSummary { blockedBy blocking }
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
          __typename
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

// Issue relations: "blocked by" / "blocking" dependencies and "relates to"
// links, a full page of each (relationLists).
const ISSUE_RELATIONS_QUERY = `
  query GetIssueRelations($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        id
        number
        title
        url
        state
        repository { nameWithOwner }
        ${relationLists(RELATIONS_PAGE)}
      }
    }
  }
`;

// The relations of a board item's issue, for get_issue_details. A request of
// its own: the lists are non-null in GitHub's schema, so an error on a whole
// list nulls the issue, and that must not cost the rest of the details.
const ITEM_RELATIONS_QUERY = `
  query GetItemRelations($id: ID!) {
    node(id: $id) {
      ... on ProjectV2Item {
        content {
          __typename
          ... on Issue {
            ${relationLists(DETAIL_RELATIONS_PAGE)}
          }
        }
      }
    }
  }
`;

// Both issues of a relation write, in one request.
const RELATION_ISSUE_IDS_QUERY = `
  query GetRelationIssueIds($owner: String!, $repo: String!, $number: Int!, $relatedOwner: String!, $relatedRepo: String!, $relatedNumber: Int!) {
    issue: repository(owner: $owner, name: $repo) {
      issue(number: $number) { id }
    }
    related: repository(owner: $relatedOwner, name: $relatedRepo) {
      issue(number: $relatedNumber) { id }
    }
  }
`;

const ADD_BLOCKED_BY_MUTATION = `
  mutation AddBlockedBy($issueId: ID!, $blockingIssueId: ID!) {
    addBlockedBy(input: { issueId: $issueId, blockingIssueId: $blockingIssueId }) {
      issue { id }
    }
  }
`;

const REMOVE_BLOCKED_BY_MUTATION = `
  mutation RemoveBlockedBy($issueId: ID!, $blockingIssueId: ID!) {
    removeBlockedBy(input: { issueId: $issueId, blockingIssueId: $blockingIssueId }) {
      issue { id }
    }
  }
`;

const ADD_RELATES_TO_MUTATION = `
  mutation AddRelatesTo($issueId: ID!, $relatedIssueId: ID!) {
    addRelatesTo(input: { issueId: $issueId, relatedIssueId: $relatedIssueId }) {
      issue { id }
    }
  }
`;

const REMOVE_RELATES_TO_MUTATION = `
  mutation RemoveRelatesTo($issueId: ID!, $relatedIssueId: ID!) {
    removeRelatesTo(input: { issueId: $issueId, relatedIssueId: $relatedIssueId }) {
      issue { id }
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

// Single item lookup by its project item ID: the board it belongs to and the
// issue behind it, so writes can name a missing or misplaced item.
const BOARD_ITEM_QUERY = `
  query GetBoardItem($itemId: ID!) {
    node(id: $itemId) {
      ... on ProjectV2Item {
        id
        project {
          id
          number
        }
        content {
          ... on Issue {
            number
            repository {
              nameWithOwner
            }
          }
        }
      }
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
  LIST_ITEM_IDS_QUERY,
  LIST_ITEMS_BY_ID_QUERY,
  LIST_ITEMS_OVERVIEW_QUERY,
  LIST_FIELDS_QUERY,
  UPDATE_ITEM_FIELD_MUTATION,
  CLEAR_ITEM_FIELD_MUTATION,
  ISSUE_DETAIL_QUERY,
  CREATE_ISSUE_MUTATION,
  ADD_ITEM_TO_PROJECT_MUTATION,
  ARCHIVE_ITEM_MUTATION,
  ISSUE_NODE_ID_QUERY,
  ISSUE_RELATIONS_QUERY,
  ITEM_RELATIONS_QUERY,
  RELATION_ISSUE_IDS_QUERY,
  RELATION_FIELDS,
  DETAIL_RELATIONS_PAGE,
  DEPENDENCY_COUNTS_QUERY,
  DEPENDENCY_COUNTS_PAGE,
  RELATIONS_PAGE,
  ADD_BLOCKED_BY_MUTATION,
  REMOVE_BLOCKED_BY_MUTATION,
  ADD_RELATES_TO_MUTATION,
  REMOVE_RELATES_TO_MUTATION,
  USER_ID_QUERY,
  ITEM_ISSUE_REFS_QUERY,
  BOARD_ITEM_QUERY,
  CLOSE_ISSUE_MUTATION,
  REOPEN_ISSUE_MUTATION,
  ADD_COMMENT_MUTATION
};
