import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';

// ---------------------------------------------------------------------------
// End-to-end OAuth flow over HTTP with a URL client_id (SEP-991 / CIMD).
//
// Starts the real Express app on an ephemeral port with OAuth enabled and
// walks the exact path muster takes: read the AS metadata, hit /authorize with
// the CIMD URL as client_id, complete the GitHub callback, exchange the local
// code at /token. Only the outbound fetches (CIMD document, GitHub token
// exchange) are mocked.
// ---------------------------------------------------------------------------

const CIMD_URL = 'https://muster.example.com/.well-known/oauth-client.json';
const REDIRECT_URI = 'https://muster.example.com/oauth/proxy/callback';
const CIMD_DOC = {
  client_id: CIMD_URL,
  client_name: 'Muster MCP Aggregator',
  redirect_uris: [REDIRECT_URI],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none'
};

let httpServer;
let baseUrl;

before(async () => {
  process.env.GITHUB_OAUTH_CLIENT_ID = 'gh-client-id';
  process.env.GITHUB_OAUTH_CLIENT_SECRET = 'gh-client-secret';
  process.env.OAUTH_ISSUER_URL = 'http://localhost';
  delete process.env.OAUTH_TRUSTED_CLIENT_IDS;
  const { startHTTPServer } = await import('./http.js');
  httpServer = await startHTTPServer({ port: 0 });
  baseUrl = `http://localhost:${httpServer.address().port}`;
});

after(() => {
  httpServer?.close();
  delete process.env.GITHUB_OAUTH_CLIENT_ID;
  delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
  delete process.env.OAUTH_ISSUER_URL;
});

/** Minimal HTTP client that does not follow redirects (unlike fetch, which we mock). */
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

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Mock fetch for the CIMD document and GitHub's token endpoint; count calls per URL. */
function mockOutboundFetch(t, { cimdDoc = CIMD_DOC } = {}) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(String(url));
    if (url === CIMD_URL) {
      const text = JSON.stringify(cimdDoc);
      return { ok: true, status: 200, headers: new Headers(), text: async () => text };
    }
    if (url === 'https://github.com/login/oauth/access_token') {
      return { ok: true, status: 200, json: async () => ({ access_token: 'gho_test_token', scope: 'repo,project,read:org' }) };
    }
    return { ok: false, status: 404, headers: new Headers(), text: async () => '' };
  });
  return calls;
}

describe('GET /.well-known/oauth-authorization-server', () => {
  it('advertises CIMD support alongside the SDK metadata', async () => {
    const res = await request('GET', '/.well-known/oauth-authorization-server');
    assert.strictEqual(res.status, 200);
    const metadata = JSON.parse(res.body);
    assert.strictEqual(metadata.client_id_metadata_document_supported, true);
    // The rest of the document is still the SDK's
    assert.strictEqual(metadata.issuer, 'http://localhost/');
    assert.ok(metadata.registration_endpoint, 'dynamic registration stays available');
    assert.deepStrictEqual(metadata.code_challenge_methods_supported, ['S256']);
    assert.ok(metadata.token_endpoint_auth_methods_supported.includes('none'));
  });
});

describe('OAuth flow with a CIMD URL as client_id', () => {
  it('accepts the URL on /authorize and /token and issues the GitHub token', async (t) => {
    const calls = mockOutboundFetch(t);
    const codeVerifier = base64url(randomBytes(32));
    const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());

    // /authorize with client_id = CIMD URL → redirect to GitHub
    const authorizeQuery = new URLSearchParams({
      client_id: CIMD_URL,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: 'client-state'
    });
    const authorize = await request('GET', `/authorize?${authorizeQuery}`);
    assert.strictEqual(authorize.status, 302, authorize.body);
    const githubUrl = new URL(authorize.headers.location);
    assert.strictEqual(githubUrl.origin + githubUrl.pathname, 'https://github.com/login/oauth/authorize');
    assert.strictEqual(githubUrl.searchParams.get('client_id'), 'gh-client-id');
    const githubState = githubUrl.searchParams.get('state');
    assert.ok(githubState);
    assert.strictEqual(calls.filter(u => u === CIMD_URL).length, 1, 'CIMD fetched once');

    // GitHub calls back → redirect to the client's redirect_uri with a local code
    const callback = await request('GET', `/github/callback?code=github-code&state=${githubState}`);
    assert.strictEqual(callback.status, 302, callback.body);
    const clientRedirect = new URL(callback.headers.location);
    assert.strictEqual(clientRedirect.origin + clientRedirect.pathname, REDIRECT_URI);
    assert.strictEqual(clientRedirect.searchParams.get('state'), 'client-state');
    const localCode = clientRedirect.searchParams.get('code');
    assert.ok(localCode);

    // /token with client_id = CIMD URL (public client, no secret) → GitHub token
    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code: localCode,
      code_verifier: codeVerifier,
      redirect_uri: REDIRECT_URI,
      client_id: CIMD_URL
    }).toString();
    const token = await request('POST', '/token', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody
    });
    assert.strictEqual(token.status, 200, token.body);
    const tokens = JSON.parse(token.body);
    assert.strictEqual(tokens.access_token, 'gho_test_token');
    assert.strictEqual(tokens.token_type, 'Bearer');
    assert.strictEqual(calls.filter(u => u === CIMD_URL).length, 1, 'CIMD served from cache on /token');
  });

  it('rejects an unsafe URL client_id without fetching it', async (t) => {
    const calls = mockOutboundFetch(t);
    const query = new URLSearchParams({
      client_id: 'https://10.0.0.1/.well-known/oauth-client.json',
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      code_challenge: 'x',
      code_challenge_method: 'S256'
    });
    const res = await request('GET', `/authorize?${query}`);
    assert.strictEqual(res.status, 400);
    assert.strictEqual(JSON.parse(res.body).error, 'invalid_client');
    assert.deepStrictEqual(calls, [], 'no outbound request for an IP-literal client_id');
  });

  it('rejects an unknown opaque client_id', async () => {
    const query = new URLSearchParams({
      client_id: 'not-registered',
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      code_challenge: 'x',
      code_challenge_method: 'S256'
    });
    const res = await request('GET', `/authorize?${query}`);
    assert.strictEqual(res.status, 400);
    assert.strictEqual(JSON.parse(res.body).error, 'invalid_client');
  });
});
