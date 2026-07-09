/**
 * Items Management Module
 *
 * Provides functions to list, filter, and update GitHub Project V2 items
 * on a given project board. All functions return data directly
 * without console output.
 */

import { fetchPaginated, graphQLWithAuth } from './api.js';
import {
  LIST_ITEMS_QUERY,
  ISSUE_DETAIL_QUERY,
  UPDATE_ITEM_FIELD_MUTATION
} from './project.js';
import { listFields, findMatchingOption } from './fields.js';
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
 * List and filter items in a project board
 * @param {Object} options - Filtering options
 * @param {string} options.boardId - The GitHub project node ID (required)
 * @param {string} [options.repository] - Filter by repository (short name or "owner/name")
 * @param {Object} [options.filters] - Field name to value map for filtering (single-select fields)
 * @param {string[]} [options.emptyFields] - Return only items where these fields have no value set
 * @param {string} [options.assignee] - Filter by assignee GitHub username (comma-separated for OR)
 * @param {string} [options.label] - Filter by label name (comma-separated for OR)
 * @param {string} [options.state] - Filter by issue state: "open" or "closed"
 * @param {string} [options.keyword] - Free text search matching titles and text fields
 * @param {string} [options.updated] - Filter by last-updated date (e.g. ">@today-7d")
 * @param {string} [options.created] - Filter by creation date (e.g. ">@today-90d")
 * @param {string} [options.closed] - Filter by closed date (e.g. ">@today-30d")
 * @param {string} [options.reason] - Filter by close reason: "completed", "not planned", or "reopened"
 * @param {string} [options.token] - Optional per-request GitHub token
 * @returns {Promise<Object>} - Result with status and data
 */
export async function listItems(options) {
  const first = 100;
  try {
    const {
      boardId, repository = null, filters = {}, emptyFields = [],
      assignee = null, label = null, state = null, keyword = null,
      updated = null, created = null, closed = null, reason = null, token
    } = options;

    if (!boardId) {
      throw new Error('boardId is required');
    }

    // Build server-side filter query
    const queryTerms = [];

    // Repository filter uses GitHub Projects built-in repo: prefix
    if (repository) {
      const fullRepo = resolveRepositoryName(repository);
      queryTerms.push(`repo:${fullRepo}`);
    }

    // Assignee filter — supports comma-separated usernames for OR matching
    if (assignee) {
      const trimmed = assignee.trim();
      if (trimmed) {
        queryTerms.push(`assignee:${trimmed}`);
      }
    }

    // Label filter — supports comma-separated labels for OR matching.
    // Each individual label that contains spaces is quoted separately so that
    // e.g. "bug fix,enhancement" becomes label:"bug fix",enhancement.
    if (label) {
      const trimmed = label.trim();
      if (trimmed) {
        if (trimmed.includes(',')) {
          const parts = trimmed.split(',').map(p => {
            const s = p.trim();
            return s.includes(' ') ? `"${escapeProjectQueryValue(s)}"` : s;
          });
          queryTerms.push(`label:${parts.join(',')}`);
        } else if (trimmed.includes(' ')) {
          queryTerms.push(`label:"${escapeProjectQueryValue(trimmed)}"`);
        } else {
          queryTerms.push(`label:${trimmed}`);
        }
      }
    }

    // Issue state filter (is:open, is:closed)
    if (state) {
      const trimmed = state.trim().toLowerCase();
      if (trimmed === 'open' || trimmed === 'closed') {
        queryTerms.push(`is:${trimmed}`);
      }
    }

    // Last-updated date filter — passed through using GitHub's query syntax.
    // Examples: ">@today-7d", "<@today-30d", "@today", ">2025-01-01"
    if (updated) {
      const trimmed = updated.trim();
      if (trimmed) {
        queryTerms.push(`updated:${trimmed}`);
      }
    }

    // Created date filter — same GitHub Projects query syntax as `updated`.
    // Examples: ">@today-90d", "<@today-30d", "@today", ">2025-01-01"
    if (created) {
      const trimmed = created.trim();
      if (trimmed) {
        queryTerms.push(`created:${trimmed}`);
      }
    }

    // Closed date filter — same GitHub Projects query syntax as `updated`.
    // Examples: ">@today-30d", "<@today-7d", "@today", ">2025-01-01"
    if (closed) {
      const trimmed = closed.trim();
      if (trimmed) {
        queryTerms.push(`closed:${trimmed}`);
      }
    }

    // Close reason filter
    if (reason) {
      const trimmed = reason.trim();
      if (trimmed) {
        if (trimmed.includes(' ')) {
          queryTerms.push(`reason:"${escapeProjectQueryValue(trimmed)}"`);
        } else {
          queryTerms.push(`reason:${trimmed}`);
        }
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

    // Generic field filters
    const filterEntries = Object.entries(filters).filter(
      ([, value]) => typeof value === 'string' && value.trim() !== ''
    );

    // Fetch board fields once if needed for filter validation or emptyFields validation
    const needFields = filterEntries.length > 0 || emptyFields.length > 0;
    const allFields = needFields ? await listFields(boardId, token) : [];

    // Validate emptyFields names against actual board fields
    if (emptyFields.length > 0) {
      const allFieldNames = allFields.map(f => f.name.toLowerCase());
      for (const fn of emptyFields) {
        if (!allFieldNames.some(n => n === fn.toLowerCase())) {
          const available = allFields.map(f => f.name);
          return {
            status: 'error',
            error: `emptyFields: field '${fn}' not found. Available fields: ${available.join(', ')}`
          };
        }
      }
    }

    if (filterEntries.length > 0) {
      for (const [fieldName, requestedValue] of filterEntries) {
        const trimmedValue = requestedValue.trim();
        if (trimmedValue.toLowerCase() === 'all') {
          continue;
        }

        const field = allFields.find(fieldNode =>
          fieldNode.__typename === 'ProjectV2SingleSelectField' &&
          fieldNode.name.toLowerCase() === fieldName.toLowerCase()
        );

        if (!field) {
          const availableFields = allFields
            .filter(f => f.__typename === 'ProjectV2SingleSelectField')
            .map(f => f.name);
          return {
            status: 'error',
            error: `Field '${fieldName}' not found. Available single-select fields: ${availableFields.join(', ')}`
          };
        }

        const matchingOption = findMatchingOption(field.options || [], trimmedValue);
        if (!matchingOption) {
          const availableOptions = (field.options || []).map(o => o.name);
          return {
            status: 'error',
            error: `Value '${trimmedValue}' not found for field '${field.name}'. Available options: ${availableOptions.join(', ')}`
          };
        }

        const escapedValue = escapeProjectQueryValue(matchingOption.name);
        const queryKey = fieldNameToQueryKey(field.name);
        queryTerms.push(`${queryKey}:"${escapedValue}"`);
      }
    }

    // Add server-side no:<field> filters for emptyFields.
    // GitHub Projects V2 supports "no:<field-key>" to match items where
    // a field has no value set, which avoids fetching the entire board.
    // The client-side filter below is kept as a safety net in case the
    // heuristic in fieldNameToQueryKey doesn't match a particular field.
    for (const fieldName of emptyFields) {
      const queryKey = fieldNameToQueryKey(fieldName);
      queryTerms.push(`no:${queryKey}`);
    }

    const projectQuery = queryTerms.join(' ');

    const allItems = await fetchPaginated(
      LIST_ITEMS_QUERY,
      { projectId: boardId, first, filterQuery: projectQuery || null },
      result => {
        if (!result?.node?.items) {
          return { nodes: [], pageInfo: { hasNextPage: false } };
        }
        return {
          nodes: result.node.items.nodes || [],
          pageInfo: result.node.items.pageInfo || { hasNextPage: false }
        };
      },
      token
    );

    // Generic empty-field filtering (supports single-select, text, date, and iteration fields)
    function hasNonEmptyField(item, fieldName) {
      return item.fieldValues.nodes.some(node => {
        if (!node.field?.name) return false;
        if (node.field.name.toLowerCase() !== fieldName.toLowerCase()) return false;
        const value = node.name ?? node.text ?? node.date ?? node.title ?? '';
        return typeof value === 'string' && value.trim() !== '';
      });
    }

    const filtered = allItems.filter(item => {
      if (!item.fieldValues || !item.fieldValues.nodes) return false;
      if (!item.content || !item.content.title) return false;

      for (const fieldName of emptyFields) {
        if (hasNonEmptyField(item, fieldName)) {
          return false;
        }
      }
      return true;
    });

    return {
      status: 'success',
      data: filtered.map(item => {
        // Build compact fields map, omitting empty values
        const fields = {};
        if (item.fieldValues?.nodes) {
          for (const node of item.fieldValues.nodes) {
            if (node.field?.name && node.name) {
              fields[node.field.name] = node.name;
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
