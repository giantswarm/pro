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
import { graphQLWithAuth, fetchPaginated } from './api.js';
import {
  ROADMAP_BOARD_ID,
  LIST_ITEMS_QUERY,
  ISSUE_DETAIL_QUERY
} from './project.js';
import { normalizeFieldValue } from './utils.js';
import OpenAI from 'openai';
import { logger } from './logger.js';

// Setup OpenAI client
if (!process.env.OPENAI_API_KEY) {
  console.error('Error: OPENAI_API_KEY environment variable is not set.');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Fetch detailed information for an issue
 * @param {Object} item - The project item containing basic issue details
 * @returns {Promise<Object>} - The issue with detailed information
 */
async function fetchIssueDetails(item) {
  if (!item.content) {
    return {
      title: 'Unknown',
      number: 'N/A',
      url: '',
      body: 'No content available',
      author: '',
      assignees: [],
      comments: [],
      fields: {}
    };
  }

  const baseIssue = {
    title: item.content.title || 'Untitled',
    number: item.content.number || 'N/A',
    url: item.content.url || '',
    body: '',
    author: '',
    assignees: [],
    comments: [],
    fields: {}
  };

  // Extract field values
  if (item.fieldValues && item.fieldValues.nodes) {
    item.fieldValues.nodes.forEach(node => {
      if (node.field && node.field.name && typeof node.name === 'string') {
        baseIssue.fields[node.field.name.toLowerCase()] = node.name;
      }
    });
  }

  try {
    // Fetch more detailed issue information
    const issueDetails = await graphQLWithAuth(ISSUE_DETAIL_QUERY, { id: item.id });
    if (issueDetails && issueDetails.node && issueDetails.node.content) {
      const content = issueDetails.node.content;
      baseIssue.body = content.bodyText || '';
      baseIssue.author = content.author?.login || '';
      
      if (content.assignees && content.assignees.nodes) {
        baseIssue.assignees = content.assignees.nodes.map(a => a.login);
      }
      
      if (content.comments && content.comments.nodes) {
        baseIssue.comments = content.comments.nodes.map(c => c.bodyText);
      }
    }
  } catch (err) {
    console.error(`Error fetching details for issue #${baseIssue.number}:`, err.message);
  }

  return baseIssue;
}

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
ISSUE ${index + 1}: #${issue.number} - ${issue.title}
Author: ${issue.author}
Assignees: ${issue.assignees}
Fields: ${Object.entries(issue.fields).map(([key, value]) => `${key}: ${value}`).join(', ')}
Description: ${issue.body || 'No description provided'}
Comments: ${issue.comments}
---
`).join('\n')}

Based on these issues, please provide:

1. A concise summary of the overall themes and topics represented in these issues
2. A logical grouping of these issues by category or theme
3. A suggested priority order for addressing these issues, with a brief explanation for each priority
4. Any potential dependencies or relationships between issues that might affect planning

Please format your response with clear headings for each section.`;

    const response = await openai.chat.completions.create({
      model: "o3-mini",
      messages: [
        { role: "system", content: "You are a helpful project management assistant that analyzes GitHub issues." },
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
      mainSpinner = ora('Starting issue summarization process...').start();
    } else {
      logger.info('Starting issue summarization process...', { source: 'summarize' });
    }
    
    // Build filter criteria based on provided options
    const filters = {};
    ['kind', 'status', 'function', 'workstream', 'sig', 'wg'].forEach(key => {
      if (options[key]) {
        filters[key === 'wg' ? 'working group' : key] = normalizeFieldValue(options[key]);
      }
    });
    if (options.team !== undefined && options.team !== false) {
      filters['team'] = normalizeFieldValue(options.team);
    }
    
    if (isCliMode) {
      mainSpinner.text = 'Fetching issues from GitHub project...';
    } else {
      logger.info('Fetching issues from GitHub project...', { source: 'summarize' });
    }
    
    // Fetch all items
    const allItems = await fetchPaginated(
      LIST_ITEMS_QUERY,
      { projectId: ROADMAP_BOARD_ID, first },
      result => result.node.items
    );
    
    if (isCliMode) {
      mainSpinner.text = 'Applying filters to issues...';
    } else {
      logger.info('Applying filters to issues...', { source: 'summarize' });
    }
    
    // Apply filters with normalization
    const filtered = allItems.filter(item => {
      if (!item.fieldValues || !item.fieldValues.nodes) return false;
      
      // Apply --no-team filter if specified
      if (options.team !== undefined && options.team === false) {
        const hasTeam = item.fieldValues.nodes.some(node => 
          node.field &&
          node.field.name &&
          node.field.name.toLowerCase() === 'team' &&
          typeof node.name === 'string' &&
          node.name.trim() !== ''
        );
        if (hasTeam) return false;
      }
      
      // Apply other filters with normalization for case insensitivity and emojis
      return Object.entries(filters).every(([filterKey, normalizedFilterValue]) => {
        const matchingField = item.fieldValues.nodes.find(node => {
          if (!node.field) return false;
          return node.field.name && node.field.name.toLowerCase() === filterKey;
        });
        
        if (!matchingField) return false;
        
        const normalizedFieldValue = normalizeFieldValue(matchingField.name);
        
        // Consider match if either contains the other after normalization
        return normalizedFieldValue.includes(normalizedFilterValue) || 
               normalizedFilterValue.includes(normalizedFieldValue);
      });
    });
    
    if (filtered.length === 0) {
      if (isCliMode) {
        mainSpinner.fail('No issues found matching provided filters.');
      } else {
        logger.warn('No issues found matching provided filters.', { source: 'summarize' });
      }
      return "No issues found matching provided filters.";
    }
    
    if (isCliMode) {
      mainSpinner.succeed(`Found ${filtered.length} issues matching the filters.`);
    } else {
      logger.info(`Found ${filtered.length} issues matching the filters.`, { 
        source: 'summarize', 
        count: filtered.length 
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
    
    for (const item of filtered) {
      counter++;
      
      if (isCliMode) {
        detailSpinner.text = `Fetching details for issue ${counter}/${filtered.length}`;
      } else {
        logger.info(`Fetching details for issue ${counter}/${filtered.length}`, { 
          source: 'summarize',
          progress: { current: counter, total: filtered.length }
        });
      }
      
      const issueDetails = await fetchIssueDetails(item);
      issuesWithDetails.push(issueDetails);
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