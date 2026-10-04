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
  await page.waitForFunction(() => document.querySelector('#splash').open, null, { timeout: 2000 }).catch(() => {});
  const splash = await page.evaluate(() => document.querySelector('#splash').open);
  samples.push({ run: i, first_value_ms: mark, beats, dots, splash });
  await ctx.close();
}
const indeterminate = samples.some(s => s.first_value_ms === null);
const worst = indeterminate ? null : Math.max(...samples.map(s => s.first_value_ms));
check('ttfv.cold_le_5000ms', !indeterminate && worst <= BAR_MS && samples.every(s => s.beats === 10 && s.dots === 10), samples);
check('splash.cold_load_shows_it', samples.every(s => s.splash), samples.map(s => s.splash));

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
const personOnly = man.filter(t => t.personOnly).map(t => t.name).toSorted();
check('face.manifest', man.length === 31 && man.every(t => t.name && t.description && t.inputSchema) && JSON.stringify(personOnly) === JSON.stringify(['read.accept', 'reader.key']), { n: man.length, personOnly });
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
check('face.save_says_download_started', (await page.textContent('#savestate')) === 'Download started', await page.textContent('#savestate'));
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

// paste as beats, with no model: one beat per paragraph, nothing labelled for the writer
{
  const pr = await call('story.paste', { text: 'First paragraph of a story.\n\nSecond paragraph.\n\nThird.' });
  const st = (await call('story.get', {})).data.story;
  check('face.paste_as_beats', pr.ok && st.beats.length === 3 && st.beats.every(b => b.tags.length === 0 && b.joint === null && b.by === 'writer') && st.beats[1].text === 'Second paragraph.' && st.title === '', { pr: pr.class, n: st.beats.length });
  await call('undo', {});
}
// ---- 3. splash + tour, then a UI click goes through the same bus; autosave survives a reload
check('splash.open_on_first_visit', await page.evaluate(() => document.querySelector('#splash').open), 'closed');
await page.click('#splash-close');
check('splash.closes', !(await page.evaluate(() => document.querySelector('#splash').open)), 'still open');
await page.keyboard.press('?');
check('splash.question_key_reopens', await page.evaluate(() => document.querySelector('#splash').open && document.querySelector('#splash-close').textContent === 'Back to the story'), 'not reopened');
await page.click('#splash [data-ui="tour"]');
const tourTitles = [];
for (let k = 0; k < 8; k++) {
  tourTitles.push(await page.evaluate(() => document.querySelector('.tour-layer h2') && document.querySelector('.tour-layer h2').textContent));
  if (k < 7) await page.keyboard.press('ArrowRight');
}
const spot = await page.waitForFunction(() => { const box = document.querySelector('.tour-spot').getBoundingClientRect(); return box.width > 20 && box.height > 20; }, null, { timeout: 2000 }).then(() => true, () => false);   // placed on the next frame
await page.keyboard.press('Escape');
const tourGone = await page.evaluate(() => !document.querySelector('.tour-layer') && !document.querySelector('#splash').open);
check('tour.eight_steps_then_escape', tourTitles[0] === 'The shape of the story' && tourTitles[7] === 'Your story, your file' && new Set(tourTitles).size === 8 && spot && tourGone, { tourTitles, spot, tourGone });
await page.click('#matrix tbody tr:nth-child(1) td.c:nth-child(3) button');   // principle 1 (care), beat 2
const b2 = (await call('story.get', {})).data.story.beats[1];
const j = (await call('journal', { n: 5 })).data.entries;
check('ui.click_goes_through_bus', b2.tags.includes('care') && j.some(e => e.tool === 'beat.update' && e.door === 'ui'), { tags: b2.tags, journal: j });
await page.reload(); await page.evaluate(() => window.sandhi.ready);
await page.waitForTimeout(150);
check('splash.not_shown_again', !(await page.evaluate(() => document.querySelector('#splash').open)), 'shown again');
const after = (await call('story.get', {})).data.story;
check('ui.autosave_survives_reload', after.beats[1].tags.includes('care') && after.title === 'The whistle', after.beats[1].tags);
check('ui.journal_persists', (await call('journal', { n: 200 })).data.entries.length >= 20, 'journal short');
check('page.no_errors', errors.length === 0, errors);
await ctx.close();


// ---- 3b. read mode: a stand-in Gemini Nano answers from a fixture; Claude's API is intercepted (dummy test key, nothing leaves)
const { default: vm } = await import('node:vm');
const coreCtx = vm.createContext({});
vm.runInContext((/<script id="sandhi-core">([\s\S]*?)<\/script>/.exec(html.toString()) || [])[1], coreCtx);
const CORE = coreCtx.SandhiCore, SEED = JSON.parse(JSON.stringify(CORE.seed()));
const prose = SEED.beats.map(b => b.text).join('\n\n');
const first8 = (t) => t.split(/\s+/).slice(0, 8).join(' ');
const LK = ['label', 'spine', 'joint', 'fortune', 'tags', 'marks', 'driver', 'avastha', 'kis'];
const labelsOf = (b) => Object.fromEntries(LK.map(k => [k, ['joint', 'driver', 'avastha', 'kis'].includes(k) ? (b[k] || 'none') : b[k]]));
const ix = Object.fromEntries(SEED.beats.map((b, i) => [b.id, i]));
const FIX = {
  whole: { title: 'The whistle', beats: SEED.beats.map(b => ({ start: first8(b.text), ...labelsOf(b) })),
    threads: SEED.threads.map(t => ({ label: t.label, plant: first8(SEED.beats[ix[t.plant]].text), payoffs: t.payoffs.map(b => first8(SEED.beats[ix[b]].text)) })) },
  beats: SEED.beats.map(b => ({ start: first8(b.text), summary: b.label, fortune: b.fortune, labels: labelsOf(b) })),
  threads: SEED.threads.map(t => ({ label: t.label, plant_scene: ix[t.plant] + 1, payoff_scenes: t.payoffs.map(b => ix[b] + 1) }))
};
const tok = (s) => Math.ceil(s.length / 4);
const P = CORE.READ_PROMPTS, whole = P.whole(prose), emptyScenes = P.scenes('', 1, 1);
const labelsP = P.labels(FIX.beats.map(b => ({ summary: b.summary, fortune: b.fortune, introduces: [], uses: [] })));
const twoPassInput = Math.max(tok(labelsP.system + '\n' + labelsP.user), tok(emptyScenes.system + '\n' + emptyScenes.user) + 420) + 40;
check('read.fixture_forces_two_pass', twoPassInput < tok(whole.system + '\n' + whole.user), { twoPassInput, whole: tok(whole.system + '\n' + whole.user) });
// the stand-in: Chrome's LanguageModel surface, answering whole / scenes / labels prompts from the fixture
const fakeNano = ({ FIX, windowTokens, hang, late }) => {
  window.__nanoCalls = [];
  const answer = (user) => {
    if (user.startsWith('Mark the structure')) return FIX.whole;
    if (user.startsWith('Split this story')) return { beats: FIX.beats.map(b => ({ start: b.start })) };
    if (user.startsWith('Here is a story split into numbered beats')) { const n = (user.match(/^Beat \d+:/gm) || []).length; return { title: 'The whistle', beats: FIX.beats.slice(0, n).map((b, k) => ({ beat: k + 1, ...b.labels })), threads: FIX.threads.map(t => ({ label: t.label, plant_beat: t.plant_scene, payoff_beats: t.payoff_scenes })) }; }
    if (user.startsWith('This is part')) { const part = user.slice(user.indexOf(':\n', user.lastIndexOf('PART ')) + 2); return { scenes: FIX.beats.filter(b => part.includes(b.start)).map(b => ({ start: b.start, summary: b.summary, fortune: b.fortune, introduces: [], uses: [] })) }; }
    const n = (user.match(/^Scene \d+/gm) || []).length;
    return { title: 'The whistle', beats: FIX.beats.slice(0, n).map((b, k) => ({ scene: k + 1, ...b.labels })), threads: FIX.threads };
  };
  const session = (init) => ({ contextWindow: windowTokens, measureContextUsage: async (t) => Math.ceil(t.length / 4),
    prompt: async (user, opts) => {
      window.__nanoCalls.push({ kind: user.slice(0, 12), system: !!(init && init.initialPrompts), schema: !!(opts && opts.responseConstraint), signal: !!(opts && opts.signal) });
      if (hang) return new Promise((_, no) => { opts.signal.addEventListener('abort', () => no(new DOMException('stopped', 'AbortError'))); });   // answers only to Stop
      if (late) return new Promise(ok => { setTimeout(() => ok(JSON.stringify(answer(user))), 300); });   // ignores Stop and answers anyway
      return JSON.stringify(answer(user));
    }, destroy() {} });
  window.LanguageModel = { availability: async () => 'available', create: async (init) => session(init) };
};
async function readPage(opts) {
  const ctx2 = await browser.newContext(opts && opts.ctx);
  if (opts && opts.nano) await ctx2.addInitScript(fakeNano, { FIX, windowTokens: opts.nano, hang: !!opts.hang, late: !!opts.late });
  else await ctx2.addInitScript(() => { delete window.LanguageModel; });   // a browser without Gemini Nano
  await ctx2.addInitScript(() => { try { localStorage.setItem('sandhi:intro-seen', '1'); } catch { /* fine */ } });
  const p = await ctx2.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto(base); await p.evaluate(() => window.sandhi.ready);
  if (opts && opts.nano) await p.evaluate(() => window.sandhi.tools['reader.select']({ rung: 'device' }));   // nothing reads until the writer chooses
  return { ctx2, p, errs, call: (n, a) => p.evaluate(([x, y]) => window.sandhi.tools[x](y), [n, a]) };
}
{ // whole story on Nano, then the writer accepts it in the page
  const { ctx2, p, errs, call } = await readPage({ nano: 6144 });
  const st = await call('reader.status', {});
  check('read.nano_ready', st.data.device === 'ready' && st.data.rung === 'device' && /stays on this device/.test(st.data.where), st.data);
  const r = await call('read.run', { text: prose });
  check('read.nano_whole', r.ok && r.data.mode === 'whole' && r.data.calls === 1 && r.data.beats === 10 && r.data.threads === 6 && r.data.model === 'gemini-nano' && r.data.arc === 'hole' && r.data.dropped.beats === 0, r);
  const sp = await call('read.run', { text: prose, strategy: 'split' });
  const spStory = (await call('read.get', {})).data.story;
  check('read.nano_split', sp.ok && sp.data.mode === 'split' && sp.data.calls === 2 && sp.data.beats === 10 && sp.data.threads === 6 && spStory.beats.every((b, i) => b.text === SEED.beats[i].text && LK.every(k => JSON.stringify(b[k]) === JSON.stringify(SEED.beats[i][k]))), sp.data || sp);
  const badStrategy = await call('read.run', { text: prose, strategy: 'twice' });
  check('read.strategy_closed', badStrategy.class === 'invalid', badStrategy);
  await call('read.run', { text: prose });   // back to a whole-story proposal for the steps below
  const before = (await call('story.get', {})).data.story;
  const refused = await call('read.accept', {});
  check('read.accept_person_only', refused.class === 'person_only' && JSON.stringify((await call('story.get', {})).data.story) === JSON.stringify(before), refused);
  const keyRefused = await call('reader.key', { key: 'x' });
  check('read.key_person_only', keyRefused.class === 'person_only', keyRefused);
  // an agent reads on the device; sending the story to a provider, or choosing one, is the writer's
  const offRun = await call('read.run', { text: prose, rung: 'provider' }), offRung = await call('reader.select', { rung: 'provider' }), offProv = await call('reader.select', { provider: 'openai' });
  check('read.agent_cannot_send_off_device', [offRun, offRung, offProv].every(x => x.class === 'person_only') && (await call('reader.status', {})).data.rung === 'device', [offRun.class, offRung.class, offProv.class]);
  await p.click('[data-ui="read-open"]'); await p.waitForFunction(() => document.querySelector('#reader').open);
  const shown = await p.evaluate(() => document.querySelectorAll('#read-result li').length);
  const unchanged = JSON.stringify((await call('story.get', {})).data.story);
  await p.evaluate(() => document.querySelector('[data-ui="read-accept"]').click());   // a scripted click is not the writer's
  check('read.accept_scripted_click_refused', JSON.stringify((await call('story.get', {})).data.story) === unchanged, 'a scripted click accepted');
  // the open dialog follows an agent: a new reading and a new rung show at once; Accept takes only the reading shown
  const id1 = await p.getAttribute('[data-ui="read-accept"]', 'data-proposal');
  const agentRead = await call('read.run', { text: prose, strategy: 'split' });
  const follows = await p.waitForFunction((id) => document.querySelector('[data-ui="read-accept"]').dataset.proposal !== id, id1, { timeout: 2000 }).then(() => true, () => false);
  const shownId = await p.getAttribute('[data-ui="read-accept"]', 'data-proposal');
  await call('reader.select', { rung: 'machine' });
  const radioFollows = await p.waitForFunction(() => document.querySelector('#reader input[value="machine"]').checked, null, { timeout: 2000 }).then(() => true, () => false);
  await call('reader.select', { rung: 'device' });
  await p.waitForFunction(() => document.querySelector('#reader input[value="device"]').checked);
  check('read.dialog_follows_agent', follows && radioFollows, { follows, radioFollows, id1, shownId, agentRead: agentRead.class, proposal: agentRead.data && agentRead.data.proposal });
  await p.evaluate((id) => { document.querySelector('[data-ui="read-accept"]').dataset.proposal = id; }, id1);   // the writer clicks a reading that was replaced
  await p.click('[data-ui="read-accept"]');
  await p.waitForFunction(() => /changed after it was shown/.test(document.querySelector('#toast').textContent));
  check('read.accept_bound_to_shown_proposal', JSON.stringify((await call('story.get', {})).data.story) === unchanged, 'a replaced reading was accepted');
  await call('read.run', { text: prose });   // a whole-story reading, shown in the open dialog
  await p.waitForFunction(() => document.querySelectorAll('#read-result li').length === 10);
  await p.click('[data-ui="read-accept"]');
  const after = (await call('story.get', {})).data.story;
  const sameProse = after.beats.length === 10 && after.beats.every((b, i) => b.text === SEED.beats[i].text);
  const sameLabels = after.beats.every((b, i) => LK.every(k => JSON.stringify(b[k]) === JSON.stringify(SEED.beats[i][k])));
  const byline = await p.evaluate(() => document.querySelectorAll('#beats .byline').length);
  check('read.accept_in_page', shown === 10 && sameProse && sameLabels && after.beats.every(b => b.by === 'model' && b.model === 'gemini-nano') && byline === 10 && (await call('checks', {})).data.count === 0, { shown, sameProse, sameLabels, byline });
  await call('beat.update', { id: 'b3', patch: { fortune: -2 } });
  const b3 = (await call('story.get', {})).data.story.beats[2];
  check('read.agent_label_edit_attributed', b3.by === 'agent' && b3.model === undefined, b3);   // an agent's label edit is the agent's, not the model's or the writer's
  await call('undo', {}); await call('undo', {});
  const back = (await call('story.get', {})).data.story;
  check('read.undo_restores_previous', back.beats.every(b => b.by === 'writer') && back.title === 'The whistle', back.beats.map(b => b.by));
  check('read.nano_no_errors', errs.length === 0, errs);
  await ctx2.close();
}
{ // a Nano whose window cannot hold the instructions says so, and points at the other reader
  const { ctx2, call } = await readPage({ nano: 1000 });
  const r = await call('read.run', { text: prose });
  check('read.nano_window_too_small', r.class === 'no_reader' && /1000 tokens/.test(r.message) && /provider/.test(r.next), r);
  await ctx2.close();
}
{ // Stop: a read whose model never answers ends at once when stopped, by the agent face and by the button
  const { ctx2, p, errs, call } = await readPage({ nano: 6144, hang: true });
  await p.evaluate((text) => { window.__pending = window.sandhi.tools['read.run']({ text }); }, prose);
  await p.waitForFunction(() => window.__nanoCalls.length === 1);
  const busy = (await call('status', {})).data.read.reading;
  const t0 = Date.now(); const c = await call('read.cancel', {}); const r = await p.evaluate(() => window.__pending);
  const after = (await call('status', {})).data.read;
  check('read.cancel_stops', busy && c.ok && c.data.stopped && r.class === 'cancelled' && Date.now() - t0 < 2000 && !after.reading && after.proposal === null && (await p.evaluate(() => window.__nanoCalls.every(x => x.signal))), { busy, c: c.data, r: r.class, after });
  await p.click('[data-ui="read-open"]'); await p.fill('#read-text', prose);
  await p.click('#read-actions [data-ui="read-run"]');
  await p.waitForFunction(() => !document.querySelector('#read-stop').hidden);
  await p.click('#read-stop');
  await p.waitForFunction(() => /The read was stopped/.test(document.querySelector('#read-progress').textContent));
  const buttons = await p.evaluate(() => ({ stop: document.querySelector('#read-stop').hidden, run: document.querySelector('#read-actions [data-ui="read-run"]').hidden }));
  check('read.stop_button', buttons.stop && !buttons.run, buttons);
  check('read.stop_no_errors', errs.length === 0, errs);
  await ctx2.close();
}
{ // a reader that ignores Stop: its late answer is not staged, and the read before it leaves no proposal behind
  const { ctx2, p, errs, call } = await readPage({ nano: 6144, late: true });
  const firstRead = await call('read.run', { text: prose });
  await p.evaluate((text) => { window.__pending = window.sandhi.tools['read.run']({ text }); }, prose);
  await p.waitForFunction(() => window.__nanoCalls.length === 2);
  const staged = (await call('status', {})).data.read.proposal;
  const c = await call('read.cancel', {}); const r = await p.evaluate(() => window.__pending);
  await p.waitForTimeout(500);
  const after = (await call('status', {})).data.read;
  check('read.cancel_stages_nothing', firstRead.ok && staged === null && c.data.stopped && r.class === 'cancelled' && after.proposal === null && !after.reading, { first: firstRead.class, staged, r: r.class, after });
  check('read.late_no_errors', errs.length === 0, errs);
  await ctx2.close();
}
{ // the modelContext door: every tool but the person-only ones, each call journaled with its door
  const ctx5 = await browser.newContext();
  await ctx5.addInitScript(() => { try { localStorage.setItem('sandhi:intro-seen', '1'); } catch { /* fine */ } delete window.LanguageModel;
    window.__mc = []; Object.defineProperty(navigator, 'modelContext', { value: { registerTool: (t) => { window.__mc.push(t); } }, configurable: true }); });
  const p5 = await ctx5.newPage(); await p5.goto(base); await p5.evaluate(() => window.sandhi.ready);
  const names = await p5.evaluate(() => window.__mc.map(t => t.name));
  const r5 = await p5.evaluate(() => window.__mc.find(t => t.name === 'sandhi.status').execute({}));
  const j5 = (await p5.evaluate(() => window.sandhi.tools.journal({ n: 1 }))).data.entries[0];
  check('door.model_context', names.length === 29 && !names.includes('sandhi.read.accept') && !names.includes('sandhi.reader.key') && r5.ok && j5.door === 'modelContext' && j5.tool === 'status', { n: names.length, j5 });
  await ctx5.close();
}
{ // a page opened as a file stores no key: every local file shares its storage
  const ctx6 = await browser.newContext();
  await ctx6.addInitScript(() => { try { localStorage.setItem('sandhi:intro-seen', '1'); } catch { /* fine */ } delete window.LanguageModel; });
  const p6 = await ctx6.newPage(); await p6.goto(new URL('../index.html', import.meta.url).href); await p6.evaluate(() => window.sandhi.ready);
  await p6.click('[data-ui="read-open"]'); await p6.check('#reader input[value="provider"]');
  await p6.fill('#provider-key', 'sk-test-0000-not-a-real-key'); await p6.locator('#provider-key').blur();
  const told = await p6.waitForFunction(() => /opened as a file/.test(document.querySelector('#toast').textContent), null, { timeout: 2000 }).then(() => true, () => false);
  const keys6 = (await p6.evaluate(() => window.sandhi.tools['reader.status']({}))).data.keys;
  check('ladder.no_key_on_file_pages', told && keys6.length === 0, { told, keys6 });
  await ctx6.close();
}
{ // a window too small for the whole story: parts, then the outline
  const { ctx2, p, errs, call } = await readPage({ nano: twoPassInput + 1600 });
  const r = await call('read.run', { text: prose });
  const calls = await p.evaluate(() => window.__nanoCalls);
  const story = (await call('read.get', {})).data.story;
  check('read.nano_two_pass', r.ok && r.data.mode === 'two-pass' && r.data.calls === calls.length && calls.length >= 3 && r.data.beats === 10 && story.beats.every((b, i) => b.text === SEED.beats[i].text) && story.threads.length === 6 && calls.every(c => c.system && c.schema), { report: r.data || r, calls: calls.length });
  check('read.two_pass_no_errors', errs.length === 0, errs);
  await ctx2.close();
}
{ // the AI ladder, rung 3: your provider and key. Every call is intercepted; the key is a dummy test value and nothing leaves.
  const { ctx2, p, errs, call } = await readPage({});
  const sent = []; let mode = 'ok';
  const TEST_KEY = 'sk-test-0000-not-a-real-key';
  const reply = (body) => ({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  await p.route('https://api.anthropic.com/v1/messages', async (route) => {
    const q = route.request(); sent.push({ host: 'anthropic', headers: q.headers(), body: JSON.parse(q.postData()) });
    if (mode === '401') return route.fulfill({ status: 401, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }) });
    return route.fulfill(reply({ id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: mode === 'refusal' ? 'refusal' : 'end_turn', content: mode === 'refusal' ? [] : [{ type: 'text', text: JSON.stringify(FIX.whole) }] }));
  });
  await p.route('https://openrouter.ai/api/v1/**', async (route) => {
    const q = route.request();
    if (q.method() === 'GET') return route.fulfill(reply({ data: [{ id: 'zeta/model' }, { id: 'alpha/model' }] }));
    const body = JSON.parse(q.postData()); sent.push({ host: 'openrouter', headers: q.headers(), body });
    if (body.response_format && body.response_format.type === 'json_schema') return route.fulfill({ status: 400, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: { message: 'response_format json_schema is not supported for this model' } }) });
    return route.fulfill(reply({ model: 'alpha/model', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Here it is:\n```json\n' + JSON.stringify(FIX.whole) + '\n```' } }] }));
  });
  const unchosen = (await call('reader.status', {})).data;
  const none = await call('read.run', { text: prose });
  check('ladder.no_reader_until_chosen', unchosen.rung === null && unchosen.where === 'no reader chosen yet' && none.class === 'no_reader' && /Choose who reads it/.test(none.next), { rung: unchosen.rung, none });
  // Anthropic: choose the rung and provider in the page, paste the key (person-only), read
  await p.click('[data-ui="read-open"]');
  await p.check('#reader input[value="provider"]');
  await p.selectOption('#provider', 'anthropic');
  await p.fill('#provider-key', TEST_KEY); await p.locator('#provider-key').blur();
  await p.waitForFunction(() => /key·[0-9a-f]{8}/.test(document.querySelector('#key-state').textContent));
  const keyField = await p.inputValue('#provider-key'), privacy = await p.textContent('#read-privacy');
  let r = await call('read.run', { text: prose });
  const q = sent.find(x => x.host === 'anthropic') || { headers: {}, body: {} };
  const shapeOk = q.headers['x-api-key'] === TEST_KEY && q.headers['anthropic-version'] === '2023-06-01' && q.headers['anthropic-dangerous-direct-browser-access'] === 'true'
    && q.headers['anthropic-beta'] === 'server-side-fallback-2026-07-01' && q.body.model === 'claude-opus-5-5' && q.body.max_tokens === 16000 && q.body.fallbacks === 'default'
    && q.body.output_config.effort === 'medium' && q.body.output_config.format.type === 'json_schema' && typeof q.body.system === 'string';
  check('ladder.anthropic_request', shapeOk && r.ok && r.data.model === 'claude-opus-5-5' && r.data.reader === 'provider' && /Anthropic, with your key: the story leaves this device/.test(privacy), { r, privacy });
  check('ladder.key_field_cleared', keyField === '', 'key left in the field');
  mode = 'refusal'; r = await call('read.run', { text: prose });
  check('ladder.anthropic_refusal', r.class === 'refused' && !!r.next, r);
  mode = '401'; r = await call('read.run', { text: prose });
  check('ladder.anthropic_key_rejected', r.class === 'key_rejected' && /invalid x-api-key/.test(r.message), r);
  mode = 'ok';
  // OpenRouter: any OpenAI-compatible provider; load its models, pick one, and step down when it rejects json_schema
  await p.selectOption('#provider', 'openrouter');
  await p.fill('#provider-key', TEST_KEY); await p.locator('#provider-key').blur();
  await p.waitForFunction(() => /OpenRouter, key·/.test(document.querySelector('#key-state').textContent));
  const models = await call('reader.models', {});
  check('ladder.provider_models', models.ok && JSON.stringify(models.data.models) === JSON.stringify(['alpha/model', 'zeta/model']), models);
  await p.fill('#provider-model', 'alpha/model'); await p.locator('#provider-model').blur();
  await p.waitForFunction(() => document.querySelector('#provider-model').value === 'alpha/model');
  const before = sent.length;
  r = await call('read.run', { text: prose });
  const tries = sent.slice(before);
  check('ladder.openai_step_down', r.ok && r.data.model === 'alpha/model' && r.data.beats === 10 && tries.length === 2 && tries[0].body.response_format.type === 'json_schema' && tries[1].body.response_format.type === 'json_object'
    && tries[1].body.messages[0].content.includes('JSON Schema') && tries[1].headers.authorization === `Bearer ${TEST_KEY}`, { r, tries: tries.map(x => x.body.response_format) });
  const again = sent.length; r = await call('read.run', { text: prose });
  check('ladder.openai_remembers_mode', r.ok && sent.length - again === 1 && sent[again].body.response_format.type === 'json_object', sent.slice(again).map(x => x.body.response_format));
  // a custom provider: its address is entered with its key, in the page; an agent cannot move it
  const toCustom = [];
  await p.route('https://llm.example/v1/**', async (route) => { const q2 = route.request(); toCustom.push({ url: q2.url(), auth: q2.headers().authorization }); return route.fulfill(reply({ model: 'house-model', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(FIX.whole) } }] })); });
  await p.route('https://attacker.example/**', async (route) => { toCustom.push({ url: route.request().url(), attacker: true }); return route.fulfill(reply({})); });
  await p.selectOption('#provider', 'custom');
  await p.waitForFunction(() => !document.querySelector('#provider-base').hidden);
  await p.fill('#provider-base', 'https://llm.example/v1');
  await p.fill('#provider-key', TEST_KEY); await p.locator('#provider-key').blur();
  await p.waitForFunction(() => /Another OpenAI-compatible API, key·/.test(document.querySelector('#key-state').textContent));
  await p.fill('#provider-model', 'house-model'); await p.locator('#provider-model').blur();
  await p.waitForFunction(() => document.querySelector('#provider-model').value === 'house-model');
  const moved = await call('reader.select', { provider: 'custom', base: 'https://attacker.example/v1' });
  r = await call('read.run', { text: prose });
  check('ladder.custom_base_goes_with_key', moved.class === 'invalid' && r.ok && toCustom.length >= 1 && toCustom.every(x => !x.attacker && x.url.startsWith('https://llm.example/v1/') && x.auth === `Bearer ${TEST_KEY}`), { moved: moved.class, r: r.class, toCustom });
  await p.selectOption('#provider', 'openrouter');
  await p.waitForFunction(() => /OpenRouter, key·/.test(document.querySelector('#key-state').textContent));
  // a provider that echoes part of the key in an error: the message the agent face returns has it scrubbed
  await p.unroute('https://openrouter.ai/api/v1/**');
  await p.route('https://openrouter.ai/api/v1/**', (route) => route.fulfill({ status: 401, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: { message: 'Incorrect API key provided: sk-test-0000-not-a-real-key' } }) }));
  r = await call('read.run', { text: prose });
  check('ladder.error_scrubs_key', r.class === 'key_rejected' && !r.message.includes(TEST_KEY) && r.message.includes('[key]'), r);
  // the keys: in IndexedDB, shown as fingerprints, never in localStorage, the journal or the agent face
  const st = (await call('reader.status', {})).data;
  const ls = await p.evaluate(() => JSON.stringify(localStorage));
  const journal = JSON.stringify((await call('journal', { n: 200 })).data.entries);
  check('ladder.keys_fingerprints_only', st.keys.length === 3 && st.keys.every(k => /^key·[0-9a-f]{8}$/.test(k.fingerprint)) && !JSON.stringify(st).includes(TEST_KEY) && !ls.includes(TEST_KEY) && !journal.includes(TEST_KEY), { keys: st.keys });
  await p.click('#key-forget');
  await p.waitForFunction(() => /no key yet/.test(document.querySelector('#key-state').textContent));
  const after = (await call('reader.status', {})).data;
  check('ladder.forget_key', after.provider.key === null && after.keys.length === 2 && !after.keys.some(k => k.provider === 'openrouter'), after.keys);
  check('ladder.provider_no_errors', errs.length === 0, errs);
  await ctx2.close();
}
{ // the AI ladder, rung 1: a model server on this machine (Ollama), found only when the writer asks
  const { ctx2, p, errs, call } = await readPage({});
  const sent = [];
  const reply = (body) => ({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  await p.route('http://127.0.0.1:11434/v1/**', async (route) => {
    const q = route.request();
    if (q.method() === 'GET') return route.fulfill(reply({ object: 'list', data: [{ id: 'llama3.2' }] }));
    sent.push({ headers: q.headers(), body: JSON.parse(q.postData()) });
    return route.fulfill(reply({ model: 'llama3.2', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(FIX.whole) } }] }));
  });
  const unprobed = (await call('reader.status', {})).data;
  await p.click('[data-ui="read-open"]');
  await p.check('#reader input[value="machine"]');
  await p.click('[data-ui="read-probe"]');
  await p.waitForFunction(() => /Ollama found, 1 model/.test(document.querySelector('#machine-state').textContent));
  const noModel = await call('read.run', { text: prose });
  await p.waitForFunction(() => document.querySelectorAll('#machine-models option').length === 1);   // the probe fills the model list
  await p.fill('#machine-model', 'llama3.2'); await p.locator('#machine-model').blur();
  await p.waitForFunction(() => /Ollama on this machine/.test(document.querySelector('#read-privacy').textContent));
  const privacy = await p.textContent('#read-privacy');
  const r = await call('read.run', { text: prose });
  check('ladder.machine_model_must_be_chosen', noModel.class === 'no_reader' && /No model is chosen/.test(noModel.message), noModel);
  check('ladder.machine_not_probed_at_load', unprobed.machine.checked === false && unprobed.machine.server === null, unprobed.machine);
  check('ladder.machine_read', r.ok && r.data.reader === 'machine' && r.data.model === 'llama3.2' && r.data.beats === 10 && sent.length >= 1 && !sent[0].headers.authorization && /Ollama on this machine: the story stays on your machine/.test(privacy), { r, privacy });
  check('ladder.machine_no_errors', errs.length === 0, errs);
  await ctx2.close();
}
{ // a local server that never answers (as when Chrome holds the request on its prompt): the probe still ends on time
  const ctx4 = await browser.newContext();
  await ctx4.addInitScript(() => { try { localStorage.setItem('sandhi:intro-seen', '1'); } catch { /* fine */ } delete window.LanguageModel;
    const f0 = window.fetch; window.fetch = (u, o) => (String(u).startsWith('http://127.0.0.1:') ? new Promise(() => {}) : f0(u, o));
    const q = navigator.permissions.query.bind(navigator.permissions);   // access already granted: the short deadline applies
    navigator.permissions.query = (d) => (d && /local-network|loopback/.test(d.name) ? Promise.resolve({ state: 'granted' }) : q(d)); });
  const p4 = await ctx4.newPage(); await p4.goto(base); await p4.evaluate(() => window.sandhi.ready);
  const t4 = Date.now();
  const st4 = (await p4.evaluate(() => window.sandhi.tools['reader.status']({ probe: true }))).data;
  const took = Date.now() - t4;
  check('ladder.probe_ends_on_time', st4.machine.checked && st4.machine.server === null && took < 4000, { took, machine: st4.machine });
  await ctx4.close();
}
{ // Chrome has blocked this site from the local network: say so at once, and say how to allow it
  const ctx3 = await browser.newContext();
  await ctx3.addInitScript(() => { try { localStorage.setItem('sandhi:intro-seen', '1'); } catch { /* fine */ } delete window.LanguageModel;
    const q = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (d) => (d && /local-network|loopback/.test(d.name) ? Promise.resolve({ state: 'denied' }) : q(d)); });
  const p3 = await ctx3.newPage(); await p3.goto(base); await p3.evaluate(() => window.sandhi.ready);
  let asked = 0; await p3.route('http://127.0.0.1:11434/**', (route) => { asked++; return route.abort(); });
  const t0 = Date.now();
  const st3 = (await p3.evaluate(() => window.sandhi.tools['reader.status']({ probe: true }))).data;
  const r3 = await p3.evaluate((text) => window.sandhi.tools['read.run']({ text, rung: 'machine' }), prose);
  check('ladder.machine_denied', st3.machine.access === 'denied' && asked === 0 && Date.now() - t0 < 3000 && r3.class === 'no_reader' && /Local network access/.test(r3.next), { access: st3.machine.access, asked, r3 });
  await ctx3.close();
}

{ // the writer's edits survive: an agent edit mid-typing, an unsaved field at reload, undo across a reload, two tabs
  const { ctx2, p, errs, call } = await readPage({});
  const b2 = '#beat-b2 textarea.btext';
  await p.click(b2); await p.keyboard.press('End'); await p.keyboard.type(' AAAA BB');
  await call('beat.update', { id: 'b5', patch: { fortune: -2 } });   // an agent edit inside the 350 ms typing window
  await p.keyboard.type('BB CCCC');                                    // and the writer keeps typing into the re-rendered field
  await p.waitForTimeout(600);
  const kept = (await call('story.get', {})).data.story.beats[1].text;
  check('persist.typing_survives_agent_edit', kept.includes(' AAAA BBBB CCCC') && kept.length === SEED.beats[1].text.length + ' AAAA BBBB CCCC'.length, kept.length);
  await p.fill('#title', 'Edited, never blurred');
  await p.reload(); await p.evaluate(() => window.sandhi.ready);
  check('persist.unsaved_field_at_reload', (await call('story.get', {})).data.story.title === 'Edited, never blurred', (await call('story.get', {})).data.story.title);
  await call('story.new', {});
  await p.reload(); await p.evaluate(() => window.sandhi.ready);
  const u = await call('undo', {});
  const restored = (await call('story.get', {})).data.story;
  check('persist.undo_across_reload', u.ok && restored.beats.length === 10 && restored.title === 'Edited, never blurred', { u: u.class, beats: restored.beats.length });
  const other = await ctx2.newPage(); await other.goto(base); await other.evaluate(() => window.sandhi.ready);
  await other.evaluate(() => window.sandhi.tools['story.update']({ title: 'From the other tab' }));
  await p.waitForFunction(() => document.querySelector('#title').value === 'From the other tab', null, { timeout: 3000 }).catch(() => {});
  const here = (await call('story.get', {})).data.story.title;
  const back = await call('undo', {});
  check('persist.two_tabs', here === 'From the other tab' && back.ok && (await call('story.get', {})).data.story.title === 'Edited, never blurred', { here });
  // edit the title, then click straight into a beat and type: the keystrokes land (a header edit no longer redraws the beats)
  await p.fill('#title', 'Retitled'); await p.click('#beat-b3 textarea.btext'); await p.keyboard.type(' ZZZ'); await p.waitForTimeout(600);
  const b3t = (await call('story.get', {})).data.story.beats[2].text;
  check('persist.click_after_title_keeps_typing', b3t.includes(' ZZZ') && (await call('story.get', {})).data.story.title === 'Retitled', b3t.slice(-30));
  check('persist.no_errors', errs.length === 0, errs);
  await ctx2.close();
}

// ---- 4. layout: phone width, dark scheme
const phone = await browser.newContext({ viewport: { width: 375, height: 812 } });
const pp = await phone.newPage(); await pp.goto(base); await pp.evaluate(() => window.sandhi.ready);
await pp.click('#splash [data-ui="tour"]');
const cardFits = await pp.evaluate(() => { const box = document.querySelector('.tour-card').getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight; });
check('tour.card_fits_phone', cardFits, 'tour card off screen at 375 px');
await pp.keyboard.press('Escape');
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
