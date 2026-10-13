// The gift agent: plan → resolve tastes in Qloo → recommend across categories → compose gift ideas grounded in
// Qloo results. Every step is reported through `emit` so the UI can show the agent working, call by call.
import { llmJson } from './llm.mjs';
import { qloo, entitiesOf } from './qloo.mjs';
import { mockPlan, mockIdeas } from './llm-mock.mjs';

export const INSIGHT_TYPES = ['artist', 'book', 'brand', 'movie', 'person', 'place', 'podcast', 'tv_show', 'videogame'];
const SEARCH_TYPES = ['artist', 'book', 'brand', 'movie', 'person', 'place', 'podcast', 'tv_show', 'videogame', 'author', 'actor', 'album', 'director', 'locality'];
const GIFT_TARGETS = ['artist', 'book', 'brand', 'movie', 'place', 'podcast', 'tv_show', 'videogame'];
const KINDS = ['book', 'music', 'merch', 'game', 'experience', 'gear', 'clothing', 'home', 'screen', 'other'];

const nullable = (t) => ({ type: [t, 'null'] });

const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['recipient', 'loves', 'vibes', 'avoid', 'demographic', 'location', 'budget_min_aud', 'budget_max_aud', 'occasion', 'searches', 'clarify'],
  properties: {
    recipient: { type: 'string' },
    loves: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'type'], properties: { name: { type: 'string' }, type: { type: 'string', enum: SEARCH_TYPES } } } },
    vibes: { type: 'array', items: { type: 'string' } },
    avoid: { type: 'array', items: { type: 'string' } },
    demographic: nullable('string'),
    location: nullable('string'),
    budget_min_aud: nullable('number'),
    budget_max_aud: nullable('number'),
    occasion: nullable('string'),
    searches: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['target_type', 'reason'], properties: { target_type: { type: 'string', enum: GIFT_TARGETS }, reason: { type: 'string' } } } },
    clarify: nullable('string'),
  },
};

const PLAN_SYSTEM = `You plan gift searches for "Present Company", an app that finds gifts using Qloo's taste graph.
Read the user's description of the person they're buying for and return a search plan.
- recipient: a short generic label from the text ("your brother", "a coworker"). NEVER a personal name; drop names entirely.
- loves: named cultural things the person likes that Qloo can know: bands/artists, books, authors, films, TV shows, games, brands, podcasts, public figures, places. Use the canonical title (e.g. "AC/DC", "Bluey"). Max 8. Never include private people.
- vibes: hobbies, styles and moods that aren't named entities ("fishing", "camping", "cosy", "true crime"). Max 5, short phrases.
- avoid: anything they said to avoid.
- demographic: only if the text states an age group or gender in a way Qloo understands ("men 25-34", "teenage girls", "retirees"); else null. Don't guess.
- location: a city/region only if given (used to find local experiences); else null.
- budget_min_aud / budget_max_aud: in Australian dollars if given; else null.
- occasion: if given; else null.
- searches: 3 to 5 categories to search, chosen to suit this person, from: artist (music), book, brand, movie, tv_show, videogame, podcast, place (only if a location is given). Give a short reason for each.
- clarify: if there is nothing usable to search on, a single friendly question to ask; else null.`;

const IDEAS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['intro', 'ideas'],
  properties: {
    intro: { type: 'string' },
    ideas: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['entity_id', 'gift', 'kind', 'price_low_aud', 'price_high_aud', 'why', 'search_query', 'wildcard'],
        properties: {
          entity_id: { type: 'string' }, gift: { type: 'string' }, kind: { type: 'string', enum: KINDS },
          price_low_aud: { type: 'number' }, price_high_aud: { type: 'number' },
          why: { type: 'string' }, search_query: { type: 'string' }, wildcard: { type: 'boolean' },
        },
      },
    },
  },
};

const IDEAS_SYSTEM = `You turn Qloo taste-graph results into gift ideas. Qloo returned CANDIDATES: entities with high affinity for the person's tastes.
Rules:
- Every idea must be built on exactly one candidate and quote its entity_id exactly. Never invent entities.
- gift: a concrete thing to buy or book, tied to that entity. Book → the book. Artist → vinyl, a best-of, merch or tickets "if they're touring". Brand → a typical product from that brand. Film/TV → box set or merch. Game → the game. Place → a visit, meal or voucher there. Podcast → their book, merch or live show.
- price_low_aud / price_high_aud: a typical Australian retail range for that gift (an estimate; keep it honest and round).
- Respect the budget when one is given. Respect anything to avoid.
- why: one sentence linking the gift to what the person loves, in plain words (e.g. "Qloo finds a strong overlap between AC/DC fans and this author's readers"). No made-up statistics.
- search_query: what to type into a shop search to find it.
- 6 to 8 ideas, at least 3 different kinds, at most 2 per candidate type. Exactly one wildcard: the least obvious idea that still fits.
- intro: one warm sentence summing up the direction, addressed to the giver.
- Write in Australian English.`;

const short = (t) => String(t || '').replace(/^urn:entity:/, '');
const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s);
const imageOf = (e) => e?.properties?.image?.url || (typeof e?.properties?.image === 'string' ? e.properties.image : null) || null;

function traceOf(r) {
  return { tool: r._tool, args: r._args, status: r.status, ms: r._ms, count: r.result_count ?? entitiesOf(r).length, summary: clip(r.summary || '', 200), warnings: r.warnings || [] };
}

export async function planGifts(brief) {
  return llmJson({ system: PLAN_SYSTEM, user: brief, name: 'gift_plan', schema: PLAN_SCHEMA, mock: () => mockPlan(brief) });
}

/** Resolve each loved thing to a Qloo entity (describe), so recommendations use exact IDs and the UI can show what Qloo understood. */
async function resolveLoves(loves, emit) {
  const out = await Promise.all(loves.slice(0, 8).map(async (l) => {
    const r = await qloo('qloo_describe', { entity: l.name, type: l.type }).catch((e) => ({ status: 'error', summary: String(e.message), _tool: 'qloo_describe', _args: { entity: l.name, type: l.type }, _ms: 0 }));
    emit({ step: 'qloo', ...traceOf(r) });
    const e = entitiesOf(r)[0];
    if (r.status === 'ok' && e?.entity_id) return { input: l.name, type: l.type, id: e.entity_id, name: e.name || l.name, image: imageOf(e), ok: true };
    return { input: l.name, type: l.type, ok: false, status: r.status, candidates: entitiesOf(r).slice(0, 3).map((c) => c.name) };
  }));
  return out;
}

async function recommendOne(search, plan, signalIds, emit) {
  const args = { target_type: search.target_type, limit: 8, explain: true };
  if (signalIds.length) args.signals = signalIds.slice(0, 10);
  if (plan.vibes?.length) { args.signal_tags = plan.vibes.slice(0, 5); args.signal_tags_operator = 'union'; }
  if (plan.demographic) args.demographic = plan.demographic;
  if (search.target_type === 'place') {
    if (!plan.location) return { search, skipped: 'no location given' };
    args.filter_location = plan.location;
  }
  if (!args.signals && !args.signal_tags && !args.demographic) return { search, skipped: 'nothing to search on' };
  let r = await qloo('qloo_recommend', args);
  emit({ step: 'qloo', ...traceOf(r) });
  // A vague vibe can make the whole request ambiguous; retry once on the resolved entities alone.
  if ((r.status === 'needs_input' || r.status === 'error' || r.status === 'empty') && args.signal_tags && args.signals) {
    const { signal_tags, signal_tags_operator, ...rest } = args;
    r = await qloo('qloo_recommend', rest);
    emit({ step: 'qloo', ...traceOf(r), retry: true });
  }
  return { search, envelope: r, entities: entitiesOf(r) };
}

function explainNames(entity, loves) {
  // explainability lists which input signals drove the affinity; map IDs back to the names the user gave.
  const ex = entity.explainability;
  if (!ex || typeof ex !== 'object') return [];
  const ids = new Map(loves.filter((l) => l.ok).map((l) => [l.id, l.name]));
  const names = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') {
      const id = v.entity_id || v.id;
      if (id && ids.has(id)) names.add(ids.get(id));
      Object.values(v).forEach(walk);
    }
  };
  walk(ex);
  return [...names];
}

export async function composeIdeas({ brief, plan, loves, candidates, tweak }) {
  const compact = candidates.map((c) => ({
    entity_id: c.entity_id, name: c.name, type: short(c.type),
    about: clip(c.properties?.short_description || c.properties?.description || '', 160),
    affinity: typeof c.affinity === 'number' ? Math.round(c.affinity * 100) / 100 : null,
    linked_to: c._because,
  }));
  const user = JSON.stringify({
    description: brief,
    recipient: plan.recipient, occasion: plan.occasion, budget_aud: [plan.budget_min_aud, plan.budget_max_aud], avoid: plan.avoid,
    loves: loves.filter((l) => l.ok).map((l) => l.name), vibes: plan.vibes,
    ...(tweak ? { change_request: tweak } : {}),
    candidates: compact,
  });
  const out = await llmJson({ system: IDEAS_SYSTEM, user, name: 'gift_ideas', schema: IDEAS_SCHEMA, mock: () => mockIdeas(compact) });
  const byId = new Map(candidates.map((c) => [c.entity_id, c]));
  const seen = new Set();
  const ideas = out.ideas.filter((i) => byId.has(i.entity_id) && !seen.has(i.entity_id) && seen.add(i.entity_id)).map((i) => {
    const e = byId.get(i.entity_id);
    return {
      ...i,
      price_low_aud: Math.round(i.price_low_aud), price_high_aud: Math.round(i.price_high_aud),
      qloo: { name: e.name, type: short(e.type), image: imageOf(e), affinity: e.affinity ?? null, popularity: e.popularity ?? null, because: e._because || [], about: clip(e.properties?.short_description || e.properties?.description || '', 220) },
    };
  });
  return { intro: out.intro, ideas, dropped: out.ideas.length - ideas.length };
}

/** Full run. Returns a session object the server keeps for refinements and shortlist checks. */
export async function findGifts(brief, emit = () => {}) {
  emit({ step: 'thinking', text: 'Reading your description' });
  const plan = await planGifts(brief);
  emit({ step: 'plan', plan });
  if (plan.clarify && !plan.loves.length && !plan.vibes.length) return { plan, loves: [], candidates: [], result: { intro: plan.clarify, ideas: [], clarify: true } };

  emit({ step: 'thinking', text: 'Looking up their favourites in Qloo' });
  const loves = await resolveLoves(plan.loves, emit);
  emit({ step: 'resolved', loves });
  const signalIds = loves.filter((l) => l.ok).map((l) => l.id);

  const searches = (plan.searches.length ? plan.searches : [{ target_type: 'book', reason: 'default' }, { target_type: 'brand', reason: 'default' }, { target_type: 'artist', reason: 'default' }]).slice(0, 5);
  const WORDS = { artist: 'music', book: 'books', brand: 'brands', movie: 'films', tv_show: 'TV', videogame: 'games', podcast: 'podcasts', place: 'local places' };
  emit({ step: 'thinking', text: `Asking Qloo what fans of these tastes also love: ${searches.map((s) => WORDS[s.target_type] || s.target_type).join(', ')}` });
  const settled = await Promise.allSettled(searches.map((s) => recommendOne(s, plan, signalIds, emit)));
  const lovedIds = new Set(signalIds);
  const candidates = [];
  const seen = new Set();
  for (const s of settled) {
    if (s.status !== 'fulfilled' || !s.value.entities) continue;
    for (const e of s.value.entities) {
      if (!e?.entity_id || seen.has(e.entity_id) || lovedIds.has(e.entity_id)) continue;
      seen.add(e.entity_id);
      candidates.push({ ...e, _because: explainNames(e, loves) });
    }
  }
  emit({ step: 'candidates', count: candidates.length, byType: Object.fromEntries(settled.filter((s) => s.status === 'fulfilled').map((s) => [s.value.search.target_type, s.value.skipped ? `skipped: ${s.value.skipped}` : (s.value.entities || []).length])) });
  if (!candidates.length) return { plan, loves, candidates, result: { intro: "Qloo couldn't find strong matches for that description. Try naming a few specific favourites, like bands, shows, books or brands.", ideas: [], clarify: true } };

  emit({ step: 'thinking', text: 'Turning Qloo’s matches into gift ideas' });
  const result = await composeIdeas({ brief, plan, loves, candidates });
  emit({ step: 'ideas', ...result });
  return { plan, loves, candidates, result };
}

/** "Check my ideas": rank the giver's own shortlist against the person's resolved tastes with qloo_rank. */
export async function checkShortlist(session, options, optionType, emit = () => {}) {
  const signals = session.loves.filter((l) => l.ok).map((l) => l.id);
  const args = { options: options.slice(0, 10), option_type: optionType };
  if (signals.length) args.signals = signals;
  if (session.plan.demographic) args.demographic = session.plan.demographic;
  const r = await qloo('qloo_rank', args);
  emit({ step: 'qloo', ...traceOf(r) });
  const ranked = entitiesOf(r).map((e) => ({ name: e.name, input: e.input || null, affinity: e.affinity ?? null, image: imageOf(e), type: short(e.type) }));
  return { status: r.status, summary: r.summary, ranked, interpretation: r.interpretation || null };
}
