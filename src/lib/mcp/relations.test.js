import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const apiModule = {
  graphQLWithAuth: mock.fn(),
  // The real helper: it only interprets the error graphQLWithAuth throws.
  async withPartialData(request, tolerate) {
    try {
      return { data: await request, errors: [] };
    } catch (error) {
      if (!error.data || !error.errors?.length || !error.errors.every(tolerate)) throw error;
      return { data: error.data, errors: error.errors };
    }
  }
};
mock.module('../api.js', { namedExports: apiModule });
mock.module('../logger.js', { namedExports: { logger: { info() {}, warn() {}, error() {}, debug() {} } } });

const {
  handleListIssueRelations,
  handleAddIssueRelation,
  handleRemoveIssueRelation,
  relationTools
} = await import('./relations.js');
const { compactRelation } = await import('../relations.js');
const {
  RELATION_ISSUE_IDS_QUERY,
  ISSUE_RELATIONS_QUERY,
  ADD_BLOCKED_BY_MUTATION,
  REMOVE_BLOCKED_BY_MUTATION,
  ADD_RELATES_TO_MUTATION,
  REMOVE_RELATES_TO_MUTATION
} = await import('../project.js');

const extra = { authInfo: { token: 'gho_user' } };
const text = result => JSON.parse(result.content[0].text);

const NODE_IDS = {
  'giantswarm/roadmap#1': 'I_one',
  'giantswarm/giantswarm#2': 'I_two'
};

/** GitHub's answer to a query naming a missing issue: octokit throws, partial data attached. */
function notFoundError(data, path) {
  return Object.assign(new Error('Could not resolve to an Issue'), {
    errors: [{ type: 'NOT_FOUND', path, message: 'Could not resolve to an Issue' }],
    data
  });
}

/** Answer node-ID lookups from NODE_IDS (NOT_FOUND for others) and record every mutation. */
function answerNodeIds() {
  const mutations = [];
  apiModule.graphQLWithAuth.mock.mockImplementation(async (query, variables, token) => {
    assert.equal(token, 'gho_user');
    if (query === RELATION_ISSUE_IDS_QUERY) {
      const id = NODE_IDS[`${variables.owner}/${variables.repo}#${variables.number}`];
      const relatedId = NODE_IDS[`${variables.relatedOwner}/${variables.relatedRepo}#${variables.relatedNumber}`];
      const data = { issue: { issue: id ? { id } : null }, related: { issue: relatedId ? { id: relatedId } : null } };
      if (!id) throw notFoundError(data, ['issue', 'issue']);
      if (!relatedId) throw notFoundError(data, ['related', 'issue']);
      return data;
    }
    mutations.push({ query, variables });
    return { issue: { id: variables.issueId } };
  });
  return mutations;
}

const node = (repo, number, state = 'OPEN') => ({
  number,
  title: `Issue ${number}`,
  url: `https://github.com/${repo}/issues/${number}`,
  state,
  repository: { nameWithOwner: repo }
});

beforeEach(() => apiModule.graphQLWithAuth.mock.resetCalls());

describe('compactRelation', () => {
  it('compacts the issues and flags a list with a next page', () => {
    assert.deepEqual(compactRelation({ totalCount: 1, pageInfo: { hasNextPage: false }, nodes: [node('o/r', 1)] }), {
      issues: [{ number: 1, title: 'Issue 1', url: 'https://github.com/o/r/issues/1', state: 'open', repository: 'o/r' }]
    });
    assert.deepEqual(compactRelation({ totalCount: 3, pageInfo: { hasNextPage: true }, nodes: [node('o/r', 1)] }), {
      issues: [{ number: 1, title: 'Issue 1', url: 'https://github.com/o/r/issues/1', state: 'open', repository: 'o/r' }],
      truncated: true,
      totalCount: 3
    });
  });

  it('counts issues totalCount holds but a last page leaves out as hidden, not as truncated', () => {
    assert.deepEqual(compactRelation({ totalCount: 3, pageInfo: { hasNextPage: false }, nodes: [node('o/r', 1), null] }), {
      issues: [{ number: 1, title: 'Issue 1', url: 'https://github.com/o/r/issues/1', state: 'open', repository: 'o/r' }],
      hidden: 2
    });
  });

  it('counts unreadable issues as hidden, not as truncated', () => {
    assert.deepEqual(compactRelation({ totalCount: 2, nodes: [node('o/r', 1), null] }), {
      issues: [{ number: 1, title: 'Issue 1', url: 'https://github.com/o/r/issues/1', state: 'open', repository: 'o/r' }],
      hidden: 1
    });
    assert.deepEqual(compactRelation(undefined), { issues: [] });
  });
});

describe('list_issue_relations', () => {
  it('lists blockedBy, blocking and relatesTo of any issue', async () => {
    apiModule.graphQLWithAuth.mock.mockImplementation(async (query, variables) => {
      assert.equal(query, ISSUE_RELATIONS_QUERY);
      assert.deepEqual(variables, { owner: 'giantswarm', repo: 'roadmap', number: 1 });
      return {
        repository: {
          issue: {
            ...node('giantswarm/roadmap', 1),
            blockedBy: { totalCount: 1, nodes: [node('giantswarm/giantswarm', 2, 'CLOSED')] },
            blocking: { totalCount: 0, nodes: [] },
            relatesTo: { totalCount: 2, pageInfo: { hasNextPage: true }, nodes: [node('giantswarm/giantswarm', 3)] }
          }
        }
      };
    });

    const result = text(await handleListIssueRelations({ issueUrl: 'giantswarm/roadmap#1' }, extra));

    assert.equal(result.issue.number, 1);
    assert.deepEqual(result.blockedBy.issues.map(i => [i.repository, i.number, i.state]), [['giantswarm/giantswarm', 2, 'closed']]);
    assert.deepEqual(result.blocking, { issues: [] });
    assert.equal(result.relatesTo.truncated, true);
    assert.equal(result.relatesTo.totalCount, 2);
  });

  it('keeps the readable relations when a related issue cannot be read', async () => {
    apiModule.graphQLWithAuth.mock.mockImplementation(async () => {
      throw Object.assign(new Error('no access'), {
        errors: [{ type: 'FORBIDDEN', path: ['repository', 'issue', 'blockedBy', 'nodes', 1], message: 'no access' }],
        data: {
          repository: {
            issue: {
              ...node('giantswarm/roadmap', 1),
              blockedBy: { totalCount: 2, nodes: [node('giantswarm/giantswarm', 2), null] },
              blocking: { totalCount: 0, nodes: [] },
              relatesTo: { totalCount: 0, nodes: [] }
            }
          }
        }
      });
    });

    const result = text(await handleListIssueRelations({ issueUrl: 'giantswarm/roadmap#1' }, extra));

    assert.equal(result.blockedBy.issues.length, 1);
    assert.equal(result.blockedBy.hidden, 1);
    assert.ok(!result.blockedBy.truncated);
  });

  it('fails on an error outside the relation lists', async () => {
    apiModule.graphQLWithAuth.mock.mockImplementation(async () => {
      throw Object.assign(new Error('no access'), { errors: [{ type: 'FORBIDDEN', path: ['repository'] }], data: { repository: null } });
    });
    const result = await handleListIssueRelations({ issueUrl: 'giantswarm/roadmap#1' }, extra);
    assert.match(result.error, /no access/);
  });

  it('passes on the error of a whole relation list instead of calling the issue missing', async () => {
    apiModule.graphQLWithAuth.mock.mockImplementation(async () => {
      throw Object.assign(new Error('x'), {
        errors: [{ type: 'FORBIDDEN', path: ['repository', 'issue', 'blocking'], message: 'timeout' }],
        data: { repository: { issue: null } }
      });
    });
    const result = await handleListIssueRelations({ issueUrl: 'giantswarm/roadmap#1' }, extra);
    assert.equal(result.error, 'timeout');
  });

  it('passes on the error of the whole relation list, not one on an issue inside another list', async () => {
    apiModule.graphQLWithAuth.mock.mockImplementation(async () => {
      throw Object.assign(new Error('x'), {
        errors: [
          { type: 'FORBIDDEN', path: ['repository', 'issue', 'blockedBy', 'nodes', 0], message: 'no access' },
          { type: 'FORBIDDEN', path: ['repository', 'issue', 'blocking'], message: 'timeout' }
        ],
        data: { repository: { issue: null } }
      });
    });
    const result = await handleListIssueRelations({ issueUrl: 'giantswarm/roadmap#1' }, extra);
    assert.equal(result.error, 'timeout');
  });

  it('names an issue that does not resolve', async () => {
    apiModule.graphQLWithAuth.mock.mockImplementation(async () => {
      throw notFoundError({ repository: { issue: null } }, ['repository', 'issue']);
    });
    const result = await handleListIssueRelations({ issueUrl: 'giantswarm/roadmap#9' }, extra);
    assert.match(result.error, /giantswarm\/roadmap#9 not found/);
  });
});

describe('add_issue_relation', () => {
  const args = relation => ({
    issueUrl: 'https://github.com/giantswarm/roadmap/issues/1',
    relation,
    relatedIssueUrl: 'giantswarm/giantswarm#2'
  });

  it('blocked_by: the related issue blocks the issue', async () => {
    const mutations = answerNodeIds();
    const result = text(await handleAddIssueRelation(args('blocked_by'), extra));
    assert.equal(result.success, true);
    assert.deepEqual(mutations, [{ query: ADD_BLOCKED_BY_MUTATION, variables: { issueId: 'I_one', blockingIssueId: 'I_two' } }]);
  });

  it('blocking: the issue blocks the related issue', async () => {
    const mutations = answerNodeIds();
    await handleAddIssueRelation(args('blocking'), extra);
    assert.deepEqual(mutations, [{ query: ADD_BLOCKED_BY_MUTATION, variables: { issueId: 'I_two', blockingIssueId: 'I_one' } }]);
  });

  it('relates_to links the two issues', async () => {
    const mutations = answerNodeIds();
    await handleAddIssueRelation(args('relates_to'), extra);
    assert.deepEqual(mutations, [{ query: ADD_RELATES_TO_MUTATION, variables: { issueId: 'I_one', relatedIssueId: 'I_two' } }]);
  });

  it('refuses an issue related to itself without calling GitHub', async () => {
    const result = await handleAddIssueRelation({ ...args('blocked_by'), relatedIssueUrl: 'GiantSwarm/Roadmap#1' }, extra);
    assert.match(result.error, /cannot be related to itself/);
    assert.equal(apiModule.graphQLWithAuth.mock.callCount(), 0);
  });

  it('refuses two refs to the same issue (a renamed repository) once GitHub resolves them', async () => {
    NODE_IDS['giantswarm/old-roadmap#1'] = 'I_one';
    const mutations = answerNodeIds();
    const result = await handleAddIssueRelation({ ...args('blocked_by'), relatedIssueUrl: 'giantswarm/old-roadmap#1' }, extra);
    delete NODE_IDS['giantswarm/old-roadmap#1'];
    assert.match(result.error, /cannot be related to itself/);
    assert.deepEqual(mutations, []);
  });

  it('passes on an error that is not NOT_FOUND', async () => {
    apiModule.graphQLWithAuth.mock.mockImplementation(async () => {
      throw Object.assign(new Error('Resource not accessible'), { errors: [{ type: 'FORBIDDEN' }], data: {} });
    });
    const result = await handleAddIssueRelation(args('blocked_by'), extra);
    assert.match(result.error, /Resource not accessible/);
  });

  it('refuses an unknown relation', async () => {
    const result = await handleAddIssueRelation(args('parent_of'), extra);
    assert.match(result.error, /Unknown relation 'parent_of'/);
  });

  it('names a related issue that does not resolve and sets nothing', async () => {
    const mutations = answerNodeIds();
    const result = await handleAddIssueRelation({ ...args('blocked_by'), relatedIssueUrl: 'giantswarm/giantswarm#404' }, extra);
    assert.match(result.error, /giantswarm\/giantswarm#404 not found/);
    assert.deepEqual(mutations, []);
  });
});

describe('remove_issue_relation', () => {
  it('removes blocked_by, blocking and relates_to with the matching mutation', async () => {
    const cases = [
      ['blocked_by', REMOVE_BLOCKED_BY_MUTATION, { issueId: 'I_one', blockingIssueId: 'I_two' }],
      ['blocking', REMOVE_BLOCKED_BY_MUTATION, { issueId: 'I_two', blockingIssueId: 'I_one' }],
      ['relates_to', REMOVE_RELATES_TO_MUTATION, { issueId: 'I_one', relatedIssueId: 'I_two' }]
    ];
    for (const [relation, query, variables] of cases) {
      const mutations = answerNodeIds();
      const result = text(await handleRemoveIssueRelation({ issueUrl: 'giantswarm/roadmap#1', relation, relatedIssueUrl: 'giantswarm/giantswarm#2' }, extra));
      assert.equal(result.relation, relation);
      assert.equal(result.removed, true);
      assert.deepEqual(mutations, [{ query, variables }], relation);
    }
  });
});

describe('relation tool schemas', () => {
  it('the write tools require issueUrl, relation and relatedIssueUrl and list the relations', () => {
    for (const tool of relationTools.filter(t => t.name !== 'list_issue_relations')) {
      assert.deepEqual(tool.inputSchema.required, ['issueUrl', 'relation', 'relatedIssueUrl']);
      assert.deepEqual(tool.inputSchema.properties.relation.enum, ['blocked_by', 'blocking', 'relates_to']);
    }
  });
});
