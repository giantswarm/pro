/**
 * MCP Issue Timeline Tool
 *
 * Exposes 1 tool for reading an issue's activity timeline:
 *   - get_issue_timeline: List label/assignment/milestone/rename/cross-reference
 *     events for the issue underlying a project board item.
 */

import { getItemByID } from '../items.js';
import { getIssueTimeline, MAX_TIMELINE_EVENTS } from '../timeline.js';
import { logger } from '../logger.js';

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

    const item = await getItemByID(args.itemId, token);
    if (!item.repository?.nameWithOwner || !item.number) {
      return { error: `Could not resolve item '${args.itemId}' to an underlying issue.` };
    }
    const [owner, repo] = item.repository.nameWithOwner.split('/');

    const result = await getIssueTimeline(
      {
        owner,
        repo,
        issue_number: item.number,
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
// Exports
// ---------------------------------------------------------------------------

export const timelineTools = [
  getIssueTimelineTool
];

export const timelineToolHandlers = {
  get_issue_timeline: handleGetIssueTimeline
};
