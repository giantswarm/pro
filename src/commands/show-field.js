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
      console.log(`Field with ID ${options.field} not found in project ${options.project}.`);
      return;
    }
    console.log(`Details for field [ID: ${field.id}]:`);
    console.log(`- Type: ${field.__typename}`);
    console.log(`- Name: ${field.name}`);
    console.log(`- DataType: ${field.dataType}`);
    if (field.__typename === 'ProjectV2SingleSelectField' && field.options) {
      console.log(`- Options:`);
      field.options.forEach(option => {
        console.log(`   - [${option.id}] ${option.name} (Color: ${option.color}, Description: ${option.description})`);
      });
    } else if (field.__typename === 'ProjectV2IterationField' && field.configuration) {
      console.log(`- Configuration:`);
      console.log(`   - Duration: ${field.configuration.duration}`);
      console.log(`   - Start Day: ${field.configuration.startDay}`);
      if (field.configuration.iterations) {
        console.log(`   - Iterations:`);
        field.configuration.iterations.forEach(iteration => {
          console.log(`      - [${iteration.id}] ${iteration.title} (Duration: ${iteration.duration}, Start: ${iteration.startDate})`);
        });
      }
    }
  } catch (error) {
    console.error('Error fetching field details:', error.message);
  }
}
