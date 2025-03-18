/**
 * UI utilities for common UI operations
 */

/**
 * Shows or hides the loading overlay with a message
 * @param {boolean} show - Whether to show or hide the overlay
 * @param {string} message - The message to display
 * @param {string} type - The type of message (info, success, error)
 */
export function toggleLoadingOverlay(show, message = '', type = 'info') {
  const overlay = document.getElementById('loadingOverlay');
  if (!overlay) return;
  
  if (show) {
    overlay.style.display = 'flex';
    if (message) {
      updateLoadingStatus(message, type);
    }
  } else {
    // Set a short timeout to ensure user sees the success/error message
    setTimeout(() => {
      overlay.style.display = 'none';
    }, 1000);
  }
}

/**
 * Update the loading status message
 * @param {string} message - The message to display
 * @param {string} type - The type of message (info, success, error)
 */
export function updateLoadingStatus(message, type = 'info') {
  // Create or update the status message element in the loading overlay
  let statusEl = document.getElementById('loadingStatusMessage');
  
  if (!statusEl) {
    statusEl = document.createElement('p');
    statusEl.id = 'loadingStatusMessage';
    statusEl.className = 'mt-2 loading-status-message';
    
    const loadingContent = document.querySelector('.loading-overlay > div') || document.querySelector('.loading-overlay');
    if (loadingContent) {
      loadingContent.appendChild(statusEl);
    }
  }
  
  // Update class based on message type
  statusEl.className = 'mt-2 loading-status-message';
  if (type === 'error') {
    statusEl.classList.add('text-danger');
    statusEl.innerHTML = `<i class="bi bi-exclamation-triangle"></i> ${message}`;
  } else if (type === 'success') {
    statusEl.classList.add('text-success');
    statusEl.innerHTML = `<i class="bi bi-check-circle"></i> ${message}`;
  } else {
    statusEl.classList.add('text-primary');
    // Only add spinner to info messages
    statusEl.innerHTML = `<span class="spinner-icon"><i class="bi bi-arrow-repeat"></i></span> ${message}`;
  }
}

/**
 * Update the status message for suggestion processing
 * @param {string} message - The message to display
 * @param {boolean} isLoading - Whether to show a loading spinner
 */
export function updateStatusMessage(message, isLoading = true) {
  const statusMessageEl = document.getElementById('suggestionStatusMessage');
  if (!statusMessageEl) return;
  
  if (isLoading) {
    statusMessageEl.innerHTML = `<span class="spinner-icon"><i class="bi bi-arrow-repeat"></i></span> ${message}`;
    statusMessageEl.style.display = 'block';
  } else {
    statusMessageEl.textContent = message;
    statusMessageEl.style.display = message ? 'block' : 'none';
  }
}

/**
 * Updates the operation status text
 * @param {string} message - The message to display
 * @param {string} type - The type of message (success, warning, danger)
 */
export function updateOperationStatus(message, type = 'success') {
  const statusEl = document.getElementById('fixFieldsStatus');
  if (!statusEl) return;
  
  statusEl.innerHTML = `<p class="text-${type} mb-0">${message}</p>`;
}

/**
 * Populate a select element with options
 * @param {string} selectId - The ID of the select element
 * @param {Array} options - The array of options to add
 * @param {boolean} includeAllOption - Whether to include an "All" option
 */
export function populateSelectOptions(selectId, options, includeAllOption = true) {
  const select = document.getElementById(selectId);
  if (!select) return;
  
  // Clear existing options
  select.innerHTML = includeAllOption ? '<option value="">All</option>' : '';
  
  // Add new options
  options.forEach(option => {
    const optionEl = document.createElement('option');
    optionEl.value = option.value;
    optionEl.textContent = option.text;
    select.appendChild(optionEl);
  });
}

/**
 * Show a modal dialog
 * @param {Object} options - Modal options
 * @param {string} options.title - The modal title
 * @param {string} options.message - The modal message
 * @param {string} options.type - The modal type (info, success, warning, danger)
 * @param {Function} options.onConfirm - Callback for confirmation
 * @param {Function} options.onCancel - Callback for cancellation
 * @returns {Promise<boolean>} Whether the user confirmed or cancelled
 */
export function showConfirmation(options) {
  return new Promise((resolve) => {
    const confirmModal = document.createElement('div');
    confirmModal.className = 'suggestion-modal';
    confirmModal.innerHTML = `
      <div class="suggestion-modal-content" style="max-width: 400px;">
        <div class="suggestion-modal-header">
          <h5 class="modal-title">${options.title || 'Confirmation'}</h5>
          <button type="button" class="btn-close" id="closeConfirmModal"></button>
        </div>
        <div class="suggestion-modal-body">
          <p>${options.message || 'Are you sure?'}</p>
        </div>
        <div class="suggestion-modal-footer">
          <button type="button" class="btn btn-secondary" id="cancelConfirmation">Cancel</button>
          <button type="button" class="btn btn-${options.type || 'primary'}" id="confirmAction">Confirm</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(confirmModal);
    
    const closeModal = () => {
      document.body.removeChild(confirmModal);
    };
    
    document.getElementById('closeConfirmModal').addEventListener('click', () => {
      closeModal();
      resolve(false);
      if (options.onCancel) options.onCancel();
    });
    
    document.getElementById('cancelConfirmation').addEventListener('click', () => {
      closeModal();
      resolve(false);
      if (options.onCancel) options.onCancel();
    });
    
    document.getElementById('confirmAction').addEventListener('click', () => {
      closeModal();
      resolve(true);
      if (options.onConfirm) options.onConfirm();
    });
  });
} 