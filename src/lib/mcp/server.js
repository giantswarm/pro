/**
 * MCP Server Implementation
 *
 * WHY:
 * - Provides a Model Context Protocol server for AI assistant integration
 * - Enables AI-powered interaction with Giant Swarm project boards
 * - Allows conversational access to all roadmap management features
 *
 * HOW:
 * - Uses @modelcontextprotocol/sdk to implement MCP server
 * - Exposes tools and resources for AI consumption
 * - Runs as a stdio server for integration with AI assistants
 *
 * WHAT:
 * - Exports createMCPServer function to initialize the server
 * - Registers all tools and resources
 * - Handles tool calls and resource requests
 * - Provides error handling and logging
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

import { tools, toolHandlers } from './tools.js';
import { listResources, readResource } from './resources.js';
import { logger } from '../logger.js';
import { version } from '../version.js';

/**
 * Create and configure the MCP server
 * @returns {Server} - Configured MCP server instance
 */
export function createMCPServer() {
  const server = new Server(
    {
      name: 'giantswarm-pro',
      version
    },
    {
      capabilities: {
        tools: {},
        resources: {}
      }
    }
  );

  /**
   * Handler: list_tools
   * Returns the list of available tools
   */
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Routine operation - no logging needed
    return { tools };
  });

  /**
   * Handler: call_tool
   * Executes a requested tool
   */
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;

    // Only log tool name, not full args (reduces noise)
    logger.info(`MCP: Tool called: ${name}`);

    const handler = toolHandlers[name];

    if (!handler) {
      logger.error('MCP: Unknown tool', { tool: name });
      throw new Error(`Unknown tool: ${name}`);
    }

    try {
      const result = await handler(args || {}, extra);

      // If result has an error, throw it
      if (result.error) {
        throw new Error(result.error);
      }

      return result;
    } catch (error) {
      logger.error('MCP: Tool execution error', {
        tool: name,
        error: error.message
      });

      return {
        content: [{
          type: 'text',
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  });

  /**
   * Handler: list_resources
   * Returns the list of available resources
   */
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    // Routine operation - no logging needed
    return await listResources();
  });

  /**
   * Handler: read_resource
   * Reads a specific resource
   */
  server.setRequestHandler(ReadResourceRequestSchema, async (request, extra) => {
    const { uri } = request.params;

    logger.info(`MCP: Reading resource: ${uri}`);

    try {
      return await readResource(uri, extra);
    } catch (error) {
      logger.error('MCP: Resource read error', {
        uri,
        error: error.message
      });

      throw error;
    }
  });

  return server;
}

/**
 * Start the MCP server with stdio transport
 */
export async function startMCPServer() {
  const server = createMCPServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Handle process termination
  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.close();
    process.exit(0);
  });
}
