import chalk from 'chalk';
import OpenAI from 'openai';
import { graphQLWithAuth, fetchPaginated } from './api.js';
import {
  ROADMAP_BOARD_ID,
  LIST_FIELDS_QUERY,
  UPDATE_ITEM_FIELD_MUTATION,
  ISSUE_DETAIL_QUERY
} from './project.js';
import { 
  fixSingleItemField,
  batchFixFields
} from './fields.js';

if (!process.env.OPENAI_API_KEY) {
  console.error('Error: OPENAI_API_KEY environment variable is not set.');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const assistantId = "asst_5mbphHI9WYRAKzFqhtbJGqc9";

/**
 * Normalize team names for consistent matching
 * @param {string} teamName - The team name to normalize
 * @returns {string} - Normalized team name
 */
function normalizeTeamName(teamName) {
  if (!teamName) return '';
  
  let normalized = teamName;
  if (normalized === "honeybadger") normalized = "honey badger";
  if (normalized === "team") normalized = "up";
  
  return normalized;
}

/**
 * Get team suggestion for a single item
 * @param {Object} item - The item object
 * @returns {Promise<string>} - The suggested team name
 */
async function getTeamSuggestion(item, options) {
  // First try to get team from labels
  if (item.content && item.content.labels && item.content.labels.nodes) {
    const teamLabels = item.content.labels.nodes.filter(label =>
      label.name.toLowerCase().startsWith('team/')
    );
    
    if (teamLabels.length === 1) {
      return teamLabels[0].name.substring(5);
    }
  }
  
  // If no team label found, use AI to suggest a team
  return await getTeamSuggestionForIssue(item);
}

export async function getTeamSuggestionForIssue(item) {
  let teamSuggestion = '';

  if (item && item.projects) {
      teamProjects = item.projects.filter(project =>
        project.toLowerCase().includes('team')
      );
    }
    if (teamProjects.length === 1) {
      console.log(`Found team project: ${teamProjects[0]}`);
      teamSuggestion = teamProjects[0].toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\bteam\b/g, '').trim();
      return teamSuggestion;
    }
    if (item.comments.join(', ').includes('#iamarobot')) {
      console.log("Issue already has a comment from the bot.");
      return 'skip';
    }
  
  if (!title) {
    console.error("Error: Missing title for issue.");
    return '';
  }
  if (!body) {
    body = "TBD";
  }
  
  const prompt = `Determine the appropriate team for the following issue:
Title: ${item.title}
Content: ${item.body}
Author: ${item.author}
Comments: ${item.comments.join(', ')}
Assignees: ${item.assignees.join(', ')}
Labels: ${item.labels.join(', ')}
Projects: ${item.projects.join(', ')}

Reply with the team name that should handle this issue.
`;
 
  try {
    const thread = await openai.beta.threads.create({
      messages: [
        { role: 'user', content: prompt }
      ],
    });
    const threadId = thread.id;
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
      return '';
    }
  } catch (error) {
    console.error('Error getting team suggestion from OpenAI:', error.message);
    return '';
  }
}

/**
 * Fix team field value for a specific item
 * @param {Object} options - Options containing the item ID
 * @returns {Promise<Object|number>} - Result with status and suggested team or count of updated items
 */
export async function fixTeamField(options) {
  try {
    // If itemId is provided, fix a single item
    if (options.itemId) {
      return await fixSingleItemField(
        options.itemId, 
        'team', 
        getTeamSuggestion, 
        normalizeTeamName
      );
    }
    
    // For team fields, we need more complex handling with comment support
    // so we use a custom batch implementation instead of the shared one
    const result = await batchFixFields(options, 'team', getTeamSuggestion, normalizeTeamName);
    
    // Additional team-specific processing could be added here if needed
    
    return result;
  } catch (error) {
    console.error(chalk.red('Error fixing team fields:'), chalk.red(error.message));
    throw error;
  }
}

/**
 * Fix team field for a single item
 * @param {string} itemId - The ID of the item to fix
 * @returns {Promise<Object>} - Result with status and suggested team
 */
async function fixSingleItemTeamField(itemId) {
  try {
    // Fetch the specific item directly
    const item = await getItemByID(itemId);
    
    // Fetch all fields to find the team field
    const allFields = await fetchPaginated(
      LIST_FIELDS_QUERY,
      { projectId: ROADMAP_BOARD_ID, first: 100 },
      result => result.node.fields
    );
    
    // Find team field
    const teamField = allFields.find(field =>
      field.__typename === 'ProjectV2SingleSelectField' &&
      field.name.toLowerCase() === 'team'
    );
    
    if (!teamField) {
      throw new Error('No team field found in this project.');
    }
    
    // Get team suggestion
    let teamName;
    if (labels !== "None" && labels) {
      const teamLabels = labels.nodes.filter(label =>
        label.name.toLowerCase().startsWith('team/')
      );
      
      if (teamLabels.length === 1) {
        teamName = teamLabels[0].name.substring(5);
      }
    }
    
    // If no team label found, use AI to suggest a team
    if (!teamName) {
      teamName = await getTeamSuggestionForIssue(item);
    }
    
    // Normalize team names
    if (teamName === "honeybadger") teamName = "honey badger";
    if (teamName === "team") teamName = "up";
    
    // Find matching team option
    const teamOption = teamField.options.find(option => {
      // Direct string comparison - require exact match
      return option.name === teamName;
    });
    
    if (!teamOption) {
      return {
        status: 'error',
        message: `Could not find matching team option for suggested team "${teamName}"`
      };
    }
    
    // Update the item's team field
    await graphQLWithAuth(UPDATE_ITEM_FIELD_MUTATION, {
      projectId: ROADMAP_BOARD_ID,
      itemId: item.id,
      fieldId: teamField.id,
      value: { singleSelectOptionId: teamOption.id }
    });
    
    return {
      status: 'success',
      message: `Updated team for issue ${item.content.number} to "${teamOption.name}"`,
      suggestion: teamOption.name
    };
  } catch (error) {
    console.error('Error fixing team field for item:', error.message);
    return {
      status: 'error',
      message: error.message
    };
  }
} 