// Constants
const ROADMAP_BOARD_ID = 'PVT_kwDOAHNM9M4ABvWx';

// DOM Elements
const themeToggle = document.getElementById('theme-toggle');
const navItems = document.querySelectorAll('.nav-item');
const contentSections = document.querySelectorAll('.content-section');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingMessage = document.getElementById('loading-message');

// Forms
const listItemsForm = document.getElementById('list-items-form');
const fixFunctionFieldForm = document.getElementById('fix-function-field-form');
const fixKindFieldForm = document.getElementById('fix-kind-field-form');
const summarizeIssuesForm = document.getElementById('summarize-issues-form');

// Results containers
const listItemsResults = document.getElementById('list-items-results');
const fixFunctionFieldResults = document.getElementById('fix-function-field-results');
const fixKindFieldResults = document.getElementById('fix-kind-field-results');
const summarizeIssuesResults = document.getElementById('summarize-issues-results');

// Check for saved theme preference
document.addEventListener('DOMContentLoaded', () => {
  const darkMode = localStorage.getItem('darkMode') === 'true';
  if (darkMode) {
    document.body.classList.add('dark-mode');
  }
  
  // Set active tab from URL hash if present
  const hash = window.location.hash.substring(1);
  if (hash) {
    const targetSection = document.getElementById(hash);
    if (targetSection) {
      changeActiveTab(hash);
    }
  }
  
  // Pre-fill project ID fields with the roadmap board ID
  document.querySelectorAll('[id$="-project-id"]').forEach(input => {
    input.value = ROADMAP_BOARD_ID;
  });
});

// Theme Toggle
themeToggle.addEventListener('click', () => {
  document.body.classList.toggle('dark-mode');
  localStorage.setItem('darkMode', document.body.classList.contains('dark-mode'));
});

// Navigation
navItems.forEach(item => {
  item.addEventListener('click', () => {
    const targetView = item.getAttribute('data-view');
    changeActiveTab(targetView);
    window.location.hash = targetView;
  });
});

function changeActiveTab(targetId) {
  // Update active nav item
  navItems.forEach(item => {
    if (item.getAttribute('data-view') === targetId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
  
  // Show target section, hide others
  contentSections.forEach(section => {
    if (section.id === targetId) {
      section.classList.add('active');
    } else {
      section.classList.remove('active');
    }
  });
}

// Loading state functions
function showLoading(message = 'Processing...') {
  loadingMessage.textContent = message;
  loadingOverlay.classList.add('active');
}

function hideLoading() {
  loadingOverlay.classList.remove('active');
}

// API simulation functions
async function simulateApiCall(endpoint, data, delay = 1500) {
  showLoading();
  
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, delay));
  
  // Simulate API response based on endpoint
  let response;
  
  switch (endpoint) {
    case 'list-items':
      response = simulateListItems(data);
      break;
      
    case 'fix-function-field':
      response = simulateFixFunctionField(data);
      break;
      
    case 'fix-kind-field':
      response = simulateFixKindField(data);
      break;
      
    case 'summarize-issues':
      response = simulateSummarizeIssues(data);
      break;
      
    default:
      response = { error: 'Unknown endpoint' };
  }
  
  hideLoading();
  return response;
}

// Simulated API response generators
function simulateListItems(data) {
  // Check if required fields are present
  if (!data.projectId) {
    return { 
      error: 'Project ID is required'
    };
  }
  
  // Generate mock items based on filter criteria
  const mockItems = [];
  const itemCount = Math.floor(Math.random() * 10) + 5;
  
  for (let i = 0; i < itemCount; i++) {
    const item = {
      id: `ISSUE-${100 + i}`,
      title: `${getRandomPrefix()} ${getRandomIssueTitle()}`,
      status: getRandomChoice(['Todo', 'In Progress', 'Review', 'Done']),
      kind: getRandomChoice(['feature', 'bug', 'chore', 'docs']),
      function: getRandomChoice(['frontend', 'backend', 'devops', 'api', 'database']),
      team: getRandomChoice(['Planeteers 🪐', 'API Squad 🧩', 'Platform Team 🚀', 'UX Warriors 🎨', 'Security Guardians 🔒', null]),
      url: `https://github.com/issues/${100 + i}`
    };
    
    // Apply filters (if any)
    if (data.team && data.team !== 'all') {
      if (data.noTeam && item.team !== null) continue;
      if (!data.noTeam && item.team === null) continue;
      if (!data.noTeam && data.team !== 'all' && !normalizeText(item.team).includes(normalizeText(data.team))) continue;
    } else if (data.noTeam && item.team !== null) {
      continue;
    }
    
    if (data.kind && item.kind !== data.kind) continue;
    if (data.status && item.status !== data.status) continue;
    if (data.function && item.function !== data.function) continue;
    
    mockItems.push(item);
  }
  
  return {
    success: true,
    items: mockItems,
    count: mockItems.length
  };
}

function simulateFixFunctionField(data) {
  if (!data.projectId) {
    return { 
      error: 'Project ID is required'
    };
  }
  
  // Generate mock fixes
  const mockFixedItems = [];
  const itemCount = Math.floor(Math.random() * 5) + 2;
  
  for (let i = 0; i < itemCount; i++) {
    const originalFunction = getRandomChoice(['', 'unknown', 'to be determined', 'TBD', 'misc']);
    const suggestedFunction = getRandomChoice(['frontend', 'backend', 'devops', 'api', 'database', 'security', 'testing']);
    
    mockFixedItems.push({
      id: `ISSUE-${100 + i}`,
      title: `${getRandomPrefix()} ${getRandomIssueTitle()}`,
      originalFunction,
      suggestedFunction,
      applied: Math.random() > 0.3, // Simulate some rejections
      url: `https://github.com/issues/${100 + i}`
    });
  }
  
  return {
    success: true,
    items: mockFixedItems,
    count: mockFixedItems.length,
    appliedCount: mockFixedItems.filter(item => item.applied).length
  };
}

function simulateFixKindField(data) {
  if (!data.projectId) {
    return { 
      error: 'Project ID is required'
    };
  }
  
  // Generate mock fixes
  const mockFixedItems = [];
  const itemCount = Math.floor(Math.random() * 5) + 2;
  
  for (let i = 0; i < itemCount; i++) {
    const originalKind = getRandomChoice(['', 'unknown', 'to be determined', 'TBD', 'misc']);
    const suggestedKind = getRandomChoice(['feature', 'bug', 'chore', 'docs', 'refactor', 'test']);
    
    mockFixedItems.push({
      id: `ISSUE-${100 + i}`,
      title: `${getRandomPrefix()} ${getRandomIssueTitle()}`,
      originalKind,
      suggestedKind,
      applied: Math.random() > 0.3, // Simulate some rejections
      url: `https://github.com/issues/${100 + i}`
    });
  }
  
  return {
    success: true,
    items: mockFixedItems,
    count: mockFixedItems.length,
    appliedCount: mockFixedItems.filter(item => item.applied).length
  };
}

function simulateSummarizeIssues(data) {
  if (!data.projectId) {
    return { 
      error: 'Project ID is required'
    };
  }
  
  // Generate mock summary
  const itemCount = Math.floor(Math.random() * 15) + 10;
  
  const mockSummary = {
    totalIssues: itemCount,
    topCategories: [
      { name: 'API Improvements', count: Math.floor(Math.random() * 5) + 3 },
      { name: 'Bug Fixes', count: Math.floor(Math.random() * 4) + 2 },
      { name: 'Performance Optimization', count: Math.floor(Math.random() * 3) + 1 },
      { name: 'Documentation', count: Math.floor(Math.random() * 3) + 1 }
    ],
    priorityRecommendations: [
      { id: 'ISSUE-105', title: 'Fix API authentication bug', priority: 'High', reason: 'Critical security issue affecting all users' },
      { id: 'ISSUE-103', title: 'Improve database query performance', priority: 'Medium', reason: 'Affects user experience during peak hours' },
      { id: 'ISSUE-109', title: 'Add documentation for new features', priority: 'Low', reason: 'Helpful but not blocking development' }
    ],
    summary: `This set of ${itemCount} issues primarily focuses on API improvements and bug fixes. There are several critical items that should be addressed promptly, particularly those related to security and performance. The documentation tasks can be scheduled for later sprints. Consider assigning the API work to the API Squad team and the performance items to the Platform team.`
  };
  
  return {
    success: true,
    summary: mockSummary
  };
}

// Utility functions for generating mock data
function getRandomChoice(options) {
  return options[Math.floor(Math.random() * options.length)];
}

function getRandomPrefix() {
  return getRandomChoice(['Fix', 'Add', 'Update', 'Implement', 'Improve', 'Refactor', 'Remove', 'Optimize']);
}

function getRandomIssueTitle() {
  const subjects = [
    'authentication system',
    'database queries',
    'API endpoints',
    'user permissions',
    'dashboard widgets',
    'error handling',
    'documentation',
    'test coverage',
    'CI/CD pipeline',
    'frontend components',
    'logging system',
    'performance metrics'
  ];
  
  return getRandomChoice(subjects);
}

function normalizeText(text) {
  if (!text) return '';
  // Convert to lowercase and remove emojis and special characters
  return text.toLowerCase()
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
    .replace(/[^\w\s]/g, '')
    .trim();
}

// Form submissions
listItemsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const formData = {
    projectId: document.getElementById('list-project-id').value,
    kind: document.getElementById('list-kind').value,
    status: document.getElementById('list-status').value,
    function: document.getElementById('list-function').value,
    team: document.getElementById('list-team').value,
    sig: document.getElementById('list-sig').value,
    wg: document.getElementById('list-wg').value,
    noTeam: document.getElementById('list-no-team').checked
  };
  
  try {
    showLoading('Fetching items...');
    
    const response = await fetch('/api/list-items', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(formData)
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(result.error || 'Failed to fetch items');
    }
    
    displayListItemsResults(result);
  } catch (error) {
    listItemsResults.innerHTML = `<div class="error-message">${error.message}</div>`;
  } finally {
    hideLoading();
  }
});

fixFunctionFieldForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const formData = {
    projectId: document.getElementById('function-project-id').value,
    team: document.getElementById('function-team').value,
    noTeam: document.getElementById('function-no-team').checked,
    confirm: document.getElementById('function-confirm').checked
  };
  
  try {
    showLoading('Processing function fields...');
    
    const response = await fetch('/api/fix-function-field', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(formData)
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(result.error || 'Failed to process function fields');
    }
    
    displayFixFunctionResults(result);
  } catch (error) {
    fixFunctionFieldResults.innerHTML = `<div class="error-message">${error.message}</div>`;
  } finally {
    hideLoading();
  }
});

fixKindFieldForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const formData = {
    projectId: document.getElementById('kind-project-id').value,
    team: document.getElementById('kind-team').value,
    noTeam: document.getElementById('kind-no-team').checked,
    confirm: document.getElementById('kind-confirm').checked
  };
  
  try {
    showLoading('Processing kind fields...');
    
    const response = await fetch('/api/fix-kind-field', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(formData)
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(result.error || 'Failed to process kind fields');
    }
    
    displayFixKindResults(result);
  } catch (error) {
    fixKindFieldResults.innerHTML = `<div class="error-message">${error.message}</div>`;
  } finally {
    hideLoading();
  }
});

summarizeIssuesForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const formData = {
    projectId: document.getElementById('summarize-project-id').value,
    kind: document.getElementById('summarize-kind').value,
    status: document.getElementById('summarize-status').value,
    function: document.getElementById('summarize-function').value,
    team: document.getElementById('summarize-team').value,
    sig: document.getElementById('summarize-sig').value,
    wg: document.getElementById('summarize-wg').value,
    noTeam: document.getElementById('summarize-no-team').checked
  };
  
  try {
    showLoading('Generating summary...');
    
    const response = await fetch('/api/summarize-issues', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(formData)
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(result.error || 'Failed to generate summary');
    }
    
    displaySummarizeResults(result);
  } catch (error) {
    summarizeIssuesResults.innerHTML = `<div class="error-message">${error.message}</div>`;
  } finally {
    hideLoading();
  }
});

// Result display functions
function displayListItemsResults(result) {
  if (result.error) {
    listItemsResults.innerHTML = `<div class="error-message">${result.error}</div>`;
    return;
  }
  
  if (!result.items || result.items.length === 0) {
    listItemsResults.innerHTML = `<div class="placeholder-message">No items found matching your criteria</div>`;
    return;
  }
  
  let html = `<p>Found ${result.count} items:</p>`;
  
  // If we have the raw output, show a button to toggle it for debugging
  if (result.text) {
    html += `
      <div style="margin: 10px 0;">
        <button id="toggle-raw-output" class="btn btn-secondary">Toggle Raw Output</button>
        <pre id="raw-output" style="display: none; margin-top: 10px; padding: 10px; background: var(--bg-secondary-light); border-radius: 4px; overflow: auto; max-height: 200px;">${result.text}</pre>
      </div>
    `;
  }
  
  html += `<ul style="list-style-type: none; padding: 0; margin-top: 1rem;">`;
  
  result.items.forEach(item => {
    html += `
      <li style="margin-bottom: 1rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border-light);">
        <div><strong>${item.url ? `<a href="${item.url}" target="_blank">` : ''}${item.id ? `${item.id}: ` : ''}${item.title}${item.url ? '</a>' : ''}</strong></div>`;
    
    // Add tags if they exist
    if (item.status || item.kind || item.function || item.team) {
      html += `<div style="margin-top: 0.5rem; display: flex; flex-wrap: wrap; gap: 0.5rem;">`;
      
      if (item.status) {
        html += `<span class="summary-tag">Status: ${item.status}</span>`;
      }
      
      if (item.kind) {
        html += `<span class="summary-tag">Kind: ${item.kind}</span>`;
      }
      
      if (item.function) {
        html += `<span class="summary-tag">Function: ${item.function}</span>`;
      }
      
      if (item.team === null) {
        html += `<span class="summary-tag">No Team</span>`;
      } else if (item.team) {
        html += `<span class="summary-tag">Team: ${item.team}</span>`;
      }
      
      html += `</div>`;
    }
    
    html += `</li>`;
  });
  
  html += '</ul>';
  listItemsResults.innerHTML = html;
  
  // Add event listener for the raw output toggle if it exists
  const toggleButton = document.getElementById('toggle-raw-output');
  if (toggleButton) {
    toggleButton.addEventListener('click', () => {
      const rawOutput = document.getElementById('raw-output');
      if (rawOutput.style.display === 'none') {
        rawOutput.style.display = 'block';
        toggleButton.textContent = 'Hide Raw Output';
      } else {
        rawOutput.style.display = 'none';
        toggleButton.textContent = 'Show Raw Output';
      }
    });
  }
}

function displayFixFunctionResults(result) {
  if (result.error) {
    fixFunctionFieldResults.innerHTML = `<div class="error-message">${result.error}</div>`;
    return;
  }
  
  // For real API responses, we may just have the raw output
  if (result.output) {
    let html = '<div style="margin-bottom: 1rem;">';
    html += '<h4>Command Output:</h4>';
    html += `<pre style="background: var(--bg-secondary-light); padding: 10px; border-radius: 4px; overflow: auto; max-height: 400px;">${result.output}</pre>`;
    html += '</div>';
    
    fixFunctionFieldResults.innerHTML = html;
    return;
  }
  
  // Handle structured responses (similar to the simulation)
  if (!result.items || result.items.length === 0) {
    fixFunctionFieldResults.innerHTML = `<div class="placeholder-message">No items were processed</div>`;
    return;
  }
  
  let html = `<p>Processed ${result.count} items, applied changes to ${result.appliedCount} items:</p>`;
  html += '<ul style="list-style-type: none; padding: 0; margin-top: 1rem;">';
  
  result.items.forEach(item => {
    html += `
      <li style="margin-bottom: 1rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border-light);">
        <div><strong>${item.url ? `<a href="${item.url}" target="_blank">` : ''}${item.id ? `${item.id}: ` : ''}${item.title}${item.url ? '</a>' : ''}</strong></div>
        <div style="margin-top: 0.5rem;">
          Original function: <span style="color: var(--text-secondary-light);">${item.originalFunction || '(empty)'}</span>
        </div>
        <div style="margin-top: 0.25rem;">
          Suggested function: <span style="color: var(--success);">${item.suggestedFunction}</span>
        </div>
        <div style="margin-top: 0.5rem;">
          ${item.applied 
            ? '<span style="color: var(--success);">✓ Applied</span>' 
            : '<span style="color: var(--error);">✗ Rejected</span>'}
        </div>
      </li>
    `;
  });
  
  html += '</ul>';
  fixFunctionFieldResults.innerHTML = html;
}

function displayFixKindResults(result) {
  if (result.error) {
    fixKindFieldResults.innerHTML = `<div class="error-message">${result.error}</div>`;
    return;
  }
  
  // For real API responses, we may just have the raw output
  if (result.output) {
    let html = '<div style="margin-bottom: 1rem;">';
    html += '<h4>Command Output:</h4>';
    html += `<pre style="background: var(--bg-secondary-light); padding: 10px; border-radius: 4px; overflow: auto; max-height: 400px;">${result.output}</pre>`;
    html += '</div>';
    
    fixKindFieldResults.innerHTML = html;
    return;
  }
  
  // Handle structured responses (similar to the simulation)
  if (!result.items || result.items.length === 0) {
    fixKindFieldResults.innerHTML = `<div class="placeholder-message">No items were processed</div>`;
    return;
  }
  
  let html = `<p>Processed ${result.count} items, applied changes to ${result.appliedCount} items:</p>`;
  html += '<ul style="list-style-type: none; padding: 0; margin-top: 1rem;">';
  
  result.items.forEach(item => {
    html += `
      <li style="margin-bottom: 1rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border-light);">
        <div><strong>${item.url ? `<a href="${item.url}" target="_blank">` : ''}${item.id ? `${item.id}: ` : ''}${item.title}${item.url ? '</a>' : ''}</strong></div>
        <div style="margin-top: 0.5rem;">
          Original kind: <span style="color: var(--text-secondary-light);">${item.originalKind || '(empty)'}</span>
        </div>
        <div style="margin-top: 0.25rem;">
          Suggested kind: <span style="color: var(--success);">${item.suggestedKind}</span>
        </div>
        <div style="margin-top: 0.5rem;">
          ${item.applied 
            ? '<span style="color: var(--success);">✓ Applied</span>' 
            : '<span style="color: var(--error);">✗ Rejected</span>'}
        </div>
      </li>
    `;
  });
  
  html += '</ul>';
  fixKindFieldResults.innerHTML = html;
}

function displaySummarizeResults(result) {
  if (result.error) {
    summarizeIssuesResults.innerHTML = `<div class="error-message">${result.error}</div>`;
    return;
  }
  
  // For real API responses, we may just have the raw output
  if (result.output) {
    let html = '<div style="margin-bottom: 1rem;">';
    html += '<h4>Command Output:</h4>';
    html += `<pre style="background: var(--bg-secondary-light); padding: 10px; border-radius: 4px; overflow: auto; max-height: 400px;">${result.output}</pre>`;
    html += '</div>';
    
    summarizeIssuesResults.innerHTML = html;
    return;
  }
  
  // For responses with just text listing
  if (result.text && !result.summary) {
    let html = '<div style="margin-bottom: 1rem;">';
    html += '<h4>Items Found:</h4>';
    html += `<pre style="background: var(--bg-secondary-light); padding: 10px; border-radius: 4px; overflow: auto; max-height: 400px;">${result.text}</pre>`;
    html += '</div>';
    
    // Add a note that actual summaries aren't implemented yet
    html += `
      <div class="placeholder-message" style="margin-top: 20px;">
        <p>The summarize-issues command is not yet implemented.</p>
        <p>This is showing the list of matching items from the list-items command.</p>
      </div>
    `;
    
    summarizeIssuesResults.innerHTML = html;
    return;
  }
  
  // Handle structured summary responses
  if (!result.summary) {
    summarizeIssuesResults.innerHTML = `<div class="placeholder-message">No summary could be generated</div>`;
    return;
  }
  
  const summary = result.summary;
  
  let html = `
    <div class="summary-section">
      <h3>Overview</h3>
      <p>Analysis of ${summary.totalIssues} issues</p>
      <p style="margin-top: 1rem;">${summary.summary}</p>
    </div>
    
    <div class="summary-section">
      <h3>Categories</h3>
      <ul style="list-style-type: none; padding: 0;">
  `;
  
  summary.topCategories.forEach(category => {
    html += `
      <li style="margin-bottom: 0.75rem;">
        <strong>${category.name}</strong>: ${category.count} issues
        <div style="height: 8px; background-color: rgba(59, 130, 246, 0.2); border-radius: 4px; margin-top: 0.25rem;">
          <div style="height: 100%; width: ${(category.count / summary.totalIssues * 100)}%; background-color: var(--primary-light); border-radius: 4px;"></div>
        </div>
      </li>
    `;
  });
  
  html += `
      </ul>
    </div>
    
    <div class="summary-section">
      <h3>Priority Recommendations</h3>
      <ul style="list-style-type: none; padding: 0;">
  `;
  
  summary.priorityRecommendations.forEach(item => {
    const priorityColor = 
      item.priority === 'High' ? 'var(--error)' : 
      item.priority === 'Medium' ? 'var(--warning)' : 
      'var(--info)';
    
    html += `
      <li style="margin-bottom: 1rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border-light);">
        <div><strong>${item.id}: ${item.title}</strong></div>
        <div style="margin-top: 0.5rem;">
          Priority: <span style="color: ${priorityColor};">${item.priority}</span>
        </div>
        <div style="margin-top: 0.25rem; color: var(--text-secondary-light);">
          Reason: ${item.reason}
        </div>
      </li>
    `;
  });
  
  html += `
      </ul>
    </div>
  `;
  
  summarizeIssuesResults.innerHTML = html;
} 