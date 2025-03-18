import chalk from 'chalk';
import ora from 'ora';
import { fetchPaginated } from '../lib/api.js';
import { LIST_ITEMS_QUERY } from '../lib/project.js';
import { makeIssueLink, normalizeFieldValue } from '../lib/utils.js';

export async function listItemsCommand(options) {
  const first = 100;
  try {
    // Build filter criteria based on provided options
    const filters = {};
    ['kind', 'status', 'function', 'sig', 'wg'].forEach(key => {
      if (options[key]) {
        filters[key === 'wg' ? 'working group' : key] = normalizeFieldValue(options[key]);
      }
    });
    if (options.team !== undefined && options.team !== false) {
      filters['team'] = normalizeFieldValue(options.team);
    }

    // Create a spinner with a message
    const spinner = ora('Fetching items from GitHub project...').start();
    
    // Fetch all items
    const allItems = await fetchPaginated(
      LIST_ITEMS_QUERY,
      { projectId: options.id, first },
      result => result.node.items
    );

    spinner.text = 'Applying filters to items...';
    
    // Apply filters
    const filtered = allItems.filter(item => {
      if (!item.fieldValues || !item.fieldValues.nodes) return false;
      
      // Apply --no-team filter if specified
      if (options.team !== undefined && options.team === false) {
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
        const matchingField = item.fieldValues.nodes.find(node => {
          if (!node.field) return false;
          return node.field.name && node.field.name.toLowerCase() === filterKey;
        });
        
        if (!matchingField) return false;
        
        const normalizedFieldValue = normalizeFieldValue(matchingField.name);
        
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
  } catch (error) {
    // If there's an error, make sure to stop any active spinner
    ora().fail('Error fetching items');
    console.error(chalk.red('Error fetching items for board:'), chalk.red(error.message));
  }
}
