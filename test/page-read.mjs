// Page reader eval (opt-in; not part of `npm test`): the real page, in headless Chromium, reads a story with a real
// model on this machine, through every step a writer's read takes: the machine rung's probe, its 3,000-token window,
// whole or two-pass, quote anchoring, assembly. The proposal is scored like the CLI evals (test/score.mjs).
//   node test/page-read.mjs --model qwen3.5:4b [--server ollama|lmstudio] [--story <name>] [--runs 2] [--strategy whole|split]
// --story is a story in test/stories/ with hand labels; without it, The whistle, scored against the explainer.
// The server must allow http://127.0.0.1:* (Ollama does by default; LM Studio needs CORS on). Writes test/receipts/page-*.json.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { loadPage, score, scoreStory } from './score.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const model = arg('model'), server = arg('server', 'ollama'), storyName = arg('story'), runs = +arg('runs', 1), strategy = arg('strategy', 'whole');
if (!model) { console.error('pass --model <id> (the server\'s own model id)'); process.exit(2); }
const { C, seed, prose: whistle } = loadPage();
const prose = storyName ? readFileSync(new URL(`./stories/${storyName}.txt`, import.meta.url), 'utf8').trim() : whistle;
const labels = storyName ? JSON.parse(readFileSync(new URL(`./stories/${storyName}.labels.json`, import.meta.url), 'utf8')) : null;

const html = readFileSync(new URL('../index.html', import.meta.url));
const http = createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(html); });
await new Promise(r => http.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();
const out = [];
for (let run = 1; run <= runs; run++) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => { try { localStorage.setItem('sandhi:intro-seen', '1'); } catch { /* fine */ } delete window.LanguageModel; });
  const p = await ctx.newPage();
  await p.goto(`http://127.0.0.1:${http.address().port}/`); await p.evaluate(() => window.sandhi.ready);
  const call = (n, a) => p.evaluate(([x, y]) => window.sandhi.tools[x](y), [n, a]);
  await call('reader.status', { probe: true });
  await call('reader.select', { rung: 'machine', server, model });
  const t0 = Date.now(), r = await call('read.run', { text: prose, strategy }), ms = Date.now() - t0;
  let receipt = { run, model, server, story: storyName || 'the-whistle', words: C.wordCount(prose), strategy, ms, class: r.class };
  if (r.ok) {
    const st = (await call('read.get', {})).data.story;
    receipt = { ...receipt, mode: r.data.mode, calls: r.data.calls, dropped: r.data.dropped, score: labels ? scoreStory(st, labels, C) : score(st, seed, prose, C),
      beats: st.beats.map((b, i) => `${i + 1} ${b.spine}/${b.joint || '-'} f${b.fortune}${b.marks.length ? ' ' + b.marks.join('+') : ''} | ${b.text.slice(0, 50)}`) };
  } else receipt = { ...receipt, message: r.message };
  out.push(receipt);
  console.log(JSON.stringify({ run, class: receipt.class, mode: receipt.mode, ms, score: receipt.score && { turn: receipt.score.turn ?? receipt.score.turn_on_the_whistle, low: receipt.score.low ?? receipt.score.low_on_the_gull, threads: receipt.score.threads_found ?? receipt.score.whistle_thread } }));
  await ctx.close();
}
await browser.close(); http.close();
mkdirSync(new URL('./receipts/', import.meta.url), { recursive: true });
const name = `page-${server}-${model}-${storyName || 'the-whistle'}-${strategy}`.replace(/[^a-z0-9._-]+/gi, '_');
writeFileSync(new URL(`./receipts/${name}.json`, import.meta.url), JSON.stringify(out, null, 1));
process.exit(out.every(x => x.class === 'ok') ? 0 : 1);
