// Face + TTFV gate (SPEC §4). The verifier drives the agent face, not the DOM (Build Doctrine).
//   cd test && npm install && node face.mjs
// 1. Hard rule ②: first value ≤ 5 000 ms on a COLD load, 3 runs, fresh browser context each.
//    First value = the app's performance mark `sandhi:first-value`, set after the story, chart and checks render.
// 2. window.sandhi drives the story end to end; the UI reflects every agent call (one core, two doors).
// 3. One UI click goes through the same bus (journal records door 'ui'); autosave survives a reload.
// 4. Layout: no horizontal scroll at 375 px; dark scheme switches the background token.
// Fails closed: a page that never marks first value is 'indeterminate', never 'pass'.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url));
const server = createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/index.html')) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); }
  else { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const results = [];
const check = (id, pass, detail) => results.push({ id, pass: !!pass, ...(pass ? {} : { detail }) });

// ---- 1. cold-load timing
const BAR_MS = 5000, samples = [];
for (let i = 0; i < 3; i++) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'commit' });
  let mark = null;
  try {
    await page.waitForFunction(() => performance.getEntriesByName('sandhi:first-value').length > 0, null, { timeout: BAR_MS + 3000 });
    mark = await page.evaluate(() => Math.round(performance.getEntriesByName('sandhi:first-value')[0].startTime));
  } catch { mark = null; }
  const beats = await page.evaluate(() => document.querySelectorAll('#beats .beat').length);
  const dots = await page.evaluate(() => document.querySelectorAll('#chart .dot').length);
  samples.push({ run: i, first_value_ms: mark, beats, dots });
  await ctx.close();
}
const indeterminate = samples.some(s => s.first_value_ms === null);
const worst = indeterminate ? null : Math.max(...samples.map(s => s.first_value_ms));
check('ttfv.cold_le_5000ms', !indeterminate && worst <= BAR_MS && samples.every(s => s.beats === 10 && s.dots === 10), samples);

// ---- 2. agent face
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(base);
await page.evaluate(() => window.sandhi.ready);
const call = (name, args) => page.evaluate(([n, a]) => window.sandhi.tools[n](a), [name, args]);
const domBeats = () => page.evaluate(() => document.querySelectorAll('#beats .beat').length);

const man = await page.evaluate(() => window.sandhi.manifest);
check('face.manifest', man.length === 21 && man.every(t => t.name && t.description && t.inputSchema && t.personOnly === false), man.map(t => t.name));
let st = await call('status', {});
check('face.status', st.ok && st.data.beats === 10 && st.data.checks.count === 0 && st.data.arc.best === 'hole' && st.data.title === 'The whistle', st);

let r = await call('beat.remove', { id: 'b2' });
const ch = await call('checks', {});
const whistle = ch.data.items.find(c => c.class === 'payoff_unplanted' && c.thread === 'whistle');
check('face.remove_beat2_flags_whistle_payoff', r.ok && whistle && whistle.beat === 'b8' && whistle.at === 7, ch.data);
check('face.ui_reflects_agent_call', (await domBeats()) === 9, await domBeats());
r = await call('undo', {});
st = await call('status', {});
check('face.undo_restores', r.ok && st.data.beats === 10 && st.data.checks.count === 0 && (await domBeats()) === 10, st);

r = await call('beat.update', { id: 'b1', patch: { fortune: 9 } });
check('face.invalid_fortune', r.class === 'invalid' && r.next && r.data.errors.some(e => e.path === 'beats[0].fortune'), r);
r = await call('beat.update', { id: 'nope', patch: { text: 'x' } });
check('face.not_found', r.class === 'not_found' && !!r.next, r);
r = await call('beat.update', { id: 'b1', patch: { mood: 'grim' } });
check('face.unknown_field', r.class === 'invalid' && /mood/.test(r.message), r);
st = await call('status', {});
check('face.failures_leave_story', st.data.checks.count === 0 && st.data.undo === 0, st);

r = await call('story.new', {});
st = await call('status', {});
check('face.story_new', r.ok && st.data.beats === 5 && st.data.checks.classes.beat_empty === 5 && (await domBeats()) === 5, st);
await call('undo', {});
const story = (await call('story.get', {})).data.story;
check('face.undo_story_new', story.title === 'The whistle' && story.beats.length === 10, story.title);

const [dl] = await Promise.all([page.waitForEvent('download'), call('story.save', {})]);
const saved = JSON.parse(readFileSync(await dl.path(), 'utf8'));
check('face.save_file', dl.suggestedFilename() === 'the-whistle.sandhi.json' && JSON.stringify(saved) === JSON.stringify(story), dl.suggestedFilename());
await call('story.new', {});
r = await call('story.load', { story: saved });
const loaded = (await call('story.get', {})).data.story;
check('face.load_round_trip', r.ok && JSON.stringify(loaded) === JSON.stringify(saved), r);
r = await call('story.load', { story: { sandhi: 1 } });
check('face.load_rejects_bad', r.class === 'invalid' && (await call('story.get', {})).data.story.title === 'The whistle', r);

r = await call('thread.add', { label: 'The lantern', plant: 'b6' });
const unpaid = (await call('checks', {})).data.items.find(c => c.class === 'plant_unpaid');
check('face.thread_add_flags_unpaid', r.ok && unpaid && unpaid.thread === r.data.id && unpaid.at === 6, unpaid);
r = await call('thread.update', { id: r.data.id, patch: { payoffs: ['b9'] } });
check('face.thread_paid', r.ok && (await call('checks', {})).data.count === 0, r);
r = await call('beat.move', { id: 'b10', position: 1 });
check('face.move', r.ok && (await call('story.get', {})).data.story.beats[0].id === 'b10', r);
await call('undo', {});
r = await call('view.focus', { principle: 'plant' });
const dimmed = await page.evaluate(() => document.querySelectorAll('#beats .beat.dim').length);
check('face.focus_dims_untagged', r.ok && dimmed === 8, dimmed);
await call('view.focus', { principle: 'all' });

// ---- 3. a UI click goes through the same bus; autosave survives a reload
await page.click('#matrix tbody tr:nth-child(1) td.c:nth-child(3) button');   // principle 1 (care), beat 2
const b2 = (await call('story.get', {})).data.story.beats[1];
const j = (await call('journal', { n: 5 })).data.entries;
check('ui.click_goes_through_bus', b2.tags.includes('care') && j.some(e => e.tool === 'beat.update' && e.door === 'ui'), { tags: b2.tags, journal: j });
await page.reload(); await page.evaluate(() => window.sandhi.ready);
const after = (await call('story.get', {})).data.story;
check('ui.autosave_survives_reload', after.beats[1].tags.includes('care') && after.title === 'The whistle', after.beats[1].tags);
check('ui.journal_persists', (await call('journal', { n: 200 })).data.entries.length >= 20, 'journal short');
check('page.no_errors', errors.length === 0, errors);
await ctx.close();

// ---- 4. layout: phone width, dark scheme
const phone = await browser.newContext({ viewport: { width: 375, height: 812 } });
const pp = await phone.newPage(); await pp.goto(base); await pp.evaluate(() => window.sandhi.ready);
const sw = await pp.evaluate(() => document.documentElement.scrollWidth);
check('layout.no_hscroll_375', sw <= 375, sw);
await phone.close();
const dark = await browser.newContext({ colorScheme: 'dark' });
const dp = await dark.newPage(); await dp.goto(base); await dp.evaluate(() => window.sandhi.ready);
const bg = await dp.evaluate(() => getComputedStyle(document.body).backgroundColor);
check('layout.dark_scheme', bg === 'rgb(28, 26, 22)', bg);
await dark.close();

await browser.close(); server.close();
const failed = results.filter(x => !x.pass);
const verdict = indeterminate ? 'indeterminate' : failed.length ? 'fail' : 'pass';
const receipt = { gate: 'face', at: new Date().toISOString(), verdict, bar_ms: BAR_MS, worst_ms: worst, samples, checks: results.length, failed: failed.length, ...(failed.length ? { failures: failed } : {}) };
mkdirSync(new URL('./receipts/', import.meta.url), { recursive: true });
writeFileSync(new URL('./receipts/face.json', import.meta.url), JSON.stringify(receipt, null, 1));
console.log(JSON.stringify(receipt, null, 1));
process.exit(verdict === 'pass' ? 0 : 1);
