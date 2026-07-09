/**
 * Logger Module
 *
 * Simple logger that writes all output to stderr to avoid interfering
 * with the MCP stdio transport on stdout.
 *
 * Supports an optional second argument for structured data, e.g.:
 *   logger.info('Tool called', { tool: 'list_issues', filters: { team: 'foo' } });
 */

function formatMessage(message, data) {
  if (data !== undefined) {
    try {
      return `${message} ${JSON.stringify(data)}`;
    } catch {
      return `${message} [unserializable data]`;
    }
  }
  return message;
}

export const logger = {
  info: (message, data) => {
    console.error(`[info] ${formatMessage(message, data)}`);
  },

  warn: (message, data) => {
    console.error(`[warn] ${formatMessage(message, data)}`);
  },

  error: (message, data) => {
    console.error(`[error] ${formatMessage(message, data)}`);
  },

  debug: (message, data) => {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[debug] ${formatMessage(message, data)}`);
    }
  }
};
