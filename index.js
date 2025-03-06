#!/usr/bin/env node

const { program } = require('commander');
const { graphQLWithAuth, fetchPaginated } = require('./api');
const {
  LIST_PROJECTS_REPO_QUERY,
  LIST_PROJECTS_ORG_QUERY,
  REPO_ID_QUERY,
  CREATE_PROJECT_MUTATION,
  DELETE_PROJECT_MUTATION,
  UPDATE_PROJECT_MUTATION,
  LIST_ITEMS_QUERY,
  LIST_FIELDS_QUERY,
  SHOW_FIELD_QUERY,
  LIST_ITEMS_WITH_LABELS_QUERY,
  UPDATE_ITEM_FIELD_MUTATION
} = require('./project');

// Ensure GitHub token is set in environment variables
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) {
  console.error('Error: GITHUB_TOKEN environment variable is not set.');
  process.exit(1);
}

//---------------------------------------------------------------------
// Extracted command handlers for testability

// Added helper function to create ANSI clickable hyperlink for issues
function makeIssueLink(url, title) {
  return `\u001b]8;;${url}\u0007${title}\u001b]8;;\u0007`;
}

// OpenAI integration:
const OpenAI = require('openai');
const { read } = require('fs');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const assistantId = "asst_5mbphHI9WYRAKzFqhtbJGqc9";

// Helper functions for OpenAI Assistant based on provided example code

// NEW: Add query to fetch full issue details
const ISSUE_DETAIL_QUERY = `
  query($id: ID!) {
    node(id: $id) {
      ... on ProjectV2Item {
        content {
          ... on Issue {
            bodyText
            comments (first: 100) {
              nodes {
                bodyText
              }
            }
            projectsV2 (first: 10) {
              nodes {
                title
              }
            }
          }
        }
      }
    }
  }
`;

async function getTeamSuggestionForIssue(item) {
	// Attempt to extract details from the fetched item first
	let title = item.content.title || '';
  let body = '';
  let comments = '';
  let teamSuggestion = '';
	
	// If details are missing and an issue id exists, re-fetch from GitHub
  try {
    const issueDetails = await graphQLWithAuth(ISSUE_DETAIL_QUERY, { id: item.id });
    if (issueDetails && issueDetails.node && issueDetails.node.content) {
      body = issueDetails.node.content.bodyText || '';
      comments = 'None';
      if (issueDetails.node.content.comments && issueDetails.node.content.comments.nodes) {
        comments = issueDetails.node.content.comments.nodes.map(c => c.bodyText).join('\n');
      } 
    } else {
      console.error("Error: Issue details are incomplete.");
      return '';
    }

    // check if one of the projects contains the word "team"
    let teamProjects = [];
    if (issueDetails.node.content.projectsV2 && issueDetails.node.content.projectsV2.nodes) {
      teamProjects = issueDetails.node.content.projectsV2.nodes.filter(project => project.title.toLowerCase().includes('team'));
    }

    if (teamProjects.length === 1) {
      console.log(`Found team project: ${teamProjects[0].title}`);
      // replace special characters in the project title, lowercase it and trim it
      teamSuggestion = teamProjects[0].title.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\bteam\b/g, '').trim();
      return teamSuggestion;
    } else if (teamProjects.length > 1) {
      // append team projects to comments
      comments += '\n\nTeam projects: ' + teamProjects.map(p => p.title).join(', ');
    }

    if (comments.includes('#iamarobot')) {
      console.log("Issue already has a comment from the bot.");
      return 'skip';
    }
  } catch (err) {
    console.error("Error fetching issue details:", err.message);
  }

  if (!title) {
    console.error("Error: Missing title for issue.");
    return '';
  }
	
  if (!body) {
    body = "TBD"
  }
  
	const prompt = `Determine the appropriate team for the following issue:
Title: ${title}
Content: ${body}
Comments: ${comments}

Reply with the team name that should handle this issue.
`;

  try {
		const thread = await openai.beta.threads.create({
			messages: [
				{
					role: 'user',
					content: prompt
				}
			],
		});
		let threadId = thread.id;
		const run = await openai.beta.threads.runs.createAndPoll(threadId, {
			assistant_id: assistantId,
			additional_instructions: 'The format of the response is only the team name (e.g., "team/honeybadger"). If you dont know the team respond with "team/null".',
		});
		if (run.status === 'completed') {
			const messages = await openai.beta.threads.messages.list(threadId);
			const assistantResponse = messages.getPaginatedItems().find(msg => msg.role === 'assistant') || {};

      if (!assistantResponse.content) {
        console.warn("Warning: No assistant response found.");
        return '';
      }

      for (const content of assistantResponse.content) {
        if (content.type === "text" && content.text && content.text.value) {
          // filter out the references in square brackets about the teams.md file "team/honeybadger【4:0†teams.md】"
          const filteredContent = content.text.value.replace(/【\d+:\d+†teams\.md】/g, '').trim();
          teamSuggestion += filteredContent;
        }
      }

			if (!teamSuggestion || !teamSuggestion.toLowerCase().startsWith('team/')) {
				console.warn("Warning: No team suggestion received.");
        return '';
			}

      console.log("Assistant response: " + teamSuggestion);
      
			return teamSuggestion.substring(5);
		} else {
      console.warn('Warning: Run finished with status: ' + run.status);
			console.warn("Warning: Team suggestion not completed.");
      return '';
		}

	} catch (error) {
		console.error('Error getting team suggestion from OpenAI:', error.message);
		return '';
	}
}

async function listProjects(options) {
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

async function createProject(options) {
  try {
    const repoResult = await graphQLWithAuth(REPO_ID_QUERY, {
      owner: options.owner,
      repo: options.repo
    });
    const repositoryId = repoResult.repository.id;
    if (!repositoryId) {
      console.error('Repository not found.');
      return;
    }
    const result = await graphQLWithAuth(CREATE_PROJECT_MUTATION, {
      repositoryId,
      title: options.title
    });
    const project = result.createProjectV2.projectV2;
    console.log(`Created Project v2 board: [ID: ${project.id}] ${project.title}`);
  } catch (error) {
    console.error('Error creating Project v2 board:', error.message);
  }
}

async function deleteProject(options) {
  try {
    await graphQLWithAuth(DELETE_PROJECT_MUTATION, { projectId: options.id });
    console.log(`Deleted Project v2 board with ID ${options.id}`);
  } catch (error) {
    console.error('Error deleting Project v2 board:', error.message);
  }
}

async function updateProject(options) {
  try {
    const result = await graphQLWithAuth(UPDATE_PROJECT_MUTATION, {
      projectId: options.id,
      title: options.title
    });
    const project = result.updateProjectV2.projectV2;
    console.log(`Updated Project v2 board: [ID: ${project.id}] ${project.title}`);
  } catch (error) {
    console.error('Error updating Project v2 board:', error.message);
  }
}

// Updating listItems function
async function listItems(options) {
  const first = 100; // Always use pagination limit 100
  try {
    const allItems = await fetchPaginated(
      LIST_ITEMS_QUERY,
      { projectId: options.id, first },
      result => result.node.items
    );
    if (allItems.length === 0) {
      console.log(`No items found in board with ID ${options.id}`);
    } else {
      console.log(`Items in board [ID: ${options.id}]:`);
      allItems.forEach(item => {
        let output = `- [${item.id}] `;
        if (item.content && item.content.__typename === 'Issue') {
          const title = item.content.title || 'No title';
          let number = item.content.number;
          let url = item.content.url || '';
          output += `${makeIssueLink(url, title)} ${number ? `#${number}` : ''}`;
        } else {
          const title = (item.content && item.content.title) ? item.content.title : 'No title';
          output += title;
        }
        console.log(output);
      });
      console.log(`Fetched a total of ${allItems.length} item(s).`);
    }
  } catch (error) {
    console.error('Error fetching items for board:', error.message);
  }
}

async function listFields(options) {
  const first = 100; // Always use pagination limit 100
  try {
    const allFields = await fetchPaginated(
      LIST_FIELDS_QUERY,
      { projectId: options.id, first },
      result => result.node.fields
    );
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
}

async function showField(options) {
  const first = 100; // Always use pagination limit 100
  try {
    const allFields = await fetchPaginated(
      SHOW_FIELD_QUERY,
      { projectId: options.project, first },
      result => result.node.fields
    );
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
}

// Updating filterItems function
async function filterItems(options) {
  const first = 100; // Always use pagination limit 100
  try {
    const allItems = await fetchPaginated(
      LIST_ITEMS_QUERY,
      { projectId: options.id, first },
      result => result.node.items
    );

    // Build filter criteria from options for keys: kind, status, function, sig, wg
    // Exclude team if --no-team flag is provided
    const filters = {};
    ['kind', 'status', 'function', 'sig', 'wg'].forEach(key => {
      if (options[key]) {
        if (key === 'wg') {
          filters['working group'] = options[key].toLowerCase();
        } else {
          filters[key.toLowerCase()] = options[key].toLowerCase();
        }
      }
    });

    const filtered = allItems.filter(item => {
      // Log entire item id and fieldValues for debugging
      if (!item.fieldValues || !item.fieldValues.nodes) {
        console.error(`DEBUG: No fieldValues or nodes for item ${item.id}`);
        return false;
      }

      // Check for --no-team flag
      if (options.team === false) {
        const hasTeam = item.fieldValues.nodes.some(node => {
          console.log(node);
          if (!node.field) {
            console.error(`DEBUG: Missing field in node for item ${item.id}: ${JSON.stringify(node)}`);
            return false;
          }
          return node.field.name && node.field.name.toLowerCase() === 'team' && typeof node.name === 'string' && node.name.trim() !== '';
        });
        if (hasTeam) {
          return false;
        }
      } else if (options.team) {
        filters['team'] = options.team.toLowerCase();
      }

      try {
        return Object.entries(filters).every(([filterKey, filterValue]) => {
          const matchingField = item.fieldValues.nodes.find(node => {
            if (!node.field) {
              console.error(`DEBUG: Missing field in node for filterKey '${filterKey}' in item ${item.id}: ${JSON.stringify(node)}`);
              return false;
            }
            return node.field.name && node.field.name.toLowerCase() === filterKey && typeof node.name === 'string';
          });
          if (!matchingField) {
            console.error(`DEBUG: No matching field for '${filterKey}' in item ${item.id}. Node details: ${JSON.stringify(item.fieldValues.nodes)}`);
            return false;
          }
          const fieldName = matchingField.name;
          if (!fieldName) {
            console.error(`DEBUG: Matching field for '${filterKey}' in item ${item.id} has no 'name'. Node: ${JSON.stringify(matchingField)}`);
            return false;
          }
          return fieldName.toLowerCase() === filterValue;
        });
      } catch (e) {
        console.error(`DEBUG: Exception while processing filters for item ${item.id}: ${e}`);
        return false;
      }
    });

    if (filtered.length === 0) {
      console.log(`No items found matching provided filters.`);
    } else {
      console.log(`Filtered items:`);
      filtered.forEach(item => {
        let output = `- [${item.id}] `;
        
        // test if item.content exists and isn't empty 
        if (item.content && Object.keys(item.content).length > 0) {
          const title = item.content.title || 'No title';
          const number = item.content.number || '';
          const url = item.content.url || '';

          output += `${makeIssueLink(url, title)} ${number ? `#${number}` : ''}`;
        } else {
          const title = (item.content && item.content.title) ? item.content.title : 'No title';
          output += title;
        }
        console.log(output);
      });
      console.log(`Fetched a total of ${filtered.length} filtered item(s).`);
    }
  } catch (error) {
    console.error('Error filtering items:', error.message);
  }
}

// Function to fix team fields based on team labels
const POST_ISSUE_COMMENT_MUTATION = `
  mutation($issueId: ID!, $body: String!) {
    addComment(input: { subjectId: $issueId, body: $body }) {
      commentEdge {
        node {
          id
        }
      }
    }
  }
`;

async function postIssueComment(issueId, commentBody) {
  try {
    const response = await graphQLWithAuth(POST_ISSUE_COMMENT_MUTATION, { issueId, body: commentBody });
  } catch (error) {
    console.error(`Error posting comment on issue ${issueId}:`, error.message);
  }
}

async function fixTeamField(options) {
  const first = 100; // Always use pagination limit 100
  try {
    // Get all project items with labels
    const allItems = await fetchPaginated(
      LIST_ITEMS_WITH_LABELS_QUERY,
      { projectId: options.id, first },
      result => result.node.items
    );
    
    // Get team field and its options
    const allFields = await fetchPaginated(
      LIST_FIELDS_QUERY,
      { projectId: options.id, first },
      result => result.node.fields
    );
    
    const teamField = allFields.find(field => 
      field.__typename === 'ProjectV2SingleSelectField' && 
      field.name.toLowerCase() === 'team'
    );
    
    if (!teamField) {
      console.log('No team field found in this project.');
      return;
    }
    
    // Filter items that don't have team field set
    const itemsWithoutTeam = allItems.filter(item => {
      if (!item.fieldValues || !item.fieldValues.nodes) return true;
      
      return !item.fieldValues.nodes.some(node => {
        return node.field && 
          node.field.name && 
          node.field.name.toLowerCase() === 'team' && 
          typeof node.name === 'string' && 
          node.name.trim() !== ''
      });
    });
    
    console.log(`Found ${itemsWithoutTeam.length} items without team field set.`);
    
    // 4. Process each item, check labels and update team field
    let updatedCount = 0;
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    for (const item of itemsWithoutTeam) {
      // Ensure the item is an issue or pull request with labels
      if (!item.content ||
          !item.content.labels ||
          !item.content.labels.nodes) {
        continue;
      }
      
      // Look for team labels (e.g., "team/honeybadger")
      const teamLabels = item.content.labels.nodes.filter(label => 
        label.name.toLowerCase().startsWith('team/')
      );
      
      // Use existing label if exactly one; otherwise use OpenAI assistant.
      let teamName = '';
      if (teamLabels.length === 1) {
        teamName = teamLabels[0].name.substring(5);
      } else {
        const issueLink = makeIssueLink(item.content.url, item.content.title);
        console.log(`Team suggestion for: ${issueLink}`);
        teamName = await getTeamSuggestionForIssue(item);

        if (teamName === 'skip') {
          continue;
        }

        if (teamName && teamName.toLowerCase() !== 'null') {
          // ask the user for confirmation (add a clickable link to the issue)
          await new Promise((resolve) => {
            readline.question(`Accept "${teamName}"? (yes/no) `, (answer) => {
              if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
                resolve(true);
              } else {
                teamName = '';
                resolve(false);
              }
            });
          });
        } else {
          teamName = '';
        }
      }
      
      // Ask the user for a team name if no suggestion is available
      if (!teamName) {
        await new Promise((resolve) => {
          readline.question(`Team name (empty for none): `, (userInput) => {
            teamName = userInput.trim();
            resolve();
          });
        });
      }

      // Ask user before posting a comment if no team suggestion found
      if (!teamName) {
        await new Promise((resolve) => {
          readline.question(`Would you like to post a comment asking for the team? (yes/no) `, (answer) => {
            if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
              postIssueComment(item.content.id, `We'll keep the inbox of the roadmap board clean and this issue doesn't have a team assigned. Can you help me out by suggesting a team for this issue?

Either:
 * setting the team field in the roadmap board
 * adding a team label
 * adding this issue to a team board

would help.

Thanks! #iamarobot`);
            }
            resolve();
          });
        });
        continue;
      }
      
      if (teamName === "honeybadger") {
        teamName = "honey badger";
      }
      if (teamName === "team") {
        teamName = "up";
      }
      
      // Find matching team option in the single select field
      const teamOption = teamField.options.find(option => {
        const optionNameLower = option.name.toLowerCase().replace(/[^\x00-\x7F]/g, '').trim();
        const teamNameLower = teamName.toLowerCase().trim();
        return optionNameLower.includes(teamNameLower) || teamNameLower.includes(optionNameLower);
      });
      
      if (!teamOption) {
        console.log(`Could not find matching team option for team "${teamName}"`);
        continue;
      }
      
      // Update team field with the found team option ID
      try {
        await graphQLWithAuth(UPDATE_ITEM_FIELD_MUTATION, {
          projectId: options.id,
          itemId: item.id,
          fieldId: teamField.id,
          value: { singleSelectOptionId: teamOption.id }
        });
        
        updatedCount++;
        console.log(`Updated team to "${teamOption.name}"`);
      } catch (error) {
        console.error(`Error updating team for issue #${item.content.number}:`, error.message);
      }
    }
    readline.close();
    
    console.log(`Updated team field for ${updatedCount} issues.`);
    
  } catch (error) {
    console.error('Error fixing team fields:', error.message);
  }
}

//---------------------------------------------------------------------
// CLI command registration using extracted handlers

program
  .command('list')
  .description('List all GitHub Project v2 boards for a repository or organization')
  .requiredOption('--owner <owner>', 'GitHub repository owner or organization login')
  .option('--repo <repo>', 'GitHub repository name (omit for organization projects)')
  .action(listProjects);

program
  .command('create')
  .description('Create a new GitHub Project v2 board')
  .requiredOption('--owner <owner>', 'GitHub repository owner')
  .requiredOption('--repo <repo>', 'GitHub repository name')
  .requiredOption('--title <title>', 'Title of the project board')
  .action(createProject);

program
  .command('delete')
  .description('Delete a GitHub Project v2 board')
  .requiredOption('--id <id>', 'Project board ID')
  .action(deleteProject);

program
  .command('update')
  .description('Update a GitHub Project v2 board title')
  .requiredOption('--id <id>', 'Project board ID')
  .requiredOption('--title <title>', 'New title for the project board')
  .action(updateProject);

program
  .command('list-items')
  .description('List all items in a GitHub Project v2 board')
  .requiredOption('--id <id>', 'Project board ID')
  .action(listItems);

program
  .command('list-fields')
  .description('List all fields in a GitHub Project v2 board')
  .requiredOption('--id <id>', 'Project board ID')
  .action(listFields);

program
  .command('show-field')
  .description('Show details of a specific field from a GitHub Project v2 board')
  .requiredOption('--project <projectId>', 'Project board ID')
  .requiredOption('--field <fieldId>', 'Field ID to show')
  .action(showField);

program
  .command('filter-items')
  .description('List items in a GitHub Project v2 board filtered by kind, status, function, team, sig or wg')
  .requiredOption('--id <id>', 'Project board ID')
  .option('--kind <kind>', 'Filter by Kind')
  .option('--status <status>', 'Filter by Status')
  .option('--function <function>', 'Filter by Function')
  .option('--team <team>', 'Filter by Team')
  .option('--sig <sig>', 'Filter by SIG')
  .option('--wg <wg>', 'Filter by Working Group')
  .option('--no-team', 'Filter items with an empty Team field')
  .action(filterItems);

program
  .command('fix-team-field')
  .description('Fix team field values based on team labels')
  .requiredOption('--id <id>', 'Project board ID')
  .action(fixTeamField);

// Execute the program if run directly
if (require.main === module) {
  program.parse(process.argv);
}

// Export handlers for testing
module.exports = {
  fetchPaginated,
  listProjects,
  createProject,
  deleteProject,
  updateProject,
  listItems,
  listFields,
  showField,
  filterItems,
  fixTeamField
};
