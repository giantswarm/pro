import { fetchPaginated } from '../lib/api.js';
import { LIST_ITEMS_QUERY } from '../lib/project.js';
import { makeIssueLink } from '../lib/utils.js'; // Assume utility functions are moved here

export async function listItemsCommand(options) {
  const first = 100;
  try {
    // Build filter criteria from options keys: kind, status, function, sig, wg.
    const filters = {};
    ['kind', 'status', 'function', 'sig', 'wg'].forEach(key => {
      if (options[key]) {
        filters[key === 'wg' ? 'working group' : key] = options[key].toLowerCase();
      }
    });

    // check if team and noTeam are provided
    if (options.team !== undefined && options.team !== false) {
      filters['team'] = options.team.toLowerCase();
    }

    const allItems = await fetchPaginated(
      LIST_ITEMS_QUERY,
      { projectId: options.id, first },
      result => result.node.items
    );
    
    // Filter items: first, if --no-team is set, ensure item has no non-empty "team" value.
    const filtered = allItems.filter(item => {
        if (!item.fieldValues || !item.fieldValues.nodes) return false;
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
        return Object.entries(filters).every(([filterKey, filterValue]) => {
          const matchingField = item.fieldValues.nodes.find(node => {
            if (!node.field) return false;
            return node.field.name && node.field.name.toLowerCase() === filterKey;
          });
          if (!matchingField) return false;
          // Compare field value (assumed here in matchingField.name) to filterValue.
          return matchingField.name.toLowerCase() === filterValue;
        });
      });
      if (filtered.length === 0) {
        console.log(`No items found matching provided filters.`);
      } else {
        console.log(`Filtered items:`);
        filtered.forEach(item => {
          let output = `- [${item.id}] `;
          if (item.content && Object.keys(item.content).length > 0) {
            const title = item.content.title || 'No title';
            const number = item.content.number || '';
            const url = item.content.url || '';
            output += `${makeIssueLink(url, title)} ${number ? `#${number}` : ''}`;
          } else {
            const title = (item.content && item.content.title) ? item.content.title : 'No title';
            output += title;
          }
          console.log(output);
        });
        console.log(`Fetched a total of ${filtered.length} filtered item(s).`);
    }
  } catch (error) {
    console.error('Error fetching items for board:', error.message);
  }
}
