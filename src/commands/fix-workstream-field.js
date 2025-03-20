/**
 * Fix Workstream Field Command Module
 * 
 * WHY:
 * - Command-line interface needs to expose workstream field fixing functionality
 * - Users need a simple way to update workstream assignments for issues
 * - Consistent interface is needed for field operations across CLI
 * 
 * HOW:
 * - Wraps the core fixWorkstreamField function from the library
 * - Passes through options from command line
 * - Sets server mode to false to enable CLI-specific behavior
 * 
 * WHAT:
 * - Exports a command handler function for the fix-workstream-field command
 * - Processes options provided by the CLI
 * - Delegates to the core library function for actual processing
 */

import { fixWorkstreamField } from '../lib/workstream-field.js';

/**
 * CLI command handler for fixing workstream field values
 * 
 * @param {Object} options - Command options including filters and itemId
 * @returns {Promise<void>} - Resolves when the operation is complete
 */
export async function fixWorkstreamFieldCommand(options) {
  await fixWorkstreamField(options, false);
} 