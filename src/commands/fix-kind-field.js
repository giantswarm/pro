import { fixKindField } from '../lib/kind-field.js';

export async function fixKindFieldCommand(options) {
  await fixKindField(options, false);
} 