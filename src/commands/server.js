import express from 'express';
import chalk from 'chalk';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { listItems, updateItemField } from '../lib/items.js';
import { listFields } from '../lib/fields.js';
import { fixTeamField, fixSingleItemTeamField } from '../lib/team-field.js';
import { fixFunctionField } from '../lib/function-field.js';
import { fixKindField, fixSingleItemKindField } from '../lib/kind-field.js';
import { summarizeIssues } from '../lib/summarize.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function serverCommand(options) {
  const app = express();
  const PORT = options.port || 3000;
  
  // Middleware
  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../../public')));
  
  // Keep track of the server instance so we can close it
  let server;
  
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
  
  // List items with optional filtering
  app.get('/api/items', async (req, res) => {
    try {
      const result = await listItems(req.query);
      res.json(result);
    } catch (error) {
      res.status(500).json({ status: 'error', error: error.message });
    }
  });
  
  // List fields (used to get field options)
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
  
  // Fix team field
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
  
  // Fix function field
  app.post('/api/fix-function-field', async (req, res) => {
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
      
      // Team is required for function field suggestions
      if (!options.team) {
        return res.status(400).json({ 
          status: 'error', 
          error: 'Team value is required for function suggestions.' 
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
  
  // Fix kind field
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
      
      // Team is required for kind field suggestions
      if (!options.team) {
        return res.status(400).json({ 
          status: 'error', 
          error: 'Team value is required for kind suggestions.' 
        });
      }
      
      // Use the specialized single-item function which returns more consistent results
      const result = await fixSingleItemKindField(options.itemId, options.team);
      
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
  
  // Apply custom team field value
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
  
  // Apply custom function field value
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
  
  // Apply custom kind field value
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
  
  // Apply a suggestion (after user confirmation)
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
  
  // Summarize issues
  app.post('/api/summarize-issues', async (req, res) => {
    try {
      const analysis = await summarizeIssues(req.body);
      
      // The summarizeIssues function returns the formatted analysis text
      // Format it correctly for the client
      res.json({ 
        status: 'success', 
        data: {
          summary: analysis
        }
      });
    } catch (error) {
      res.status(500).json({ status: 'error', error: error.message });
    }
  });
  
  // Get suggestion for a specific issue field
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
  server = app.listen(PORT, () => {
    console.log(chalk.green(`AI Roadmap Analysis Tool running on http://localhost:${PORT}`));
    console.log(chalk.cyan('Endpoints available:'));
    console.log(chalk.yellow('- GET /api/items - List and filter items'));
    console.log(chalk.yellow('- GET /api/fields - Get field options'));
    console.log(chalk.yellow('- GET /api/suggestions/:issueId/:fieldType - Get field suggestion for an issue (team only)'));
    console.log(chalk.yellow('- POST /api/fix-team-field - Get team field suggestion for an issue'));
    console.log(chalk.yellow('- POST /api/fix-function-field - Get function field suggestion for an issue'));
    console.log(chalk.yellow('- POST /api/fix-kind-field - Get kind field suggestion for an issue'));
    console.log(chalk.yellow('- POST /api/apply-suggestion - Apply suggested field value (with user confirmation)'));
    console.log(chalk.yellow('- POST /api/apply-custom-team - Apply custom team value'));
    console.log(chalk.yellow('- POST /api/apply-custom-function - Apply custom function value'));
    console.log(chalk.yellow('- POST /api/apply-custom-kind - Apply custom kind value'));
    console.log(chalk.yellow('- POST /api/summarize-issues - Analyze issues with AI'));
    console.log(chalk.cyan('\nPress Ctrl+C to stop the server'));
  });
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\nGracefully shutting down server...'));
    
    // Set a timeout to force close after 10 seconds
    const forceCloseTimeout = setTimeout(() => {
      console.log(chalk.red('Server shutdown timed out, forcing exit.'));
      process.exit(1);
    }, 10000);
    
    // Close the server
    server.close(() => {
      console.log(chalk.green('Server shutdown complete.'));
      clearTimeout(forceCloseTimeout);
      process.exit(0);
    });
    
    // For Express servers, we need to handle existing connections
    // This code will destroy idle sockets to allow the server to close
    server.on('connection', socket => {
      socket.on('close', () => {
        // Socket closed
      });
    });
  });
  
  // Return the server instance for testing purposes
  return server;
} 