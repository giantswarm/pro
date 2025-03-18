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
 * Get function suggestion from ChatGPT based on issue content
 * @param {Object} item - The project item containing issue details
 * @returns {Promise<string>} - The suggested function name
 */
async function getFunctionSuggestionForIssue(item) {
  let title = item.content?.title || '';
  let body = '';
  
  try {
    // Construct a prompt for ChatGPT
    const prompt = `I have a GitHub issue with the following details:
Title: ${title}
Body: ${body || 'No description provided'}

Based on this information, what would be an appropriate function name (like "DevOps", "Development", "Design", "Product Management", etc.) for categorizing this issue? Please just respond with the function name, nothing else.`;

    // Call ChatGPT API - o3-mini doesn't support temperature or max_tokens parameters
    const response = await openai.chat.completions.create({
      model: "o3-mini",
      messages: [
        { role: "system", content: "You are a helpful assistant that provides concise, direct answers. Only respond with the function name, no explanation or additional text." },
        { role: "user", content: prompt }
      ],
      // No temperature or max_completion_tokens parameters for o3-mini
    });
    
    // Extract the suggested function name
    let functionSuggestion = response.choices[0]?.message?.content?.trim() || '';
    console.log("ChatGPT suggestion:", functionSuggestion);
    
    return functionSuggestion;
  } catch (error) {
    console.error('Error getting function suggestion from ChatGPT:', error.message);
    return '';
  }
}

export async function fixFunctionFieldCommand(options) {
  const first = 100;
  try {
    const allItems = await fetchPaginated(
      LIST_ITEMS_WITH_LABELS_QUERY,
      { projectId: options.id, first },
      result => result.node.items
    );
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
    
    // Filter items missing a function value
    const itemsWithoutFunction = allItems.filter(item => {
      if (!item.fieldValues || !item.fieldValues.nodes) return true;
      return !item.fieldValues.nodes.some(node =>
        node.field &&
        node.field.name &&
        node.field.name.toLowerCase() === 'function' &&
        typeof node.name === 'string' &&
        node.name.trim() !== ''
      );
    });
    
    console.log(chalk.cyan(`Found ${itemsWithoutFunction.length} items without function field set.`));
    let updatedCount = 0;
    
    for (const item of itemsWithoutFunction) {
      if (!item.content) continue;
      
      // Fix for terminal links - use a safer approach for console output
      console.log(chalk.cyan(`Function suggestion for: ${item.content.title || 'Untitled'} (#${item.content.number || 'N/A'})`));
      
      // Get function suggestion from ChatGPT
      const functionName = await getFunctionSuggestionForIssue(item);
      
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