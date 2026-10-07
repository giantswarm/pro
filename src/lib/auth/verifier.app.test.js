import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubTokenVerifier } from './provider.js';

// ---------------------------------------------------------------------------
// The App pin (GITHUB_APP_SLUG): only a user access token of pro's own GitHub
// App is accepted, so every write is the person's own capped by that App's
// permissions. GitHub lists a user token's installations of the issuing App
// only; the GitHub API is mocked here.
// ---------------------------------------------------------------------------

function mockGitHub(t, { installations = [{ app_slug: 'giantswarm-pro' }], installationsStatus = 200 } = {}) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(String(url));
    if (String(url) === 'https://api.github.com/user') {
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ login: 'alice' }) };
    }
    if (String(url).startsWith('https://api.github.com/user/installations')) {
      return {
        ok: installationsStatus === 200,
        status: installationsStatus,
        headers: new Headers(),
        json: async () => ({ total_count: installations.length, installations })
      };
    }
    return { ok: false, status: 404, headers: new Headers(), json: async () => ({}) };
  });
  return calls;
}

describe('createGitHubTokenVerifier with an App pin', () => {
  it('accepts a user access token of the pinned App and caches it', async (t) => {
    const calls = mockGitHub(t);
    const verifier = createGitHubTokenVerifier({ appSlug: 'giantswarm-pro' });
    const info = await verifier.verifyAccessToken('ghu_alice');
    assert.equal(info.clientId, 'alice');
    await verifier.verifyAccessToken('ghu_alice');
    assert.equal(calls.length, 2, 'one /user and one /user/installations call, then the cache');
  });

  it('refuses a user access token of another App (the login App)', async (t) => {
    mockGitHub(t, { installations: [{ app_slug: 'portal-login-app' }] });
    const verifier = createGitHubTokenVerifier({ appSlug: 'giantswarm-pro' });
    await assert.rejects(verifier.verifyAccessToken('ghu_alice'), {
      name: 'InvalidTokenError',
      message: /not a user access token of the GitHub App giantswarm-pro/
    });
  });

  it('refuses a token that lists other Apps beside the pinned one', async (t) => {
    mockGitHub(t, { installations: [{ app_slug: 'giantswarm-pro' }, { app_slug: 'other' }] });
    const verifier = createGitHubTokenVerifier({ appSlug: 'giantswarm-pro' });
    await assert.rejects(verifier.verifyAccessToken('ghu_alice'), { name: 'InvalidTokenError' });
  });

  it('refuses a token of no installation', async (t) => {
    mockGitHub(t, { installations: [] });
    const verifier = createGitHubTokenVerifier({ appSlug: 'giantswarm-pro' });
    await assert.rejects(verifier.verifyAccessToken('ghu_alice'), { name: 'InvalidTokenError' });
  });

  it('refuses a token that is no App user token without asking for installations', async (t) => {
    const calls = mockGitHub(t);
    const verifier = createGitHubTokenVerifier({ appSlug: 'giantswarm-pro' });
    for (const token of ['gho_oauth', 'ghp_classic', 'github_pat_fine']) {
      await assert.rejects(verifier.verifyAccessToken(token), { name: 'InvalidTokenError' }, token);
    }
    assert.ok(calls.every(url => url === 'https://api.github.com/user'));
  });

  it('refuses when the installation lookup fails', async (t) => {
    mockGitHub(t, { installationsStatus: 403 });
    const verifier = createGitHubTokenVerifier({ appSlug: 'giantswarm-pro' });
    await assert.rejects(verifier.verifyAccessToken('ghu_alice'), {
      name: 'InvalidTokenError',
      message: /installation lookup failed: 403/
    });
  });

  it('accepts any GitHub token without a pin', async (t) => {
    const calls = mockGitHub(t);
    const verifier = createGitHubTokenVerifier();
    const info = await verifier.verifyAccessToken('gho_oauth');
    assert.equal(info.clientId, 'alice');
    assert.deepEqual(calls, ['https://api.github.com/user']);
  });
});
