import { 
  getAISuggestion,
  batchFixFields
} from './fields.js';


/**
 * Get function suggestion from ChatGPT
 * @param {Object} item - The project item
 * @param {Array} options - Available function options
 * @returns {Promise<string>} - Suggested function name
 */
async function getFunctionSuggestion(item, options) {
  return await getAISuggestion(item, options, 'function');
}

/**
 * Fix function field values using AI suggestions
 * @param {Object} options - Options including team filter or itemId
 * @param {boolean} isServerMode - Whether running in server/API mode
 * @returns {Promise<Object|number>} - Result with status and suggested function or number of updated items
 */
export async function fixFunctionField(options, isServerMode = false) {
  return await batchFixFields(options, 'function', getFunctionSuggestion, value => value, isServerMode);
} 