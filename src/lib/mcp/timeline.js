/**
 * MCP Issue Timeline Tool
 *
 * Exposes 2 tools for reading issue activity:
 *   - get_issue_timeline: List label/assignment/milestone/rename/cross-reference
 *     events for the issue underlying a project board item.
 *   - list_status_changes: List the board Status changes (from, to, board) of
 *     the issues of one repository in one call.
 */

import { resolveItemIssues } from '../items.js';
import {
  getIssueTimeline,
  listStatusChanges,
  MAX_TIMELINE_EVENTS,
  STATUS_CHANGES_PER_ISSUE,
  DEFAULT_STATUS_CHANGES_MAX_ISSUES
} from '../timeline.js';
import { BOARD_NAMES } from '../project.js';
import { logger } from '../logger.js';
import { READ_ONLY } from './annotations.js';

/**
 * Extract the GitHub token from MCP request extra context.
 * @param {Object} [extra] - MCP request extra context
 * @returns {string|undefined}
 */
function extractToken(extra) {
  return extra?.authInfo?.token;
}

// ---------------------------------------------------------------------------
// Tool: get_issue_timeline
// ---------------------------------------------------------------------------

export const getIssueTimelineTool = {
  name: 'get_issue_timeline',
  annotations: READ_ONLY,
  description: `Get the activity timeline for a project board item's underlying issue: label changes, assignments, milestones, renames, cross-references, and close reasons. Returns compact events ordered chronologically (oldest first); when more than ${MAX_TIMELINE_EVENTS} events qualify, only the most recent ${MAX_TIMELINE_EVENTS} are returned (see \`truncated\` in the response). No server-side date/type filters exist on this endpoint, so \`since\`/\`until\`/\`eventTypes\` are applied client-side -- pass full ISO 8601 timestamps (not just a date) for precise since/until cutoffs.`,
  inputSchema: {
    type: 'object',
    properties: {
      itemId: {
        type: 'string',
        description: 'The ID of the project item to retrieve the timeline for. Board-independent (queries by item ID).'
      },
      since: {
        type: 'string',
        description: 'Only include events at or after this ISO 8601 date/time (e.g. "2026-01-01T00:00:00Z").'
      },
      until: {
        type: 'string',
        description: 'Only include events at or before this ISO 8601 date/time.'
      },
      eventTypes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Only include events of these raw timeline types (e.g. ["labeled", "closed", "cross-referenced", "assigned", "renamed", "referenced"]). Omit to include all types.'
      }
    },
    required: ['itemId']
  }
};

export async function handleGetIssueTimeline(args, extra) {
  try {
    const token = extractToken(extra);
    logger.info('MCP: Getting issue timeline', {
      itemId: args.itemId, since: args.since, until: args.until, eventTypes: args.eventTypes
    });

    const issue = (await resolveItemIssues([args.itemId], token)).get(args.itemId);
    if (!issue) {
      return { error: `Could not resolve item '${args.itemId}' to an underlying issue.` };
    }

    const result = await getIssueTimeline(
      {
        owner: issue.owner,
        repo: issue.repo,
        issue_number: issue.number,
        since: args.since || null,
        until: args.until || null,
        eventTypes: args.eventTypes || null
      },
      token
    );

    if (result.error) {
      return { error: result.error };
    }
    const { events, truncated } = result;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          count: events.length,
          truncated,
          events
        })
      }]
    };
  } catch (error) {
    logger.error('MCP: Error getting issue timeline', { error: error.message });
    return { error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Tool: list_status_changes
// ---------------------------------------------------------------------------

export const listStatusChangesTool = {
  name: 'list_status_changes',
  annotations: READ_ONLY,
  description: `List the board Status changes of the issues of one repository in one call: for each change the issue (number, title, url, state), the board it happened on (\`board\`, or null for a project pro does not serve, with \`projectNumber\`), \`from\` and \`to\` (the Status option names as GitHub recorded them at the time; \`from\` is empty when the item was just added), \`actor\` and \`createdAt\`, oldest first. A Status change does not bump an issue's updatedAt, so this is the way to see board movement since a date. Scans the repository's open issues (newest first, at most \`maxIssues\`), or with state "closed" the closed issues updated since \`since\`. \`truncated: true\`: more issues exist than were scanned. \`timelineTruncated\` lists issues with more than ${STATUS_CHANGES_PER_ISSUE} Status changes whose older ones inside the window were not read.`,
  inputSchema: {
    type: 'object',
    properties: {
      repository: {
        type: 'string',
        description: 'The repository: short name (e.g. "myrepo", resolved to "giantswarm/myrepo") or "owner/name".'
      },
      since: {
        type: 'string',
        description: 'Only changes at or after this ISO 8601 date/time (e.g. "2026-01-01T00:00:00Z").'
      },
      until: {
        type: 'string',
        description: 'Only changes at or before this ISO 8601 date/time.'
      },
      board: {
        type: 'string',
        enum: BOARD_NAMES,
        description: 'Only changes on this board. Omit for every board.'
      },
      state: {
        type: 'string',
        enum: ['open', 'closed'],
        description: 'Which issues to scan: "open" (default) or "closed" (those updated since `since`).'
      },
      maxIssues: {
        type: 'integer',
        minimum: 0,
        description: `Issues to scan at most, newest first. Default ${DEFAULT_STATUS_CHANGES_MAX_ISSUES}; 0 scans every issue of the state.`
      }
    },
    required: ['repository']
  }
};

/**
 * Split a repository argument into owner and name; a short name is in giantswarm.
 * @param {string} repository
 * @returns {{ owner: string, repo: string }|null}
 */
export function parseRepository(repository) {
  const parts = String(repository || '').trim().split('/').filter(Boolean);
  if (parts.length === 1) return { owner: 'giantswarm', repo: parts[0] };
  if (parts.length === 2) return { owner: parts[0], repo: parts[1] };
  return null;
}

export async function handleListStatusChanges(args, extra) {
  try {
    const token = extractToken(extra);
    const parsed = parseRepository(args.repository);
    if (!parsed) {
      return { error: `Invalid repository '${args.repository}': give "name" or "owner/name".` };
    }
    logger.info('MCP: Listing status changes', {
      repository: `${parsed.owner}/${parsed.repo}`, since: args.since, until: args.until, board: args.board, state: args.state
    });

    const result = await listStatusChanges(
      {
        ...parsed,
        since: args.since || null,
        until: args.until || null,
        board: args.board || null,
        state: args.state || 'open',
        maxIssues: args.maxIssues ?? DEFAULT_STATUS_CHANGES_MAX_ISSUES
      },
      token
    );
    if (result.error) {
      return { error: result.error };
    }
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error) {
    logger.error('MCP: Error listing status changes', { error: error.message });
    return { error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const timelineTools = [
  getIssueTimelineTool,
  listStatusChangesTool
];

export const timelineToolHandlers = {
  get_issue_timeline: handleGetIssueTimeline,
  list_status_changes: handleListStatusChanges
};
