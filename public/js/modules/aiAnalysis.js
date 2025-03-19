/**
 * AI Analysis Module
 * Handles the functionality for generating AI analysis and summaries
 */

import * as state from './state.js';
import * as api from './api.js';
import * as ui from '../utils/ui.js';

/**
 * Initializes the AI analysis form
 */
export function initAnalysisForm() {
  const generateBtn = document.getElementById('generateAIAnalysis');
  if (generateBtn) {
    generateBtn.addEventListener('click', generateAIAnalysis);
  }
  
  // Initialize select options when field options are loaded
  const stateObj = state.getState();
  if (stateObj.fieldOptions) {
    populateAnalysisFilters();
  }
}

/**
 * Populates all filter select options for the analysis form
 */
function populateAnalysisFilters() {
  const stateObj = state.getState();
  if (!stateObj.fieldOptions) return;
  
  // Map field names to their corresponding state property and element ID
  const fieldMappings = [
    { stateProperty: 'teams', elementId: 'analysisTeam' },
    { stateProperty: 'functions', elementId: 'analysisFunction' },
    { stateProperty: 'kinds', elementId: 'analysisKind' },
    { stateProperty: 'statuses', elementId: 'analysisStatus' },
    { stateProperty: 'sigs', elementId: 'analysisSIG' },
    { stateProperty: 'wgs', elementId: 'analysisWG' }
  ];
  
  // Populate each filter select
  fieldMappings.forEach(mapping => {
    if (stateObj.fieldOptions[mapping.stateProperty]) {
      ui.populateSelectOptions(mapping.elementId, stateObj.fieldOptions[mapping.stateProperty], true);
    }
  });
}

/**
 * Generates an AI analysis based on form inputs
 */
export async function generateAIAnalysis() {
  // Get form values
  const teamValue = document.getElementById('analysisTeam').value;
  const functionValue = document.getElementById('analysisFunction').value;
  const kindValue = document.getElementById('analysisKind').value;
  const statusValue = document.getElementById('analysisStatus').value;
  const sigValue = document.getElementById('analysisSIG').value;
  const wgValue = document.getElementById('analysisWG').value;
  
  // Show loading overlay
  ui.toggleLoadingOverlay(true, 'Starting AI analysis...');
  
  try {
    // Update status based on filters
    if (teamValue || functionValue || kindValue || statusValue || sigValue || wgValue) {
      const activeFilters = [];
      if (teamValue) activeFilters.push(`team: ${teamValue}`);
      if (functionValue) activeFilters.push(`function: ${functionValue}`);
      if (kindValue) activeFilters.push(`kind: ${kindValue}`);
      if (statusValue) activeFilters.push(`status: ${statusValue}`);
      if (sigValue) activeFilters.push(`SIG: ${sigValue}`);
      if (wgValue) activeFilters.push(`working group: ${wgValue}`);
      
      ui.updateLoadingStatus(`Analyzing issues with filters: ${activeFilters.join(', ')}...`);
    } else {
      ui.updateLoadingStatus('Analyzing all issues across teams...');
    }
    
    // Build filters
    const filters = {
      team: teamValue,
      function: functionValue,
      kind: kindValue,
      status: statusValue,
      sig: sigValue,
      wg: wgValue
    };
    
    // Remove empty filters
    Object.keys(filters).forEach(key => {
      if (!filters[key]) {
        delete filters[key];
      }
    });
    
    // Generate AI summary
    ui.updateLoadingStatus('Connecting to GitHub API to fetch issues...', 'info');
    const result = await api.generateSummary(filters);
    
    if (result.status === 'error') {
      throw new Error(result.error);
    }
    
    if (!result.data || !result.data.summary) {
      throw new Error('No summary generated');
    }
    
    // Display the results
    displayAIAnalysisResults(result.data.summary);
    
    // Update status
    ui.updateOperationStatus('AI analysis completed successfully', 'success');
    
  } catch (error) {
    console.error('Error generating AI analysis:', error);
    ui.updateOperationStatus(`Error: ${error.message}`, 'danger');
  } finally {
    ui.toggleLoadingOverlay(false);
  }
}

/**
 * Displays the AI analysis results in the UI
 * @param {string} summary - The AI-generated summary
 */
function displayAIAnalysisResults(summary) {
  const resultsContainer = document.getElementById('aiAnalysisResults');
  if (!resultsContainer) return;
  
  resultsContainer.style.display = 'block';
  
  const summaryElement = document.getElementById('aiAnalysisSummary');
  if (summaryElement) {
    // Convert markdown to HTML
    const formattedSummary = formatMarkdown(summary);
    summaryElement.innerHTML = formattedSummary;
  }
}

/**
 * Formats markdown text to HTML
 * @param {string} markdown - The markdown text to format
 * @returns {string} - The formatted HTML
 */
function formatMarkdown(markdown) {
  if (!markdown) return '';
  
  // Simple markdown formatting
  let html = markdown
    // Headers
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    
    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    
    // Italic
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    
    // Lists
    .replace(/^\- (.*$)/gim, '<li>$1</li>')
    .replace(/^\d+\. (.*$)/gim, '<li>$1</li>')
    
    // Links
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>')
    
    // Code blocks
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    
    // Line breaks
    .replace(/\n/g, '<br>');
  
  // Wrap lists in ul or ol tags
  html = html
    .replace(/<li>(.+?)<\/li><br><li>/g, '<li>$1</li><li>')
    .replace(/<br><li>(.+?)(<br>|$)/g, '<ul><li>$1</li></ul>$2')
    .replace(/<li>(.+?)<\/li><\/ul><br><li>/g, '<li>$1</li><li>');
  
  return html;
} 