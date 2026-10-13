// Structured-output calls to the language model (OpenAI Responses API with a strict JSON schema).
// LLM_MOCK=1 returns canned plans/ideas for UI development without a key.
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-terra';

export async function llmJson({ system, user, name, schema, mock }) {
  if (process.env.LLM_MOCK === '1') return mock();
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      input: [{ role: 'system', content: system }, { role: 'user', content: user }],
      text: { format: { type: 'json_schema', name, schema, strict: true } },
    }),
    signal: AbortSignal.timeout(60000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`model error ${res.status}: ${body?.error?.message || 'unknown'}`);
  const text = body.output_text
    ?? (body.output || []).flatMap((o) => o.content || []).find((c) => c.type === 'output_text')?.text;
  if (!text) throw new Error('model returned no text');
  return JSON.parse(text);
}
