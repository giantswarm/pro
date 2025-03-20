/**
 * Workstream Field Management Module
 * 
 * WHY:
 * - Issues need to be categorized by workstream
 * - Manual categorization is time-consuming and prone to inconsistency
 * - Automated workstream classification improves roadmap organization and planning
 * 
 * HOW:
 * - Uses AI to analyze issue content and determine the most appropriate workstream
 * - Leverages the shared batch processing infrastructure for field updates
 * - Integrates with the GitHub Project field system
 * 
 * WHAT:
 * - Provides functions to suggest and update workstream field values
 * - Uses OpenAI's language models to make intelligent suggestions
 * - Can be used both from CLI commands and web interface
 */

import { 
  getAISuggestion,
  batchFixFields
} from './fields.js';


/**
 * Get workstream suggestion from ChatGPT
 * 
 * WHY:
 * - Need to determine the appropriate workstream category for an issue
 * - Workstream is not always explicitly stated in labels or metadata
 * 
 * HOW:
 * - Uses OpenAI's language models to analyze issue content
 * - Passes issue details and valid workstream options to make context-aware suggestions
 * - Returns a single recommended workstream value
 * 
 * @param {string} itemId - The ID of the project item
 * @param {Array} options - Available workstream options
 * @returns {Promise<string>} - Suggested workstream name
 */
async function getWorkstreamSuggestion(itemId, options) {
  return await getAISuggestion(itemId, options, 'workstream');
}

/**
 * Fix workstream field values using AI suggestions
 * 
 * WHY:
 * - Need to batch process workstream field updates
 * - Support filtering by team and other criteria
 * - Provide consistent interface for CLI and web
 * 
 * HOW:
 * - Uses the shared batchFixFields utility for consistent processing
 * - Delegates workstream suggestions to getWorkstreamSuggestion
 * - Handles both single item updates and batch processing
 * 
 * @param {Object} options - Options including team filter or itemId
 * @param {boolean} isServerMode - Whether running in server/API mode
 * @returns {Promise<Object|number>} - Result with status and suggested workstream or number of updated items
 */
export async function fixWorkstreamField(options, isServerMode = false) {
  return await batchFixFields(options, 'workstream', getWorkstreamSuggestion, value => value, isServerMode);
} 