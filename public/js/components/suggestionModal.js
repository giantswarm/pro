/**
 * Suggestion Modal Component
 * Provides UI for displaying and interacting with field suggestions
 */

/**
 * Creates and displays a modal for field suggestions
 * @param {Object} issue - The issue object
 * @param {string} fieldType - The type of field being fixed
 * @param {string} suggestion - The suggested value
 * @returns {Promise<Object|boolean>} The result of the user interaction
 */
export function createSuggestionModal(issue, fieldType, suggestion) {
  // Create modal
  const modal = document.createElement('div');
  modal.className = 'suggestion-modal';
  modal.innerHTML = `
    <div class="suggestion-modal-content">
      <div class="suggestion-modal-header">
        <h5 class="modal-title">AI Suggestion for Issue #${issue.number}</h5>
        <button type="button" class="btn-close" id="closeModal"></button>
      </div>
      <div class="suggestion-modal-body">
        <p class="issue-title"><strong>Issue:</strong> ${issue.title}</p>
        <p class="issue-link"><a href="${issue.url}" target="_blank">View issue on GitHub <i class="bi bi-box-arrow-up-right"></i></a></p>
        
        <div class="context-section mb-3">
          <h6 class="context-heading">Current Fields:</h6>
          <div class="fields-container mb-2">
            ${issue.fields.map(field => 
              `<span class="field-badge ${field.name.toLowerCase()}">${field.name}: ${field.value || 'empty'}</span>`
            ).join('')}
          </div>
        </div>
        
        <div class="suggestion-highlight">
          <p class="suggestion-label"><strong>Suggested ${fieldType}:</strong></p>
          <p class="suggestion-value">${suggestion}</p>
        </div>
        
        <div class="custom-input-section mt-3" style="display: none;">
          <div class="form-group">
            <label for="customValueInput" class="form-label">Custom ${fieldType} value:</label>
            <input type="text" class="form-control" id="customValueInput" placeholder="Enter your own value">
          </div>
        </div>
      </div>
      <div class="suggestion-modal-footer">
        <div class="d-flex flex-column flex-md-row w-100 justify-content-between">
          <button type="button" class="btn btn-link text-decoration-none order-3 order-md-1" id="toggleCustomInput">
            <i class="bi bi-pencil-square me-1"></i>Enter custom value
          </button>
          <div class="btn-group order-1 order-md-2 mb-2 mb-md-0">
            <button type="button" class="btn btn-secondary" id="rejectSuggestion">
              <i class="bi bi-x-circle me-1"></i>Reject
            </button>
            <button type="button" class="btn btn-primary" id="acceptSuggestion">
              <i class="bi bi-check-circle me-1"></i>Accept Suggestion
            </button>
          </div>
          <button type="button" class="btn btn-success order-2 order-md-3 mb-2 mb-md-0" id="submitCustomValue" style="display: none;">
            <i class="bi bi-check-square me-1"></i>Use Custom Value
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  return new Promise((resolve) => {
    const closeModal = () => {
      document.body.removeChild(modal);
    };
    
    document.getElementById('closeModal').addEventListener('click', () => {
      closeModal();
      resolve(false);
    });
    
    document.getElementById('rejectSuggestion').addEventListener('click', () => {
      closeModal();
      resolve(false);
    });
    
    document.getElementById('acceptSuggestion').addEventListener('click', () => {
      closeModal();
      resolve({accepted: true, value: suggestion});
    });
    
    // Toggle custom input section
    document.getElementById('toggleCustomInput').addEventListener('click', () => {
      const customSection = modal.querySelector('.custom-input-section');
      const customValueButton = document.getElementById('submitCustomValue');
      
      if (customSection.style.display === 'none') {
        customSection.style.display = 'block';
        customValueButton.style.display = 'block';
        document.getElementById('toggleCustomInput').textContent = 'Cancel custom input';
      } else {
        customSection.style.display = 'none';
        customValueButton.style.display = 'none';
        document.getElementById('toggleCustomInput').innerHTML = '<i class="bi bi-pencil-square me-1"></i>Enter custom value';
      }
    });
    
    // Submit custom value
    document.getElementById('submitCustomValue').addEventListener('click', () => {
      const customValue = document.getElementById('customValueInput').value.trim();
      if (customValue) {
        closeModal();
        resolve({accepted: true, value: customValue, isCustom: true});
      } else {
        // Highlight the input if empty
        document.getElementById('customValueInput').classList.add('is-invalid');
      }
    });
    
    // Remove invalid class on input
    document.getElementById('customValueInput')?.addEventListener('input', (e) => {
      e.target.classList.remove('is-invalid');
    });
  });
} 