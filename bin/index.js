#!/usr/bin/env node

import { program } from 'commander';

// Import command handlers from src/commands
import { listCommand } from '../src/commands/list.js';
import { createCommand } from '../src/commands/create.js';
import { deleteCommand } from '../src/commands/delete.js';
import { updateCommand } from '../src/commands/update.js';
import { listItemsCommand } from '../src/commands/list-items.js';
import { listFieldsCommand } from '../src/commands/list-fields.js';
import { showFieldCommand } from '../src/commands/show-field.js';
import { fixTeamFieldCommand } from '../src/commands/fix-team-field.js';
import { fixFunctionFieldCommand } from '../src/commands/fix-function-field.js';

import {
    ROADMAP_BOARD_ID, 
    TEAM_FIELD_ID, 
    FUNCTION_FIELD_ID,
    SIG_FIELD_ID,
    WG_FIELD_ID
} from '../src/lib/project.js';

// Register commands using Commander
program
  .version('0.1.0')
  .description('GitHub Project v2 board management tool');

program
  .command('list')
  .description('List all GitHub Project v2 boards for a repository or organization')
  .option('--owner <owner>', 'GitHub repository owner or organization login', 'giantswarm')
  .option('--repo <repo>', 'GitHub repository name (omit for organization projects)')
  .action(listCommand);

program
  .command('create')
  .description('Create a new GitHub Project v2 board')
  .requiredOption('--owner <owner>', 'GitHub repository owner')
  .requiredOption('--repo <repo>', 'GitHub repository name')
  .requiredOption('--title <title>', 'Title of the project board')
  .action(createCommand);

program
  .command('delete')
  .description('Delete a GitHub Project v2 board')
  .requiredOption('--id <id>', 'Project board ID')
  .action(deleteCommand);

program
  .command('update')
  .description('Update a GitHub Project v2 board title')
  .requiredOption('--id <id>', 'Project board ID')
  .requiredOption('--title <title>', 'New title for the project board')
  .action(updateCommand);

program
  .command('list-items')
  .description('List items in a GitHub Project v2 board with optional filtering')
  .option('--id <id>', 'Project board ID', ROADMAP_BOARD_ID)
  .option('--kind <kind>', 'Filter by Kind')
  .option('--status <status>', 'Filter by Status')
  .option('--function <function>', 'Filter by Function')
  .option('--team <team>', 'Filter by Team')
  .option('--sig <sig>', 'Filter by SIG')
  .option('--wg <wg>', 'Filter by Working Group')
  .option('--no-team', 'Filter items with an empty Team field')
  .action(listItemsCommand);

program
  .command('list-fields')
  .description('List all fields in a GitHub Project v2 board')
  .option('--id <id>', 'Project board ID', ROADMAP_BOARD_ID)
  .action(listFieldsCommand);

program
  .command('show-field')
  .description('Show details of a specific field from a GitHub Project v2 board')
  .option('--project <projectId>', 'Project board ID', ROADMAP_BOARD_ID)
  .requiredOption('--field <fieldId>', 'Field ID to show')
  .action(showFieldCommand);

program
  .command('show-teams')
  .description('Show details of teams in the roadmap board')
  .option('--project <projectId>', 'Project board ID', ROADMAP_BOARD_ID)
  .option('--field <fieldId>', 'Team field ID to show', TEAM_FIELD_ID)
  .action(showFieldCommand);

program
  .command('show-sigs')
  .description('Show details of SIGs in the roadmap board')
  .option('--project <projectId>', 'Project board ID', ROADMAP_BOARD_ID)
  .option('--field <fieldId>', 'SIG field ID to show', SIG_FIELD_ID)
  .action(showFieldCommand);

program
  .command('show-wgs')
  .description('Show details of WGs in the roadmap board')
  .option('--project <projectId>', 'Project board ID', ROADMAP_BOARD_ID)
  .option('--field <fieldId>', 'WG field ID to show', WG_FIELD_ID)
  .action(showFieldCommand);

program
  .command('show-functions')
  .description('Show details of functions in the roadmap board')
  .option('--project <projectId>', 'Project board ID', ROADMAP_BOARD_ID)
  .option('--field <fieldId>', 'Function field ID to show', FUNCTION_FIELD_ID)
  .action(showFieldCommand);

program
  .command('fix-team-field')
  .description('Fix team field values based on team labels')
  .option('--id <id>', 'Project board ID', ROADMAP_BOARD_ID)
  .action(fixTeamFieldCommand);

program
  .command('fix-function-field')
  .description('Fix function field values using ChatGPT suggestions')
  .option('--id <id>', 'Project board ID', ROADMAP_BOARD_ID)
  .action(fixFunctionFieldCommand);

program.parse(process.argv);

// Export commands for testing
export const listProjects = listCommand;
export const createProject = createCommand;
export const deleteProject = deleteCommand;
export const updateProject = updateCommand;
export const listItems = listItemsCommand;
export const listFields = listFieldsCommand;
export const showField = showFieldCommand;
export const fixTeamField = fixTeamFieldCommand;
export const fixFunctionField = fixFunctionFieldCommand;
