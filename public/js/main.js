/**
 * Main Application Entry Point
 * 
 * WHY:
 * This file serves as the critical entry point for the entire JavaScript application.
 * Its purpose is to:
 * - Provide a clear starting point for code execution
 * - Ensure proper initialization sequence for the application
 * - Decouple the initialization process from the DOM content loading event
 * - Create a clean separation between the entry point and application logic
 * - Enable proper dependency loading before application starts
 * 
 * HOW:
 * This module implements a simple but effective pattern that:
 * 1. Waits for the DOM to be fully loaded before initializing
 * 2. Imports the main application module
 * 3. Delegates the initialization process to the dedicated app module
 * 
 * This approach ensures that all DOM elements are available and ready
 * before any JavaScript attempts to manipulate them, preventing timing issues.
 * 
 * WHAT:
 * The file contains:
 * - Import statement for the main application initialization function
 * - Event listener for the DOMContentLoaded event
 * - Call to the application initialization function when DOM is ready
 */

import { initApp } from './modules/app.js';

// Initialize the application when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
  initApp();
}); 