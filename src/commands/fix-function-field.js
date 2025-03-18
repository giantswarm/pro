import chalk from 'chalk';
import inquirer from 'inquirer';
import { graphQLWithAuth, fetchPaginated } from '../lib/api.js';
import {
  LIST_ITEMS_WITH_LABELS_QUERY,
  LIST_FIELDS_QUERY,
  UPDATE_ITEM_FIELD_MUTATION,
  POST_ISSUE_COMMENT_MUTATION,
  FUNCTION_FIELD_ID
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
 * Get function suggestion from ChatGPT based on issue content and available options
 * @param {Object} item - The project item containing issue details
 * @param {Array} functionOptions - Available function options from the project
 * @returns {Promise<string>} - The suggested function name
 */
async function getFunctionSuggestionForIssue(item, functionOptions) {
  let title = item.content?.title || '';
  let body = '';
  
  // Create a list of valid function names
  const validFunctionNames = functionOptions.map(option => option.name);
  const functionList = validFunctionNames.join(', ');
  
  try {
    // Construct a prompt for ChatGPT that includes the valid options
    const prompt = `I have a GitHub issue with the following details:
Title: ${title}
Body: ${body || 'No description provided'}

Based on this information, which of the following functions best categorizes this issue?
Valid functions: ${functionList}

Please respond ONLY with the exact name of one of the valid functions listed above, no explanation or additional text.`;

    // Call ChatGPT API - o3-mini doesn't support temperature or max_tokens parameters
    const response = await openai.chat.completions.create({
      model: "o3-mini",
      messages: [
        { role: "system", content: "You are a helpful assistant that categorizes issues. Only respond with one of the valid function names provided, nothing else." },
        { role: "user", content: prompt }
      ],
      // No temperature or max_completion_tokens parameters for o3-mini
    });
    
    // Extract the suggested function name
    let functionSuggestion = response.choices[0]?.message?.content?.trim() || '';
    console.log("ChatGPT suggestion:", functionSuggestion);
    
    // Verify the suggestion is in the list of valid functions
    if (!validFunctionNames.some(name => 
      name.toLowerCase() === functionSuggestion.toLowerCase() || 
      functionSuggestion.toLowerCase().includes(name.toLowerCase()) ||
      name.toLowerCase().includes(functionSuggestion.toLowerCase())
    )) {
      console.log(chalk.yellow(`Warning: Suggested function "${functionSuggestion}" is not in the list of valid functions.`));
    }
    
    return functionSuggestion;
  } catch (error) {
    console.error('Error getting function suggestion from ChatGPT:', error.message);
    return '';
  }
}

export async function fixFunctionFieldCommand(options) {
  const first = 100;
  try {
    // First, get all fields to find the function field and its options
    const allFields = await fetchPaginated(
      LIST_FIELDS_QUERY,
      { projectId: options.id, first },
      result => result.node.fields
    );
    
    // Find function field
    const functionField = allFields.find(field =>
      field.__typename === 'ProjectV2SingleSelectField' &&
      field.name.toLowerCase() === 'function'
    );
    
    if (!functionField) {
      console.log(chalk.yellow('No function field found in this project.'));
      return;
    }
    
    console.log(chalk.cyan(`Found function field with ${functionField.options.length} options.`));
    console.log('Available functions:');
    functionField.options.forEach(option => {
      console.log(chalk.blue(`- ${option.name}`));
    });
    
    // Now get the items
    const allItems = await fetchPaginated(
      LIST_ITEMS_WITH_LABELS_QUERY,
      { projectId: options.id, first },
      result => result.node.items
    );
    
    // Filter items missing a function value
    let itemsWithoutFunction = allItems.filter(item => {
      if (!item.fieldValues || !item.fieldValues.nodes) return true;
      return !item.fieldValues.nodes.some(node =>
        node.field &&
        node.field.name &&
        node.field.name.toLowerCase() === 'function' &&
        typeof node.name === 'string' &&
        node.name.trim() !== ''
      );
    });
    
    // Apply team filter if specified
    if (options.team) {
      console.log(chalk.cyan(`Filtering issues by team: ${options.team}`));
      itemsWithoutFunction = itemsWithoutFunction.filter(item => {
        // Check if the item has team field
        const hasTeamField = item.fieldValues && item.fieldValues.nodes && item.fieldValues.nodes.some(node =>
          node.field &&
          node.field.name &&
          node.field.name.toLowerCase() === 'team' &&
          typeof node.name === 'string' &&
          node.name.toLowerCase() === options.team.toLowerCase()
        );
        return hasTeamField;
      });
    } else if (options.team === false) {
      // Handle --no-team option
      console.log(chalk.cyan('Filtering items with no team assigned'));
      itemsWithoutFunction = itemsWithoutFunction.filter(item => {
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
    
    console.log(chalk.cyan(`Found ${itemsWithoutFunction.length} items without function field set.`));
    let updatedCount = 0;
    
    for (const item of itemsWithoutFunction) {
      if (!item.content) continue;
      
      // Fix for terminal links - use a safer approach for console output
      console.log(chalk.cyan(`\nFunction suggestion for: ${item.content.title || 'Untitled'} (#${item.content.number || 'N/A'})`));
      
      // Get function suggestion from ChatGPT with the list of valid options
      const functionName = await getFunctionSuggestionForIssue(item, functionField.options);
      
      if (!functionName) {
        console.log(chalk.yellow(`Could not get a function suggestion for issue #${item.content.number}`));
        
        const { postComment } = await inquirer.prompt([
          { type: 'confirm', name: 'postComment', message: `No function provided for issue ${item.content.number}. Post a comment?` }
        ]);
        
        if (postComment) {
          graphQLWithAuth(POST_ISSUE_COMMENT_MUTATION, {
            issueId: item.content.id,
            body: "Could not determine the function for this issue. Please suggest an appropriate function (DevOps, Development, Design, etc.)."
          }).catch(() => {});
        }
        continue;
      }
      
      // Find matching function option
      const functionOption = functionField.options.find(option => {
        const optionNameLower = option.name.toLowerCase().replace(/[^\x00-\x7F]/g, '').trim();
        const functionNameLower = functionName.toLowerCase().trim();
        return optionNameLower.includes(functionNameLower) || functionNameLower.includes(optionNameLower);
      });
      
      if (!functionOption) {
        console.log(chalk.yellow(`Could not find matching function option for "${functionName}"`));
        continue;
      }
      
      // Ask for user confirmation before updating
      const { confirmUpdate } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmUpdate',
          message: `Update function for issue #${item.content.number} to "${functionOption.name}"?`,
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
          fieldId: functionField.id,
          value: { singleSelectOptionId: functionOption.id }
        });
        
        updatedCount++;
        console.log(chalk.green(`Updated function for issue ${item.content.number} to "${functionOption.name}"`));
      } catch (error) {
        console.error(chalk.red(`Error updating function for issue ${item.content.number}:`), chalk.red(error.message));
      }
    }
    
    console.log(chalk.blue(`Updated function field for ${updatedCount} issues.`));
  } catch (error) {
    console.error(chalk.red('Error fixing function fields:'), chalk.red(error.message));
  }
} 