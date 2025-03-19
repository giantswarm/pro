/**
 * UI Utilities Module
 * 
 * WHY:
 * This module provides a centralized collection of UI helper functions that are used
 * throughout the application to create a consistent user experience. By isolating these
 * common UI operations, we:
 * - Ensure visual consistency across the application
 * - Reduce code duplication in component files
 * - Simplify maintenance by having single implementations for common UI patterns
 * - Make the codebase more maintainable and testable
 * - Enable easier UI updates and improvements across the entire application
 * 
 * HOW:
 * The module provides pure utility functions that:
 * - Manipulate DOM elements directly
 * - Create and manage UI components like overlays, toasts, and status messages
 * - Control visual feedback for asynchronous operations
 * - Handle common UI interactions like confirmations and form controls
 * 
 * These utilities accept configuration options for customization while maintaining
 * consistent styling and behavior aligned with the application's design system.
 * 
 * WHAT:
 * Key functionalities include:
 * - Loading indicators and overlays for async operations
 * - Toast notifications for user feedback
 * - Status message handling and updates
 * - Form control population and management
 * - Confirmation dialogs
 * - Visual feedback for operation status
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
 * Shows a toast notification
 * @param {string} message - The message to display
 * @param {string} type - The type of message (success, danger, warning, info)
 * @param {number} duration - How long to show the toast in ms
 */
export function showToast(message, type = 'success', duration = 3000) {
  // Create toast container if it doesn't exist
  let toastContainer = document.getElementById('toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.className = 'position-fixed bottom-0 end-0 p-3';
    toastContainer.style.zIndex = '1050';
    document.body.appendChild(toastContainer);
  }
  
  // Create toast element
  const toastId = `toast-${Date.now()}`;
  const toast = document.createElement('div');
  toast.id = toastId;
  toast.className = `toast show bg-${type} text-white`;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');
  toast.setAttribute('aria-atomic', 'true');
  
  // Add toast content
  toast.innerHTML = `
    <div class="toast-header bg-${type} text-white">
      <strong class="me-auto">Notification</strong>
      <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close"></button>
    </div>
    <div class="toast-body">
      ${message}
    </div>
  `;
  
  // Add to container
  toastContainer.appendChild(toast);
  
  // Close button functionality
  const closeBtn = toast.querySelector('.btn-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      toast.classList.remove('show');
      setTimeout(() => {
        toastContainer.removeChild(toast);
      }, 300);
    });
  }
  
  // Auto-remove after duration
  setTimeout(() => {
    if (document.getElementById(toastId)) {
      toast.classList.remove('show');
      setTimeout(() => {
        if (document.getElementById(toastId) && toastContainer.contains(toast)) {
          toastContainer.removeChild(toast);
        }
      }, 300);
    }
  }, duration);
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
 * Show a confirmation box inline instead of as a modal
 * @param {Object} options - Confirmation options
 * @param {string} options.title - The confirmation title
 * @param {string} options.message - The confirmation message
 * @param {string} options.type - The confirmation type (info, success, warning, danger)
 * @param {Function} options.onConfirm - Callback for confirmation
 * @param {Function} options.onCancel - Callback for cancellation
 * @param {Element} options.container - Container element to add the confirmation to (optional)
 * @returns {Promise<boolean>} Whether the user confirmed or cancelled
 */
export function showConfirmation(options) {
  return new Promise((resolve) => {
    // Create the confirmation element
    const confirmElement = document.createElement('div');
    confirmElement.className = 'suggestion-container';
    confirmElement.style.animation = 'slideDown 0.3s ease-out';
    confirmElement.innerHTML = `
      <div class="suggestion-section">
        <h5 class="suggestion-title">${options.title || 'Confirmation'}</h5>
        <p>${options.message || 'Are you sure?'}</p>
      </div>
      <div class="suggestion-section suggestion-actions">
        <div class="d-flex justify-content-end">
          <button type="button" class="btn btn-secondary me-2" id="cancelConfirmation">Cancel</button>
          <button type="button" class="btn btn-${options.type || 'primary'}" id="confirmAction">Confirm</button>
        </div>
      </div>
    `;
    
    // Find or create container
    let container = options.container;
    if (!container) {
      // If no container is provided, create one and append to body
      container = document.createElement('div');
      container.className = 'confirmation-container';
      container.style.position = 'fixed';
      container.style.bottom = '20px';
      container.style.right = '20px';
      container.style.zIndex = '1050';
      container.style.maxWidth = '400px';
      document.body.appendChild(container);
    }
    
    // Add to container
    container.appendChild(confirmElement);
    
    const removeConfirmation = () => {
      container.removeChild(confirmElement);
      // If we created the container, clean it up when empty
      if (!options.container && container.children.length === 0) {
        document.body.removeChild(container);
      }
    };
    
    document.getElementById('cancelConfirmation').addEventListener('click', () => {
      removeConfirmation();
      resolve(false);
      if (options.onCancel) options.onCancel();
    });
    
    document.getElementById('confirmAction').addEventListener('click', () => {
      removeConfirmation();
      resolve(true);
      if (options.onConfirm) options.onConfirm();
    });
  });
} 