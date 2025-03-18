import chalk from 'chalk';
import { graphQLWithAuth, fetchPaginated } from '../lib/api.js';
import {
  LIST_ITEMS_QUERY,
  ISSUE_DETAIL_QUERY
} from '../lib/project.js';
import { makeIssueLink } from '../lib/utils.js';
import OpenAI from 'openai';

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

export async function summarizeIssuesCommand(options) {
  const first = 100;
  try {
    console.log(chalk.cyan("Fetching and filtering issues..."));
    
    // Build filter criteria based on provided options
    const filters = {};
    ['kind', 'status', 'function', 'sig', 'wg'].forEach(key => {
      if (options[key]) {
        filters[key === 'wg' ? 'working group' : key] = options[key].toLowerCase();
      }
    });
    if (options.team !== undefined && options.team !== false) {
      filters['team'] = options.team.toLowerCase();
    }
    
    // Fetch all items
    const allItems = await fetchPaginated(
      LIST_ITEMS_QUERY,
      { projectId: options.id, first },
      result => result.node.items
    );
    
    // Apply filters
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
      
      // Apply other filters
      return Object.entries(filters).every(([filterKey, filterValue]) => {
        const matchingField = item.fieldValues.nodes.find(node => {
          if (!node.field) return false;
          return node.field.name && node.field.name.toLowerCase() === filterKey;
        });
        if (!matchingField) return false;
        return matchingField.name.toLowerCase() === filterValue;
      });
    });
    
    if (filtered.length === 0) {
      console.log(chalk.yellow(`No issues found matching provided filters.`));
      return;
    }
    
    console.log(chalk.cyan(`Found ${filtered.length} issues matching the filters.`));
    console.log(chalk.cyan("Fetching detailed information for each issue..."));
    
    // Fetch detailed information for each issue
    const issuesWithDetails = [];
    let counter = 0;
    
    for (const item of filtered) {
      counter++;
      console.log(chalk.blue(`Fetching details for issue ${counter}/${filtered.length}`));
      const issueDetails = await fetchIssueDetails(item);
      issuesWithDetails.push(issueDetails);
    }
    
    console.log(chalk.cyan("Analyzing issues with AI..."));
    
    // Generate analysis
    const analysis = await analyzeIssues(issuesWithDetails);
    
    console.log("\n" + chalk.green("Issue Analysis:"));
    console.log(chalk.white("=".repeat(80)));
    console.log(analysis);
    console.log(chalk.white("=".repeat(80)));
    
  } catch (error) {
    console.error(chalk.red('Error summarizing issues:'), chalk.red(error.message));
  }
} 