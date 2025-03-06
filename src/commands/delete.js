import chalk from 'chalk';
import { graphQLWithAuth } from '../lib/api.js';
import { DELETE_PROJECT_MUTATION } from '../lib/project.js';

export async function deleteCommand(options) {
  try {
    await graphQLWithAuth(DELETE_PROJECT_MUTATION, { projectId: options.id });
    console.log(chalk.green(`Deleted Project v2 board with ID ${options.id}`));
  } catch (error) {
    console.error(chalk.red('Error deleting Project v2 board:'), chalk.red(error.message));
  }
}
