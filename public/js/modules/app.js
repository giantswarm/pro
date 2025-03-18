/**
 * Main Application Module
 * Initializes the web application and manages tab navigation
 */

import * as state from './state.js';
import * as api from './api.js';
import * as ui from '../utils/ui.js';
import * as fixFields from './fixFields.js';
import * as aiAnalysis from './aiAnalysis.js';

/**
 * Initialize the web application
 */
export async function initApp() {
  console.log('Initializing AI Roadmap Analysis Tool...');
  
  // Initialize UI components
  initTabs();
  initFieldFixing();
  
  // Load field options (teams, etc.)
  try {
    ui.toggleLoadingOverlay(true, 'Loading application data...');
    const fieldOptions = await api.fetchFieldOptions();
    
    if (fieldOptions.status === 'success' && fieldOptions.data) {
      state.updateStateProperty('fieldOptions', fieldOptions.data);
      
      // Initialize forms with loaded data
      populateSelectOptions();
      
      // Initialize AI analysis form
      aiAnalysis.initAnalysisForm();
      
      ui.updateOperationStatus('Application initialized', 'success');
    } else {
      throw new Error('Failed to load field options');
    }
  } catch (error) {
    console.error('Error initializing app:', error);
    ui.updateOperationStatus(`Error initializing application: ${error.message}`, 'danger');
  } finally {
    ui.toggleLoadingOverlay(false);
  }
}

/**
 * Initialize tab navigation
 */
function initTabs() {
  const tabNavs = document.querySelectorAll('.nav-link');
  const tabContents = document.querySelectorAll('.tab-pane');
  
  tabNavs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      
      // Remove active class from all tabs and contents
      tabNavs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active', 'show'));
      
      // Add active class to clicked tab
      tab.classList.add('active');
      
      // Get target content and show it
      const targetId = tab.getAttribute('href').substring(1);
      const targetContent = document.getElementById(targetId);
      if (targetContent) {
        targetContent.classList.add('active', 'show');
      }
      
      // Hide any result containers when switching tabs
      const resultContainers = document.querySelectorAll('.result-container');
      resultContainers.forEach(container => {
        container.style.display = 'none';
      });
      
      // Hide the issues container when switching tabs
      const issuesContainer = document.getElementById('issuesContainer');
      if (issuesContainer) {
        issuesContainer.style.display = 'none';
      }
      
      // Reset operation status
      ui.updateOperationStatus('', '');
    });
  });
}

/**
 * Initialize field fixing UI and event listeners
 */
function initFieldFixing() {
  // Find empty fields button
  const findBtn = document.getElementById('findEmptyFields');
  if (findBtn) {
    findBtn.addEventListener('click', fixFields.findIssuesWithEmptyFields);
  }
  
  // Start fixing button
  const startFixingBtn = document.getElementById('startFixingBtn');
  if (startFixingBtn) {
    startFixingBtn.addEventListener('click', fixFields.startFixingEmptyFields);
  }
}

/**
 * Populate select options with data from the API
 */
function populateSelectOptions() {
  const stateObj = state.getState();
  if (!stateObj.fieldOptions) return;
  
  // Populate team selects
  if (stateObj.fieldOptions.teams) {
    ui.populateSelectOptions('fixTeam', stateObj.fieldOptions.teams, true);
  }
  
  // Populate field type selects
  if (stateObj.fieldOptions.fieldTypes) {
    ui.populateSelectOptions('fixFieldType', stateObj.fieldOptions.fieldTypes, false);
  }
} 