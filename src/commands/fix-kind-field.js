import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { graphQLWithAuth, fetchPaginated } from '../lib/api.js';
import {
  LIST_ITEMS_WITH_LABELS_QUERY,
  LIST_FIELDS_QUERY,
  UPDATE_ITEM_FIELD_MUTATION,
  POST_ISSUE_COMMENT_MUTATION,
  KIND_FIELD_ID,
  ISSUE_DETAIL_QUERY
} from '../lib/project.js';
import { makeIssueLink, normalizeFieldValue } from '../lib/utils.js';
import OpenAI from 'openai';

// Setup OpenAI client
if (!process.env.OPENAI_API_KEY) {
  console.error('Error: OPENAI_API_KEY environment variable is not set.');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Get kind suggestion from ChatGPT based on issue content and available options
 * @param {Object} item - The project item containing issue details
 * @param {Array} kindOptions - Available kind options from the project
 * @returns {Promise<string>} - The suggested kind name
 */
async function getKindSuggestionForIssue(item, kindOptions) {
  let title = item.content?.title || '';
  let body = '';
  let author = '';
  let assignees = 'None';
  let comments = 'None';
  
  // Create a spinner for fetching issue details
  const detailSpinner = ora('Fetching issue details...').start();
  
  try {
    // Fetch more detailed issue information
    const issueDetails = await graphQLWithAuth(ISSUE_DETAIL_QUERY, { id: item.id });
    if (issueDetails && issueDetails.node && issueDetails.node.content) {
      author = issueDetails.node.content.author.login || '';
      body = issueDetails.node.content.bodyText || '';
      if (issueDetails.node.content.assignees && issueDetails.node.content.assignees.nodes) {
        assignees = issueDetails.node.content.assignees.nodes.map(a => a.login).join(', ');
      }
      if (issueDetails.node.content.comments && issueDetails.node.content.comments.nodes) {
        comments = issueDetails.node.content.comments.nodes.map(c => c.bodyText).join('\n');
      }
      detailSpinner.succeed('Issue details fetched successfully');
    } else {
      detailSpinner.warn('Could not fetch complete issue details');
    }
  } catch (err) {
    detailSpinner.fail(`Error fetching issue details: ${err.message}`);
  }
  
  // Create a list of valid kind names
  const validKindNames = kindOptions.map(option => option.name);
  const kindList = validKindNames.join(', ');
  
  // Create a spinner for the AI suggestion
  const aiSpinner = ora('Getting kind suggestion from ChatGPT...').start();
  
  try {
    // Construct a prompt for ChatGPT that includes the valid options and all issue details
    const prompt = `I have a GitHub issue with the following details:
Title: ${title}
Content: ${body || 'No description provided'}
Author: ${author}
Assignees: ${assignees}
Comments: ${comments}

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
    aiSpinner.succeed(`ChatGPT suggestion: ${kindSuggestion}`);
    
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
    aiSpinner.fail(`Error getting kind suggestion: ${error.message}`);
    return '';
  }
}

export async function fixKindFieldCommand(options) {
  const first = 100;
  try {
    // Create main spinner for the command
    const mainSpinner = ora('Starting kind field fix process...').start();
    
    // First, get all fields to find the kind field and its options
    mainSpinner.text = 'Fetching project fields...';
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
      mainSpinner.fail('No kind field found in this project.');
      return;
    }
    
    mainSpinner.succeed(`Found kind field with ${kindField.options.length} options.`);
    console.log('Available kinds:');
    kindField.options.forEach(option => {
      console.log(chalk.blue(`- ${option.name}`));
    });
    
    // Create a new spinner for fetching items
    const itemsSpinner = ora('Fetching items from GitHub project...').start();
    
    // Now get the items
    const allItems = await fetchPaginated(
      LIST_ITEMS_WITH_LABELS_QUERY,
      { projectId: options.id, first },
      result => result.node.items
    );
    
    itemsSpinner.text = 'Filtering items missing kind field...';
    
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
      itemsSpinner.text = `Filtering issues by team: ${options.team}`;
      const normalizedTeamFilter = normalizeFieldValue(options.team);
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
                 
                 const normalizedTeamName = normalizeFieldValue(node.name);
                 
                 // Check if the normalized team names match or contain each other
                 return normalizedTeamName.includes(normalizedTeamFilter) ||
                        normalizedTeamFilter.includes(normalizedTeamName);
               });
      });
    } else if (options.team === false) {
      // Handle --no-team option
      itemsSpinner.text = 'Filtering items with no team assigned';
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
    
    itemsSpinner.succeed(`Found ${itemsWithoutKind.length} items without kind field set.`);
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
          const commentSpinner = ora('Posting comment to issue...').start();
          try {
            await graphQLWithAuth(POST_ISSUE_COMMENT_MUTATION, {
              issueId: item.content.id,
              body: "Could not determine the kind for this issue. Please suggest an appropriate kind (Feature, Bug, Documentation, etc.)."
            });
            commentSpinner.succeed('Comment posted successfully');
          } catch (error) {
            commentSpinner.fail(`Failed to post comment: ${error.message}`);
          }
        }
        continue;
      }
      
      // Find matching kind option
      const kindOption = kindField.options.find(option => {
        const normalizedOptionName = normalizeFieldValue(option.name);
        const normalizedSuggestion = normalizeFieldValue(kindName);
        return normalizedOptionName.includes(normalizedSuggestion) || 
               normalizedSuggestion.includes(normalizedOptionName);
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
      
      // Create spinner for the update process
      const updateSpinner = ora(`Updating kind field for issue #${item.content.number}...`).start();
      
      try {
        await graphQLWithAuth(UPDATE_ITEM_FIELD_MUTATION, {
          projectId: options.id,
          itemId: item.id,
          fieldId: kindField.id,
          value: { singleSelectOptionId: kindOption.id }
        });
        
        updatedCount++;
        updateSpinner.succeed(`Updated kind for issue ${item.content.number} to "${kindOption.name}"`);
      } catch (error) {
        updateSpinner.fail(`Error updating kind for issue ${item.content.number}: ${error.message}`);
      }
    }
    
    console.log(chalk.blue(`Updated kind field for ${updatedCount} issues.`));
  } catch (error) {
    // Stop any active spinner on error
    ora().fail('Error fixing kind fields');
    console.error(chalk.red('Error fixing kind fields:'), chalk.red(error.message));
  }
} 