/**
 * API module for handling all server requests
 * Centralizes fetch operations and response handling
 */

/**
 * Fetch field options from the server
 * @returns {Promise<Object>} The API response with field options
 */
export async function fetchFieldOptions() {
  try {
    const response = await fetch('/api/fields');
    
    if (!response.ok) {
      throw new Error(`Failed to fetch field options: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching field options:', error);
    throw error;
  }
}

/**
 * Fetch issues based on filters
 * @param {Object} filters - Filter options
 * @param {string} [filters.team] - Team filter
 * @returns {Promise<Object>} The API response
 */
export async function fetchIssues(filters = {}) {
  try {
    // Build query string from filters
    const queryParams = new URLSearchParams();
    
    if (filters.team === 'no-team') {
      queryParams.append('no-team', 'true');
    } else if (filters.team) {
      queryParams.append('team', filters.team);
    }
    
    // Add other filters as needed
    if (filters.kind) {
      queryParams.append('kind', filters.kind);
    }
    
    if (filters.function) {
      queryParams.append('function', filters.function);
    }
    
    const url = `/api/items?${queryParams.toString()}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch issues: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching issues:', error);
    return { status: 'error', error: error.message };
  }
}

/**
 * Request a field fix suggestion from the server
 * @param {string} fieldType - Type of field to fix (team, function, kind)
 * @param {string} itemId - ID of the item
 * @param {string} [teamValue] - Team value (for function and kind fields)
 * @returns {Promise<Object>} The API response
 */
export async function fetchSuggestion(fieldType, itemId, teamValue) {
  try {
    let endpoint = '';
    const payload = { itemId };
    
    switch (fieldType.toLowerCase()) {
      case 'team':
        endpoint = '/api/fix-team-field';
        break;
      case 'function':
        endpoint = '/api/fix-function-field';
        payload.team = teamValue;
        break;
      case 'kind':
        endpoint = '/api/fix-kind-field';
        payload.team = teamValue;
        break;
      default:
        throw new Error(`Unsupported field type: ${fieldType}`);
    }
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      throw new Error(`Failed to get suggestion: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`Error fetching ${fieldType} suggestion:`, error);
    return { status: 'error', error: error.message };
  }
}

/**
 * Apply a field value to an issue
 * @param {string} fieldType - Type of field to update (team, function, kind)
 * @param {string} itemId - ID of the item
 * @param {string} [teamValue] - Team value (for function and kind fields)
 * @param {string} fieldValue - Value to apply
 * @returns {Promise<Object>} The API response
 */
export async function applyFieldValue(fieldType, itemId, teamValue, fieldValue) {
  try {
    let endpoint = '';
    const payload = { 
      itemId,
      customValue: fieldValue
    };
    
    switch (fieldType.toLowerCase()) {
      case 'team':
        endpoint = '/api/apply-custom-team';
        break;
      case 'function':
        endpoint = '/api/apply-custom-function';
        payload.teamValue = teamValue;
        break;
      case 'kind':
        endpoint = '/api/apply-custom-kind';
        payload.teamValue = teamValue;
        break;
      default:
        throw new Error(`Unsupported field type: ${fieldType}`);
    }
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      throw new Error(`Failed to apply field value: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`Error updating ${fieldType} field:`, error);
    return { status: 'error', error: error.message };
  }
}

/**
 * Generate an AI summary of issues
 * @param {Object} filters - Filter options
 * @returns {Promise<Object>} The API response
 */
export async function generateSummary(filters = {}) {
  try {
    const response = await fetch('/api/summarize-issues', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(filters)
    });
    
    if (!response.ok) {
      throw new Error(`Failed to generate summary: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error generating summary:', error);
    return { status: 'error', error: error.message };
  }
} 