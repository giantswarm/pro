/**
 * Utility Functions Module
 *
 * Common utility functions used across the application.
 */

/**
 * Normalize a field value for consistent comparison.
 * Converts to lowercase, treats separators as equivalent, strips punctuation
 * and emojis while preserving letters (including accented/Unicode letters) and
 * numbers, and trims whitespace.
 *
 * Separators (`/`, `-`, `_`, and whitespace runs) all collapse to a single
 * space so that values naming the same option/iteration but using different
 * separator styles compare equal, e.g. "Q4/2026", "Q4-2026", "Q4_2026", and
 * "Q4 2026" all normalize to "q4 2026". This is applied symmetrically to both
 * the caller value and the board's option/iteration titles.
 *
 * @param {string} value - Field value to normalize
 * @returns {string} - Normalized field value for comparison
 */
export function normalizeFieldValue(value) {
  if (!value) return '';
  return value.toLowerCase()
    // Treat slash, hyphen, underscore, and whitespace as interchangeable separators
    .replace(/[/\-\s_]+/g, ' ')
    // Keep letters (incl. accented/Unicode), numbers, and spaces;
    // strip everything else -- punctuation, emojis, and other symbols.
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    // Collapse any whitespace introduced above and trim
    .replace(/\s+/g, ' ')
    .trim();
}
