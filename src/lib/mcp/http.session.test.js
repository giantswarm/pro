import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';

// ---------------------------------------------------------------------------
// Session lifecycle on the Streamable HTTP transport (no auth).
//
// The MCP spec requires 404 for a request carrying a session id the server
// does not know (never issued, closed or evicted): that status is what tells
// a client such as muster to drop the id and initialize a new session.
// ---------------------------------------------------------------------------

const SESSION_TTL_MS = 100;

let httpServer;
let mcpUrl;

before(async () => {
  delete process.env.GITHUB_OAUTH_CLIENT_ID;
  delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
  delete process.env.OAUTH_BEARER_ONLY;
  const { startHTTPServer } = await import('./http.js');
  httpServer = await startHTTPServer({ port: 0, sessionTtlMs: SESSION_TTL_MS, sessionSweepIntervalMs: 25 });
  mcpUrl = `http://localhost:${httpServer.address().port}/mcp`;
});

after(() => {
  httpServer?.close();
});

function post(body, sessionId) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream'
  };
  if (sessionId) {
    headers['mcp-session-id'] = sessionId;
    headers['mcp-protocol-version'] = '2025-06-18';
  }
  return fetch(mcpUrl, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function initialize() {
  const res = await post({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'session-test', version: '0.0.0' }
    }
  });
  assert.strictEqual(res.status, 200);
  await res.text();
  const sessionId = res.headers.get('mcp-session-id');
  assert.ok(sessionId, 'initialize returns a session id');
  const ack = await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId);
  assert.strictEqual(ack.status, 202);
  return sessionId;
}

const listTools = (sessionId) => post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, sessionId);

async function assertSessionNotFound(res) {
  assert.strictEqual(res.status, 404);
  const body = await res.json();
  assert.strictEqual(body.error.code, -32001);
  assert.match(body.error.message, /Session not found/);
}

describe('MCP session lifecycle', () => {
  it('answers a session id it never issued with 404', async () => {
    await assertSessionNotFound(await listTools('00000000-0000-0000-0000-000000000000'));
  });

  it('serves a live session', async () => {
    const sessionId = await initialize();
    const res = await listTools(sessionId);
    assert.strictEqual(res.status, 200);
    assert.match(await res.text(), /list_issues/);
  });

  it('answers an evicted session with 404, and a new initialize recovers', async () => {
    const stale = await initialize();
    await sleep(SESSION_TTL_MS * 3);
    await assertSessionNotFound(await listTools(stale));

    const fresh = await initialize();
    assert.notStrictEqual(fresh, stale);
    const res = await listTools(fresh);
    assert.strictEqual(res.status, 200);
  });

  it('still answers 400 when no session id is sent and the request is not an initialize', async () => {
    const res = await listTools();
    assert.strictEqual(res.status, 400);
  });
});
