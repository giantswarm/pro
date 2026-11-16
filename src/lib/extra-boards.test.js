/**
 * A board added with PRO_EXTRA_BOARDS, from the registry to the tools.
 *
 * project.js reads the variable when it is first imported, so it is set
 * before any import here; node:test runs every test file in its own process,
 * which keeps the extra board out of the other files.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.GITHUB_API_TOKEN = 'test-token';
process.env.PRO_EXTRA_BOARDS = JSON.stringify({
  team: { id: 'PVT_team', number: 7, owner: 'octo-org' }
});

const { BOARDS, BOARD_NAMES_TEXT, resolveBoardId, resolveBoardOwner } = await import('./project.js');
const { listItems } = await import('./items.js');
const { tools, handleCreateIssueInProject } = await import('./mcp/tools.js');
const { listResources, readResource } = await import('./mcp/resources.js');

/**
 * Answer every GraphQL request with `data`, keeping each request's body.
 * @returns {Object[]} - The request bodies, in order
 */
function mockGraphQL(t, data) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push(JSON.parse(init.body));
    return {
      status: 200,
      url: 'https://api.github.com/graphql',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ data })
    };
  });
  return calls;
}

const emptyPage = { nodes: [], pageInfo: { hasNextPage: false } };

describe('a board added with PRO_EXTRA_BOARDS', () => {
  it('joins the built-in boards in the registry', () => {
    assert.deepEqual(Object.keys(BOARDS), ['roadmap', 'customer', 'team']);
    assert.equal(BOARD_NAMES_TEXT, 'roadmap, customer, or team');
    assert.equal(resolveBoardId('team'), 'PVT_team');
    assert.equal(resolveBoardOwner('PVT_team'), 'octo-org');
  });

  it('is accepted by every tool that takes a board', () => {
    const boardTools = tools.filter(tool => tool.inputSchema.properties?.board);
    for (const name of ['list_issues', 'update_issue_field', 'create_issue_in_project', 'add_existing_issue', 'archive_item', 'get_board_schema', 'get_item_by_issue']) {
      assert.ok(boardTools.some(tool => tool.name === name), `${name} takes no board`);
    }
    for (const tool of boardTools) {
      assert.deepEqual(tool.inputSchema.properties.board.enum, ['roadmap', 'customer', 'team'], tool.name);
    }
  });

  it('has its schema and overview resources', async () => {
    const { resources } = await listResources();
    const uris = resources.map(resource => resource.uri);
    assert.ok(uris.includes('team://schema'));
    assert.ok(uris.includes('team://overview'));
  });

  it('names its owner as the repository pattern of its schema', async (t) => {
    mockGraphQL(t, { node: { fields: emptyPage } });

    const resource = await readResource('team://schema');
    const schema = JSON.parse(resource.contents[0].text);

    assert.equal(schema.repoPattern, 'octo-org/<repository>');
    assert.equal(schema.repos, undefined);
    assert.equal(schema.policy, undefined);
  });

  it('resolves a short repository name to its owner when listing', async (t) => {
    const calls = mockGraphQL(t, { node: { items: emptyPage, fields: emptyPage } });

    const result = await listItems({ boardId: 'PVT_team', repository: 'myrepo, other-org/theirs', exclude: { repository: 'archive' } });

    assert.equal(result.status, 'success', result.error);
    const { filterQuery } = calls.find(call => 'filterQuery' in call.variables).variables;
    assert.equal(filterQuery, 'repo:octo-org/myrepo,other-org/theirs -repo:octo-org/archive');
  });

  it('keeps giantswarm as the owner on a built-in board', async (t) => {
    const calls = mockGraphQL(t, { node: { items: emptyPage } });

    await listItems({ boardId: BOARDS.roadmap.id, repository: 'myrepo' });

    assert.equal(calls[0].variables.filterQuery, 'repo:giantswarm/myrepo');
  });

  it('creates an issue for a short repository name in its owner\'s repository', async (t) => {
    const calls = mockGraphQL(t, { repository: null });

    const result = await handleCreateIssueInProject({ board: 'team', repository: 'myrepo', title: 'Test issue' });

    assert.deepEqual(calls[0].variables, { owner: 'octo-org', repo: 'myrepo' });
    assert.equal(result.error, "Repository 'octo-org/myrepo' not found");
  });
});
