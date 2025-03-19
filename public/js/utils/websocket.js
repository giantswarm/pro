/**
 * WebSocket Client Module
 * 
 * WHY:
 * - Need real-time communication between server and client
 * - Console logs from server should be visible in web UI
 * - Provides better user feedback during long-running operations
 * 
 * HOW:
 * - Creates and maintains WebSocket connection to server
 * - Handles connection state and automatic reconnection
 * - Processes incoming log messages
 * - Updates UI with received logs
 * 
 * WHAT:
 * - Exports functions to initialize WebSocket connection
 * - Provides handlers for log messages
 * - Manages loading overlay and console integration
 */

import * as ui from './ui.js';

// WebSocket connection
let socket = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_INTERVAL = 3000;
let isLoadingOverlayVisible = false;

// Log container reference
let logContainer = null;

/**
 * Initialize the WebSocket connection
 */
export function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  connectWebSocket(wsUrl);
  
  // Add window event listeners to track loading overlay visibility
  window.addEventListener('loadingOverlayShown', () => {
    isLoadingOverlayVisible = true;
  });
  
  window.addEventListener('loadingOverlayHidden', () => {
    isLoadingOverlayVisible = false;
  });
}

/**
 * Connect to the WebSocket server
 * @param {string} url - The WebSocket server URL
 */
function connectWebSocket(url) {
  try {
    // Close existing connection if any
    if (socket) {
      socket.close();
    }
    
    console.info('Connecting to WebSocket server...');
    
    socket = new WebSocket(url);
    
    socket.onopen = handleSocketOpen;
    socket.onmessage = handleSocketMessage;
    socket.onclose = handleSocketClose;
    socket.onerror = handleSocketError;
    
  } catch (error) {
    console.error('WebSocket connection error:', error);
    scheduleReconnect();
  }
}

/**
 * Handle WebSocket open event
 */
function handleSocketOpen() {
  console.info('WebSocket connection established');
  reconnectAttempts = 0;
}

/**
 * Handle WebSocket messages
 * @param {MessageEvent} event - The message event
 */
function handleSocketMessage(event) {
  try {
    const data = JSON.parse(event.data);
    
    if (data.type === 'log') {
      handleLogMessage(data.log);
    } else if (data.type === 'log-history') {
      handleLogHistory(data.logs);
    }
  } catch (error) {
    console.error('Error processing WebSocket message:', error);
  }
}

/**
 * Handle a single log message
 * @param {Object} log - The log message object
 */
function handleLogMessage(log) {
  const { timestamp, level, message, metadata, source } = log;
  
  // Format the timestamp
  const time = new Date(timestamp).toLocaleTimeString();
  
  // Determine if we should show in UI or just console
  if (isLoadingOverlayVisible) {
    displayLogInUI(time, level, message, source);
  } else {
    // Log to console based on level
    const consoleMessage = `[${time}] [${source}] ${message}`;
    
    switch (level) {
      case 'error':
        console.error(consoleMessage, metadata || '');
        break;
      case 'warn':
        console.warn(consoleMessage, metadata || '');
        break;
      case 'success':
        console.log('%c' + consoleMessage, 'color: green', metadata || '');
        break;
      case 'debug':
        console.debug(consoleMessage, metadata || '');
        break;
      default:
        console.info(consoleMessage, metadata || '');
    }
  }
}

/**
 * Handle log history message
 * @param {Array} logs - Array of log messages
 */
function handleLogHistory(logs) {
  if (!logs || logs.length === 0 || !isLoadingOverlayVisible) {
    return;
  }
  
  // Clear existing logs in UI
  ensureLogContainerExists();
  logContainer.innerHTML = '<h6 class="mb-2">Server Logs:</h6>';
  
  // Add each log to the UI
  logs.forEach(log => {
    handleLogMessage(log);
  });
}

/**
 * Make sure the log container exists in the DOM
 */
function ensureLogContainerExists() {
  if (!logContainer) {
    logContainer = document.getElementById('serverLogContainer');
    
    if (!logContainer) {
      logContainer = document.createElement('div');
      logContainer.id = 'serverLogContainer';
      logContainer.className = 'server-log-container mt-3';
      
      const loadingContent = document.querySelector('.loading-overlay > div') || document.querySelector('.loading-overlay');
      if (loadingContent) {
        loadingContent.appendChild(logContainer);
      }
    }
    
    // Make sure there's a header
    if (logContainer.children.length === 0) {
      logContainer.innerHTML = '<h6 class="mb-2">Server Logs:</h6>';
    }
  }
  
  return logContainer;
}

/**
 * Display a log message in the UI
 * @param {string} time - Formatted timestamp
 * @param {string} level - Log level
 * @param {string} message - The log message
 * @param {string} source - Source of the log message
 */
function displayLogInUI(time, level, message, source) {
  ensureLogContainerExists();
  
  // Create log entry element
  const logEntry = document.createElement('div');
  logEntry.className = 'log-entry';
  
  // Style based on level
  let levelClass = '';
  let icon = '';
  
  switch (level) {
    case 'error':
      levelClass = 'text-danger';
      icon = '<i class="bi bi-exclamation-triangle-fill"></i>';
      break;
    case 'warn':
      levelClass = 'text-warning';
      icon = '<i class="bi bi-exclamation-triangle"></i>';
      break;
    case 'success':
      levelClass = 'text-success';
      icon = '<i class="bi bi-check-circle"></i>';
      break;
    default:
      levelClass = 'text-primary';
      icon = '<i class="bi bi-info-circle"></i>';
  }
  
  // Build log entry HTML
  logEntry.innerHTML = `
    <span class="log-time">[${time}]</span>
    <span class="${levelClass}">${icon} ${message}</span>
  `;
  
  // Add to container
  logContainer.appendChild(logEntry);
  
  // Auto-scroll to bottom
  logContainer.scrollTop = logContainer.scrollHeight;
  
  // If this is a progress message, also update the loading status
  if (source === 'summarize') {
    ui.updateLoadingStatus(message, level === 'error' ? 'error' : 
                                    level === 'success' ? 'success' : 'info');
  }
}

/**
 * Handle WebSocket close event
 * @param {CloseEvent} event - The close event
 */
function handleSocketClose(event) {
  if (event.wasClean) {
    console.info(`WebSocket connection closed cleanly, code=${event.code}, reason=${event.reason}`);
  } else {
    console.warn('WebSocket connection died');
    scheduleReconnect();
  }
}

/**
 * Handle WebSocket error event
 * @param {Event} error - The error event
 */
function handleSocketError(error) {
  console.error('WebSocket error:', error);
  scheduleReconnect();
}

/**
 * Schedule a reconnection attempt
 */
function scheduleReconnect() {
  if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
    reconnectAttempts++;
    
    const delay = RECONNECT_INTERVAL * reconnectAttempts;
    console.info(`Attempting to reconnect in ${delay / 1000} seconds...`);
    
    setTimeout(() => {
      console.info(`Reconnecting... (attempt ${reconnectAttempts} of ${MAX_RECONNECT_ATTEMPTS})`);
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}`;
      connectWebSocket(wsUrl);
    }, delay);
  } else {
    console.error('Maximum reconnection attempts reached. Please refresh the page.');
  }
} 