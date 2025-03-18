import { fixTeamField } from '../lib/team-field.js';

export async function fixTeamFieldCommand(options = {}) {
  await fixTeamField(options);
}
