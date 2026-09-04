/**
 * Board tools for UIs: the field schema as a tool result and the board item of
 * a given issue. Both exist because a UI (the Dev Portal's roadmap page) needs
 * them as tools it can call through an MCP aggregator on behalf of the person,
 * where the schema resource and a board scan would not do.
 */

import { listFields } from '../fields.js';
import { graphQLWithAuth } from '../api.js';
import { resolveBoardId, DEFAULT_BOARD } from '../project.js';
import { parseIssueRef } from '../rest-api.js';
import { logger } from '../logger.js';

function extractToken(extra) {
  return extra?.authInfo?.token;
}

/**
 * The field description a UI works with: name, a coarse type, and the values
 * a single-select or iteration field accepts. Internal ids stay out.
 */
export function describeField(field) {
  let type = 'other';
  if (field.__typename === 'ProjectV2SingleSelectField') {
    type = 'singleSelect';
  } else if (field.__typename === 'ProjectV2IterationField') {
    type = 'iteration';
  } else if (field.__typename === 'ProjectV2Field') {
    type = field.dataType === 'DATE' ? 'date' : 'text';
  }
  const described = { name: field.name, type };
  if (field.options) {
    described.options = field.options.map(option => option.name);
  }
  if (field.configuration?.iterations) {
    described.iterations = field.configuration.iterations.map(iteration => iteration.title);
  }
  return described;
}

export const getBoardSchemaTool = {
  name: 'get_board_schema',
  description: 'Describe the fields of a project board (roadmap or customer) the way a UI needs them: name, type (singleSelect, iteration, date, text, other), the options a single-select field accepts and the iterations of an iteration field. The same information as the {board}://schema resource, as a tool result.',
  inputSchema: {
    type: 'object',
    properties: {
      board: {
        type: 'string',
        enum: ['roadmap', 'customer'],
        description: 'Which board to describe. Defaults to "roadmap".'
      }
    }
  }
};

export async function handleGetBoardSchema(args, extra) {
  try {
    const token = extractToken(extra);
    const board = (args.board || DEFAULT_BOARD).toLowerCase();
    const boardId = resolveBoardId(board);
    logger.info('MCP: Describing board schema', { board });

    const fields = await listFields(boardId, token);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ board, fields: fields.map(describeField) })
      }]
    };
  } catch (error) {
    logger.error('MCP: Error describing board schema', { error: error.message });
    return { error: error.message };
  }
}

const ISSUE_PROJECT_ITEM_QUERY = `
  query IssueProjectItem($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        title
        url
        state
        projectItems(first: 20, includeArchived: false) {
          nodes {
            id
            project { id }
            fieldValues(first: 30) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field { ... on ProjectV2FieldCommon { name } }
                }
                ... on ProjectV2ItemFieldIterationValue {
                  title
                  field { ... on ProjectV2FieldCommon { name } }
                }
                ... on ProjectV2ItemFieldDateValue {
                  date
                  field { ... on ProjectV2FieldCommon { name } }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const getItemByIssueTool = {
  name: 'get_item_by_issue',
  description: 'Find the project board item of one GitHub issue -- given as a URL, a short ref ("owner/repo#N") or owner/repo/issue_number -- without scanning the board. Returns the item id, title, url, state and field values, or item: null when the issue is not on the board.',
  inputSchema: {
    type: 'object',
    properties: {
      issueUrl: { type: 'string', description: 'Issue URL or short ref (owner/repo#num)' },
      owner: { type: 'string', description: 'Repository owner' },
      repo: { type: 'string', description: 'Repository name' },
      issue_number: { type: 'number', description: 'Issue number' },
      board: {
        type: 'string',
        enum: ['roadmap', 'customer'],
        description: 'Which board to look on. Defaults to "roadmap".'
      }
    }
  }
};

function resolveIssueArgs(args) {
  if (args.issueUrl) {
    return parseIssueRef(args.issueUrl);
  }
  if (args.owner && args.repo && args.issue_number) {
    return { owner: args.owner, repo: args.repo, issue_number: Number(args.issue_number) };
  }
  throw new Error("Provide either 'issueUrl' (URL or owner/repo#num) or 'owner', 'repo', and 'issue_number'.");
}

export async function handleGetItemByIssue(args, extra) {
  try {
    const token = extractToken(extra);
    const board = (args.board || DEFAULT_BOARD).toLowerCase();
    const boardId = resolveBoardId(board);
    const { owner, repo, issue_number } = resolveIssueArgs(args);
    logger.info('MCP: Looking up board item by issue', { board, owner, repo, issue_number });

    const result = await graphQLWithAuth(
      ISSUE_PROJECT_ITEM_QUERY,
      { owner, repo, number: issue_number },
      token
    );
    const issue = result?.repository?.issue;
    const node = issue?.projectItems?.nodes?.find(item => item?.project?.id === boardId);
    if (!issue || !node) {
      return { content: [{ type: 'text', text: JSON.stringify({ item: null }) }] };
    }

    const fields = {};
    for (const fieldValue of node.fieldValues?.nodes || []) {
      const value = fieldValue?.name ?? fieldValue?.title ?? fieldValue?.date;
      if (fieldValue?.field?.name && value) {
        fields[fieldValue.field.name] = value;
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          item: {
            id: node.id,
            title: issue.title,
            number: issue_number,
            url: issue.url,
            repo: `${owner}/${repo}`,
            state: issue.state,
            fields
          }
        })
      }]
    };
  } catch (error) {
    logger.error('MCP: Error looking up board item by issue', { error: error.message });
    return { error: error.message };
  }
}

export const boardTools = [getBoardSchemaTool, getItemByIssueTool];

export const boardToolHandlers = {
  get_board_schema: handleGetBoardSchema,
  get_item_by_issue: handleGetItemByIssue
};
