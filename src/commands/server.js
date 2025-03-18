import express from 'express';
import chalk from 'chalk';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { listItems, updateItemField } from '../lib/items.js';
import { listFields } from '../lib/fields.js';
import { fixTeamField } from '../lib/team-field.js';
import { fixFunctionField } from '../lib/function-field.js';
import { fixKindField } from '../lib/kind-field.js';
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
      res.json({ status: 'success', data: fields });
    } catch (error) {
      res.status(500).json({ status: 'error', error: error.message });
    }
  });
  
  // Fix team field
  app.post('/api/fix-team-field', async (req, res) => {
    try {
      const itemId = req.body.itemId;
      const result = await fixTeamField({ itemId });
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
      const result = await fixFunctionField(options);
      res.json({ status: 'success', data: result });
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
      const result = await fixKindField(options);
      res.json({ status: 'success', data: result });
    } catch (error) {
      res.status(500).json({ status: 'error', error: error.message });
    }
  });
  
  // Apply custom team field value
  app.post('/api/apply-custom-team', async (req, res) => {
    try {
      const { itemId, customValue } = req.body;
      if (!itemId || !customValue) {
        return res.status(400).json({ status: 'error', error: 'Missing required fields' });
      }
      
      const result = await updateItemField({
        itemId,
        fieldName: 'team',
        fieldValue: customValue
      });
      
      res.json({ status: 'success', data: result });
    } catch (error) {
      res.status(500).json({ status: 'error', error: error.message });
    }
  });
  
  // Apply custom function field value
  app.post('/api/apply-custom-function', async (req, res) => {
    try {
      const { itemId, teamValue, customValue } = req.body;
      if (!itemId || !customValue) {
        return res.status(400).json({ status: 'error', error: 'Missing required fields' });
      }
      
      const result = await updateFieldValue({
        itemId,
        fieldName: 'function',
        fieldValue: customValue
      });
      
      res.json({ status: 'success', data: result });
    } catch (error) {
      res.status(500).json({ status: 'error', error: error.message });
    }
  });
  
  // Apply custom kind field value
  app.post('/api/apply-custom-kind', async (req, res) => {
    try {
      const { itemId, teamValue, customValue } = req.body;
      if (!itemId || !customValue) {
        return res.status(400).json({ status: 'error', error: 'Missing required fields' });
      }
      
      const result = await updateFieldValue({
        itemId,
        fieldName: 'kind',
        fieldValue: customValue
      });
      
      res.json({ status: 'success', data: result });
    } catch (error) {
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
  
  // Serve index.html for all other routes (SPA)
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/index.html'));
  });
  
  // Start server
  app.listen(PORT, () => {
    console.log(chalk.green(`AI Roadmap Analysis Tool running on http://localhost:${PORT}`));
    console.log(chalk.cyan('Endpoints available:'));
    console.log(chalk.yellow('- GET /api/items - List and filter items'));
    console.log(chalk.yellow('- GET /api/fields - Get field options'));
    console.log(chalk.yellow('- POST /api/fix-team-field - Fix team field for an issue'));
    console.log(chalk.yellow('- POST /api/fix-function-field - Fix function field for an issue'));
    console.log(chalk.yellow('- POST /api/fix-kind-field - Fix kind field for an issue'));
    console.log(chalk.yellow('- POST /api/apply-custom-team - Apply custom team value'));
    console.log(chalk.yellow('- POST /api/apply-custom-function - Apply custom function value'));
    console.log(chalk.yellow('- POST /api/apply-custom-kind - Apply custom kind value'));
    console.log(chalk.yellow('- POST /api/summarize-issues - Analyze issues with AI'));
  });
} 