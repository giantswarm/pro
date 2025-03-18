/**
 * Pro - GitHub Project Management Web UI
 * JavaScript functionality for the SPA
 */

// State management
const state = {
  darkMode: localStorage.getItem('darkMode') === 'true' || false,
  activeView: 'dashboard',
  currentProject: null,
  pendingOperations: {},
  results: {},
  notifications: []
};

// DOM Elements
let elements = {};

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
  // Cache DOM elements
  cacheElements();
  
  // Set up event listeners
  setupEventListeners();
  
  // Initialize dark mode
  initTheme();
  
  // Navigate to initial view
  navigateTo('dashboard');
});

// Cache DOM elements for better performance
function cacheElements() {
  elements = {
    body: document.body,
    themeToggle: document.getElementById('theme-toggle'),
    sidebar: document.querySelector('.sidebar'),
    mobileMenuToggle: document.getElementById('mobile-menu-toggle'),
    navLinks: document.querySelectorAll('.nav-link'),
    views: document.querySelectorAll('.view'),
    toastContainer: document.getElementById('toast-container'),
    forms: {
      listProjects: document.getElementById('list-projects-form'),
      listItems: document.getElementById('list-items-form'),
      listFields: document.getElementById('list-fields-form'),
      showField: document.getElementById('show-field-form'),
      fixTeamField: document.getElementById('fix-team-field-form'),
      fixFunctionField: document.getElementById('fix-function-field-form'),
      fixKindField: document.getElementById('fix-kind-field-form'),
      summarizeIssues: document.getElementById('summarize-issues-form')
    },
    results: {
      projects: document.getElementById('projects-results'),
      items: document.getElementById('items-results'),
      fields: document.getElementById('fields-results'),
      field: document.getElementById('field-result'),
      fixTeam: document.getElementById('fix-team-result'),
      fixFunction: document.getElementById('fix-function-result'),
      fixKind: document.getElementById('fix-kind-result'),
      summarize: document.getElementById('summarize-result')
    },
    modals: {
      prompt: document.getElementById('prompt-modal'),
      promptTitle: document.getElementById('prompt-modal-title'),
      promptBody: document.getElementById('prompt-modal-body'),
      promptActions: document.getElementById('prompt-modal-actions')
    }
  };
}

// Set up event listeners
function setupEventListeners() {
  // Theme toggle
  elements.themeToggle.addEventListener('click', toggleTheme);
  
  // Mobile menu toggle
  if (elements.mobileMenuToggle) {
    elements.mobileMenuToggle.addEventListener('click', toggleMobileMenu);
  }
  
  // Navigation links
  elements.navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = e.currentTarget.getAttribute('data-target');
      navigateTo(target);
      
      // Close mobile menu if open
      if (window.innerWidth < 768) {
        elements.sidebar.classList.remove('open');
      }
    });
  });
  
  // Setup form submission handlers
  setupFormHandlers();
}

// Initialize theme based on preferences
function initTheme() {
  if (state.darkMode) {
    elements.body.classList.add('dark-mode');
  } else {
    elements.body.classList.remove('dark-mode');
  }
}

// Toggle between light and dark mode
function toggleTheme() {
  state.darkMode = !state.darkMode;
  localStorage.setItem('darkMode', state.darkMode);
  
  if (state.darkMode) {
    elements.body.classList.add('dark-mode');
  } else {
    elements.body.classList.remove('dark-mode');
  }
}

// Toggle mobile menu for responsive design
function toggleMobileMenu() {
  elements.sidebar.classList.toggle('open');
}

// Navigate to specific view
function navigateTo(viewId) {
  // Update active state in navigation
  elements.navLinks.forEach(link => {
    if (link.getAttribute('data-target') === viewId) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });
  
  // Show the selected view, hide others
  elements.views.forEach(view => {
    if (view.id === `${viewId}-view`) {
      view.classList.add('active');
    } else {
      view.classList.remove('active');
    }
  });
  
  // Update state
  state.activeView = viewId;
}

// Setup form submission handlers
function setupFormHandlers() {
  // List Projects Form
  if (elements.forms.listProjects) {
    elements.forms.listProjects.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleApiRequest('list', new FormData(e.target), elements.results.projects);
    });
  }
  
  // List Items Form
  if (elements.forms.listItems) {
    elements.forms.listItems.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      await handleApiRequest('list-items', formData, elements.results.items);
    });
  }
  
  // List Fields Form
  if (elements.forms.listFields) {
    elements.forms.listFields.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleApiRequest('list-fields', new FormData(e.target), elements.results.fields);
    });
  }
  
  // Show Field Form
  if (elements.forms.showField) {
    elements.forms.showField.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleApiRequest('show-field', new FormData(e.target), elements.results.field);
    });
  }
  
  // Fix Team Field Form
  if (elements.forms.fixTeamField) {
    elements.forms.fixTeamField.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleApiRequest('fix-team-field', new FormData(e.target), elements.results.fixTeam);
    });
  }
  
  // Fix Function Field Form
  if (elements.forms.fixFunctionField) {
    elements.forms.fixFunctionField.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleApiRequest('fix-function-field', new FormData(e.target), elements.results.fixFunction);
    });
  }
  
  // Fix Kind Field Form
  if (elements.forms.fixKindField) {
    elements.forms.fixKindField.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleApiRequest('fix-kind-field', new FormData(e.target), elements.results.fixKind);
    });
  }
  
  // Summarize Issues Form
  if (elements.forms.summarizeIssues) {
    elements.forms.summarizeIssues.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleApiRequest('summarize-issues', new FormData(e.target), elements.results.summarize);
    });
  }
}

// Handle API request to the server
async function handleApiRequest(endpoint, formData, resultContainer) {
  // Clear previous results
  resultContainer.innerHTML = '';
  
  // Show loading state
  resultContainer.innerHTML = `
    <div class="results-placeholder">
      <i class="fas fa-spinner fa-spin"></i>
      <p>Processing request...</p>
    </div>
  `;
  
  // Prepare form data as JSON
  const data = {};
  formData.forEach((value, key) => {
    // Handle checkboxes and multiple select fields
    if (data[key]) {
      if (!Array.isArray(data[key])) {
        data[key] = [data[key]];
      }
      data[key].push(value);
    } else {
      data[key] = value;
    }
  });
  
  try {
    // Send request to the API endpoint
    const response = await fetch(`/api/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
    
    // Parse response
    const result = await response.json();
    
    // Handle operation that needs user input
    if (result.status === 'pending' && result.operationId) {
      state.pendingOperations[result.operationId] = {
        endpoint,
        data
      };
      
      // Show console output if available
      if (result.consoleOutput && result.consoleOutput.length > 0) {
        displayConsoleOutput(resultContainer, result.consoleOutput);
      }
      
      // Show prompt modal for user input
      showPromptModal(result.operationId, result.prompts);
      return;
    }
    
    // Handle success
    if (result.status === 'success') {
      // Store in state
      state.results[endpoint] = result.data;
      
      // Display results
      if (result.consoleOutput && result.consoleOutput.length > 0) {
        displayConsoleOutput(resultContainer, result.consoleOutput);
      } else if (result.data) {
        displayResults(resultContainer, result.data, endpoint);
      } else {
        resultContainer.innerHTML = `
          <div class="results-placeholder">
            <i class="fas fa-check-circle"></i>
            <p>Operation completed successfully.</p>
          </div>
        `;
      }
      
      // Show success notification
      showNotification('Success', result.message || 'Operation completed successfully.', 'success');
    } else {
      // Handle error
      resultContainer.innerHTML = `
        <div class="results-placeholder">
          <i class="fas fa-exclamation-circle"></i>
          <p>${result.message || 'An error occurred.'}</p>
        </div>
      `;
      
      // Show error notification
      showNotification('Error', result.message || 'An error occurred.', 'error');
    }
  } catch (error) {
    console.error('API request failed:', error);
    
    // Update UI to show error
    resultContainer.innerHTML = `
      <div class="results-placeholder">
        <i class="fas fa-exclamation-triangle"></i>
        <p>Failed to communicate with the server: ${error.message}</p>
      </div>
    `;
    
    // Show error notification
    showNotification('Error', `Failed to communicate with the server: ${error.message}`, 'error');
  }
}

// Display console output in the results container
function displayConsoleOutput(container, output) {
  container.innerHTML = `<div class="console-output"></div>`;
  const consoleOutput = container.querySelector('.console-output');
  
  output.forEach(line => {
    // Determine line type for styling
    let lineClass = 'info';
    if (line.includes('✓') || line.includes('success')) {
      lineClass = 'success';
    } else if (line.includes('⚠') || line.includes('warning')) {
      lineClass = 'warning';
    } else if (line.includes('✗') || line.includes('error')) {
      lineClass = 'error';
    } else if (line.includes('⠋') || line.includes('⠙') || line.includes('⠹')) {
      lineClass = 'spinner';
    }
    
    // Create line element
    const lineElement = document.createElement('div');
    lineElement.className = `console-line ${lineClass}`;
    lineElement.textContent = line;
    consoleOutput.appendChild(lineElement);
  });
  
  // Scroll to bottom
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

// Display results in the results container based on endpoint
function displayResults(container, data, endpoint) {
  // Clear previous results
  container.innerHTML = '';
  
  // Create results list
  const resultsList = document.createElement('div');
  resultsList.className = 'results-list';
  
  // Handle different types of results
  switch (endpoint) {
    case 'list':
      displayProjectsList(resultsList, data);
      break;
    case 'list-items':
      displayItemsList(resultsList, data);
      break;
    case 'list-fields':
      displayFieldsList(resultsList, data);
      break;
    case 'show-field':
      displayFieldDetails(resultsList, data);
      break;
    case 'summarize-issues':
      displaySummary(resultsList, data);
      break;
    default:
      resultsList.innerHTML = `<pre>${JSON.stringify(data, null, 2)}</pre>`;
  }
  
  container.appendChild(resultsList);
}

// Display projects list
function displayProjectsList(container, projects) {
  if (!projects || projects.length === 0) {
    container.innerHTML = `
      <div class="results-placeholder">
        <i class="fas fa-info-circle"></i>
        <p>No projects found.</p>
      </div>
    `;
    return;
  }
  
  projects.forEach(project => {
    const projectItem = document.createElement('div');
    projectItem.className = 'result-item';
    projectItem.innerHTML = `
      <div class="result-header">
        <span class="result-title">${escapeHtml(project.title)}</span>
        <span class="result-id">#${project.id}</span>
      </div>
      <div class="result-meta">
        <span class="result-meta-item">
          <i class="fas fa-tasks"></i> ${project.items || 0} items
        </span>
      </div>
    `;
    
    // Add click handler to use this project
    projectItem.addEventListener('click', () => {
      state.currentProject = project;
      
      // Update project ID fields in all forms
      document.querySelectorAll('input[name="projectId"]').forEach(input => {
        input.value = project.id;
      });
      
      // Show notification
      showNotification('Project Selected', `Selected project: ${project.title}`, 'info');
    });
    
    container.appendChild(projectItem);
  });
}

// Display items list
function displayItemsList(container, items) {
  if (!items || items.length === 0) {
    container.innerHTML = `
      <div class="results-placeholder">
        <i class="fas fa-info-circle"></i>
        <p>No items found.</p>
      </div>
    `;
    return;
  }
  
  items.forEach(item => {
    const itemElement = document.createElement('div');
    itemElement.className = 'result-item';
    
    // Prepare meta information
    let metaHtml = '';
    if (item.fields) {
      if (item.fields.team) {
        metaHtml += `
          <span class="result-meta-item">
            <i class="fas fa-users"></i> ${escapeHtml(item.fields.team)}
          </span>
        `;
      }
      
      if (item.fields.function) {
        metaHtml += `
          <span class="result-meta-item">
            <i class="fas fa-code-branch"></i> ${escapeHtml(item.fields.function)}
          </span>
        `;
      }
      
      if (item.fields.kind) {
        metaHtml += `
          <span class="result-meta-item">
            <i class="fas fa-tag"></i> ${escapeHtml(item.fields.kind)}
          </span>
        `;
      }
    }
    
    itemElement.innerHTML = `
      <div class="result-header">
        <span class="result-title">${escapeHtml(item.title)}</span>
        <span class="result-id">${item.number ? `#${item.number}` : ''}</span>
      </div>
      <div class="result-description">
        ${item.url ? `<a href="${item.url}" target="_blank">${escapeHtml(item.url)}</a>` : ''}
      </div>
      <div class="result-meta">
        ${metaHtml}
      </div>
    `;
    
    container.appendChild(itemElement);
  });
}

// Display fields list
function displayFieldsList(container, fields) {
  if (!fields || fields.length === 0) {
    container.innerHTML = `
      <div class="results-placeholder">
        <i class="fas fa-info-circle"></i>
        <p>No fields found.</p>
      </div>
    `;
    return;
  }
  
  fields.forEach(field => {
    const fieldElement = document.createElement('div');
    fieldElement.className = 'result-item';
    
    fieldElement.innerHTML = `
      <div class="result-header">
        <span class="result-title">${escapeHtml(field.name)}</span>
        <span class="result-id">${field.id}</span>
      </div>
      <div class="result-description">
        Type: ${field.type || 'Unknown'}
      </div>
    `;
    
    container.appendChild(fieldElement);
  });
}

// Display field details
function displayFieldDetails(container, field) {
  if (!field) {
    container.innerHTML = `
      <div class="results-placeholder">
        <i class="fas fa-info-circle"></i>
        <p>No field details found.</p>
      </div>
    `;
    return;
  }
  
  const fieldElement = document.createElement('div');
  fieldElement.className = 'result-item';
  
  let optionsHtml = '';
  if (field.options && field.options.length > 0) {
    optionsHtml = '<div class="field-options"><h4>Options:</h4><ul>';
    field.options.forEach(option => {
      optionsHtml += `<li>${escapeHtml(option.name)}</li>`;
    });
    optionsHtml += '</ul></div>';
  }
  
  fieldElement.innerHTML = `
    <div class="result-header">
      <span class="result-title">${escapeHtml(field.name)}</span>
      <span class="result-id">${field.id}</span>
    </div>
    <div class="result-description">
      <p>Type: ${field.type || 'Unknown'}</p>
      ${optionsHtml}
    </div>
  `;
  
  container.appendChild(fieldElement);
}

// Display summary
function displaySummary(container, summary) {
  if (!summary) {
    container.innerHTML = `
      <div class="results-placeholder">
        <i class="fas fa-info-circle"></i>
        <p>No summary available.</p>
      </div>
    `;
    return;
  }
  
  const summaryElement = document.createElement('div');
  summaryElement.className = 'result-item';
  
  // Format the summary content
  let formattedSummary = summary;
  
  // Convert markdown-like syntax to HTML if it seems to be that format
  if (typeof summary === 'string' && (summary.includes('##') || summary.includes('*'))) {
    // Convert headers
    formattedSummary = formattedSummary.replace(/^### (.*$)/gim, '<h4>$1</h4>');
    formattedSummary = formattedSummary.replace(/^## (.*$)/gim, '<h3>$1</h3>');
    formattedSummary = formattedSummary.replace(/^# (.*$)/gim, '<h2>$1</h2>');
    
    // Convert bold and italic
    formattedSummary = formattedSummary.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>');
    formattedSummary = formattedSummary.replace(/\*(.*?)\*/gim, '<em>$1</em>');
    
    // Convert lists
    formattedSummary = formattedSummary.replace(/^\s*-\s*(.*$)/gim, '<li>$1</li>');
    formattedSummary = formattedSummary.replace(/<\/li>\n<li>/gim, '</li><li>');
    formattedSummary = formattedSummary.replace(/<li>(.+?)(?=<\/li>|$)/gim, function(match) {
      return '<ul>' + match + '</ul>';
    });
    
    // Convert paragraphs
    formattedSummary = formattedSummary.replace(/(?:\r\n|\r|\n){2,}/gim, '</p><p>');
    formattedSummary = '<p>' + formattedSummary + '</p>';
    
    // Fix nested tags
    formattedSummary = formattedSummary.replace(/<\/p><p><ul>/gim, '<ul>');
    formattedSummary = formattedSummary.replace(/<\/ul><\/p><p>/gim, '</ul>');
  }
  
  summaryElement.innerHTML = `
    <div class="result-header">
      <span class="result-title">Issue Summary</span>
    </div>
    <div class="result-description summary-content">
      ${formattedSummary}
    </div>
  `;
  
  container.appendChild(summaryElement);
}

// Show prompt modal for interactive operations
function showPromptModal(operationId, prompts) {
  // Set modal title
  elements.modals.promptTitle.textContent = 'User Input Required';
  
  // Clear previous content
  elements.modals.promptBody.innerHTML = '';
  elements.modals.promptActions.innerHTML = '';
  
  // Build form for prompts
  const promptForm = document.createElement('form');
  promptForm.id = 'prompt-form';
  
  prompts.forEach((prompt, index) => {
    const promptItem = document.createElement('div');
    promptItem.className = 'prompt-item';
    
    const question = document.createElement('div');
    question.className = 'prompt-question';
    question.textContent = prompt.message;
    promptItem.appendChild(question);
    
    // Different input types based on prompt type
    if (prompt.type === 'list') {
      // Create select dropdown
      const select = document.createElement('select');
      select.name = `answer_${index}`;
      select.className = 'form-control';
      select.required = true;
      
      prompt.choices.forEach(choice => {
        const option = document.createElement('option');
        option.value = choice;
        option.textContent = choice;
        select.appendChild(option);
      });
      
      promptItem.appendChild(select);
    } else if (prompt.type === 'confirm') {
      // Create yes/no buttons
      const buttonGroup = document.createElement('div');
      buttonGroup.className = 'btn-group';
      
      const yesBtn = document.createElement('button');
      yesBtn.type = 'button';
      yesBtn.className = 'btn btn-primary';
      yesBtn.textContent = 'Yes';
      yesBtn.onclick = () => {
        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.name = `answer_${index}`;
        hiddenInput.value = 'true';
        promptForm.appendChild(hiddenInput);
        submitPromptForm(operationId);
      };
      
      const noBtn = document.createElement('button');
      noBtn.type = 'button';
      noBtn.className = 'btn btn-secondary';
      noBtn.textContent = 'No';
      noBtn.onclick = () => {
        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.name = `answer_${index}`;
        hiddenInput.value = 'false';
        promptForm.appendChild(hiddenInput);
        submitPromptForm(operationId);
      };
      
      buttonGroup.appendChild(yesBtn);
      buttonGroup.appendChild(noBtn);
      promptItem.appendChild(buttonGroup);
    } else {
      // Default to text input
      const input = document.createElement('input');
      input.type = 'text';
      input.name = `answer_${index}`;
      input.className = 'form-control';
      input.required = true;
      
      if (prompt.default) {
        input.value = prompt.default;
      }
      
      promptItem.appendChild(input);
    }
    
    promptForm.appendChild(promptItem);
  });
  
  // Add submit button except for confirm type
  if (!prompts.some(p => p.type === 'confirm')) {
    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'btn btn-primary';
    submitBtn.textContent = 'Submit';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => cancelOperation(operationId);
    
    elements.modals.promptActions.appendChild(submitBtn);
    elements.modals.promptActions.appendChild(cancelBtn);
    
    // Add form submit handler
    promptForm.onsubmit = (e) => {
      e.preventDefault();
      submitPromptForm(operationId);
    };
  } else {
    // For confirm type, add just cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => cancelOperation(operationId);
    
    elements.modals.promptActions.appendChild(cancelBtn);
  }
  
  elements.modals.promptBody.appendChild(promptForm);
  
  // Show modal
  elements.modals.prompt.classList.add('active');
}

// Submit answers to a prompt
async function submitPromptForm(operationId) {
  // Collect form data
  const form = document.getElementById('prompt-form');
  const formData = new FormData(form);
  
  // Format answers
  const answers = [];
  
  // Convert form data to array of answers
  for (let [key, value] of formData.entries()) {
    if (key.startsWith('answer_')) {
      const index = parseInt(key.split('_')[1]);
      answers[index] = value;
    }
  }
  
  try {
    // Send answers to API
    const response = await fetch(`/api/submit-prompt/${operationId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ answers })
    });
    
    const result = await response.json();
    
    // Close modal
    elements.modals.prompt.classList.remove('active');
    
    // Handle response
    if (result.status === 'success') {
      showNotification('Success', 'Your input has been processed.', 'success');
      
      // Update relevant result container
      const operation = state.pendingOperations[operationId];
      if (operation) {
        const endpoint = operation.endpoint;
        const resultContainer = document.getElementById(`${endpoint.replace(/-/g, '-')}-result`);
        
        if (resultContainer && result.consoleOutput) {
          displayConsoleOutput(resultContainer, result.consoleOutput);
        }
        
        // Remove from pending operations
        delete state.pendingOperations[operationId];
      }
    } else if (result.status === 'pending' && result.prompts) {
      // Another prompt required
      showPromptModal(operationId, result.prompts);
    } else {
      showNotification('Error', result.message || 'Failed to process your input.', 'error');
    }
  } catch (error) {
    console.error('Failed to submit prompt:', error);
    showNotification('Error', 'Failed to submit your input.', 'error');
    
    // Close modal
    elements.modals.prompt.classList.remove('active');
  }
}

// Cancel an ongoing operation
async function cancelOperation(operationId) {
  try {
    await fetch(`/api/cancel/${operationId}`, {
      method: 'POST'
    });
    
    // Close modal
    elements.modals.prompt.classList.remove('active');
    
    showNotification('Cancelled', 'Operation has been cancelled.', 'info');
    
    // Remove from pending operations
    delete state.pendingOperations[operationId];
  } catch (error) {
    console.error('Failed to cancel operation:', error);
    showNotification('Error', 'Failed to cancel operation.', 'error');
  }
}

// Show notification toast
function showNotification(title, message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  // Icons based on type
  let icon = 'info-circle';
  if (type === 'success') icon = 'check-circle';
  if (type === 'warning') icon = 'exclamation-circle';
  if (type === 'error') icon = 'exclamation-triangle';
  
  toast.innerHTML = `
    <div class="toast-icon">
      <i class="fas fa-${icon}"></i>
    </div>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(title)}</div>
      <div class="toast-message">${escapeHtml(message)}</div>
    </div>
  `;
  
  // Add to container
  elements.toastContainer.appendChild(toast);
  
  // Remove after timeout
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    
    setTimeout(() => {
      elements.toastContainer.removeChild(toast);
    }, 300);
  }, 5000);
}

// Utility to escape HTML
function escapeHtml(unsafe) {
  if (typeof unsafe !== 'string') return unsafe;
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
} 