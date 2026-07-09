/**
 * MCP Sub-Issues Tools
 *
 * Exposes 6 tools for managing GitHub sub-issues (parent/child relationships):
 *   - list_sub_issues: List sub-issues of a parent issue
 *   - add_sub_issue: Add a sub-issue to a parent
 *   - remove_sub_issue: Remove a sub-issue from a parent
 *   - get_parent_issue: Get the parent of an issue
 *   - reprioritize_sub_issue: Reorder a sub-issue within its parent
 *   - migrate_task_list_to_sub_issues: Convert markdown task lists to sub-issues
 */

import { getOctokit, parseIssueRef, resolveIssueId } from '../rest-api.js';
import {
  listSubIssues,
  addSubIssue,
  removeSubIssue,
  getParentIssue,
  reprioritizeSubIssue
} from '../sub-issues.js';
import { logger } from '../logger.js';

/**
 * Extract the GitHub token from MCP request extra context.
 * @param {Object} [extra] - MCP request extra context
 * @returns {string|undefined}
 */
function extractToken(extra) {
  return extra?.authInfo?.token;
}

/**
 * Resolve owner/repo/issue_number from flexible tool args.
 * Accepts either an `issueUrl` string or explicit `owner`/`repo`/`issue_number`.
 */
function resolveIssueArgs(args, urlKey = 'issueUrl') {
  if (args[urlKey]) {
    return parseIssueRef(args[urlKey]);
  }
  if (args.owner && args.repo && args.issue_number) {
    return { owner: args.owner, repo: args.repo, issue_number: Number(args.issue_number) };
  }
  throw new Error(`Provide either '${urlKey}' (URL or owner/repo#num) or 'owner', 'repo', and 'issue_number'.`);
}

function compactIssue(issue) {
  return {
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    state: issue.state,
    repository: issue.repository
      ? `${issue.repository.owner?.login ?? issue.repository.owner}/${issue.repository.name}`
      : undefined,
    sub_issues_summary: issue.sub_issues_summary ?? undefined
  };
}

// ---------------------------------------------------------------------------
// Tool: list_sub_issues
// ---------------------------------------------------------------------------

export const listSubIssuesTool = {
  name: 'list_sub_issues',
  description: 'List the sub-issues of a GitHub issue. Provide the parent issue as a URL (e.g. "https://github.com/owner/repo/issues/1"), short ref ("owner/repo#1"), or explicit owner/repo/issue_number.',
  inputSchema: {
    type: 'object',
    properties: {
      issueUrl: {
        type: 'string',
        description: 'Issue URL or short ref (owner/repo#num)'
      },
      owner: { type: 'string', description: 'Repository owner' },
      repo: { type: 'string', description: 'Repository name' },
      issue_number: { type: 'number', description: 'Issue number' },
      per_page: {
        type: 'number',
        description: 'Results per page (max 100, default 30)'
      },
      page: {
        type: 'number',
        description: 'Page number (default 1)'
      }
    }
  }
};

export async function handleListSubIssues(args, extra) {
  try {
    const token = extractToken(extra);
    const { owner, repo, issue_number } = resolveIssueArgs(args);
    logger.info('MCP: Listing sub-issues', { owner, repo, issue_number });

    const data = await listSubIssues(
      {
        owner,
        repo,
        issue_number,
        per_page: args.per_page || 30,
        page: args.page || 1
      },
      token
    );

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          count: data.length,
          sub_issues: data.map(compactIssue)
        })
      }]
    };
  } catch (error) {
    logger.error('MCP: Error listing sub-issues', { error: error.message });
    return { error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Tool: add_sub_issue
// ---------------------------------------------------------------------------

export const addSubIssueTool = {
  name: 'add_sub_issue',
  description: 'Add a sub-issue to a parent issue. Provide the parent issue and the child issue to add. The child can be specified as a URL/ref (subIssueUrl) or integer ID (subIssueId).',
  inputSchema: {
    type: 'object',
    properties: {
      issueUrl: {
        type: 'string',
        description: 'Parent issue URL or short ref (owner/repo#num)'
      },
      owner: { type: 'string', description: 'Parent repository owner' },
      repo: { type: 'string', description: 'Parent repository name' },
      issue_number: { type: 'number', description: 'Parent issue number' },
      subIssueUrl: {
        type: 'string',
        description: 'Child issue URL or short ref to add as sub-issue'
      },
      subIssueId: {
        type: 'number',
        description: 'Child issue integer ID (use instead of subIssueUrl if already known)'
      },
      replaceParent: {
        type: 'boolean',
        description: 'If true, replaces the child\'s existing parent (if any). Default false.'
      }
    }
  }
};

export async function handleAddSubIssue(args, extra) {
  try {
    const token = extractToken(extra);
    const { owner, repo, issue_number } = resolveIssueArgs(args);
    logger.info('MCP: Adding sub-issue', { owner, repo, issue_number });

    let subIssueId = args.subIssueId;
    if (!subIssueId) {
      if (!args.subIssueUrl) {
        return { error: 'Provide either subIssueUrl or subIssueId for the child issue.' };
      }
      const resolved = await resolveIssueId(args.subIssueUrl, { token });
      subIssueId = resolved.id;
    }

    const data = await addSubIssue(
      {
        owner,
        repo,
        issue_number,
        subIssueId,
        replaceParent: args.replaceParent || false
      },
      token
    );

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          parent: compactIssue(data)
        })
      }]
    };
  } catch (error) {
    logger.error('MCP: Error adding sub-issue', { error: error.message });
    return { error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Tool: remove_sub_issue
// ---------------------------------------------------------------------------

export const removeSubIssueTool = {
  name: 'remove_sub_issue',
  description: 'Remove a sub-issue from a parent issue. Provide the parent issue and the child issue to remove.',
  inputSchema: {
    type: 'object',
    properties: {
      issueUrl: {
        type: 'string',
        description: 'Parent issue URL or short ref (owner/repo#num)'
      },
      owner: { type: 'string', description: 'Parent repository owner' },
      repo: { type: 'string', description: 'Parent repository name' },
      issue_number: { type: 'number', description: 'Parent issue number' },
      subIssueUrl: {
        type: 'string',
        description: 'Child issue URL or short ref to remove'
      },
      subIssueId: {
        type: 'number',
        description: 'Child issue integer ID (use instead of subIssueUrl if already known)'
      }
    }
  }
};

export async function handleRemoveSubIssue(args, extra) {
  try {
    const token = extractToken(extra);
    const { owner, repo, issue_number } = resolveIssueArgs(args);
    logger.info('MCP: Removing sub-issue', { owner, repo, issue_number });

    let subIssueId = args.subIssueId;
    if (!subIssueId) {
      if (!args.subIssueUrl) {
        return { error: 'Provide either subIssueUrl or subIssueId for the child issue.' };
      }
      const resolved = await resolveIssueId(args.subIssueUrl, { token });
      subIssueId = resolved.id;
    }

    await removeSubIssue({ owner, repo, issue_number, subIssueId }, token);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: true, removed: subIssueId })
      }]
    };
  } catch (error) {
    logger.error('MCP: Error removing sub-issue', { error: error.message });
    return { error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Tool: get_parent_issue
// ---------------------------------------------------------------------------

export const getParentIssueTool = {
  name: 'get_parent_issue',
  description: 'Get the parent issue of a given issue. Returns null if the issue has no parent.',
  inputSchema: {
    type: 'object',
    properties: {
      issueUrl: {
        type: 'string',
        description: 'Child issue URL or short ref (owner/repo#num)'
      },
      owner: { type: 'string', description: 'Repository owner' },
      repo: { type: 'string', description: 'Repository name' },
      issue_number: { type: 'number', description: 'Issue number' }
    }
  }
};

export async function handleGetParentIssue(args, extra) {
  try {
    const token = extractToken(extra);
    const { owner, repo, issue_number } = resolveIssueArgs(args);
    logger.info('MCP: Getting parent issue', { owner, repo, issue_number });

    const data = await getParentIssue({ owner, repo, issue_number }, token);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ parent: data ? compactIssue(data) : null })
      }]
    };
  } catch (error) {
    logger.error('MCP: Error getting parent issue', { error: error.message });
    return { error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Tool: reprioritize_sub_issue
// ---------------------------------------------------------------------------

export const reprioritizeSubIssueTool = {
  name: 'reprioritize_sub_issue',
  description: 'Reorder a sub-issue within its parent\'s sub-issue list. Specify either afterUrl/afterId (place after that issue) or beforeUrl/beforeId (place before that issue).',
  inputSchema: {
    type: 'object',
    properties: {
      issueUrl: {
        type: 'string',
        description: 'Parent issue URL or short ref (owner/repo#num)'
      },
      owner: { type: 'string', description: 'Parent repository owner' },
      repo: { type: 'string', description: 'Parent repository name' },
      issue_number: { type: 'number', description: 'Parent issue number' },
      subIssueUrl: {
        type: 'string',
        description: 'Sub-issue URL or short ref to reorder'
      },
      subIssueId: {
        type: 'number',
        description: 'Sub-issue integer ID (use instead of subIssueUrl if already known)'
      },
      afterUrl: {
        type: 'string',
        description: 'Place the sub-issue after this issue (URL or short ref)'
      },
      afterId: {
        type: 'number',
        description: 'Place the sub-issue after this issue (integer ID)'
      },
      beforeUrl: {
        type: 'string',
        description: 'Place the sub-issue before this issue (URL or short ref)'
      },
      beforeId: {
        type: 'number',
        description: 'Place the sub-issue before this issue (integer ID)'
      }
    }
  }
};

export async function handleReprioritizeSubIssue(args, extra) {
  try {
    const token = extractToken(extra);
    const { owner, repo, issue_number } = resolveIssueArgs(args);
    logger.info('MCP: Reprioritizing sub-issue', { owner, repo, issue_number });

    let subIssueId = args.subIssueId;
    if (!subIssueId) {
      if (!args.subIssueUrl) {
        return { error: 'Provide either subIssueUrl or subIssueId for the sub-issue to reorder.' };
      }
      const resolved = await resolveIssueId(args.subIssueUrl, { token });
      subIssueId = resolved.id;
    }

    let afterId = args.afterId;
    if (!afterId && args.afterUrl) {
      const resolved = await resolveIssueId(args.afterUrl, { token });
      afterId = resolved.id;
    }

    let beforeId = args.beforeId;
    if (!beforeId && args.beforeUrl) {
      const resolved = await resolveIssueId(args.beforeUrl, { token });
      beforeId = resolved.id;
    }

    if (!afterId && !beforeId) {
      return { error: 'Provide either afterUrl/afterId or beforeUrl/beforeId to specify the new position.' };
    }

    await reprioritizeSubIssue({ owner, repo, issue_number, subIssueId, afterId, beforeId }, token);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: true, sub_issue_id: subIssueId })
      }]
    };
  } catch (error) {
    logger.error('MCP: Error reprioritizing sub-issue', { error: error.message });
    return { error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Tool: migrate_task_list_to_sub_issues
// ---------------------------------------------------------------------------

const TASK_LINE_RE = /^(\s*-\s*\[[ xX]\])\s+(.+)$/;

const EMBEDDED_ISSUE_URL_RE = /https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?/;
const MARKDOWN_LINK_ISSUE_RE = /\[([^\]]*)\]\(https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?[^)]*\)/;
const BARE_SHORT_REF_RE = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)$/;
const BARE_SAME_REPO_RE = /^#(\d+)$/;
const LEADING_SHORT_REF_RE = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)(?:[\s),.;:!?~]|$)/;
const EMBEDDED_SHORT_REF_RE = /(?:^|[\s(~])([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)(?:[\s),.;:!?~]|$)/;
const EMBEDDED_SAME_REPO_RE = /(?:^|[\s(~])#(\d+)(?:[\s),.;:!?~]|$)/;

/**
 * Extract an issue reference from a task-list item's text content.
 * Strips leading ~~ (strikethrough) before matching. Tries in priority order:
 *   1. Bare (exact-match) refs: entire text is a URL, short ref, or #N
 *   2. Leading short ref: text starts with owner/repo#N (before checking deeper)
 *   3. Markdown links to issues: [text](https://github.com/o/r/issues/N)
 *   4. Embedded URLs: descriptive text containing a github issue URL
 *   5. Embedded short refs: text containing owner/repo#N
 *   6. Embedded same-repo refs: text containing #N
 *
 * @param {string} text - The text after the checkbox
 * @param {string} fallbackOwner - Owner to use for same-repo (#N) refs
 * @param {string} fallbackRepo - Repo to use for same-repo (#N) refs
 * @returns {{ owner: string, repo: string, issue_number: number } | null}
 */
export function extractIssueRef(text, fallbackOwner, fallbackRepo) {
  const trimmed = text.trim();

  const stripped = trimmed.replace(/^~~\s*/, '').replace(/\s*~~$/, '');

  const bareUrlMatch = stripped.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/);
  if (bareUrlMatch) {
    return { owner: bareUrlMatch[1], repo: bareUrlMatch[2], issue_number: parseInt(bareUrlMatch[3], 10) };
  }

  const bareShortMatch = stripped.match(BARE_SHORT_REF_RE);
  if (bareShortMatch) {
    return { owner: bareShortMatch[1], repo: bareShortMatch[2], issue_number: parseInt(bareShortMatch[3], 10) };
  }

  const bareSameRepoMatch = stripped.match(BARE_SAME_REPO_RE);
  if (bareSameRepoMatch && fallbackOwner && fallbackRepo) {
    return { owner: fallbackOwner, repo: fallbackRepo, issue_number: parseInt(bareSameRepoMatch[1], 10) };
  }

  // Check for a short ref at the START of the text before trying markdown links
  // or embedded URLs. This ensures that when text starts with owner/repo#N (e.g.
  // after stripping ~~), it takes priority over a markdown link deeper in the text.
  const leadingShortMatch = stripped.match(LEADING_SHORT_REF_RE);
  if (leadingShortMatch) {
    return { owner: leadingShortMatch[1], repo: leadingShortMatch[2], issue_number: parseInt(leadingShortMatch[3], 10) };
  }

  const mdLinkMatch = stripped.match(MARKDOWN_LINK_ISSUE_RE);
  if (mdLinkMatch) {
    return { owner: mdLinkMatch[2], repo: mdLinkMatch[3], issue_number: parseInt(mdLinkMatch[4], 10) };
  }

  const embeddedUrlMatch = stripped.match(EMBEDDED_ISSUE_URL_RE);
  if (embeddedUrlMatch) {
    return { owner: embeddedUrlMatch[1], repo: embeddedUrlMatch[2], issue_number: parseInt(embeddedUrlMatch[3], 10) };
  }

  const embeddedShortMatch = stripped.match(EMBEDDED_SHORT_REF_RE);
  if (embeddedShortMatch) {
    return { owner: embeddedShortMatch[1], repo: embeddedShortMatch[2], issue_number: parseInt(embeddedShortMatch[3], 10) };
  }

  const embeddedSameRepoMatch = stripped.match(EMBEDDED_SAME_REPO_RE);
  if (embeddedSameRepoMatch && fallbackOwner && fallbackRepo) {
    return { owner: fallbackOwner, repo: fallbackRepo, issue_number: parseInt(embeddedSameRepoMatch[1], 10) };
  }

  return null;
}

export const migrateTaskListTool = {
  name: 'migrate_task_list_to_sub_issues',
  description: 'Convert markdown task-list items in an issue body into sub-issues. Parses lines like "- [ ] https://github.com/o/r/issues/1", "- [x] owner/repo#1", or "- [ ] #1" (same-repo). Optionally removes converted lines from the issue body.',
  inputSchema: {
    type: 'object',
    properties: {
      issueUrl: {
        type: 'string',
        description: 'The epic/parent issue URL or short ref containing the task list'
      },
      owner: { type: 'string', description: 'Repository owner' },
      repo: { type: 'string', description: 'Repository name' },
      issue_number: { type: 'number', description: 'Issue number' },
      removeTaskList: {
        type: 'boolean',
        description: 'If true, remove converted task-list lines from the issue body after migration. Default false.'
      }
    }
  }
};

export async function handleMigrateTaskList(args, extra) {
  try {
    const token = extractToken(extra);
    const client = getOctokit(token);
    const { owner, repo, issue_number } = resolveIssueArgs(args);
    logger.info('MCP: Migrating task list to sub-issues', { owner, repo, issue_number });

    const { data: issue } = await client.rest.issues.get({ owner, repo, issue_number });
    const body = (issue.body || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = body.split('\n');

    const converted = [];
    const failed = [];
    const skipped = [];
    const convertedLineIndices = new Set();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const taskMatch = line.match(TASK_LINE_RE);
      if (!taskMatch) continue;

      const text = taskMatch[2];
      const issueRef = extractIssueRef(text, owner, repo);

      if (!issueRef) {
        skipped.push({ line: i + 1, text: text.trim(), reason: 'not an issue reference' });
        continue;
      }

      const { owner: childOwner, repo: childRepo, issue_number: childNumber } = issueRef;

      try {
        const resolved = await resolveIssueId(childOwner, childRepo, childNumber, { token });
        await addSubIssue(
          { owner, repo, issue_number, subIssueId: resolved.id, replaceParent: false },
          token
        );
        converted.push({
          number: resolved.number,
          title: resolved.title,
          url: resolved.html_url,
          repository: `${childOwner}/${childRepo}`
        });
        convertedLineIndices.add(i);
      } catch (err) {
        failed.push({
          ref: `${childOwner}/${childRepo}#${childNumber}`,
          error: err.message
        });
      }
    }

    if (args.removeTaskList && convertedLineIndices.size > 0) {
      const newBody = lines
        .filter((_, i) => !convertedLineIndices.has(i))
        .join('\n');
      await client.rest.issues.update({ owner, repo, issue_number, body: newBody });
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          converted,
          failed,
          skipped,
          summary: `${converted.length} converted, ${failed.length} failed, ${skipped.length} skipped`
        })
      }]
    };
  } catch (error) {
    logger.error('MCP: Error migrating task list', { error: error.message });
    return { error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const subIssueTools = [
  listSubIssuesTool,
  addSubIssueTool,
  removeSubIssueTool,
  getParentIssueTool,
  reprioritizeSubIssueTool,
  migrateTaskListTool
];

export const subIssueToolHandlers = {
  list_sub_issues: handleListSubIssues,
  add_sub_issue: handleAddSubIssue,
  remove_sub_issue: handleRemoveSubIssue,
  get_parent_issue: handleGetParentIssue,
  reprioritize_sub_issue: handleReprioritizeSubIssue,
  migrate_task_list_to_sub_issues: handleMigrateTaskList
};
