/**
 * Field Fixing Module
 * 
 * WHY:
 * This module is the core functionality of the "Fix Empty Fields" feature in the application.
 * It addresses a critical business need to efficiently fill in missing metadata on GitHub issues,
 * which improves issue categorization, searchability, and team assignment. Properly tagged issues:
 * - Enable better work distribution and team assignment
 * - Facilitate accurate reporting and visualization of issue distribution
 * - Improve search functionality and filtering capabilities
 * - Ensure consistent metadata across the project repository
 * - Save developer time by automating manual tagging work
 * 
 * HOW:
 * The module implements a comprehensive workflow that:
 * 1. Provides user interface controls for selecting field types and filtering criteria
 * 2. Fetches and filters issues with empty fields from the GitHub API
 * 3. Displays issues in an interactive UI for review and processing
 * 4. Leverages AI to generate appropriate suggestions for empty fields
 * 5. Allows users to review, edit, and apply suggestions
 * 6. Tracks progress and manages the overall batch processing experience
 * 
 * It utilizes the following patterns:
 * - Event-driven UI updates for real-time feedback
 * - Batch processing with progressive feedback
 * - Asynchronous API requests with loading state management
 * - Conditional UI rendering based on field types
 * 
 * WHAT:
 * The module provides functions for:
 * - Initializing the fix fields UI and event listeners
 * - Handling field type selection changes
 * - Finding issues with specified empty fields
 * - Displaying filtered issues in a structured format
 * - Processing batch suggestions from AI
 * - Applying field values to individual or multiple issues
 * - Managing the suggestion review workflow
 * - Updating UI based on operation progress and status
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
    suggestionCell.id = `suggestion-${issue.id}`;
    // Don't hide by default, just leave it empty
    suggestionCell.innerHTML = ''; // Empty by default
    
    // Action cell
    const actionCell = document.createElement('td');
    actionCell.className = 'action-cell';
    actionCell.id = `action-${issue.id}`;
    
    const getSuggestionBtn = document.createElement('button');
    getSuggestionBtn.className = 'btn btn-sm btn-primary get-suggestion-btn';
    getSuggestionBtn.id = `get-suggestion-${issue.id}`;
    getSuggestionBtn.innerHTML = '<i class="fas fa-magic me-1"></i> Get Suggestion';
    getSuggestionBtn.addEventListener('click', () => {
      // Get suggestion for this row
      getSuggestionForRow(row, issue);
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
  const actionCell = row?.querySelector('.action-cell');
  
  if (!suggestionCell || !fieldType) {
    console.error('Missing suggestion cell or field type');
    return;
  }
  
  // Store original action cell content
  const originalActionContent = actionCell.innerHTML;
  
  // Show loading in suggestion cell
  suggestionCell.innerHTML = `
    <div class="text-center py-2">
      <div class="spinner-border spinner-border-sm text-primary" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
      <small class="d-block mt-1">Getting suggestion...</small>
    </div>
  `;
  
  // Replace action cell with loading state
  actionCell.innerHTML = `
    <button class="btn btn-sm btn-secondary" disabled>
      <i class="fas fa-spinner fa-spin me-1"></i> Loading...
    </button>
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
  
  // Use fetchSuggestion for all field types
  const getSuggestionPromise = () => {
    // Get the current team value from the issue fields (for function and kind fields)
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
      
      // Format options for the suggestion UI
      const formattedOptions = fieldOptions.map(option => ({
        value: option.id || option.value,
        label: option.name || option.text,
        // Store the complete option data to ensure we have all IDs
        originalOption: option
      }));
      
      // Create the suggestion UI in the suggestion cell (without action buttons)
      const selectId = `suggestion-select-${issue.id}`;
      suggestionCell.innerHTML = '';
      suggestionCell.classList.add('suggestion-minimal');

      // Create select element
      const formGroup = document.createElement('div');
      formGroup.className = 'form-group';
      
      const select = document.createElement('select');
      select.className = 'form-select';
      select.id = selectId;
      
      // Add empty option
      const emptyOption = document.createElement('option');
      emptyOption.value = '';
      emptyOption.textContent = 'Select field';
      select.appendChild(emptyOption);
      
      // Track if we've matched and selected the AI suggestion
      let foundMatch = false;
      
      // Add options from fieldOptions
      formattedOptions.forEach(option => {
        const optionEl = document.createElement('option');
        optionEl.value = option.value;
        optionEl.textContent = option.label;
        
        // Store the original option data as a data attribute if available
        if (option.originalOption) {
          optionEl.dataset.originalOption = JSON.stringify(option.originalOption);
        }
        
        // Check for a match with the AI suggestion
        const isMatch = 
          option.value === suggestion || 
          option.label.toLowerCase() === suggestion.toLowerCase();
        
        if (isMatch) {
          optionEl.selected = true;
          foundMatch = true;
        }
        
        select.appendChild(optionEl);
      });
      
      // If we didn't find a match but have a suggestion, add it as a custom option
      if (!foundMatch && suggestion && suggestion.trim() !== '') {
        const customOption = document.createElement('option');
        customOption.value = suggestion;
        customOption.textContent = `${suggestion} (Custom)`;
        customOption.selected = true;
        select.appendChild(customOption);
      }
      
      formGroup.appendChild(select);
      suggestionCell.appendChild(formGroup);
      
      // Create actions in the action cell
      actionCell.innerHTML = '';
      
      // Accept button
      const acceptBtn = document.createElement('button');
      acceptBtn.className = 'btn btn-sm btn-success me-2';
      acceptBtn.innerHTML = '<i class="fas fa-check me-1"></i> Accept';
      acceptBtn.addEventListener('click', () => {
        const selectedValue = select.value;
        if (selectedValue) {
          // Get the selected option element
          const selectedOptionEl = select.options[select.selectedIndex];
          
          // Try to retrieve the original option data from the data attribute
          let originalOption = null;
          if (selectedOptionEl.dataset.originalOption) {
            try {
              originalOption = JSON.parse(selectedOptionEl.dataset.originalOption);
            } catch (e) {
              console.error('Error parsing original option data:', e);
            }
          }
          
          // Update the field cell
          const fieldCell = row.querySelector('.fields-cell');
          let selectedOption;
          
          // If we received the original option directly, use it
          if (originalOption) {
            selectedOption = originalOption;
          } else {
            // Otherwise look it up by value
            selectedOption = fieldOptions.find(opt => 
              (opt.id && opt.id === selectedValue) || 
              (opt.value && opt.value === selectedValue)
            );
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
              metadata.optionId = selectedOption.id || selectedOption.optionId;
              
              // Try to get field ID from the selected option
              if (selectedOption.fieldId) {
                metadata.fieldId = selectedOption.fieldId;
              }
              // Otherwise fallback to the fieldId from the API response
              else if (fieldId) {
                metadata.fieldId = fieldId;
              }
            } 
            // If we don't have option IDs from the selected option, use the API response
            else if (optionId && fieldId) {
              metadata.optionId = optionId;
              metadata.fieldId = fieldId;
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
                
                // Restore the Get Suggestion button
                actionCell.innerHTML = originalActionContent;
                
                // Re-attach event listener to the restored button
                const restoredBtn = actionCell.querySelector('.get-suggestion-btn');
                if (restoredBtn) {
                  restoredBtn.addEventListener('click', () => {
                    getSuggestionForRow(row, issue);
                  });
                }
              })
              .catch(error => {
                console.error('Error updating field:', error);
                ui.showToast(`Error: ${error.message}`, 'danger');
                // Restore the Get Suggestion button
                actionCell.innerHTML = originalActionContent;
                
                // Re-attach event listener to the restored button
                const restoredBtn = actionCell.querySelector('.get-suggestion-btn');
                if (restoredBtn) {
                  restoredBtn.addEventListener('click', () => {
                    getSuggestionForRow(row, issue);
                  });
                }
              });
          }
        } else {
          alert('Please select a field value');
        }
      });
      
      // Cancel button
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn btn-sm btn-outline-secondary';
      cancelBtn.innerHTML = 'Cancel';
      cancelBtn.addEventListener('click', () => {
        // Hide suggestion
        suggestionCell.innerHTML = '';
        // Restore the Get Suggestion button
        actionCell.innerHTML = originalActionContent;
        
        // Re-attach event listener to the restored button
        const restoredBtn = actionCell.querySelector('.get-suggestion-btn');
        if (restoredBtn) {
          restoredBtn.addEventListener('click', () => {
            getSuggestionForRow(row, issue);
          });
        }
      });
      
      actionCell.appendChild(acceptBtn);
      actionCell.appendChild(cancelBtn);
    })
    .catch(error => {
      console.error('Error getting suggestion:', error);
      
      // Show error in suggestion cell
      suggestionCell.innerHTML = `
        <div class="alert alert-danger mb-0 py-2">
          <small>Error: ${error.message || 'Failed to get suggestion'}</small>
        </div>
      `;
      
      // Restore the Get Suggestion button
      actionCell.innerHTML = originalActionContent;
      
      // Re-attach event listener to the restored button
      const restoredBtn = actionCell.querySelector('.get-suggestion-btn');
      if (restoredBtn) {
        restoredBtn.addEventListener('click', () => {
          getSuggestionForRow(row, issue);
        });
      }
    });
} 