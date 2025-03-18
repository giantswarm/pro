import OpenAI from 'openai';
import { graphQLWithAuth } from './api.js';
import { ISSUE_DETAIL_QUERY } from './project.js';

if (!process.env.OPENAI_API_KEY) {
  console.error('Error: OPENAI_API_KEY environment variable is not set.');
  process.exit(1);
}

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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const assistantId = "asst_5mbphHI9WYRAKzFqhtbJGqc9";

export async function getTeamSuggestionForIssue(item) {
  let title = item.content.title || '';
  let body = '';
  let author = '';
  let assignees = 'None';
  let comments = 'None';
  let teamSuggestion = '';
  
  try {
    const issueDetails = await graphQLWithAuth(ISSUE_DETAIL_QUERY, { id: item.id });
    if (issueDetails && issueDetails.node && issueDetails.node.content) {
      author = issueDetails.node.content.author.login || '';
      body = issueDetails.node.content.bodyText || '';
      if (issueDetails.node.content.assignees && issueDetails.node.content.assignees.nodes) {
        assignees = issueDetails.node.content.assignees.nodes.map(a => a.login).join(', ');
      }
      if (issueDetails.node.content.comments && issueDetails.node.content.comments.nodes) {
        comments = issueDetails.node.content.comments.nodes.map(c => c.bodyText).join('\n');
      }
    } else {
      console.error("Error: Issue details are incomplete.");
      return '';
    }
    
    let teamProjects = [];
    if (issueDetails.node.content.projectsV2 && issueDetails.node.content.projectsV2.nodes) {
      teamProjects = issueDetails.node.content.projectsV2.nodes.filter(project =>
        project.title.toLowerCase().includes('team')
      );
    }
    if (teamProjects.length === 1) {
      console.log(`Found team project: ${teamProjects[0].title}`);
      teamSuggestion = teamProjects[0].title.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\bteam\b/g, '').trim();
      return teamSuggestion;
    } else if (teamProjects.length > 1) {
      comments += '\n\nTeam projects: ' + teamProjects.map(p => p.title).join(', ');
    }
    if (comments.includes('#iamarobot')) {
      console.log("Issue already has a comment from the bot.");
      return 'skip';
    }
  } catch (err) {
    console.error("Error fetching issue details:", err.message);
    return '';
  }
  
  if (!title) {
    console.error("Error: Missing title for issue.");
    return '';
  }
  if (!body) {
    body = "TBD";
  }
  
  const prompt = `Determine the appropriate team for the following issue:
Title: ${title}
Content: ${body}
Author: ${author}
Comments: ${comments}
Assignees: ${assignees}

Reply with the team name that should handle this issue.
`;
 
  try {
    const thread = await openai.beta.threads.create({
      messages: [
        { role: 'user', content: prompt }
      ],
    });
    const threadId = thread.id;
    const run = await openai.beta.threads.runs.createAndPoll(threadId, {
      assistant_id: assistantId,
      additional_instructions: 'The format of the response is only the team name (e.g., "team/honeybadger"). If you dont know the team respond with "team/null".',
    });
    if (run.status === 'completed') {
      const messages = await openai.beta.threads.messages.list(threadId);
      const assistantResponse = messages.getPaginatedItems().find(msg => msg.role === 'assistant') || {};
      if (!assistantResponse.content) {
        console.warn("Warning: No assistant response found.");
        return '';
      }
      for (const content of assistantResponse.content) {
        if (content.type === "text" && content.text && content.text.value) {
          const filteredContent = content.text.value.replace(/【\d+:\d+†teams\.md】/g, '').trim();
          teamSuggestion += filteredContent;
        }
      }
      if (!teamSuggestion || !teamSuggestion.toLowerCase().startsWith('team/')) {
        console.warn("Warning: No team suggestion received.");
        return '';
      }
      console.log("Assistant response: " + teamSuggestion);
      return teamSuggestion.substring(5);
    } else {
      console.warn('Warning: Run finished with status: ' + run.status);
      return '';
    }
  } catch (error) {
    console.error('Error getting team suggestion from OpenAI:', error.message);
    return '';
  }
}
