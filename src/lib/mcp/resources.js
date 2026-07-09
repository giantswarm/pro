/**
 * MCP Resources Implementation
 *
 * Exposes per-board resources providing context about project boards:
 *   - {board}://schema: Compact field schema with valid option values, repository guidance, and content policy
 *   - {board}://overview: Board-level stats (issue counts, status and repository distribution)
 *
 * Supported boards: roadmap, customer
 */

import { listFields } from '../fields.js';
import { fetchPaginated } from '../api.js';
import { BOARDS, LIST_ITEMS_OVERVIEW_QUERY } from '../project.js';
import { logger } from '../logger.js';

/**
 * Board-specific repository documentation for the schema resource.
 * Helps the LLM understand which repositories exist on each board,
 * how to use the `repository` filter on `list_issues`, and the
 * content policy for each repository.
 */
const REPOSITORY_SCHEMA = {
  roadmap: {
    repositories: [
      { name: 'giantswarm/roadmap', visibility: 'public', usage: 'Sanitized, public-safe issues only.' },
      { name: 'giantswarm/giantswarm', visibility: 'private', usage: 'Internal issues and customer-specific operational context.' }
    ],
    policy: [
      'Use giantswarm/roadmap only for sanitized, public-safe content.',
      'Never include customer-specific or internal-sensitive details in public issues.',
      'Use giantswarm/giantswarm for internal issues and customer-specific operational context.'
    ]
  },
  customer: {
    repositoryPattern: 'giantswarm/<customer-name>',
    policy: [
      'Customer board issues live in private customer-specific repositories (e.g. giantswarm/<customer>).',
      'The customer project board itself is a public GitHub project, but issue content is only visible to users with access to the private repository.',
      'Giant Swarm staff can see all issues; customers can only see issues from their own repository.',
      'Never move customer-specific issue content into public repositories.'
    ]
  }
};

/**
 * Project field data types that don't have enumerable option values.
 * These are skipped from the schema's `fields` map because they can't be
 * used with the generic `filters` parameter on list_issues.
 *
 * Note: some of these (ASSIGNEES, LABELS, REPOSITORY) ARE filterable via
 * dedicated parameters on list_issues — those are documented separately
 * in the schema's `issueFilters` section.
 */
const SKIP_DATA_TYPES = new Set([
  'TITLE', 'ASSIGNEES', 'LABELS', 'LINKED_PULL_REQUESTS',
  'REVIEWERS', 'REPOSITORY', 'MILESTONE', 'PARENT_ISSUE', 'SUB_ISSUES_PROGRESS'
]);

/**
 * Generate the schema resource for a board.
 * Compact field schema: only actionable fields, no internal IDs, no empty values.
 * Organised by category so the LLM can quickly find valid filter/update values.
 *
 * @param {string} boardKey - Board key (e.g. "roadmap", "customer")
 * @param {string} [token] - Optional per-request GitHub token
 * @returns {Promise<Object>} - MCP resource response
 */
async function getSchemaResource(boardKey, token) {
  const board = BOARDS[boardKey];
  if (!board) {
    throw new Error(`Unknown board '${boardKey}'. Valid boards: ${Object.keys(BOARDS).join(', ')}`);
  }
  try {
    logger.info(`MCP: Generating schema resource for ${boardKey} board`);

    const fields = await listFields(board.id, token);

    // Categorise fields with enumerable options (skip types without option values)
    const selectFields = {};
    const hints = {};
    const dateFields = [];
    const textFields = [];
    const iterationFields = {};

    for (const field of fields) {
      if (SKIP_DATA_TYPES.has(field.dataType)) continue;

      if (field.__typename === 'ProjectV2SingleSelectField' && field.options?.length) {
        selectFields[field.name] = field.options.map(opt => opt.name);

        // Collect non-empty option descriptions as hints (e.g. team responsibilities)
        const fieldHints = {};
        let hasHints = false;
        for (const opt of field.options) {
          if (opt.description?.trim()) {
            fieldHints[opt.name] = opt.description.trim();
            hasHints = true;
          }
        }
        if (hasHints) hints[field.name] = fieldHints;
      } else if (field.dataType === 'DATE') {
        dateFields.push(field.name);
      } else if (field.dataType === 'TEXT') {
        textFields.push(field.name);
      } else if (field.__typename === 'ProjectV2IterationField') {
        const iterations = field.configuration?.iterations || [];
        iterationFields[field.name] = iterations.map(iter => iter.title);
      }
    }

    // Build compact schema — only include non-empty sections
    const schema = { fields: selectFields };
    if (Object.keys(hints).length) schema.hints = hints;
    if (dateFields.length) schema.dateFields = dateFields;
    if (textFields.length) schema.textFields = textFields;
    if (Object.keys(iterationFields).length) schema.iterationFields = iterationFields;

    // Document issue-level filters (not project fields, but available on list_issues)
    schema.issueFilters = {
      repository: 'Short name (e.g. "myrepo") or full "owner/name". See repos/repoPattern below for valid values.',
      assignee: 'GitHub username (e.g. "octocat"). Comma-separated for OR matching.',
      label: 'Label name (e.g. "bug"). Comma-separated for OR matching.',
      state: '"open" or "closed"',
      keyword: 'Free text search on titles and text fields (word-prefix matching)',
      updated: 'Last-updated date filter. Examples: ">@today-7d" (last 7 days), "<@today-30d" (older than 30 days), "@today" (today), ">2025-01-01" (after date)',
      reason: '"completed", "not planned", or "reopened" (close reason for closed items)'
    };

    // Compact repository info
    const repoInfo = REPOSITORY_SCHEMA[boardKey];
    if (repoInfo) {
      if (repoInfo.repositories?.length) {
        schema.repos = {};
        for (const repo of repoInfo.repositories) {
          schema.repos[repo.name] = `${repo.visibility}, ${repo.usage}`;
        }
      }
      if (repoInfo.repositoryPattern) {
        schema.repoPattern = repoInfo.repositoryPattern;
      }
      if (repoInfo.policy?.length) {
        schema.policy = repoInfo.policy.join(' ');
      }
    }

    return {
      contents: [{
        uri: `${boardKey}://schema`,
        mimeType: 'application/json',
        text: JSON.stringify(schema)
      }]
    };
  } catch (error) {
    logger.error(`MCP: Error generating schema resource for ${boardKey}`, { error: error.message });
    throw error;
  }
}

/**
 * Generate the overview resource for a board.
 * Board-level stats: total items, status distribution, repository distribution.
 *
 * Uses a lightweight GraphQL query (Status + repository only) instead of
 * the full listItems() to stay within the 60-second MCP resource timeout
 * on large boards (the roadmap board has thousands of items).
 *
 * @param {string} boardKey - Board key (e.g. "roadmap", "customer")
 * @param {string} [token] - Optional per-request GitHub token
 * @returns {Promise<Object>} - MCP resource response
 */
async function getOverviewResource(boardKey, token) {
  const board = BOARDS[boardKey];
  if (!board) {
    throw new Error(`Unknown board '${boardKey}'. Valid boards: ${Object.keys(BOARDS).join(', ')}`);
  }
  try {
    logger.info(`MCP: Generating overview resource for ${boardKey} board`);

    const allItems = await fetchPaginated(
      LIST_ITEMS_OVERVIEW_QUERY,
      { projectId: board.id, first: 100 },
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

    // Build distributions from lightweight item data
    const statusCounts = {};
    const repositoryDistribution = {};
    let totalIssues = 0;

    for (const item of allItems) {
      // Skip items without content (drafts) or without a title
      if (!item.content?.title) continue;
      totalIssues++;

      // Extract Status from single-select field values
      let status = 'Unknown';
      if (item.fieldValues?.nodes) {
        for (const fv of item.fieldValues.nodes) {
          if (fv.field?.name === 'Status' && fv.name) {
            status = fv.name;
            break;
          }
        }
      }
      statusCounts[status] = (statusCounts[status] || 0) + 1;

      const repoName = item.content?.repository?.nameWithOwner || 'unknown';
      repositoryDistribution[repoName] = (repositoryDistribution[repoName] || 0) + 1;
    }

    const overview = {
      board: boardKey,
      boardName: board.name,
      projectId: board.id,
      totalIssues,
      statusDistribution: statusCounts,
      repositoryDistribution,
      lastUpdated: new Date().toISOString()
    };

    return {
      contents: [{
        uri: `${boardKey}://overview`,
        mimeType: 'application/json',
        text: JSON.stringify(overview)
      }]
    };
  } catch (error) {
    logger.error(`MCP: Error generating overview resource for ${boardKey}`, { error: error.message });
    throw error;
  }
}

/**
 * List all available resources (one schema + one overview per board)
 */
export async function listResources() {
  const resources = [];

  for (const [boardKey, board] of Object.entries(BOARDS)) {
    resources.push(
      {
        uri: `${boardKey}://schema`,
        name: `${board.name} Field Schema`,
        description: `Compact schema of the ${board.name}: single-select field names with valid option values, date/text/iteration fields, issue-level filters (assignee, label, state, keyword, updated, reason), repository guidance, and content policy. Read this first to discover valid field names and filter parameters.`,
        mimeType: 'application/json'
      },
      {
        uri: `${boardKey}://overview`,
        name: `${board.name} Overview`,
        description: `High-level overview of the ${board.name} including total items, status distribution, and repository distribution.`,
        mimeType: 'application/json'
      }
    );
  }

  return { resources };
}

/**
 * Read a specific resource by URI
 * @param {string} uri - Resource URI
 * @param {Object} [extra] - MCP request extra context (contains authInfo for HTTP transport)
 */
export async function readResource(uri, extra) {
  try {
    const token = extra?.authInfo?.token;
    logger.info('MCP: Reading resource', { uri });

    // Parse URI: expected format is "{boardKey}://schema" or "{boardKey}://overview"
    const match = uri.match(/^([\w-]+):\/\/([\w-]+)$/);
    if (!match) {
      throw new Error(`Invalid resource URI format: ${uri}`);
    }

    const [, boardKey, resourceType] = match;

    if (!BOARDS[boardKey]) {
      throw new Error(`Unknown board '${boardKey}' in resource URI: ${uri}. Valid boards: ${Object.keys(BOARDS).join(', ')}`);
    }

    if (resourceType === 'schema') {
      return await getSchemaResource(boardKey, token);
    }

    if (resourceType === 'overview') {
      return await getOverviewResource(boardKey, token);
    }

    throw new Error(`Unknown resource type '${resourceType}' in URI: ${uri}`);
  } catch (error) {
    logger.error('MCP: Error reading resource', { uri, error: error.message });
    throw error;
  }
}
