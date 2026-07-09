/**
 * GitHub OAuth Provider for MCP
 *
 * Implements the MCP SDK's OAuthServerProvider interface to authenticate
 * users via GitHub OAuth. PRO acts as the OAuth authorization server,
 * proxying the actual authentication to GitHub.
 *
 * Flow:
 *   1. MCP client registers via /register → gets a local client_id
 *   2. MCP client initiates /authorize with PKCE
 *   3. PRO redirects to GitHub OAuth with our app's client_id
 *   4. GitHub redirects back to /github/callback
 *   5. PRO exchanges GitHub code for a token, stores it, redirects client
 *   6. MCP client exchanges local code for the GitHub token via /token
 *   7. MCP requests include the GitHub token as Bearer auth
 *
 * Environment variables:
 *   GITHUB_OAUTH_CLIENT_ID     - GitHub OAuth App client ID
 *   GITHUB_OAUTH_CLIENT_SECRET - GitHub OAuth App client secret
 *   OAUTH_TRUSTED_CLIENT_IDS   - Comma-separated CIMD URLs of trusted clients
 *                                 that are auto-registered on first use (e.g. muster)
 */

import { randomUUID } from 'crypto';
import { logger } from '../logger.js';

// TTL for authorization sessions (10 minutes)
const AUTH_SESSION_TTL_MS = 10 * 60 * 1000;
// TTL for cached token verifications (5 minutes)
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;
// Maximum number of registered MCP clients kept in memory
const MAX_CLIENTS = 1000;
// GitHub OAuth scopes required by PRO's tools
const REQUIRED_GITHUB_SCOPES = ['repo', 'project', 'read:org'];
// TTL for cached CIMD fetches (1 hour) — avoids re-fetching on every authorize
const CIMD_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Create the GitHub OAuth provider.
 *
 * @param {{ clientId: string, clientSecret: string }} config
 * @returns {import('@modelcontextprotocol/sdk/server/auth/provider.js').OAuthServerProvider}
 */
export function createGitHubOAuthProvider(config) {
  const { clientId, clientSecret } = config;

  // Trusted client IDs (CIMD URLs) that can skip /register — read at creation
  // time so tests can set the env var before calling createGitHubOAuthProvider.
  const trustedClientIds = (process.env.OAUTH_TRUSTED_CLIENT_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  // In-memory registered MCP clients (UUID client_id → client metadata)
  const clients = new Map();

  // In-memory authorization sessions (state → session data)
  const authSessions = new Map();

  // In-memory local auth codes (code → { githubToken, clientId, redirectUri, codeChallenge })
  const authCodes = new Map();

  // Token verification cache (token → { authInfo, expiresAt })
  const tokenCache = new Map();

  // Periodic cleanup
  const sweepInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, session] of authSessions) {
      if (now > session.expiresAt) authSessions.delete(key);
    }
    for (const [key, code] of authCodes) {
      if (now > code.expiresAt) authCodes.delete(key);
    }
    for (const [key, entry] of tokenCache) {
      if (now > entry.expiresAt) tokenCache.delete(key);
    }
  }, 60_000);
  sweepInterval.unref();

  // Cache for fetched CIMDs (URL → { metadata, expiresAt })
  const cimdCache = new Map();

  /**
   * Fetch a Client ID Metadata Document from a trusted CIMD URL and
   * register the client in the local store. Returns the client info
   * or undefined if the fetch fails or the URL is not trusted.
   */
  async function fetchAndRegisterTrustedClient(clientId) {
    if (!trustedClientIds.includes(clientId)) {
      return undefined;
    }

    // Check CIMD cache
    const cached = cimdCache.get(clientId);
    if (cached && Date.now() < cached.expiresAt) {
      return clients.get(clientId);
    }

    try {
      const res = await fetch(clientId, {
        headers: { Accept: 'application/json', 'User-Agent': 'giantswarm-pro-mcp' }
      });
      if (!res.ok) {
        logger.warn(`OAuth: Failed to fetch CIMD from ${clientId}: ${res.status}`);
        return undefined;
      }
      const metadata = await res.json();

      const now = Math.floor(Date.now() / 1000);
      const clientInfo = {
        client_id: clientId,
        client_id_issued_at: now,
        client_name: metadata.client_name,
        client_uri: metadata.client_uri,
        redirect_uris: metadata.redirect_uris || [],
        grant_types: metadata.grant_types || ['authorization_code'],
        response_types: metadata.response_types || ['code'],
        token_endpoint_auth_method: metadata.token_endpoint_auth_method || 'none',
        scope: metadata.scope
      };

      clients.set(clientId, clientInfo);
      cimdCache.set(clientId, { expiresAt: Date.now() + CIMD_CACHE_TTL_MS });
      logger.info(`OAuth: Auto-registered trusted client ${clientId} (${metadata.client_name || 'unknown'})`);
      return clientInfo;
    } catch (err) {
      logger.warn(`OAuth: Error fetching CIMD from ${clientId}: ${err.message}`);
      return undefined;
    }
  }

  /**
   * Verify a GitHub access token by calling the GitHub API.
   * Validates that the token has all required scopes.
   * Results are cached briefly to avoid per-request API calls.
   */
  async function verifyGitHubToken(token) {
    const cached = tokenCache.get(token);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.authInfo;
    }

    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'giantswarm-pro-mcp'
      }
    });

    if (!res.ok) {
      throw new Error(`GitHub token verification failed: ${res.status}`);
    }

    // Parse the actual scopes granted to this token
    const scopeHeader = res.headers.get('x-oauth-scopes') || '';
    const grantedScopes = scopeHeader.split(',').map(s => s.trim()).filter(Boolean);

    // Reject tokens that are missing required scopes
    const missingScopes = REQUIRED_GITHUB_SCOPES.filter(s => !grantedScopes.includes(s));
    if (missingScopes.length > 0) {
      throw new Error(`GitHub token is missing required scopes: ${missingScopes.join(', ')}`);
    }

    const user = await res.json();

    const authInfo = {
      token,
      clientId: user.login,
      scopes: grantedScopes,
      expiresAt: Math.floor(Date.now() / 1000) + 3600 // 1 hour
    };

    tokenCache.set(token, {
      authInfo,
      expiresAt: Date.now() + TOKEN_CACHE_TTL_MS
    });

    return authInfo;
  }

  // -----------------------------------------------------------------------
  // OAuthServerProvider implementation
  // -----------------------------------------------------------------------

  const provider = {
    get clientsStore() {
      return {
        async getClient(clientId) {
          const existing = clients.get(clientId);
          if (existing) return existing;
          // Auto-register if this is a trusted CIMD URL
          return await fetchAndRegisterTrustedClient(clientId);
        },

        registerClient(clientMetadata) {
          // Evict the oldest entry when the cap is reached
          if (clients.size >= MAX_CLIENTS) {
            const oldestKey = clients.keys().next().value;
            clients.delete(oldestKey);
            logger.warn(`OAuth: Client store full (${MAX_CLIENTS}), evicted oldest client ${oldestKey}`);
          }
          const id = randomUUID();
          const now = Math.floor(Date.now() / 1000);
          const clientInfo = {
            ...clientMetadata,
            client_id: id,
            client_id_issued_at: now
          };
          clients.set(id, clientInfo);
          logger.info(`OAuth: Registered MCP client ${id}`);
          return clientInfo;
        }
      };
    },

    /**
     * Start the authorization flow: redirect user to GitHub.
     */
    async authorize(client, params, res) {
      // Defense-in-depth: the MCP SDK already validates redirect_uri, but
      // re-check here since an open-redirect would be severe.
      if (client.redirect_uris?.length && !client.redirect_uris.includes(params.redirectUri)) {
        throw new Error('redirect_uri does not match registered URIs');
      }

      const state = randomUUID();

      // Store session for when GitHub redirects back
      authSessions.set(state, {
        mcpClientId: client.client_id,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        clientState: params.state,
        expiresAt: Date.now() + AUTH_SESSION_TTL_MS
      });

      // Redirect to GitHub OAuth
      const githubUrl = new URL('https://github.com/login/oauth/authorize');
      githubUrl.searchParams.set('client_id', clientId);
      githubUrl.searchParams.set('state', state);
      githubUrl.searchParams.set('allow_signup', 'false');

      // Always request the fixed set of GitHub scopes required by PRO's tools
      const githubScopes = ['repo', 'project', 'read:org'];
      githubUrl.searchParams.set('scope', githubScopes.join(' '));

      res.redirect(githubUrl.toString());
    },

    /**
     * Return the PKCE code challenge for a local authorization code.
     */
    async challengeForAuthorizationCode(_client, authorizationCode) {
      const entry = authCodes.get(authorizationCode);
      if (!entry) {
        throw new Error('Authorization code not found or expired');
      }
      return entry.codeChallenge;
    },

    /**
     * Exchange a local authorization code for the stored GitHub token.
     */
    async exchangeAuthorizationCode(client, authorizationCode) {
      const entry = authCodes.get(authorizationCode);
      if (!entry) {
        throw new Error('Authorization code not found or expired');
      }

      if (entry.clientId !== client.client_id) {
        throw new Error('Authorization code was issued to a different client');
      }

      // Delete the code (single use)
      authCodes.delete(authorizationCode);

      const tokens = {
        access_token: entry.githubToken,
        token_type: 'Bearer'
      };
      // Pass through the actual scope GitHub granted rather than hardcoding
      if (entry.githubScope) {
        tokens.scope = entry.githubScope;
      }
      // Omit expires_in — classic GitHub OAuth tokens don't expire, and we
      // don't support refresh tokens, so a hardcoded TTL would just force
      // clients into an unnecessary re-authorize loop.
      return tokens;
    },

    /**
     * Refresh tokens — GitHub OAuth doesn't support refresh tokens,
     * so we reject these requests.
     */
    async exchangeRefreshToken() {
      throw new Error('Refresh tokens are not supported. Re-authorize to get a new token.');
    },

    /**
     * Verify an access token (which is a GitHub token).
     */
    async verifyAccessToken(token) {
      return await verifyGitHubToken(token);
    }
  };

  // -----------------------------------------------------------------------
  // GitHub callback handler (mounted as an Express route)
  // -----------------------------------------------------------------------

  /**
   * Handle GitHub's OAuth redirect.
   * Exchange GitHub code for token, generate local auth code, redirect to MCP client.
   */
  async function handleGitHubCallback(req, res) {
    const { code, state } = req.query;

    if (!code || !state) {
      res.status(400).json({ error: 'Missing code or state parameter' });
      return;
    }

    const session = authSessions.get(state);
    if (!session) {
      res.status(400).json({ error: 'Invalid or expired authorization session' });
      return;
    }

    if (session.expiresAt <= Date.now()) {
      authSessions.delete(state);
      res.status(400).json({ error: 'Invalid or expired authorization session' });
      return;
    }
    // Clean up the session
    authSessions.delete(state);

    try {
      // Exchange GitHub code for access token
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code
        })
      });

      const tokenData = await tokenRes.json();

      if (tokenData.error) {
        logger.error('GitHub OAuth token exchange failed', { error: tokenData.error });
        res.status(400).json({ error: `GitHub OAuth error: ${tokenData.error_description || tokenData.error}` });
        return;
      }

      if (!tokenData.access_token) {
        logger.error('GitHub OAuth: no access_token in response');
        res.status(502).json({ error: 'GitHub did not return an access token' });
        return;
      }

      // Generate a local authorization code for the MCP client
      const localCode = randomUUID();

      authCodes.set(localCode, {
        githubToken: tokenData.access_token,
        githubScope: tokenData.scope,
        clientId: session.mcpClientId,
        redirectUri: session.redirectUri,
        codeChallenge: session.codeChallenge,
        expiresAt: Date.now() + AUTH_SESSION_TTL_MS
      });

      // Redirect back to the MCP client's redirect_uri with our local code
      const redirectUrl = new URL(session.redirectUri);
      redirectUrl.searchParams.set('code', localCode);
      if (session.clientState) {
        redirectUrl.searchParams.set('state', session.clientState);
      }

      res.redirect(redirectUrl.toString());
    } catch (err) {
      logger.error('GitHub OAuth callback error', { error: err.message });
      res.status(500).json({ error: 'Failed to complete GitHub authentication' });
    }
  }

  return { provider, handleGitHubCallback };
}
