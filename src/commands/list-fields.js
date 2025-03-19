/**
 * List Fields Command Module
 * 
 * WHY:
 * - Users need visibility into available fields in the GitHub Project
 * - Field IDs and configuration options are required for other operations
 * - Understanding available fields helps with roadmap planning
 * 
 * HOW:
 * - Wraps the core listFields function from the library
 * - Provides a simple CLI interface with no required parameters
 * - Displays field information in a user-friendly format
 * 
 * WHAT:
 * - Exports a command handler function for the list-fields command
 * - Lists all fields in the roadmap board with their IDs, types, and options
 * - Shows configuration details for different field types (single select, iteration, etc.)
 */

import { listFields } from '../lib/fields.js';

/**
 * CLI command handler for listing all fields in the roadmap board
 * 
 * @returns {Promise<void>} - Resolves when the operation is complete
 */
export async function listFieldsCommand() {
  await listFields();
}
