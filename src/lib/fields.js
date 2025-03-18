import chalk from 'chalk';
import { fetchPaginated } from './api.js';
import {
  ROADMAP_BOARD_ID,
  LIST_FIELDS_QUERY,
  SHOW_FIELD_QUERY
} from './project.js';

/**
 * List all fields in the roadmap board
 * @returns {Promise<Array>} - Array of field objects
 */
export async function listFields() {
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
    
    return allFields;
  } catch (error) {
    console.error(chalk.red('Error fetching fields for board:'), chalk.red(error.message));
    throw error;
  }
}

/**
 * Show details of a specific field
 * @param {Object} options - Options containing the field ID
 * @returns {Promise<Object>} - Field details
 */
export async function showField(options) {
  const first = 100;
  try {
    const allFields = await fetchPaginated(
      SHOW_FIELD_QUERY,
      { projectId: ROADMAP_BOARD_ID, first },
      result => result.node.fields
    );
    
    const field = allFields.find(f => f.id === options.field);
    if (!field) {
      console.log(chalk.yellow(`Field with ID ${options.field} not found in project ${ROADMAP_BOARD_ID}.`));
      return null;
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
    
    return field;
  } catch (error) {
    console.error(chalk.red('Error fetching field details:'), chalk.red(error.message));
    throw error;
  }
} 