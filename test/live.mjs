// Live reader eval (opt-in; not part of `npm test`): a real model reads "The whistle" as prose, through the same
// prompts, schemas, request bodies, JSON step-down and parsing the page uses, and the reading is scored against the
// explainer's own labels. Local servers need no key; for a provider, pass the NAME of an env var that holds the key.
//   node test/live.mjs --base http://127.0.0.1:1234/v1 --model <id>
//   node test/live.mjs --base https://openrouter.ai/api/v1 --model <id> --key-env OPENROUTER_API_KEY
// Writes test/receipts/live-<model>.json. The score measures agreement with one editorial reading, not truth.
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadPage, score as scoreAgainst, plain } from './score.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('base', 'http://127.0.0.1:1234/v1').replace(/\/+$/, ''), model = arg('model'), keyEnv = arg('key-env');
// local servers get what the page's machine rung sends (no thinking); --reasoning default|none overrides
const local = /^http:\/\/(127\.0\.0\.1|localhost)/.test(base), reasoning = arg('reasoning', local ? 'none' : 'default');
const extra = reasoning === 'default' ? {} : { reasoning_effort: reasoning };
if (!model) { console.error('pass --model <id> (GET ' + base + '/models lists them)'); process.exit(2); }
const key = keyEnv ? process.env[keyEnv] : null;
if (keyEnv && !key) { console.error(`env var ${keyEnv} is empty`); process.exit(2); }
const { C, L, seed, prose } = loadPage();

// one call, stepping down the JSON mode on HTTP 400 exactly as the page does
async function call(prompt, schema) {
  for (const mode of L.JSON_MODES) {
    const t0 = Date.now();
    const res = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(L.openaiBody(model, prompt, schema, mode, extra)) });
    const out = await res.json().catch(() => ({}));
    if (res.status === 400 && mode !== 'prompt') continue;
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(out).slice(0, 300)}`);
    return { mode, ms: Date.now() - t0, parsed: plain(L.parseOpenAI(out)) };
  }
  throw new Error('every JSON mode was rejected');
}

const score = (story) => scoreAgainst(story, seed, prose, C);

const strategy = arg('strategy', 'whole');
// the page's split strategy: one call finds the beats, a second labels them
async function readSplit() {
  const b = await call(C.READ_PROMPTS.bounds(prose), C.READ_SCHEMAS.bounds);
  if (b.parsed.error) throw new Error(`bounds reply: ${b.parsed.error}`);
  const an = plain(C.anchorScenes(prose, b.parsed.json.beats || []));
  if (!an.scenes.length) throw new Error('no beat quote matched the text');
  const l = await call(C.READ_PROMPTS.beatLabels(plain(C.beatTexts(prose, an.scenes))), C.READ_SCHEMAS.beatLabels);
  if (l.parsed.error) throw new Error(`labels reply: ${l.parsed.error}`);
  const built = plain(C.storyFromSplit(prose, an.scenes, l.parsed.json, l.parsed.model || model));
  return { r: { mode: l.mode }, built: { ...built, dropped: { ...built.dropped, beats: built.dropped.beats + an.dropped } } };
}
async function readWhole() {
  const r = await call(C.READ_PROMPTS.whole(prose), C.READ_SCHEMAS.whole);
  if (r.parsed.error) throw new Error(`reply: ${r.parsed.error}`);
  return { r, built: plain(C.storyFromWhole(prose, r.parsed.json, r.parsed.model || model)) };
}
const t0 = Date.now();
let receipt;
try {
  const { r, built } = strategy === 'split' ? await readSplit() : await readWhole();
  if (!built.story) throw new Error('no beat quote matched the text');
  receipt = { gate: 'live', base, model, reasoning, strategy, json_mode: r.mode, ms: Date.now() - t0, dropped: built.dropped, valid: C.validate(built.story).ok, score: score(built.story),
    beats: built.story.beats.map((b, i) => `${i + 1} ${b.spine}/${b.joint || '-'} f${b.fortune}${b.marks.length ? ' ' + b.marks.join('+') : ''} | ${b.text.slice(0, 50)}`) };
} catch (e) { receipt = { gate: 'live', base, model, ms: Date.now() - t0, error: String(e.message || e) }; }
mkdirSync(new URL('./receipts/', import.meta.url), { recursive: true });
writeFileSync(new URL(`./receipts/live-${model.replace(/[^a-z0-9._-]+/gi, '_')}.json`, import.meta.url), JSON.stringify(receipt, null, 1));
console.log(JSON.stringify(receipt, null, 1));
process.exit(receipt.error ? 1 : 0);
