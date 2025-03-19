/**
 * Items Management Module
 * 
 * WHY:
 * - Need to efficiently retrieve and manipulate GitHub Project items
 * - Need consistent filtering and processing of roadmap items
 * - Project boards can contain hundreds of items requiring batch operations
 * 
 * HOW:
 * - Uses GitHub's GraphQL API to fetch and update items
 * - Implements filtering logic for various item attributes
 * - Provides utilities for extracting relevant information from items
 * - Handles pagination for large result sets
 * 
 * WHAT:
 * - Exports functions to list, filter, and update project items
 * - Provides helper functions to extract item details for AI processing
 * - Implements filtering by team, function, kind, and other criteria
 * - Manages field updates for project items
 */

import chalk from 'chalk';
import ora from 'ora';
import { fetchPaginated, graphQLWithAuth } from './api.js';
import {
  ROADMAP_BOARD_ID,
  LIST_ITEMS_QUERY,
  ISSUE_DETAIL_QUERY,
  UPDATE_ITEM_FIELD_MUTATION
} from './project.js';
import { makeIssueLink, normalizeFieldValue } from './utils.js';

/**
 * Get detailed information about an item for AI processing
 * @param {Object} item - The item to extract data from
 * @returns {Promise<Object>} - Extracted item data for AI prompts
 */
export async function getItemByID(itemId) {
    let item = {
        number: '',
        title: '',
        body: '',
        author: '',
        assignees: [],
        comments: [],
        labels: [],
        projects: []
    }
    
    const detailSpinner = ora('Fetching issue details...').start();
    
    try {
      const issueDetails = await graphQLWithAuth(ISSUE_DETAIL_QUERY, { id: itemId });
      if (issueDetails && issueDetails.node && issueDetails.node.content) {
        item.number = issueDetails.node.content.number || '';
        item.title = issueDetails.node.content.title || '';
        item.author = issueDetails.node.content.author?.login || '';
        item.body = issueDetails.node.content.bodyText || '';
        if (issueDetails.node.content.assignees && issueDetails.node.content.assignees.nodes) {
          item.assignees = issueDetails.node.content.assignees.nodes.map(a => a.login);
        }
        if (issueDetails.node.content.comments && issueDetails.node.content.comments.nodes) {
          item.comments = issueDetails.node.content.comments.nodes.map(c => c.bodyText);
        }
        if (issueDetails.node.content.labels && issueDetails.node.content.labels.nodes) {
          item.labels = issueDetails.node.content.labels.nodes.map(l => l.name);
        }
        if (issueDetails.node.content.projectsV2 && issueDetails.node.content.projectsV2.nodes) {
          item.projects = issueDetails.node.content.projectsV2.nodes.map(p => p.title);
        }

        detailSpinner.succeed('Issue details fetched successfully');
      } else {
        detailSpinner.warn('Could not fetch complete issue details');
      }
    } catch (err) {
      detailSpinner.fail(`Error fetching issue details: ${err.message}`);
    }
    
    return item;
  }

/**
 * List and filter items in the roadmap board
 * @param {Object} options - Filtering options
 * @returns {Promise<Object>} - Result with status and data
 */
export async function listItems(options) {
  const first = 100;
  try {
    // Build filter criteria based on provided options
    const filters = {};
    ['kind', 'status', 'function', 'sig', 'wg'].forEach(key => {
      if (options[key]) {
        filters[key === 'wg' ? 'working group' : key] = normalizeFieldValue(options[key]);
      }
    });
    if (options.team !== undefined && options.team !== 'all') {
      filters['team'] = normalizeFieldValue(options.team);
    }

    // Create a spinner with a message
    const spinner = ora('Fetching items from GitHub project...').start();
    
    // Use the projectId from options with fallback to ROADMAP_BOARD_ID for backward compatibility
    const projectId = ROADMAP_BOARD_ID;
    
    if (!projectId) {
      spinner.fail('Project ID is required');
      return { error: 'Project ID is required' };
    }
    
    // Fetch all items with proper pagination
    const allItems = await fetchPaginated(
      LIST_ITEMS_QUERY,
      { projectId, first },
      result => {
        // Return the proper structure for pagination
        if (!result?.node?.items) {
          return { nodes: [], pageInfo: { hasNextPage: false } };
        }
        return {
          nodes: result.node.items.nodes || [],
          pageInfo: result.node.items.pageInfo || { hasNextPage: false }
        };
      }
    );

    spinner.text = 'Applying filters to items...';
    
    // Apply filters
    const filtered = allItems.filter(item => {
      if (!item.fieldValues || !item.fieldValues.nodes) return false;
      
      // Apply --no-team filter if specified
      if (options.noTeam === true) {
        const hasTeam = item.fieldValues.nodes.some(node => 
          node.field &&
          node.field.name &&
          node.field.name.toLowerCase() === 'team' &&
          typeof node.name === 'string' &&
          node.name.trim() !== ''
        );
        if (hasTeam) return false;
      }
      
      // Apply other filters with normalization for case insensitivity and emojis
      return Object.entries(filters).every(([filterKey, normalizedFilterValue]) => {
        // If the filter value is 'all', match any value
        if (normalizedFilterValue === 'all') return true;
        
        const matchingField = item.fieldValues.nodes.find(node => {
          if (!node.field) return false;
          return node.field.name && node.field.name.toLowerCase() === filterKey;
        });
        
        if (!matchingField) return false;
        
        const normalizedFieldValue = normalizeFieldValue(matchingField.name || '');
        
        // Consider match if either contains the other after normalization
        return normalizedFieldValue.includes(normalizedFilterValue) || 
               normalizedFilterValue.includes(normalizedFieldValue);
      });
    });
    
    // Stop the spinner
    spinner.succeed(`Found ${filtered.length} matching items`);
    
    if (filtered.length === 0) {
      console.log(chalk.yellow(`No items found matching provided filters.`));
    } else {
      console.log(chalk.cyan(`Filtered items:`));
      filtered.forEach(item => {
        let output = `- [${item.id}] `;
        if (item.content && Object.keys(item.content).length > 0) {
          const title = item.content.title || 'No title';
          const number = item.content.number || '';
          const url = item.content.url || '';
          output += `${makeIssueLink(url, title)} ${number ? `#${number}` : ''}`;
        } else {
          output += 'No content available';
        }
        console.log(chalk.green(output));
      });
      console.log(chalk.blue(`Fetched a total of ${filtered.length} filtered item(s).`));
    }
    
    // Return the filtered data for API responses
    return {
      status: 'success',
      data: filtered.map(item => ({
        id: item.id,
        title: item.content?.title || 'No title',
        number: item.content?.number,
        url: item.content?.url,
        html_url: item.content?.url,
        repository_url: item.content?.repository ? item.content.repository.url : null,
        fields: item.fieldValues?.nodes
          ?.filter(node => node.field && node.field.name)
          ?.map(node => ({
            name: node.field.name,
            value: node.name || ''
          })) || []
      }))
    };
    
  } catch (error) {
    // If there's an error, make sure to stop any active spinner
    ora().fail('Error fetching items');
    console.error(chalk.red('Error fetching items for board:'), chalk.red(error.message));
    
    // Return error for API
    return {
      status: 'error',
      error: error.message
    };
  }
}


/**
 * Filter items that are missing a specific field value
 * @param {Array} items - Array of items to filter
 * @param {string} fieldName - Name of the field to check
 * @returns {Array} - Filtered items
 */
export function filterItemsMissingField(items, fieldName) {
  return items.filter(item => {
    if (!item.fieldValues || !item.fieldValues.nodes) return true;
    return !item.fieldValues.nodes.some(node =>
      node.field &&
      node.field.name &&
      node.field.name.toLowerCase() === fieldName.toLowerCase() &&
      typeof node.name === 'string' &&
      node.name.trim() !== ''
    );
  });
}
  
  /**
   * Filter items based on field values
   * @param {Array} items - Items to filter
   * @param {Object} filters - Filter criteria
   * @param {boolean} emptyTeam - Whether to filter for items with empty team field
   * @returns {Array} - Filtered items
   */
  export function filterItems(items, filters, emptyTeam = false) {
    return items.filter(item => {
      if (!item.fieldValues || !item.fieldValues.nodes) return false;
      
      // Apply empty team filter if specified
      if (emptyTeam) {
        const hasTeam = item.fieldValues.nodes.some(node => 
          node.field &&
          node.field.name &&
          node.field.name.toLowerCase() === 'team' &&
          typeof node.name === 'string' &&
          node.name.trim() !== ''
        );
        if (hasTeam) return false;
      }
      
      // Apply other filters with normalization
      return Object.entries(filters).every(([filterKey, normalizedFilterValue]) => {
        if (!normalizedFilterValue) return true;
        
        const matchingField = item.fieldValues.nodes.find(node => {
          if (!node.field) return false;
          return node.field.name && node.field.name.toLowerCase() === filterKey.toLowerCase();
        });
        
        if (!matchingField) return false;
        
        const normalizedFieldValue = normalizeFieldValue(matchingField.name || '');
        
        // Consider match if either contains the other after normalization
        return normalizedFieldValue.includes(normalizedFilterValue) || 
               normalizedFilterValue.includes(normalizedFieldValue);
      });
    });
  }
  
  /**
   * Update a field value directly via GraphQL mutation
   * @param {string} itemId - ID of the item to update
   * @param {string} fieldId - ID of the field to update
   * @param {string} optionId - ID of the option to set
   * @returns {Promise<Object>} - Update result
   */
  export async function updateItemField(itemId, fieldId, optionId) {
    return await graphQLWithAuth(UPDATE_ITEM_FIELD_MUTATION, {
      projectId: ROADMAP_BOARD_ID,
      itemId: itemId,
      fieldId: fieldId,
      value: { singleSelectOptionId: optionId }
    });
  }