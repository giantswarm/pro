/**
 * Field Fixing Module
 * Handles the functionality for finding and fixing empty fields
 */

import * as state from './state.js';
import * as api from './api.js';
import * as ui from '../utils/ui.js';
import { createSuggestionModal } from '../components/suggestionModal.js';

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
  const teamValue = document.getElementById('fixTeam').value;
  const fieldType = document.getElementById('fixFieldType').value;
  
  if (!fieldType) {
    ui.updateOperationStatus('Please select a field type to fix', 'danger');
    ui.toggleLoadingOverlay(false);
    return;
  }
  
  try {
    // Update state
    state.updateNestedStateProperty('fetchingDetails', 'step', 'fetching');
    
    // Build filters
    const filters = {
      team: teamValue
    };
    
    // Update loading status based on team filter
    if (teamValue === 'no-team') {
      ui.updateLoadingStatus('Searching for issues with no team assigned...');
    } else if (teamValue) {
      ui.updateLoadingStatus(`Searching for issues in team: ${teamValue}...`);
    } else {
      ui.updateLoadingStatus('Searching for all issues across teams...');
    }
    
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
        field.name && field.name.toLowerCase() === fieldType && field.value && field.value.trim() !== ''
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
    document.getElementById('startFixingBtn').innerHTML = '<i class="bi bi-lightning-charge me-1"></i>Start Fixing All';
    
  } catch (error) {
    console.error('Error fetching items:', error);
    ui.updateOperationStatus(`Error: ${error.message}`, 'danger');
    ui.updateLoadingStatus(`Error fetching items: ${error.message}`, 'error');
  } finally {
    ui.toggleLoadingOverlay(false);
  }
}

/**
 * Build the issues table with the found items
 * @param {Array} items - The issues with empty fields
 * @param {string} fieldType - The type of field to fix
 */
function buildIssuesTable(items, fieldType) {
  const tableBody = document.getElementById('issuesTableBody');
  if (!tableBody) return;
  
  tableBody.innerHTML = '';
  
  items.forEach((item, index) => {
    const row = document.createElement('tr');
    row.dataset.index = index;
    
    // Issue column
    const issueCell = document.createElement('td');
    const issueLink = document.createElement('a');
    issueLink.href = item.url;
    issueLink.target = '_blank';
    issueLink.textContent = `#${item.number}: ${item.title}`;
    issueCell.appendChild(issueLink);
    
    // Fields column
    const fieldsCell = document.createElement('td');
    item.fields.forEach(field => {
      if (field.name && field.value) {
        const fieldBadge = document.createElement('span');
        const fieldClass = field.name.toLowerCase();
        fieldBadge.className = `field-badge ${fieldClass}`;
        fieldBadge.textContent = `${field.name}: ${field.value}`;
        fieldsCell.appendChild(fieldBadge);
      }
    });
    
    // Action column - add a "Fix Now" button for each row
    const actionCell = document.createElement('td');
    const fixNowBtn = document.createElement('button');
    fixNowBtn.className = 'btn btn-sm btn-primary fix-now-btn';
    fixNowBtn.innerHTML = '<i class="bi bi-magic me-1"></i>Fix Now';
    fixNowBtn.addEventListener('click', () => fixSingleIssue(index));
    actionCell.appendChild(fixNowBtn);
    
    row.appendChild(issueCell);
    row.appendChild(fieldsCell);
    row.appendChild(actionCell);
    tableBody.appendChild(row);
  });
}

/**
 * Fixes a single issue at the given index
 * @param {number} index - The index of the issue to fix
 */
export async function fixSingleIssue(index) {
  const stateObj = state.getState();
  
  // Prevent multiple concurrent operations
  if (stateObj.isProcessingSuggestion) {
    return;
  }
  
  state.updateStateProperty('isProcessingSuggestion', true);
  
  const fieldType = document.getElementById('fixFieldType').value;
  const teamValue = document.getElementById('fixTeam').value;
  
  if (!fieldType) {
    alert('Please select a field type to fix');
    state.updateStateProperty('isProcessingSuggestion', false);
    return;
  }
  
  const currentItem = stateObj.emptyFieldItems[index];
  if (!currentItem) {
    alert('Issue not found');
    state.updateStateProperty('isProcessingSuggestion', false);
    return;
  }
  
  // Disable the button and show processing state
  const row = document.querySelector(`#issuesTableBody tr[data-index="${index}"]`);
  const fixButton = row.querySelector('.fix-now-btn');
  const originalButtonText = fixButton.innerHTML;
  fixButton.disabled = true;
  fixButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Processing...';
  
  try {
    // Show progress container and update current issue info
    document.getElementById('fixProgressContainer').style.display = 'block';
    document.getElementById('currentIssueNumber').textContent = currentItem.number;
    document.getElementById('currentIssueTitle').textContent = currentItem.title;
    ui.updateStatusMessage(`Getting ${fieldType} suggestion...`);
    
    // Get suggestion from API
    const result = await api.fetchSuggestion(fieldType, currentItem.id, teamValue);
    document.getElementById('suggestionStatusMessage').style.display = 'none';
    
    if (result.status === 'success' && result.data && result.data.suggestion) {
      // Show a confirmation modal with the suggested value
      const suggestionResult = await createSuggestionModal(currentItem, fieldType, result.data.suggestion);
      
      if (suggestionResult && suggestionResult.accepted) {
        const finalValue = suggestionResult.value;
        
        // If the user provided a custom value, apply it
        if (suggestionResult.isCustom) {
          ui.updateStatusMessage('Applying custom value...');
          
          const customResult = await api.applyFieldValue(fieldType, currentItem.id, teamValue, finalValue);
          document.getElementById('suggestionStatusMessage').style.display = 'none';
          
          if (customResult.status !== 'success') {
            throw new Error(customResult.error || 'Failed to apply custom value');
          }
        }
        
        // Update the row to show the new value
        const fieldBadge = document.createElement('span');
        fieldBadge.className = `field-badge ${fieldType}`;
        fieldBadge.textContent = `${fieldType.charAt(0).toUpperCase() + fieldType.slice(1)}: ${finalValue}`;
        
        // Find or create the fields cell
        const fieldsCell = row.querySelector('td:nth-child(2)');
        
        // Remove any existing badge for this field type
        const existingBadge = fieldsCell.querySelector(`.field-badge.${fieldType}`);
        if (existingBadge) {
          fieldsCell.removeChild(existingBadge);
        }
        
        // Add the new badge
        fieldsCell.appendChild(fieldBadge);
        
        // Mark row as fixed
        row.classList.add('table-success');
        fixButton.innerHTML = '<i class="bi bi-check-circle me-1"></i>Fixed';
        fixButton.classList.remove('btn-primary');
        fixButton.classList.add('btn-success');
        
        // Update state
        state.updateNestedStateProperty('fixingResults', 'fixed', stateObj.fixingResults.fixed + 1);
        
        // Update the fixed counter in the status area if it exists
        const fixedCountEl = document.getElementById('fixedCount');
        if (fixedCountEl) {
          fixedCountEl.textContent = stateObj.fixingResults.fixed + 1;
        }
        
        ui.updateOperationStatus(`Successfully fixed ${stateObj.fixingResults.fixed + 1} issue(s)`, 'success');
      } else {
        // User rejected the suggestion
        fixButton.innerHTML = originalButtonText;
        fixButton.disabled = false;
        state.updateNestedStateProperty('fixingResults', 'skipped', stateObj.fixingResults.skipped + 1);
        
        // Update the skipped counter if it exists
        const skippedCountEl = document.getElementById('skippedCount');
        if (skippedCountEl) {
          skippedCountEl.textContent = stateObj.fixingResults.skipped + 1;
        }
      }
    } else {
      // Error from API
      fixButton.innerHTML = '<i class="bi bi-exclamation-triangle me-1"></i>Failed';
      fixButton.classList.remove('btn-primary');
      fixButton.classList.add('btn-danger');
      row.classList.add('table-danger');
      alert(`Error fixing field: ${result.data?.message || 'Unknown error'}`);
    }
  } catch (error) {
    console.error(`Error fixing ${fieldType} for issue #${currentItem.number}:`, error);
    fixButton.innerHTML = '<i class="bi bi-exclamation-triangle me-1"></i>Error';
    fixButton.classList.remove('btn-primary');
    fixButton.classList.add('btn-danger');
    alert(`Error: ${error.message}`);
  } finally {
    state.updateStateProperty('isProcessingSuggestion', false);
  }
}

/**
 * Start fixing all empty fields
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
  
  // Ask for confirmation if there are many issues
  if (stateObj.emptyFieldItems.length > 10) {
    const confirmed = await ui.showConfirmation({
      title: 'Confirm Batch Processing',
      message: `You are about to process ${stateObj.emptyFieldItems.length} issues. This might take some time. Continue?`,
      type: 'primary'
    });
    
    if (!confirmed) return;
  }
  
  // Reset fixing state
  state.updateStateProperty('currentFixingIndex', 0);
  state.updateNestedStateProperty('fixingResults', 'total', stateObj.emptyFieldItems.length);
  state.updateNestedStateProperty('fixingResults', 'fixed', 0);
  state.updateNestedStateProperty('fixingResults', 'skipped', 0);
  state.updateStateProperty('isProcessingSuggestion', false);
  
  // Show progress container
  document.getElementById('fixProgressContainer').style.display = 'block';
  
  // Update progress
  document.getElementById('fixProgress').style.display = 'block';
  document.getElementById('fixProgressBar').style.width = '0%';
  document.getElementById('fixResults').style.display = 'block';
  document.getElementById('totalCount').textContent = stateObj.emptyFieldItems.length;
  document.getElementById('fixedCount').textContent = 0;
  document.getElementById('skippedCount').textContent = 0;
  
  // Begin interactive fixing process
  await showNextSuggestion();
}

/**
 * Show the next suggestion in the batch process
 */
async function showNextSuggestion() {
  const stateObj = state.getState();
  
  if (stateObj.currentFixingIndex >= stateObj.emptyFieldItems.length) {
    // All done
    ui.updateOperationStatus(
      `Completed! Fixed ${stateObj.fixingResults.fixed} of ${stateObj.fixingResults.total} issues ` +
      `(${stateObj.fixingResults.skipped} skipped)`, 
      'success'
    );
    return;
  }
  
  if (stateObj.isProcessingSuggestion) {
    // Don't process multiple suggestions at once
    return;
  }
  
  state.updateStateProperty('isProcessingSuggestion', true);
  
  try {
    // Get field type and team value
    const fieldType = document.getElementById('fixFieldType').value;
    const teamValue = document.getElementById('fixTeam').value;
    
    if (!fieldType) {
      throw new Error('No field type selected');
    }
    
    const currentItem = stateObj.emptyFieldItems[stateObj.currentFixingIndex];
    if (!currentItem) {
      throw new Error('Issue not found');
    }
    
    // Highlight the current row
    const rows = document.querySelectorAll('#issuesTableBody tr');
    rows.forEach(row => row.classList.remove('table-active'));
    const currentRow = document.querySelector(`#issuesTableBody tr[data-index="${stateObj.currentFixingIndex}"]`);
    if (currentRow) {
      currentRow.classList.add('table-active');
      currentRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    
    // Update progress display
    const progressPercent = (stateObj.currentFixingIndex / stateObj.emptyFieldItems.length) * 100;
    document.getElementById('fixProgressBar').style.width = `${progressPercent}%`;
    document.getElementById('currentIssueNumber').textContent = currentItem.number;
    document.getElementById('currentIssueTitle').textContent = currentItem.title;
    document.getElementById('currentIssueIndex').textContent = stateObj.currentFixingIndex + 1;
    document.getElementById('totalIssues').textContent = stateObj.emptyFieldItems.length;
    
    // Get suggestion from API
    ui.updateStatusMessage(`Getting ${fieldType} suggestion from AI for issue #${currentItem.number}...`);
    
    const result = await api.fetchSuggestion(fieldType, currentItem.id, teamValue);
    document.getElementById('suggestionStatusMessage').style.display = 'none';
    
    if (result.status !== 'success' || !result.data || !result.data.suggestion) {
      throw new Error('No suggestion received from API');
    }
    
    // Show interactive suggestion modal
    const suggestionResult = await createSuggestionModal(currentItem, fieldType, result.data.suggestion);
    
    if (!suggestionResult || !suggestionResult.accepted) {
      // User rejected the suggestion
      if (currentRow) {
        currentRow.classList.remove('table-active');
        currentRow.classList.add('table-warning');
        
        // Update the fix button
        const fixButton = currentRow.querySelector('.fix-now-btn');
        if (fixButton) {
          fixButton.innerHTML = '<i class="bi bi-skip-forward me-1"></i>Skipped';
          fixButton.classList.remove('btn-primary');
          fixButton.classList.add('btn-warning');
        }
      }
      
      // Update counts
      state.updateNestedStateProperty('fixingResults', 'skipped', stateObj.fixingResults.skipped + 1);
      document.getElementById('skippedCount').textContent = stateObj.fixingResults.skipped + 1;
    } else {
      // User accepted a suggestion or provided a custom value
      const finalValue = suggestionResult.value;
      
      // If this was a custom value, make an additional API call to apply it
      if (suggestionResult.isCustom) {
        ui.updateStatusMessage(`Applying custom ${fieldType} value...`);
        
        // Apply the custom value
        const customResult = await api.applyFieldValue(fieldType, currentItem.id, teamValue, finalValue);
        
        if (customResult.status !== 'success') {
          throw new Error(customResult.error || 'Failed to apply custom value');
        }
        
        document.getElementById('suggestionStatusMessage').style.display = 'none';
      }
      
      // Update the row to show the new value
      if (currentRow) {
        const fieldBadge = document.createElement('span');
        fieldBadge.className = `field-badge ${fieldType}`;
        fieldBadge.textContent = `${fieldType.charAt(0).toUpperCase() + fieldType.slice(1)}: ${finalValue}`;
        
        // Find or create the fields cell
        const fieldsCell = currentRow.querySelector('td:nth-child(2)');
        
        // Remove any existing badge for this field type
        const existingBadge = fieldsCell.querySelector(`.field-badge.${fieldType}`);
        if (existingBadge) {
          fieldsCell.removeChild(existingBadge);
        }
        
        // Add the new badge
        fieldsCell.appendChild(fieldBadge);
        
        // Mark row as fixed
        currentRow.classList.remove('table-active');
        currentRow.classList.add('table-success');
        
        // Update the fix button
        const fixButton = currentRow.querySelector('.fix-now-btn');
        if (fixButton) {
          fixButton.innerHTML = '<i class="bi bi-check-circle me-1"></i>Fixed';
          fixButton.classList.remove('btn-primary');
          fixButton.classList.add('btn-success');
          fixButton.disabled = true;
        }
      }
      
      // Update state
      state.updateNestedStateProperty('fixingResults', 'fixed', stateObj.fixingResults.fixed + 1);
      document.getElementById('fixedCount').textContent = stateObj.fixingResults.fixed + 1;
      ui.updateOperationStatus(`Successfully fixed ${stateObj.fixingResults.fixed + 1} issue(s)`, 'success');
    }
  } catch (error) {
    console.error(`Error processing issue at index ${stateObj.currentFixingIndex}:`, error);
    
    // Mark as error in the UI
    const currentRow = document.querySelector(`#issuesTableBody tr[data-index="${stateObj.currentFixingIndex}"]`);
    if (currentRow) {
      currentRow.classList.remove('table-active');
      currentRow.classList.add('table-danger');
      
      // Update the fix button
      const fixButton = currentRow.querySelector('.fix-now-btn');
      if (fixButton) {
        fixButton.innerHTML = '<i class="bi bi-exclamation-triangle me-1"></i>Error';
        fixButton.classList.remove('btn-primary');
        fixButton.classList.add('btn-danger');
      }
    }
    
    // Update counts
    state.updateNestedStateProperty('fixingResults', 'skipped', stateObj.fixingResults.skipped + 1);
    document.getElementById('skippedCount').textContent = stateObj.fixingResults.skipped + 1;
    
    // Show error in status message
    ui.updateStatusMessage(`Error: ${error.message}`, false);
  } finally {
    // Move to next issue
    state.updateStateProperty('currentFixingIndex', stateObj.currentFixingIndex + 1);
    state.updateStateProperty('isProcessingSuggestion', false);
    
    // Process next issue with a slight delay
    setTimeout(() => {
      showNextSuggestion();
    }, 500);
  }
} 