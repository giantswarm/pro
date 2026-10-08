import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

const fieldsModule = { listFields: mock.fn() };
const apiModule = { graphQLWithAuth: mock.fn() };
mock.module('../fields.js', { namedExports: fieldsModule });
mock.module('../api.js', { namedExports: apiModule });
mock.module('../logger.js', { namedExports: { logger: { info() {}, warn() {}, error() {} } } });

const { describeField, handleGetBoardSchema, handleGetItemByIssue, boardTools } = await import('./board.js');
const { BOARDS } = await import('../project.js');
const ROADMAP_BOARD_ID = BOARDS.roadmap.id;

const extra = { authInfo: { token: 'gho_user' } };
const text = result => JSON.parse(result.content[0].text);

describe('describeField', () => {
  it('maps GitHub field types to UI types and lists the accepted values', () => {
    assert.deepEqual(
      describeField({ __typename: 'ProjectV2SingleSelectField', name: 'Status', options: [{ id: '1', name: 'Inbox' }, { id: '2', name: 'Done' }] }),
      { name: 'Status', type: 'singleSelect', options: ['Inbox', 'Done'] }
    );
    assert.deepEqual(
      describeField({ __typename: 'ProjectV2IterationField', name: 'Quarter', configuration: { iterations: [{ id: 'i1', title: 'Q3' }] } }),
      { name: 'Quarter', type: 'iteration', iterations: ['Q3'] }
    );
    assert.deepEqual(describeField({ __typename: 'ProjectV2Field', name: 'Target Date', dataType: 'DATE' }), { name: 'Target Date', type: 'date' });
    assert.deepEqual(describeField({ __typename: 'ProjectV2Field', name: 'Notes', dataType: 'TEXT' }), { name: 'Notes', type: 'text' });
    assert.deepEqual(describeField({ __typename: 'Something', name: 'X' }), { name: 'X', type: 'other' });
  });
});

describe('get_board_schema', () => {
  it('describes the fields of the requested board with the caller token', async () => {
    fieldsModule.listFields.mock.mockImplementation(async (boardId, token) => {
      assert.equal(boardId, ROADMAP_BOARD_ID);
      assert.equal(token, 'gho_user');
      return [{ __typename: 'ProjectV2SingleSelectField', name: 'Kind', options: [{ id: 'k', name: 'Epic 🎯' }] }];
    });

    const result = text(await handleGetBoardSchema({}, extra));

    assert.deepEqual(result, { board: 'roadmap', fields: [{ name: 'Kind', type: 'singleSelect', options: ['Epic 🎯'] }] });
  });

  it('rejects an unknown board', async () => {
    const result = await handleGetBoardSchema({ board: 'nope' }, extra);
    assert.match(result.error, /Unknown board/);
  });
});

describe('get_item_by_issue', () => {
  const ROADMAP_NAME = BOARDS.roadmap.name;
  const fieldValues = { nodes: [
    { name: 'In Progress ⛏️', field: { name: 'Status' } },
    { title: 'Q3 2026', field: { name: 'Quarter' } },
    { date: '2026-10-01', field: { name: 'Target Date' } },
    {}
  ] };
  const answer = ({ resource, items = [], pageInfo = { hasNextPage: false, endCursor: null } }) => ({
    resource,
    board: { items: { pageInfo, nodes: items } }
  });
  const orgIssue = {
    __typename: 'Issue',
    id: 'I_org',
    number: 37625,
    title: 'Agent workspaces',
    url: 'https://github.com/giantswarm/giantswarm/issues/37625',
    state: 'OPEN',
    repository: { nameWithOwner: 'giantswarm/giantswarm' }
  };
  const foreignIssue = {
    __typename: 'Issue',
    id: 'I_foreign',
    number: 7,
    title: 'Upstream fix',
    url: 'https://github.com/someone/tool/issues/7',
    state: 'OPEN',
    repository: { nameWithOwner: 'someone/tool' }
  };

  it('resolves a giantswarm issue to the board item with its field values', async () => {
    apiModule.graphQLWithAuth.mock.mockImplementation(async (query, variables, token) => {
      assert.deepEqual(variables, {
        url: 'https://github.com/giantswarm/giantswarm/issues/37625',
        boardId: ROADMAP_BOARD_ID,
        itemQuery: 'repo:giantswarm/giantswarm 37625',
        after: null
      });
      assert.equal(token, 'gho_user');
      return answer({ resource: orgIssue, items: [{ id: 'PVTI_1', content: { id: 'I_org' }, fieldValues }] });
    });

    const result = text(await handleGetItemByIssue({ issueUrl: 'giantswarm/giantswarm#37625' }, extra));

    assert.deepEqual(result, {
      item: {
        id: 'PVTI_1',
        title: 'Agent workspaces',
        number: 37625,
        url: 'https://github.com/giantswarm/giantswarm/issues/37625',
        repo: 'giantswarm/giantswarm',
        state: 'OPEN',
        fields: { Status: 'In Progress ⛏️', Quarter: 'Q3 2026', 'Target Date': '2026-10-01' }
      }
    });
  });

  it('resolves an issue of a repository outside the giantswarm org by its node id', async () => {
    apiModule.graphQLWithAuth.mock.mockImplementation(async (query, variables) => {
      assert.equal(variables.url, 'https://github.com/someone/tool/issues/7');
      assert.equal(variables.itemQuery, 'repo:someone/tool 7');
      return answer({
        resource: foreignIssue,
        items: [
          { id: 'PVTI_other', content: { id: 'I_seventy' }, fieldValues: { nodes: [] } },
          { id: 'PVTI_7', content: { id: 'I_foreign' }, fieldValues }
        ]
      });
    });

    const result = text(await handleGetItemByIssue({ owner: 'someone', repo: 'tool', issue_number: 7 }, extra));

    assert.equal(result.item.id, 'PVTI_7');
    assert.equal(result.item.repo, 'someone/tool');
  });

  it('accepts a pull request URL', async () => {
    apiModule.graphQLWithAuth.mock.mockImplementation(async (query, variables) => {
      assert.equal(variables.url, 'https://github.com/someone/tool/issues/8');
      return answer({
        resource: { ...foreignIssue, id: 'PR_8', number: 8, url: 'https://github.com/someone/tool/pull/8', state: 'MERGED' },
        items: [{ id: 'PVTI_8', content: { id: 'PR_8' }, fieldValues: { nodes: [] } }]
      });
    });

    const result = text(await handleGetItemByIssue({ issueUrl: 'https://github.com/someone/tool/pull/8' }, extra));

    assert.deepEqual(result.item, {
      id: 'PVTI_8', title: 'Upstream fix', number: 8, url: 'https://github.com/someone/tool/pull/8',
      repo: 'someone/tool', state: 'MERGED', fields: {}
    });
  });

  it('follows the narrowed board pages until the item matches', async () => {
    const calls = [];
    apiModule.graphQLWithAuth.mock.mockImplementation(async (query, variables) => {
      calls.push(variables.after);
      return variables.after
        ? answer({ resource: foreignIssue, items: [{ id: 'PVTI_7', content: { id: 'I_foreign' }, fieldValues }] })
        : answer({ resource: foreignIssue, items: [], pageInfo: { hasNextPage: true, endCursor: 'c1' } });
    });

    const result = text(await handleGetItemByIssue({ issueUrl: 'someone/tool#7' }, extra));

    assert.deepEqual(calls, [null, 'c1']);
    assert.equal(result.item.id, 'PVTI_7');
  });

  it('answers item: null with the reason when the issue is not on the board', async () => {
    apiModule.graphQLWithAuth.mock.mockImplementation(async () =>
      answer({ resource: foreignIssue, items: [{ id: 'PVTI_x', content: { id: 'I_seventy' }, fieldValues }] }));

    const result = text(await handleGetItemByIssue({ issueUrl: 'https://github.com/someone/tool/issues/7' }, extra));

    assert.deepEqual(result, { item: null, reason: `someone/tool#7 is not on the ${ROADMAP_NAME} (or its item is archived).` });
  });

  it('answers item: null with the reason when the issue does not resolve', async () => {
    apiModule.graphQLWithAuth.mock.mockImplementation(async () => answer({ resource: null }));
    const result = text(await handleGetItemByIssue({ owner: 'someone', repo: 'tool', issue_number: 999 }, extra));
    assert.deepEqual(result, { item: null, reason: 'someone/tool#999 does not exist or is not readable with this GitHub grant.' });
  });

  it('answers item: null with the reason when the URL is no issue', async () => {
    apiModule.graphQLWithAuth.mock.mockImplementation(async () => answer({ resource: { __typename: 'Discussion' } }));
    const result = text(await handleGetItemByIssue({ issueUrl: 'someone/tool#3' }, extra));
    assert.deepEqual(result, { item: null, reason: 'https://github.com/someone/tool/issues/3 is a Discussion, not an issue or pull request.' });
  });

  it('requires an issue reference', async () => {
    const result = await handleGetItemByIssue({}, extra);
    assert.match(result.error, /Provide either/);
  });

  it('is registered as a tool', () => {
    assert.deepEqual(boardTools.map(t => t.name), ['get_board_schema', 'get_item_by_issue']);
  });
});
