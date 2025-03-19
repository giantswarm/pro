/**
 * Inline Suggestion Component
 * Provides UI for displaying and interacting with field suggestions directly in the page
 */

/**
 * Creates a suggestion UI component for a given issue row
 * @param {Object} issue - The issue object
 * @param {String} container - The selector for the container where the suggestion will be displayed
 * @param {Array} fieldOptions - Array of available field options
 * @param {Array} currentFields - Array of current fields for the issue
 * @param {String} aiSuggestion - The AI-suggested field value
 * @param {Function} onAccept - Callback function when suggestion is accepted
 * @param {Function} [onReject] - Optional callback function when suggestion is rejected
 */
export function createSuggestion(issue, container, fieldOptions, currentFields, aiSuggestion, onAccept, onReject) {
  const suggestionEl = document.querySelector(container);
  
  if (!suggestionEl) {
    console.error(`Container ${container} not found`);
    return;
  }
  
  // Clear any existing content
  suggestionEl.innerHTML = '';
  suggestionEl.classList.add('suggestion-minimal');
  
  // Create minimal suggestion UI
  const formGroup = document.createElement('div');
  formGroup.className = 'form-group';
  
  // Create select element
  const select = document.createElement('select');
  select.className = 'form-select';
  select.id = `suggestion-select-${issue.id || Math.random().toString(36).substring(2, 9)}`;
  
  // Add empty option
  const emptyOption = document.createElement('option');
  emptyOption.value = '';
  emptyOption.textContent = 'Select field';
  select.appendChild(emptyOption);
  
  console.log('Creating suggestion dropdown with options:', fieldOptions);
  console.log('AI Suggestion value:', aiSuggestion);
  
  // Track if we've matched and selected the AI suggestion
  let foundMatch = false;
  
  // Add options from fieldOptions
  fieldOptions.forEach(option => {
    const optionEl = document.createElement('option');
    optionEl.value = option.value;
    optionEl.textContent = option.label;
    
    // Store the original option data as a data attribute if available
    if (option.originalOption) {
      optionEl.dataset.originalOption = JSON.stringify(option.originalOption);
    }
    
    // Check for a match with the AI suggestion (by text or value)
    // This handles the case where the suggestion might be the label text rather than the value
    const isMatch = 
      // Match by value
      option.value === aiSuggestion || 
      // Match by label/text (case insensitive)
      option.label.toLowerCase() === aiSuggestion.toLowerCase() ||
      // Match by just the content without emojis
      option.label.replace(/[\u{1F300}-\u{1F5FF}\u{1F900}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F191}-\u{1F251}\u{1F004}\u{1F0CF}\u{1F170}-\u{1F171}\u{1F17E}-\u{1F17F}\u{1F18E}\u{3030}\u{2B50}\u{2B55}\u{2934}-\u{2935}\u{2B05}-\u{2B07}\u{2B1B}-\u{2B1C}\u{3297}\u{3299}\u{303D}\u{00A9}\u{00AE}\u{2122}\u{23F3}\u{24C2}\u{23E9}-\u{23EF}\u{25B6}\u{23F8}-\u{23FA}]/gu, '').trim().toLowerCase() === 
      aiSuggestion.replace(/[\u{1F300}-\u{1F5FF}\u{1F900}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F191}-\u{1F251}\u{1F004}\u{1F0CF}\u{1F170}-\u{1F171}\u{1F17E}-\u{1F17F}\u{1F18E}\u{3030}\u{2B50}\u{2B55}\u{2934}-\u{2935}\u{2B05}-\u{2B07}\u{2B1B}-\u{2B1C}\u{3297}\u{3299}\u{303D}\u{00A9}\u{00AE}\u{2122}\u{23F3}\u{24C2}\u{23E9}-\u{23EF}\u{25B6}\u{23F8}-\u{23FA}]/gu, '').trim().toLowerCase();
    
    if (isMatch) {
      console.log(`Found matching option for "${aiSuggestion}":`, option);
      optionEl.selected = true;
      foundMatch = true;
    }
    
    select.appendChild(optionEl);
  });
  
  // If we didn't find a match but have a suggestion, add it as a custom option
  if (!foundMatch && aiSuggestion && aiSuggestion.trim() !== '') {
    console.log(`No matching option found for "${aiSuggestion}", adding custom option`);
    const customOption = document.createElement('option');
    customOption.value = aiSuggestion;
    customOption.textContent = `${aiSuggestion} (Custom)`;
    customOption.selected = true;
    select.appendChild(customOption);
  }
  
  formGroup.appendChild(select);
  suggestionEl.appendChild(formGroup);
  
  // Create actions
  const actions = document.createElement('div');
  actions.className = 'suggestion-actions d-flex justify-content-between';
  
  // Accept button
  const acceptBtn = document.createElement('button');
  acceptBtn.className = 'btn btn-sm btn-primary';
  acceptBtn.innerHTML = '<i class="fas fa-check mr-1"></i> Accept';
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
          console.log('Retrieved original option data:', originalOption);
        } catch (e) {
          console.error('Error parsing original option data:', e);
        }
      }
      
      // Call the callback with the selected value and original option
      onAccept(selectedValue, originalOption);
    } else {
      alert('Please select a field value');
    }
  });
  
  // Cancel button
  const rejectBtn = document.createElement('button');
  rejectBtn.className = 'btn btn-sm btn-outline-secondary';
  rejectBtn.innerHTML = 'Cancel';
  rejectBtn.addEventListener('click', () => {
    // Hide suggestion cell if onReject is not provided
    if (typeof onReject === 'function') {
      onReject();
    } else {
      // Default behavior: hide the suggestion
      suggestionEl.style.display = 'none';
    }
  });
  
  actions.appendChild(acceptBtn);
  actions.appendChild(rejectBtn);
  suggestionEl.appendChild(actions);
  
  // Display with animation
  setTimeout(() => {
    suggestionEl.style.display = 'block';
    suggestionEl.classList.add('show');
  }, 10);
  
  return suggestionEl;
} 