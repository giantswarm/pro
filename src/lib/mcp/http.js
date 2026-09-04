/**
 * Streamable HTTP Transport for MCP Server
 *
 * Provides an Express-based HTTP server that exposes the MCP protocol via the
 * Streamable HTTP transport specification. Used for remote/K8s deployment.
 *
 * When both GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET are set,
 * enables OAuth 2.1 authentication:
 *   - MCP clients must authenticate via GitHub OAuth before using tools
 *   - OAuth endpoints: /authorize, /token, /register, /.well-known/*
 *   - GitHub callback: /github/callback
 *
 * When OAUTH_BEARER_ONLY=true (and no GitHub OAuth App is configured), the
 * server is a resource server only: every MCP request must carry a GitHub
 * token as bearer, which is verified against the GitHub API and used for that
 * request's GitHub calls. The token is obtained elsewhere -- muster's GitHub
 * connector holds the person's grant -- so no /authorize, /token or /register
 * exist; RFC 9728 protected resource metadata names GitHub as the
 * authorization server.
 *
 * When none of the above is set, runs without auth (env var token mode).
 *
 * Each client session gets its own transport and MCP server instance,
 * following the recommended pattern from the MCP SDK.
 *
 * Endpoints:
 *   POST/GET/DELETE /mcp  - MCP streamable HTTP endpoint (auth required when OAuth or bearer-only auth is enabled)
 *   GET /healthz           - Liveness probe (always 200)
 *   GET /readyz            - Readiness probe (200 when server is connected)
 */

import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMCPServer } from './server.js';
import { logger } from '../logger.js';
import { randomUUID } from 'crypto';

const DEFAULT_PORT = 8080;
const DEFAULT_ENDPOINT = '/mcp';
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const SESSION_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // sweep every 5 minutes

let serverReady = false;

// Map of session ID -> { transport, lastActivity }
const sessions = {};

/**
 * Start the MCP server with streamable HTTP transport
 * @param {Object} options
 * @param {number} options.port - Port to listen on (default: 8080; 0 picks a free port)
 * @param {string} options.endpoint - MCP endpoint path (default: /mcp)
 * @returns {Promise<import('http').Server>} the listening server
 */
export async function startHTTPServer(options = {}) {
  const port = options.port ?? (parseInt(process.env.HTTP_PORT, 10) || DEFAULT_PORT);
  const endpoint = options.endpoint || DEFAULT_ENDPOINT;

  const app = express();
  // Trust exactly 1 proxy hop (Envoy Gateway). express-rate-limit requires
  // a specific number rather than `true` to prevent IP spoofing.
  app.set('trust proxy', 1);
  app.use(express.json());

  // ---------------------------------------------------------------------------
  // OAuth 2.1 setup (when GITHUB_OAUTH_CLIENT_ID is configured)
  // ---------------------------------------------------------------------------
  const oauthClientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const oauthClientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  let bearerAuthMiddleware = null;

  if (oauthClientId && oauthClientSecret) {
    const { mcpAuthRouter, createOAuthMetadata } = await import('@modelcontextprotocol/sdk/server/auth/router.js');
    const { metadataHandler } = await import('@modelcontextprotocol/sdk/server/auth/handlers/metadata.js');
    const { requireBearerAuth } = await import('@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js');
    const { createGitHubOAuthProvider } = await import('../auth/provider.js');

    const issuerUrl = new URL(process.env.OAUTH_ISSUER_URL || `http://localhost:${port}`);

    const { provider, handleGitHubCallback } = createGitHubOAuthProvider({
      clientId: oauthClientId,
      clientSecret: oauthClientSecret
    });

    const authRouterOptions = {
      provider,
      issuerUrl,
      scopesSupported: ['repo', 'project', 'read:org'],
      resourceName: 'Giant Swarm PRO MCP Server'
    };

    // RFC 8414 authorization server metadata. mcpAuthRouter builds this same
    // document internally but offers no way to extend it, so build it here,
    // add the SEP-991 flag and mount the well-known route before the router:
    // Express dispatches in registration order, so this copy wins over the
    // router's own.
    const oauthMetadata = {
      ...createOAuthMetadata(authRouterOptions),
      // Clients may use the HTTPS URL of their Client ID Metadata Document as
      // client_id instead of registering (resolved in clientsStore.getClient).
      // Muster and Claude Code pick this path only when it is advertised; it
      // is what lets them survive a restart of this in-memory client store.
      client_id_metadata_document_supported: true
    };
    app.use('/.well-known/oauth-authorization-server', metadataHandler(oauthMetadata));

    // Mount OAuth routes: /authorize, /token, /register, /.well-known/*
    app.use(mcpAuthRouter(authRouterOptions));

    // GitHub OAuth callback (not part of MCP spec — specific to our proxy)
    app.get('/github/callback', handleGitHubCallback);

    // Bearer auth middleware for the MCP endpoint
    bearerAuthMiddleware = requireBearerAuth({ verifier: provider });

    logger.info('OAuth 2.1 enabled — MCP clients must authenticate via GitHub');
  } else if (process.env.OAUTH_BEARER_ONLY === 'true') {
    const { requireBearerAuth } = await import('@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js');
    const { metadataHandler } = await import('@modelcontextprotocol/sdk/server/auth/handlers/metadata.js');
    const { createGitHubTokenVerifier, GITHUB_AUTHORIZATION_SERVER } = await import('../auth/provider.js');

    // The public URL doubles as the resource identifier's origin.
    const publicUrl = new URL(process.env.OAUTH_ISSUER_URL || `http://localhost:${port}`);
    const resourceUrl = new URL(endpoint, publicUrl);
    const protectedResourceMetadata = {
      resource: resourceUrl.href,
      authorization_servers: [GITHUB_AUTHORIZATION_SERVER],
      scopes_supported: ['repo', 'project', 'read:org'],
      bearer_methods_supported: ['header'],
      resource_name: 'Giant Swarm PRO MCP Server'
    };
    // RFC 9728: path-specific document first (what the WWW-Authenticate
    // challenge points at), root document as the fallback clients probe.
    const metadataPath = `/.well-known/oauth-protected-resource${endpoint}`;
    app.use(metadataPath, metadataHandler(protectedResourceMetadata));
    app.use('/.well-known/oauth-protected-resource', metadataHandler(protectedResourceMetadata));

    bearerAuthMiddleware = requireBearerAuth({
      verifier: createGitHubTokenVerifier(),
      resourceMetadataUrl: new URL(metadataPath, publicUrl).href
    });

    logger.info('Bearer-only auth enabled — MCP clients present GitHub tokens obtained elsewhere; no authorization server is run');
  } else {
    logger.info('OAuth not configured — using GITHUB_API_TOKEN for all requests');
  }

  // ---------------------------------------------------------------------------
  // Health probes (no auth required)
  // ---------------------------------------------------------------------------

  // Health check: liveness (no auth required)
  app.get('/healthz', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Health check: readiness (no auth required)
  app.get('/readyz', (req, res) => {
    if (serverReady) {
      res.json({ status: 'ready' });
    } else {
      res.status(503).json({ status: 'not ready' });
    }
  });

  // ---------------------------------------------------------------------------
  // MCP endpoint
  // ---------------------------------------------------------------------------

  // MCP endpoint — handles POST, GET (SSE), and DELETE (session teardown)
  // When OAuth is enabled, Bearer auth is required
  if (bearerAuthMiddleware) {
    app.all(endpoint, bearerAuthMiddleware);
  }

  app.all(endpoint, async (req, res) => {
    try {
      // Look up existing session
      const sessionId = req.headers['mcp-session-id'];
      let transport;

      if (sessionId && sessions[sessionId]) {
        // Reuse existing transport for this session
        sessions[sessionId].lastActivity = Date.now();
        transport = sessions[sessionId].transport;
      } else if (req.method === 'POST' && !sessionId && isInitializeRequest(req.body)) {
        // New initialization request — create a new transport and server
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            logger.info(`Session initialized: ${id}`);
            sessions[id] = { transport, lastActivity: Date.now() };
          }
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && sessions[sid]) {
            logger.info(`Session closed: ${sid}`);
            delete sessions[sid];
          }
        };

        const mcpServer = createMCPServer();
        await mcpServer.connect(transport);

        await transport.handleRequest(req, res, req.body);
        return;
      } else if (sessionId) {
        // Session ID provided but not found — expired or invalid
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Session not found or expired'
          },
          id: null
        });
        return;
      } else {
        // No session ID and not an initialize request
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: missing session ID or not an initialize request'
          },
          id: null
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error(`HTTP transport error: ${err.message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });

  serverReady = true;

  // Periodic sweep to evict idle sessions
  const sweepInterval = setInterval(() => {
    const now = Date.now();
    for (const sessionId in sessions) {
      if (now - sessions[sessionId].lastActivity > SESSION_TTL_MS) {
        logger.info(`Evicting idle session: ${sessionId}`);
        try {
          sessions[sessionId].transport.close();
        } catch (err) {
          logger.error(`Error closing idle session ${sessionId}: ${err.message}`);
        }
        delete sessions[sessionId];
      }
    }
  }, SESSION_SWEEP_INTERVAL_MS);
  sweepInterval.unref();

  // Start listening
  const httpServer = await new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      logger.info(`MCP HTTP server listening on port ${server.address().port} (endpoint: ${endpoint})`);
      resolve(server);
    });
    server.once('error', reject);
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down HTTP server...');
    serverReady = false;
    clearInterval(sweepInterval);
    for (const sessionId in sessions) {
      try {
        await sessions[sessionId].transport.close();
        delete sessions[sessionId];
      } catch (err) {
        logger.error(`Error closing session ${sessionId}: ${err.message}`);
      }
    }
    httpServer.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return httpServer;
}
