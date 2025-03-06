import { fetchPaginated } from '../lib/api.js';
import { LIST_FIELDS_QUERY } from '../lib/project.js';

export async function listFieldsCommand(options) {
  const first = 100; // Always use pagination limit 100
  try {
    const allFields = await fetchPaginated(
      LIST_FIELDS_QUERY,
      { projectId: options.id, first },
      result => result.node.fields
    );
    if (allFields.length === 0) {
      console.log(`No fields found in board with ID ${options.id}`);
    } else {
      console.log(`Fields in board [ID: ${options.id}]:`);
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
        console.log(fieldInfo);
      });
      console.log(`Fetched a total of ${allFields.length} field(s).`);
    }
  } catch (error) {
    console.error('Error fetching fields for board:', error.message);
  }
}
