/**
 * Main Application Module
 * 
 * WHY:
 * This module serves as the orchestration layer for the entire application, fulfilling 
 * several critical roles:
 * - Providing a central initialization point for all application features
 * - Managing global application state and configuration
 * - Coordinating between independent feature modules
 * - Handling cross-cutting concerns like theme management and navigation
 * - Ensuring proper load sequence and dependency management
 * - Creating a consistent user experience across all features
 * 
 * HOW:
 * The module follows an organized initialization pattern where it:
 * 1. Establishes the application environment (theme, branding, global listeners)
 * 2. Loads necessary data from APIs
 * 3. Initializes feature modules in the correct sequence
 * 4. Sets up navigation and tab management
 * 5. Handles global events and error conditions
 * 
 * This module uses a modular approach where specific functionality is delegated
 * to specialized sub-modules while maintaining central coordination.
 * 
 * WHAT:
 * The module provides functionality to:
 * - Bootstrap the entire application
 * - Initialize the UI and visual components
 * - Set up tab navigation and content switching
 * - Load field options and configuration from the server
 * - Set up dark mode toggle and preferences
 * - Initialize feature-specific modules
 * - Apply branding and theme settings
 * - Handle global error conditions
 */

import * as state from './state.js';
import * as api from './api.js';
import * as ui from '../utils/ui.js';
import * as fixFields from './fixFields.js';
import * as aiAnalysis from './aiAnalysis.js';
import * as websocket from '../utils/websocket.js';
import notifications from '../utils/notifications.js';

/**
 * Initialize the application
 * Sets up the UI, loads necessary data, and prepares the app for use
 */
export async function initApp() {
  try {
    console.log('Initializing application...');
    ui.toggleLoadingOverlay(true, 'Loading application data...');

    // Initialize theme and UI components
    initGiantSwarmBranding();
    initDarkMode();
    initTabs();
    
    // Setup WebSocket connection
    websocket.initWebSocket();
    
    // Initialize feature modules
    initFieldFixing();
    initAiAnalysis();
    
    // Update UI to indicate app is ready
    ui.toggleLoadingOverlay(false);
    notifications.updateStatus('Application initialized', {
      elementId: 'operationStatus',
      type: 'success'
    });
  } catch (error) {
    console.error('Error initializing application:', error);
    ui.toggleLoadingOverlay(false);
    notifications.error(`Error initializing application: ${error.message}`);
  }
}

/**
 * Initialize Giant Swarm branding elements
 */
function initGiantSwarmBranding() {
  // Set document title
  document.title = "Giant Swarm AI Roadmap Analysis Tool";
  
  // Update copyright year in footer
  const currentYear = new Date().getFullYear();
  const footerYear = document.querySelector('footer small');
  if (footerYear) {
    footerYear.innerHTML = footerYear.innerHTML.replace('2023', currentYear);
  }
  
  // Apply Giant Swarm styling to loading overlay
  const loadingOverlay = document.getElementById('loadingOverlay');
  if (loadingOverlay) {
    loadingOverlay.classList.add('gs-branded');
  }
  
  // Apply Giant Swarm colors to spinners
  const spinners = document.querySelectorAll('.spinner-border');
  spinners.forEach(spinner => {
    spinner.style.color = 'var(--gs-blue)';
  });
}

/**
 * Initialize dark mode functionality
 * Implements dark mode toggle based on Giant Swarm styleguide
 */
function initDarkMode() {
  const darkModeToggle = document.getElementById('darkModeToggle');
  const darkModeIcon = document.getElementById('darkModeIcon');
  const darkModeText = document.getElementById('darkModeText');
  
  if (!darkModeToggle) return;
  
  // Add transition class to body for smooth theme transitions
  document.body.classList.add('theme-transition');
  
  // Check for saved theme preference
  const savedTheme = localStorage.getItem('gs-theme');
  
  // Check system preference
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  // Apply saved theme or OS preference
  if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
    applyDarkMode();
  } else if (savedTheme === 'light') {
    applyLightMode();
  } else {
    // If no saved preference, use system preference
    if (prefersDark) {
      applyDarkMode();
    } else {
      applyLightMode();
    }
  }
  
  // Add event listener for toggle
  darkModeToggle.addEventListener('click', toggleDarkMode);
  
  // Listen for OS theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    // Only auto-switch if user hasn't manually set a preference
    if (!localStorage.getItem('gs-theme')) {
      if (e.matches) {
        applyDarkMode(false); // Don't save to localStorage
      } else {
        applyLightMode(false); // Don't save to localStorage
      }
    }
  });
  
  /**
   * Toggle between light and dark mode
   */
  function toggleDarkMode() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    console.log('Current theme:', currentTheme);
    
    if (currentTheme === 'dark') {
      applyLightMode(true); // Save to localStorage
    } else {
      applyDarkMode(true); // Save to localStorage
    }
  }
  
  /**
   * Apply dark mode
   * @param {boolean} savePreference - Whether to save the preference to localStorage
   */
  function applyDarkMode(savePreference = false) {
    document.documentElement.setAttribute('data-theme', 'dark');
    
    // Update toggle button
    darkModeIcon.classList.remove('bi-sun-fill');
    darkModeIcon.classList.add('bi-moon-fill');
    darkModeText.textContent = 'Dark Mode';
    
    // Save preference if requested
    if (savePreference) {
      localStorage.setItem('gs-theme', 'dark');
    }
    
    // Dispatch event for other components to react to theme change
    window.dispatchEvent(new CustomEvent('giantswarm:themeChanged', { 
      detail: { theme: 'dark' } 
    }));
    
    console.log('Dark mode applied');
  }
  
  /**
   * Apply light mode
   * @param {boolean} savePreference - Whether to save the preference to localStorage
   */
  function applyLightMode(savePreference = false) {
    document.documentElement.setAttribute('data-theme', 'light');
    
    // Update toggle button
    darkModeIcon.classList.remove('bi-moon-fill');
    darkModeIcon.classList.add('bi-sun-fill');
    darkModeText.textContent = 'Light Mode';
    
    // Save preference if requested
    if (savePreference) {
      localStorage.setItem('gs-theme', 'light');
    }
    
    // Dispatch event for other components to react to theme change
    window.dispatchEvent(new CustomEvent('giantswarm:themeChanged', { 
      detail: { theme: 'light' } 
    }));
    
    console.log('Light mode applied');
  }
  
  /**
   * Update the dark mode toggle button based on current theme
   */
  function updateDarkModeToggleButton() {
    const theme = document.documentElement.getAttribute('data-theme');
    
    if (theme === 'dark') {
      darkModeIcon.classList.remove('bi-sun-fill');
      darkModeIcon.classList.add('bi-moon-fill');
      darkModeText.textContent = 'Dark Mode';
    } else {
      darkModeIcon.classList.remove('bi-moon-fill');
      darkModeIcon.classList.add('bi-sun-fill');
      darkModeText.textContent = 'Light Mode';
    }
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
      notifications.updateStatus('', { elementId: 'operationStatus' });
    });
  });
}

/**
 * Initialize field fixing UI and event listeners
 */
function initFieldFixing() {
  // Initialize fix fields module
  fixFields.initFixFields();
  
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
    
    // Populate the analysis team select normally
    ui.populateSelectOptions('analysisTeam', stateObj.fieldOptions.teams, true);
  }
  
  // Populate field type selects
  if (stateObj.fieldOptions.fieldTypes) {
    ui.populateSelectOptions('fixFieldType', stateObj.fieldOptions.fieldTypes, false);
  }
}

async function initAiAnalysis() {
  const fieldOptions = await api.fetchFieldOptions();

  if (fieldOptions.status === 'success' && fieldOptions.data) {
    state.updateStateProperty('fieldOptions', fieldOptions.data);

    // Initialize forms with loaded data
    populateSelectOptions();

    // Initialize AI analysis form
    aiAnalysis.initAnalysisForm();
  } else {
    throw new Error('Failed to load field options');
  }
}