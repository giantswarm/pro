/**
 * State management module for the application
 * Provides a single source of truth for application state
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