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
 * @param {boolean} isServerMode - Whether running in server/API mode
 * @returns {Promise<Object|number>} - Result with status and suggested kind or number of updated items
 */
export async function fixKindField(options, isServerMode = false) {
  return await batchFixFields(options, 'kind', getKindSuggestion, value => value, isServerMode);
}

/**
 * Fix a single item's kind field with AI suggestion
 * @param {string} itemId - ID of the item to fix
 * @param {string} teamValue - Team value to use for context
 * @returns {Object} Result with status and suggested kind
 */
export async function fixSingleItemKindField(itemId, teamValue) {
  try {
    if (!itemId) {
      return { status: 'error', error: 'Item ID is required' };
    }
    
    if (!teamValue) {
      return { status: 'error', error: 'Team value is required for kind field suggestions' };
    }
    
    // This function needs to return an object with:
    // - status: 'success' or 'error'
    // - suggestion: the suggested kind value
    // - optionId: the ID of the kind option if available
    // - fieldId: the ID of the kind field
    
    const result = await fixKindField({
      itemId,
      team: teamValue,
      skipApply: true
    }, true);
    
    // Format the response consistently
    return {
      status: 'success',
      suggestion: result.suggestion || '',
      optionId: result.optionId || null,
      fieldId: result.fieldId || null
    };
  } catch (error) {
    console.error('Error fixing single item kind field:', error);
    return { status: 'error', error: error.message };
  }
} 