/**
 * Logger Module
 * 
 * WHY:
 * - Need a centralized logging system that streams logs to both console and WebSocket clients
 * - Allows real-time visibility of server processing in the web UI
 * - Enables better debugging and user feedback during long-running operations
 * 
 * HOW:
 * - Provides a logger that wraps console methods
 * - Broadcasts logs to connected WebSocket clients
 * - Maintains a log history for new connections
 * 
 * WHAT:
 * - Exports a logger object with common logging methods
 * - Provides WebSocket client management functions
 * - Maintains a recent log history
 */

// Store WebSocket clients and recent logs
let wsClients = new Set();
const logHistory = [];
const MAX_LOG_HISTORY = 100;

/**
 * Add a WebSocket client to receive logs
 * @param {WebSocket} ws - The WebSocket client to add
 */
export function addLogClient(ws) {
  wsClients.add(ws);
  
  // Send recent log history to the new client
  if (logHistory.length > 0) {
    const historyMessage = JSON.stringify({
      type: 'log-history',
      logs: logHistory
    });
    
    ws.send(historyMessage);
  }
  
  // Remove client when it disconnects
  ws.on('close', () => {
    wsClients.delete(ws);
  });
}

/**
 * Broadcast a log message to all connected clients
 * @param {string} level - Log level (info, warn, error)
 * @param {string} message - The log message
 * @param {Object} [metadata] - Additional metadata for the log
 */
function broadcastLog(level, message, metadata = {}) {
  // Create log entry
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    metadata,
    source: metadata.source || 'server'
  };
  
  // Add to history, maintaining max size
  logHistory.push(logEntry);
  if (logHistory.length > MAX_LOG_HISTORY) {
    logHistory.shift();
  }
  
  // Skip broadcast if no clients are connected
  if (wsClients.size === 0) return;
  
  // Broadcast to all clients
  const logMessage = JSON.stringify({
    type: 'log',
    log: logEntry
  });
  
  for (const client of wsClients) {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(logMessage);
    }
  }
}

/**
 * Logger object that sends logs to both console and WebSocket clients
 */
export const logger = {
  /**
   * Log an informational message
   * @param {string} message - The message to log
   * @param {Object} [metadata] - Additional metadata
   */
  info: (message, metadata = {}) => {
    console.info(message);
    broadcastLog('info', message, metadata);
  },
  
  /**
   * Log a warning message
   * @param {string} message - The message to log
   * @param {Object} [metadata] - Additional metadata
   */
  warn: (message, metadata = {}) => {
    console.warn(message);
    broadcastLog('warn', message, metadata);
  },
  
  /**
   * Log an error message
   * @param {string} message - The message to log
   * @param {Object} [metadata] - Additional metadata
   */
  error: (message, metadata = {}) => {
    console.error(message);
    broadcastLog('error', message, metadata);
  },
  
  /**
   * Log success message
   * @param {string} message - The message to log
   * @param {Object} [metadata] - Additional metadata
   */
  success: (message, metadata = {}) => {
    console.log(message);
    broadcastLog('success', message, metadata);
  },
  
  /**
   * Log a debug message (only in development)
   * @param {string} message - The message to log
   * @param {Object} [metadata] - Additional metadata
   */
  debug: (message, metadata = {}) => {
    console.debug(message);
    // Only broadcast in development mode
    if (process.env.NODE_ENV !== 'production') {
      broadcastLog('debug', message, metadata);
    }
  }
};

/**
 * Get the current client count
 * @returns {number} Number of connected clients
 */
export function getClientCount() {
  return wsClients.size;
}

/**
 * Close all WebSocket connections
 * @returns {number} Number of connections closed
 */
export function closeAllConnections() {
  const count = wsClients.size;
  
  // Send a close message to all clients
  for (const client of wsClients) {
    try {
      if (client.readyState === 1) { // WebSocket.OPEN
        // Send a graceful close message
        client.send(JSON.stringify({
          type: 'server-shutdown',
          message: 'Server is shutting down'
        }));
        
        // Close the connection
        client.close(1000, 'Server shutting down');
      }
    } catch (error) {
      console.error('Error closing WebSocket connection:', error);
    }
  }
  
  // Clear the clients set
  wsClients.clear();
  
  return count;
} 