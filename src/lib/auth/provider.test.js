import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubOAuthProvider, isCimdUrl } from './provider.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_CONFIG = { clientId: 'gh-client-id', clientSecret: 'gh-client-secret' };

/** Build a minimal mock Express response object. */
function makeMockRes() {
  return {
    redirectedTo: null,
    statusCode: null,
    jsonBody: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.jsonBody = body; return this; },
    redirect(url) { this.redirectedTo = url; }
  };
}

/**
 * Run `authorize` and return an object with the registered client, the mock
 * response (which holds the GitHub redirect URL), and the GitHub-side state
 * parameter extracted from that URL.
 */
async function runAuthorize(provider, { codeChallenge = 'test-challenge', clientState = 'cs' } = {}) {
  const client = provider.clientsStore.registerClient({
    client_name: 'test-client',
    redirect_uris: ['https://example.com/callback']
  });
  const authRes = makeMockRes();
  await provider.authorize(client, {
    redirectUri: 'https://example.com/callback',
    codeChallenge,
    state: clientState
  }, authRes);
  const state = new URL(authRes.redirectedTo).searchParams.get('state');
  return { client, authRes, state };
}

/**
 * Run the full flow up to and including the GitHub callback (with mocked
 * fetch) and return the local authorization code.
 */
async function runCallbackFlow(provider, handleGitHubCallback, t, {
  codeChallenge = 'test-challenge',
  githubToken = 'ghtoken123',
  githubScope
} = {}) {
  const { client, state } = await runAuthorize(provider, { codeChallenge });

  const ghResponse = { access_token: githubToken };
  if (githubScope !== undefined) ghResponse.scope = githubScope;

  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    status: 200,
    json: async () => ghResponse
  }));

  const callbackRes = makeMockRes();
  await handleGitHubCallback({ query: { code: 'github-code', state } }, callbackRes);

  const localCode = new URL(callbackRes.redirectedTo).searchParams.get('code');
  return { client, localCode, callbackRes };
}

// ---------------------------------------------------------------------------
// clientsStore
// ---------------------------------------------------------------------------

describe('clientsStore.registerClient', () => {
  it('returns client metadata with generated client_id and issued_at', () => {
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    const info = provider.clientsStore.registerClient({
      client_name: 'my-client',
      redirect_uris: ['https://example.com/callback']
    });
    assert.ok(info.client_id, 'should have client_id');
    assert.ok(typeof info.client_id_issued_at === 'number', 'should have numeric issued_at');
    assert.strictEqual(info.client_name, 'my-client');
  });

  it('getClient returns the registered client', async () => {
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    const info = provider.clientsStore.registerClient({ client_name: 'c' });
    assert.deepStrictEqual(await provider.clientsStore.getClient(info.client_id), info);
  });

  it('getClient returns undefined for an unknown client_id', async () => {
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    assert.strictEqual(await provider.clientsStore.getClient('nonexistent'), undefined);
  });

  it('evicts the oldest client when the store is full (MAX_CLIENTS = 1000)', async () => {
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    // Register first client (will be evicted)
    const first = provider.clientsStore.registerClient({ client_name: 'first' });
    // Fill to MAX_CLIENTS
    for (let i = 1; i < 1000; i++) {
      provider.clientsStore.registerClient({ client_name: `c${i}` });
    }
    // One more registration should evict the oldest (first)
    const overflow = provider.clientsStore.registerClient({ client_name: 'overflow' });
    assert.strictEqual(await provider.clientsStore.getClient(first.client_id), undefined, 'first client should be evicted');
    assert.ok(await provider.clientsStore.getClient(overflow.client_id), 'overflow client should be present');
  });
});

// ---------------------------------------------------------------------------
// URL client_ids (Client ID Metadata Documents, SEP-991)
// ---------------------------------------------------------------------------

const CIMD_URL = 'https://muster.example.com/.well-known/oauth-client.json';
const CIMD_DOC = {
  client_id: CIMD_URL,
  client_name: 'Muster',
  redirect_uris: ['https://muster.example.com/oauth/callback'],
  grant_types: ['authorization_code'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none'
};

/**
 * Mock fetch to serve `doc` (or fail with `status`) for every URL and count
 * the calls. `doc` may be a function returning the document per call.
 */
function mockCimdFetch(t, { doc = CIMD_DOC, status = 200, headers = {} } = {}) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(String(url));
    const body = typeof doc === 'function' ? doc() : doc;
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(headers),
      text: async () => text
    };
  });
  return calls;
}

describe('clientsStore.getClient with a CIMD URL', () => {
  it('resolves any HTTPS CIMD URL by fetching and validating the document', async (t) => {
    delete process.env.OAUTH_TRUSTED_CLIENT_IDS;
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    const calls = mockCimdFetch(t);

    const client = await provider.clientsStore.getClient(CIMD_URL);
    assert.ok(client, 'CIMD client should resolve without an allowlist entry');
    assert.strictEqual(client.client_id, CIMD_URL);
    assert.strictEqual(client.client_name, 'Muster');
    assert.deepStrictEqual(client.redirect_uris, ['https://muster.example.com/oauth/callback']);
    assert.strictEqual(client.token_endpoint_auth_method, 'none');
    assert.strictEqual(client.client_secret, undefined, 'CIMD clients are public clients');
    assert.deepStrictEqual(calls, [CIMD_URL]);

    // Second call is served from cache
    const cached = await provider.clientsStore.getClient(CIMD_URL);
    assert.strictEqual(cached, client);
    assert.strictEqual(calls.length, 1, 'document fetched once');
  });

  it('sends a bounded, redirect-free request for the document', async (t) => {
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    let init;
    t.mock.method(globalThis, 'fetch', async (_url, opts) => {
      init = opts;
      return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(CIMD_DOC) };
    });
    await provider.clientsStore.getClient(CIMD_URL);
    assert.strictEqual(init.redirect, 'manual');
    assert.ok(init.signal instanceof AbortSignal, 'request carries a timeout signal');
    assert.strictEqual(init.headers.Accept, 'application/json');
  });

  it('still resolves trusted CIMD URLs from OAUTH_TRUSTED_CLIENT_IDS', async (t) => {
    process.env.OAUTH_TRUSTED_CLIENT_IDS = CIMD_URL;
    try {
      const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
      mockCimdFetch(t);
      const client = await provider.clientsStore.getClient(CIMD_URL);
      assert.strictEqual(client?.client_id, CIMD_URL);
    } finally {
      delete process.env.OAUTH_TRUSTED_CLIENT_IDS;
    }
  });

  it('lets a trusted URL bypass the URL policy and omit client_id in its document', async (t) => {
    const internalUrl = 'https://muster.agent-platform.svc/.well-known/oauth-client.json';
    process.env.OAUTH_TRUSTED_CLIENT_IDS = internalUrl;
    try {
      const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
      const { client_id: _omitted, ...docWithoutClientId } = CIMD_DOC;
      const calls = mockCimdFetch(t, { doc: docWithoutClientId });
      const client = await provider.clientsStore.getClient(internalUrl);
      assert.strictEqual(client?.client_id, internalUrl);
      assert.deepStrictEqual(calls, [internalUrl]);
    } finally {
      delete process.env.OAUTH_TRUSTED_CLIENT_IDS;
    }
  });

  it('never fetches URLs that fail the CIMD URL policy', async (t) => {
    delete process.env.OAUTH_TRUSTED_CLIENT_IDS;
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    const calls = mockCimdFetch(t);
    const unsafe = [
      'http://muster.example.com/.well-known/oauth-client.json',   // not https
      'https://muster.example.com/',                                // root path
      'https://muster.example.com',                                 // root path
      'https://10.0.0.1/.well-known/oauth-client.json',             // IPv4 literal
      'https://[::1]/.well-known/oauth-client.json',                // IPv6 literal
      'https://localhost/.well-known/oauth-client.json',            // loopback
      'https://pro.localhost/.well-known/oauth-client.json',        // loopback
      'https://muster/.well-known/oauth-client.json',               // single label
      'https://muster.agent-platform.svc/.well-known/oauth-client.json',   // cluster-internal
      'https://muster.agent-platform.svc.cluster.local/.well-known/oauth-client.json',
      'https://metadata.internal/.well-known/oauth-client.json',
      'https://user:pw@muster.example.com/.well-known/oauth-client.json',  // credentials
      'https://muster.example.com/.well-known/oauth-client.json#frag',     // fragment
      'not a url'
    ];
    for (const url of unsafe) {
      assert.strictEqual(await provider.clientsStore.getClient(url), undefined, url);
    }
    assert.deepStrictEqual(calls, [], 'no outbound request for any of them');
  });

  it('rejects a document whose client_id does not match the URL', async (t) => {
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    mockCimdFetch(t, { doc: { ...CIMD_DOC, client_id: 'https://other.example.com/client.json' } });
    assert.strictEqual(await provider.clientsStore.getClient(CIMD_URL), undefined);
  });

  it('rejects a document without a client_id when the URL is not trusted', async (t) => {
    delete process.env.OAUTH_TRUSTED_CLIENT_IDS;
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    const { client_id: _omitted, ...docWithoutClientId } = CIMD_DOC;
    mockCimdFetch(t, { doc: docWithoutClientId });
    assert.strictEqual(await provider.clientsStore.getClient(CIMD_URL), undefined);
  });

  it('rejects confidential clients (token_endpoint_auth_method other than none)', async (t) => {
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    mockCimdFetch(t, { doc: { ...CIMD_DOC, token_endpoint_auth_method: 'client_secret_post' } });
    assert.strictEqual(await provider.clientsStore.getClient(CIMD_URL), undefined);
  });

  it('rejects documents without usable redirect_uris', async (t) => {
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    for (const redirect_uris of [undefined, [], ['not a url'], 'https://muster.example.com/cb']) {
      mockCimdFetch(t, { doc: { ...CIMD_DOC, redirect_uris } });
      assert.strictEqual(await provider.clientsStore.getClient(CIMD_URL), undefined, JSON.stringify(redirect_uris));
    }
  });

  it('rejects non-JSON, non-object and oversized documents', async (t) => {
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    mockCimdFetch(t, { doc: 'not json' });
    assert.strictEqual(await provider.clientsStore.getClient(CIMD_URL), undefined, 'invalid JSON');

    mockCimdFetch(t, { doc: [CIMD_DOC] });
    assert.strictEqual(await provider.clientsStore.getClient(CIMD_URL), undefined, 'array');

    mockCimdFetch(t, { doc: { ...CIMD_DOC, padding: 'x'.repeat(64 * 1024) } });
    assert.strictEqual(await provider.clientsStore.getClient(CIMD_URL), undefined, 'oversized body');

    mockCimdFetch(t, { headers: { 'content-length': String(10 * 1024 * 1024) } });
    assert.strictEqual(await provider.clientsStore.getClient(CIMD_URL), undefined, 'oversized content-length');
  });

  it('returns undefined when the document cannot be fetched and caches the failure briefly', async (t) => {
    delete process.env.OAUTH_TRUSTED_CLIENT_IDS;
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    const calls = mockCimdFetch(t, { status: 404 });
    assert.strictEqual(await provider.clientsStore.getClient(CIMD_URL), undefined);
    assert.strictEqual(await provider.clientsStore.getClient(CIMD_URL), undefined);
    assert.strictEqual(calls.length, 1, 'failure is negative-cached');

    // After the negative-cache TTL (5 minutes) the URL is tried again
    const origNow = Date.now;
    Date.now = () => origNow() + 5 * 60 * 1000 + 1;
    try {
      assert.strictEqual(await provider.clientsStore.getClient(CIMD_URL), undefined);
      assert.strictEqual(calls.length, 2);
    } finally {
      Date.now = origNow;
    }
  });

  it('does not negative-cache failures for trusted URLs', async (t) => {
    process.env.OAUTH_TRUSTED_CLIENT_IDS = CIMD_URL;
    try {
      const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
      const calls = mockCimdFetch(t, { status: 503 });
      assert.strictEqual(await provider.clientsStore.getClient(CIMD_URL), undefined);
      assert.strictEqual(await provider.clientsStore.getClient(CIMD_URL), undefined);
      assert.strictEqual(calls.length, 2, 'every attempt retries the fetch');
    } finally {
      delete process.env.OAUTH_TRUSTED_CLIENT_IDS;
    }
  });

  it('re-fetches after the cache TTL and keeps the last good document if the refresh fails', async (t) => {
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    let status = 200;
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url) => {
      calls.push(String(url));
      return { ok: status === 200, status, headers: new Headers(), text: async () => JSON.stringify(CIMD_DOC) };
    });

    const first = await provider.clientsStore.getClient(CIMD_URL);
    assert.ok(first);

    // Past the 1 hour TTL, the upstream is down
    const origNow = Date.now;
    Date.now = () => origNow() + 60 * 60 * 1000 + 1;
    try {
      status = 503;
      const stale = await provider.clientsStore.getClient(CIMD_URL);
      assert.strictEqual(stale, first, 'previously resolved client keeps being served');
      assert.strictEqual(calls.length, 2, 'a refresh was attempted');

      // Upstream is back: the next refresh (after the short retry TTL) picks up the document again
      status = 200;
      Date.now = () => origNow() + 60 * 60 * 1000 + 5 * 60 * 1000 + 2;
      const fresh = await provider.clientsStore.getClient(CIMD_URL);
      assert.ok(fresh);
      assert.notStrictEqual(fresh, first, 'fresh document replaces the stale one');
      assert.strictEqual(calls.length, 3);
    } finally {
      Date.now = origNow;
    }
  });

  it('survives dynamic registration churn that evicts opaque clients', async (t) => {
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    const calls = mockCimdFetch(t);
    const cimdClient = await provider.clientsStore.getClient(CIMD_URL);
    assert.ok(cimdClient);

    // Overflow the DCR store so its oldest entries get evicted
    const first = provider.clientsStore.registerClient({ client_name: 'first' });
    for (let i = 0; i < 1000; i++) {
      provider.clientsStore.registerClient({ client_name: `c${i}` });
    }
    assert.strictEqual(await provider.clientsStore.getClient(first.client_id), undefined, 'DCR client evicted');
    assert.strictEqual(await provider.clientsStore.getClient(CIMD_URL), cimdClient, 'CIMD client untouched');
    assert.strictEqual(calls.length, 1, 'and not re-fetched');
  });

  it('exposes the URL policy as isCimdUrl', () => {
    assert.strictEqual(isCimdUrl(CIMD_URL), true);
    assert.strictEqual(isCimdUrl('https://muster.example.com:8443/client.json'), true);
    assert.strictEqual(isCimdUrl('https://muster.example.com/'), false);
    assert.strictEqual(isCimdUrl('https://192.168.1.1/client.json'), false);
  });
});

// ---------------------------------------------------------------------------
// authorize
// ---------------------------------------------------------------------------

describe('authorize', () => {
  it('rejects a redirect_uri not in the client registered URIs', async () => {
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    const client = provider.clientsStore.registerClient({
      client_name: 'test-client',
      redirect_uris: ['https://example.com/callback']
    });
    const res = makeMockRes();
    await assert.rejects(
      () => provider.authorize(client, {
        redirectUri: 'https://evil.example.com/steal',
        codeChallenge: 'test-challenge',
        state: 'cs'
      }, res),
      /redirect_uri does not match registered URIs/
    );
    assert.strictEqual(res.redirectedTo, null, 'should not redirect');
  });

  it('redirects to GitHub OAuth with the app client_id and required scopes', async () => {
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    const { authRes } = await runAuthorize(provider);

    assert.ok(authRes.redirectedTo, 'should redirect');
    const url = new URL(authRes.redirectedTo);
    assert.strictEqual(`${url.origin}${url.pathname}`, 'https://github.com/login/oauth/authorize');
    assert.strictEqual(url.searchParams.get('client_id'), 'gh-client-id');
    assert.strictEqual(url.searchParams.get('allow_signup'), 'false');
    assert.ok(url.searchParams.get('state'), 'should include a state parameter');
    const scope = url.searchParams.get('scope');
    assert.ok(scope.includes('repo'), 'scope should include repo');
    assert.ok(scope.includes('project'), 'scope should include project');
    assert.ok(scope.includes('read:org'), 'scope should include read:org');
  });
});

// ---------------------------------------------------------------------------
// challengeForAuthorizationCode
// ---------------------------------------------------------------------------

describe('challengeForAuthorizationCode', () => {
  it('returns the PKCE challenge stored for the authorization code', async (t) => {
    const { provider, handleGitHubCallback } = createGitHubOAuthProvider(TEST_CONFIG);
    const { client, localCode } = await runCallbackFlow(provider, handleGitHubCallback, t, {
      codeChallenge: 'my-pkce-challenge'
    });
    const challenge = await provider.challengeForAuthorizationCode(client, localCode);
    assert.strictEqual(challenge, 'my-pkce-challenge');
  });

  it('throws invalid_grant for an unknown authorization code', async () => {
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    const client = provider.clientsStore.registerClient({ client_name: 'c' });
    await assert.rejects(
      () => provider.challengeForAuthorizationCode(client, 'bogus-code'),
      { name: 'InvalidGrantError', errorCode: 'invalid_grant', message: /Authorization code not found or expired/ }
    );
  });
});

// ---------------------------------------------------------------------------
// exchangeAuthorizationCode
// ---------------------------------------------------------------------------

describe('exchangeAuthorizationCode', () => {
  it('returns the GitHub token for a valid code', async (t) => {
    const { provider, handleGitHubCallback } = createGitHubOAuthProvider(TEST_CONFIG);
    const { client, localCode } = await runCallbackFlow(provider, handleGitHubCallback, t, {
      githubToken: 'ghtoken-exchange'
    });
    const tokenRes = await provider.exchangeAuthorizationCode(client, localCode);
    assert.strictEqual(tokenRes.access_token, 'ghtoken-exchange');
    assert.strictEqual(tokenRes.token_type, 'Bearer');
  });

  it('omits expires_in so clients treat the token as non-expiring', async (t) => {
    const { provider, handleGitHubCallback } = createGitHubOAuthProvider(TEST_CONFIG);
    const { client, localCode } = await runCallbackFlow(provider, handleGitHubCallback, t);
    const tokenRes = await provider.exchangeAuthorizationCode(client, localCode);
    assert.strictEqual(tokenRes.expires_in, undefined, 'should not set expires_in');
  });

  it('passes through the scope from GitHub response', async (t) => {
    const { provider, handleGitHubCallback } = createGitHubOAuthProvider(TEST_CONFIG);
    const { client, localCode } = await runCallbackFlow(provider, handleGitHubCallback, t, {
      githubToken: 'ghtoken-scoped',
      githubScope: 'repo,project,read:org'
    });
    const tokenRes = await provider.exchangeAuthorizationCode(client, localCode);
    assert.strictEqual(tokenRes.scope, 'repo,project,read:org');
  });

  it('omits scope when GitHub response has none', async (t) => {
    const { provider, handleGitHubCallback } = createGitHubOAuthProvider(TEST_CONFIG);
    const { client, localCode } = await runCallbackFlow(provider, handleGitHubCallback, t);
    const tokenRes = await provider.exchangeAuthorizationCode(client, localCode);
    assert.strictEqual(tokenRes.scope, undefined, 'should not set scope when GitHub omits it');
  });

  it('codes are single-use: throws invalid_grant on second exchange', async (t) => {
    const { provider, handleGitHubCallback } = createGitHubOAuthProvider(TEST_CONFIG);
    const { client, localCode } = await runCallbackFlow(provider, handleGitHubCallback, t);
    await provider.exchangeAuthorizationCode(client, localCode);
    await assert.rejects(
      () => provider.exchangeAuthorizationCode(client, localCode),
      { name: 'InvalidGrantError', errorCode: 'invalid_grant', message: /Authorization code not found or expired/ }
    );
  });

  it('throws invalid_grant when the code belongs to a different client', async (t) => {
    const { provider, handleGitHubCallback } = createGitHubOAuthProvider(TEST_CONFIG);
    const { localCode } = await runCallbackFlow(provider, handleGitHubCallback, t);
    const otherClient = provider.clientsStore.registerClient({ client_name: 'other' });
    await assert.rejects(
      () => provider.exchangeAuthorizationCode(otherClient, localCode),
      { name: 'InvalidGrantError', errorCode: 'invalid_grant', message: /Authorization code was issued to a different client/ }
    );
  });

  it('throws invalid_grant for an unknown code', async () => {
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    const client = provider.clientsStore.registerClient({ client_name: 'c' });
    await assert.rejects(
      () => provider.exchangeAuthorizationCode(client, 'nonexistent'),
      { name: 'InvalidGrantError', errorCode: 'invalid_grant', message: /Authorization code not found or expired/ }
    );
  });
});

// ---------------------------------------------------------------------------
// exchangeRefreshToken
// ---------------------------------------------------------------------------

describe('exchangeRefreshToken', () => {
  it('always throws unsupported_grant_type (refresh tokens not supported)', async () => {
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    await assert.rejects(
      () => provider.exchangeRefreshToken(),
      { name: 'UnsupportedGrantTypeError', errorCode: 'unsupported_grant_type', message: /Refresh tokens are not supported/ }
    );
  });
});

// ---------------------------------------------------------------------------
// verifyAccessToken
// ---------------------------------------------------------------------------

describe('verifyAccessToken', () => {
  it('returns authInfo with the actual granted scopes', async (t) => {
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    t.mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      status: 200,
      headers: { get: (h) => h === 'x-oauth-scopes' ? 'repo, project, read:org' : null },
      json: async () => ({ login: 'testuser' })
    }));

    const authInfo = await provider.verifyAccessToken('valid-token');
    assert.strictEqual(authInfo.clientId, 'testuser');
    assert.ok(authInfo.scopes.includes('repo'));
    assert.ok(authInfo.scopes.includes('project'));
    assert.ok(authInfo.scopes.includes('read:org'));
  });

  it('rejects tokens missing required scopes', async (t) => {
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    t.mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      status: 200,
      headers: { get: (h) => h === 'x-oauth-scopes' ? 'repo' : null },
      json: async () => ({ login: 'testuser' })
    }));

    await assert.rejects(
      () => provider.verifyAccessToken('insufficient-token'),
      /GitHub token is missing required scopes/
    );
  });

  it('accepts a token without a scopes header (GitHub App / fine-grained PAT)', async (t) => {
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    t.mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ login: 'app-user' })
    }));

    const authInfo = await provider.verifyAccessToken('ghu_app_token');
    assert.strictEqual(authInfo.clientId, 'app-user');
    assert.deepStrictEqual(authInfo.scopes, []);
  });

  it('accepts a token with an empty scopes header (GitHub App user-to-server token)', async (t) => {
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    t.mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      status: 200,
      headers: { get: (h) => h === 'x-oauth-scopes' ? '' : null },
      json: async () => ({ login: 'app-user' })
    }));

    const authInfo = await provider.verifyAccessToken('ghu_app_token_empty');
    assert.strictEqual(authInfo.clientId, 'app-user');
    assert.deepStrictEqual(authInfo.scopes, []);
  });

  it('honors the scope hierarchy: admin:org or write:org satisfies read:org', async (t) => {
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    let scopes = 'repo, project, admin:org';
    t.mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      status: 200,
      headers: { get: (h) => h === 'x-oauth-scopes' ? scopes : null },
      json: async () => ({ login: 'org-admin' })
    }));

    const admin = await provider.verifyAccessToken('gho_admin_org');
    assert.strictEqual(admin.clientId, 'org-admin');

    scopes = 'repo, project, write:org';
    const writer = await provider.verifyAccessToken('gho_write_org');
    assert.strictEqual(writer.clientId, 'org-admin');

    scopes = 'repo, admin:org';
    await assert.rejects(
      () => provider.verifyAccessToken('gho_no_project'),
      /missing required scopes: project$/
    );
  });

  it('throws when GitHub API returns non-ok status', async (t) => {
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    t.mock.method(globalThis, 'fetch', async () => ({
      ok: false,
      status: 401,
      headers: { get: () => null }
    }));

    await assert.rejects(
      () => provider.verifyAccessToken('bad-token'),
      /GitHub token verification failed: 401/
    );
  });

  it('returns cached result on second call without hitting fetch again', async (t) => {
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    let fetchCalls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      fetchCalls++;
      return {
        ok: true,
        status: 200,
        headers: { get: (h) => h === 'x-oauth-scopes' ? 'repo, project, read:org' : null },
        json: async () => ({ login: 'cacheduser' })
      };
    });

    const first = await provider.verifyAccessToken('cached-token');
    const second = await provider.verifyAccessToken('cached-token');
    assert.strictEqual(fetchCalls, 1, 'fetch should be called only once');
    assert.deepStrictEqual(first, second);
  });

  it('re-fetches after the cache TTL expires', async (t) => {
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    let fetchCalls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      fetchCalls++;
      return {
        ok: true,
        status: 200,
        headers: { get: (h) => h === 'x-oauth-scopes' ? 'repo, project, read:org' : null },
        json: async () => ({ login: 'user' })
      };
    });

    await provider.verifyAccessToken('expiring-token');
    assert.strictEqual(fetchCalls, 1);

    // Advance Date.now past TOKEN_CACHE_TTL_MS (5 minutes)
    const origNow = Date.now;
    Date.now = () => origNow() + 5 * 60 * 1000 + 1;
    try {
      await provider.verifyAccessToken('expiring-token');
      assert.strictEqual(fetchCalls, 2, 'fetch should be called again after cache expires');
    } finally {
      Date.now = origNow;
    }
  });
});

// ---------------------------------------------------------------------------
// handleGitHubCallback
// ---------------------------------------------------------------------------

describe('handleGitHubCallback', () => {
  it('returns 400 when code is missing', async () => {
    const { handleGitHubCallback } = createGitHubOAuthProvider(TEST_CONFIG);
    const res = makeMockRes();
    await handleGitHubCallback({ query: { state: 'some-state' } }, res);
    assert.strictEqual(res.statusCode, 400);
  });

  it('returns 400 when state is missing', async () => {
    const { handleGitHubCallback } = createGitHubOAuthProvider(TEST_CONFIG);
    const res = makeMockRes();
    await handleGitHubCallback({ query: { code: 'some-code' } }, res);
    assert.strictEqual(res.statusCode, 400);
  });

  it('returns 400 for an unknown state', async () => {
    const { handleGitHubCallback } = createGitHubOAuthProvider(TEST_CONFIG);
    const res = makeMockRes();
    await handleGitHubCallback({ query: { code: 'code', state: 'unknown-state' } }, res);
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.jsonBody.error, /Invalid or expired authorization session/);
  });

  it('returns 400 for an expired session', async () => {
    const { provider, handleGitHubCallback } = createGitHubOAuthProvider(TEST_CONFIG);
    const { state } = await runAuthorize(provider);

    // Advance time past AUTH_SESSION_TTL_MS (10 minutes)
    const origNow = Date.now;
    Date.now = () => origNow() + 10 * 60 * 1000 + 1;
    try {
      const res = makeMockRes();
      await handleGitHubCallback({ query: { code: 'code', state } }, res);
      assert.strictEqual(res.statusCode, 400);
      assert.match(res.jsonBody.error, /Invalid or expired authorization session/);
    } finally {
      Date.now = origNow;
    }
  });

  it('returns 400 when GitHub returns an error during token exchange', async (t) => {
    const { provider, handleGitHubCallback } = createGitHubOAuthProvider(TEST_CONFIG);
    const { state } = await runAuthorize(provider);

    t.mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({ error: 'bad_verification_code', error_description: 'The code is invalid' })
    }));

    const res = makeMockRes();
    await handleGitHubCallback({ query: { code: 'bad-code', state } }, res);
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.jsonBody.error, /The code is invalid/);
  });

  it('returns 502 when GitHub response has no access_token', async (t) => {
    const { provider, handleGitHubCallback } = createGitHubOAuthProvider(TEST_CONFIG);
    const { state } = await runAuthorize(provider);

    t.mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({})
    }));

    const res = makeMockRes();
    await handleGitHubCallback({ query: { code: 'gh-code', state } }, res);
    assert.strictEqual(res.statusCode, 502);
    assert.match(res.jsonBody.error, /GitHub did not return an access token/);
  });

  it('redirects to client redirect_uri with local code and original state on success', async (t) => {
    const { provider, handleGitHubCallback } = createGitHubOAuthProvider(TEST_CONFIG);
    const { state } = await runAuthorize(provider, { clientState: 'original-client-state' });

    t.mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'ghtoken-success' })
    }));

    const res = makeMockRes();
    await handleGitHubCallback({ query: { code: 'gh-code', state } }, res);

    assert.ok(res.redirectedTo, 'should redirect');
    const redirectUrl = new URL(res.redirectedTo);
    assert.strictEqual(`${redirectUrl.origin}${redirectUrl.pathname}`, 'https://example.com/callback');
    assert.ok(redirectUrl.searchParams.get('code'), 'should include local code');
    assert.strictEqual(redirectUrl.searchParams.get('state'), 'original-client-state');
  });

  it('local code can be used to retrieve the PKCE challenge', async (t) => {
    const { provider, handleGitHubCallback } = createGitHubOAuthProvider(TEST_CONFIG);
    const { client, localCode } = await runCallbackFlow(provider, handleGitHubCallback, t, {
      codeChallenge: 'pkce-abc'
    });
    const challenge = await provider.challengeForAuthorizationCode(client, localCode);
    assert.strictEqual(challenge, 'pkce-abc');
  });
});
