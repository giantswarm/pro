import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubOAuthProvider } from './provider.js';

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
// trusted client auto-registration
// ---------------------------------------------------------------------------

describe('trusted client auto-registration', () => {
  it('auto-registers a trusted CIMD URL on getClient', async (t) => {
    const cimdUrl = 'https://muster.example.com/.well-known/oauth-client.json';
    process.env.OAUTH_TRUSTED_CLIENT_IDS = cimdUrl;
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);

    t.mock.method(globalThis, 'fetch', async (url) => {
      if (url === cimdUrl) {
        return {
          ok: true,
          json: async () => ({
            client_id: cimdUrl,
            client_name: 'Muster',
            redirect_uris: ['https://muster.example.com/oauth/callback'],
            grant_types: ['authorization_code'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none'
          })
        };
      }
      return { ok: false, status: 404 };
    });

    const client = await provider.clientsStore.getClient(cimdUrl);
    assert.ok(client, 'trusted client should be auto-registered');
    assert.strictEqual(client.client_id, cimdUrl);
    assert.strictEqual(client.client_name, 'Muster');
    assert.deepStrictEqual(client.redirect_uris, ['https://muster.example.com/oauth/callback']);

    // Second call should return from cache without fetching again
    const cached = await provider.clientsStore.getClient(cimdUrl);
    assert.deepStrictEqual(cached.client_id, cimdUrl);

    delete process.env.OAUTH_TRUSTED_CLIENT_IDS;
  });

  it('returns undefined for untrusted CIMD URLs', async () => {
    delete process.env.OAUTH_TRUSTED_CLIENT_IDS;
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    const client = await provider.clientsStore.getClient('https://untrusted.example.com/.well-known/oauth-client.json');
    assert.strictEqual(client, undefined);
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

  it('throws for an unknown authorization code', async () => {
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    const client = provider.clientsStore.registerClient({ client_name: 'c' });
    await assert.rejects(
      () => provider.challengeForAuthorizationCode(client, 'bogus-code'),
      /Authorization code not found or expired/
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

  it('codes are single-use: throws on second exchange', async (t) => {
    const { provider, handleGitHubCallback } = createGitHubOAuthProvider(TEST_CONFIG);
    const { client, localCode } = await runCallbackFlow(provider, handleGitHubCallback, t);
    await provider.exchangeAuthorizationCode(client, localCode);
    await assert.rejects(
      () => provider.exchangeAuthorizationCode(client, localCode),
      /Authorization code not found or expired/
    );
  });

  it('throws when the code belongs to a different client', async (t) => {
    const { provider, handleGitHubCallback } = createGitHubOAuthProvider(TEST_CONFIG);
    const { localCode } = await runCallbackFlow(provider, handleGitHubCallback, t);
    const otherClient = provider.clientsStore.registerClient({ client_name: 'other' });
    await assert.rejects(
      () => provider.exchangeAuthorizationCode(otherClient, localCode),
      /Authorization code was issued to a different client/
    );
  });

  it('throws for an unknown code', async () => {
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    const client = provider.clientsStore.registerClient({ client_name: 'c' });
    await assert.rejects(
      () => provider.exchangeAuthorizationCode(client, 'nonexistent'),
      /Authorization code not found or expired/
    );
  });
});

// ---------------------------------------------------------------------------
// exchangeRefreshToken
// ---------------------------------------------------------------------------

describe('exchangeRefreshToken', () => {
  it('always throws (refresh tokens not supported)', async () => {
    const { provider } = createGitHubOAuthProvider(TEST_CONFIG);
    await assert.rejects(
      () => provider.exchangeRefreshToken(),
      /Refresh tokens are not supported/
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
