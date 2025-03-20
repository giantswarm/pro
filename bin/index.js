#!/usr/bin/env node

import { program } from 'commander';

// Import command handlers from src/commands
import { listItemsCommand } from '../src/commands/list-items.js';
import { listFieldsCommand } from '../src/commands/list-fields.js';
import { showFieldCommand } from '../src/commands/show-field.js';
import { fixTeamFieldCommand } from '../src/commands/fix-team-field.js';
import { fixFunctionFieldCommand } from '../src/commands/fix-function-field.js';
import { fixKindFieldCommand } from '../src/commands/fix-kind-field.js';
import { fixWorkstreamFieldCommand } from '../src/commands/fix-workstream-field.js';
import { summarizeIssuesCommand } from '../src/commands/summarize-issues.js';
import { serverCommand } from '../src/commands/server.js';

import {
    ROADMAP_BOARD_ID, 
    TEAM_FIELD_ID, 
    FUNCTION_FIELD_ID,
    SIG_FIELD_ID,
    WG_FIELD_ID,
    KIND_FIELD_ID,
    WORKSTREAM_FIELD_ID
} from '../src/lib/project.js';

// Register commands using Commander
program
  .version('0.1.0')
  .description('Roadmap board management tool');

program
  .command('list-items')
  .description('List items in the roadmap board with optional filtering')
  .option('--kind <kind>', 'Filter by Kind')
  .option('--status <status>', 'Filter by Status')
  .option('--function <function>', 'Filter by Function')
  .option('--workstream <workstream>', 'Filter by Workstream')
  .option('--team <team>', 'Filter by Team')
  .option('--sig <sig>', 'Filter by SIG')
  .option('--wg <wg>', 'Filter by Working Group')
  .option('--no-team', 'Filter items with an empty Team field')
  .option('--no-function', 'Filter items with an empty Function field')
  .option('--no-kind', 'Filter items with an empty Kind field')
  .option('--no-workstream', 'Filter items with an empty Workstream field')
  .action(listItemsCommand);

program
  .command('list-fields')
  .description('List all fields in roadmap board')
  .action(listFieldsCommand);

program
  .command('show-field')
  .description('Show details of a specific field from the roadmap board')
  .requiredOption('--field <fieldId>', 'Field ID to show')
  .action(showFieldCommand);

program
  .command('show-teams')
  .description('Show details of teams in the roadmap board')
  .option('--field <fieldId>', 'Team field ID to show', TEAM_FIELD_ID)
  .action(showFieldCommand);

program
  .command('show-sigs')
  .description('Show details of SIGs in the roadmap board')
  .option('--field <fieldId>', 'SIG field ID to show', SIG_FIELD_ID)
  .action(showFieldCommand);

program
  .command('show-wgs')
  .description('Show details of WGs in the roadmap board')
  .option('--field <fieldId>', 'WG field ID to show', WG_FIELD_ID)
  .action(showFieldCommand);

program
  .command('show-functions')
  .description('Show details of functions in the roadmap board')
  .option('--field <fieldId>', 'Function field ID to show', FUNCTION_FIELD_ID)
  .action(showFieldCommand);

program
  .command('show-workstreams')
  .description('Show details of workstreams in the roadmap board')
  .option('--field <fieldId>', 'Workstream field ID to show', WORKSTREAM_FIELD_ID)
  .action(showFieldCommand);

program
  .command('fix-team-field')
  .description('Fix team field values based on team labels')
  .action(fixTeamFieldCommand);

program
  .command('fix-function-field')
  .description('Fix function field values using ChatGPT suggestions')
  .option('--team <team>', 'Filter by team name')
  .action(fixFunctionFieldCommand);

program
  .command('fix-kind-field')
  .description('Fix kind field values using ChatGPT suggestions')
  .option('--team <team>', 'Filter by team name')
  .action(fixKindFieldCommand);

program
  .command('fix-workstream-field')
  .description('Fix workstream field values using ChatGPT suggestions')
  .option('--team <team>', 'Filter by team name')
  .action(fixWorkstreamFieldCommand);

program
  .command('summarize-issues')
  .description('Analyze and summarize issues with AI-generated insights')
  .option('--kind <kind>', 'Filter by Kind')
  .option('--status <status>', 'Filter by Status')
  .option('--function <function>', 'Filter by Function')
  .option('--workstream <workstream>', 'Filter by Workstream')
  .option('--team <team>', 'Filter by Team')
  .option('--sig <sig>', 'Filter by SIG')
  .option('--wg <wg>', 'Filter by Working Group')
  .option('--no-team', 'Filter items with an empty Team field')
  .action(summarizeIssuesCommand);

program
  .command('server')
  .description('Start a web server with all features accessible via a web interface')
  .option('-p, --port <port>', 'Port to run the server on', '3000')
  .action(serverCommand);

program.parse(process.argv);

// Export commands for testing
export const listItems = listItemsCommand;
export const listFields = listFieldsCommand;
export const showField = showFieldCommand;
export const fixTeamField = fixTeamFieldCommand;
export const fixFunctionField = fixFunctionFieldCommand;
export const fixKindField = fixKindFieldCommand;
export const fixWorkstreamField = fixWorkstreamFieldCommand;
export const summarizeIssues = summarizeIssuesCommand;
export const server = serverCommand;
