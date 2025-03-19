/**
 * Kind Field Management Module
 * 
 * WHY:
 * - Issues need to be categorized by kind (Bug, Feature, Enhancement, etc.)
 * - Consistent kind categorization improves roadmap visibility and planning
 * - Manual categorization is subjective and time-consuming
 * 
 * HOW:
 * - Uses AI to analyze issue content and suggest appropriate kind values
 * - Integrates with GitHub Projects API for field updates
 * - Provides batch processing capabilities for efficiency
 * 
 * WHAT:
 * - Exports functions to suggest and update kind field values
 * - Leverages OpenAI's language models for intelligent categorization
 * - Can be used by both CLI commands and web interface
 */

import { 
  getAISuggestion,
  batchFixFields
} from './fields.js';

/**
 * Get kind suggestion from ChatGPT
 * 
 * WHY:
 * - Need to determine the issue kind (Bug, Feature, etc.) based on content
 * - Explicit kind information is often missing or inconsistent
 * - AI can analyze issue content to make informed categorizations
 * 
 * HOW:
 * - Uses OpenAI's language models to analyze issue text
 * - Passes issue details and valid kind options to the model
 * - Returns a single recommended kind value
 * 
 * @param {string} itemId - The ID of the project item
 * @param {Array} options - Available kind options
 * @returns {Promise<string>} - Suggested kind name
 */
async function getKindSuggestion(itemId, options) {
  return await getAISuggestion(itemId, options, 'kind');
}

/**
 * Fix kind field values using AI suggestions
 * 
 * WHY:
 * - Need to batch process kind field updates
 * - Need to support filtering by team and other criteria
 * - Need consistent interface for CLI and web applications
 * 
 * HOW:
 * - Uses the shared batchFixFields utility for consistent processing
 * - Delegates kind suggestions to getKindSuggestion
 * - Handles both single item updates and batch processing
 * 
 * @param {Object} options - Options including team filter or itemId
 * @param {boolean} isServerMode - Whether running in server/API mode
 * @returns {Promise<Object|number>} - Result with status and suggested kind or number of updated items
 */
export async function fixKindField(options, isServerMode = false) {
  return await batchFixFields(options, 'kind', getKindSuggestion, value => value, isServerMode);
}