/**
 * The MCP server's icon (serverInfo.icons): the Giant Swarm logo.
 *
 * giantswarm.svg is a byte-identical copy of brand/giantswarm.svg in
 * https://github.com/giantswarm/mcp-toolkit (d3c53e0), the logo Giant Swarm's
 * Go MCP servers advertise; brand.GiantSwarmIcon() there builds the same icon.
 */

import { readFileSync } from 'node:fs';

const svg = readFileSync(new URL('./giantswarm.svg', import.meta.url));

export const serverIcon = {
  src: `data:image/svg+xml;base64,${svg.toString('base64')}`,
  mimeType: 'image/svg+xml',
  sizes: ['any']
};
