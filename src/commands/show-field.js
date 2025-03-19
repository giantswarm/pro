/**
 * Show Field Command Module
 * 
 * WHY:
 * - Users need detailed information about specific fields in the GitHub Project
 * - Field options and configuration details are required for field operations
 * - Understanding field structure helps with roadmap configuration
 * 
 * HOW:
 * - Wraps the core showField function from the library
 * - Takes field ID as input via command options
 * - Displays detailed information about the requested field
 * 
 * WHAT:
 * - Exports a command handler function for the show-field command
 * - Shows detailed information for a specific field, including all options
 * - Provides configuration details for different field types (single select, iteration, etc.)
 */

import { showField } from '../lib/fields.js';

/**
 * CLI command handler for showing detailed information about a specific field
 * 
 * @param {Object} options - Command options containing field ID
 * @returns {Promise<void>} - Resolves when the operation is complete
 */
export async function showFieldCommand(options) {
  await showField(options);
}
