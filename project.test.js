const {
  LIST_PROJECTS_REPO_QUERY,
  LIST_PROJECTS_ORG_QUERY,
  REPO_ID_QUERY,
  CREATE_PROJECT_MUTATION,
  DELETE_PROJECT_MUTATION,
  UPDATE_PROJECT_MUTATION,
  LIST_ITEMS_QUERY,
  LIST_FIELDS_QUERY,
  SHOW_FIELD_QUERY
} = require('./project');

describe('project.js queries and mutations', () => {
  test('LIST_PROJECTS_REPO_QUERY is defined and contains repository keyword', () => {
    expect(typeof LIST_PROJECTS_REPO_QUERY).toBe('string');
    expect(LIST_PROJECTS_REPO_QUERY).toMatch(/repository\(/);
  });

  test('LIST_PROJECTS_ORG_QUERY is defined and contains organization keyword', () => {
    expect(typeof LIST_PROJECTS_ORG_QUERY).toBe('string');
    expect(LIST_PROJECTS_ORG_QUERY).toMatch(/organization\(/);
  });

  test('REPO_ID_QUERY is defined and contains repository keyword', () => {
    expect(typeof REPO_ID_QUERY).toBe('string');
    expect(REPO_ID_QUERY).toMatch(/repository\(/);
  });

  test('CREATE_PROJECT_MUTATION is defined and contains createProjectV2', () => {
    expect(typeof CREATE_PROJECT_MUTATION).toBe('string');
    expect(CREATE_PROJECT_MUTATION).toMatch(/createProjectV2/);
  });

  test('DELETE_PROJECT_MUTATION is defined and contains deleteProjectV2', () => {
    expect(typeof DELETE_PROJECT_MUTATION).toBe('string');
    expect(DELETE_PROJECT_MUTATION).toMatch(/deleteProjectV2/);
  });

  test('UPDATE_PROJECT_MUTATION is defined and contains updateProjectV2', () => {
    expect(typeof UPDATE_PROJECT_MUTATION).toBe('string');
    expect(UPDATE_PROJECT_MUTATION).toMatch(/updateProjectV2/);
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
