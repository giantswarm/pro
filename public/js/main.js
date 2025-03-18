/**
 * Main JavaScript Entry Point
 * Imports and initializes the application
 */

import { initApp } from './modules/app.js';

// Initialize the application when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
  initApp();
}); 