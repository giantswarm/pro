/**
 * Field Fixing Module
 * Handles the functionality for finding and fixing empty fields
 */

import * as state from './state.js';
import * as api from './api.js';
import * as ui from '../utils/ui.js';
import { createSuggestion } from '../components/suggestionModal.js';

/**
 * Initialize the fix fields functionality
 */
export function initFixFields() {
  // Set up field type change handler
  const fieldTypeSelect = document.getElementById('fixFieldType');
  if (fieldTypeSelect) {
    fieldTypeSelect.addEventListener('change', handleFieldTypeChange);
    
    // Apply initial state
    handleFieldTypeChange();
  }
}

/**
 * Handle field type selection changes
 */
function handleFieldTypeChange() {
  const fieldType = document.getElementById('fixFieldType').value;
  const teamFilterContainer = document.getElementById('teamFilterContainer');
  const teamSelect = document.getElementById('fixTeam');
  
  if (!teamFilterContainer || !teamSelect) return;
  
  if (fieldType === 'team') {
    // Hide team filter when fixing team fields
    teamFilterContainer.style.display = 'none';
    
    // Implicitly set to "no team assigned"
    teamSelect.value = 'no-team';
  } else if (fieldType === 'function' || fieldType === 'kind') {
    // Show team filter when fixing function or kind fields
    teamFilterContainer.style.display = 'block';
    
    // Reset team selection
    teamSelect.value = '';
  } else {
    // Hide team filter for other cases (like no selection)
    teamFilterContainer.style.display = 'none';
  }
}

/**
 * Finds issues with empty fields based on filters
 */
export async function findIssuesWithEmptyFields() {
  // Reset state and show loading overlay
  state.updateNestedStateProperty('fetchingDetails', 'step', 'starting');
  state.updateNestedStateProperty('fetchingDetails', 'totalItems', 0);
  state.updateNestedStateProperty('fetchingDetails', 'processedItems', 0);
  state.updateNestedStateProperty('fetchingDetails', 'filteredItems', 0);
  
  ui.toggleLoadingOverlay(true, 'Starting issue search process...');
  
  // Update status
  ui.updateOperationStatus('Loading issues...', 'primary');
  
  // Get form values
  const fieldType = document.getElementById('fixFieldType').value;
  let teamValue = document.getElementById('fixTeam').value;
  
  if (!fieldType) {
    ui.updateOperationStatus('Please select a field type to fix', 'danger');
    ui.toggleLoadingOverlay(false);
    return;
  }
  
  // If fixing team fields, always set to "no-team" regardless of what's in the UI
  if (fieldType === 'team') {
    teamValue = 'no-team';
  }
  
  try {
    // Update state
    state.updateNestedStateProperty('fetchingDetails', 'step', 'fetching');
    
    // Build filters based on field type
    const filters = {};
    
    // Handle filtering logic based on what we're trying to fix
    if (fieldType === 'team') {
      // If fixing team fields, look for issues with empty team fields
      filters.noTeam = true;
    } else {
      // If fixing function/kind fields, we can optionally filter by team
      if (teamValue === 'no-team') {
        filters.noTeam = true;
      } else if (teamValue) {
        filters.team = teamValue;
      }
    }
    
    // Update loading status based on search criteria
    let loadingMessage = '';
    if (fieldType === 'team') {
      loadingMessage = 'Searching for issues with empty team fields...';
    } else if (teamValue === 'no-team') {
      loadingMessage = `Searching for issues with no team and empty ${fieldType} fields...`;
    } else if (teamValue) {
      loadingMessage = `Searching for issues in team "${teamValue}" with empty ${fieldType} fields...`;
    } else {
      loadingMessage = `Searching for issues with empty ${fieldType} fields across all teams...`;
    }
    
    ui.updateLoadingStatus(loadingMessage);
    
    // Fetch items from API
    ui.updateLoadingStatus('Connecting to GitHub API to fetch issues...', 'info');
    const result = await api.fetchIssues(filters);
    
    if (result.status === 'error') {
      throw new Error(result.error);
    }
    
    if (!result.data || result.data.length === 0) {
      ui.updateOperationStatus('No issues found matching your criteria', 'warning');
      ui.toggleLoadingOverlay(false);
      document.getElementById('issuesContainer').style.display = 'none';
      return;
    }
    
    // Store all items in state
    state.updateStateProperty('items', result.data);
    state.updateNestedStateProperty('fetchingDetails', 'totalItems', result.data.length);
    
    ui.updateLoadingStatus(`Found ${result.data.length} issues, filtering for empty ${fieldType} fields...`, 'info');
    
    // Filter for items with empty fields of the selected type
    const stateObj = state.getState();
    const emptyFieldItems = stateObj.items.filter(item => {
      state.updateNestedStateProperty('fetchingDetails', 'processedItems', 
        stateObj.fetchingDetails.processedItems + 1);
      
      // Check if the field exists and is empty
      const hasEmptyField = !item.fields.some(field => 
        field && field.name && field.name.toLowerCase() === fieldType && field.value && field.value.trim() !== ''
      );
      
      if (hasEmptyField) {
        state.updateNestedStateProperty('fetchingDetails', 'filteredItems', 
          stateObj.fetchingDetails.filteredItems + 1);
      }
      
      if (stateObj.fetchingDetails.processedItems % 10 === 0 || 
          stateObj.fetchingDetails.processedItems === stateObj.fetchingDetails.totalItems) {
        ui.updateLoadingStatus(
          `Processed ${stateObj.fetchingDetails.processedItems} of ${stateObj.fetchingDetails.totalItems} issues, ` +
          `found ${stateObj.fetchingDetails.filteredItems} with empty ${fieldType} fields...`
        );
      }
      
      return hasEmptyField;
    });
    
    state.updateStateProperty('emptyFieldItems', emptyFieldItems);
    
    if (emptyFieldItems.length === 0) {
      ui.updateOperationStatus(`No issues found with empty ${fieldType} fields`, 'success');
      ui.toggleLoadingOverlay(false);
      document.getElementById('issuesContainer').style.display = 'none';
      return;
    }
    
    // Update found count
    document.getElementById('foundCount').textContent = emptyFieldItems.length;
    
    // Populate table
    ui.updateLoadingStatus('Building issue table...', 'info');
    buildIssuesTable(emptyFieldItems, fieldType);
    
    // Show issues container
    document.getElementById('issuesContainer').style.display = 'block';
    
    // Update status
    ui.updateOperationStatus(`Found ${emptyFieldItems.length} issues with empty ${fieldType} fields`, 'success');
    ui.updateLoadingStatus(`Found ${emptyFieldItems.length} issues with empty ${fieldType} fields`, 'success');
    
    // Update the start fixing button text to be clearer
    document.getElementById('startFixingBtn').innerHTML = '<i class="bi bi-magic me-1"></i>Get All Suggestions';
    
  } catch (error) {
    console.error('Error fetching items:', error);
    ui.updateOperationStatus(`Error: ${error.message}`, 'danger');
    ui.updateLoadingStatus(`Error fetching items: ${error.message}`, 'error');
  } finally {
    ui.toggleLoadingOverlay(false);
  }
}

/**
 * Builds the issues table with data
 * @param {Array} issues - Array of issues to display
 */
function buildIssuesTable(issues) {
  const tableBody = document.getElementById('issuesTableBody');
  if (!tableBody) return;
  
  // Clear existing rows
  tableBody.innerHTML = '';
  
  if (!issues || issues.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="4" class="text-center py-4">
          <div class="alert alert-info mb-0">
            No issues found matching the current filters.
          </div>
        </td>
      </tr>
    `;
    return;
  }
  
  // Update count display
  const countElement = document.getElementById('issuesCount');
  if (countElement) {
    countElement.textContent = issues.length;
  }
  
  // Build rows for each issue
  issues.forEach((issue, index) => {
    const emptyField = getEmptyFieldName(issue);
    if (!emptyField) return; // Skip if no empty fields
    
    const row = document.createElement('tr');
    row.id = `row-${issue.id}`;
    row.dataset.index = index;
    
    // Issue cell
    const issueCell = document.createElement('td');
    issueCell.className = 'issue-cell';
    issueCell.innerHTML = `
      <a href="${issue.html_url || issue.url || '#'}" target="_blank" class="issue-title">
        ${issue.title || 'Untitled Issue'} 
        <small class="text-muted">#${issue.number || 'N/A'}</small>
      </a>
      <small class="d-block text-truncate issue-repo">
        ${issue.repository_url ? issue.repository_url.split('/').slice(-1)[0] : issue.url ? issue.url.split('/')[4] : 'Unknown Repo'}
      </small>
    `;
    
    // Fields cell
    const fieldsCell = document.createElement('td');
    fieldsCell.className = 'fields-cell';
    
    const fieldBadges = document.createElement('div');
    fieldBadges.className = 'field-badges';
    
    // Add badges for existing fields
    if (issue.fields && Array.isArray(issue.fields)) {
      issue.fields.forEach(field => {
        if (field && field.name && field.value) {
          const badge = document.createElement('span');
          badge.className = 'badge bg-secondary me-1';
          badge.textContent = `${field.name}: ${getFieldDisplayValue(field.name, field.value)}`;
          fieldBadges.appendChild(badge);
        }
      });
    }
    
    // Add missing field badge
    const missingBadge = document.createElement('span');
    missingBadge.className = 'badge bg-danger me-1';
    missingBadge.textContent = `Missing: ${emptyField}`;
    fieldBadges.appendChild(missingBadge);
    
    fieldsCell.appendChild(fieldBadges);
    
    // Suggestion cell (empty by default, will be populated on demand)
    const suggestionCell = document.createElement('td');
    suggestionCell.className = 'suggestion-cell';
    suggestionCell.style.display = 'none'; // Hidden by default
    
    // Action cell
    const actionCell = document.createElement('td');
    actionCell.className = 'action-cell text-end';
    
    const getSuggestionBtn = document.createElement('button');
    getSuggestionBtn.className = 'btn btn-sm btn-primary';
    getSuggestionBtn.innerHTML = '<i class="fas fa-magic me-1"></i> Get Suggestion';
    getSuggestionBtn.addEventListener('click', () => {
      if (row && issue) {
        getSuggestionForRow(row, issue);
      } else {
        console.error('Missing row or issue data for suggestion');
      }
    });
    
    actionCell.appendChild(getSuggestionBtn);
    
    // Add cells to row
    row.appendChild(issueCell);
    row.appendChild(fieldsCell);
    row.appendChild(suggestionCell);
    row.appendChild(actionCell);
    
    // Add row to table
    tableBody.appendChild(row);
  });
}

/**
 * Gets the display value for a field
 * @param {string} field - Field name
 * @param {string} value - Field value
 * @returns {string} Display value
 */
function getFieldDisplayValue(field, value) {
  // Handle case where value might be undefined
  if (value === undefined || value === null) {
    return 'Not set';
  }
  
  // Get options from state safely
  const stateOptions = state.fieldOptions || {};
  const fieldOptions = stateOptions[field];
  
  // Ensure we have an array of options
  if (!fieldOptions || !Array.isArray(fieldOptions) || fieldOptions.length === 0) {
    return value.toString();
  }
  
  // Find matching option
  const option = fieldOptions.find(opt => opt.id === value || opt.value === value);
  return option ? (option.name || option.text || value) : value.toString();
}

/**
 * Gets the name of the empty field in the issue
 * @param {Object} issue - The issue object
 * @returns {string|null} - The field name or null if no empty field is found
 */
function getEmptyFieldName(issue) {
  if (!issue || !issue.fields) return null;
  
  const requiredFields = ['team', 'function', 'kind'];
  for (const fieldName of requiredFields) {
    // Check if field doesn't exist or is empty
    const hasField = issue.fields.some(field => 
      field.name && field.name.toLowerCase() === fieldName.toLowerCase() && 
      field.value && field.value.toString().trim() !== ''
    );
    
    if (!hasField) {
      return fieldName;
    }
  }
  
  return null;
}

/**
 * Fixes a single issue at the given index
 * @param {number} index - The index of the issue to fix
 */
export async function fixSingleIssue(index) {
  const stateObj = state.getState();
  
  if (index >= stateObj.emptyFieldItems.length) {
    console.error(`Index ${index} out of bounds for empty field items.`);
    return;
  }
  
  const fieldType = document.getElementById('fixFieldType').value;
  const teamValue = document.getElementById('fixTeam').value;
  
  if (!fieldType) {
    alert('Please select a field type to fix');
    return;
  }
  
  const item = stateObj.emptyFieldItems[index];
  if (!item) {
    console.error(`Item at index ${index} not found.`);
    return;
  }
  
  try {
    // Get suggestion for this single issue
    await getSuggestionForRow(item, index, fieldType);
  } catch (error) {
    console.error(`Error fixing single issue at index ${index}:`, error);
    ui.updateOperationStatus(`Error: ${error.message}`, 'danger');
  }
}

/**
 * Start the process of getting suggestions for all empty fields
 * NOTE: This function only fetches suggestions, it does NOT automatically apply them
 */
export async function startFixingEmptyFields() {
  const fieldType = document.getElementById('fixFieldType').value;
  const teamValue = document.getElementById('fixTeam').value;
  
  if (!fieldType) {
    alert('Please select a field type to fix');
    return;
  }
  
  const stateObj = state.getState();
  if (stateObj.emptyFieldItems.length === 0) {
    alert('No issues found with empty fields to fix');
    return;
  }
  
  // Reset fixing state
  state.updateNestedStateProperty('fixingResults', 'total', stateObj.emptyFieldItems.length);
  state.updateNestedStateProperty('fixingResults', 'fixed', 0);
  state.updateNestedStateProperty('fixingResults', 'skipped', 0);
  
  // Show progress container
  document.getElementById('fixProgressContainer').style.display = 'block';
  document.getElementById('fixProgress').style.display = 'block';
  document.getElementById('fixProgressBar').style.width = '0%';
  document.getElementById('fixResults').style.display = 'block';
  document.getElementById('totalCount').textContent = stateObj.emptyFieldItems.length;
  document.getElementById('fixedCount').textContent = 0;
  document.getElementById('skippedCount').textContent = 0;
  
  // Update the button text
  const startFixingBtn = document.getElementById('startFixingBtn');
  if (startFixingBtn) {
    startFixingBtn.disabled = true;
    startFixingBtn.innerHTML = '<i class="bi bi-lightning-charge"></i> Getting Suggestions...';
  }
  
  try {
    ui.toggleLoadingOverlay(true, 'Getting AI suggestions for all issues. Suggestions will NOT be applied automatically - you will need to review and accept each one.');
    
    // Process all items in parallel
    const promises = stateObj.emptyFieldItems.map((item, index) => {
      // Add a small delay between requests to avoid hitting rate limits
      return new Promise(resolve => {
        setTimeout(async () => {
          try {
            // Update progress
            const progress = ((index + 1) / stateObj.emptyFieldItems.length) * 100;
            document.getElementById('fixProgressBar').style.width = `${progress}%`;
            
            // Get suggestion for this item
            await getSuggestionForRow(item, index, fieldType);
            resolve();
          } catch (error) {
            console.error(`Error processing item at index ${index}:`, error);
            resolve(); // Resolve even on error to continue with other items
          }
        }, index * 100); // 100ms delay between each request
      });
    });
    
    // Wait for all items to be processed
    await Promise.all(promises);
    
    ui.updateOperationStatus(
      `<strong>Suggestions retrieved for all ${stateObj.emptyFieldItems.length} issues.</strong> You must click "Accept" on each suggestion you want to apply.`,
      'success'
    );
  } catch (error) {
    console.error('Error getting suggestions:', error);
    ui.updateOperationStatus(`Error: ${error.message}`, 'danger');
  } finally {
    ui.toggleLoadingOverlay(false);
    
    // Update the button text
    if (startFixingBtn) {
      startFixingBtn.disabled = false;
      startFixingBtn.innerHTML = '<i class="bi bi-arrow-clockwise"></i> Refresh Suggestions';
    }
  }
}

/**
 * Get suggestion for a specific row/issue
 * @param {HTMLElement|Object} rowOrItem - Either the row element or the issue item
 * @param {Object|number} issueOrIndex - Either the issue object or the index of the item
 * @param {string} [providedFieldType] - Optional field type (used when called from batch processing)
 */
function getSuggestionForRow(rowOrItem, issueOrIndex, providedFieldType) {
  let row, issue, fieldType;
  
  // Handle different call patterns
  if (providedFieldType) {
    // Called with (item, index, fieldType)
    issue = rowOrItem;
    fieldType = providedFieldType;
    
    // Find the row element
    row = document.querySelector(`#row-${issue.id}`);
  } else {
    // Called with (row, issue)
    row = rowOrItem;
    issue = issueOrIndex;
    fieldType = getEmptyFieldName(issue);
  }
  
  const suggestionCell = row?.querySelector('.suggestion-cell');
  
  if (!suggestionCell || !fieldType) {
    console.error('Missing suggestion cell or field type');
    return;
  }
  
  // Show loading in suggestion cell
  suggestionCell.style.display = 'table-cell';
  suggestionCell.innerHTML = `
    <div class="text-center py-2">
      <div class="spinner-border spinner-border-sm text-primary" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
      <small class="d-block mt-1">Getting suggestion...</small>
    </div>
  `;
  
  // Get the field options for this field type from state
  const stateObj = state.getState();
  // Log available field options to debug
  console.log('Field Options in state:', stateObj.fieldOptions);
  console.log('Field type:', fieldType);
  
  // Get the correct field options based on field type
  let fieldOptions = [];
  if (fieldType.toLowerCase() === 'team' && stateObj.fieldOptions?.teams) {
    fieldOptions = stateObj.fieldOptions.teams;
  } else if (fieldType.toLowerCase() === 'function' && stateObj.fieldOptions?.functions) {
    fieldOptions = stateObj.fieldOptions.functions;
  } else if (fieldType.toLowerCase() === 'kind' && stateObj.fieldOptions?.kinds) {
    fieldOptions = stateObj.fieldOptions.kinds;
  }
  
  console.log(`Using ${fieldOptions.length} options for ${fieldType} field`);
  
  // Format options for the suggestion UI
  const formattedOptions = fieldOptions.map(option => ({
    value: option.id || option.value,
    label: option.name || option.text,
    // Store the complete option data to ensure we have all IDs
    originalOption: option
  }));
  
  // Use the appropriate API method based on field type
  const getSuggestionPromise = () => {
    if (fieldType.toLowerCase() === 'function' || fieldType.toLowerCase() === 'kind') {
      // For function and kind fields, use fetchSuggestion which supports team value
      // Get the current team value from the issue fields
      let teamValue = '';
      if (issue.fields && Array.isArray(issue.fields)) {
        const teamField = issue.fields.find(field => 
          field.name && field.name.toLowerCase() === 'team' && field.value
        );
        teamValue = teamField ? teamField.value : '';
      }
      
      // If no team value, check if we have a team filter selected
      if (!teamValue) {
        const teamSelect = document.getElementById('fixTeam');
        if (teamSelect && teamSelect.value) {
          teamValue = teamSelect.value;
        }
      }
      
      return api.fetchSuggestion(fieldType, issue.id, teamValue);
    } else {
      // For team field, use getSuggestion
      return api.getSuggestion(issue.id, fieldType);
    }
  };
  
  // Get suggestions from the API
  getSuggestionPromise()
    .then(data => {
      console.log('Suggestion API response:', data);
      
      // Extract suggestion and metadata from the response
      let suggestion = '';
      let optionId = null;
      let fieldId = null;
      
      if (data.status === 'success') {
        suggestion = data.data?.suggestion || '';
        optionId = data.data?.optionId || null;
        fieldId = data.data?.fieldId || null;
      }
      
      console.log('Extracted suggestion:', suggestion);
      console.log('Option ID:', optionId, 'Field ID:', fieldId);
      
      const currentFields = issue.fields || [];
      
      // Find the option that matches the suggestion or optionId if provided
      let matchingOption = null;
      if (optionId && fieldOptions.length > 0) {
        matchingOption = fieldOptions.find(option => 
          option.id === optionId || option.optionId === optionId
        );
        
        if (matchingOption) {
          console.log('Found matching option by ID:', matchingOption);
          // If we found a match by ID, use the suggestion value from the option
          suggestion = matchingOption.name || matchingOption.text;
        }
      }
      
      // Create the suggestion UI
      createSuggestion(
        issue,
        `#row-${issue.id} .suggestion-cell`,
        formattedOptions,
        currentFields,
        suggestion,
        // Accept callback
        (selectedValue, originalOption) => {
          // Update the field cell
          const fieldCell = row.querySelector('.fields-cell');
          let selectedOption;
          
          // If we received the original option directly, use it
          if (originalOption) {
            selectedOption = originalOption;
            console.log('Using original option data from selection:', selectedOption);
          } else {
            // Otherwise look it up by value
            selectedOption = fieldOptions.find(opt => 
              (opt.id && opt.id === selectedValue) || 
              (opt.value && opt.value === selectedValue)
            );
            console.log('Looking up selected option by value:', selectedOption);
          }
          
          if (selectedOption) {
            // Create a badge for the new field value
            const badge = document.createElement('span');
            badge.className = 'badge bg-success me-1';
            badge.textContent = selectedOption.name || selectedOption.text;
            
            // Add to field cell
            if (fieldCell) {
              const fieldBadges = fieldCell.querySelector('.field-badges');
              if (fieldBadges) {
                fieldBadges.appendChild(badge);
              }
            }
            
            // Hide suggestion cell
            suggestionCell.style.display = 'none';
            
            // Store metadata for the update
            const metadata = {};
            
            // Determine field ID and option ID for the update
            if (selectedOption.id || selectedOption.optionId) {
              // Get option ID from the selected option
              metadata.optionId = selectedOption.id || selectedOption.optionId;
              
              // Try to get field ID from the selected option
              if (selectedOption.fieldId) {
                metadata.fieldId = selectedOption.fieldId;
                console.log('Using complete metadata from selected option:', metadata);
              }
              // Otherwise fallback to the fieldId from the API response
              else if (fieldId) {
                metadata.fieldId = fieldId;
                console.log('Using option ID from selected option and field ID from API:', metadata);
              }
              // As a final fallback, try to find the field ID from state
              else {
                const field = Object.values(stateObj.fieldOptions || {})
                  .find(fields => Array.isArray(fields) && fields.find(f => 
                    f.name === fieldType || f.id === metadata.optionId
                  ));
                  
                if (field && field.id) {
                  metadata.fieldId = field.id;
                  console.log('Using field ID from state lookup:', metadata);
                } else {
                  console.warn('Could not find field ID for update. Using fallback methods.');
                }
              }
            } 
            // If we don't have option IDs from the selected option, use the API response
            else if (optionId && fieldId) {
              metadata.optionId = optionId;
              metadata.fieldId = fieldId;
              console.log('Using metadata from API response:', metadata);
            } 
            // Last resort: use the value directly (custom values API)
            else {
              console.warn('No option/field IDs available. Will use custom value API.');
            }
            
            // Update issue data in GitHub
            api.updateIssueField(issue.id, fieldType, selectedValue, metadata)
              .then(() => {
                // Update local data
                if (!Array.isArray(issue.fields)) {
                  issue.fields = [];
                }
                
                // Find if field already exists
                const existingFieldIndex = issue.fields.findIndex(f => 
                  f.name && f.name.toLowerCase() === fieldType.toLowerCase()
                );
                
                if (existingFieldIndex >= 0) {
                  // Update existing field
                  issue.fields[existingFieldIndex].value = selectedValue;
                } else {
                  // Add new field
                  issue.fields.push({
                    name: fieldType,
                    value: selectedValue
                  });
                }
                
                // Show success message
                ui.showToast('Field updated successfully!', 'success');
                
                // Refresh issues table if needed
                if (typeof showFixResults === 'function') {
                  showFixResults();
                }
              })
              .catch(error => {
                console.error('Error updating field:', error);
                ui.showToast(`Error: ${error.message}`, 'danger');
              });
          }
        },
        // Cancel callback to hide the suggestion
        () => {
          suggestionCell.style.display = 'none';
        }
      );
    })
    .catch(error => {
      console.error('Error getting suggestion:', error);
      suggestionCell.innerHTML = `
        <div class="alert alert-danger mb-0">
          Error getting suggestion: ${error.message}
        </div>
      `;
    });
}

/**
 * Updates the field badge in the row
 * @param {HTMLElement} row - The table row element
 * @param {string} fieldType - The type of field
 * @param {string} value - The new field value
 */
function updateFieldBadge(row, fieldType, value) {
  const fieldsContainer = row.querySelector('.fields-container');
  if (!fieldsContainer) return;
  
  // Check if badge already exists
  let fieldBadge = Array.from(fieldsContainer.querySelectorAll('.field-badge')).find(
    badge => badge.classList.contains(fieldType.toLowerCase())
  );
  
  if (fieldBadge) {
    // Update existing badge
    fieldBadge.textContent = `${fieldType}: ${value}`;
  } else {
    // Create new badge as HTML
    const badgeHTML = `<span class="field-badge ${fieldType.toLowerCase()}">${fieldType}: ${value}</span>`;
    fieldsContainer.insertAdjacentHTML('beforeend', badgeHTML);
  }
}

/**
 * Updates the fix counts display
 * @param {string} type - The type of count to update ('fixed' or 'skipped')
 */
function updateFixCounts(type) {
  const stateObj = state.getState();
  
  if (type === 'fixed') {
    state.updateNestedStateProperty('fixingResults', 'fixed', stateObj.fixingResults.fixed + 1);
    document.getElementById('fixedCount').textContent = stateObj.fixingResults.fixed + 1;
  } else if (type === 'skipped') {
    state.updateNestedStateProperty('fixingResults', 'skipped', stateObj.fixingResults.skipped + 1);
    document.getElementById('skippedCount').textContent = stateObj.fixingResults.skipped + 1;
  }
}

/**
 * Populate select options with data from the API
 * Maintain the "No Team Assigned" option for the fixTeam select
 */
function populateSelectOptions() {
  const stateObj = state.getState();
  if (!stateObj.fieldOptions) return;
  
  // Populate team selects differently for the fix team field
  if (stateObj.fieldOptions.teams) {
    const fixTeamSelect = document.getElementById('fixTeam');
    if (fixTeamSelect) {
      // Keep the existing options (including the no-team option)
      const existingOptions = Array.from(fixTeamSelect.options).slice(0, 2);
      fixTeamSelect.innerHTML = '';
      
      // Add back the existing options
      existingOptions.forEach(option => {
        fixTeamSelect.appendChild(option);
      });
      
      // Add new team options
      stateObj.fieldOptions.teams.forEach(team => {
        const option = document.createElement('option');
        option.value = team.value;
        option.textContent = team.text;
        fixTeamSelect.appendChild(option);
      });
    }
  }
  
  // Populate field type selects
  if (stateObj.fieldOptions.fieldTypes) {
    ui.populateSelectOptions('fixFieldType', stateObj.fieldOptions.fieldTypes, false);
  }
} 