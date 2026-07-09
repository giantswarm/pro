/**
 * MCP Tools Implementation
 *
 * Exposes 10 tools for managing Giant Swarm project boards:
 *   - list_issues: Filter and list project items with generic field filters
 *   - get_issue_details: Get full details for a specific item
 *   - update_issue_field: Update a single-select field value
 *   - create_issue_in_project: Create a new issue and add to a board
 *   - add_existing_issue: Add an existing issue to a board
 *   - archive_item: Archive a project item
 *   - close_issue: Close the issue underlying a project item
 *   - reopen_issue: Reopen the issue underlying a project item
 *   - update_issue_labels: Add and/or remove labels on an issue
 *   - list_issue_comments: Fetch comments across multiple board items in one call
 */

import { listItems, getItemByID, updateItemField } from '../items.js';
import { findFieldByName, findMatchingOption, findMatchingIteration } from '../fields.js';
import { graphQLWithAuth } from '../api.js';
import { findMissingLabels, addLabelsToIssue, removeLabelFromIssue } from '../rest-api.js';
import {
  resolveBoardId,
  DEFAULT_BOARD,
  BOARDS,
  REPO_ID_QUERY,
  CREATE_ISSUE_MUTATION,
  ADD_ITEM_TO_PROJECT_MUTATION,
  ARCHIVE_ITEM_MUTATION,
  ISSUE_NODE_ID_QUERY,
  UPDATE_ITEM_FIELD_MUTATION,
  USER_ID_QUERY,
  ITEM_ISSUE_ID_QUERY,
  CLOSE_ISSUE_MUTATION,
  REOPEN_ISSUE_MUTATION,
  ADD_COMMENT_MUTATION
} from '../project.js';
import { logger } from '../logger.js';
import { subIssueTools, subIssueToolHandlers } from './sub-issues.js';
import { timelineTools, timelineToolHandlers } from './timeline.js';
import {
  listIssueCommentsForItems,
  MAX_ITEMS_PER_CALL,
  DEFAULT_MAX_PER_ISSUE
} from '../comments.js';

const BOARD_NAMES = Object.keys(BOARDS);

/**
 * Extract the GitHub token from MCP request extra context.
 * Returns the OAuth token if present, otherwise undefined (falls back to env var in api.js).
 * @param {Object} [extra] - MCP request extra context (contains authInfo for HTTP transport)
 * @returns {string|undefined}
 */
function extractToken(extra) {
  return extra?.authInfo?.token;
}

/**
 * Resolve a project item ID to its underlying GitHub issue (id, number, state, url,
 * and repository visibility).
 * @param {string} itemId - The project item ID
 * @param {string} [token] - Optional per-request GitHub token
 * @returns {Promise<{id: string, number: number, state: string, url: string, repository: {isPrivate: boolean, nameWithOwner: string}}>}
 */
async function resolveItemIssueId(itemId, token) {
  const result = await graphQLWithAuth(ITEM_ISSUE_ID_QUERY, { itemId }, token);
  const issue = result?.node?.content;
  if (!issue?.id) {
    throw new Error(`Could not resolve an underlying issue for item '${itemId}'`);
  }
  return issue;
}

// ---------------------------------------------------------------------------
// Tool: list_issues
// ---------------------------------------------------------------------------

export const listIssuesTool = {
  name: 'list_issues',
  description: 'List and filter issues from a project board (roadmap or customer). Uses generic field filters -- read the board\'s schema resource first (e.g. roadmap://schema or customer://schema) to discover available fields and valid option values. Returns compact items with `repo` (nameWithOwner), `private` flag, `state` (OPEN/CLOSED), `createdAt`/`updatedAt` timestamps, `closedAt` (only present when the item is closed), and a `fields` map (only non-empty values). The repo URL is always https://github.com/{repo}.',
  inputSchema: {
    type: 'object',
    properties: {
      board: {
        type: 'string',
        enum: BOARD_NAMES,
        description: 'Which board to query. Defaults to "roadmap".'
      },
      repository: {
        type: 'string',
        description: 'Filter by repository. Accepts short name (e.g. "myrepo") which resolves to "giantswarm/myrepo", or full "owner/name" format. On the customer board each customer has their own repo (e.g. "giantswarm/<customer-name>"). On the roadmap board the repos are "giantswarm/roadmap" (public) and "giantswarm/giantswarm" (internal).'
      },
      filters: {
        type: 'object',
        description: 'Field filter map: keys are field names (e.g. "Status", "Team", "Kind"), values are the desired option value. Read the board schema resource first to discover available fields and valid options.',
        additionalProperties: { type: 'string' }
      },
      emptyFields: {
        type: 'array',
        items: { type: 'string' },
        description: 'Return only items where these fields have no value set. Works for single-select, text, date, and iteration fields (e.g. ["Team", "Kind"]).'
      },
      assignee: {
        type: 'string',
        description: 'Filter by assignee GitHub username (e.g. "octocat"). Supports comma-separated values for OR matching (e.g. "octocat,stevecat").'
      },
      label: {
        type: 'string',
        description: 'Filter by label name (e.g. "bug"). Supports comma-separated values for OR matching (e.g. "bug,enhancement").'
      },
      state: {
        type: 'string',
        enum: ['open', 'closed'],
        description: 'Filter by issue state: "open" or "closed".'
      },
      keyword: {
        type: 'string',
        description: 'Free text search matching issue titles and text fields. Matches are based on the beginning of words (e.g. "API" matches "API endpoints" but "PI" does not).'
      },
      updated: {
        type: 'string',
        description: 'Filter by last-updated date using GitHub Projects syntax. Examples: ">@today-7d" (updated in last 7 days), "<@today-30d" (not updated in last 30 days), "@today" (updated today), ">2025-01-01" (updated after a specific date).'
      },
      created: {
        type: 'string',
        description: 'Filter by creation date using GitHub Projects syntax. Examples: ">@today-90d" (created in last 90 days), "<@today-365d" (created more than a year ago), ">2025-01-01" (created after a specific date).'
      },
      closed: {
        type: 'string',
        description: 'Filter by closed date using GitHub Projects syntax. Only applies to closed items. Examples: ">@today-30d" (closed in last 30 days), "@today" (closed today), ">2025-01-01" (closed after a specific date).'
      },
      reason: {
        type: 'string',
        enum: ['completed', 'not planned', 'reopened'],
        description: 'Filter by close reason. Only applies to closed items.'
      }
    }
  }
};

export const KNOWN_LIST_PARAMS = new Set([
  'board', 'project', 'repository', 'filters', 'emptyFields',
  'assignee', 'label', 'state', 'keyword', 'updated', 'created', 'closed', 'reason'
]);

// Board field names are single words (Team, Kind, Status), so simple
// word-boundary capitalization is sufficient here.
function titleCase(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

export async function handleListIssues(args, extra) {
  try {
    const token = extractToken(extra);
    const board = args.board || args.project || DEFAULT_BOARD;
    const boardId = resolveBoardId(board);

    const filters = { ...(args.filters || {}) };
    for (const [key, value] of Object.entries(args)) {
      if (KNOWN_LIST_PARAMS.has(key) || typeof value !== 'string') continue;
      const fieldName = titleCase(key);
      logger.warn(`MCP: list_issues auto-forwarding top-level param "${key}" to filters["${fieldName}"]`);
      filters[fieldName] = value;
    }

    logger.info('MCP: Listing issues', {
      board, repository: args.repository, filters,
      emptyFields: args.emptyFields, assignee: args.assignee,
      label: args.label, state: args.state, keyword: args.keyword,
      updated: args.updated, created: args.created, closed: args.closed,
      reason: args.reason
    });

    const result = await listItems({
      boardId,
      repository: args.repository || null,
      filters,
      emptyFields: args.emptyFields || [],
      assignee: args.assignee || null,
      label: args.label || null,
      state: args.state || null,
      keyword: args.keyword || null,
      updated: args.updated || null,
      created: args.created || null,
      closed: args.closed || null,
      reason: args.reason || null,
      token
    });

    if (result.status === 'error') {
      return { error: result.error };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          count: result.data.length,
          issues: result.data
        })
      }]
    };
  } catch (error) {
    logger.error('MCP: Error listing issues', { error: error.message });
    return { error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Tool: get_issue_details
// ---------------------------------------------------------------------------

export const getIssueDetailsTool = {
  name: 'get_issue_details',
  description: 'Get detailed information about a specific issue including repository metadata, title, description, comments, assignees, labels, and field values.',
  inputSchema: {
    type: 'object',
    properties: {
      itemId: {
        type: 'string',
        description: 'The ID of the project item to retrieve'
      }
    },
    required: ['itemId']
  }
};

export async function handleGetIssueDetails(args, extra) {
  try {
    const token = extractToken(extra);
    logger.info('MCP: Getting issue details', { itemId: args.itemId });
    const issue = await getItemByID(args.itemId, token);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(issue)
      }]
    };
  } catch (error) {
    logger.error('MCP: Error getting issue details', { error: error.message });
    return { error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Tool: update_issue_field
// ---------------------------------------------------------------------------

export const updateIssueFieldTool = {
  name: 'update_issue_field',
  description: 'Update a field value for an issue on a project board. Supports single-select fields (Status, Kind, Team, etc.) and iteration fields (Quarter). Also supports date fields (Start Date, Target Date) when a specific date is known. The server resolves field and option names to internal IDs automatically.',
  inputSchema: {
    type: 'object',
    properties: {
      itemId: {
        type: 'string',
        description: 'The ID of the project item to update'
      },
      fieldName: {
        type: 'string',
        description: 'The field name (e.g., Team, Status, Kind, Stage, Impact, Quarter). Read the board schema resource to see available fields.'
      },
      value: {
        type: 'string',
        description: 'The value to set. For single-select/iteration fields: option name with case-insensitive matching (e.g. "Q2 2026"). For date fields: "YYYY-MM-DD" format.'
      },
      board: {
        type: 'string',
        enum: BOARD_NAMES,
        description: 'Which board the item belongs to. Defaults to "roadmap".'
      }
    },
    required: ['itemId', 'fieldName', 'value']
  }
};

export async function handleUpdateIssueField(args, extra) {
  try {
    const token = extractToken(extra);
    const board = args.board || DEFAULT_BOARD;
    const boardId = resolveBoardId(board);
    logger.info('MCP: Updating issue field', { ...args, board });

    const field = await findFieldByName(args.fieldName, boardId, token);
    if (!field) {
      return {
        error: `Field '${args.fieldName}' not found on the ${board} board. Only single-select, iteration, and date fields can be updated.`
      };
    }

    let value;
    let resolvedName;

    if (field.__typename === 'ProjectV2SingleSelectField') {
      const option = findMatchingOption(field.options, args.value);
      if (!option) {
        return {
          error: `Value '${args.value}' not found in ${args.fieldName} options. Available: ${field.options.map(o => o.name).join(', ')}`
        };
      }
      value = { singleSelectOptionId: option.id };
      resolvedName = option.name;

    } else if (field.__typename === 'ProjectV2IterationField') {
      const iteration = findMatchingIteration(field, args.value);
      if (!iteration) {
        const available = (field.configuration?.iterations || []).map(i => i.title);
        return {
          error: `Value '${args.value}' not found in ${args.fieldName} iterations. Available: ${available.join(', ')}`
        };
      }
      value = { iterationId: iteration.id };
      resolvedName = iteration.title;

    } else if (field.dataType === 'DATE') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(args.value)) {
        return {
          error: `Invalid date format '${args.value}' for field '${args.fieldName}'. Expected YYYY-MM-DD (e.g. "2026-06-30").`
        };
      }
      value = { date: args.value };
      resolvedName = args.value;

    } else {
      return {
        error: `Field '${args.fieldName}' has unsupported type '${field.__typename}' for updates.`
      };
    }

    await updateItemField(args.itemId, field.id, value, boardId, token);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          itemId: args.itemId,
          field: args.fieldName,
          value: resolvedName
        })
      }]
    };
  } catch (error) {
    logger.error('MCP: Error updating issue field', { error: error.message });
    return { error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Tool: create_issue_in_project
// ---------------------------------------------------------------------------

export const createIssueInProjectTool = {
  name: 'create_issue_in_project',
  description: 'Create a new GitHub Issue in a specified repository and add it to a project board. Supports optional initial status, assignees, and labels. For public repos, only create sanitized, non-customer-specific content. If applying labels fails after the issue has already been created and added to the board, the issue is NOT rolled back -- the response reports success with a `warning` explaining that labels were not applied.',
  inputSchema: {
    type: 'object',
    properties: {
      repository: {
        type: 'string',
        description: 'Repository name (e.g., "my-app") within the giantswarm org, or full "owner/name" format. Use giantswarm/roadmap for public-safe issues and giantswarm/giantswarm for internal/customer-specific issues.'
      },
      title: {
        type: 'string',
        description: 'The title of the issue'
      },
      body: {
        type: 'string',
        description: 'The markdown body content of the issue'
      },
      assignees: {
        type: 'array',
        description: 'Optional GitHub usernames to assign to the new issue',
        items: { type: 'string' }
      },
      labels: {
        type: 'array',
        description: 'Optional label names to apply to the new issue. Every label must already exist in the repository -- non-existent labels cause the request to fail (with no issue created) rather than being auto-created.',
        items: { type: 'string' }
      },
      confirmPublicSafe: {
        type: 'boolean',
        description: 'Required when repository resolves to giantswarm/roadmap. Must be true to confirm the title/body are sanitized and safe for public visibility.'
      },
      initialStatus: {
        type: 'string',
        description: 'The status to set after adding to the board (e.g., "Todo")'
      },
      board: {
        type: 'string',
        enum: BOARD_NAMES,
        description: 'Which board to add the issue to. Defaults to "roadmap".'
      }
    },
    required: ['repository', 'title']
  }
};

export async function handleCreateIssueInProject(args, extra) {
  try {
    const token = extractToken(extra);
    const board = args.board || DEFAULT_BOARD;
    const boardId = resolveBoardId(board);
    logger.info('MCP: Creating issue in project', { repository: args.repository, title: args.title, board });

    // Parse repository into owner/name
    let owner, repo;
    if (args.repository.includes('/')) {
      [owner, repo] = args.repository.split('/');
    } else {
      owner = 'giantswarm';
      repo = args.repository;
    }

    if (owner.toLowerCase() === 'giantswarm' && repo.toLowerCase() === 'roadmap' && args.confirmPublicSafe !== true) {
      return {
        error: 'Creating issues in giantswarm/roadmap requires confirmPublicSafe=true to reduce accidental disclosure of internal or customer-specific information.'
      };
    }

    const labels = Array.isArray(args.labels)
      ? args.labels.map(l => String(l || '').trim()).filter(l => l !== '')
      : [];

    // Get repository node ID. Checked before label validation so a typo'd
    // repository name yields "Repository not found" rather than a
    // confusing label error.
    const repoResult = await graphQLWithAuth(REPO_ID_QUERY, { owner, repo }, token);
    if (!repoResult?.repository?.id) {
      return { error: `Repository '${owner}/${repo}' not found` };
    }
    const repositoryId = repoResult.repository.id;

    // Validate labels BEFORE creating the issue so a bad label name never
    // leaves an orphan issue behind.
    if (labels.length > 0) {
      const missing = await findMissingLabels(owner, repo, labels, token);
      if (missing.length > 0) {
        return {
          error: `Label(s) not found in ${owner}/${repo}: ${missing.join(', ')}. Create the label first or fix the name -- labels are not auto-created.`
        };
      }
    }

    const assigneeLogins = Array.isArray(args.assignees)
      ? args.assignees
          .map(login => String(login || '').trim())
          .filter(login => login !== '')
      : [];

    const assigneeIds = [];
    for (const login of assigneeLogins) {
      const userResult = await graphQLWithAuth(USER_ID_QUERY, { login }, token);
      if (!userResult?.user?.id) {
        return { error: `Assignee '${login}' not found` };
      }
      assigneeIds.push(userResult.user.id);
    }

    // Create the issue
    const createResult = await graphQLWithAuth(CREATE_ISSUE_MUTATION, {
      repositoryId,
      title: args.title,
      body: args.body || '',
      assigneeIds: assigneeIds.length > 0 ? assigneeIds : undefined
    }, token);

    const issue = createResult.createIssue.issue;

    // Add the issue to the project board
    const addResult = await graphQLWithAuth(ADD_ITEM_TO_PROJECT_MUTATION, {
      projectId: boardId,
      contentId: issue.id
    }, token);

    const projectItemId = addResult.addProjectV2ItemById.item.id;

    // Apply labels (already validated above to exist in the repository).
    // The issue and its board membership are already committed at this point,
    // so a failure here is best-effort: log it and surface a warning rather
    // than failing the whole call, since a caller retrying on failure would
    // otherwise create a duplicate issue.
    let labelWarning;
    let labelsApplied = false;
    if (labels.length > 0) {
      try {
        await addLabelsToIssue(owner, repo, issue.number, labels, token);
        labelsApplied = true;
      } catch (error) {
        logger.error('MCP: Failed to apply labels after issue creation', {
          issueUrl: issue.url, labels, error: error.message
        });
        labelWarning = `Issue was created and added to the board, but applying labels failed: ${error.message}`;
      }
    }

    // Set initial status if provided
    if (args.initialStatus) {
      const statusField = await findFieldByName('status', boardId, token);
      if (statusField) {
        const statusOption = findMatchingOption(statusField.options, args.initialStatus);
        if (statusOption) {
          await graphQLWithAuth(UPDATE_ITEM_FIELD_MUTATION, {
            projectId: boardId,
            itemId: projectItemId,
            fieldId: statusField.id,
            value: { singleSelectOptionId: statusOption.id }
          }, token);
        }
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          issueUrl: issue.url,
          issueNumber: issue.number,
          projectItemId,
          labels: labelsApplied ? labels : undefined,
          warning: labelWarning
        })
      }]
    };
  } catch (error) {
    logger.error('MCP: Error creating issue in project', { error: error.message });
    return { error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Tool: add_existing_issue
// ---------------------------------------------------------------------------

export const addExistingIssueTool = {
  name: 'add_existing_issue',
  description: 'Add an existing GitHub issue to a project board. At least one of issueUrl or issueNodeId must be provided.',
  inputSchema: {
    type: 'object',
    properties: {
      issueUrl: {
        type: 'string',
        description: 'Full URL of the issue (e.g., "https://github.com/giantswarm/roadmap/issues/123")'
      },
      issueNodeId: {
        type: 'string',
        description: 'The global node ID of the issue (starts with "I_")'
      },
      board: {
        type: 'string',
        enum: BOARD_NAMES,
        description: 'Which board to add the issue to. Defaults to "roadmap".'
      }
    }
  }
};

export async function handleAddExistingIssue(args, extra) {
  try {
    const token = extractToken(extra);
    const board = args.board || DEFAULT_BOARD;
    const boardId = resolveBoardId(board);
    logger.info('MCP: Adding existing issue to project', { ...args, board });

    let contentId = args.issueNodeId;

    // If URL is provided, resolve it to a node ID
    if (!contentId && args.issueUrl) {
      const urlMatch = args.issueUrl.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
      if (!urlMatch) {
        return { error: `Could not parse issue URL: ${args.issueUrl}` };
      }
      const [, owner, repo, numberStr] = urlMatch;
      const result = await graphQLWithAuth(ISSUE_NODE_ID_QUERY, {
        owner,
        repo,
        number: parseInt(numberStr, 10)
      }, token);

      if (!result?.repository?.issue?.id) {
        return { error: `Issue not found: ${args.issueUrl}` };
      }
      contentId = result.repository.issue.id;
    }

    if (!contentId) {
      return { error: 'Either issueUrl or issueNodeId is required' };
    }

    const addResult = await graphQLWithAuth(ADD_ITEM_TO_PROJECT_MUTATION, {
      projectId: boardId,
      contentId
    }, token);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          projectItemId: addResult.addProjectV2ItemById.item.id
        })
      }]
    };
  } catch (error) {
    logger.error('MCP: Error adding existing issue', { error: error.message });
    return { error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Tool: archive_item
// ---------------------------------------------------------------------------

export const archiveItemTool = {
  name: 'archive_item',
  description: 'Archive a project item, removing it from the active board view without deleting the underlying issue.',
  inputSchema: {
    type: 'object',
    properties: {
      itemId: {
        type: 'string',
        description: 'The project item ID to archive'
      },
      board: {
        type: 'string',
        enum: BOARD_NAMES,
        description: 'Which board the item belongs to. Defaults to "roadmap".'
      }
    },
    required: ['itemId']
  }
};

export async function handleArchiveItem(args, extra) {
  try {
    const token = extractToken(extra);
    const board = args.board || DEFAULT_BOARD;
    const boardId = resolveBoardId(board);
    logger.info('MCP: Archiving item', { itemId: args.itemId, board });

    await graphQLWithAuth(ARCHIVE_ITEM_MUTATION, {
      projectId: boardId,
      itemId: args.itemId
    }, token);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          itemId: args.itemId,
          archived: true
        })
      }]
    };
  } catch (error) {
    logger.error('MCP: Error archiving item', { error: error.message });
    return { error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Tool: close_issue
// ---------------------------------------------------------------------------

export const closeIssueTool = {
  name: 'close_issue',
  description: 'Close the GitHub issue underlying a single project board item. Board-independent (queries by item ID). Optionally posts a comment before closing. Operates on exactly one item per call -- there is no bulk close. Comments on issues in public repos require confirmPublicSafe=true. This does not change the board\'s Status field -- unless the board has GitHub\'s built-in "item closed -> set Status" workflow enabled, pair this call with update_issue_field if the board Status should reflect the closure.',
  inputSchema: {
    type: 'object',
    properties: {
      itemId: {
        type: 'string',
        description: 'The project item ID whose underlying issue should be closed'
      },
      stateReason: {
        type: 'string',
        enum: ['completed', 'not_planned'],
        description: 'Why the issue is being closed. Defaults to "completed".'
      },
      comment: {
        type: 'string',
        description: 'Optional comment to post on the issue before closing it'
      },
      confirmPublicSafe: {
        type: 'boolean',
        description: 'Required when comment is provided and the underlying issue is in a public repository. Must be true to confirm the comment is sanitized and safe for public visibility.'
      }
    },
    required: ['itemId']
  }
};

export async function handleCloseIssue(args, extra) {
  try {
    const token = extractToken(extra);
    logger.info('MCP: Closing issue', { itemId: args.itemId, stateReason: args.stateReason });

    // Validate stateReason before any network calls -- an invalid value must not
    // have side effects (e.g. posting a comment) before the error is returned.
    let stateReason;
    if (!args.stateReason) {
      stateReason = 'COMPLETED';
    } else if (args.stateReason === 'completed') {
      stateReason = 'COMPLETED';
    } else if (args.stateReason === 'not_planned') {
      stateReason = 'NOT_PLANNED';
    } else {
      return { error: `Invalid stateReason '${args.stateReason}'. Must be "completed" or "not_planned".` };
    }

    const issue = await resolveItemIssueId(args.itemId, token);

    if (args.comment) {
      if (issue.repository?.isPrivate === false && args.confirmPublicSafe !== true) {
        return {
          error: `Posting a comment to ${issue.repository.nameWithOwner} (public) requires confirmPublicSafe=true to reduce accidental disclosure of internal or customer-specific information.`
        };
      }
      await graphQLWithAuth(ADD_COMMENT_MUTATION, { subjectId: issue.id, body: args.comment }, token);
    }

    const result = await graphQLWithAuth(CLOSE_ISSUE_MUTATION, { issueId: issue.id, stateReason }, token);
    const closed = result.closeIssue.issue;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          itemId: args.itemId,
          issueUrl: closed.url,
          state: closed.state,
          stateReason: closed.stateReason,
          commentPosted: Boolean(args.comment)
        })
      }]
    };
  } catch (error) {
    logger.error('MCP: Error closing issue', { error: error.message });
    return { error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Tool: reopen_issue
// ---------------------------------------------------------------------------

export const reopenIssueTool = {
  name: 'reopen_issue',
  description: 'Reopen the GitHub issue underlying a single project board item. Board-independent (queries by item ID). Optionally posts a comment before reopening. Operates on exactly one item per call -- there is no bulk reopen. Comments on issues in public repos require confirmPublicSafe=true. This does not change the board\'s Status field -- unless the board has GitHub\'s built-in "item closed -> set Status" workflow enabled, pair this call with update_issue_field if the board Status should reflect the reopening.',
  inputSchema: {
    type: 'object',
    properties: {
      itemId: {
        type: 'string',
        description: 'The project item ID whose underlying issue should be reopened'
      },
      comment: {
        type: 'string',
        description: 'Optional comment to post on the issue before reopening it'
      },
      confirmPublicSafe: {
        type: 'boolean',
        description: 'Required when comment is provided and the underlying issue is in a public repository. Must be true to confirm the comment is sanitized and safe for public visibility.'
      }
    },
    required: ['itemId']
  }
};

export async function handleReopenIssue(args, extra) {
  try {
    const token = extractToken(extra);
    logger.info('MCP: Reopening issue', { itemId: args.itemId });

    const issue = await resolveItemIssueId(args.itemId, token);

    if (args.comment) {
      if (issue.repository?.isPrivate === false && args.confirmPublicSafe !== true) {
        return {
          error: `Posting a comment to ${issue.repository.nameWithOwner} (public) requires confirmPublicSafe=true to reduce accidental disclosure of internal or customer-specific information.`
        };
      }
      await graphQLWithAuth(ADD_COMMENT_MUTATION, { subjectId: issue.id, body: args.comment }, token);
    }

    const result = await graphQLWithAuth(REOPEN_ISSUE_MUTATION, { issueId: issue.id }, token);
    const reopened = result.reopenIssue.issue;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          itemId: args.itemId,
          issueUrl: reopened.url,
          state: reopened.state,
          commentPosted: Boolean(args.comment)
        })
      }]
    };
  } catch (error) {
    logger.error('MCP: Error reopening issue', { error: error.message });
    return { error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Tool: update_issue_labels
// ---------------------------------------------------------------------------

export const updateIssueLabelsTool = {
  name: 'update_issue_labels',
  description: 'Add and/or remove labels on the issue underlying a project board item. At least one of addLabels or removeLabels must be provided. Labels being added must already exist in the repository -- non-existent labels are rejected with an error listing them, rather than being auto-created.',
  inputSchema: {
    type: 'object',
    properties: {
      itemId: {
        type: 'string',
        description: 'The ID of the project item whose underlying issue should be updated'
      },
      addLabels: {
        type: 'array',
        description: 'Label names to add to the issue. Must already exist in the repository.',
        items: { type: 'string' }
      },
      removeLabels: {
        type: 'array',
        description: 'Label names to remove from the issue.',
        items: { type: 'string' }
      }
    },
    required: ['itemId']
  }
};

export async function handleUpdateIssueLabels(args, extra) {
  try {
    const addLabels = Array.isArray(args.addLabels)
      ? args.addLabels.map(l => String(l || '').trim()).filter(l => l !== '')
      : [];
    const removeLabels = Array.isArray(args.removeLabels)
      ? args.removeLabels.map(l => String(l || '').trim()).filter(l => l !== '')
      : [];

    if (addLabels.length === 0 && removeLabels.length === 0) {
      return { error: 'At least one of addLabels or removeLabels must be provided.' };
    }

    const token = extractToken(extra);
    logger.info('MCP: Updating issue labels', { itemId: args.itemId, addLabels, removeLabels });

    const item = await getItemByID(args.itemId, token);
    if (!item.repository?.nameWithOwner || !item.number) {
      return { error: `Could not resolve the underlying issue for item '${args.itemId}'.` };
    }
    const [owner, repo] = item.repository.nameWithOwner.split('/');
    const issueNumber = item.number;

    // Snapshot of labels currently on the issue, used below to report which
    // requested removals actually changed anything (removeLabelFromIssue
    // swallows a 404 whether the label was never applied or never existed,
    // so this is the only way to distinguish an effective removal from a
    // no-op).
    const currentLabels = new Set((item.labels || []).map(l => l.toLowerCase()));

    // Validate additions exist in the repo BEFORE mutating anything -- GitHub's
    // add-labels endpoint would otherwise silently create missing labels.
    if (addLabels.length > 0) {
      const missing = await findMissingLabels(owner, repo, addLabels, token);
      if (missing.length > 0) {
        return {
          error: `Label(s) not found in ${owner}/${repo}: ${missing.join(', ')}. Create the label first or fix the name -- labels are not auto-created.`
        };
      }
    }

    if (addLabels.length > 0) {
      await addLabelsToIssue(owner, repo, issueNumber, addLabels, token);
    }

    // Only report additions that actually changed something -- labels already
    // present pre-call are a no-op, mirroring how `removed` below is computed.
    const added = addLabels.filter(name => !currentLabels.has(name.toLowerCase()));

    const removed = [];
    for (const name of removeLabels) {
      await removeLabelFromIssue(owner, repo, issueNumber, name, token);
      if (currentLabels.has(name.toLowerCase())) {
        removed.push(name);
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          itemId: args.itemId,
          repository: `${owner}/${repo}`,
          issueNumber,
          added,
          removed
        })
      }]
    };
  } catch (error) {
    logger.error('MCP: Error updating issue labels', { error: error.message });
    return { error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Tool: list_issue_comments
// ---------------------------------------------------------------------------

export const listIssueCommentsTool = {
  name: 'list_issue_comments',
  description: `Fetch comments for multiple board items in a single call. Board-independent (queries by item ID). Resolves each item to its underlying GitHub issue and returns the comment author, timestamps, and body for each. Bounded response: max ${MAX_ITEMS_PER_CALL} itemIds per call, and only the newest ${DEFAULT_MAX_PER_ISSUE} comments per issue by default (override with maxPerIssue); long comment bodies are truncated with an explicit truncation indicator. Each comment includes \`createdAt\`, plus \`updatedAt\` when it differs from \`createdAt\` (i.e. the comment was edited). Ordering differs by mode: without \`since\`, the newest comments by creation time are kept; with \`since\`, the newest comments by last-updated time are kept (so a recently-edited older comment survives ahead of an untouched newer one, and its \`updatedAt\` shows why). The response's \`itemCount\` counts result items (including error entries), not comments.`,
  inputSchema: {
    type: 'object',
    properties: {
      itemIds: {
        type: 'array',
        items: { type: 'string' },
        description: `The project item IDs to fetch comments for. Max ${MAX_ITEMS_PER_CALL} per call.`
      },
      since: {
        type: 'string',
        description: 'Only return comments created/updated at or after this ISO 8601 timestamp (e.g. "2026-06-01T00:00:00Z"). Changes which comments are kept when maxPerIssue trims the results -- see the tool description.'
      },
      maxPerIssue: {
        type: 'number',
        description: `Maximum number of comments to return per issue, keeping the newest ones. Defaults to ${DEFAULT_MAX_PER_ISSUE}.`
      }
    },
    required: ['itemIds']
  }
};

export async function handleListIssueComments(args, extra) {
  try {
    const token = extractToken(extra);
    const itemIds = args.itemIds;

    logger.info('MCP: Listing issue comments', {
      itemCount: Array.isArray(itemIds) ? itemIds.length : 0,
      since: args.since,
      maxPerIssue: args.maxPerIssue
    });

    const results = await listIssueCommentsForItems({
      itemIds,
      since: args.since || null,
      maxPerIssue: args.maxPerIssue,
      token
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          itemCount: results.length,
          items: results
        })
      }]
    };
  } catch (error) {
    logger.error('MCP: Error listing issue comments', { error: error.message });
    return { error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const tools = [
  listIssuesTool,
  getIssueDetailsTool,
  updateIssueFieldTool,
  createIssueInProjectTool,
  addExistingIssueTool,
  archiveItemTool,
  closeIssueTool,
  reopenIssueTool,
  updateIssueLabelsTool,
  listIssueCommentsTool,
  ...subIssueTools,
  ...timelineTools
];

export const toolHandlers = {
  list_issues: handleListIssues,
  get_issue_details: handleGetIssueDetails,
  update_issue_field: handleUpdateIssueField,
  create_issue_in_project: handleCreateIssueInProject,
  add_existing_issue: handleAddExistingIssue,
  archive_item: handleArchiveItem,
  close_issue: handleCloseIssue,
  reopen_issue: handleReopenIssue,
  update_issue_labels: handleUpdateIssueLabels,
  list_issue_comments: handleListIssueComments,
  ...subIssueToolHandlers,
  ...timelineToolHandlers
};
