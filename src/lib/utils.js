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
 * Normalize a field value by converting to lowercase, removing emojis and special characters
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