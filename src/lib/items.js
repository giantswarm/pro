import chalk from 'chalk';
import ora from 'ora';
import { fetchPaginated } from './api.js';
import {
  ROADMAP_BOARD_ID,
  LIST_ITEMS_QUERY
} from './project.js';
import { makeIssueLink, normalizeFieldValue } from './utils.js';

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
        fields: item.fieldValues?.nodes?.map(node => ({
          name: node.field?.name,
          value: node.name
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