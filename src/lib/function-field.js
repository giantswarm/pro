/**
 * Function Field Management Module
 * 
 * WHY:
 * - Issues need to be categorized by function (Development, Support, etc.)
 * - Manual categorization is time-consuming and prone to inconsistency
 * - Automated function classification improves roadmap organization and planning
 * 
 * HOW:
 * - Uses AI to analyze issue content and determine the most appropriate function
 * - Leverages the shared batch processing infrastructure for field updates
 * - Integrates with the GitHub Project field system
 * 
 * WHAT:
 * - Provides functions to suggest and update function field values
 * - Uses OpenAI's language models to make intelligent suggestions
 * - Can be used both from CLI commands and web interface
 */

import { 
  getAISuggestion,
  batchFixFields
} from './fields.js';


/**
 * Get function suggestion from ChatGPT
 * 
 * WHY:
 * - Need to determine the appropriate function category for an issue
 * - Function is not always explicitly stated in labels or metadata
 * 
 * HOW:
 * - Uses OpenAI's language models to analyze issue content
 * - Passes issue details and valid function options to make context-aware suggestions
 * - Returns a single recommended function value
 * 
 * @param {string} itemId - The ID of the project item
 * @param {Array} options - Available function options
 * @returns {Promise<string>} - Suggested function name
 */
async function getFunctionSuggestion(itemId, options) {
  return await getAISuggestion(itemId, options, 'function');
}

/**
 * Fix function field values using AI suggestions
 * 
 * WHY:
 * - Need to batch process function field updates
 * - Support filtering by team and other criteria
 * - Provide consistent interface for CLI and web
 * 
 * HOW:
 * - Uses the shared batchFixFields utility for consistent processing
 * - Delegates function suggestions to getFunctionSuggestion
 * - Handles both single item updates and batch processing
 * 
 * @param {Object} options - Options including team filter or itemId
 * @param {boolean} isServerMode - Whether running in server/API mode
 * @returns {Promise<Object|number>} - Result with status and suggested function or number of updated items
 */
export async function fixFunctionField(options, isServerMode = false) {
  return await batchFixFields(options, 'function', getFunctionSuggestion, value => value, isServerMode);
} 