import chalk from 'chalk';
import { graphQLWithAuth } from '../lib/api.js';
import { REPO_ID_QUERY, CREATE_PROJECT_MUTATION } from '../lib/project.js';

export async function createCommand(options) {
  try {
    const repoResult = await graphQLWithAuth(REPO_ID_QUERY, { owner: options.owner, repo: options.repo });
    const repositoryId = repoResult.repository.id;
    if (!repositoryId) {
      console.error(chalk.red('Repository not found.'));
      return;
    }
    const result = await graphQLWithAuth(CREATE_PROJECT_MUTATION, { repositoryId, title: options.title });
    const project = result.createProjectV2.projectV2;
    console.log(chalk.green(`Created Project v2 board: [ID: ${project.id}] ${project.title}`));
  } catch (error) {
    console.error(chalk.red('Error creating Project v2 board:'), chalk.red(error.message));
  }
}
