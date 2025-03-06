import { graphQLWithAuth } from '../lib/api.js';
import { UPDATE_PROJECT_MUTATION } from '../lib/project.js';

export async function updateCommand(options) {
  try {
    if (!options.id || !options.title) {
      console.error('Project ID and title are required for updating the Project v2 board.');
      return;
    }
    
    const result = await graphQLWithAuth(UPDATE_PROJECT_MUTATION, { projectId: options.id, title: options.title });
    const project = result.updateProjectV2.projectV2;
    console.log(`Updated Project v2 board: [ID: ${project.id}] ${project.title}`);
  } catch (error) {
    console.error('Error updating Project v2 board:', error.message);
  }
}
