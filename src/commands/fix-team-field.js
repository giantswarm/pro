import rl from 'readline';
import { graphQLWithAuth, fetchPaginated } from '../lib/api.js';
import {
  LIST_ITEMS_WITH_LABELS_QUERY,
  LIST_FIELDS_QUERY,
  UPDATE_ITEM_FIELD_MUTATION,
  POST_ISSUE_COMMENT_MUTATION
} from '../lib/project.js';
import { makeIssueLink, getTeamSuggestionForIssue } from '../lib/utils.js';

export async function fixTeamFieldCommand(options) {
  const first = 100;
  try {
    const allItems = await fetchPaginated(
      LIST_ITEMS_WITH_LABELS_QUERY,
      { projectId: options.id, first },
      result => result.node.items
    );
    const allFields = await fetchPaginated(
      LIST_FIELDS_QUERY,
      { projectId: options.id, first },
      result => result.node.fields
    );
    // Find team field
    const teamField = allFields.find(field =>
      field.__typename === 'ProjectV2SingleSelectField' &&
      field.name.toLowerCase() === 'team'
    );
    if (!teamField) {
      console.log('No team field found in this project.');
      return;
    }
    // Filter items missing a team value
    const itemsWithoutTeam = allItems.filter(item => {
      if (!item.fieldValues || !item.fieldValues.nodes) return true;
      return !item.fieldValues.nodes.some(node =>
        node.field &&
        node.field.name &&
        node.field.name.toLowerCase() === 'team' &&
        typeof node.name === 'string' &&
        node.name.trim() !== ''
      );
    });
    console.log(`Found ${itemsWithoutTeam.length} items without team field set.`);
    let updatedCount = 0;
    const readlineInterface = rl.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    for (const item of itemsWithoutTeam) {
      // ...existing code: ensure item has labels...
      if (!item.content || !item.content.labels || !item.content.labels.nodes) continue;
      
      // Look for team labels (e.g., "team/honeybadger")
      const teamLabels = item.content.labels.nodes.filter(label =>
        label.name.toLowerCase().startsWith('team/')
      );
      let teamName = '';
      if (teamLabels.length === 1) {
        teamName = teamLabels[0].name.substring(5);
      } else {
        const issueLink = makeIssueLink(item.content.url, item.content.title);
        console.log(`Team suggestion for: ${issueLink}`);
        teamName = await getTeamSuggestionForIssue(item);
        if (teamName === 'skip') continue;
        if (teamName && teamName.toLowerCase() !== 'null') {
          await new Promise(resolve => {
            readlineInterface.question(`Accept "${teamName}"? (yes/no) `, answer => {
              if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
                teamName = '';
              }
              resolve();
            });
          });
        }
      }
      // Ask for manual input if no team obtained
      if (!teamName) {
        await new Promise(resolve => {
          readlineInterface.question(`Team name (empty for none): `, input => {
            teamName = input.trim();
            resolve();
          });
        });
      }
      // Ask for comment posting if still empty
      if (!teamName) {
        await new Promise(resolve => {
          readlineInterface.question(`No team provided for issue ${item.content.number}. Post a comment? (yes/no) `, answer => {
            if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
              graphQLWithAuth(POST_ISSUE_COMMENT_MUTATION, {
                issueId: item.content.id,
                body: "Could not determine the team for this issue. Please suggest a team."
              }).catch(() => {});
            }
            resolve();
          });
        });
        continue;
      }
      // Normalize known team names
      if (teamName === "honeybadger") teamName = "honey badger";
      if (teamName === "team") teamName = "up";
      
      // Find matching team option
      const teamOption = teamField.options.find(option => {
        const optionNameLower = option.name.toLowerCase().replace(/[^\x00-\x7F]/g, '').trim();
        const teamNameLower = teamName.toLowerCase().trim();
        return optionNameLower.includes(teamNameLower) || teamNameLower.includes(optionNameLower);
      });
      if (!teamOption) {
        console.log(`Could not find matching team option for team "${teamName}"`);
        continue;
      }
      // Update the team field for the item
      try {
        await graphQLWithAuth(UPDATE_ITEM_FIELD_MUTATION, {
          projectId: options.id,
          itemId: item.id,
          fieldId: teamField.id,
          value: { singleSelectOptionId: teamOption.id }
        });
        updatedCount++;
        console.log(`Updated team for issue ${item.content.number} to "${teamOption.name}"`);
      } catch (error) {
        console.error(`Error updating team for issue ${item.content.number}:`, error.message);
      }
    }
    readlineInterface.close();
    console.log(`Updated team field for ${updatedCount} issues.`);
  } catch (error) {
    console.error('Error fixing team fields:', error.message);
  }
}
