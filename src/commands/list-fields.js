import { listFields } from '../lib/fields.js';

export async function listFieldsCommand() {
  await listFields();
}
