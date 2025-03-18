import chalk from 'chalk';
import { fetchPaginated } from '../lib/api.js';
import {
  ROADMAP_BOARD_ID,
  LIST_FIELDS_QUERY
} from '../lib/project.js';

export async function listFieldsCommand(options) {
  const first = 100;
  try {
    const allFields = await fetchPaginated(
      LIST_FIELDS_QUERY,
      { projectId: ROADMAP_BOARD_ID, first },
      result => result.node.fields
    );
    if (allFields.length === 0) {
      console.log(chalk.yellow(`No fields found in board with ID ${ROADMAP_BOARD_ID}`));
    } else {
      console.log(chalk.cyan(`Fields in board [ID: ${ROADMAP_BOARD_ID}]:`));
      allFields.forEach(field => {
        let fieldInfo = `- [${field.id}] Type: ${field.__typename}, Name: ${field.name}, DataType: ${field.dataType}`;
        if (field.__typename === 'ProjectV2SingleSelectField' && field.options) {
          fieldInfo += `, Options: ${field.options.map(o => o.name).join(', ')}`;
        } else if (field.__typename === 'ProjectV2IterationField' && field.configuration) {
          fieldInfo += `, Duration: ${field.configuration.duration}, Start Day: ${field.configuration.startDay}`;
          if (field.configuration.iterations && field.configuration.iterations.length) {
            const iterations = field.configuration.iterations
              .map(iteration => `[${iteration.id}] ${iteration.title}`)
              .join(', ');
            fieldInfo += `, Iterations: ${iterations}`;
          }
        }
        console.log(chalk.green(fieldInfo));
      });
      console.log(chalk.blue(`Fetched a total of ${allFields.length} field(s).`));
    }
  } catch (error) {
    console.error(chalk.red('Error fetching fields for board:'), chalk.red(error.message));
  }
}
