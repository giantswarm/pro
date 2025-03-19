/**
 * State Management Module
 * 
 * WHY:
 * This module implements a centralized state management pattern to solve several 
 * critical challenges in the application:
 * - Maintaining a single source of truth for application data
 * - Preventing data duplication and associated synchronization issues
 * - Simplifying data flow throughout the application
 * - Facilitating predictable state transitions
 * - Reducing prop drilling between components
 * - Enabling more straightforward debugging by centralizing state changes
 * 
 * HOW:
 * The module implements a lightweight state management solution that:
 * 1. Maintains a private state object with a predefined structure
 * 2. Exposes controlled getter and setter methods to interact with the state
 * 3. Prevents direct mutation of state properties from outside the module
 * 4. Provides utilities for managing both top-level and nested state properties
 * 5. Includes reset functionality for returning to known state conditions
 * 
 * This approach balances simplicity and effectiveness without introducing the 
 * complexity of larger state management libraries.
 * 
 * WHAT:
 * The module provides functions to:
 * - Initialize application state with default values
 * - Retrieve the entire state object or specific properties
 * - Update individual and nested state properties
 * - Reset the entire state or specific portions to initial values
 * 
 * Key state includes:
 * - Available field options for form controls
 * - Current items/issues being processed
 * - Processing state and progress indicators
 * - Results tracking for operations
 */

// Initial application state
const initialState = {
  fieldOptions: {
    kind: [],
    status: [],
    function: [],
    team: []
  },
  items: [],
  emptyFieldItems: [],
  currentFixingIndex: -1,
  fixingResults: {
    total: 0,
    fixed: 0,
    skipped: 0
  },
  fetchingDetails: {
    step: 'idle',
    totalItems: 0,
    processedItems: 0,
    filteredItems: 0
  },
  isProcessingSuggestion: false
};

// Create a copy of the initial state as the current state
let state = { ...initialState };

/**
 * Get the current application state
 * @returns {Object} The current state object
 */
export function getState() {
  return state;
}

/**
 * Get a specific property from the state
 * @param {string} property - The property name to retrieve
 * @returns {any} The value of the property
 */
export function getStateProperty(property) {
  return state[property];
}

/**
 * Update a specific property in the state
 * @param {string} property - The property name to update
 * @param {any} value - The new value for the property
 */
export function updateStateProperty(property, value) {
  state[property] = value;
}

/**
 * Update a nested property in the state
 * @param {string} parentProperty - The parent property name
 * @param {string} childProperty - The child property name
 * @param {any} value - The new value for the property
 */
export function updateNestedStateProperty(parentProperty, childProperty, value) {
  if (state[parentProperty]) {
    state[parentProperty][childProperty] = value;
  }
}

/**
 * Reset the state to its initial values
 */
export function resetState() {
  state = { ...initialState };
}

/**
 * Reset specific parts of the state
 * @param {string} property - The property to reset
 */
export function resetStateProperty(property) {
  if (state[property] && initialState[property]) {
    state[property] = { ...initialState[property] };
  }
} 