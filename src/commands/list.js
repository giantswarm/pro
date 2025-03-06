import { fetchPaginated } from '../lib/api.js';
import { LIST_PROJECTS_REPO_QUERY, LIST_PROJECTS_ORG_QUERY } from '../lib/project.js';

export async function listCommand(options) {
  const first = 100; // Always use pagination limit 100
  if (options.repo) {
    try {
      const allProjects = await fetchPaginated(
        LIST_PROJECTS_REPO_QUERY,
        { owner: options.owner, repo: options.repo, first },
        result => result.repository.projectsV2
      );
      if (allProjects.length === 0) {
        console.log(`No Project v2 boards found in repository ${options.owner}/${options.repo}`);
      } else {
        console.log(`Project v2 boards in repository ${options.owner}/${options.repo}:`);
        allProjects.forEach(project => {
          console.log(`- [#${project.number}] ${project.title} (ID: ${project.id})`);
        });
        console.log(`Fetched a total of ${allProjects.length} board(s).`);
      }
    } catch (error) {
      console.error('Error fetching Project v2 boards for repository:', error.message);
    }
  } else {
    try {
      const allProjects = await fetchPaginated(
        LIST_PROJECTS_ORG_QUERY,
        { org: options.owner, first },
        result => result.organization.projectsV2
      );
      if (allProjects.length === 0) {
        console.log(`No Project v2 boards found for organization ${options.owner}`);
      } else {
        console.log(`Project v2 boards for organization ${options.owner}:`);
        allProjects.forEach(project => {
          console.log(`- [#${project.number}] ${project.title} (ID: ${project.id})`);
        });
        console.log(`Fetched a total of ${allProjects.length} board(s).`);
      }
    } catch (error) {
      console.error('Error fetching Project v2 boards for organization:', error.message);
    }
  }
}
