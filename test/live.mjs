// Live reader eval (opt-in; not part of `npm test`): a real model reads "The whistle" as prose, through the same
// prompts, schemas, request bodies, JSON step-down and parsing the page uses, and the reading is scored against the
// explainer's own labels. Local servers need no key; for a provider, pass the NAME of an env var that holds the key.
//   node test/live.mjs --base http://127.0.0.1:1234/v1 --model <id>
//   node test/live.mjs --base https://openrouter.ai/api/v1 --model <id> --key-env OPENROUTER_API_KEY
// Writes test/receipts/live-<model>.json. The score measures agreement with one editorial reading, not truth.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('base', 'http://127.0.0.1:1234/v1').replace(/\/+$/, ''), model = arg('model'), keyEnv = arg('key-env');
// local servers get what the page's machine rung sends (no thinking); --reasoning default|none overrides
const local = /^http:\/\/(127\.0\.0\.1|localhost)/.test(base), reasoning = arg('reasoning', local ? 'none' : 'default');
const extra = reasoning === 'default' ? {} : { reasoning_effort: reasoning };
if (!model) { console.error('pass --model <id> (GET ' + base + '/models lists them)'); process.exit(2); }
const key = keyEnv ? process.env[keyEnv] : null;
if (keyEnv && !key) { console.error(`env var ${keyEnv} is empty`); process.exit(2); }

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ctx = vm.createContext({ crypto: globalThis.crypto, TextEncoder });
for (const id of ['sandhi-core', 'sandhi-ladder']) vm.runInContext(new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`).exec(page)[1], ctx);
const C = ctx.SandhiCore, L = ctx.SandhiLadder, plain = (o) => JSON.parse(JSON.stringify(o));
const seed = plain(C.seed()), prose = seed.beats.map(b => b.text).join('\n\n');

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

// agreement with the explainer's reading of its own story
function score(story) {
  const startOf = (t) => prose.indexOf(t.slice(0, 60));
  const seedAt = new Map(seed.beats.map((b, i) => [startOf(b.text), i]));
  const aligned = story.beats.map(b => ({ b, s: seedAt.get(startOf(b.text)) })).filter(x => x.s !== undefined);
  const contains = (b, i) => b.text.includes(seed.beats[i].text.slice(0, 40));
  const agree = (k) => aligned.filter(x => x.s > 0).filter(x => (x.b[k] || null) === (seed.beats[x.s][k] || null)).length;
  const beatOf = (id) => story.beats.find(b => b.id === id);
  const whistle = story.threads.some(t => t.plant && contains(beatOf(t.plant), 1) && t.payoffs.some(p => contains(beatOf(p), 7)));
  return {
    beats: story.beats.length, boundaries_matching_seed: `${aligned.length}/10`,
    turn_on_the_whistle: story.beats.some(b => b.marks.includes('turn') && contains(b, 7)),
    low_on_the_gull: story.beats.some(b => b.marks.includes('low') && contains(b, 6)),
    joints_agree: `${agree('joint')}/${aligned.filter(x => x.s > 0).length}`, spine_agree: `${agree('spine')}/${aligned.filter(x => x.s > 0).length}`,
    threads: story.threads.length, whistle_thread: whistle, arc: plain(C.arcMatch(story)).best, checks: plain(C.checks(story)).map(c => c.class)
  };
}

const t0 = Date.now();
let receipt;
try {
  const r = await call(C.READ_PROMPTS.whole(prose), C.READ_SCHEMAS.whole);
  if (r.parsed.error) throw new Error(`reply: ${r.parsed.error}`);
  const built = plain(C.storyFromWhole(prose, r.parsed.json, r.parsed.model || model));
  if (!built.story) throw new Error('no beat quote matched the text');
  receipt = { gate: 'live', base, model, reasoning, json_mode: r.mode, ms: Date.now() - t0, dropped: built.dropped, valid: C.validate(built.story).ok, score: score(built.story),
    beats: built.story.beats.map((b, i) => `${i + 1} ${b.spine}/${b.joint || '-'} f${b.fortune}${b.marks.length ? ' ' + b.marks.join('+') : ''} | ${b.text.slice(0, 50)}`) };
} catch (e) { receipt = { gate: 'live', base, model, ms: Date.now() - t0, error: String(e.message || e) }; }
mkdirSync(new URL('./receipts/', import.meta.url), { recursive: true });
writeFileSync(new URL(`./receipts/live-${model.replace(/[^a-z0-9._-]+/gi, '_')}.json`, import.meta.url), JSON.stringify(receipt, null, 1));
console.log(JSON.stringify(receipt, null, 1));
process.exit(receipt.error ? 1 : 0);
