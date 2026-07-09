import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { LIST_ITEMS_QUERY } from './project.js';

describe('LIST_ITEMS_QUERY', () => {
  it('requests state and timestamp fields on the issue content node', () => {
    assert.match(LIST_ITEMS_QUERY, /state/);
    assert.match(LIST_ITEMS_QUERY, /createdAt/);
    assert.match(LIST_ITEMS_QUERY, /updatedAt/);
    assert.match(LIST_ITEMS_QUERY, /closedAt/);
  });
});
