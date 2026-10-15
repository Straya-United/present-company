// Qloo access through the event-supported route: the official @qloo/qloo-harness MCP server (`qloo mcp`),
// started once as a child process and called with the MCP SDK client. The key stays in QLOO_API_KEY on the server.
// QLOO_MOCK=1 swaps in a deterministic stand-in so the UI can be developed without a key (never used in production).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { mockCall } from './qloo-mock.mjs';

const require = createRequire(import.meta.url);
const MOCK = process.env.QLOO_MOCK === '1';
let clientPromise = null;

function harnessBin() {
  // The package's "exports" map hides package.json and has no require entry, so find it on disk instead:
  // walk up from this file to the nearest node_modules/@qloo/qloo-harness and use its bin.
  let dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  for (;;) {
    const pkgDir = path.join(dir, 'node_modules', '@qloo', 'qloo-harness');
    if (fs.existsSync(path.join(pkgDir, 'package.json'))) {
      const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
      const bin = typeof pkg.bin === 'string' ? pkg.bin : Object.values(pkg.bin || {})[0] || 'dist/bin.js';
      return path.join(pkgDir, bin);
    }
    if (path.dirname(dir) === dir) throw new Error('@qloo/qloo-harness is not installed');
    dir = path.dirname(dir);
  }
}

async function connect() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [harnessBin(), 'mcp'],
    // Forwards QLOO_API_KEY to the harness. Hackathon keys only work against the hackathon base URL,
    // and the harness needs that URL marked trusted because it isn't the production default.
    env: {
      ...process.env,
      QLOO_BASE_URL: process.env.QLOO_BASE_URL || 'https://hackathon.api.qloo.com',
      QLOO_TRUSTED_BASE_URL: process.env.QLOO_TRUSTED_BASE_URL || process.env.QLOO_BASE_URL || 'https://hackathon.api.qloo.com',
    },
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

/**
 * Call one Qloo workflow tool. When the harness answers needs_input because an input is ambiguous
 * (e.g. two shows called "Bluey", or "fishing" matching several tag types), pick the most popular
 * candidate it offered and ask once more. The choice is recorded in _autoResolved for the trace.
 */
export async function qloo(tool, args, opts = {}) {
  const first = await qlooOnce(tool, args, opts);
  if (first.status !== 'needs_input') return first;
  const issues = first.resolution?.issues || [];
  if (!issues.length) return first;
  const choices = [];
  const next = structuredClone(args);
  for (const issue of issues) {
    const best = [...(issue.candidates || [])].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))[0];
    choices.push({ field: issue.field, input: issue.input, chose: best ? { id: best.id, name: best.name, type: best.type } : null });
    // describe: the candidate is the answer; return it as an ok envelope without another round trip.
    if (tool === 'qloo_describe' && issue.field === 'entity') {
      if (!best) return first;
      return { ...first, status: 'ok', results: [{ entity_id: best.id, name: best.name, type: best.type, popularity: best.popularity, properties: {} }], _autoResolved: choices };
    }
    const field = issue.field;
    if (Array.isArray(next[field])) {
      next[field] = best ? next[field].map((v) => (v === issue.input ? best.id : v)) : next[field].filter((v) => v !== issue.input);
      if (!next[field].length) delete next[field];
    } else if (typeof next[field] === 'string') {
      if (!best) return first;
      next[field] = best.id;
    }
  }
  const second = await qlooOnce(tool, next, opts);
  return { ...second, _autoResolved: choices, _ms: first._ms + second._ms };
}

async function qlooOnce(tool, args, { timeoutMs = 30000 } = {}) {
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
  const list = Array.isArray(r) ? r : r && Array.isArray(r.entities) ? r.entities : r && Array.isArray(r.items) ? r.items : [];
  // Live results report type "urn:entity" with the real kind in subtype (urn:entity:brand etc.).
  return list.map((e) => (e && e.subtype && (!e.type || e.type === 'urn:entity') ? { ...e, type: e.subtype } : e));
}

export const isMock = MOCK;
