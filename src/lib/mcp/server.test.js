import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createMCPServer } from './server.js';

describe('initialize', () => {
  it('advertises the Giant Swarm logo as the server icon', async () => {
    const server = createMCPServer();
    const client = new Client({ name: 'test', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const svg = readFileSync(new URL('./giantswarm.svg', import.meta.url));
    assert.deepEqual(client.getServerVersion().icons, [{
      src: `data:image/svg+xml;base64,${svg.toString('base64')}`,
      mimeType: 'image/svg+xml',
      sizes: ['any']
    }]);
    assert.ok(svg.toString().startsWith('<svg'), 'giantswarm.svg is the SVG markup');
    await client.close();
  });
});
