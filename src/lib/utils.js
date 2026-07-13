/**
 * Utility Functions Module
 *
 * Common utility functions used across the application.
 */

/**
 * Normalize a field value for consistent comparison.
 * Converts to lowercase, removes emojis, treats separators as equivalent,
 * and trims whitespace.
 *
 * Separators (`/`, `-`, and whitespace runs) all collapse to a single space so
 * that values naming the same option/iteration but using different separator
 * styles compare equal, e.g. "Q4/2026", "Q4-2026", and "Q4 2026" all normalize
 * to "q4 2026". This is applied symmetrically to both the caller value and the
 * board's option/iteration titles.
 *
 * @param {string} value - Field value to normalize
 * @returns {string} - Normalized field value for comparison
 */
export function normalizeFieldValue(value) {
  if (!value) return '';
  return value.toLowerCase()
    // Remove emojis and special unicode characters
    .replace(/[\u{1F600}-\u{1F64F}|\u{1F300}-\u{1F5FF}|\u{1F680}-\u{1F6FF}|\u{2600}-\u{26FF}|\u{2700}-\u{27BF}|\u{1F900}-\u{1F9FF}|\u{1F1E0}-\u{1F1FF}|\u{1F100}-\u{1F1FF}|\u{E000}-\u{F8FF}]/gu, '')
    // Treat slash, hyphen, and whitespace as interchangeable separators
    .replace(/[/\-\s]+/g, ' ')
    // Remove other special characters but keep alphanumeric and spaces
    .replace(/[^\w\s]/g, '')
    // Collapse any whitespace introduced above and trim
    .replace(/\s+/g, ' ')
    .trim();
}
