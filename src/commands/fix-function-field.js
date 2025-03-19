/**
 * Fix Function Field Command Module
 * 
 * WHY:
 * - Command-line interface needs to expose function field fixing functionality
 * - Users need a simple way to update function assignments for issues
 * - Consistent interface is needed for field operations across CLI
 * 
 * HOW:
 * - Wraps the core fixFunctionField function from the library
 * - Passes through options from command line
 * - Sets server mode to false to enable CLI-specific behavior
 * 
 * WHAT:
 * - Exports a command handler function for the fix-function-field command
 * - Processes options provided by the CLI
 * - Delegates to the core library function for actual processing
 */

import { fixFunctionField } from '../lib/function-field.js';

/**
 * CLI command handler for fixing function field values
 * 
 * @param {Object} options - Command options including filters and itemId
 * @returns {Promise<void>} - Resolves when the operation is complete
 */
export async function fixFunctionFieldCommand(options) {
  await fixFunctionField(options, false);
} 