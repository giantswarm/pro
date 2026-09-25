import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GITHUB_API_TOKEN ??= 'test-token';

test('the MCP server module loads', async () => {
  await import('./lib/mcp/server.js');
});

test('the library entry point exports listItems', async () => {
  const lib = await import('./index.js');
  assert.equal(typeof lib.listItems, 'function');
});
