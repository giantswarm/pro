/**
 * @giantswarm-io/pro — importable core
 *
 * Library entry point for consumers that want pro's GitHub Projects board
 * logic without the MCP server (e.g. the Backstage roadmap backend plugin).
 *
 * Every function accepts an optional per-request GitHub token as its last
 * argument (or `token` option), falling back to the GITHUB_API_TOKEN
 * environment variable. This is the injection point for callers that manage
 * their own credentials (GitHub App installation tokens, per-user OAuth).
 *
 * The MCP server and CLI live behind `bin/index.js` and are not exported here.
 */

// Board registry and GraphQL queries
export {
  BOARDS,
  DEFAULT_BOARD,
  resolveBoardId
} from './lib/project.js';

// Project items: list/filter, detail, batched item -> issue resolution,
// field mutation
export {
  listItems,
  getItemByID,
  resolveItemIssues,
  updateItemField
} from './lib/items.js';

// Board fields: listing and name/value resolution (needed to build
// updateItemField mutation values from human-readable names)
export {
  listFields,
  findFieldByName,
  findMatchingOption,
  findMatchingIteration
} from './lib/fields.js';

// Sub-issue REST API (parent/child issue relationships)
export {
  listSubIssues,
  addSubIssue,
  removeSubIssue,
  getParentIssue,
  reprioritizeSubIssue
} from './lib/sub-issues.js';

// Bulk issue comment fetching (board items -> underlying issue comments)
export {
  listIssueCommentsForItems,
  fetchIssueComments
} from './lib/comments.js';

// Issue timeline (REST): compact activity events for an issue
export {
  getIssueTimeline,
  compactTimelineEvent,
  MAX_TIMELINE_EVENTS
} from './lib/timeline.js';

// Low-level GitHub clients for anything not covered above
export { graphQLWithAuth, fetchPaginated } from './lib/api.js';
export { getOctokit, parseIssueRef, resolveIssueId } from './lib/rest-api.js';
