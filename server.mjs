// Present Company — web server. Serves the app and a small JSON API; Qloo is reached only from here.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { findGifts, composeIdeas, checkShortlist, INSIGHT_TYPES } from './src/agent.mjs';
import { qlooReady, isMock } from './src/qloo.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8790);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

// Sessions keep the plan and Qloo candidates so "refine" and "check my ideas" don't repeat the searches.
const sessions = new Map();
const SESSION_TTL = 2 * 60 * 60 * 1000;
function saveSession(s) {
  const id = randomUUID();
  sessions.set(id, { ...s, at: Date.now() });
  if (sessions.size > 500) sessions.delete(sessions.keys().next().value);
  return id;
}
function getSession(id) {
  const s = sessions.get(id);
  if (!s || Date.now() - s.at > SESSION_TTL) { sessions.delete(id); return null; }
  return s;
}

// Gentle per-IP limit to protect the shared Qloo event quota.
const hits = new Map();
function allow(ip, max = 30, windowMs = 60 * 60 * 1000) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) return false;
  list.push(now); hits.set(ip, list); return true;
}

async function body(req, limit = 8000) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw Object.assign(new Error('too large'), { code: 413 }); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw Object.assign(new Error('bad json'), { code: 400 }); }
}
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
const ipOf = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'local';
const publicError = (e) => /QLOO_AUTH|401|403/.test(String(e.message)) ? 'Qloo access problem on the server.' : /rate|429/i.test(String(e.message)) ? 'Busy right now, please try again in a minute.' : 'Something went wrong. Please try again.';

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) return json(res, 403, { error: 'forbidden' });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': p === '/index.html' ? 'no-cache' : 'public, max-age=300' });
    res.end(data);
  } catch { json(res, 404, { error: 'not found' }); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, mock: isMock || process.env.LLM_MOCK === '1', qloo: await qlooReady() });

    if (req.method === 'POST' && url.pathname === '/api/find') {
      if (!allow(ipOf(req))) return json(res, 429, { error: 'Too many searches from here this hour. Please try again later.' });
      const { brief } = await body(req);
      const text = String(brief || '').trim().slice(0, 1200);
      if (text.length < 8) return json(res, 400, { error: 'Tell me a little about the person first.' });
      res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
      const emit = (ev) => res.write(JSON.stringify(ev) + '\n');
      try {
        const s = await findGifts(text, emit);
        const id = saveSession({ brief: text, ...s });
        emit({ step: 'done', session_id: id, result: s.result });
      } catch (e) {
        console.error('find failed', e);
        emit({ step: 'error', error: publicError(e) });
      }
      return res.end();
    }

    if (req.method === 'POST' && url.pathname === '/api/refine') {
      const { session_id, tweak } = await body(req);
      const s = getSession(session_id);
      if (!s) return json(res, 410, { error: 'That search has expired. Please run it again.' });
      if (!allow(ipOf(req), 60)) return json(res, 429, { error: 'Too many requests. Please try again later.' });
      const result = await composeIdeas({ brief: s.brief, plan: s.plan, loves: s.loves, candidates: s.candidates, tweak: String(tweak || '').slice(0, 200) });
      s.result = result;
      return json(res, 200, { result });
    }

    if (req.method === 'POST' && url.pathname === '/api/check') {
      const { session_id, options, option_type } = await body(req);
      const s = getSession(session_id);
      if (!s) return json(res, 410, { error: 'That search has expired. Please run it again.' });
      if (!INSIGHT_TYPES.includes(option_type)) return json(res, 400, { error: 'Pick what kind of things these are.' });
      const opts = (Array.isArray(options) ? options : []).map((o) => String(o).trim()).filter(Boolean).slice(0, 10);
      if (opts.length < 2) return json(res, 400, { error: 'Add at least two ideas to compare.' });
      if (!allow(ipOf(req), 60)) return json(res, 429, { error: 'Too many requests. Please try again later.' });
      const trace = [];
      const out = await checkShortlist(s, opts, option_type, (ev) => trace.push(ev));
      return json(res, 200, { ...out, trace });
    }

    if (req.method === 'GET') return serveStatic(req, res);
    json(res, 405, { error: 'method not allowed' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, e.code === 413 ? 413 : e.code === 400 ? 400 : 500, { error: e.code ? e.message : publicError(e) });
    else res.end();
  }
});

server.listen(PORT, () => console.log(`Present Company on http://localhost:${PORT}${isMock ? ' (Qloo mock)' : ''}${process.env.LLM_MOCK === '1' ? ' (LLM mock)' : ''}`));
