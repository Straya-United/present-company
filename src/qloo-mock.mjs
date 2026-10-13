// Development stand-in for the Qloo harness, used only when QLOO_MOCK=1 (no key yet).
// Returns obviously placeholder entities in the same envelope shape the harness documents.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (t) => String(t).replace(/^urn:entity:/, '');

function fake(type, i, seed) {
  return {
    entity_id: `mock-${short(type)}-${seed}-${i}`,
    name: `[Mock ${short(type)}] ${seed} pick ${i + 1}`,
    type: `urn:entity:${short(type)}`,
    popularity: 0.9 - i * 0.05,
    affinity: 0.95 - i * 0.07,
    explainability: { 'signal.interests.entities': [{ entity_id: 'mock-signal', score: 0.8 - i * 0.05 }] },
    properties: { short_description: `Placeholder ${short(type)} returned by the mock Qloo layer.` },
  };
}

export async function mockCall(tool, args) {
  await wait(250 + Math.random() * 300);
  const base = { schema_version: '1.0-preview.1', operation: tool.replace(/^qloo_/, ''), execution: { transport: 'mcp', transport_name: 'mock', correlation_id: 'mock', duration_ms: 1 } };
  switch (tool) {
    case 'qloo_capabilities':
      return { ...base, status: 'ok', summary: 'mock ready' };
    case 'qloo_describe':
      return { ...base, status: 'ok', summary: `Resolved ${args.entity}`, results: [{ entity_id: `mock-${args.entity}`, name: args.entity, type: `urn:entity:${args.type || 'artist'}` }], result_count: 1 };
    case 'qloo_find_tags':
      return { ...base, status: 'ok', summary: `Tags for ${args.query}`, results: [{ id: `urn:tag:keyword:qloo:${args.query.replace(/\W+/g, '_')}`, name: args.query, type: 'urn:tag:keyword:qloo' }], result_count: 1 };
    case 'qloo_recommend': {
      const seed = (args.signals || args.signal_tags || ['taste']).join('+').slice(0, 24);
      const n = Math.min(args.limit || 10, 6);
      return { ...base, status: 'ok', summary: `Mock ${args.target_type} recommendations`, results: Array.from({ length: n }, (_, i) => fake(args.target_type, i, seed)), result_count: n };
    }
    case 'qloo_rank': {
      const results = args.options.map((o, i) => ({ entity_id: `mock-${o}`, name: o, type: `urn:entity:${args.option_type}`, affinity: Math.round((0.9 - i * 0.13 + Math.random() * 0.1) * 100) / 100 }));
      results.sort((a, b) => b.affinity - a.affinity);
      return { ...base, status: 'ok', summary: 'Mock ranking', results, result_count: results.length };
    }
    default:
      return { ...base, status: 'empty', summary: 'mock: not implemented', results: [], result_count: 0 };
  }
}
