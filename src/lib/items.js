/**
 * Items Management Module
 *
 * Provides functions to list, filter, and update GitHub Project V2 items
 * on a given project board, and to resolve items to their underlying issues
 * (see resolveItemIssues). All functions return data directly
 * without console output.
 */

import { fetchBounded, graphQLWithAuth } from './api.js';
import {
  LIST_ITEMS_QUERY,
  LIST_ITEM_IDS_QUERY,
  LIST_ITEMS_BY_ID_QUERY,
  ISSUE_DETAIL_QUERY,
  ITEM_ISSUE_REFS_QUERY,
  BOARD_ITEM_QUERY,
  BOARDS,
  DEFAULT_BOARD,
  UPDATE_ITEM_FIELD_MUTATION,
  CLEAR_ITEM_FIELD_MUTATION
} from './project.js';
import { listFields, findMatchingOption, findMatchingIteration } from './fields.js';
import { parseIssueRef } from './rest-api.js';
import { logger } from './logger.js';

function escapeProjectQueryValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Get detailed information about an item by its project item ID
 * @param {string} itemId - The project item ID
 * @param {string} [token] - Optional per-request GitHub token
 * @returns {Promise<Object>} - Extracted item data
 */
export async function getItemByID(itemId, token) {
  let item = {
    number: '',
    title: '',
    url: '',
    repository: null,
    body: '',
    author: '',
    assignees: [],
    comments: [],
    labels: [],
    projects: [],
    fields: [],
    createdAt: null,
    updatedAt: null,
    closedAt: null
  };

  try {
    const issueDetails = await graphQLWithAuth(ISSUE_DETAIL_QUERY, { id: itemId }, token);
    if (!issueDetails?.node) {
      throw new Error('Project item not found');
    }

    if (issueDetails.node.fieldValues?.nodes) {
      item.fields = issueDetails.node.fieldValues.nodes
        .filter(fieldValue => fieldValue?.field?.name)
        .map(fieldValue => ({
          name: fieldValue.field.name,
          value:
            fieldValue.name ??
            fieldValue.text ??
            fieldValue.date ??
            fieldValue.title ??
            fieldValue.milestone?.title ??
            ''
        }));
    }

    if (issueDetails.node.content) {
      item.number = issueDetails.node.content.number || '';
      item.title = issueDetails.node.content.title || '';
      item.url = issueDetails.node.content.url || '';
      item.repository = issueDetails.node.content.repository
        ? {
            nameWithOwner: issueDetails.node.content.repository.nameWithOwner,
            isPrivate: issueDetails.node.content.repository.isPrivate,
            url: issueDetails.node.content.repository.url
          }
        : null;
      item.author = issueDetails.node.content.author?.login || '';
      item.body = issueDetails.node.content.body || '';

      item.createdAt = issueDetails.node.content.createdAt || null;
      item.updatedAt = issueDetails.node.content.updatedAt || null;
      item.closedAt = issueDetails.node.content.closedAt || null;

      if (issueDetails.node.content.assignees?.nodes) {
        item.assignees = issueDetails.node.content.assignees.nodes.map(a => a.login);
      }
      if (issueDetails.node.content.comments?.nodes) {
        item.comments = issueDetails.node.content.comments.nodes.map(c => ({
          body: c.body,
          createdAt: c.createdAt,
          author: c.author?.login || ''
        }));
      }
      if (issueDetails.node.content.labels?.nodes) {
        item.labels = issueDetails.node.content.labels.nodes.map(l => l.name);
      }
      if (issueDetails.node.content.projectsV2?.nodes) {
        item.projects = issueDetails.node.content.projectsV2.nodes.map(p => p.title);
      }
    }
  } catch (err) {
    logger.error(`Error fetching issue details: ${err.message}`);
    throw new Error(`Failed to fetch issue details for item '${itemId}': ${err.message}`);
  }

  return item;
}

/**
 * Resolve a batch of project item IDs to their underlying issues in a single
 * batched GraphQL `nodes(ids:)` request (single item = array of one). This is
 * THE item -> issue resolution mechanism: consumers that only need the issue
 * ref (node ID, repo, number, visibility) should use this rather than the
 * full-payload getItemByID detail fetch.
 * @param {string[]} itemIds - Project item (PVTI) IDs
 * @param {string} [token] - Optional per-request GitHub token
 * @returns {Promise<Map<string, {issueId: string, owner: string, repo: string, number: number, isPrivate: boolean, nameWithOwner: string}|null>>}
 *   Map from itemId to its issue ref, or null when the item doesn't resolve
 *   to an accessible Issue (e.g. draft, deleted, or inaccessible content).
 */
export async function resolveItemIssues(itemIds, token) {
  const result = await graphQLWithAuth(ITEM_ISSUE_REFS_QUERY, { ids: itemIds }, token);
  const nodes = result?.nodes || [];
  const refs = new Map();

  itemIds.forEach((itemId, i) => {
    const content = nodes[i]?.content;
    const nameWithOwner = content?.repository?.nameWithOwner;
    if (!content?.id || !nameWithOwner || !content.number) {
      refs.set(itemId, null);
      return;
    }
    const [owner, repo] = nameWithOwner.split('/');
    refs.set(itemId, {
      issueId: content.id,
      owner,
      repo,
      number: content.number,
      isPrivate: content.repository.isPrivate,
      nameWithOwner
    });
  });

  return refs;
}

/**
 * Resolve one project item by its project item ID and check it is on the
 * given board. Writes against a board (field updates, archiving) call this
 * first so a wrong, deleted or misplaced item ID fails with an error that
 * names the item and the board instead of a GraphQL or type error.
 * @param {string} itemId - Project item (PVTI) ID
 * @param {string} boardKey - Board key (e.g. "roadmap", "customer")
 * @param {string} [token] - Optional per-request GitHub token
 * @returns {Promise<{id: string, issue: string|null}>} - The item, with its
 *   issue as "owner/repo#N" (null for draft issues and unreadable content)
 * @throws {Error} - When the item does not exist or is on another board
 */
export async function resolveBoardItem(itemId, boardKey, token) {
  const key = (boardKey || DEFAULT_BOARD).toLowerCase();
  const board = BOARDS[key];
  if (!board) {
    throw new Error(`Unknown board '${boardKey}'. Valid boards: ${Object.keys(BOARDS).join(', ')}`);
  }
  const boardName = `the ${key} board (#${board.number})`;

  let node = null;
  try {
    const result = await graphQLWithAuth(BOARD_ITEM_QUERY, { itemId }, token);
    node = result?.node;
  } catch (error) {
    // GitHub answers an unknown node ID with a NOT_FOUND error.
    if (!error.errors?.some(e => e.type === 'NOT_FOUND')) throw error;
  }

  if (!node?.project?.id) {
    throw new Error(`No item '${itemId}' on ${boardName}: the item ID does not resolve to a project item. Look it up with get_item_by_issue.`);
  }

  const content = node.content;
  const issue = content?.number && content.repository?.nameWithOwner
    ? `${content.repository.nameWithOwner}#${content.number}`
    : null;

  if (node.project.id !== board.id) {
    throw new Error(`No item for ${issue || `'${itemId}'`} on ${boardName}: item '${itemId}' belongs to project #${node.project.number}.`);
  }

  return { id: node.id, issue };
}

/**
 * Derive a GitHub Projects query key from a field name.
 * E.g. "Working Group" -> "working-group", "SIG" -> "sig", "Team" -> "team"
 *
 * NOTE: This heuristic assumes GitHub Projects accepts query keys that are the
 * lowercased, hyphenated form of the field display name. This holds for all
 * known fields on the roadmap and customer boards. If a board introduces fields
 * where this convention doesn't hold, the server-side filter will silently
 * return no results and the items will need to be filtered client-side instead.
 *
 * @param {string} fieldName - The display name of the field
 * @returns {string} - The query key for server-side filtering
 */
function fieldNameToQueryKey(fieldName) {
  return fieldName.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Resolve a short or full repository name to "owner/name" format.
 * Accepts "myrepo" -> "giantswarm/myrepo" or "giantswarm/myrepo" -> "giantswarm/myrepo".
 *
 * @param {string} repository - Short name or full "owner/name" format
 * @returns {string} - Full "owner/name" format
 */
function resolveRepositoryName(repository) {
  const trimmed = repository.trim();
  if (trimmed.includes('/')) {
    return trimmed;
  }
  return `giantswarm/${trimmed}`;
}

/**
 * The query qualifier of a board field that stands for an issue attribute
 * rather than a project field value, by its data type.
 */
const QUALIFIER_BY_DATA_TYPE = {
  ASSIGNEES: 'assignee',
  LABELS: 'label',
  REPOSITORY: 'repo',
  MILESTONE: 'milestone',
  PARENT_ISSUE: 'parent-issue',
  REVIEWERS: 'reviewers',
  ISSUE_TYPE: 'type',
  CREATED: 'created',
  UPDATED: 'updated',
  CLOSED: 'closed'
};

/** Board field data types the Projects query cannot filter on. */
const UNFILTERABLE_DATA_TYPES = new Set(['TITLE', 'LINKED_PULL_REQUESTS', 'SUB_ISSUES_PROGRESS']);

/**
 * list_issues' own issue filters, which `exclude` takes as keys next to the
 * board's field names, and their query qualifiers.
 */
const ISSUE_FILTER_QUALIFIERS = {
  repository: 'repo',
  assignee: 'assignee',
  label: 'label',
  milestone: 'milestone',
  type: 'type',
  parentIssue: 'parent-issue',
  updated: 'updated',
  created: 'created',
  closed: 'closed',
  reason: 'reason'
};

/** A query value, quoted when it holds whitespace or a quote. */
function queryValue(value) {
  return /[\s"]/.test(value) ? `"${escapeProjectQueryValue(value)}"` : value;
}

/** A comma-separated (OR) list of query values, each quoted on its own. */
function queryValueList(value, mapPart = part => part) {
  return value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => queryValue(mapPart(part)))
    .join(',');
}

/**
 * The query term for an issue-level qualifier.
 * Dates (created, updated, closed) keep GitHub's comparison and range syntax.
 * @throws {Error} When a parent issue is not a URL or owner/repo#number
 */
function qualifierTerm(qualifier, value) {
  switch (qualifier) {
    case 'created':
    case 'updated':
    case 'closed':
      return `${qualifier}:${value}`;
    case 'reason':
      return `reason:${queryValue(value)}`;
    case 'repo':
      return `repo:${queryValueList(value, resolveRepositoryName)}`;
    case 'parent-issue':
      return `parent-issue:${queryValueList(value, part => {
        const { owner, repo, issue_number } = parseIssueRef(part);
        return `${owner}/${repo}#${issue_number}`;
      })}`;
    default:
      return `${qualifier}:${queryValueList(value)}`;
  }
}

/**
 * The query term that matches a board field (or, with issueFilters, one of
 * list_issues' issue filters) against a value.
 *
 * - single-select: option names, validated and resolved to the board's
 *   spelling; comma-separated for OR
 * - iteration: iteration titles (current, upcoming or completed), or
 *   GitHub's keywords such as "@current", "@next", "@previous" and ranges
 * - date and number: GitHub's comparison syntax (">2026-01-01",
 *   "2026-01-01..2026-03-31", ">1", "@today")
 * - text: the exact text
 * - fields standing for issue attributes (Assignees, Labels, Repository,
 *   Milestone, Parent issue, ...): their issue qualifier
 *
 * @param {string} param - The parameter the entry came from, for errors
 * @param {string} name - Field name (or issue filter name)
 * @param {string} value - Requested value, trimmed
 * @param {Object[]} allFields - The board's fields
 * @param {boolean} issueFilters - Whether issue filter names are accepted
 * @returns {string} - The query term
 * @throws {Error} Naming the unknown field or value and what is available
 */
function fieldTerm(param, name, value, allFields, issueFilters) {
  const field = allFields.find(f => f?.name?.toLowerCase() === name.toLowerCase());
  if (!field) {
    if (issueFilters && ISSUE_FILTER_QUALIFIERS[name]) {
      return qualifierTerm(ISSUE_FILTER_QUALIFIERS[name], value);
    }
    const available = allFields.map(f => f?.name).filter(Boolean);
    const extra = issueFilters ? `; or one of ${Object.keys(ISSUE_FILTER_QUALIFIERS).join(', ')}` : '';
    throw new Error(`${param}: field '${name}' not found. Available fields: ${available.join(', ')}${extra}`);
  }

  const queryKey = fieldNameToQueryKey(field.name);

  if (field.__typename === 'ProjectV2SingleSelectField') {
    const options = field.options || [];
    // An option name may hold a comma: take the whole value first.
    const parts = findMatchingOption(options, value) || !value.includes(',')
      ? [value]
      : value.split(',').map(part => part.trim()).filter(Boolean);
    const names = parts.map(part => {
      const option = findMatchingOption(options, part);
      if (!option) {
        throw new Error(`${param}: value '${part}' not found for field '${field.name}'. Available options: ${options.map(o => o.name).join(', ')}`);
      }
      return `"${escapeProjectQueryValue(option.name)}"`;
    });
    return `${queryKey}:${names.join(',')}`;
  }

  if (field.__typename === 'ProjectV2IterationField') {
    if (value.startsWith('@')) {
      return `${queryKey}:${value}`;
    }
    const configuration = field.configuration || {};
    const iterations = [...(configuration.iterations || []), ...(configuration.completedIterations || [])];
    const titles = value.split(',').map(part => part.trim()).filter(Boolean).map(part => {
      const iteration = findMatchingIteration({ configuration: { iterations } }, part);
      if (!iteration) {
        throw new Error(`${param}: iteration '${part}' not found for field '${field.name}'. Available iterations: ${iterations.map(i => i.title).join(', ')}; or "@current", "@next", "@previous"`);
      }
      return `"${escapeProjectQueryValue(iteration.title)}"`;
    });
    return `${queryKey}:${titles.join(',')}`;
  }

  if (UNFILTERABLE_DATA_TYPES.has(field.dataType)) {
    throw new Error(`${param}: field '${field.name}' cannot be filtered on${field.dataType === 'TITLE' ? '; use keyword' : ''}.`);
  }

  const qualifier = QUALIFIER_BY_DATA_TYPE[field.dataType];
  if (qualifier) {
    return qualifierTerm(qualifier, value);
  }

  if (field.dataType === 'TEXT') {
    return `${queryKey}:"${escapeProjectQueryValue(value)}"`;
  }

  // DATE and NUMBER fields: GitHub's comparison and range syntax as given
  return `${queryKey}:${value}`;
}

/**
 * Read every item of a board listing from a cursor on, in board order.
 *
 * A page of items with their content takes GitHub about 3 s, and the cursors
 * are opaque, so a long listing read page after page grows past the gateway
 * timeout (pro#194). The ids of a page take a third of that: the ids are
 * walked page after page, and each page of ids is read by id as soon as it
 * arrives, while the walk goes on.
 *
 * @param {string} boardId - The GitHub project node ID
 * @param {string|null} filterQuery - The composed project query
 * @param {string} after - Cursor to continue from
 * @param {string} [token] - Optional per-request GitHub token
 * @returns {Promise<Object[]>} - The items, as LIST_ITEMS_QUERY returns them
 */
async function readItemsInParallel(boardId, filterQuery, after, token) {
  const reads = [];
  let cursor = after;
  try {
    while (cursor) {
      const result = await graphQLWithAuth(
        LIST_ITEM_IDS_QUERY,
        { projectId: boardId, filterQuery, after: cursor },
        token
      );
      const page = result?.node?.items;
      const ids = (page?.nodes || []).map(node => node?.id).filter(Boolean);
      if (ids.length > 0) {
        reads.push(graphQLWithAuth(LIST_ITEMS_BY_ID_QUERY, { ids }, token));
      }
      cursor = page?.pageInfo?.hasNextPage ? page.pageInfo.endCursor : null;
    }
  } finally {
    // A failed walk must not leave the reads already started unobserved.
    for (const read of reads) read.catch(() => {});
  }
  const pages = await Promise.all(reads);
  // An item deleted between the walk and the read comes back as null.
  return pages.flatMap(page => (page?.nodes || []).filter(Boolean));
}

/**
 * List and filter items in a project board
 * @param {Object} options - Filtering options
 * @param {string} options.boardId - The GitHub project node ID (required)
 * @param {string} [options.repository] - Filter by repository (short name or "owner/name")
 * @param {Object} [options.filters] - Field name to value map for filtering (any filterable field, see fieldTerm)
 * @param {Object} [options.exclude] - Like filters, negated; also takes the issue filter names
 * @param {string[]} [options.emptyFields] - Return only items where these fields have no value set
 * @param {string[]} [options.nonEmptyFields] - Return only items where these fields have a value set
 * @param {string} [options.assignee] - Filter by assignee GitHub username (comma-separated for OR)
 * @param {string} [options.label] - Filter by label name (comma-separated for OR)
 * @param {string} [options.state] - Filter by issue state: "open" or "closed"
 * @param {string} [options.keyword] - Free text search matching titles and text fields
 * @param {string} [options.milestone] - Filter by milestone title (comma-separated for OR)
 * @param {string} [options.type] - Filter by issue type (comma-separated for OR)
 * @param {string} [options.parentIssue] - Filter by parent issue (URL or owner/repo#number)
 * @param {string} [options.updated] - Filter by last-updated date (e.g. ">@today-7d")
 * @param {string} [options.created] - Filter by creation date (e.g. ">@today-90d")
 * @param {string} [options.closed] - Filter by closed date (e.g. ">@today-30d")
 * @param {string} [options.reason] - Filter by close reason: "completed", "not planned", or "reopened"
 * @param {number} [options.limit] - Stop after this many listed items (0: every item). The
 *   GraphQL pages are sized to the remainder, so a small limit is one small request.
 * @param {string} [options.after] - Cursor of an earlier, cut result (its nextCursor) to continue from
 * @param {string} [options.token] - Optional per-request GitHub token
 * @returns {Promise<Object>} - Result with status and data; `truncated` is true when the
 *   limit stopped the listing with items left, and `nextCursor` then continues it
 */
export async function listItems(options) {
  const first = 100;
  try {
    const {
      boardId, repository = null, filters = {}, exclude = {},
      emptyFields = [], nonEmptyFields = [],
      assignee = null, label = null, state = null, keyword = null,
      milestone = null, type = null, parentIssue = null,
      updated = null, created = null, closed = null, reason = null,
      limit = 0, after = null, token
    } = options;

    if (!boardId) {
      throw new Error('boardId is required');
    }

    // Build server-side filter query
    const queryTerms = [];

    // Issue filters, each in GitHub Projects query syntax. List values are
    // comma-separated for OR matching; a value with spaces is quoted on its
    // own, so "bug fix,enhancement" becomes label:"bug fix",enhancement.
    // Dates (updated, created, closed) are passed through, e.g. ">@today-7d",
    // "<@today-30d", "@today", ">2025-01-01".
    const issueFilters = [
      ['repo', repository],
      ['assignee', assignee],
      ['label', label],
      ['is', state],
      ['milestone', milestone],
      ['type', type],
      ['parent-issue', parentIssue],
      ['updated', updated],
      ['created', created],
      ['closed', closed],
      ['reason', reason]
    ];
    for (const [qualifier, value] of issueFilters) {
      const trimmed = typeof value === 'string' ? value.trim() : '';
      if (!trimmed) continue;
      if (qualifier === 'is') {
        // Issue state filter (is:open, is:closed)
        const lower = trimmed.toLowerCase();
        if (lower === 'open' || lower === 'closed') {
          queryTerms.push(`is:${lower}`);
        }
      } else {
        queryTerms.push(qualifierTerm(qualifier, trimmed));
      }
    }

    // Free text keyword search — appended as bare text to the query string.
    // GitHub Projects matches on word-prefix against titles and text fields.
    // NOTE: Because the keyword is injected as bare text, values resembling
    // query operators (e.g. "is:closed") will be interpreted as such by the
    // GitHub Projects query engine rather than as literal search terms.  This
    // is acceptable since the MCP tool schema documents keyword as free text
    // and the calling LLM should use the dedicated parameters for operators.
    if (keyword) {
      const trimmed = keyword.trim();
      if (trimmed) {
        queryTerms.push(trimmed);
      }
    }

    // Generic field filters, and their negation
    const nonBlank = map => Object.entries(map || {})
      .filter(([, value]) => typeof value === 'string' && value.trim() !== '')
      .map(([name, value]) => [name, value.trim()]);
    const filterEntries = nonBlank(filters).filter(([, value]) => value.toLowerCase() !== 'all');
    const excludeEntries = nonBlank(exclude);

    // Fetch board fields once if needed for filter validation or emptyFields validation
    const needFields = filterEntries.length > 0 || excludeEntries.length > 0 ||
      emptyFields.length > 0 || nonEmptyFields.length > 0;
    const allFields = needFields ? await listFields(boardId, token) : [];

    // Validate emptyFields and nonEmptyFields names against actual board fields
    const allFieldNames = allFields.map(f => f?.name?.toLowerCase());
    for (const [param, names] of [['emptyFields', emptyFields], ['nonEmptyFields', nonEmptyFields]]) {
      for (const fn of names) {
        if (!allFieldNames.some(n => n === fn.toLowerCase())) {
          const available = allFields.map(f => f.name);
          return {
            status: 'error',
            error: `${param}: field '${fn}' not found. Available fields: ${available.join(', ')}`
          };
        }
      }
    }

    try {
      for (const [fieldName, value] of filterEntries) {
        queryTerms.push(fieldTerm('filters', fieldName, value, allFields, false));
      }
      for (const [fieldName, value] of excludeEntries) {
        queryTerms.push(`-${fieldTerm('exclude', fieldName, value, allFields, true)}`);
      }
    } catch (error) {
      return { status: 'error', error: error.message };
    }

    // Add server-side no:<field> filters for emptyFields.
    // GitHub Projects V2 supports "no:<field-key>" to match items where
    // a field has no value set, which avoids fetching the entire board.
    // The client-side filter below is kept as a safety net in case the
    // heuristic in fieldNameToQueryKey doesn't match a particular field.
    for (const fieldName of emptyFields) {
      queryTerms.push(`no:${fieldNameToQueryKey(fieldName)}`);
    }

    // has:<field-key> matches items where the field has a value.
    for (const fieldName of nonEmptyFields) {
      queryTerms.push(`has:${fieldNameToQueryKey(fieldName)}`);
    }

    const projectQuery = queryTerms.join(' ');

    // Generic empty-field filtering (supports single-select, text, date, and iteration fields)
    function hasNonEmptyField(item, fieldName) {
      return item.fieldValues.nodes.some(node => {
        if (!node.field?.name) return false;
        if (node.field.name.toLowerCase() !== fieldName.toLowerCase()) return false;
        const value = node.name ?? node.text ?? node.date ?? node.title ?? '';
        return typeof value === 'string' && value.trim() !== '';
      });
    }

    // Items with null content, or issue content without a title, come from
    // repos the caller's GitHub identity cannot read. They are dropped like
    // before, but counted so callers can tell a complete result from one with
    // items missing. Draft issues and pull requests (no Issue fields selected)
    // are dropped too but are not "hidden": list_issues only lists issues.
    // emptyFields is checked first so items removed by the caller's own
    // filters are never counted.
    function isUnreadable(content) {
      return !content || ((!content.__typename || content.__typename === 'Issue') && !content.title);
    }

    let hidden = 0;
    function isListed(item) {
      if (!item.fieldValues || !item.fieldValues.nodes) return false;

      for (const fieldName of emptyFields) {
        if (hasNonEmptyField(item, fieldName)) {
          return false;
        }
      }

      if (!item.content || !item.content.title) {
        if (isUnreadable(item.content)) hidden++;
        return false;
      }
      return true;
    }

    // totalCount is computed by GitHub for the query as sent (server-side
    // filters applied), including items whose content we cannot read.
    // The pages are read until `limit` listed items are collected, so
    // `hidden` counts the unreadable items among the pages read.
    let totalCount = null;
    const readPage = result => {
      if (!result?.node?.items) {
        return { nodes: [], pageInfo: { hasNextPage: false } };
      }
      if (typeof result.node.items.totalCount === 'number') {
        totalCount = result.node.items.totalCount;
      }
      return {
        nodes: result.node.items.nodes || [],
        pageInfo: result.node.items.pageInfo || { hasNextPage: false }
      };
    };

    let items, hasNextPage, endCursor;
    if (limit === 0) {
      // A full read: the first page as usual, then the rest in parallel.
      const firstPage = readPage(await graphQLWithAuth(
        LIST_ITEMS_QUERY,
        { projectId: boardId, first, after, filterQuery: projectQuery || null },
        token
      ));
      items = firstPage.nodes.filter(isListed);
      if (firstPage.pageInfo.hasNextPage && firstPage.pageInfo.endCursor) {
        const rest = await readItemsInParallel(boardId, projectQuery || null, firstPage.pageInfo.endCursor, token);
        items.push(...rest.filter(isListed));
      }
      hasNextPage = false;
    } else {
      ({ nodes: items, hasNextPage, endCursor } = await fetchBounded(
        LIST_ITEMS_QUERY,
        { projectId: boardId, first, filterQuery: projectQuery || null },
        readPage,
        token,
        { after, limit, keep: isListed }
      ));
    }

    return {
      status: 'success',
      hidden,
      totalCount,
      truncated: hasNextPage,
      ...(hasNextPage ? { nextCursor: endCursor } : {}),
      data: items.map(item => {
        // Build compact fields map, omitting empty values
        const fields = {};
        if (item.fieldValues?.nodes) {
          for (const node of item.fieldValues.nodes) {
            const value = node.name ?? node.title ?? node.date;
            if (node.field?.name && value) {
              fields[node.field.name] = value;
            }
          }
        }

        // Extract assignees from issue content (already fetched by the query)
        const assignees = item.content?.assignees?.nodes
          ?.map(a => a.login)
          .filter(Boolean) || [];

        // Extract labels from issue content (already fetched by the query)
        const labels = item.content?.labels?.nodes
          ?.map(l => l.name)
          .filter(Boolean) || [];

        const entry = {
          id: item.id,
          title: item.content?.title || 'No title',
          number: item.content?.number,
          url: item.content?.url,
          repo: item.content?.repository?.nameWithOwner || null,
          private: item.content?.repository?.isPrivate ?? null,
          state: item.content?.state || null,
          createdAt: item.content?.createdAt || null,
          updatedAt: item.content?.updatedAt || null,
          fields
        };

        // Only include closedAt, assignees, and labels when non-empty to keep output compact
        if (item.content?.closedAt) entry.closedAt = item.content.closedAt;
        if (assignees.length > 0) entry.assignees = assignees;
        if (labels.length > 0) entry.labels = labels;

        return entry;
      })
    };

  } catch (error) {
    logger.error(`Error fetching items: ${error.message}`);
    return {
      status: 'error',
      error: error.message
    };
  }
}

/**
 * Update a field value directly via GraphQL mutation
 * @param {string} itemId - ID of the item to update
 * @param {string} fieldId - ID of the field to update
 * @param {Object} value - The value object for the mutation (e.g. { singleSelectOptionId }, { iterationId }, { date })
 * @param {string} boardId - The GitHub project node ID
 * @param {string} [token] - Optional per-request GitHub token
 * @returns {Promise<Object>} - Update result
 */
export async function updateItemField(itemId, fieldId, value, boardId, token) {
  return await graphQLWithAuth(UPDATE_ITEM_FIELD_MUTATION, {
    projectId: boardId,
    itemId: itemId,
    fieldId: fieldId,
    value
  }, token);
}

/**
 * Clear (unset) a field value directly via GraphQL mutation.
 * Works uniformly for single-select, iteration, and date fields.
 * @param {string} itemId - ID of the item to update
 * @param {string} fieldId - ID of the field to clear
 * @param {string} boardId - The GitHub project node ID
 * @param {string} [token] - Optional per-request GitHub token
 * @returns {Promise<Object>} - Clear result
 */
export async function clearItemField(itemId, fieldId, boardId, token) {
  return await graphQLWithAuth(CLEAR_ITEM_FIELD_MUTATION, {
    projectId: boardId,
    itemId: itemId,
    fieldId: fieldId
  }, token);
}
