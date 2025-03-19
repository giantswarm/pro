/**
 * Utility Functions Module
 * 
 * WHY:
 * - Need common utility functions that can be used across the application
 * - Terminal links and field value normalization are used in multiple places
 * - Centralizing these utilities improves maintainability and consistency
 * 
 * HOW:
 * - Exports standalone utility functions for common operations
 * - Implements terminal-aware functionality for better user experience
 * - Provides text normalization helpers for consistent comparison
 * 
 * WHAT:
 * - Includes functions for creating clickable terminal links
 * - Provides normalization functions for standardizing field values
 * - Handles terminal capability detection and fallbacks
 */

/**
 * Create a clickable hyperlink for terminal output
 * 
 * WHY:
 * - Terminal links improve user experience by making issues directly clickable
 * - Not all terminals support hyperlinks, so fallbacks are needed
 * 
 * HOW:
 * - Uses ANSI escape sequences to create clickable links in supporting terminals
 * - Detects terminal capabilities and falls back to text format when unsupported
 * - Handles errors gracefully
 * 
 * @param {string} url - The URL to link to
 * @param {string} title - The display text for the link
 * @returns {string} - A formatted hyperlink string or fallback text
 */
export function makeIssueLink(url, title) {
  // Check if the environment supports color/formatting
  const supportsHyperlinks = process.env.TERM && process.env.TERM !== 'dumb' && process.stdout.isTTY;
  
  if (supportsHyperlinks) {
    try {
      // Standard terminal hyperlink format
      return `\u001b]8;;${url}\u0007${title}\u001b]8;;\u0007`;
    } catch (error) {
      // Fallback if there's an error
      return `${title} (${url})`;
    }
  } else {
    // Simple fallback for terminals that don't support hyperlinks
    return `${title} (${url})`;
  }
}

/**
 * Normalize a field value for consistent comparison
 * 
 * WHY:
 * - Field values may contain inconsistent formatting, emojis, or special characters
 * - Consistent normalization enables more reliable matching between values
 * - Case differences should be ignored for matching purposes
 * 
 * HOW:
 * - Converts text to lowercase
 * - Removes emojis, special Unicode characters, and non-alphanumeric symbols
 * - Trims extra whitespace
 * 
 * @param {string} value - Field value to normalize
 * @returns {string} - Normalized field value for comparison
 */
export function normalizeFieldValue(value) {
  if (!value) return '';
  // Convert to lowercase and remove emojis and special characters
  return value.toLowerCase()
    // Remove emojis and special unicode characters
    .replace(/[\u{1F600}-\u{1F64F}|\u{1F300}-\u{1F5FF}|\u{1F680}-\u{1F6FF}|\u{2600}-\u{26FF}|\u{2700}-\u{27BF}|\u{1F900}-\u{1F9FF}|\u{1F1E0}-\u{1F1FF}|\u{1F100}-\u{1F1FF}|\u{E000}-\u{F8FF}]/gu, '')
    // Remove other special characters but keep alphanumeric and spaces
    .replace(/[^\w\s]/g, '')
    // Trim extra whitespace
    .trim();
}