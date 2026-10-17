/**
 * MCP Issue Relations Tools
 *
 * Exposes 3 tools for GitHub's issue relations besides parent/child
 * (sub-issues.js): "blocked by" / "blocking" dependencies and "relates to"
 * links, between issues of any repository:
 *   - list_issue_relations: List an issue's blocked-by, blocking and related issues
 *   - add_issue_relation: Set a relation between two issues
 *   - remove_issue_relation: Remove a relation between two issues
 */

import { parseIssueRef } from '../rest-api.js';
import {
  RELATION_TYPES,
  listIssueRelations,
  addIssueRelation,
  removeIssueRelation
} from '../relations.js';
import { RELATIONS_PAGE } from '../project.js';
import { logger } from '../logger.js';
import { READ_ONLY, additiveWrite, destructiveWrite } from './annotations.js';

/**
 * Extract the GitHub token from MCP request extra context.
 * @param {Object} [extra] - MCP request extra context
 * @returns {string|undefined}
 */
function extractToken(extra) {
  return extra?.authInfo?.token;
}

const RELATION_DESCRIPTION =
  'How issueUrl relates to relatedIssueUrl: "blocked_by" (relatedIssueUrl blocks issueUrl), ' +
  '"blocking" (issueUrl blocks relatedIssueUrl) or "relates_to". Parent/child is not a relation here: use the sub-issue tools.';

const relationSchema = {
  type: 'object',
  properties: {
    issueUrl: {
      type: 'string',
      description: 'Issue URL or short ref (owner/repo#num)'
    },
    relation: {
      type: 'string',
      enum: RELATION_TYPES,
      description: RELATION_DESCRIPTION
    },
    relatedIssueUrl: {
      type: 'string',
      description: 'The other issue: URL or short ref (owner/repo#num), any repository'
    }
  },
  required: ['issueUrl', 'relation', 'relatedIssueUrl']
};

// ---------------------------------------------------------------------------
// Tool: list_issue_relations
// ---------------------------------------------------------------------------

export const listIssueRelationsTool = {
  name: 'list_issue_relations',
  annotations: READ_ONLY,
  description: `List the issues that block an issue (blockedBy), that it blocks (blocking) and that it relates to (relatesTo), with each one's state. Reads the first ${RELATIONS_PAGE} of each; \`hidden\` counts the related issues the caller cannot read, and a list holding more says \`truncated: true\` and its \`totalCount\`. Works for any issue, on a board or not. Parent/child links are read with list_sub_issues and get_parent_issue.`,
  inputSchema: {
    type: 'object',
    properties: {
      issueUrl: {
        type: 'string',
        description: 'Issue URL or short ref (owner/repo#num)'
      }
    },
    required: ['issueUrl']
  }
};

export async function handleListIssueRelations(args, extra) {
  try {
    const token = extractToken(extra);
    const target = parseIssueRef(args.issueUrl);
    logger.info('MCP: Listing issue relations', target);

    const relations = await listIssueRelations(target, token);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(relations)
      }]
    };
  } catch (error) {
    logger.error('MCP: Error listing issue relations', { error: error.message });
    return { error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Tool: add_issue_relation
// ---------------------------------------------------------------------------

export const addIssueRelationTool = {
  name: 'add_issue_relation',
  annotations: additiveWrite(),
  description: 'Set a relation between two issues of any repository: "blocked_by", "blocking" or "relates_to". Use it for a dependency between issues ("X cannot start before Y is done") instead of a "Blocked by" line in the issue body.',
  inputSchema: relationSchema
};

export async function handleAddIssueRelation(args, extra) {
  try {
    const token = extractToken(extra);
    const issue = parseIssueRef(args.issueUrl);
    const related = parseIssueRef(args.relatedIssueUrl);
    logger.info('MCP: Adding issue relation', { issue, relation: args.relation, related });

    await addIssueRelation(issue, args.relation, related, token);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: true, issue: args.issueUrl, relation: args.relation, related: args.relatedIssueUrl })
      }]
    };
  } catch (error) {
    logger.error('MCP: Error adding issue relation', { error: error.message });
    return { error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Tool: remove_issue_relation
// ---------------------------------------------------------------------------

export const removeIssueRelationTool = {
  name: 'remove_issue_relation',
  annotations: destructiveWrite(),
  description: 'Remove a "blocked_by", "blocking" or "relates_to" relation between two issues. "blocked_by" and "blocking" name one dependency from its two sides ("A blocked_by B" is "B blocking A"), so either removes it. Remove "relates_to" naming the issues as it was set.',
  inputSchema: relationSchema
};

export async function handleRemoveIssueRelation(args, extra) {
  try {
    const token = extractToken(extra);
    const issue = parseIssueRef(args.issueUrl);
    const related = parseIssueRef(args.relatedIssueUrl);
    logger.info('MCP: Removing issue relation', { issue, relation: args.relation, related });

    await removeIssueRelation(issue, args.relation, related, token);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: true, removed: true, issue: args.issueUrl, relation: args.relation, related: args.relatedIssueUrl })
      }]
    };
  } catch (error) {
    logger.error('MCP: Error removing issue relation', { error: error.message });
    return { error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const relationTools = [
  listIssueRelationsTool,
  addIssueRelationTool,
  removeIssueRelationTool
];

export const relationToolHandlers = {
  list_issue_relations: handleListIssueRelations,
  add_issue_relation: handleAddIssueRelation,
  remove_issue_relation: handleRemoveIssueRelation
};
