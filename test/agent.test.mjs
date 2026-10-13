// Runs the whole agent against the mock Qloo layer and mock model: checks grounding and privacy rules.
process.env.QLOO_MOCK = '1';
process.env.LLM_MOCK = '1';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { findGifts, composeIdeas, checkShortlist } = await import('../src/agent.mjs');

test('every gift idea is grounded in a Qloo result', async () => {
  const events = [];
  const s = await findGifts('My brother loves AC/DC, Bluey and fishing, lives in Mackay, about $100', (e) => events.push(e));
  const ids = new Set(s.candidates.map((c) => c.entity_id));
  assert.ok(s.result.ideas.length >= 3);
  for (const idea of s.result.ideas) assert.ok(ids.has(idea.entity_id), `idea ${idea.gift} cites a real candidate`);
  assert.ok(events.some((e) => e.step === 'qloo' && e.tool === 'qloo_recommend'));
});

test('loved things are resolved to IDs before recommending, and never returned as gifts', async () => {
  const events = [];
  const s = await findGifts('Loves AC/DC and Bluey', (e) => events.push(e));
  const rec = events.find((e) => e.tool === 'qloo_recommend');
  assert.ok(rec.args.signals.every((x) => x.startsWith('mock-')), 'signals are resolved entity IDs');
  const loved = new Set(s.loves.map((l) => l.id));
  assert.ok(s.candidates.every((c) => !loved.has(c.entity_id)));
});

test('a place search is skipped when no location is given', async () => {
  const events = [];
  await findGifts('Loves AC/DC and fishing', (e) => events.push(e));
  assert.ok(!events.some((e) => e.tool === 'qloo_recommend' && e.args.target_type === 'place'));
});

test('ideas citing unknown entities are dropped', async () => {
  const candidates = [{ entity_id: 'a', name: 'A', type: 'urn:entity:book', _because: [] }];
  const out = await composeIdeas({ brief: 'x', plan: { recipient: 'x', vibes: [], avoid: [] }, loves: [], candidates });
  assert.ok(out.ideas.every((i) => i.entity_id === 'a'));
});

test('shortlist check ranks with qloo_rank', async () => {
  const s = await findGifts('Loves AC/DC', () => {});
  const r = await checkShortlist(s, ['Stephen King', 'Lee Child'], 'book');
  assert.equal(r.ranked.length, 2);
  assert.ok(r.ranked[0].affinity >= r.ranked[1].affinity);
});
