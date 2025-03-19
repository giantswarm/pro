/**
 * Web Server Command Module
 * 
 * WHY:
 * - Need to provide web-based access to roadmap management functionality
 * - CLI interface is powerful but not accessible to all stakeholders
 * - Web interfaces enable broader participation in roadmap management
 * - Enable integration with other web-based systems and dashboards
 * 
 * HOW:
 * - Implements an Express server with REST API endpoints
 * - Serves static files for a web UI from the public directory
 * - Wraps core library functions in API endpoints for client access
 * - Provides error handling and graceful shutdown capabilities
 * 
 * WHAT:
 * - Exports a command handler function for the server command
 * - Creates REST API endpoints for all major functions (list-items, list-fields, fix-team-field, etc.)
 * - Serves a web-based UI for roadmap management
 * - Handles CORS, request parsing, error handling, and process management
 * - Configurable port via command options
 */

import express from 'express';
import chalk from 'chalk';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import http from 'http';
import { listItems, updateItemField } from '../lib/items.js';
import { listFields } from '../lib/fields.js';
import { fixTeamField } from '../lib/team-field.js';
import { fixFunctionField } from '../lib/function-field.js';
import { fixKindField } from '../lib/kind-field.js';
import { summarizeIssues } from '../lib/summarize.js';
import { addLogClient, logger, closeAllConnections } from '../lib/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * CLI command handler for starting the web server
 * 
 * WHY:
 * - Need a command handler that starts the web server with proper configuration
 * - Web server requires exception handling, middleware setup, and API endpoints
 * 
 * HOW:
 * - Creates an Express application with middleware and routes
 * - Configures API endpoints for all core roadmap management functions
 * - Sets up error handling and process management
 * - Serves static web UI files from the public directory
 * 
 * @param {Object} options - Server options (e.g., port)
 * @param {number} options.port - The port to run the server on (default: 3000)
 * @returns {Promise<void>} - Resolves when the server is running
 */
export async function serverCommand(options) {
  const app = express();
  const PORT = options.port || 3000;
  
  // Create HTTP server for Express and WebSocket to share
  const server = http.createServer(app);
  
  // Set up WebSocket server
  const wss = new WebSocketServer({ server });
  
  // Handle new WebSocket connections
  wss.on('connection', (ws, req) => {
    logger.info('WebSocket client connected', { source: 'websocket' });
    
    // Register client to receive logs
    addLogClient(ws);
    
    // Handle client messages
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        logger.debug(`Received message: ${data.type}`, { source: 'websocket' });
        
        // Handle different message types if needed
      } catch (error) {
        logger.error(`Error processing WebSocket message: ${error.message}`, { source: 'websocket' });
      }
    });
    
    // Handle client disconnection
    ws.on('close', () => {
      logger.info('WebSocket client disconnected', { source: 'websocket' });
    });
    
    // Handle errors
    ws.on('error', (error) => {
      logger.error(`WebSocket error: ${error.message}`, { source: 'websocket' });
    });
  });
  
  // Middleware
  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../../public')));
  
  // Keep track of the server instance so we can close it
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error(chalk.red('Uncaught Exception:'), error);
    if (server) {
      console.log(chalk.yellow('Shutting down due to uncaught exception...'));
      server.close(() => {
        process.exit(1);
      });
      
      // Force exit if closing takes too long
      setTimeout(() => {
        process.exit(1);
      }, 5000);
    } else {
      process.exit(1);
    }
  });
  
  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    console.error(chalk.red('Unhandled Promise Rejection:'), reason);
    // We don't exit the process here, but log it for awareness
  });
  
  // API Endpoints
  
  /**
   * GET /api/items - List and filter roadmap items
   * 
   * WHY:
   * - Web UI needs to retrieve and display roadmap items
   * - Filtering capabilities are needed to narrow down displayed items
   * 
   * PARAMETERS:
   * - team (optional): Filter items by team name
   * - function (optional): Filter items by function category
   * - kind (optional): Filter items by kind category
   * - status (optional): Filter items by status
   * - noTeam (optional): If "true", only show items with no team assigned
   * 
   * RESPONSE:
   * - status: "success" or "error"
   * - data: Array of items with their field values
   * - error: Error message (if status is "error")
   */
  app.get('/api/items', async (req, res) => {
    try {
      const result = await listItems(req.query);
      res.json(result);
    } catch (error) {
      res.status(500).json({ status: 'error', error: error.message });
    }
  });
  
  /**
   * GET /api/fields - Get all field options for the roadmap board
   * 
   * WHY:
   * - Web UI needs to know all available field options for dropdowns
   * - Field IDs are required for updating field values
   * 
   * PARAMETERS:
   * - None
   * 
   * RESPONSE:
   * - status: "success" or "error"
   * - data: Object containing formatted field options:
   *   - teams: Array of team options
   *   - functions: Array of function options
   *   - kinds: Array of kind options
   *   - statuses: Array of status options
   *   - sigs: Array of SIG options
   *   - wgs: Array of working group options
   *   - fieldTypes: Array of field type objects
   * - error: Error message (if status is "error")
   */
  app.get('/api/fields', async (req, res) => {
    try {
      const fields = await listFields(true); // Pass true to return instead of console.log
      
      // Format the fields data for the client
      const formattedFields = {
        teams: [],
        functions: [],
        kinds: [],
        statuses: [],
        sigs: [],
        wgs: [],
        fieldTypes: [
          { value: 'team', text: 'Team' },
          { value: 'function', text: 'Function' },
          { value: 'kind', text: 'Kind' }
        ]
      };
      
      // Extract options for each field
      const fieldExtractors = {
        team: 'teams',
        function: 'functions',
        kind: 'kinds',
        status: 'statuses',
        sig: 'sigs',
        'working group': 'wgs'
      };
      
      // Process each field
      Object.entries(fieldExtractors).forEach(([fieldName, arrayName]) => {
        const field = fields.find(field => 
          field.__typename === 'ProjectV2SingleSelectField' && 
          field.name.toLowerCase() === fieldName
        );
        
        if (field && field.options) {
          formattedFields[arrayName] = field.options.map(option => ({
            id: option.id,
            fieldId: field.id,
            value: option.name,
            text: option.name
          }));
          
          // Add "no value" option only for team field
          if (fieldName === 'team') {
            formattedFields[arrayName].push({ 
              value: 'no-team', 
              text: 'No Team Assigned',
              id: null,
              fieldId: field.id
            });
          }
        }
      });
      
      res.json({ status: 'success', data: formattedFields });
    } catch (error) {
      res.status(500).json({ status: 'error', error: error.message });
    }
  });
  
  /**
   * POST /api/fix-team-field - Get team field suggestion for an issue
   * 
   * WHY:
   * - Web UI needs to get AI-powered team suggestions
   * - Suggestions need to be reviewed before being applied
   * 
   * PARAMETERS:
   * - itemId (required): The ID of the project item/issue
   * 
   * RESPONSE:
   * - status: "success" or "error"
   * - data: Object containing:
   *   - suggestion: The suggested team name
   *   - optionId: The ID of the suggested team option
   *   - fieldId: The ID of the team field
   * - error: Error message (if status is "error")
   */
  app.post('/api/fix-team-field', async (req, res) => {
    try {
      const itemId = req.body.itemId;
      const result = await fixTeamField({ itemId }, true);
      // Now the result contains the suggestion but doesn't apply it
      res.json({ status: 'success', data: result });
    } catch (error) {
      res.status(500).json({ status: 'error', error: error.message });
    }
  });
  
  /**
   * POST /api/fix-function-field - Get function field suggestion for an issue
   * 
   * WHY:
   * - Web UI needs to get AI-powered function suggestions
   * - Suggestions need to be reviewed before being applied
   * 
   * PARAMETERS:
   * - itemId (required): The ID of the project item/issue
   * 
   * RESPONSE:
   * - status: "success" or "error"
   * - data: Object containing:
   *   - suggestion: The suggested function name
   *   - optionId: The ID of the suggested function option
   *   - fieldId: The ID of the function field
   * - error: Error message (if status is "error")
   */
  app.post('/api/fix-function-field', async (req, res) => {
    try {
      const options = {
        itemId: req.body.itemId
      };
      
      // Validate required parameters
      if (!options.itemId) {
        return res.status(400).json({ 
          status: 'error', 
          error: 'Missing required parameter: itemId' 
        });
      }
      
      const result = await fixFunctionField(options, true);
      
      // Format response to ensure consistency
      if (result && (result.status === 'success' || !result.status)) {
        return res.json({ 
          status: 'success', 
          data: {
            suggestion: result.suggestion || result.data?.suggestion,
            optionId: result.optionId || result.data?.optionId,
            fieldId: result.fieldId || result.data?.fieldId
          }
        });
      }
      
      // Pass through any error responses
      res.json(result);
    } catch (error) {
      res.status(500).json({ status: 'error', error: error.message });
    }
  });
  
  /**
   * POST /api/fix-kind-field - Get kind field suggestion for an issue
   * 
   * WHY:
   * - Web UI needs to get AI-powered kind suggestions
   * - Suggestions need to be reviewed before being applied
   * 
   * PARAMETERS:
   * - itemId (required): The ID of the project item/issue
   * - team (optional): The team value to use for context
   * 
   * RESPONSE:
   * - status: "success" or "error"
   * - data: Object containing:
   *   - suggestion: The suggested kind name
   *   - optionId: The ID of the suggested kind option
   *   - fieldId: The ID of the kind field
   * - error: Error message (if status is "error")
   */
  app.post('/api/fix-kind-field', async (req, res) => {
    try {
      const options = {
        itemId: req.body.itemId,
        team: req.body.team
      };
      
      // Validate required parameters
      if (!options.itemId) {
        return res.status(400).json({ 
          status: 'error', 
          error: 'Missing required parameter: itemId' 
        });
      }
            
      // Use the specialized single-item function which returns more consistent results
      const result = await fixKindField(options, true);
      
      // Format response to ensure consistency
      if (result && (result.status === 'success' || !result.status)) {
        return res.json({ 
          status: 'success', 
          data: {
            suggestion: result.suggestion || result.data?.suggestion,
            optionId: result.optionId || result.data?.optionId,
            fieldId: result.fieldId || result.data?.fieldId
          }
        });
      }
      
      // Pass through any error responses
      res.json(result);
    } catch (error) {
      res.status(500).json({ status: 'error', error: error.message });
    }
  });
  
  /**
   * POST /api/apply-custom-team - Apply a custom team value to an issue
   * 
   * WHY:
   * - Users need to manually select teams for issues
   * - Web UI needs a way to apply these selections
   * 
   * PARAMETERS:
   * - itemId (required): The ID of the project item/issue
   * - customValue (required): The team name to apply
   * 
   * RESPONSE:
   * - status: "success" or "error"
   * - data: Object containing:
   *   - updated: true if the update was successful
   *   - message: Success message
   * - error: Error message (if status is "error")
   */
  app.post('/api/apply-custom-team', async (req, res) => {
    try {
      const { itemId, customValue } = req.body;
      
      // Validate required parameters
      if (!itemId || !customValue) {
        return res.status(400).json({ 
          status: 'error', 
          error: 'Missing required fields (itemId, customValue)' 
        });
      }
      
      console.log(`Applying custom team value: itemId=${itemId}, value=${customValue}`);
      
      // Need to find the team field and appropriate option ID
      const fields = await listFields(true); // Get fields from GitHub
      
      // Find the team field
      const teamField = fields.find(field => 
        field.__typename === 'ProjectV2SingleSelectField' && 
        field.name.toLowerCase() === 'team'
      );
      
      if (!teamField) {
        return res.status(404).json({
          status: 'error',
          error: 'Team field not found in project'
        });
      }
      
      // Find the option that matches the custom value
      const option = teamField.options.find(opt => 
        opt.name.toLowerCase() === customValue.toLowerCase()
      );
      
      if (!option) {
        return res.status(404).json({
          status: 'error',
          error: `Team value "${customValue}" not found in available options`
        });
      }
      
      // Call updateItemField with the correct parameters
      const result = await updateItemField(itemId, teamField.id, option.id);
      
      if (result.errors && result.errors.length > 0) {
        return res.status(400).json({ 
          status: 'error', 
          error: result.errors[0].message || 'Error updating team field in GitHub' 
        });
      }
      
      return res.json({ 
        status: 'success', 
        data: {
          updated: true,
          message: 'Team field updated successfully'
        }
      });
    } catch (error) {
      console.error('Error applying custom team value:', error);
      res.status(500).json({ status: 'error', error: error.message });
    }
  });
  
  /**
   * POST /api/apply-custom-function - Apply a custom function value to an issue
   * 
   * WHY:
   * - Users need to manually select function values for issues
   * - Web UI needs a way to apply these selections
   * 
   * PARAMETERS:
   * - itemId (required): The ID of the project item/issue
   * - customValue (required): The function name to apply
   * 
   * RESPONSE:
   * - status: "success" or "error"
   * - data: Object containing:
   *   - updated: true if the update was successful
   *   - message: Success message
   * - error: Error message (if status is "error")
   */
  app.post('/api/apply-custom-function', async (req, res) => {
    try {
      const { itemId, customValue } = req.body;
      
      // Validate required parameters
      if (!itemId || !customValue) {
        return res.status(400).json({ 
          status: 'error', 
          error: 'Missing required fields (itemId, customValue)' 
        });
      }
      
      console.log(`Applying custom function value: itemId=${itemId}, value=${customValue}`);
      
      // Need to find the function field and appropriate option ID
      const fields = await listFields(true); // Get fields from GitHub
      
      // Find the function field
      const functionField = fields.find(field => 
        field.__typename === 'ProjectV2SingleSelectField' && 
        field.name.toLowerCase() === 'function'
      );
      
      if (!functionField) {
        return res.status(404).json({
          status: 'error',
          error: 'Function field not found in project'
        });
      }
      
      // Find the option that matches the custom value
      const option = functionField.options.find(opt => 
        opt.name.toLowerCase() === customValue.toLowerCase()
      );
      
      if (!option) {
        return res.status(404).json({
          status: 'error',
          error: `Function value "${customValue}" not found in available options`
        });
      }
      
      // Call updateItemField with the correct parameters
      const result = await updateItemField(itemId, functionField.id, option.id);
      
      if (result.errors && result.errors.length > 0) {
        return res.status(400).json({ 
          status: 'error', 
          error: result.errors[0].message || 'Error updating function field in GitHub' 
        });
      }
      
      return res.json({ 
        status: 'success', 
        data: {
          updated: true,
          message: 'Function field updated successfully'
        }
      });
    } catch (error) {
      console.error('Error applying custom function value:', error);
      res.status(500).json({ status: 'error', error: error.message });
    }
  });
  
  /**
   * POST /api/apply-custom-kind - Apply a custom kind value to an issue
   * 
   * WHY:
   * - Users need to manually select kind values for issues
   * - Web UI needs a way to apply these selections
   * 
   * PARAMETERS:
   * - itemId (required): The ID of the project item/issue
   * - customValue (required): The kind name to apply
   * 
   * RESPONSE:
   * - status: "success" or "error"
   * - data: Object containing:
   *   - updated: true if the update was successful
   *   - message: Success message
   * - error: Error message (if status is "error")
   */
  app.post('/api/apply-custom-kind', async (req, res) => {
    try {
      const { itemId, customValue } = req.body;
      
      // Validate required parameters
      if (!itemId || !customValue) {
        return res.status(400).json({ 
          status: 'error', 
          error: 'Missing required fields (itemId, customValue)' 
        });
      }
      
      console.log(`Applying custom kind value: itemId=${itemId}, value=${customValue}`);
      
      // Need to find the kind field and appropriate option ID
      const fields = await listFields(true); // Get fields from GitHub
      
      // Find the kind field
      const kindField = fields.find(field => 
        field.__typename === 'ProjectV2SingleSelectField' && 
        field.name.toLowerCase() === 'kind'
      );
      
      if (!kindField) {
        return res.status(404).json({
          status: 'error',
          error: 'Kind field not found in project'
        });
      }
      
      // Find the option that matches the custom value
      const option = kindField.options.find(opt => 
        opt.name.toLowerCase() === customValue.toLowerCase()
      );
      
      if (!option) {
        return res.status(404).json({
          status: 'error',
          error: `Kind value "${customValue}" not found in available options`
        });
      }
      
      // Call updateItemField with the correct parameters
      const result = await updateItemField(itemId, kindField.id, option.id);
      
      if (result.errors && result.errors.length > 0) {
        return res.status(400).json({ 
          status: 'error', 
          error: result.errors[0].message || 'Error updating kind field in GitHub' 
        });
      }
      
      return res.json({ 
        status: 'success', 
        data: {
          updated: true,
          message: 'Kind field updated successfully'
        }
      });
    } catch (error) {
      console.error('Error applying custom kind value:', error);
      res.status(500).json({ status: 'error', error: error.message });
    }
  });
  
  /**
   * POST /api/apply-suggestion - Apply a suggested field value with user confirmation
   * 
   * WHY:
   * - Users need to apply AI-suggested field values after review
   * - Web UI needs a way to confirm and apply these suggestions
   * 
   * PARAMETERS:
   * - itemId (required): The ID of the project item/issue
   * - fieldId (required): The ID of the field to update
   * - optionId (required): The ID of the selected option value
   * 
   * RESPONSE:
   * - status: "success" or "error"
   * - data: Object containing:
   *   - updated: true if the update was successful
   *   - message: Success message
   * - error: Error message (if status is "error")
   */
  app.post('/api/apply-suggestion', async (req, res) => {
    try {
      const { itemId, fieldId, optionId } = req.body;
      
      // Validate required parameters
      if (!itemId || !fieldId || !optionId) {
        return res.status(400).json({ 
          status: 'error', 
          error: 'Missing required fields (itemId, fieldId, optionId)' 
        });
      }
      
      console.log(`Applying suggestion: itemId=${itemId}, fieldId=${fieldId}, optionId=${optionId}`);
      
      // Call the updateItemField function with the correct parameters
      const result = await updateItemField(itemId, fieldId, optionId);
      
      console.log('GitHub API response:', result);
      
      if (result.errors && result.errors.length > 0) {
        return res.status(400).json({ 
          status: 'error', 
          error: result.errors[0].message || 'Error updating field in GitHub' 
        });
      }
      
      return res.json({ 
        status: 'success', 
        data: {
          updated: true,
          message: 'Field updated successfully'
        }
      });
    } catch (error) {
      console.error('Error applying suggestion:', error);
      res.status(500).json({ status: 'error', error: error.message });
    }
  });
  
  /**
   * POST /api/summarize-issues - Generate AI analysis of roadmap issues
   * 
   * WHY:
   * - Users need insights and patterns across many roadmap issues
   * - Manual analysis is time-consuming and may miss important connections
   * - AI can identify themes, dependencies, and priorities
   * 
   * PARAMETERS:
   * - team (optional): Filter issues by team name
   * - function (optional): Filter issues by function category
   * - kind (optional): Filter issues by kind category
   * - status (optional): Filter issues by status
   * 
   * RESPONSE:
   * - status: "success" or "error"
   * - data: Object containing:
   *   - summary: The AI-generated summary text
   * - error: Error message (if status is "error")
   */
  app.post('/api/summarize-issues', async (req, res) => {
    try {
      // Log the request
      logger.info('Starting AI analysis of issues', { 
        filters: req.body,
        source: 'summarize-issues'
      });
      
      const analysis = await summarizeIssues(req.body);
      
      logger.success('AI analysis completed successfully', { source: 'summarize-issues' });
      
      // Format it correctly for the client
      res.json({ 
        status: 'success', 
        data: {
          summary: analysis
        }
      });
    } catch (error) {
      logger.error(`Error generating AI analysis: ${error.message}`, { 
        source: 'summarize-issues',
        stack: error.stack
      });
      
      res.status(500).json({ status: 'error', error: error.message });
    }
  });
  
  /**
   * GET /api/suggestions/:issueId/:fieldType - Get field suggestion for a specific issue
   * 
   * WHY:
   * - Web UI needs to get field suggestions in a RESTful way
   * - Team suggestions can be retrieved without additional context
   * 
   * PARAMETERS:
   * - issueId (required): ID of the issue to get suggestions for
   * - fieldType (required): Type of field (team, function, kind)
   * 
   * RESPONSE:
   * - status: "success" or "error"
   * - data: Object containing:
   *   - suggestion: The suggested field value
   *   - optionId: The ID of the suggested option
   *   - fieldId: The ID of the field
   * - error: Error message (if status is "error")
   * 
   * NOTE:
   * - This endpoint only supports team field currently
   * - For function and kind fields, use their respective POST endpoints
   */
  app.get('/api/suggestions/:issueId/:fieldType', async (req, res) => {
    try {
      const { issueId, fieldType } = req.params;
      
      if (!issueId || !fieldType) {
        return res.status(400).json({ status: 'error', error: 'Missing required parameters' });
      }
      
      let result;
      
      switch (fieldType.toLowerCase()) {
        case 'team':
          // Use the specialized function for team suggestions
          result = await fixSingleItemTeamField(issueId);
          break;
        case 'function':
          // For function field, we need team value but it's not available from the URL params
          // Return appropriate error message with more helpful instructions
          return res.status(400).json({ 
            status: 'error', 
            error: 'Team value is required for function suggestions. Use POST /api/fix-function-field endpoint instead.' 
          });
        case 'kind':
          // For kind field, we need team value but it's not available from the URL params
          // Return appropriate error message with more helpful instructions
          return res.status(400).json({ 
            status: 'error', 
            error: 'Team value is required for kind suggestions. Use POST /api/fix-kind-field endpoint instead.' 
          });
        default:
          return res.status(400).json({ status: 'error', error: `Unsupported field type: ${fieldType}` });
      }
      
      // Ensure uniform response format
      if (result && (!result.status || result.status === 'success')) {
        return res.json({ 
          status: 'success', 
          data: {
            suggestion: result.suggestion || result.data?.suggestion,
            optionId: result.optionId || result.data?.optionId,
            fieldId: result.fieldId || result.data?.fieldId
          }
        });
      }
      
      // Pass through any error responses
      res.json(result);
    } catch (error) {
      res.status(500).json({ status: 'error', error: error.message });
    }
  });
  
  // Serve index.html for all other routes (SPA)
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/index.html'));
  });
  
  // Start server
  server.listen(PORT, () => {
    logger.info(`AI Roadmap Analysis Tool running on http://localhost:${PORT}`);
    logger.info('Endpoints available:');
    logger.info('- GET /api/items - List and filter items');
    logger.info('- GET /api/fields - Get field options');
    logger.info('- GET /api/suggestions/:issueId/:fieldType - Get field suggestion for an issue (team only)');
    logger.info('- POST /api/fix-team-field - Get team field suggestion for an issue');
    logger.info('- POST /api/fix-function-field - Get function field suggestion for an issue');
    logger.info('- POST /api/fix-kind-field - Get kind field suggestion for an issue');
    logger.info('- POST /api/apply-suggestion - Apply suggested field value (with user confirmation)');
    logger.info('- POST /api/apply-custom-team - Apply custom team value');
    logger.info('- POST /api/apply-custom-function - Apply custom function value');
    logger.info('- POST /api/apply-custom-kind - Apply custom kind value');
    logger.info('- POST /api/summarize-issues - Analyze issues with AI');
    logger.info('\nPress Ctrl+C to stop the server');
  });
  
  // Handle process signals for graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT signal. Shutting down server...');
    
    try {
      // Close WebSocket connections first
      const closedConnections = closeAllConnections();
      logger.info(`Closed ${closedConnections} WebSocket connections`);
      
      // Then close the HTTP server
      if (server) {
        server.close(() => {
          logger.info('Server shut down successfully');
          process.exit(0);
        });
        
        // Force exit after timeout in case connections are hanging
        setTimeout(() => {
          logger.warn('Forcing server shutdown after timeout');
          process.exit(1);
        }, 5000);
      } else {
        process.exit(0);
      }
    } catch (error) {
      logger.error(`Error during shutdown: ${error.message}`);
      process.exit(1);
    }
  });
  
  // Return the server instance for testing purposes
  return server;
} 