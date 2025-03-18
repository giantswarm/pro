import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import ora from 'ora';
import { v4 as uuidv4 } from 'uuid';
import { fixFunctionFieldCommand } from './fix-function-field.js';
import { fixKindFieldCommand } from './fix-kind-field.js';
import { summarizeIssuesCommand } from './summarize-issues.js';
import { listItemsCommand } from './list-items.js';
import { listCommand } from './list.js';
import { listFieldsCommand } from './list-fields.js';
import { showFieldCommand } from './show-field.js';
import { fixTeamFieldCommand } from './fix-team-field.js';

// Create __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Function to intercept console.log calls and redirect them to a custom handler
 */
function captureConsoleOutput(callback) {
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleCyan = chalk.cyan;
  const originalConsoleGreen = chalk.green;
  const originalConsoleYellow = chalk.yellow;
  const originalConsoleRed = chalk.red;
  const originalConsoleBlue = chalk.blue;

  const messages = [];

  // Override console methods to capture output
  console.log = (...args) => {
    messages.push({ type: 'log', message: args.join(' ') });
  };
  console.error = (...args) => {
    messages.push({ type: 'error', message: args.join(' ') });
  };
  chalk.cyan = (text) => {
    messages.push({ type: 'info', message: text });
    return originalConsoleCyan(text);
  };
  chalk.green = (text) => {
    messages.push({ type: 'success', message: text });
    return originalConsoleGreen(text);
  };
  chalk.yellow = (text) => {
    messages.push({ type: 'warning', message: text });
    return originalConsoleYellow(text);
  };
  chalk.red = (text) => {
    messages.push({ type: 'error', message: text });
    return originalConsoleRed(text);
  };
  chalk.blue = (text) => {
    messages.push({ type: 'info', message: text });
    return originalConsoleBlue(text);
  };

  // Override ora to capture spinner messages
  const originalOra = ora;
  global.ora = (text) => {
    if (text) {
      messages.push({ type: 'spinner', message: text });
    }
    const spinner = originalOra(text);
    
    // Capture spinner text updates
    const originalText = Object.getOwnPropertyDescriptor(spinner, 'text');
    Object.defineProperty(spinner, 'text', {
      set(value) {
        messages.push({ type: 'spinner', message: value });
        originalText.set.call(this, value);
      },
      get() {
        return originalText.get.call(this);
      }
    });

    // Capture spinner success/fail/info/warn messages
    const originalSucceed = spinner.succeed;
    spinner.succeed = function(text) {
      if (text) {
        messages.push({ type: 'success', message: text });
      }
      return originalSucceed.call(this, text);
    };

    const originalFail = spinner.fail;
    spinner.fail = function(text) {
      if (text) {
        messages.push({ type: 'error', message: text });
      }
      return originalFail.call(this, text);
    };

    const originalInfo = spinner.info;
    spinner.info = function(text) {
      if (text) {
        messages.push({ type: 'info', message: text });
      }
      return originalInfo.call(this, text);
    };

    const originalWarn = spinner.warn;
    spinner.warn = function(text) {
      if (text) {
        messages.push({ type: 'warning', message: text });
      }
      return originalWarn.call(this, text);
    };

    return spinner;
  };

  // Execute the callback
  return callback()
    .then((result) => {
      // Restore original console methods
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
      chalk.cyan = originalConsoleCyan;
      chalk.green = originalConsoleGreen;
      chalk.yellow = originalConsoleYellow;
      chalk.red = originalConsoleRed;
      chalk.blue = originalConsoleBlue;
      global.ora = originalOra;

      return { result, messages };
    })
    .catch((error) => {
      // Restore original console methods
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
      chalk.cyan = originalConsoleCyan;
      chalk.green = originalConsoleGreen;
      chalk.yellow = originalConsoleYellow;
      chalk.red = originalConsoleRed;
      chalk.blue = originalConsoleBlue;
      global.ora = originalOra;

      throw { error: error.message || String(error), messages };
    });
}

/**
 * Replace interactive inquirer prompts with API responses for web server mode
 */
function mockInquirer(req, res) {
  // This will be used to store prompt responses that need to be sent back to the client
  const pendingPrompts = [];
  
  // Create a custom inquirer object to intercept prompts
  const inquirerMock = {
    prompt: async (questions) => {
      // If we're in auto mode, just return default values
      if (req.body.autoConfirm === true) {
        const answers = {};
        questions.forEach(q => {
          if (q.type === 'confirm') {
            answers[q.name] = true;
          } else if (q.type === 'input') {
            answers[q.name] = q.default || '';
          }
        });
        return answers;
      }
      
      // Otherwise, we need to send the prompt to the client and wait for a response
      pendingPrompts.push({
        questions: questions.map(q => ({
          type: q.type,
          name: q.name,
          message: q.message,
          default: q.default
        }))
      });
      
      // Return a promise that will be resolved when the client responds
      return new Promise((resolve) => {
        // Store the resolver in the request object
        req.promptResolver = resolve;
      });
    }
  };
  
  return { inquirerMock, pendingPrompts };
}

/**
 * Server command - Provides a web UI for Pro CLI
 */
export function serverCommand(options) {
  const port = options.port || process.env.PORT || 3000;
  const app = express();
  
  // Set up middleware
  app.use(cors());
  app.use(express.json());
  
  // Serve static files from the webapp/public directory
  const publicDir = path.join(__dirname, '..', 'webapp', 'public');
  app.use(express.static(publicDir));
  
  // Make node_modules fontsource-inter available
  const fontDir = path.join(__dirname, '..', '..', 'node_modules', 'fontsource-inter');
  app.use('/fonts/inter', express.static(fontDir));
  
  // API Routes

  // List projects
  app.post('/api/list', async (req, res) => {
    const operationId = uuidv4();
    const restoreConsole = captureConsoleOutput(operationId);
    
    try {
      const result = await listCommand(req.body);
      
      res.json({
        status: 'success',
        consoleOutput: restoreConsole(),
        data: result
      });
    } catch (error) {
      console.error('Error in list command:', error);
      
      res.status(500).json({
        status: 'error',
        consoleOutput: restoreConsole(),
        message: error.message
      });
    }
  });
  
  // List items in a project
  app.post('/api/list-items', async (req, res) => {
    const operationId = uuidv4();
    const restoreConsole = captureConsoleOutput(operationId);
    
    try {
      const result = await listItemsCommand(req.body);
      
      res.json({
        status: 'success',
        consoleOutput: restoreConsole(),
        data: result
      });
    } catch (error) {
      console.error('Error in list-items command:', error);
      
      res.status(500).json({
        status: 'error',
        consoleOutput: restoreConsole(),
        message: error.message
      });
    }
  });
  
  // List fields in a project
  app.post('/api/list-fields', async (req, res) => {
    const operationId = uuidv4();
    const restoreConsole = captureConsoleOutput(operationId);
    
    try {
      const result = await listFieldsCommand(req.body);
      
      res.json({
        status: 'success',
        consoleOutput: restoreConsole(),
        data: result
      });
    } catch (error) {
      console.error('Error in list-fields command:', error);
      
      res.status(500).json({
        status: 'error',
        consoleOutput: restoreConsole(),
        message: error.message
      });
    }
  });
  
  // Show field details
  app.post('/api/show-field', async (req, res) => {
    const operationId = uuidv4();
    const restoreConsole = captureConsoleOutput(operationId);
    
    try {
      const result = await showFieldCommand(req.body);
      
      res.json({
        status: 'success',
        consoleOutput: restoreConsole(),
        data: result
      });
    } catch (error) {
      console.error('Error in show-field command:', error);
      
      res.status(500).json({
        status: 'error',
        consoleOutput: restoreConsole(),
        message: error.message
      });
    }
  });
  
  // Fix team field
  app.post('/api/fix-team-field', async (req, res) => {
    const operationId = uuidv4();
    const restoreConsole = captureConsoleOutput(operationId);
    
    try {
      // Make inquirer available via options for prompt handling
      const commandOptions = {
        ...req.body,
        inquirer: mockInquirer(req, res),
        operationId
      };
      
      // Start the command
      fixTeamFieldCommand(commandOptions)
        .then(result => {
          res.json({
            status: 'success',
            consoleOutput: restoreConsole(),
            data: result
          });
        })
        .catch(error => {
          console.error('Error in fix-team-field command:', error);
          
          res.status(500).json({
            status: 'error',
            consoleOutput: restoreConsole(),
            message: error.message
          });
        });
      
    } catch (error) {
      console.error('Error starting fix-team-field command:', error);
      
      res.status(500).json({
        status: 'error',
        consoleOutput: restoreConsole(),
        message: error.message
      });
    }
  });
  
  // Fix function field
  app.post('/api/fix-function-field', async (req, res) => {
    const operationId = uuidv4();
    const restoreConsole = captureConsoleOutput(operationId);
    
    try {
      // Make inquirer available via options for prompt handling
      const commandOptions = {
        ...req.body,
        inquirer: mockInquirer(req, res),
        operationId
      };
      
      // Start the command
      fixFunctionFieldCommand(commandOptions)
        .then(result => {
          res.json({
            status: 'success',
            consoleOutput: restoreConsole(),
            data: result
          });
        })
        .catch(error => {
          console.error('Error in fix-function-field command:', error);
          
          res.status(500).json({
            status: 'error',
            consoleOutput: restoreConsole(),
            message: error.message
          });
        });
      
    } catch (error) {
      console.error('Error starting fix-function-field command:', error);
      
      res.status(500).json({
        status: 'error',
        consoleOutput: restoreConsole(),
        message: error.message
      });
    }
  });
  
  // Fix kind field
  app.post('/api/fix-kind-field', async (req, res) => {
    const operationId = uuidv4();
    const restoreConsole = captureConsoleOutput(operationId);
    
    try {
      // Make inquirer available via options for prompt handling
      const commandOptions = {
        ...req.body,
        inquirer: mockInquirer(req, res),
        operationId
      };
      
      // Start the command
      fixKindFieldCommand(commandOptions)
        .then(result => {
          res.json({
            status: 'success',
            consoleOutput: restoreConsole(),
            data: result
          });
        })
        .catch(error => {
          console.error('Error in fix-kind-field command:', error);
          
          res.status(500).json({
            status: 'error',
            consoleOutput: restoreConsole(),
            message: error.message
          });
        });
      
    } catch (error) {
      console.error('Error starting fix-kind-field command:', error);
      
      res.status(500).json({
        status: 'error',
        consoleOutput: restoreConsole(),
        message: error.message
      });
    }
  });
  
  // Summarize issues
  app.post('/api/summarize-issues', async (req, res) => {
    const operationId = uuidv4();
    const restoreConsole = captureConsoleOutput(operationId);
    
    try {
      // Make inquirer available via options for prompt handling
      const commandOptions = {
        ...req.body,
        inquirer: mockInquirer(req, res),
        operationId
      };
      
      // Start the command
      summarizeIssuesCommand(commandOptions)
        .then(result => {
          res.json({
            status: 'success',
            consoleOutput: restoreConsole(),
            data: result
          });
        })
        .catch(error => {
          console.error('Error in summarize-issues command:', error);
          
          res.status(500).json({
            status: 'error',
            consoleOutput: restoreConsole(),
            message: error.message
          });
        });
      
    } catch (error) {
      console.error('Error starting summarize-issues command:', error);
      
      res.status(500).json({
        status: 'error',
        consoleOutput: restoreConsole(),
        message: error.message
      });
    }
  });
  
  // Submit answers for a pending prompt
  app.post('/api/submit-prompt/:operationId', (req, res) => {
    const { operationId } = req.params;
    const { answers } = req.body;
    
    if (!operationId || !mockInquirer(req, res).inquirerMock.pendingPrompts[operationId]) {
      return res.status(404).json({
        status: 'error',
        message: 'Operation not found or no prompt pending'
      });
    }
    
    try {
      // Get pending prompts
      const prompts = mockInquirer(req, res).inquirerMock.pendingPrompts[operationId];
      
      // Create a result object with answers
      const result = {};
      
      // Map answers to prompt names
      prompts.forEach((prompt, index) => {
        if (answers[index] !== undefined) {
          // Convert string 'true'/'false' to boolean for confirm prompts
          if (prompt.type === 'confirm') {
            result[prompt.name] = answers[index] === 'true';
          } else {
            result[prompt.name] = answers[index];
          }
        }
      });
      
      // Resolve the prompt promise
      if (prompts.resolve) {
        prompts.resolve(result);
      }
      
      // Clear resolved prompts
      mockInquirer(req, res).inquirerMock.pendingPrompts[operationId] = [];
      
      // Return success with console output
      res.json({
        status: 'success',
        consoleOutput: mockInquirer(req, res).inquirerMock.pendingPrompts[operationId]
      });
      
      // Check if there are new prompts after resolution
      if (mockInquirer(req, res).inquirerMock.pendingPrompts[operationId] && mockInquirer(req, res).inquirerMock.pendingPrompts[operationId].length > 0) {
        // Return pending state with new prompts
        return res.json({
          status: 'pending',
          operationId,
          consoleOutput: mockInquirer(req, res).inquirerMock.pendingPrompts[operationId],
          prompts: mockInquirer(req, res).inquirerMock.pendingPrompts[operationId]
        });
      }
      
    } catch (error) {
      console.error('Error processing prompt answers:', error);
      
      res.status(500).json({
        status: 'error',
        message: 'Failed to process answers: ' + error.message
      });
    }
  });
  
  // Cancel an operation
  app.post('/api/cancel/:operationId', (req, res) => {
    const { operationId } = req.params;
    
    if (!operationId || !mockInquirer(req, res).inquirerMock.pendingPrompts[operationId]) {
      return res.status(404).json({
        status: 'error',
        message: 'Operation not found'
      });
    }
    
    try {
      // Reject any pending prompts
      if (mockInquirer(req, res).inquirerMock.pendingPrompts[operationId] && mockInquirer(req, res).inquirerMock.pendingPrompts[operationId].reject) {
        mockInquirer(req, res).inquirerMock.pendingPrompts[operationId].reject(new Error('Operation cancelled by user'));
      }
      
      // Clean up
      delete mockInquirer(req, res).inquirerMock.pendingPrompts[operationId];
      
      res.json({
        status: 'success',
        message: 'Operation cancelled successfully'
      });
    } catch (error) {
      console.error('Error cancelling operation:', error);
      
      res.status(500).json({
        status: 'error',
        message: 'Failed to cancel operation: ' + error.message
      });
    }
  });

  // Serve index.html for all other routes (SPA support)
  app.get('*', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
  
  // Start the server
  const server = app.listen(port, () => {
    const spinner = ora('Starting server...').start();
    setTimeout(() => {
      spinner.succeed(`Web server running at ${chalk.cyan(`http://localhost:${port}`)}`);
      console.log(`\n${chalk.bold('Pro Web UI is now available.')}`);
      console.log(`Press ${chalk.cyan('Ctrl+C')} to stop the server.\n`);
    }, 1000);
  });
  
  // Handle server shutdown
  process.on('SIGINT', () => {
    console.log(`\n${chalk.yellow('Shutting down server...')}`);
    server.close(() => {
      console.log(`${chalk.green('Server stopped.')}`);
      process.exit(0);
    });
  });
} 