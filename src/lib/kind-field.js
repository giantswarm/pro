import { 
  getAISuggestion,
  batchFixFields
} from './fields.js';

/**
 * Get kind suggestion from ChatGPT
 * @param {Object} item - The project item
 * @param {Array} options - Available kind options
 * @returns {Promise<string>} - Suggested kind name
 */
async function getKindSuggestion(item, options) {
  return await getAISuggestion(item, options, 'kind');
}

/**
 * Fix kind field values using AI suggestions
 * @param {Object} options - Options including team filter or itemId
 * @returns {Promise<Object|number>} - Result with status and suggested kind or number of updated items
 */
export async function fixKindField(options) {
  return await batchFixFields(options, 'kind', getKindSuggestion);
} 