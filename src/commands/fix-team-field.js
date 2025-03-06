import chalk from 'chalk';
import inquirer from 'inquirer';  // replaced readline with inquirer
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
      console.log(chalk.yellow('No team field found in this project.'));
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
    console.log(chalk.cyan(`Found ${itemsWithoutTeam.length} items without team field set.`));
    let updatedCount = 0;
    for (const item of itemsWithoutTeam) {
      if (!item.content || !item.content.labels || !item.content.labels.nodes) continue;
      const teamLabels = item.content.labels.nodes.filter(label =>
        label.name.toLowerCase().startsWith('team/')
      );
      let teamName = '';
      if (teamLabels.length === 1) {
        teamName = teamLabels[0].name.substring(5);
      } else {
        const issueLink = makeIssueLink(item.content.url, item.content.title);
        console.log(chalk.cyan(`Team suggestion for: ${issueLink}`));
        teamName = await getTeamSuggestionForIssue(item);
        if (teamName === 'skip') continue;
        if (teamName && teamName.toLowerCase() !== 'null') {
          const { accept } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'accept',
              message: `Accept "${teamName}"?`
            }
          ]);
          if (!accept) {
            teamName = '';
          }
        }
      }
      if (!teamName) {
        const { inputTeam } = await inquirer.prompt([
          { type: 'input', name: 'inputTeam', message: 'Team name (empty for none):' }
        ]);
        teamName = inputTeam.trim();
      }
      if (!teamName) {
        const { postComment } = await inquirer.prompt([
          { type: 'confirm', name: 'postComment', message: `No team provided for issue ${item.content.number}. Post a comment?` }
        ]);
        if (postComment) {
          graphQLWithAuth(POST_ISSUE_COMMENT_MUTATION, {
            issueId: item.content.id,
            body: "Could not determine the team for this issue. Please suggest a team."
          }).catch(() => {});
        }
        continue;
      }
      if (teamName === "honeybadger") teamName = "honey badger";
      if (teamName === "team") teamName = "up";
      const teamOption = teamField.options.find(option => {
        const optionNameLower = option.name.toLowerCase().replace(/[^\x00-\x7F]/g, '').trim();
        const teamNameLower = teamName.toLowerCase().trim();
        return optionNameLower.includes(teamNameLower) || teamNameLower.includes(optionNameLower);
      });
      if (!teamOption) {
        console.log(chalk.yellow(`Could not find matching team option for team "${teamName}"`));
        continue;
      }
      try {
        await graphQLWithAuth(UPDATE_ITEM_FIELD_MUTATION, {
          projectId: options.id,
          itemId: item.id,
          fieldId: teamField.id,
          value: { singleSelectOptionId: teamOption.id }
        });
        updatedCount++;
        console.log(chalk.green(`Updated team for issue ${item.content.number} to "${teamOption.name}"`));
      } catch (error) {
        console.error(chalk.red(`Error updating team for issue ${item.content.number}:`), chalk.red(error.message));
      }
    }
    console.log(chalk.blue(`Updated team field for ${updatedCount} issues.`));
  } catch (error) {
    console.error(chalk.red('Error fixing team fields:'), chalk.red(error.message));
  }
}
