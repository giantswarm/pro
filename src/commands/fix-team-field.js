/**
 * Fix Team Field Command Module
 * 
 * WHY:
 * - Command-line interface needs to expose team field fixing functionality
 * - Users need a simple way to update team assignments for issues
 * - CLI commands should provide a consistent interface for field operations
 * 
 * HOW:
 * - Wraps the core fixTeamField function from the library
 * - Passes through options from command line
 * - Sets server mode to false to enable CLI-specific behavior
 * 
 * WHAT:
 * - Exports a command handler function for the fix-team-field command
 * - Processes options provided by the CLI
 * - Delegates to the core library function for actual processing
 */

import { fixTeamField } from '../lib/team-field.js';

/**
 * CLI command handler for fixing team field values
 * 
 * @param {Object} options - Command options including filters and itemId
 * @returns {Promise<void>} - Resolves when the operation is complete
 */
export async function fixTeamFieldCommand(options = {}) {
  await fixTeamField(options, false);
}
