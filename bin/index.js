#!/usr/bin/env node

/**
 * Giant Swarm PRO MCP Server
 *
 * Starts the MCP server with the selected transport:
 *   --transport=stdio            (default) stdio transport for local AI clients
 *   --transport=streamable-http  HTTP transport for remote/K8s deployment
 *
 * Required environment variables:
 *   - GITHUB_API_TOKEN: GitHub PAT with project:write and repo:write scopes
 *
 * Optional environment variables:
 *   - HTTP_PORT: Port for HTTP transport (default: 8080)
 */

import { startMCPServer } from '../src/lib/mcp/server.js';
import { startHTTPServer } from '../src/lib/mcp/http.js';
import { logger } from '../src/lib/logger.js';
import { tools } from '../src/lib/mcp/tools.js';
import { BOARDS } from '../src/lib/project.js';
import { version } from '../src/lib/version.js';
import { selfUpdate } from '../src/lib/selfupdate.js';

// Handle --self-update flag
if (process.argv.includes('--self-update')) {
  selfUpdate().catch(error => {
    logger.error(`Self-update failed: ${error.message}`);
    process.exit(1);
  });
} else {
  // Parse --transport flag from argv
  const transportArg = process.argv.find(arg => arg.startsWith('--transport='));
  const transport = transportArg ? transportArg.split('=')[1] : 'stdio';

  const boardCount = Object.keys(BOARDS).length;
  const resourceCount = boardCount * 2; // schema + overview per board
  logger.info(`Giant Swarm PRO MCP Server v${version} (${tools.length} tools, ${resourceCount} resources, ${boardCount} boards)`);

  switch (transport) {
    case 'stdio':
      if (!process.env.GITHUB_API_TOKEN) {
        logger.error('GITHUB_API_TOKEN environment variable is required for stdio transport.');
        process.exit(1);
      }
      logger.info('Starting with stdio transport');
      startMCPServer().catch(error => {
        logger.error(`Failed to start MCP server: ${error.message}`);
        process.exit(1);
      });
      break;

    case 'streamable-http':
      logger.info('Starting with streamable HTTP transport');
      startHTTPServer().catch(error => {
        logger.error(`Failed to start HTTP server: ${error.message}`);
        process.exit(1);
      });
      break;

    default:
      logger.error(`Unknown transport: ${transport}. Use 'stdio' or 'streamable-http'.`);
      process.exit(1);
  }
}
