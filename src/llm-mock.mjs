// Canned model output for LLM_MOCK=1 (UI development only).
export function mockPlan(brief) {
  const location = /mackay/i.test(brief) ? 'Mackay, Queensland' : null;
  return {
    recipient: 'your brother',
    loves: [{ name: 'AC/DC', type: 'artist' }, { name: 'Bluey', type: 'tv_show' }],
    vibes: ['fishing'],
    avoid: [],
    demographic: null,
    location,
    budget_min_aud: null,
    budget_max_aud: 100,
    occasion: 'birthday',
    searches: [
      { target_type: 'artist', reason: 'music fan' },
      { target_type: 'book', reason: 'downtime' },
      { target_type: 'brand', reason: 'gear for fishing' },
      ...(location ? [{ target_type: 'place', reason: 'a local experience' }] : []),
    ],
    clarify: null,
  };
}

export function mockIdeas(candidates) {
  const kinds = { artist: 'music', book: 'book', brand: 'gear', place: 'experience', movie: 'screen', tv_show: 'screen', videogame: 'game', podcast: 'merch' };
  const picks = [];
  const perType = {};
  for (const c of candidates) {
    if ((perType[c.type] = (perType[c.type] || 0) + 1) > 2) continue;
    picks.push(c);
    if (picks.length === 7) break;
  }
  return {
    intro: 'A mix of music, reading and gear that leans into what he already loves.',
    ideas: picks.map((c, i) => ({
      entity_id: c.entity_id, gift: `Something from ${c.name}`, kind: kinds[c.type] || 'other',
      price_low_aud: 30 + i * 5, price_high_aud: 60 + i * 5, why: `Placeholder reason linking ${c.name} to their tastes.`,
      search_query: c.name, wildcard: i === picks.length - 1,
    })),
  };
}
