import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { LIST_ITEMS_QUERY, BOARDS, parseExtraBoards, resolveBoardOwner } from './project.js';

describe('LIST_ITEMS_QUERY', () => {
  it('requests state and timestamp fields on the issue content node', () => {
    assert.match(LIST_ITEMS_QUERY, /state/);
    assert.match(LIST_ITEMS_QUERY, /createdAt/);
    assert.match(LIST_ITEMS_QUERY, /updatedAt/);
    assert.match(LIST_ITEMS_QUERY, /closedAt/);
  });
});

describe('parseExtraBoards', () => {
  const board = { id: 'PVT_team', number: 7, owner: 'octo-org' };
  const json = boards => JSON.stringify(boards);

  it('adds no board without a value', () => {
    for (const value of [undefined, '', '  ']) {
      assert.deepEqual(parseExtraBoards(value), {});
    }
  });

  it('returns a registry entry per board, named after its key unless a name is given', () => {
    assert.deepEqual(
      parseExtraBoards(json({ team: board, 'side-project': { ...board, id: 'PVT_side', name: ' Side Project ' } })),
      {
        team: { id: 'PVT_team', number: 7, name: 'Team Board', owner: 'octo-org' },
        'side-project': { id: 'PVT_side', number: 7, name: 'Side Project', owner: 'octo-org' }
      }
    );
  });

  const refused = [
    ['a value that is no JSON', '{team', /PRO_EXTRA_BOARDS: not valid JSON/],
    ['a value that is no object', json([board]), /expected a JSON object of board key/],
    ['a key that is no resource URI scheme', json({ 'My Board': board }), /board key 'My Board' must be lowercase/],
    ['a built-in board', json({ roadmap: board }), /'roadmap' is a built-in board and cannot be redefined/],
    ['a board that is no object', json({ team: 'PVT_team' }), /board 'team' must be an object/],
    ['a misspelled property', json({ team: { ...board, defaultOwner: 'x' } }), /board 'team' has unknown properties: defaultOwner\. Accepted: id, number, owner, name/],
    ['a missing id', json({ team: { ...board, id: undefined } }), /board 'team' needs "id"/],
    ['an id that is no project node ID', json({ team: { ...board, id: '7' } }), /board 'team' needs "id"/],
    ['a missing number', json({ team: { ...board, number: undefined } }), /board 'team' needs "number"/],
    ['a number given as a string', json({ team: { ...board, number: '7' } }), /board 'team' needs "number"/],
    ['a missing owner', json({ team: { ...board, owner: undefined } }), /board 'team' needs "owner"/],
    ['an owner with a repository', json({ team: { ...board, owner: 'octo-org/repo' } }), /board 'team' needs "owner"/],
    ['an empty name', json({ team: { ...board, name: ' ' } }), /board 'team': "name" must be a non-empty string/]
  ];
  for (const [what, value, pattern] of refused) {
    it(`refuses ${what}`, () => {
      assert.throws(() => parseExtraBoards(value), pattern);
    });
  }
});

describe('resolveBoardOwner', () => {
  it('is giantswarm on the built-in boards and for a project outside the registry', () => {
    assert.equal(resolveBoardOwner(BOARDS.roadmap.id), 'giantswarm');
    assert.equal(resolveBoardOwner(BOARDS.customer.id), 'giantswarm');
    assert.equal(resolveBoardOwner('PVT_unknown'), 'giantswarm');
  });
});
