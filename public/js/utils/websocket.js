/**
 * WebSocket Client Module
 * 
 * WHY:
 * - Need real-time communication between server and client
 * - Console logs from server should be visible in browser console
 * - Provides better user feedback during long-running operations
 * 
 * HOW:
 * - Creates and maintains WebSocket connection to server
 * - Handles connection state and automatic reconnection
 * - Processes incoming log messages
 * - Outputs server logs to browser console
 * 
 * WHAT:
 * - Exports functions to initialize WebSocket connection
 * - Provides handlers for log messages
 * - Manages console integration of server logs
 */

import * as ui from './ui.js';

// WebSocket connection
let socket = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_INTERVAL = 3000;
let isLoadingOverlayVisible = false;

let serverShutdownDetected = false;
let reconnectInterval = null;

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
  
  // Add handler for page unload to close connection properly
  window.addEventListener('beforeunload', () => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      // Send a close message to let server know this is intentional
      try {
        socket.send(JSON.stringify({
          type: 'client-disconnect',
          reason: 'page-unload'
        }));
      } catch (e) {
        // Ignore errors during page unload
      }
      
      // Close connection
      socket.close(1000, 'Page unload');
    }
    
    // Clear any active reconnection intervals
    if (reconnectInterval) {
      clearInterval(reconnectInterval);
      reconnectInterval = null;
    }
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
    } else if (data.type === 'server-shutdown') {
      // Handle server shutdown notification
      console.warn('Server is shutting down:', data.message);
      
      // Show a notification to the user if they're actively using the app
      if (document.visibilityState === 'visible') {
        ui.showToast('The server is shutting down. You may need to refresh the page when it restarts.', 'warning', 10000);
      }
      
      // Mark as server shutdown to change reconnection behavior
      serverShutdownDetected = true;
      
      // Close the WebSocket connection cleanly from our side
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close(1000, 'Server shutting down');
      }
      
      // Set up periodic reconnection attempts for when server comes back
      scheduleServerRestartCheck();
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
  
  // If this is a progress message, update the loading status
  if (isLoadingOverlayVisible && source === 'summarize') {
    ui.updateLoadingStatus(message, level === 'error' ? 'error' : 
                                  level === 'success' ? 'success' : 'info');
  }
}

/**
 * Handle log history message
 * @param {Array} logs - Array of log messages
 */
function handleLogHistory(logs) {
  if (!logs || logs.length === 0) {
    return;
  }
  
  console.groupCollapsed('Server Log History');
  
  // Log each message to the console
  logs.forEach(log => {
    handleLogMessage(log);
  });
  
  console.groupEnd();
}

/**
 * Handle WebSocket close event
 * @param {CloseEvent} event - The close event
 */
function handleSocketClose(event) {
  if (event.wasClean) {
    console.info(`WebSocket connection closed cleanly, code=${event.code}, reason=${event.reason}`);
    
    // If this was a server shutdown, don't try normal reconnection
    if (serverShutdownDetected) {
      return;
    }
  } else {
    console.warn('WebSocket connection died');
  }
  
  // Only do normal reconnection if it wasn't a server shutdown
  if (!serverShutdownDetected) {
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

/**
 * Schedule periodic checks for when the server comes back after a restart
 */
function scheduleServerRestartCheck() {
  // Clear any existing reconnect interval
  if (reconnectInterval) {
    clearInterval(reconnectInterval);
  }
  
  console.info('Starting periodic checks for server restart...');
  
  // Try to reconnect every 3 seconds
  reconnectInterval = setInterval(() => {
    // If we already have a socket and it's open or connecting, don't try again
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      clearInterval(reconnectInterval);
      reconnectInterval = null;
      return;
    }
    
    console.info('Checking if server has restarted...');
    
    // Try to connect
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    // Create a new socket just to test connection
    const testSocket = new WebSocket(wsUrl);
    
    testSocket.onopen = () => {
      console.info('Server is back online, reconnecting...');
      
      // Server is back, clear interval and reset flag
      clearInterval(reconnectInterval);
      reconnectInterval = null;
      serverShutdownDetected = false;
      
      // Close test socket (we'll create a proper one via connectWebSocket)
      testSocket.close();
      
      // Connect properly
      connectWebSocket(wsUrl);
      
      // Notify user
      ui.showToast('Connection to server restored!', 'success');
    };
    
    // Handle errors silently - we expect errors while the server is down
    testSocket.onerror = () => {};
  }, 3000);
} 