/**
 * Guard over every GraphQL call pro makes: no variable may use a name
 * @octokit/graphql reserves for its own request options. The real client
 * rejects such a call at runtime, but the unit tests mock the client, so this
 * test reads the sources instead: every operation's declared `$variables` and
 * every variable object passed to graphQLWithAuth, fetchBounded or
 * fetchPaginated.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

// @octokit/graphql's NON_VARIABLE_OPTIONS: keys it takes as request options.
const RESERVED = ['method', 'baseUrl', 'url', 'headers', 'request', 'query', 'mediaType', 'operationName'];

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CALLERS = ['graphQLWithAuth', 'fetchBounded', 'fetchPaginated'];
// api.js defines the callers and forwards its callers' variables.
const FORWARDER = 'src/lib/api.js';

const lineOf = (source, index) => source.slice(0, index).split('\n').length;

/** Every `$variable` an operation (query, mutation, subscription) declares. */
function declaredVariables(source) {
  const found = [];
  for (const op of source.matchAll(/\b(?:query|mutation|subscription)\b\s*\w*\s*\(([^)]*)\)\s*\{/g)) {
    for (const v of op[1].matchAll(/\$([A-Za-z_]\w*)\s*:/g)) {
      found.push({ name: v[1], line: lineOf(source, op.index) });
    }
  }
  return found;
}

/** Index just past the bracket, string or template that starts at `start`. */
function skip(source, start) {
  const open = source[start];
  if (open === '\'' || open === '"' || open === '`') {
    let i = start + 1;
    while (i < source.length && source[i] !== open) i += source[i] === '\\' ? 2 : 1;
    return i + 1;
  }
  const close = { '(': ')', '[': ']', '{': '}' }[open];
  let i = start + 1;
  while (i < source.length && source[i] !== close) {
    i = '([{\'"`'.includes(source[i]) ? skip(source, i) : i + 1;
  }
  return i + 1;
}

/** The top-level keys of the object literal whose `{` is at `start`. */
function objectKeys(source, start) {
  const end = skip(source, start) - 1;
  const keys = [];
  let i = start + 1;
  let expectKey = true;
  while (i < end) {
    const c = source[i];
    if (expectKey && /[\w$'"]/.test(c)) {
      const key = source.slice(i).match(/^(?:'([^']*)'|"([^"]*)"|([A-Za-z_$][\w$]*))/);
      if (key) keys.push(key[1] ?? key[2] ?? key[3]);
      expectKey = false;
      i += key ? key[0].length : 1;
    } else if (c === ',') {
      expectKey = true;
      i++;
    } else if ('([{\'"`'.includes(c)) {
      i = skip(source, i);
    } else {
      if (c === '.') expectKey = false;
      i++;
    }
  }
  return keys;
}

/**
 * The variables of every call to graphQLWithAuth, fetchBounded or
 * fetchPaginated: the keys of its second argument, which must be an object
 * literal so they can be read (`unreadable` otherwise).
 */
function passedVariables(source) {
  const calls = [];
  for (const call of source.matchAll(new RegExp(`\\b(${CALLERS.join('|')})\\s*\\(`, 'g'))) {
    const line = lineOf(source, call.index);
    let i = call.index + call[0].length;
    while (i < source.length && source[i] !== ',' && source[i] !== ')') {
      i = '([{\'"`'.includes(source[i]) ? skip(source, i) : i + 1;
    }
    if (source[i] === ')') {
      calls.push({ caller: call[1], line, unreadable: true });
      continue;
    }
    const arg = source.slice(i + 1).match(/^\s*/)[0].length + i + 1;
    calls.push(source[arg] === '{'
      ? { caller: call[1], line, keys: objectKeys(source, arg) }
      : { caller: call[1], line, unreadable: true });
  }
  return calls;
}

function sourceFiles() {
  return ['src', 'bin']
    .flatMap(dir => readdirSync(join(ROOT, dir), { recursive: true }).map(file => join(dir, file)))
    .filter(file => file.endsWith('.js') && !file.endsWith('.test.js'))
    .map(file => ({ file: relative(ROOT, join(ROOT, file)), source: readFileSync(join(ROOT, file), 'utf8') }));
}

describe('the guard itself', () => {
  it('catches url declared as an operation variable', () => {
    const source = 'const Q = `\n  query IssueBoardItem($url: URI!, $boardId: ID!) {\n    resource(url: $url) { id }\n  }\n`;';
    assert.deepEqual(declaredVariables(source).filter(v => RESERVED.includes(v.name)), [{ name: 'url', line: 2 }]);
  });

  it('catches url passed as a variable, shorthand or keyed', () => {
    for (const vars of ['{ url, boardId }', '{ boardId, url: ref.url }', "{ 'url': x }"]) {
      const source = `async function f() {\n  return graphQLWithAuth(QUERY, ${vars}, token);\n}`;
      const [call] = passedVariables(source);
      assert.deepEqual(call.keys.filter(key => RESERVED.includes(key)), ['url'], vars);
    }
  });

  it('reads only the top-level keys, not values or nested objects', () => {
    const source = 'fetchBounded(Q, { resourceUrl: url, nested: { url: 1 }, q: `${a}, url: b`, f: g(url, 2) }, page, token);';
    assert.deepEqual(passedVariables(source)[0].keys, ['resourceUrl', 'nested', 'q', 'f']);
  });

  it('reports a call whose variables are no object literal as unreadable', () => {
    assert.equal(passedVariables('graphQLWithAuth(QUERY, vars, token)')[0].unreadable, true);
  });
});

describe('every GraphQL call pro makes', () => {
  const files = sourceFiles();

  it('declares no variable @octokit/graphql reserves', () => {
    const declared = files.flatMap(({ file, source }) => declaredVariables(source).map(v => ({ ...v, file })));
    assert.ok(declared.length > 0, 'no GraphQL operation found in the sources');
    assert.deepEqual(declared.filter(v => RESERVED.includes(v.name)).map(v => `${v.file}:${v.line} $${v.name}`), []);
  });

  it('passes no variable @octokit/graphql reserves, each as a readable object literal', () => {
    const calls = files
      .filter(({ file }) => file !== FORWARDER)
      .flatMap(({ file, source }) => passedVariables(source).map(call => ({ ...call, file })));
    assert.ok(calls.length > 0, 'no GraphQL call found in the sources');
    assert.deepEqual(calls.filter(c => c.unreadable).map(c => `${c.file}:${c.line} ${c.caller}`), [],
      'pass GraphQL variables as an object literal so this guard can read them');
    assert.deepEqual(calls.flatMap(c => (c.keys ?? []).filter(key => RESERVED.includes(key)).map(key => `${c.file}:${c.line} ${key}`)), []);
  });
});
