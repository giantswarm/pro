const express = require('express');
const path = require('path');
const { exec } = require('child_process');
const app = express();
const port = process.env.PORT || 3000;

// Constants
const ROADMAP_BOARD_ID = 'PVT_kwDOAHNM9M4ABvWx';

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// For debugging HTTP requests
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// Error logging endpoint
app.post('/api/log-error', (req, res) => {
  console.error('Client-side error:', JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

// Helper function to execute command
function executeCommand(command, callback) {
  exec(command, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error executing command: ${command}`);
      console.error(error);
      return callback(error);
    }
    
    if (stderr) {
      console.warn(`Command produced stderr: ${stderr}`);
    }
    
    callback(null, stdout);
  });
}

// API Routes

// List items
app.post('/api/list-items', (req, res) => {
  const { projectId, kind, status, function: functionField, team, sig, wg, noTeam } = req.body;
  
  // Use ROADMAP_BOARD_ID as default if projectId is not provided
  const boardId = projectId || ROADMAP_BOARD_ID;
  
  let command = `node bin/index.js list-items --id "${boardId}"`;
  
  if (kind) command += ` --kind "${kind}"`;
  if (status) command += ` --status "${status}"`;
  if (functionField) command += ` --function "${functionField}"`;
  if (team) command += ` --team "${team}"`;
  if (sig) command += ` --sig "${sig}"`;
  if (wg) command += ` --wg "${wg}"`;
  if (noTeam) command += ' --no-team';
  
  console.log(`Executing command: ${command}`);
  
  executeCommand(command, (error, stdout) => {
    if (error) {
      console.error('Command execution error:', error);
      return res.status(500).json(error);
    }
    
    try {
      // The output from list-items is likely plain text with each line representing an item
      // Let's parse it into a more structured format
      const lines = stdout.trim().split('\n');
      
      // Check if we have results
      if (lines.length === 0 || lines[0].includes('No items found')) {
        return res.json({ success: true, items: [], count: 0 });
      }
      
      const items = [];
      const regex = /^(.*?)\s+\((https:\/\/github\.com\/.*?)\)$/;
      
      for (const line of lines) {
        const match = line.match(regex);
        if (match) {
          const [_, title, url] = match;
          
          // Extract issue ID from URL if possible
          const urlParts = url.split('/');
          const id = urlParts[urlParts.length - 1];
          
          items.push({ id, title, url });
        } else if (line.trim()) {
          // If the line doesn't match our regex but isn't empty,
          // include it with just a title
          items.push({ title: line.trim() });
        }
      }
      
      res.json({
        success: true,
        items,
        count: items.length,
        text: stdout // Include raw output for debugging
      });
    } catch (processError) {
      console.error('Error processing command output:', processError);
      res.status(500).json({
        error: 'Error processing command output',
        details: processError.message,
        text: stdout // Include raw output for debugging
      });
    }
  });
});

// Fix function field
app.post('/api/fix-function-field', (req, res) => {
  const { projectId, team, noTeam, confirm } = req.body;
  
  // Use ROADMAP_BOARD_ID as default if projectId is not provided
  const boardId = projectId || ROADMAP_BOARD_ID;
  
  // For this command, we'll use the --yes flag to automate it without interactive prompts
  // unless the user specifically requests confirmation
  let command = `node bin/index.js fix-function-field --id "${boardId}"`;
  
  if (team) command += ` --team "${team}"`;
  if (noTeam) command += ' --no-team';
  if (!confirm) command += ' --yes'; // Skip confirmation if not requested
  
  executeCommand(command, (error, stdout) => {
    if (error) {
      return res.status(500).json(error);
    }
    
    res.json({ success: true, output: stdout });
  });
});

// Fix kind field
app.post('/api/fix-kind-field', (req, res) => {
  const { projectId, team, noTeam, confirm } = req.body;
  
  // Use ROADMAP_BOARD_ID as default if projectId is not provided
  const boardId = projectId || ROADMAP_BOARD_ID;
  
  let command = `node bin/index.js fix-kind-field --id "${boardId}"`;
  
  if (team) command += ` --team "${team}"`;
  if (noTeam) command += ' --no-team';
  if (!confirm) command += ' --yes'; // Skip confirmation if not requested
  
  executeCommand(command, (error, stdout) => {
    if (error) {
      return res.status(500).json(error);
    }
    
    res.json({ success: true, output: stdout });
  });
});

// Summarize issues
app.post('/api/summarize-issues', (req, res) => {
  const { projectId, kind, status, function: functionField, team, sig, wg, noTeam } = req.body;
  
  // Use ROADMAP_BOARD_ID as default if projectId is not provided
  const boardId = projectId || ROADMAP_BOARD_ID;
  
  // The summarize-issues command doesn't exist yet, so we'll simulate it by
  // first collecting issues with list-items and then sending them to a new command
  let command = `node bin/index.js list-items --id "${boardId}"`;
  
  if (kind) command += ` --kind "${kind}"`;
  if (status) command += ` --status "${status}"`;
  if (functionField) command += ` --function "${functionField}"`;
  if (team) command += ` --team "${team}"`;
  if (sig) command += ` --sig "${sig}"`;
  if (wg) command += ` --wg "${wg}"`;
  if (noTeam) command += ' --no-team';
  
  // When we implement the summarize-issues command, we would change this to use that command directly
  executeCommand(command, (error, stdout) => {
    if (error) {
      return res.status(500).json(error);
    }
    
    // Since the summarize-issues command doesn't exist yet, 
    // we'll just provide a placeholder response
    res.json({
      success: true,
      summary: {
        totalIssues: parseInt(Math.random() * 20) + 5,
        topCategories: [
          { name: 'API Improvements', count: parseInt(Math.random() * 5) + 3 },
          { name: 'Bug Fixes', count: parseInt(Math.random() * 4) + 2 },
          { name: 'Performance Optimization', count: parseInt(Math.random() * 3) + 1 }
        ],
        priorityRecommendations: [
          { id: 'ISSUE-105', title: 'Fix authentication issue', priority: 'High', reason: 'Critical security issue' },
          { id: 'ISSUE-103', title: 'Improve database performance', priority: 'Medium', reason: 'Affects user experience' }
        ],
        summary: `This collection of issues focuses on improving the API and fixing critical bugs. 
                 There are some high-priority security concerns that should be addressed first.`
      }
    });
  });
});

// Diagnostic endpoint
app.get('/api/diagnostics', (req, res) => {
  const diagnostics = {
    node_version: process.version,
    platform: process.platform,
    memory: process.memoryUsage(),
    uptime: process.uptime(),
    env: {
      PATH: process.env.PATH,
      NODE_ENV: process.env.NODE_ENV,
      // Don't include sensitive info like tokens
    },
    cwd: process.cwd()
  };
  
  // Test command execution
  executeCommand('node -v', (error, stdout) => {
    diagnostics.command_test = {
      command: 'node -v',
      success: !error,
      output: stdout,
      error: error ? error.message : null
    };
    
    // Test CLI tool
    executeCommand('node bin/index.js --help', (cliError, cliStdout) => {
      diagnostics.cli_test = {
        command: 'node bin/index.js --help',
        success: !cliError,
        output: cliStdout ? cliStdout.substring(0, 500) : null, // Limit output length
        error: cliError ? cliError.message : null
      };
      
      res.json(diagnostics);
    });
  });
});

// Default route to serve the SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(port, () => {
  console.log(`Roadmap Board Manager running on http://localhost:${port}`);
  console.log(`To use this web interface, ensure you have:
  1. Set up required GitHub tokens
  2. Configured your project settings
  3. Any required environment variables are set
  
  The web UI connects to the CLI tool which must be properly configured.`);
}); 