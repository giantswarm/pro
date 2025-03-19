/**
 * Summarize Issues Command Module
 * 
 * WHY:
 * - Large numbers of issues need to be analyzed and summarized for stakeholders
 * - Manual review of all issues is time-consuming and inefficient
 * - AI-powered summaries can identify patterns and priorities across many issues
 * 
 * HOW:
 * - Wraps the core summarizeIssues function from the library
 * - Takes filtering options to focus on specific subsets of issues
 * - Uses OpenAI to generate insights and summaries
 * 
 * WHAT:
 * - Exports a command handler function for the summarize-issues command
 * - Generates AI-powered analysis of filtered roadmap issues
 * - Provides thematic grouping, priority recommendations, and dependency insights
 * - Renders analysis results directly to the console
 */

import { summarizeIssues } from '../lib/summarize.js';

/**
 * CLI command handler for generating AI summaries of roadmap issues
 * 
 * @param {Object} options - Command options for filtering issues (team, kind, function, etc.)
 * @returns {Promise<void>} - Resolves when the operation is complete
 */
export async function summarizeIssuesCommand(options) {
  // Pass isCliMode=true for proper console output formatting
  await summarizeIssues(options, true);
} 