import chalk from 'chalk';
import inquirer from 'inquirer';
import { graphQLWithAuth, fetchPaginated } from '../lib/api.js';
import {
  LIST_ITEMS_WITH_LABELS_QUERY,
  LIST_FIELDS_QUERY,
  UPDATE_ITEM_FIELD_MUTATION,
  POST_ISSUE_COMMENT_MUTATION,
  KIND_FIELD_ID
} from '../lib/project.js';
import { makeIssueLink } from '../lib/utils.js';
import OpenAI from 'openai';

// Setup OpenAI client
if (!process.env.OPENAI_API_KEY) {
  console.error('Error: OPENAI_API_KEY environment variable is not set.');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Helper function to normalize team names for comparison
 * Converts to lowercase and removes special characters including emojis
 * @param {string} name - Team name to normalize
 * @returns {string} - Normalized team name
 */
function normalizeTeamName(name) {
  if (!name) return '';
  // Convert to lowercase and remove emojis and special characters
  return name.toLowerCase()
    // Remove emojis and special unicode characters
    .replace(/[\u{1F600}-\u{1F64F}|\u{1F300}-\u{1F5FF}|\u{1F680}-\u{1F6FF}|\u{2600}-\u{26FF}|\u{2700}-\u{27BF}|\u{1F900}-\u{1F9FF}|\u{1F1E0}-\u{1F1FF}|\u{1F100}-\u{1F1FF}|\u{E000}-\u{F8FF}]/gu, '')
    // Remove other special characters but keep alphanumeric and spaces
    .replace(/[^\w\s]/g, '')
    // Trim extra whitespace
    .trim();
}

/**
 * Get kind suggestion from ChatGPT based on issue content and available options
 * @param {Object} item - The project item containing issue details
 * @param {Array} kindOptions - Available kind options from the project
 * @returns {Promise<string>} - The suggested kind name
 */
async function getKindSuggestionForIssue(item, kindOptions) {
  let title = item.content?.title || '';
  let body = '';
  
  // Create a list of valid kind names
  const validKindNames = kindOptions.map(option => option.name);
  const kindList = validKindNames.join(', ');
  
  try {
    // Construct a prompt for ChatGPT that includes the valid options
    const prompt = `I have a GitHub issue with the following details:
Title: ${title}
Body: ${body || 'No description provided'}

Based on this information, which of the following kinds best categorizes this issue?
Valid kinds: ${kindList}

Please respond ONLY with the exact name of one of the valid kinds listed above, no explanation or additional text.`;

    // Call ChatGPT API - o3-mini doesn't support temperature or max_tokens parameters
    const response = await openai.chat.completions.create({
      model: "o3-mini",
      messages: [
        { role: "system", content: "You are a helpful assistant that categorizes issues. Only respond with one of the valid kind names provided, nothing else." },
        { role: "user", content: prompt }
      ],
      // No temperature or max_completion_tokens parameters for o3-mini
    });
    
    // Extract the suggested kind name
    let kindSuggestion = response.choices[0]?.message?.content?.trim() || '';
    console.log("ChatGPT suggestion:", kindSuggestion);
    
    // Verify the suggestion is in the list of valid kinds
    if (!validKindNames.some(name => 
      name.toLowerCase() === kindSuggestion.toLowerCase() || 
      kindSuggestion.toLowerCase().includes(name.toLowerCase()) ||
      name.toLowerCase().includes(kindSuggestion.toLowerCase())
    )) {
      console.log(chalk.yellow(`Warning: Suggested kind "${kindSuggestion}" is not in the list of valid kinds.`));
    }
    
    return kindSuggestion;
  } catch (error) {
    console.error('Error getting kind suggestion from ChatGPT:', error.message);
    return '';
  }
}

export async function fixKindFieldCommand(options) {
  const first = 100;
  try {
    // First, get all fields to find the kind field and its options
    const allFields = await fetchPaginated(
      LIST_FIELDS_QUERY,
      { projectId: options.id, first },
      result => result.node.fields
    );
    
    // Find kind field
    const kindField = allFields.find(field =>
      field.__typename === 'ProjectV2SingleSelectField' &&
      field.name.toLowerCase() === 'kind'
    );
    
    if (!kindField) {
      console.log(chalk.yellow('No kind field found in this project.'));
      return;
    }
    
    console.log(chalk.cyan(`Found kind field with ${kindField.options.length} options.`));
    console.log('Available kinds:');
    kindField.options.forEach(option => {
      console.log(chalk.blue(`- ${option.name}`));
    });
    
    // Now get the items
    const allItems = await fetchPaginated(
      LIST_ITEMS_WITH_LABELS_QUERY,
      { projectId: options.id, first },
      result => result.node.items
    );
    
    // Filter items missing a kind value
    let itemsWithoutKind = allItems.filter(item => {
      if (!item.fieldValues || !item.fieldValues.nodes) return true;
      return !item.fieldValues.nodes.some(node =>
        node.field &&
        node.field.name &&
        node.field.name.toLowerCase() === 'kind' &&
        typeof node.name === 'string' &&
        node.name.trim() !== ''
      );
    });
    
    // Apply team filter if specified
    if (options.team) {
      const normalizedTeamFilter = normalizeTeamName(options.team);
      console.log(chalk.cyan(`Filtering issues by team: ${options.team}`));
      console.log(chalk.cyan(`(Using normalized name: "${normalizedTeamFilter}" for matching)`));
      
      itemsWithoutKind = itemsWithoutKind.filter(item => {
        // Check if the item has team field
        return item.fieldValues &&
               item.fieldValues.nodes &&
               item.fieldValues.nodes.some(node => {
                 if (!node.field ||
                     !node.field.name ||
                     node.field.name.toLowerCase() !== 'team' ||
                     typeof node.name !== 'string') {
                   return false;
                 }
                 
                 const normalizedTeamName = normalizeTeamName(node.name);
                 
                 // Check if the normalized team names match or contain each other
                 return normalizedTeamName.includes(normalizedTeamFilter) ||
                        normalizedTeamFilter.includes(normalizedTeamName);
               });
      });
    } else if (options.team === false) {
      // Handle --no-team option
      console.log(chalk.cyan('Filtering items with no team assigned'));
      itemsWithoutKind = itemsWithoutKind.filter(item => {
        // Check if the item has no team field or empty team field
        return !(item.fieldValues && item.fieldValues.nodes && item.fieldValues.nodes.some(node =>
          node.field &&
          node.field.name &&
          node.field.name.toLowerCase() === 'team' &&
          typeof node.name === 'string' &&
          node.name.trim() !== ''
        ));
      });
    }
    
    console.log(chalk.cyan(`Found ${itemsWithoutKind.length} items without kind field set.`));
    let updatedCount = 0;
    
    for (const item of itemsWithoutKind) {
      if (!item.content) continue;
      
      // Fix for terminal links - use a safer approach for console output
      console.log(chalk.cyan(`\nKind suggestion for: ${item.content.title || 'Untitled'} (#${item.content.number || 'N/A'})`));
      
      // Get kind suggestion from ChatGPT with the list of valid options
      const kindName = await getKindSuggestionForIssue(item, kindField.options);
      
      if (!kindName) {
        console.log(chalk.yellow(`Could not get a kind suggestion for issue #${item.content.number}`));
        
        const { postComment } = await inquirer.prompt([
          { type: 'confirm', name: 'postComment', message: `No kind provided for issue ${item.content.number}. Post a comment?` }
        ]);
        
        if (postComment) {
          graphQLWithAuth(POST_ISSUE_COMMENT_MUTATION, {
            issueId: item.content.id,
            body: "Could not determine the kind for this issue. Please suggest an appropriate kind (Feature, Bug, Documentation, etc.)."
          }).catch(() => {});
        }
        continue;
      }
      
      // Find matching kind option
      const kindOption = kindField.options.find(option => {
        const optionNameLower = option.name.toLowerCase().replace(/[^\x00-\x7F]/g, '').trim();
        const kindNameLower = kindName.toLowerCase().trim();
        return optionNameLower.includes(kindNameLower) || kindNameLower.includes(optionNameLower);
      });
      
      if (!kindOption) {
        console.log(chalk.yellow(`Could not find matching kind option for "${kindName}"`));
        continue;
      }
      
      // Ask for user confirmation before updating
      const { confirmUpdate } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmUpdate',
          message: `Update kind for issue #${item.content.number} to "${kindOption.name}"?`,
          default: true
        }
      ]);
      
      if (!confirmUpdate) {
        console.log(chalk.yellow(`Skipping update for issue #${item.content.number}`));
        continue;
      }
      
      try {
        await graphQLWithAuth(UPDATE_ITEM_FIELD_MUTATION, {
          projectId: options.id,
          itemId: item.id,
          fieldId: kindField.id,
          value: { singleSelectOptionId: kindOption.id }
        });
        
        updatedCount++;
        console.log(chalk.green(`Updated kind for issue ${item.content.number} to "${kindOption.name}"`));
      } catch (error) {
        console.error(chalk.red(`Error updating kind for issue ${item.content.number}:`), chalk.red(error.message));
      }
    }
    
    console.log(chalk.blue(`Updated kind field for ${updatedCount} issues.`));
  } catch (error) {
    console.error(chalk.red('Error fixing kind fields:'), chalk.red(error.message));
  }
} 