const {
  REPO_ID_QUERY,
  LIST_ITEMS_QUERY,
  LIST_FIELDS_QUERY,
  SHOW_FIELD_QUERY
} = require('./project');

describe('project.js queries and mutations', () => {
  test('REPO_ID_QUERY is defined and contains repository keyword', () => {
    expect(typeof REPO_ID_QUERY).toBe('string');
    expect(REPO_ID_QUERY).toMatch(/repository\(/);
  });

  test('LIST_ITEMS_QUERY is defined and contains node(id:', () => {
    expect(typeof LIST_ITEMS_QUERY).toBe('string');
    expect(LIST_ITEMS_QUERY).toMatch(/node\(id:/);
  });

  test('LIST_FIELDS_QUERY is defined and contains fields(', () => {
    expect(typeof LIST_FIELDS_QUERY).toBe('string');
    expect(LIST_FIELDS_QUERY).toMatch(/fields\(first:/);
  });

  test('SHOW_FIELD_QUERY equals LIST_FIELDS_QUERY', () => {
    expect(SHOW_FIELD_QUERY).toBe(LIST_FIELDS_QUERY);
  });
});
