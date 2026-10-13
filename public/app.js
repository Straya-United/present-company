const $ = (s) => document.querySelector(s);
const form = $('#askForm'), brief = $('#brief'), go = $('#go');
const work = $('#work'), steps = $('#steps'), trace = $('#trace'), traceToggle = $('#traceToggle');
const results = $('#results'), understood = $('#understood'), intro = $('#intro'), tags = $('#tags');
const check = $('#check'), ranked = $('#ranked');
let sessionId = null;

const TYPE_WORDS = { artist: 'musician', book: 'book', brand: 'brand', movie: 'film', tv_show: 'TV show', videogame: 'video game', podcast: 'podcast', place: 'place', person: 'person', author: 'author', actor: 'actor', album: 'album', director: 'director', locality: 'place' };
const KIND_WORDS = { book: 'A book', music: 'Music', merch: 'Merch', game: 'A game', experience: 'An experience', gear: 'Gear', clothing: 'Something to wear', home: 'For the home', screen: 'To watch', other: 'A gift' };
const TOOL_WORDS = { qloo_describe: 'Looked up', qloo_recommend: 'Recommended', qloo_rank: 'Ranked', qloo_find_tags: 'Found tags' };
const aud = (n) => '$' + Math.round(n).toLocaleString('en-AU');

document.querySelectorAll('.ex').forEach((b) => b.addEventListener('click', () => { brief.value = b.dataset.brief; brief.focus(); }));
traceToggle.addEventListener('click', () => {
  const open = trace.hidden; trace.hidden = !open;
  traceToggle.setAttribute('aria-expanded', String(open));
  traceToggle.textContent = open ? 'Hide Qloo calls' : 'Show Qloo calls';
});

function step(text, state = 'active') {
  steps.querySelectorAll('li.active').forEach((li) => { li.classList.remove('active'); li.classList.add('done'); });
  const li = document.createElement('li'); li.textContent = text; li.className = state; steps.append(li); return li;
}
function finishSteps() { steps.querySelectorAll('li.active').forEach((li) => { li.classList.remove('active'); li.classList.add('done'); }); }

function addTrace(ev) {
  const d = document.createElement('div');
  const head = document.createElement('p'); head.style.margin = '0';
  const b = document.createElement('b'); b.textContent = ev.tool;
  head.append(b, ` ${ev.status}${ev.retry ? ' (retry without vibes)' : ''}, ${ev.count ?? 0} results, ${ev.ms} ms`);
  const c = document.createElement('code'); c.textContent = JSON.stringify(ev.args);
  d.append(head, c);
  if (ev.summary) { const s = document.createElement('p'); s.style.margin = '2px 0 0'; s.style.color = 'var(--muted)'; s.textContent = ev.summary; d.append(s); }
  trace.append(d);
}

function renderUnderstood(loves, plan) {
  understood.replaceChildren();
  const lead = document.createElement('span'); lead.textContent = 'Qloo matched:'; understood.append(lead);
  for (const l of loves) {
    const s = document.createElement('span');
    if (l.ok) {
      s.className = 'q';
      if (l.image) { const i = document.createElement('img'); i.src = l.image; i.alt = ''; i.referrerPolicy = 'no-referrer'; s.append(i); } else { const dot = document.createElement('span'); dot.className = 'dot'; s.append(dot); }
      s.append(`${l.name} (${TYPE_WORDS[l.type] || l.type})`);
    } else { s.className = 'q miss'; s.textContent = `${l.input}: not found`; }
    understood.append(s);
  }
  for (const v of plan.vibes || []) { const s = document.createElement('span'); s.className = 'q'; const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = 'var(--kraft-edge)'; s.append(dot, v); understood.append(s); }
}

function renderIdeas(result) {
  intro.textContent = result.intro || '';
  tags.replaceChildren();
  const tpl = $('#tagTpl');
  (result.ideas || []).forEach((idea, i) => {
    const el = tpl.content.firstElementChild.cloneNode(true);
    if (idea.wildcard) el.classList.add('wild');
    el.classList.add('reveal'); el.style.animationDelay = `${i * 70}ms`;
    const pic = el.querySelector('.pic');
    const noPic = () => { pic.remove(); el.querySelector('.tag-top').classList.add('nopic'); };
    if (idea.qloo.image) pic.src = idea.qloo.image; else noPic();
    pic.addEventListener('error', noPic);
    el.querySelector('.kind').textContent = KIND_WORDS[idea.kind] || 'A gift';
    el.querySelector('.gift').textContent = idea.gift;
    el.querySelector('.price').textContent = idea.price_low_aud === idea.price_high_aud ? `about ${aud(idea.price_low_aud)}` : `about ${aud(idea.price_low_aud)}–${aud(idea.price_high_aud)}`;
    el.querySelector('.why').textContent = idea.why;
    const m = el.querySelector('.match'); const strong = document.createElement('strong'); strong.textContent = 'Qloo match: ';
    m.append(strong, `${idea.qloo.name} (${TYPE_WORDS[idea.qloo.type] || idea.qloo.type})`);
    const aff = typeof idea.qloo.affinity === 'number' ? Math.max(0, Math.min(1, idea.qloo.affinity)) : null;
    const meter = el.querySelector('.meter');
    if (aff === null) meter.remove(); else { meter.setAttribute('aria-label', `Taste affinity ${Math.round(aff * 100)} out of 100`); requestAnimationFrame(() => { meter.firstElementChild.style.width = `${Math.round(aff * 100)}%`; }); }
    el.querySelector('.because').textContent = idea.qloo.because?.length ? `Linked to ${idea.qloo.because.join(' and ')}` : (aff !== null ? `Affinity ${Math.round(aff * 100)}/100 for their tastes` : '');
    const a = el.querySelector('.find'); a.href = `https://www.google.com.au/search?tbm=shop&q=${encodeURIComponent(idea.search_query)}`;
    a.setAttribute('aria-label', `Find ${idea.gift} in shops`);
    tags.append(el);
  });
}

async function readStream(res, onEvent) {
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) onEvent(JSON.parse(line)); }
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = brief.value.trim(); if (text.length < 8) { brief.focus(); return; }
  go.disabled = true; go.textContent = 'Finding ideas…';
  steps.replaceChildren(); trace.replaceChildren(); work.hidden = false; results.hidden = true; check.hidden = true; ranked.replaceChildren();
  work.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  try {
    const res = await fetch('/api/find', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brief: text }) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'That didn’t work. Please try again.'); }
    let plan = null;
    await readStream(res, (ev) => {
      if (ev.step === 'thinking') step(ev.text);
      else if (ev.step === 'plan') { plan = ev.plan; step(`Searching for ${ev.plan.recipient}: ${ev.plan.searches.map((s) => TYPE_WORDS[s.target_type] + 's').join(', ')}`, 'done'); }
      else if (ev.step === 'qloo') addTrace(ev);
      else if (ev.step === 'resolved') renderUnderstood(ev.loves, plan || {});
      else if (ev.step === 'candidates') step(`Qloo returned ${ev.count} taste matches`, 'done');
      else if (ev.step === 'done') {
        finishSteps(); sessionId = ev.session_id;
        renderIdeas(ev.result); results.hidden = false;
        if ((ev.result.ideas || []).length) check.hidden = false;
        $('#refine').hidden = !(ev.result.ideas || []).length;
        $('#results').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      } else if (ev.step === 'error') throw new Error(ev.error);
    });
  } catch (err) {
    finishSteps(); const li = step(err.message, 'done'); li.classList.add('err');
  } finally { go.disabled = false; go.textContent = 'Find gift ideas'; }
});

async function refine(tweak) {
  if (!sessionId) return;
  document.querySelectorAll('#refine button').forEach((b) => (b.disabled = true));
  intro.textContent = 'Reworking the list…';
  try {
    const res = await fetch('/api/refine', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session_id: sessionId, tweak }) });
    const j = await res.json(); if (!res.ok) throw new Error(j.error);
    renderIdeas(j.result);
  } catch (err) { intro.textContent = err.message || 'That didn’t work. Please try again.'; }
  finally { document.querySelectorAll('#refine button').forEach((b) => (b.disabled = false)); }
}
document.querySelectorAll('#refine .chip[data-tweak]').forEach((b) => b.addEventListener('click', () => refine(b.dataset.tweak)));
$('#tweakForm').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#tweak').value.trim(); if (v) refine(v); });

$('#checkForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const options = $('#opts').value.split('\n').map((s) => s.trim()).filter(Boolean);
  ranked.replaceChildren();
  const btn = e.submitter; btn.disabled = true; btn.textContent = 'Ranking…';
  try {
    const res = await fetch('/api/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session_id: sessionId, options, option_type: $('#optType').value }) });
    const j = await res.json(); if (!res.ok) throw new Error(j.error);
    (j.trace || []).forEach(addTrace);
    if (!j.ranked.length) throw new Error(j.summary || 'Qloo couldn’t match those. Check the spelling, or try fewer.');
    j.ranked.forEach((r, i) => {
      const li = document.createElement('li');
      const n = document.createElement('span'); n.className = 'n'; n.textContent = i + 1;
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = r.name;
      const meter = document.createElement('div'); meter.className = 'meter'; const bar = document.createElement('span'); meter.append(bar);
      const aff = typeof r.affinity === 'number' ? Math.max(0, Math.min(1, r.affinity)) : 0;
      meter.setAttribute('role', 'img'); meter.setAttribute('aria-label', `Taste affinity ${Math.round(aff * 100)} out of 100`);
      li.append(n, nm, meter); ranked.append(li);
      requestAnimationFrame(() => { bar.style.width = `${Math.round(aff * 100)}%`; });
    });
  } catch (err) { const li = document.createElement('li'); li.className = 'err'; li.textContent = err.message; ranked.append(li); }
  finally { btn.disabled = false; btn.textContent = 'Rank my ideas'; }
});
