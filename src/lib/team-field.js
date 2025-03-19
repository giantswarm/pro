/**
 * Team Field Management Module
 * 
 * WHY:
 * - GitHub issues often need to be assigned to specific teams for ownership
 * - Manual team assignment is time-consuming and inconsistent
 * - Automation helps ensure all issues are properly categorized and visible in team roadmaps
 * 
 * HOW:
 * - Uses a tiered approach to determine team ownership:
 *   1. First checks for team/ labels (most explicit signal)
 *   2. Then examines if the issue belongs to team-specific projects
 *   3. As a last resort, uses AI to analyze issue content and suggest a team
 * - Implements OpenAI's assistant API to make context-aware team suggestions
 * - Normalizes team names to handle variations and ensure consistency
 * 
 * WHAT:
 * - Exports functions to determine and update team field values in GitHub Project boards
 * - Provides helper functions to normalize team names and extract team information
 * - Implements an AI fallback when explicit team information is unavailable
 */

import OpenAI from 'openai';
import { batchFixFields } from './fields.js';
import { getItemByID } from './items.js';

if (!process.env.OPENAI_API_KEY) {
  console.error('Error: OPENAI_API_KEY environment variable is not set.');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const assistantId = "asst_5mbphHI9WYRAKzFqhtbJGqc9";

/**
 * Normalize team names for consistent matching
 * 
 * WHY:
 * - Team names may appear in different formats or with variations
 * - Consistent naming is essential for accurate matching with project field options
 * 
 * HOW:
 * - Applies specific corrections for known team name variations
 * - Handles special cases like "honeybadger" vs "honey badger"
 * 
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
 * 
 * WHY:
 * - Need to determine the appropriate team for an issue
 * - Multiple sources of information might indicate team ownership
 * 
 * HOW:
 * - Implements a prioritized waterfall approach to team detection:
 *   1. Team labels (most reliable signal)
 *   2. Team projects (secondary signal)
 *   3. AI analysis (fallback method)
 * - Handles different data structures from API responses
 * 
 * @param {string} itemId - The ID of the project item
 * @returns {Promise<string>} - The suggested team name
 */
export async function getTeamSuggestion(itemId, options) {
  let teamSuggestion = '';
  const item = await getItemByID(itemId);

  // Step 1: Check for team labels first
  // Handle both direct API responses and processed items
  const teamLabels = Array.isArray(item.labels) 
    ? item.labels.filter(label => {
        return typeof label === 'string' && label.toLowerCase().startsWith('team/');
      })
    : [];
  
  if (teamLabels.length === 1) {
    const labelName = teamLabels[0];
    console.log(`Found team label: ${labelName}`);
    return labelName.substring(5); // Remove "team/" prefix
  }

  // Step 2: Check if the issue belongs to team-specific projects
  const teamProjects = Array.isArray(item.projects) 
    ? item.projects.filter(project => 
        typeof project === 'string' && project.toLowerCase().includes('team')
      )
    : [];
  
  if (teamProjects.length === 1) {
    console.log(`Found team project: ${teamProjects[0]}`);
    return teamProjects[0].toLowerCase()
      .replace(/[^a-z0-9]/g, ' ')
      .replace(/\bteam\b/g, '')
      .trim();
  }

  // Step 3: As a last resort, use AI to suggest a team
  
  // Only proceed with AI suggestion if we have the required API key and assistant ID
  if (!process.env.OPENAI_API_KEY || !assistantId) {
    console.error("Error: Missing OpenAI API key or Assistant ID");
    return '';
  }
  console.log(item);
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
    let teamSuggestion = '';
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
 * Fix team field values using AI suggestions
 * 
 * WHY:
 * - Batch processing of team field updates is needed for efficiency
 * - Need a consistent interface for both CLI and web interfaces
 * 
 * HOW:
 * - Leverages the shared batchFixFields function for consistency
 * - Uses getTeamSuggestion to determine team values
 * - Normalizes team names to handle variations
 * 
 * @param {Object} options - Options including team filter or itemId
 * @param {boolean} isServerMode - Whether running in server/API mode
 * @returns {Promise<Object|number>} - Result with status and suggested function or number of updated items
 */
export async function fixTeamField(options, isServerMode = false) {
    return await batchFixFields(options, 'team', getTeamSuggestion, normalizeTeamName, isServerMode);
  } 


