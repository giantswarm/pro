import { graphQLWithAuth } from '../lib/api.js';
import { DELETE_PROJECT_MUTATION } from '../lib/project.js';

export async function deleteCommand(options) {
  try {
    await graphQLWithAuth(DELETE_PROJECT_MUTATION, { projectId: options.id });
    console.log(`Deleted Project v2 board with ID ${options.id}`);
  } catch (error) {
    console.error('Error deleting Project v2 board:', error.message);
  }
}
