import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// ---------------------------------------------------------------------------
// Bearer-only mode (OAUTH_BEARER_ONLY=true): the server is a resource server
// for GitHub tokens obtained elsewhere. No authorization server of its own,
// RFC 9728 metadata pointing at GitHub, every /mcp request verified via the
// GitHub API (mocked here).
// ---------------------------------------------------------------------------

let httpServer;
let baseUrl;

before(async () => {
  delete process.env.GITHUB_OAUTH_CLIENT_ID;
  delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
  process.env.OAUTH_BEARER_ONLY = 'true';
  process.env.OAUTH_ISSUER_URL = 'http://pro.example';
  const { startHTTPServer } = await import('./http.js');
  httpServer = await startHTTPServer({ port: 0 });
  baseUrl = `http://localhost:${httpServer.address().port}`;
});

after(() => {
  httpServer?.close();
  delete process.env.OAUTH_BEARER_ONLY;
  delete process.env.OAUTH_ISSUER_URL;
});

function request(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(path, baseUrl), { method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } }
});

function mockGitHubUser(t, { scopes } = {}) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: String(url), auth: init?.headers?.Authorization });
    if (String(url) === 'https://api.github.com/user') {
      const headers = new Headers();
      if (scopes !== undefined) headers.set('x-oauth-scopes', scopes);
      return { ok: true, status: 200, headers, json: async () => ({ login: 'alice' }) };
    }
    return { ok: false, status: 404, headers: new Headers(), text: async () => '' };
  });
  return calls;
}

describe('bearer-only mode', () => {
  it('serves RFC 9728 protected resource metadata naming GitHub as the authorization server', async () => {
    for (const path of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
      const res = await request('GET', path);
      assert.strictEqual(res.status, 200, path);
      const metadata = JSON.parse(res.body);
      assert.strictEqual(metadata.resource, 'http://pro.example/mcp');
      assert.deepStrictEqual(metadata.authorization_servers, ['https://github.com/login/oauth']);
      assert.deepStrictEqual(metadata.bearer_methods_supported, ['header']);
    }
  });

  it('runs no authorization server of its own', async () => {
    assert.strictEqual((await request('GET', '/.well-known/oauth-authorization-server')).status, 404);
    assert.strictEqual((await request('GET', '/authorize?client_id=x')).status, 404);
    assert.strictEqual((await request('POST', '/token')).status, 404);
  });

  it('challenges a request without a bearer and points at the resource metadata', async () => {
    const res = await request('POST', '/mcp', {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: INITIALIZE
    });
    assert.strictEqual(res.status, 401);
    const challenge = res.headers['www-authenticate'];
    assert.match(challenge, /^Bearer /);
    assert.match(challenge, /resource_metadata="http:\/\/pro\.example\/\.well-known\/oauth-protected-resource\/mcp"/);
  });

  it('rejects a token GitHub does not accept with 401 invalid_token', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 401, headers: new Headers() }));
    const res = await request('POST', '/mcp', {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer gho_bad' },
      body: INITIALIZE
    });
    assert.strictEqual(res.status, 401);
    assert.match(res.headers['www-authenticate'], /invalid_token/);
  });

  it('accepts a GitHub App user token (no scopes header) and serves the MCP initialize', async (t) => {
    const calls = mockGitHubUser(t);
    const res = await request('POST', '/mcp', {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer ghu_apptoken' },
      body: INITIALIZE
    });
    assert.strictEqual(res.status, 200, res.body);
    assert.match(res.body, /"protocolVersion"/);
    assert.deepStrictEqual(calls.map(c => c.url), ['https://api.github.com/user']);
    assert.strictEqual(calls[0].auth, 'Bearer ghu_apptoken', 'the caller\'s own token is what GitHub sees');
  });

  it('accepts a GitHub App user token whose scopes header is present but empty', async (t) => {
    // What api.github.com actually sends for a ghu_ token: the header exists
    // with no value. Must not be read as "announces zero scopes" (403).
    const calls = mockGitHubUser(t, { scopes: '' });
    // A token the verifier has not cached from the previous test.
    const res = await request('POST', '/mcp', {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer ghu_apptoken_empty_scopes' },
      body: INITIALIZE
    });
    assert.strictEqual(res.status, 200, res.body);
    assert.match(res.body, /"protocolVersion"/);
    assert.deepStrictEqual(calls.map(c => c.url), ['https://api.github.com/user']);
  });

  it('still refuses a scoped token that lacks the board scopes (403 insufficient_scope)', async (t) => {
    mockGitHubUser(t, { scopes: 'read:user' });
    const res = await request('POST', '/mcp', {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer gho_readonly' },
      body: INITIALIZE
    });
    assert.strictEqual(res.status, 403);
    assert.match(res.headers['www-authenticate'], /insufficient_scope/);
  });
});
