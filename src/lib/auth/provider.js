/**
 * GitHub OAuth Provider for MCP
 *
 * Implements the MCP SDK's OAuthServerProvider interface to authenticate
 * users via GitHub OAuth. PRO acts as the OAuth authorization server,
 * proxying the actual authentication to GitHub.
 *
 * Flow:
 *   1. MCP client obtains a client_id, either by
 *      a. registering via /register (RFC 7591 dynamic client registration), or
 *      b. using the HTTPS URL of its Client ID Metadata Document (CIMD,
 *         SEP-991) directly as client_id — PRO fetches and validates the
 *         document on first use. The AS metadata advertises this with
 *         client_id_metadata_document_supported: true.
 *   2. MCP client initiates /authorize with PKCE
 *   3. PRO redirects to GitHub OAuth with our app's client_id
 *   4. GitHub redirects back to /github/callback
 *   5. PRO exchanges GitHub code for a token, stores it, redirects client
 *   6. MCP client exchanges local code for the GitHub token via /token
 *   7. MCP requests include the GitHub token as Bearer auth
 *
 * State and restarts: everything here lives in process memory. A restart
 * drops all dynamically registered client_ids (clients on path 1a get
 * invalid_client and must register again), every in-flight authorization
 * session (a login that is on GitHub when the pod restarts fails at
 * /github/callback with "Invalid or expired authorization session" and has to
 * be started over) and every not-yet-exchanged local authorization code.
 * CIMD clients (path 1b) are unaffected: their client_id is re-resolved from
 * the URL, which is why muster and Claude Code use it.
 *
 * Environment variables:
 *   GITHUB_OAUTH_CLIENT_ID     - GitHub OAuth App client ID
 *   GITHUB_OAUTH_CLIENT_SECRET - GitHub OAuth App client secret
 *   OAUTH_TRUSTED_CLIENT_IDS   - Comma-separated CIMD URLs that bypass the
 *                                 outbound URL policy below (e.g. a muster on a
 *                                 cluster-internal hostname). Public HTTPS CIMD
 *                                 URLs need no entry here.
 */

import { randomUUID } from 'crypto';
import net from 'node:net';
import { logger } from '../logger.js';

// TTL for authorization sessions (10 minutes)
const AUTH_SESSION_TTL_MS = 10 * 60 * 1000;
// TTL for cached token verifications (5 minutes)
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;
// Maximum number of registered MCP clients kept in memory
const MAX_CLIENTS = 1000;
// GitHub OAuth scopes required by PRO's tools
const REQUIRED_GITHUB_SCOPES = ['repo', 'project', 'read:org'];
// TTL for resolved Client ID Metadata Documents (1 hour) — avoids re-fetching
// on every authorize/token call
const CIMD_CACHE_TTL_MS = 60 * 60 * 1000;
// TTL for remembering a CIMD URL that failed to resolve, so a flood of bogus
// URL client_ids does not become a flood of outbound fetches
const CIMD_NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000;
// Maximum number of CIMD clients (positive and negative entries) kept in memory
const MAX_CIMD_CLIENTS = 1000;
// Outbound fetch limits for CIMD documents
const CIMD_FETCH_TIMEOUT_MS = 5 * 1000;
const CIMD_MAX_BYTES = 64 * 1024;

/**
 * Whether a client_id has the shape of a Client ID Metadata Document URL that
 * this server is willing to fetch.
 *
 * SEP-991 requires an HTTPS URL with a non-root path (the same shape the MCP
 * SDK client enforces on its own clientMetadataUrl). On top of that, since the
 * client_id is attacker-controlled and resolving it means an outbound request
 * from inside the cluster, refuse everything that would turn the fetch into an
 * SSRF probe: IP literals, loopback, single-label and cluster-internal
 * hostnames, embedded credentials, fragments.
 */
export function isCimdUrl(clientId) {
  let url;
  try {
    url = new URL(clientId);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.pathname === '' || url.pathname === '/') return false;
  if (url.username || url.password || url.hash) return false;

  const host = url.hostname;
  if (net.isIP(host.replace(/^\[|\]$/g, '')) !== 0) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (!host.includes('.')) return false;
  if (/\.(local|localdomain|internal|svc|home\.arpa)$/.test(host)) return false;
  return true;
}

/**
 * Create the GitHub OAuth provider.
 *
 * @param {{ clientId: string, clientSecret: string }} config
 * @returns {import('@modelcontextprotocol/sdk/server/auth/provider.js').OAuthServerProvider}
 */
export function createGitHubOAuthProvider(config) {
  const { clientId, clientSecret } = config;

  // Trusted CIMD URLs that bypass the outbound URL policy in isCimdUrl — read
  // at creation time so tests can set the env var before calling
  // createGitHubOAuthProvider.
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

  // Resolved CIMD clients (URL client_id → { clientInfo | undefined, expiresAt }).
  // Kept apart from `clients` so DCR churn can never evict them, and so a
  // stale entry can keep serving while a refresh fails.
  const cimdClients = new Map();

  /**
   * Validate a fetched Client ID Metadata Document and turn it into the
   * client info shape the MCP SDK handlers expect. Returns undefined (after
   * logging why) when the document is unusable.
   */
  function clientInfoFromCimd(clientId, doc, trusted) {
    const reject = (reason) => {
      logger.warn(`OAuth: Rejected CIMD ${clientId}: ${reason}`);
      return undefined;
    };
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
      return reject('document is not a JSON object');
    }
    // The document must claim the URL it was fetched from as its client_id.
    // Trusted (allowlisted) documents may omit it, but must not contradict it.
    if (doc.client_id !== clientId && !(trusted && doc.client_id === undefined)) {
      return reject(`client_id ${JSON.stringify(doc.client_id)} does not match the document URL`);
    }
    const redirectUris = doc.redirect_uris;
    if (!Array.isArray(redirectUris) || redirectUris.length === 0 ||
        !redirectUris.every(u => typeof u === 'string' && URL.canParse(u))) {
      return reject('redirect_uris must be a non-empty array of URLs');
    }
    // A public document cannot hold a secret and we do not support
    // private_key_jwt, so only public clients can identify via CIMD.
    const authMethod = doc.token_endpoint_auth_method ?? 'none';
    if (authMethod !== 'none') {
      return reject(`unsupported token_endpoint_auth_method ${JSON.stringify(authMethod)}`);
    }
    const str = (v) => (typeof v === 'string' ? v : undefined);
    return {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: str(doc.client_name),
      client_uri: str(doc.client_uri),
      redirect_uris: redirectUris,
      grant_types: Array.isArray(doc.grant_types) ? doc.grant_types : ['authorization_code'],
      response_types: Array.isArray(doc.response_types) ? doc.response_types : ['code'],
      token_endpoint_auth_method: 'none',
      scope: str(doc.scope)
    };
  }

  /**
   * Fetch a Client ID Metadata Document. Returns the parsed JSON or undefined.
   */
  async function fetchCimd(clientId) {
    try {
      const res = await fetch(clientId, {
        headers: { Accept: 'application/json', 'User-Agent': 'giantswarm-pro-mcp' },
        redirect: 'manual',
        signal: AbortSignal.timeout(CIMD_FETCH_TIMEOUT_MS)
      });
      if (!res.ok) {
        logger.warn(`OAuth: Failed to fetch CIMD from ${clientId}: ${res.status}`);
        return undefined;
      }
      const declared = Number(res.headers?.get?.('content-length'));
      if (declared > CIMD_MAX_BYTES) {
        logger.warn(`OAuth: Rejected CIMD ${clientId}: content-length ${declared} exceeds ${CIMD_MAX_BYTES} bytes`);
        return undefined;
      }
      const text = await res.text();
      if (text.length > CIMD_MAX_BYTES) {
        logger.warn(`OAuth: Rejected CIMD ${clientId}: body exceeds ${CIMD_MAX_BYTES} bytes`);
        return undefined;
      }
      return JSON.parse(text);
    } catch (err) {
      logger.warn(`OAuth: Error fetching CIMD from ${clientId}: ${err.message}`);
      return undefined;
    }
  }

  /**
   * Resolve a URL client_id (SEP-991) to client info by fetching and
   * validating its Client ID Metadata Document. Results — including failures
   * for untrusted URLs — are cached; a trusted client's last good document
   * keeps being served while a refresh fails. Returns undefined for anything
   * that is not an acceptable CIMD URL or whose document does not validate.
   */
  async function resolveCimdClient(clientId) {
    const trusted = trustedClientIds.includes(clientId);
    if (!trusted && !isCimdUrl(clientId)) {
      return undefined;
    }

    const now = Date.now();
    const cached = cimdClients.get(clientId);
    if (cached && now < cached.expiresAt) {
      return cached.clientInfo;
    }

    const doc = await fetchCimd(clientId);
    let clientInfo = doc === undefined ? undefined : clientInfoFromCimd(clientId, doc, trusted);

    if (clientInfo) {
      logger.info(`OAuth: Resolved CIMD client ${clientId} (${clientInfo.client_name || 'unknown'})`);
    } else if (cached?.clientInfo) {
      // Refresh failed: keep the last good document a little longer rather
      // than locking the client out over a transient upstream problem.
      logger.warn(`OAuth: Keeping previously resolved CIMD client ${clientId} after failed refresh`);
      clientInfo = cached.clientInfo;
    } else if (trusted) {
      // Never negative-cache a trusted client: the next attempt should retry.
      return undefined;
    }

    if (!cimdClients.has(clientId) && cimdClients.size >= MAX_CIMD_CLIENTS) {
      const oldestKey = cimdClients.keys().next().value;
      cimdClients.delete(oldestKey);
    }
    const ttl = clientInfo && clientInfo !== cached?.clientInfo ? CIMD_CACHE_TTL_MS : CIMD_NEGATIVE_CACHE_TTL_MS;
    cimdClients.set(clientId, { clientInfo, expiresAt: now + ttl });
    return clientInfo;
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
          // URL client_ids resolve to their Client ID Metadata Document
          return await resolveCimdClient(clientId);
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
