/**
 * API Module
 * 
 * WHY:
 * This module serves as the central point for all server communication in the application.
 * By centralizing API calls here, we ensure:
 * - Consistent error handling across the application
 * - A single place to manage API endpoints
 * - Standardized response formatting
 * - Simplified debugging of network operations
 * 
 * HOW:
 * The module implements a collection of async functions that:
 * - Use the Fetch API for HTTP requests
 * - Handle common error scenarios
 * - Format payloads consistently 
 * - Parse and normalize responses
 * - Log relevant request/response information for debugging
 * 
 * Each function follows a standard pattern:
 * 1. Build the request (URL, payload, query parameters)
 * 2. Execute the fetch with appropriate HTTP method
 * 3. Validate the response status
 * 4. Parse and return the data with consistent structure
 * 5. Handle errors and provide meaningful error messages
 * 
 * WHAT:
 * The module contains functions for:
 * - Fetching field options for form population
 * - Retrieving filtered lists of issues based on criteria
 * - Getting AI-generated suggestions for field values
 * - Applying field values (both suggested and custom)
 * - Generating AI summaries of issue collections
 * - Updating specific fields on individual issues
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
      queryParams.append('noTeam', 'true');
    } else if (filters.team) {
      queryParams.append('team', filters.team);
    }
    
    // check if filters.fieldType is defined and is either team, function, kind, or workstream
    if (filters.fieldType && (filters.fieldType === 'function' || filters.fieldType === 'kind' || filters.fieldType === 'workstream')) {  
      // add noKind, noFunction, or noWorkstream to the query params - capitalize the first letter
      queryParams.append("no" + filters.fieldType.charAt(0).toUpperCase() + filters.fieldType.slice(1), true);
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
 * @param {string} fieldType - Type of field to fix (team, function, kind, workstream)
 * @param {string} itemId - ID of the item
 * @param {string} [teamValue] - Team value (for function, kind, and workstream fields)
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
      case 'workstream':
        endpoint = '/api/fix-workstream-field';
        payload.team = teamValue;
        break;
      default:
        throw new Error(`Unsupported field type: ${fieldType}`);
    }
    
    console.log(`Fetching suggestion for ${fieldType} from ${endpoint}`, payload);
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API error (${response.status}):`, errorText);
      
      try {
        // Try to parse as JSON
        const errorJson = JSON.parse(errorText);
        throw new Error(errorJson.error || `Failed to get suggestion: ${response.statusText}`);
      } catch (e) {
        // If not JSON, use text
        throw new Error(`Failed to get suggestion: ${response.statusText}`);
      }
    }
    
    const data = await response.json();
    console.log(`Suggestion response for ${fieldType}:`, data);
    
    // Ensure the response is properly structured for the client
    if (data.status === 'success') {
      if (!data.data) {
        // If data is missing, restructure the response
        return {
          status: 'success',
          data: {
            suggestion: data.suggestion || '',
            optionId: data.optionId || null,
            fieldId: data.fieldId || null
          }
        };
      }
    }
    
    return data;
  } catch (error) {
    console.error(`Error fetching ${fieldType} suggestion:`, error);
    return { status: 'error', error: error.message };
  }
}

/**
 * Apply a field value to an issue
 * @param {string} fieldType - Type of field to update (team, function, kind, workstream)
 * @param {string} itemId - ID of the item
 * @param {string} [teamValue] - Team value (for function, kind, and workstream fields)
 * @param {string} fieldValue - Value to apply
 * @param {Object} [optionData] - Optional data from a suggestion response
 * @returns {Promise<Object>} The API response
 */
export async function applyFieldValue(fieldType, itemId, teamValue, fieldValue, optionData) {
  try {
    // If we have optionData from a previous suggestion, use the direct apply endpoint
    if (optionData && optionData.fieldId && optionData.optionId) {
      const response = await fetch('/api/apply-suggestion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          itemId,
          fieldId: optionData.fieldId,
          optionId: optionData.optionId
        })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to apply suggested value: ${response.statusText}`);
      }
      
      return await response.json();
    }
    
    // Otherwise use the custom value endpoints
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
      case 'workstream':
        endpoint = '/api/apply-custom-workstream';
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

/**
 * Update a field value for an issue
 * @param {string} issueId - The ID of the issue
 * @param {string} fieldType - The type of field (team, function, kind, workstream)
 * @param {string} value - The new value for the field
 * @param {Object} [metadata] - Optional metadata (fieldId, optionId) from suggestion
 * @returns {Promise<Object>} The updated issue data
 */
export async function updateIssueField(issueId, fieldType, value, metadata = {}) {
  try {
    console.log(`Updating field ${fieldType} for issue ${issueId} with value:`, value);
    
    // If we have field ID and option ID (from a suggestion), use apply-suggestion endpoint
    if (metadata.fieldId && metadata.optionId) {
      console.log('Using apply-suggestion endpoint with metadata:', metadata);
      const response = await fetch('/api/apply-suggestion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          itemId: issueId,
          fieldId: metadata.fieldId,
          optionId: metadata.optionId
        })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to apply suggestion: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data;
    }
    
    // Otherwise use the custom apply endpoints based on field type
    console.log(`Using apply-custom-${fieldType} endpoint`);
    let endpoint = '';
    const payload = {
      itemId: issueId,
      customValue: value
    };
    
    switch(fieldType.toLowerCase()) {
      case 'team':
        endpoint = '/api/apply-custom-team';
        break;
      case 'function':
        endpoint = '/api/apply-custom-function';
        break;
      case 'kind':
        endpoint = '/api/apply-custom-kind';
        break;
      case 'workstream':
        endpoint = '/api/apply-custom-workstream';
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
      throw new Error(`Failed to update field: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error updating field:', error);
    throw error;
  }
} 