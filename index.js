#!/usr/bin/env node

const { program } = require('commander');
const { graphql } = require('@octokit/graphql');

// Ensure GitHub token is set in environment variables
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) {
  console.error('Error: GITHUB_TOKEN environment variable is not set.');
  process.exit(1);
}

// Configure graphql client with authentication
const graphQLWithAuth = graphql.defaults({
  headers: {
    authorization: `bearer ${GITHUB_TOKEN}`
  }
});

// Updated pagination logic for 'list' command to fetch all projects via pagination
program
  .command('list')
  .description('List all GitHub Project v2 boards for a repository (if --repo is provided) or for an organization (if --repo is omitted)')
  .requiredOption('--owner <owner>', 'GitHub repository owner or organization login')
  .option('--repo <repo>', 'GitHub repository name (omit to list organization projects)')
  .option('--limit <limit>', 'Number of boards to fetch per page', '10')
  .option('--cursor <cursor>', 'Pagination cursor to start from')
  .action(async (options) => {
    const first = parseInt(options.limit, 10);
    let after = options.cursor || null;
    let allProjects = [];

    if (options.repo) {
      // Query for repository projects with pagination
      const query = `
        query ($owner: String!, $repo: String!, $first: Int!, $after: String) {
          repository(owner: $owner, name: $repo) {
            projectsV2(first: $first, after: $after) {
              nodes {
                id
                title
                number
              }
              pageInfo {
                endCursor
                hasNextPage
              }
            }
          }
        }
      `;

      try {
        do {
          const result = await graphQLWithAuth(query, {
            owner: options.owner,
            repo: options.repo,
            first,
            after
          });
          const data = result.repository.projectsV2;
          allProjects.push(...data.nodes);
          after = data.pageInfo.hasNextPage ? data.pageInfo.endCursor : null;
        } while (after);

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
      // Query for organization projects with pagination
      const query = `
        query ($org: String!, $first: Int!, $after: String) {
          organization(login: $org) {
            projectsV2(first: $first, after: $after) {
              nodes {
                id
                title
                number
              }
              pageInfo {
                endCursor
                hasNextPage
              }
            }
          }
        }
      `;

      try {
        do {
          const result = await graphQLWithAuth(query, {
            org: options.owner,
            first,
            after
          });
          const data = result.organization.projectsV2;
          allProjects.push(...data.nodes);
          after = data.pageInfo.hasNextPage ? data.pageInfo.endCursor : null;
        } while (after);

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
  });

// Updated command to create a new GitHub Project v2 board
program
  .command('create')
  .description('Create a new GitHub Project v2 board')
  .requiredOption('--owner <owner>', 'GitHub repository owner')
  .requiredOption('--repo <repo>', 'GitHub repository name')
  .requiredOption('--title <title>', 'Title of the project board')
  .action(async (options) => {
    // First, fetch the repository ID
    const repoQuery = `
      query ($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          id
        }
      }
    `;
    try {
      const repoResult = await graphQLWithAuth(repoQuery, {
        owner: options.owner,
        repo: options.repo
      });

      const repositoryId = repoResult.repository.id;
      if (!repositoryId) {
        console.error('Repository not found.');
        return;
      }

      const mutation = `
        mutation ($repositoryId: ID!, $title: String!) {
          createProjectV2(input: { repositoryId: $repositoryId, title: $title }) {
            projectV2 {
              id
              title
            }
          }
        }
      `;

      const result = await graphQLWithAuth(mutation, {
        repositoryId,
        title: options.title
      });

      const project = result.createProjectV2.projectV2;
      console.log(`Created Project v2 board: [ID: ${project.id}] ${project.title}`);

    } catch (error) {
      console.error('Error creating Project v2 board:', error.message);
    }
  });

// Updated command to delete a GitHub Project v2 board
program
  .command('delete')
  .description('Delete a GitHub Project v2 board')
  .requiredOption('--id <id>', 'Project board ID')
  .action(async (options) => {
    const mutation = `
      mutation ($projectId: ID!) {
        deleteProjectV2(input: { projectId: $projectId }) {
          projectV2 {
            id
          }
        }
      }
    `;

    try {
      await graphQLWithAuth(mutation, { projectId: options.id });
      console.log(`Deleted Project v2 board with ID ${options.id}`);
    } catch (error) {
      console.error('Error deleting Project v2 board:', error.message);
    }
  });

// Updated command to update a GitHub Project v2 board title
program
  .command('update')
  .description('Update a GitHub Project v2 board title')
  .requiredOption('--id <id>', 'Project board ID')
  .requiredOption('--title <title>', 'New title for the project board')
  .action(async (options) => {
    const mutation = `
      mutation ($projectId: ID!, $title: String!) {
        updateProjectV2(input: { projectId: $projectId, title: $title }) {
          projectV2 {
            id
            title
          }
        }
      }
    `;

    try {
      const result = await graphQLWithAuth(mutation, {
        projectId: options.id,
        title: options.title
      });

      const project = result.updateProjectV2.projectV2;
      console.log(`Updated Project v2 board: [ID: ${project.id}] ${project.title}`);
    } catch (error) {
      console.error('Error updating Project v2 board:', error.message);
    }
  });

// New command to list all items in a GitHub Project v2 board
program
  .command('list-items')
  .description('List all items in a GitHub Project v2 board')
  .requiredOption('--id <id>', 'Project board ID')
  .option('--limit <limit>', 'Number of items to fetch per page', '10')
  .option('--cursor <cursor>', 'Pagination cursor to start from')
  .action(async (options) => {
    const first = parseInt(options.limit, 10);
    let after = options.cursor || null;
    let allItems = [];

    const query = `
      query ($projectId: ID!, $first: Int!, $after: String) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: $first, after: $after) {
              nodes {
                id
                type
                content {
                  __typename
                  ... on Issue {
                    title
                    url
                  }
                  ... on DraftIssue {
                    title
                  }
                }
              }
              pageInfo {
                endCursor
                hasNextPage
              }
            }
          }
        }
      }
    `;

    try {
      do {
        const result = await graphQLWithAuth(query, {
          projectId: options.id,
          first,
          after
        });
        const itemsData = result.node.items;
        allItems.push(...itemsData.nodes);
        after = itemsData.pageInfo.hasNextPage ? itemsData.endCursor : null;
      } while (after);

      if (allItems.length === 0) {
        console.log(`No items found in board with ID ${options.id}`);
      } else {
        console.log(`Items in board [ID: ${options.id}]:`);
        allItems.forEach(item => {
          // Determine a title representation based on content type
          let title = 'No title';
          if (item.content) {
            if (item.content.__typename === 'Issue' || item.content.__typename === 'DraftIssue') {
              title = item.content.title;
            } else {
              title = item.content.__typename;
            }
          }
          console.log(`- [${item.id}] Type: ${item.type}, Title: ${title}`);
        });
        console.log(`Fetched a total of ${allItems.length} item(s).`);
      }
    } catch (error) {
      console.error('Error fetching items for board:', error.message);
    }
  });

// Updated command to list all fields in a GitHub Project v2 board using the provided query with fixed pagination
program
  .command('list-fields')
  .description('List all fields in a GitHub Project v2 board')
  .requiredOption('--id <id>', 'Project board ID')
  .option('--limit <limit>', 'Number of fields to fetch per page', '10')
  .option('--cursor <cursor>', 'Pagination cursor to start from')
  .action(async (options) => {
    const first = parseInt(options.limit, 10);
    let after = options.cursor || "";
    let allFields = [];

    const query = `
      query ($projectId: ID!, $first: Int!, $after: String!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            fields(first: $first, after: $after) {
              totalCount
              pageInfo {
                endCursor
                hasNextPage
                startCursor
              }
              nodes {
                __typename
                ... on ProjectV2Field {
                  id
                  name
                  dataType
                }
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  dataType
                  options {
                    color
                    description
                    id
                    name
                  }
                }
                ... on ProjectV2IterationField {
                  id
                  name
                  dataType
                  configuration {
                    iterations {
                      duration
                      id
                      startDate
                      title
                    }
                    duration
                    startDay
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      do {
        const result = await graphQLWithAuth(query, {
          projectId: options.id,
          first,
          after: after || ""
        });
        const fieldsData = result.node.fields;
        allFields.push(...fieldsData.nodes);
        after = fieldsData.pageInfo.hasNextPage ? fieldsData.endCursor : "";
      } while (after);

      if (allFields.length === 0) {
        console.log(`No fields found in board with ID ${options.id}`);
      } else {
        console.log(`Fields in board [ID: ${options.id}]:`);
        allFields.forEach(field => {
          let fieldInfo = `Type: ${field.__typename}`;
          if (field.id && field.name) {
            fieldInfo += `, Name: ${field.name}`;
          }
          if (field.dataType) {
            fieldInfo += `, DataType: ${field.dataType}`;
          }
          if (field.__typename === 'ProjectV2SingleSelectField' && field.options) {
            fieldInfo += `, Options: ${field.options.map(o => o.name).join(', ')}`;
          }
          console.log(`- [${field.id || 'N/A'}] ${fieldInfo}`);
        });
        console.log(`Fetched a total of ${allFields.length} field(s).`);
      }
    } catch (error) {
      console.error('Error fetching fields for board:', error.message);
    }
  });

// Updated 'show-field' command to use null as initial cursor and loop until after is null
program
  .command('show-field')
  .description('Show details of a specific field from a GitHub Project v2 board')
  .requiredOption('--project <projectId>', 'Project board ID')
  .requiredOption('--field <fieldId>', 'Field ID to show')
  .option('--limit <limit>', 'Number of fields to fetch per page', '10')
  .option('--cursor <cursor>', 'Pagination cursor to start from')
  .action(async (options) => {
    const first = parseInt(options.limit, 10);
    let after = options.cursor ? options.cursor : null;
    let allFields = [];

    const query = `
      query ($projectId: ID!, $first: Int!, $after: String) {
        node(id: $projectId) {
          ... on ProjectV2 {
            fields(first: $first, after: $after) {
              totalCount
              pageInfo {
                endCursor
                hasNextPage
                startCursor
              }
              nodes {
                __typename
                ... on ProjectV2Field {
                  id
                  name
                  dataType
                }
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  dataType
                  options {
                    color
                    description
                    id
                    name
                  }
                }
                ... on ProjectV2IterationField {
                  id
                  name
                  dataType
                  configuration {
                    iterations {
                      duration
                      id
                      startDate
                      title
                    }
                    duration
                    startDay
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      do {
        const result = await graphQLWithAuth(query, {
          projectId: options.project,
          first,
          after
        });
        const fieldsData = result.node.fields;
        allFields.push(...fieldsData.nodes);
        after = fieldsData.pageInfo.hasNextPage ? fieldsData.pageInfo.endCursor : null;
      } while (after !== null);

      // Find the specific field
      const field = allFields.find(f => f.id === options.field);
      if (!field) {
        console.log(`Field with ID ${options.field} not found in project ${options.project}.`);
        return;
      }

      console.log(`Details for field [ID: ${field.id}]:`);
      console.log(`- Type: ${field.__typename}`);
      console.log(`- Name: ${field.name}`);
      console.log(`- DataType: ${field.dataType}`);
      if (field.__typename === 'ProjectV2SingleSelectField' && field.options) {
        console.log(`- Options:`);
        field.options.forEach(option => {
          console.log(`   - [${option.id}] ${option.name} (Color: ${option.color}, Description: ${option.description})`);
        });
      } else if (field.__typename === 'ProjectV2IterationField' && field.configuration) {
        console.log(`- Configuration:`);
        console.log(`   - Duration: ${field.configuration.duration}`);
        console.log(`   - Start Day: ${field.configuration.startDay}`);
        if (field.configuration.iterations) {
          console.log(`   - Iterations:`);
          field.configuration.iterations.forEach(iteration => {
            console.log(`      - [${iteration.id}] ${iteration.title} (Duration: ${iteration.duration}, Start: ${iteration.startDate})`);
          });
        }
      }

    } catch (error) {
      console.error('Error fetching field details:', error.message);
    }
  });

program.parse(process.argv);
