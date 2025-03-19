/**
 * List Items Command Module
 * 
 * WHY:
 * - Users need to view and filter roadmap items efficiently
 * - GitHub's web interface has limited filtering capabilities
 * - Command-line access provides faster, scriptable interaction with roadmap data
 * 
 * HOW:
 * - Wraps the core listItems function from the library
 * - Takes filtering options to narrow down the displayed items
 * - Formats output for terminal display with clickable links
 * 
 * WHAT:
 * - Exports a command handler function for the list-items command
 * - Lists roadmap items with optional filtering by team, kind, function, etc.
 * - Displays item titles with clickable links to GitHub issues
 * - Shows field values for each item in a readable format
 */

import { listItems } from '../lib/items.js';

/**
 * CLI command handler for listing roadmap items with filtering options
 * 
 * @param {Object} options - Command options for filtering items (team, kind, function, noTeam, etc.)
 * @returns {Promise<Object>} - Result with status and filtered item data
 */
export async function listItemsCommand(options) {
  return await listItems(options);
}
