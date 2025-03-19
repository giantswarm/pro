import { fixFunctionField } from '../lib/function-field.js';

export async function fixFunctionFieldCommand(options) {
  await fixFunctionField(options, false);
} 