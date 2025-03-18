import { listItems } from '../lib/items.js';

export async function listItemsCommand(options) {
  return await listItems(options);
}
