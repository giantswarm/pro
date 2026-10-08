/**
 * Board tools for UIs: the field schema as a tool result and the board item of
 * a given issue. Both exist because a UI (the Dev Portal's roadmap page) needs
 * them as tools it can call through an MCP aggregator on behalf of the person,
 * where the schema resource and a board scan would not do.
 */

import { listFields } from '../fields.js';
import { graphQLWithAuth } from '../api.js';
import { resolveBoardId, BOARDS, DEFAULT_BOARD } from '../project.js';
import { parseIssueRef } from '../rest-api.js';
import { logger } from '../logger.js';
import { READ_ONLY } from './annotations.js';

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
  annotations: READ_ONLY,
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

/**
 * The issue (or pull request) behind a URL, and the board items of its
 * repository whose text matches its number. The issue's own projectItems list
 * only projects of the issue's owner, so an issue of another repository on the
 * board is found from the board side: the item whose content is the resolved
 * node. The number narrows the board query; the node id decides.
 */
const ISSUE_BOARD_ITEM_QUERY = `
  query IssueBoardItem($url: URI!, $boardId: ID!, $itemQuery: String!, $after: String) {
    resource(url: $url) {
      __typename
      ... on Issue { id number title url state repository { nameWithOwner } }
      ... on PullRequest { id number title url state repository { nameWithOwner } }
    }
    board: node(id: $boardId) {
      ... on ProjectV2 {
        items(first: 100, after: $after, query: $itemQuery, archivedStates: [NOT_ARCHIVED]) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            content {
              ... on Issue { id }
              ... on PullRequest { id }
            }
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
  annotations: READ_ONLY,
  description: 'Find the project board item of one GitHub issue or pull request of any repository on the board -- given as a URL, a short ref ("owner/repo#N") or owner/repo/issue_number -- without scanning the board. Returns the item id, title, url, state and field values, or item: null with the reason when the issue is not on the board.',
  inputSchema: {
    type: 'object',
    properties: {
      issueUrl: { type: 'string', description: 'Issue or pull request URL, or short ref (owner/repo#num)' },
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

const PULL_URL_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/;

/** The issue's URL and its repository and number, from any accepted form. */
function resolveIssueArgs(args) {
  let ref;
  if (args.issueUrl) {
    const pull = args.issueUrl.trim().match(PULL_URL_RE);
    ref = pull
      ? { owner: pull[1], repo: pull[2], issue_number: parseInt(pull[3], 10) }
      : parseIssueRef(args.issueUrl);
  } else if (args.owner && args.repo && args.issue_number) {
    ref = { owner: args.owner, repo: args.repo, issue_number: Number(args.issue_number) };
  } else {
    throw new Error("Provide either 'issueUrl' (URL or owner/repo#num) or 'owner', 'repo', and 'issue_number'.");
  }
  return { ...ref, url: `https://github.com/${ref.owner}/${ref.repo}/issues/${ref.issue_number}` };
}

function notOnBoard(reason) {
  return { content: [{ type: 'text', text: JSON.stringify({ item: null, reason }) }] };
}

export async function handleGetItemByIssue(args, extra) {
  try {
    const token = extractToken(extra);
    const board = (args.board || DEFAULT_BOARD).toLowerCase();
    const boardId = resolveBoardId(board);
    const boardName = BOARDS[board].name;
    const { owner, repo, issue_number, url } = resolveIssueArgs(args);
    const ref = `${owner}/${repo}#${issue_number}`;
    logger.info('MCP: Looking up board item by issue', { board, owner, repo, issue_number });

    let issue;
    let node;
    let after = null;
    do {
      const result = await graphQLWithAuth(
        ISSUE_BOARD_ITEM_QUERY,
        { url, boardId, itemQuery: `repo:${owner}/${repo} ${issue_number}`, after },
        token
      );
      issue = result?.resource;
      if (!issue) {
        return notOnBoard(`${ref} does not exist or is not readable with this GitHub grant.`);
      }
      if (!issue.id) {
        return notOnBoard(`${url} is a ${issue.__typename}, not an issue or pull request.`);
      }
      const items = result?.board?.items;
      node = items?.nodes?.find(item => item?.content?.id === issue.id);
      after = items?.pageInfo?.hasNextPage ? items.pageInfo.endCursor : null;
    } while (!node && after);

    if (!node) {
      return notOnBoard(`${ref} is not on the ${boardName} (or its item is archived).`);
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
            number: issue.number,
            url: issue.url,
            repo: issue.repository.nameWithOwner,
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
