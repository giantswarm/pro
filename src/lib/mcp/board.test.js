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
  const issueNode = (projectId) => ({
    repository: {
      issue: {
        title: 'Agent workspaces',
        url: 'https://github.com/giantswarm/giantswarm/issues/37625',
        state: 'OPEN',
        projectItems: {
          nodes: [{
            id: 'PVTI_1',
            project: { id: projectId },
            fieldValues: { nodes: [
              { name: 'In Progress ⛏️', field: { name: 'Status' } },
              { title: 'Q3 2026', field: { name: 'Quarter' } },
              { date: '2026-10-01', field: { name: 'Target Date' } },
              {}
            ] }
          }]
        }
      }
    }
  });

  it('resolves a short ref to the board item with its field values', async () => {
    apiModule.graphQLWithAuth.mock.mockImplementation(async (query, variables, token) => {
      assert.deepEqual(variables, { owner: 'giantswarm', repo: 'giantswarm', number: 37625 });
      assert.equal(token, 'gho_user');
      return issueNode(ROADMAP_BOARD_ID);
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

  it('answers item: null when the issue is on another board only', async () => {
    apiModule.graphQLWithAuth.mock.mockImplementation(async () => issueNode('PVT_other'));
    const result = text(await handleGetItemByIssue({ owner: 'giantswarm', repo: 'giantswarm', issue_number: 1 }, extra));
    assert.deepEqual(result, { item: null });
  });

  it('requires an issue reference', async () => {
    const result = await handleGetItemByIssue({}, extra);
    assert.match(result.error, /Provide either/);
  });

  it('is registered as a tool', () => {
    assert.deepEqual(boardTools.map(t => t.name), ['get_board_schema', 'get_item_by_issue']);
  });
});
