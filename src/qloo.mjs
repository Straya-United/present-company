// Qloo access through the event-supported route: the official @qloo/qloo-harness MCP server (`qloo mcp`),
// started once as a child process and called with the MCP SDK client. The key stays in QLOO_API_KEY on the server.
// QLOO_MOCK=1 swaps in a deterministic stand-in so the UI can be developed without a key (never used in production).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createRequire } from 'node:module';
import path from 'node:path';
import { mockCall } from './qloo-mock.mjs';

const require = createRequire(import.meta.url);
const MOCK = process.env.QLOO_MOCK === '1';
let clientPromise = null;

function harnessBin() {
  const pkg = require.resolve('@qloo/qloo-harness/package.json');
  return path.join(path.dirname(pkg), 'dist', 'bin.js');
}

async function connect() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [harnessBin(), 'mcp'],
    env: { ...process.env }, // forwards QLOO_API_KEY to the harness
    stderr: 'pipe',
  });
  const client = new Client({ name: 'present-company', version: '1.0.0' });
  transport.onclose = () => { clientPromise = null; };
  await client.connect(transport);
  return client;
}

function getClient() {
  if (!clientPromise) clientPromise = connect().catch((e) => { clientPromise = null; throw e; });
  return clientPromise;
}

/** Call one Qloo workflow tool. Returns the harness result envelope ({status, summary, results, ...}) plus timing. */
export async function qloo(tool, args, { timeoutMs = 30000 } = {}) {
  const started = Date.now();
  let envelope;
  if (MOCK) {
    envelope = await mockCall(tool, args);
  } else {
    const client = await getClient();
    const res = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: timeoutMs });
    const text = (res.content || []).find((c) => c.type === 'text')?.text || '{}';
    try { envelope = JSON.parse(text); } catch { envelope = { status: 'error', summary: text.slice(0, 300), results: [] }; }
  }
  return { ...envelope, _tool: tool, _args: args, _ms: Date.now() - started };
}

export async function qlooReady() {
  if (MOCK) return { ready: true, mock: true };
  try {
    const r = await qloo('qloo_capabilities', {});
    return { ready: true, mock: false, detail: r.execution_readiness || r.readiness || null };
  } catch (e) {
    return { ready: false, error: String(e.message || e) };
  }
}

/** Results come back as an array, or nested under results.entities / results.items depending on the workflow. */
export function entitiesOf(envelope) {
  const r = envelope?.results;
  if (Array.isArray(r)) return r;
  if (r && Array.isArray(r.entities)) return r.entities;
  if (r && Array.isArray(r.items)) return r.items;
  return [];
}

export const isMock = MOCK;
