// Runs the agent on sample briefs with the real model (and real Qloo once QLOO_API_KEY is set; else the mock).
// Loads keys from the local secrets folder without printing them.
// Usage: node scripts/live-check.mjs [--mock-qloo] ["custom brief"]
import fs from 'node:fs';
const SECRETS = 'D:/GameDevelopment/.secrets';
for (const f of ['etsy-factory.env', 'qloo.env']) {
  const p = `${SECRETS}/${f}`;
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(OPENAI_API_KEY|QLOO_API_KEY)\s*=\s*"?([^"\s]+)"?/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const args = process.argv.slice(2);
if (args.includes('--mock-qloo') || !process.env.QLOO_API_KEY) process.env.QLOO_MOCK = '1';
const { findGifts, checkShortlist } = await import('../src/agent.mjs');
console.log(`model: ${process.env.OPENAI_MODEL || 'gpt-5.6-terra'} | qloo: ${process.env.QLOO_MOCK === '1' ? 'MOCK' : 'LIVE'}`);
const briefs = args.filter((a) => !a.startsWith('--'));
const list = briefs.length ? briefs : [
  'My brother, 30s. Loves AC/DC, Bluey with his kids, and fishing off the rock wall. Lives in Mackay. About $80 for his birthday.',
  "My mum loves Agatha Christie, The Great British Bake Off and gardening. Around $60 for Mother's Day.",
  'A teenage nephew into Minecraft, Taylor Swift and skateboarding. Under $50 for Christmas.',
];
for (const brief of list) {
  const t0 = Date.now();
  const s = await findGifts(brief, (e) => { if (e.step === 'qloo') console.log(`   · ${e.tool} ${e.status} ${e.count} (${e.ms}ms) ${JSON.stringify(e.args).slice(0, 140)}`); });
  console.log(`\n== ${brief}\n   plan: ${JSON.stringify({ r: s.plan.recipient, loves: s.plan.loves, vibes: s.plan.vibes, loc: s.plan.location, budget: [s.plan.budget_min_aud, s.plan.budget_max_aud], searches: s.plan.searches.map((x) => x.target_type) })}`);
  console.log(`   intro: ${s.result.intro}`);
  for (const i of s.result.ideas) console.log(`   - ${i.wildcard ? '[wild] ' : ''}${i.gift} (${i.kind}, $${i.price_low_aud}-${i.price_high_aud}) ← ${i.qloo.name} [${i.qloo.type}, aff ${i.qloo.affinity}] :: ${i.why}`);
  console.log(`   dropped ${s.result.dropped || 0} | ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (process.env.QLOO_MOCK !== '1' && s.result.ideas.length) {
    const r = await checkShortlist(s, ['Stephen King', 'Lee Child', 'Richard Osman'], 'book');
    console.log(`   rank: ${r.status} ${r.ranked.map((x) => `${x.name}=${x.affinity}`).join(', ')}`);
  }
}
process.exit(0);
