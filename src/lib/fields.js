/**
 * Fields Management Module
 * 
 * WHY:
 * - GitHub Projects fields need to be programmatically managed at scale
 * - Manual field management is time-consuming and error-prone
 * - Consistent field values improve roadmap organization and filtering
 * 
 * HOW:
 * - Provides a unified interface for working with GitHub Project fields
 * - Implements AI-powered suggestions for different field types
 * - Supports both single item updates and batch processing
 * - Uses GraphQL queries to interact with GitHub Projects API
 * 
 * WHAT:
 * - Exports functions to list, fetch, and update project fields
 * - Includes utilities for batch processing of field updates
 * - Provides AI suggestion capabilities for field values
 * - Supports different field types (single select, iteration, etc.)
 */

import chalk from 'chalk';
import { fetchPaginated, graphQLWithAuth } from './api.js';
import inquirer from 'inquirer';
import ora from 'ora';
import OpenAI from 'openai';
import {
  ROADMAP_BOARD_ID,
  LIST_FIELDS_QUERY,
  ISSUE_DETAIL_QUERY,
  LIST_ITEMS_WITH_LABELS_QUERY
} from './project.js';
import { normalizeFieldValue } from './utils.js';
import { 
    filterItems, 
    filterItemsMissingField, 
    getItemByID,
    updateItemField 
} from './items.js';

// Setup OpenAI client
if (!process.env.OPENAI_API_KEY) {
  console.error('Error: OPENAI_API_KEY environment variable is not set.');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Fetch a specific item/issue by ID with detailed information
 * @param {string} itemId - The ID of the item to fetch
 * @returns {Promise<Object>} - The item with detailed information
 */
export async function fetchItemById(itemId) {
  const itemResult = await graphQLWithAuth(ISSUE_DETAIL_QUERY, { id: itemId });
  
  if (!itemResult || !itemResult.node) {
    throw new Error(`Item with ID ${itemId} not found`);
  }
  
  return itemResult.node;
}

/**
 * List all fields in the roadmap board
 * @param {boolean} returnData - If true, return data instead of logging to console
 * @returns {Promise<Array>} - Array of field objects
 */
export async function listFields(returnData = false) {
  const first = 100;
  try {
    const allFields = await fetchPaginated(
      LIST_FIELDS_QUERY,
      { projectId: ROADMAP_BOARD_ID, first },
      result => result.node.fields
    );
    
    if (!returnData) {
      if (allFields.length === 0) {
        console.log(chalk.yellow(`No fields found in board with ID ${ROADMAP_BOARD_ID}`));
      } else {
        console.log(chalk.cyan(`Fields in board [ID: ${ROADMAP_BOARD_ID}]:`));
        allFields.forEach(field => {
          let fieldInfo = `- [${field.id}] Type: ${field.__typename}, Name: ${field.name}, DataType: ${field.dataType}`;
          if (field.__typename === 'ProjectV2SingleSelectField' && field.options) {
            fieldInfo += `, Options: ${field.options.map(o => o.name).join(', ')}`;
          } else if (field.__typename === 'ProjectV2IterationField' && field.configuration) {
            fieldInfo += `, Duration: ${field.configuration.duration}, Start Day: ${field.configuration.startDay}`;
            if (field.configuration.iterations && field.configuration.iterations.length) {
              const iterations = field.configuration.iterations
                .map(iteration => `[${iteration.id}] ${iteration.title}`)
                .join(', ');
              fieldInfo += `, Iterations: ${iterations}`;
            }
          }
          console.log(chalk.green(fieldInfo));
        });
        console.log(chalk.blue(`Fetched a total of ${allFields.length} field(s).`));
      }
    }
    
    return allFields;
  } catch (error) {
    console.error(chalk.red('Error fetching fields for board:'), chalk.red(error.message));
    throw error;
  }
}

/**
 * Show details of a specific field
 * @param {Object} options - Options containing the field ID
 * @param {boolean} returnData - If true, return data instead of logging to console
 * @returns {Promise<Object>} - Field details
 */
export async function showField(options, returnData = false) {
  try {
    const allFields = await listFields(true);
    
    const field = allFields.find(f => f.id === options.field);
    if (!field) {
      if (!returnData) {
        console.log(chalk.yellow(`Field with ID ${options.field} not found in project ${ROADMAP_BOARD_ID}.`));
      }
      return null;
    }
    
    if (!returnData) {
      console.log(chalk.cyan(`Details for field [ID: ${field.id}]:`));
      console.log(chalk.green(`- Type: ${field.__typename}`));
      console.log(chalk.green(`- Name: ${field.name}`));
      console.log(chalk.green(`- DataType: ${field.dataType}`));
      
      if (field.__typename === 'ProjectV2SingleSelectField' && field.options) {
        console.log(chalk.magenta(`- Options:`));
        field.options.forEach(option => {
          console.log(chalk.green(`   - [${option.id}] ${option.name} (Color: ${option.color}, Description: ${option.description})`));
        });
      } else if (field.__typename === 'ProjectV2IterationField' && field.configuration) {
        console.log(chalk.magenta(`- Configuration:`));
        console.log(chalk.green(`   - Duration: ${field.configuration.duration}`));
        console.log(chalk.green(`   - Start Day: ${field.configuration.startDay}`));
        if (field.configuration.iterations) {
          console.log(chalk.magenta(`   - Iterations:`));
          field.configuration.iterations.forEach(iteration => {
            console.log(chalk.green(`      - [${iteration.id}] ${iteration.title} (Duration: ${iteration.duration}, Start: ${iteration.startDate})`));
          });
        }
      }
    }
    
    return field;
  } catch (error) {
    console.error(chalk.red('Error fetching field details:'), chalk.red(error.message));
    throw error;
  }
}

/**
 * Find a field by name in the roadmap board
 * @param {string} fieldName - The name of the field to find (case insensitive)
 * @returns {Promise<Object|null>} - The field object or null if not found
 */
export async function findFieldByName(fieldName) {
  const allFields = await listFields(true);
  
  const field = allFields.find(field =>
    field.__typename === 'ProjectV2SingleSelectField' &&
    field.name.toLowerCase() === fieldName.toLowerCase()
  );
  
  return field || null;
}

/**
 * Find a matching option in a field's options
 * @param {Array} options - Field options
 * @param {string} optionName - The name to match
 * @returns {Object|null} - Matching option or null
 */
export function findMatchingOption(options, optionName) {
  if (!optionName) return null;
  
  // Try direct match first
  const exactMatch = options.find(option => option.name === optionName);
  if (exactMatch) return exactMatch;
  
  // Try case-insensitive match
  const normalizedName = normalizeFieldValue(optionName);
  return options.find(option => {
    const normalizedOption = normalizeFieldValue(option.name);
    return normalizedOption === normalizedName;
  });
}

/**
 * Get AI suggestion for a field value based on issue content
 * @param {string} itemId - The ID of the project item
 * @param {Array} options - Available options
 * @param {string} fieldType - Type of field (team, function, kind)
 * @returns {Promise<string>} - The suggested value
 */
export async function getAISuggestion(itemId, options, fieldType) {
  const item = await getItemByID(itemId);
  
  const validOptionNames = options.map(option => option.name);
  const optionList = validOptionNames.join(', ');
  
  const aiSpinner = ora(`Getting ${fieldType} suggestion from ChatGPT...`).start();
  
  try {
    const prompt = `I have a GitHub issue with the following details:
Title: ${item.title}
Content: ${item.body || 'No description provided'}
Author: ${item.author}
Assignees: ${item.assignees.join(', ')}
Comments: ${item.comments.join(', ')}
Labels: ${item.labels.join(', ')}
Projects: ${item.projects.join(', ')}

Based on this information, which of the following ${fieldType}s best categorizes this issue?
Valid ${fieldType}s: ${optionList}

Please respond ONLY with the exact name of one of the valid ${fieldType}s listed above, no explanation or additional text.`;

    const response = await openai.chat.completions.create({
      model: "o3-mini",
      messages: [
        { role: "system", content: `You are a helpful assistant that categorizes issues. Only respond with one of the valid ${fieldType} names provided, nothing else.` },
        { role: "user", content: prompt }
      ],
    });
    
    let suggestion = response.choices[0]?.message?.content?.trim() || '';
    aiSpinner.succeed(`ChatGPT suggestion: ${suggestion}`);
    
    if (!validOptionNames.some(name => 
      name.toLowerCase() === suggestion.toLowerCase() || 
      suggestion.toLowerCase().includes(name.toLowerCase()) ||
      name.toLowerCase().includes(suggestion.toLowerCase())
    )) {
      console.log(chalk.yellow(`Warning: Suggested ${fieldType} "${suggestion}" is not in the list of valid ${fieldType}s.`));
    }
    
    return suggestion;
  } catch (error) {
    aiSpinner.fail(`Error getting ${fieldType} suggestion: ${error.message}`);
    return '';
  }
}

/**
 * Get a suggestion for a single item's field value but don't apply it 
 * @param {string} itemId - ID of the item to fix
 * @param {string} fieldName - Name of the field to fix
 * @param {Function} getSuggestion - Function to get a suggestion
 * @param {Function} normalizeValue - Function to normalize the suggestion
 * @returns {Promise<Object>} - Result with status and suggestion but does not apply it
 */
export async function fixSingleItemField(itemId, fieldName, getSuggestion, normalizeValue = value => value) {
  try {
    // Find the field
    const field = await findFieldByName(fieldName);
    if (!field) {
      throw new Error(`No ${fieldName} field found in this project.`);
    }
    
    // Get suggestion
    const suggestion = await getSuggestion(itemId, field.options);
    
    if (!suggestion) {
      return {
        status: 'error',
        message: `Could not get a ${fieldName} suggestion`
      };
    }
    
    // Normalize the suggestion
    const normalizedValue = normalizeValue(suggestion);
    
    // Find matching option
    const option = findMatchingOption(field.options, normalizedValue);
    
    if (!option) {
      return {
        status: 'error',
        message: `Could not find matching ${fieldName} option for "${normalizedValue}"`,
        suggestion: normalizedValue
      };
    }
    
    // Return the suggestion without applying it
    return {
      status: 'success',
      message: `Suggested ${fieldName}: "${option.name}"`,
      suggestion: option.name,
      optionId: option.id,
      fieldId: field.id
    };
  } catch (error) {
    console.error(`Error getting ${fieldName} suggestion:`, error.message);
    return {
      status: 'error',
      message: error.message
    };
  }
}

/**
 * Process multiple items to get suggestions for their field values using AI
 * This function will show interactive prompts in CLI mode and return suggestions in API mode
 * @param {Object} options - Options including filters or itemId
 * @param {string} fieldName - Field to fix (team, function, kind)
 * @param {Function} getSuggestion - Function to get a suggestion for the field
 * @param {Function} normalizeValue - Function to normalize values
 * @param {boolean} isServerMode - Whether running in server/API mode (vs CLI mode)
 * @returns {Promise<Object|Array>} - Result for single item or array of items with suggestions
 */
export async function batchFixFields(options, fieldName, getSuggestion, normalizeValue = value => value, isServerMode = false) {
  try {
    // If itemId is provided, get suggestion for a single item
    if (options.itemId) {
      // In CLI mode with a single item, we'll get the suggestion and prompt for confirmation
      // In API mode, we'll just return the suggestion without applying it
      const suggestion = await fixSingleItemField(options.itemId, fieldName, getSuggestion, normalizeValue);
      
      // If running in CLI mode, prompt for confirmation and apply if confirmed
      if (!isServerMode && suggestion.status === 'success') {
        const { confirmUpdate } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirmUpdate',
            message: `Update ${fieldName} for issue to "${suggestion.suggestion}"?`,
            default: true
          }
        ]);
        
        if (confirmUpdate) {
          try {
            // Apply the suggestion
            await updateItemField(options.itemId, suggestion.fieldId, suggestion.optionId);
            console.log(chalk.green(`✓ Updated ${fieldName} to "${suggestion.suggestion}"`));
          } catch (error) {
            console.error(chalk.red(`✗ Error applying suggestion: ${error.message}`));
          }
        } else {
          console.log(chalk.yellow(`Skipped updating ${fieldName}`));
        }
      }
      
      return suggestion;
    }
    
    // Create main spinner for the command
    const mainSpinner = ora(`Starting ${fieldName} field suggestion process...`).start();
    
    // Get the field and options
    const field = await findFieldByName(fieldName);
    
    if (!field) {
      mainSpinner.fail(`No ${fieldName} field found in this project.`);
      return [];
    }
    
    mainSpinner.succeed(`Found ${fieldName} field with ${field.options.length} options.`);
    
    // Create a new spinner for fetching items
    const itemsSpinner = ora('Fetching items from GitHub project...').start();
    
    // Now get the items
    const allItems = await fetchPaginated(
      LIST_ITEMS_WITH_LABELS_QUERY,
      { projectId: ROADMAP_BOARD_ID, first: 100 },
      result => result.node.items
    );
    
    itemsSpinner.text = `Filtering items missing ${fieldName} field...`;
    
    // Filter items missing the field value
    let itemsWithoutField = filterItemsMissingField(allItems, fieldName);
    
    // Apply team filter if specified
    if (options.team) {
      itemsSpinner.text = `Filtering issues by team: ${options.team}`;
      const filters = { team: normalizeFieldValue(options.team) };
      itemsWithoutField = filterItems(itemsWithoutField, filters);
    }
    
    itemsSpinner.succeed(`Found ${itemsWithoutField.length} items without ${fieldName} field set.`);
    
    // Prepare results array to store suggestions
    const suggestionsResults = [];
    let updatedCount = 0; // Track items updated in CLI mode for backward compatibility
    
    for (const item of itemsWithoutField) {
      if (!item.content) continue;
      
      // Fix for terminal links - use a safer approach for console output
      console.log(chalk.cyan(`\n${fieldName} suggestion for: ${item.content.title || 'Untitled'} (#${item.content.number || 'N/A'})`));
      
      // Get field suggestion
      const suggestionValue = await getSuggestion(item.id, field.options);
      
      if (!suggestionValue) {
        console.log(chalk.yellow(`Could not get a ${fieldName} suggestion for issue #${item.content.number}`));
        suggestionsResults.push({
          itemId: item.id,
          number: item.content.number,
          title: item.content.title,
          status: 'error',
          message: `Could not get a ${fieldName} suggestion`
        });
        continue;
      }
      
      // Normalize if needed
      const normalizedValue = normalizeValue(suggestionValue);
      
      // Find matching option
      const option = findMatchingOption(field.options, normalizedValue);
      
      if (!option) {
        console.log(chalk.yellow(`Could not find matching ${fieldName} option for "${normalizedValue}"`));
        suggestionsResults.push({
          itemId: item.id,
          number: item.content.number,
          title: item.content.title,
          status: 'error',
          message: `Could not find matching ${fieldName} option`,
          suggestion: normalizedValue
        });
        continue;
      }
      
      console.log(chalk.green(`Suggested ${fieldName} for issue #${item.content.number}: "${option.name}"`));
      
      // Add result to suggestions array
      suggestionsResults.push({
        itemId: item.id,
        number: item.content.number,
        title: item.content.title,
        status: 'success',
        message: `Suggested ${fieldName}: "${option.name}"`,
        suggestion: option.name,
        optionId: option.id,
        fieldId: field.id
      });
      
      // Ask for user confirmation when running in CLI mode
      if (!isServerMode) {
        const { confirmUpdate } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirmUpdate',
            message: `Update ${fieldName} for issue #${item.content.number} to "${option.name}"?`,
            default: true
          }
        ]);
        
        if (confirmUpdate) {
          // Create spinner for the update process
          const updateSpinner = ora(`Updating ${fieldName} field for issue #${item.content.number}...`).start();
          
          try {
            await updateItemField(item.id, field.id, option.id);
            updateSpinner.succeed(`Updated ${fieldName} for issue ${item.content.number} to "${option.name}"`);
            updatedCount++; // Increment count for CLI output
          } catch (error) {
            updateSpinner.fail(`Error updating ${fieldName} for issue ${item.content.number}: ${error.message}`);
          }
        } else {
          console.log(chalk.yellow(`Skipping update for issue #${item.content.number}`));
        }
      }
    }
    
    // Print summary message in CLI mode with count of updated items
    if (!isServerMode) {
      console.log(chalk.blue(`\nSummary: Updated ${fieldName} field for ${updatedCount} issues.`));
      return updatedCount; // Return count for CLI backward compatibility
    } else {
      // In API mode, return the array of results with suggestions
      console.log(chalk.blue(`Generated ${fieldName} suggestions for ${suggestionsResults.length} issues.`));
      return suggestionsResults;
    }
  } catch (error) {
    // Stop any active spinner on error
    ora().fail(`Error processing ${fieldName} fields`);
    console.error(chalk.red(`Error processing ${fieldName} fields:`), chalk.red(error.message));
    throw error;
  }
} 