import chalk from 'chalk';
import { fetchPaginated } from '../lib/api.js';
import { SHOW_FIELD_QUERY } from '../lib/project.js';

export async function showFieldCommand(options) {
  const first = 100;
  try {
    const allFields = await fetchPaginated(
      SHOW_FIELD_QUERY,
      { projectId: options.project, first },
      result => result.node.fields
    );
    const field = allFields.find(f => f.id === options.field);
    if (!field) {
      console.log(chalk.yellow(`Field with ID ${options.field} not found in project ${options.project}.`));
      return;
    }
    console.log(chalk.cyan(`Details for field [ID: ${field.id}]:`));
    console.log(chalk.green(`- Type: ${field.__typename}`));
    console.log(chalk.green(`- Name: ${field.name}`));
    console.log(chalk.green(`- DataType: ${field.dataType}`));
    if (field.__typename === 'ProjectV2SingleSelectField' && field.options) {
      console.log(chalk.magenta(`- Options:`));
      field.options.forEach(option => {
        console.log(chalk.green(`   - [${option.id}] ${option.name} (Color: ${option.color}, Description: ${option.description})`));
      });
    } else if (field.__typename === 'ProjectV2IterationField' && field.configuration) {
      console.log(chalk.magenta(`- Configuration:`));
      console.log(chalk.green(`   - Duration: ${field.configuration.duration}`));
      console.log(chalk.green(`   - Start Day: ${field.configuration.startDay}`));
      if (field.configuration.iterations) {
        console.log(chalk.magenta(`   - Iterations:`));
        field.configuration.iterations.forEach(iteration => {
          console.log(chalk.green(`      - [${iteration.id}] ${iteration.title} (Duration: ${iteration.duration}, Start: ${iteration.startDate})`));
        });
      }
    }
  } catch (error) {
    console.error(chalk.red('Error fetching field details:'), chalk.red(error.message));
  }
}
