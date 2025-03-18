import { summarizeIssues } from '../lib/summarize.js';

export async function summarizeIssuesCommand(options) {
  await summarizeIssues(options);
} 