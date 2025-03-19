/**
 * Fix Kind Field Command Module
 * 
 * WHY:
 * - Command-line interface needs to expose kind field fixing functionality
 * - Users need a simple way to update kind assignments for issues
 * - Consistent interface is needed for field operations across CLI
 * 
 * HOW:
 * - Wraps the core fixKindField function from the library
 * - Passes through options from command line
 * - Sets server mode to false to enable CLI-specific behavior
 * 
 * WHAT:
 * - Exports a command handler function for the fix-kind-field command
 * - Processes options provided by the CLI
 * - Delegates to the core library function for actual processing
 */

import { fixKindField } from '../lib/kind-field.js';

/**
 * CLI command handler for fixing kind field values
 * 
 * @param {Object} options - Command options including filters and itemId
 * @returns {Promise<void>} - Resolves when the operation is complete
 */
export async function fixKindFieldCommand(options) {
  await fixKindField(options, false);
} 