/**
 * Issue Summarization Module
 * 
 * WHY:
 * - Large numbers of issues need to be analyzed and summarized for management
 * - Manual review of all issues is time-consuming and inefficient
 * - AI-powered insights can reveal patterns and trends in the roadmap
 * 
 * HOW:
 * - Uses OpenAI to generate summaries and insights about issues
 * - Fetches detailed issue information from GitHub
 * - Groups and processes issues by team, function, or other criteria
 * - Generates human-readable summaries with key insights
 * 
 * WHAT:
 * - Exports functions to fetch, analyze, and summarize roadmap issues
 * - Provides AI-powered analysis of issue content and metadata
 * - Generates executive summaries for teams and workstreams
 * - Identifies patterns, blockers, and opportunities across issues
 */

import chalk from 'chalk';
import ora from 'ora';
import { listItems, getItemByID } from './items.js';
import OpenAI from 'openai';
import { logger } from './logger.js';

// Setup OpenAI client
if (!process.env.OPENAI_API_KEY) {
  console.error('Error: OPENAI_API_KEY environment variable is not set.');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Generate a summary, grouping, and priority list for a set of issues
 * @param {Array} issues - The issues to analyze
 * @returns {Promise<string>} - The analysis from ChatGPT
 */
async function analyzeIssues(issues) {
  if (issues.length === 0) {
    return "No issues to analyze.";
  }

  // Prepare issues for the prompt (limit body and comments to avoid token limits)
  const simplifiedIssues = issues.map(issue => {
    const bodyPreview = issue.body.length > 300 ? 
      issue.body.substring(0, 300) + '...' : 
      issue.body;
    
    const commentsPreview = issue.comments.length > 0 ? 
      issue.comments.slice(0, 2).map(c => 
        c.length > 200 ? c.substring(0, 200) + '...' : c
      ).join('\n---\n') : 
      'No comments';

    return {
      title: issue.title,
      number: issue.number,
      author: issue.author,
      assignees: issue.assignees.join(', ') || 'None',
      body: bodyPreview,
      comments: commentsPreview,
      fields: issue.fields
    };
  });

  try {
    const prompt = `
I have the following GitHub issues that need to be analyzed:

${simplifiedIssues.map((issue, index) => `
ISSUE #${issue.number}: - ${issue.title}
URL: ${issue.url}
Author: ${issue.author}
Assignees: ${issue.assignees}
Fields: ${Object.entries(issue.fields).map(([key, value]) => `${key}: ${value}`).join(', ')}
Description: ${issue.body || 'No description provided'}
Comments: ${issue.comments}
Labels: ${issue.labels}
---
`).join('\n')}

Based on these issues, please provide:

1. A concise summary of the overall themes and topics represented in these issues
2. A logical grouping of these issues by category or theme
3. A suggested priority order for addressing these issues, with a brief explanation for each priority
4. Any potential dependencies or relationships between issues that might affect planning

Please format your response with clear Markdown headings (using # and ##) for each section. Use proper Markdown formatting for lists, emphasis, and code blocks where appropriate. This will be displayed directly in a web interface that supports Markdown rendering.`;

    const response = await openai.chat.completions.create({
      model: "o3-mini",
      messages: [
        { role: "system", content: "You are a helpful project management assistant that analyzes GitHub issues. Format your responses using proper Markdown syntax for headings, lists, emphasis, and code blocks to ensure readability. Your analysis will be displayed in a web interface that supports Markdown rendering." },
        { role: "user", content: prompt }
      ]
    });
    
    return response.choices[0]?.message?.content || "Could not generate analysis.";
  } catch (error) {
    console.error('Error analyzing issues with ChatGPT:', error.message);
    return "Error: Could not complete the analysis. " + error.message;
  }
}

/**
 * Summarize issues with AI-generated analysis
 * @param {Object} options - Filtering options
 * @param {boolean} [isCliMode=false] - Whether running in CLI mode
 * @returns {Promise<string>} - The analysis result
 */
export async function summarizeIssues(options, isCliMode = false) {
  const first = 100;
  try {
    // Create spinners only in CLI mode
    let mainSpinner = null;
    let detailSpinner = null;
    let analysisSpinner = null;
    
    if (isCliMode) {
      mainSpinner.text = 'Fetching issues from GitHub project...';
    } else {
      logger.info('Fetching issues from GitHub project...', { source: 'summarize' });
    }
    
    // Fetch all items
    const result = await listItems(options);
    
    if (result.data.length === 0) {
      if (isCliMode) {
        mainSpinner.fail('No issues found matching provided filters.');
      } else {
        logger.warn('No issues found matching provided filters.', { source: 'summarize' });
      }
      return "No issues found matching provided filters.";
    }
    
    if (isCliMode) {
      mainSpinner.succeed(`Found ${result.data.length} issues matching the filters.`);
    } else {
      logger.info(`Found ${result.data.length} issues matching the filters.`, {
        source: 'summarize', 
        count: result.data.length
      });
    }
    
    // Create a new spinner for the detailed fetch phase
    if (isCliMode) {
      detailSpinner = ora('Fetching detailed information for issues...').start();
    } else {
      logger.info('Fetching detailed information for issues...', { source: 'summarize' });
    }
    
    // Fetch detailed information for each issue
    const issuesWithDetails = [];
    let counter = 0;
    
    for (const item of result.data) {
      counter++;
      
      if (isCliMode) {
        detailSpinner.text = `Fetching details for issue ${counter}/${result.data.length}`;
      } else {
        logger.info(`Fetching details for issue ${counter}/${result.data.length}`, {
          source: 'summarize',
          progress: { current: counter, total: result.data.length }
        });
      }
      
      const issueDetails = await getItemByID(item.id);
      // merge issueDetails with item
      const mergedIssue = { ...item, ...issueDetails };
      issuesWithDetails.push(mergedIssue);
    }
    
    if (isCliMode) {
      detailSpinner.succeed('Fetched detailed information for all matching issues.');
    } else {
      logger.info('Fetched detailed information for all matching issues.', { source: 'summarize' });
    }
    
    // Create a new spinner for the analysis phase
    if (isCliMode) {
      analysisSpinner = ora('Analyzing issues with AI...').start();
    } else {
      logger.info('Analyzing issues with AI...', { source: 'summarize' });
    }
    
    // Generate analysis
    const analysis = await analyzeIssues(issuesWithDetails);
    
    if (isCliMode) {
      analysisSpinner.succeed('AI analysis completed.');
      
      console.log("\n" + chalk.green("Issue Analysis:"));
      console.log(chalk.white("=".repeat(80)));
      console.log(analysis);
      console.log(chalk.white("=".repeat(80)));
    } else {
      logger.success('AI analysis completed.', { source: 'summarize' });
    }
    
    return analysis;
  } catch (error) {
    // If there's an error, make sure to stop any active spinner
    if (isCliMode) {
      ora().fail('Error during summarization process');
      console.error(chalk.red('Error summarizing issues:'), chalk.red(error.message));
    } else {
      logger.error(`Error summarizing issues: ${error.message}`, { 
        source: 'summarize',
        stack: error.stack 
      });
    }
    throw error;
  }
} 