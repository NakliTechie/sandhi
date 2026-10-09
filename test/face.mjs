/* oxlint-disable no-underscore-dangle -- window.__name values are test-only hooks set inside the page; the dunder keeps them apart from the app's own names */
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
{ // the agent face drives one page: every check in this block shares it
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
  check('face.manifest', man.length === 51 && man.every(t => t.name && t.description && t.inputSchema) && JSON.stringify(personOnly) === JSON.stringify(['read.accept', 'reader.key', 'write.apply']), { n: man.length, personOnly });
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
  check('face.save_says_downloaded', (await page.textContent('#savestate')) === 'Downloaded the-whistle.sandhi.json', await page.textContent('#savestate'));
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
    const sto = (await call('story.get', {})).data.story;
    check('face.paste_as_beats', pr.ok && sto.beats.length === 3 && sto.beats.every(b => b.tags.length === 0 && b.joint === null && b.by === 'writer') && sto.beats[1].text === 'Second paragraph.' && sto.title === '', { pr: pr.class, n: sto.beats.length });
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
  for (let k = 0; k < 9; k++) {
    tourTitles.push(await page.evaluate(() => document.querySelector('.tour-layer h2') && document.querySelector('.tour-layer h2').textContent));
    if (k < 8) await page.keyboard.press('ArrowRight');
  }
  const spot = await page.waitForFunction(() => { const box = document.querySelector('.tour-spot').getBoundingClientRect(); return box.width > 20 && box.height > 20; }, null, { timeout: 2000 }).then(() => true, () => false);   // placed on the next frame
  await page.keyboard.press('Escape');
  const tourGone = await page.evaluate(() => !document.querySelector('.tour-layer') && !document.querySelector('#splash').open);
  check('tour.nine_steps_then_escape', tourTitles[0] === 'The shape of the story' && tourTitles.includes('Who reads your story') && tourTitles[8] === 'Your story, your file' && new Set(tourTitles).size === 9 && spot && tourGone, { tourTitles, spot, tourGone });
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
  // New opens a wizard: one question per screen, in Story Spine order; Finish builds the story through story.start
  {
    const before = (await call('story.get', {})).data.story.title;
    await page.click('[data-ui="wizard"]');
    await page.waitForFunction(() => document.querySelector('#wizard').open);
    const first = await page.textContent('#wiz-h');
    await page.keyboard.type('The lighthouse'); await page.keyboard.press('Enter');   // a one-line answer: Enter moves on
    await page.fill('#wiz-text', 'A keeper who wants one more winter at the light.'); await page.click('#wiz-next');
    for (const t of ['Mara keeps the light on the north rock.', 'Every night she climbs and trims the wick.', 'One day the company writes: the light will be automated.', 'So she hides the letter from her daughter.']) { await page.fill('#wiz-text', t); await page.click('#wiz-next'); }
    await page.click('[data-ui="wiz-back"]'); await page.click('#wiz-more');           // back on "Because of that", add a second one
    await page.fill('#wiz-text', 'Because of that the inspector finds her asleep at the lamp.'); await page.click('#wiz-next');
    await page.fill('#wiz-text', 'Until finally the storm comes and the new lamp fails.'); await page.click('#wiz-next');
    await page.click('[data-ui="wiz-skip"]');                                           // no "ever since then"
    const lastLabel = await page.textContent('#wiz-next');
    await page.fill('#wiz-text', 'Care is a kind of light.'); await page.click('#wiz-next');
    await page.waitForFunction(() => !document.querySelector('#wizard').open);
    const w = (await call('story.get', {})).data.story;
    check('wizard.builds_the_spine', first === 'What is the story called?' && lastLabel === 'Finish' && w.title === 'The lighthouse' && w.logline.startsWith('A keeper') && w.belief === 'Care is a kind of light.'
      && JSON.stringify(w.beats.map(b => b.spine)) === JSON.stringify(['once', 'everyday', 'oneday', 'because', 'because', 'until'])
      && JSON.stringify(w.beats.map(b => b.joint)) === JSON.stringify([null, null, 'but', 'therefore', 'therefore', 'therefore']) && w.beats[4].text.includes('inspector') && w.beats.every(b => b.by === 'writer') && (await domBeats()) === 6,
      { first, lastLabel, title: w.title, spine: w.beats.map(b => b.spine), joints: w.beats.map(b => b.joint) });
    await call('undo', {});
    check('wizard.undo_restores', (await call('story.get', {})).data.story.title === before, 'not restored');
    await page.click('[data-ui="wizard"]'); await page.waitForFunction(() => document.querySelector('#wizard').open);
    await page.keyboard.type('Never finished'); await page.keyboard.press('Escape');
    check('wizard.escape_keeps_story', !(await page.evaluate(() => document.querySelector('#wizard').open)) && (await call('story.get', {})).data.story.title === before, 'story changed');
    const agent = await call('story.start', { title: 'By an agent', lines: [{ stage: 'once', text: 'A start.' }, { stage: 'oneday', text: 'A turn.' }] });
    const ag = (await call('story.get', {})).data.story;
    const bad = await call('story.start', { lines: [{ stage: 'climax', text: 'x' }] }), bad2 = await call('story.start', { lines: 'once' });
    check('wizard.agent_door', agent.ok && ag.beats.length === 2 && ag.beats[1].joint === 'but' && ag.beats.every(b => b.by === 'agent') && bad.class === 'invalid' && bad2.class === 'invalid', { agent: agent.class, bad: bad.class, bad2: bad2.class });
    await call('undo', {});
  }
  check('page.no_errors', errors.length === 0, errors);
  await ctx.close();
}


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
// a JSON reply from an intercepted local server or provider, with the CORS header a browser needs
const reply = (body) => ({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
const P = CORE.READ_PROMPTS, whole = P.whole(prose), emptyScenes = P.scenes('', 1, 1);
const labelsP = P.labels(FIX.beats.map(b => ({ summary: b.summary, fortune: b.fortune, introduces: [], uses: [] })));
const twoPassInput = Math.max(tok(labelsP.system + '\n' + labelsP.user), tok(emptyScenes.system + '\n' + emptyScenes.user) + 420) + 40;
check('read.fixture_forces_two_pass', twoPassInput < tok(whole.system + '\n' + whole.user), { twoPassInput, whole: tok(whole.system + '\n' + whole.user) });
// the stand-ins answer whole / split / scenes / labels prompts from the fixture; Nano runs it in the page, LM Studio in Node
const answerFor = (fix, user) => {
  // one row per prompt the page sends: write mode (questions, options, tidbits, sketch, joints), then read mode
  const rows = [
    [() => user.startsWith('Ask the writer'), () => { return { questions: [{ principle: 'stakes', question: 'What does Tavi lose if the boats never come?' }, { principle: 'nonsense', question: 'Ignored: no such principle.' }, { principle: 'earn', question: 'Who gets him out: luck or his own choice?' }] }; }],
    [() => /^Beat \d+: what could happen here/.test(user), () => { return { obvious: 'Tavi rings the bell and saves everyone.', options: [{ text: 'The bell cracks and Tavi must whistle from the rock.', joint: 'but', fortune: -3, principle: 'stakes', why: 'Raises the cost.' }, { text: 'Oren is too ill to climb, so Tavi goes alone.', joint: 'therefore', fortune: -1, principle: 'earn', why: 'His choice.' }, { text: '', joint: 'but', fortune: 0, principle: 'care', why: 'dropped: no text' }, { text: 'The fog lifts on its own.', joint: 'sideways', fortune: 9, principle: 'luck', why: 'Coerced.' }, { text: 'Named, not id.', joint: 'but', fortune: -1, principle: 'Make it hard', why: 'A name maps to its id.' }, { text: 'A list of ids.', joint: 'therefore', fortune: -2, principle: 'nonsense, plant, two', why: 'The first valid id is kept.' }] }; }],
    [() => user.startsWith('You interview the writer'), () => ({ place: 1, question: 'What is on the rock the morning after the storm?', lands: 'BEAT' })],
    [() => / is thin\. Suggest 2 to 4 ways/.test(user), () => ({ suggestions: [{ kind: 'tidbit', text: 'The smell of wet rope in the tower.', why: 'Grounds the place.' }, { kind: 'plant', text: 'Oren hums while he climbs.', why: 'Pays off as rhythm.' }, { kind: 'prose', text: 'Dropped: not a kind.', why: '' }, { kind: 'question', text: '', why: 'Dropped: empty.' }] })],
    [() => user.startsWith('The writer wants to add this plot element'), () => ({ changes: [{ op: 'insert', beat: 6, stage: 'because', joint: 'but', fortune: -4, label: 'Ama\'s boat loses its mast.', why: 'The element forces it.' }, { op: 'relabel', beat: 7, stage: '', joint: 'but', fortune: -5, label: '', why: 'Now despite the mast.' }, { op: 'remove', beat: 2, stage: '', joint: '', fortune: 0, label: '', why: 'Not an op.' }] })],
    [() => user.startsWith('The writer keeps tidbits'), () => { const n = (user.match(/^Tidbit \d+:/gm) || []).length; return { placements: [{ tidbit: 1, beat: 2, as: 'Character', how: 'Oren keeps the bell rope greased with fish fat.', why: 'Shows his care.' }, { tidbit: n + 1, beat: 1, as: 'beat', how: 'Out of range.', why: '' }, { tidbit: 2, beat: 99, as: 'setting', how: 'No such beat.', why: '' }, { tidbit: 1, beat: 3, as: 'beat', how: 'A second placement for the same tidbit is dropped.', why: '' }] }; }],
    [() => user.startsWith('The writer sketched'), () => { const ats = [...user.matchAll(/^Beat (\d+): fortune/gm)].map(m => +m[1]); return { moves: [...ats.map(n => ({ beat: n, text: `A turn that moves beat ${n} toward the sketch.`, why: 'Follows the shape.' })), { beat: 99, text: 'Out of range.', why: '' }] }; }],
    [() => user.startsWith('For every beat that the writer joined'), () => { const n = (user.match(/^Beat \d+/gm) || []).length; return { joints: [{ beat: 5, verdict: 'slack', reason: 'It follows; nothing causes it.', question: 'What makes the fog come now?' }, { beat: 1, verdict: 'holds', reason: 'Beat 1 has no joint.', question: '' }, { beat: 3, verdict: 'slack', reason: 'Beat 3 has no labelled joint.', question: '' }, { beat: n + 3, verdict: 'holds', reason: 'Out of range.', question: '' }, { beat: 6, verdict: 'HOLDS', reason: 'Because of the storm.', question: 'Fine.' }] }; }],
    [() => user.startsWith('This is chapter'), () => { const i = +user.match(/^This is chapter (\d+)/)[1]; return { summary: fix.beats[i - 1].summary, fortune: fix.beats[i - 1].fortune, introduces: [], uses: [] }; }],
    [() => user.startsWith('Mark the structure'), () => { return fix.whole; }],
    [() => user.startsWith('Split this story'), () => { return { beats: fix.beats.map(b => ({ start: b.start })) }; }],
    [() => user.startsWith('Here is a story split into numbered beats'), () => { const n = (user.match(/^Beat \d+:/gm) || []).length; return { title: 'The whistle', beats: fix.beats.slice(0, n).map((b, k) => ({ beat: k + 1, ...b.labels })), threads: fix.threads.map(t => ({ label: t.label, plant_beat: t.plant_scene, payoff_beats: t.payoff_scenes })) }; }],
    [() => user.startsWith('This is part'), () => { const part = user.slice(user.indexOf(':\n', user.lastIndexOf('PART ')) + 2); return { scenes: fix.beats.filter(b => part.includes(b.start)).map(b => ({ start: b.start, summary: b.summary, fortune: b.fortune, introduces: [], uses: [] })) }; }],
  ];
  for (const [is, answer] of rows) if (is()) return answer();
  const n = (user.match(/^Scene \d+/gm) || []).length;
  return { title: 'The whistle', beats: fix.beats.slice(0, n).map((b, k) => ({ scene: k + 1, ...b.labels })), threads: fix.threads };
};
// the stand-in: Chrome's LanguageModel surface
const fakeNano = ({ FIX: fix, windowTokens, hang, late }, answerWith) => {
  window.__nanoCalls = [];
  const answer = (user) => answerWith(fix, user);
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
  if (opts && opts.nano) await ctx2.addInitScript({ content: `(${fakeNano})(${JSON.stringify({ FIX, windowTokens: opts.nano, hang: !!opts.hang, late: !!opts.late })}, ${answerFor});` });
  else await ctx2.addInitScript(() => { delete window.LanguageModel; });   // a browser without Gemini Nano
  await ctx2.addInitScript(() => { try { localStorage.setItem('sandhi:intro-seen', '1'); } catch { /* fine */ } });
  const p = await ctx2.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto(base); await p.evaluate(() => window.sandhi.ready);
  if (opts && opts.nano && !opts.noSelect) await p.evaluate(() => window.sandhi.tools['reader.select']({ rung: 'device' }));   // nothing reads until the writer chooses
  return { ctx2, p, errs, call: (n, a) => p.evaluate(([x, y]) => window.sandhi.tools[x](y), [n, a]) };
}
{ // write mode (Batch C): questions, then options for a beat, then joint verdicts; nothing enters the story
  const { ctx2, p, errs, call } = await readPage({ nano: 6144 });
  const before = JSON.stringify((await call('story.get', {})).data.story);
  const sb = (await call('story.get', {})).data.story, b3 = sb.beats[2].id;
  await p.click(`#beat-${b3} [data-ui="ask-q"]`);
  await p.waitForFunction((id) => /Questions from gemini-nano/.test(document.querySelector(`[data-sg="${id}"]`).textContent), b3);
  const qPanel = await p.textContent(`[data-sg="${b3}"]`), q = (await call('write.get', {})).data;
  check('write.questions', q.kind === 'questions' && q.beat === b3 && q.questions.length === 3 && q.questions[1].principle === null && /What does Tavi lose/.test(qPanel) && /Make it hard/.test(qPanel) && /What could happen here/.test(qPanel), { q, qPanel: qPanel.slice(0, 160) });
  await p.click(`[data-sg="${b3}"] [data-ui="ask-o"]`);
  await p.waitForFunction((id) => /Options from gemini-nano/.test(document.querySelector(`[data-sg="${id}"]`).textContent), b3);
  const oPanel = await p.textContent(`[data-sg="${b3}"]`), o = (await call('write.get', {})).data;
  const writes = await p.evaluate((id) => document.querySelectorAll(`[data-sg="${id}"] button`).length && [...document.querySelectorAll(`[data-sg="${id}"] button`)].map(x => x.textContent.trim()), b3);
  check('write.options_proposals_only', o.kind === 'options' && o.options.length === 5 && o.options[3].principle === 'stakes' && o.options[4].principle === 'plant' && o.obvious.startsWith('Tavi rings') && o.options[2].joint === null && o.options[2].fortune === 5 && o.options[2].principle === null
    && /set aside/.test(oPanel) && /Write the beat yourself/.test(oPanel) && JSON.stringify(writes) === JSON.stringify(['Ask again', 'Close']) && JSON.stringify((await call('story.get', {})).data.story) === before, { o, writes });
  // the prompt carries the story's structure and marks the asked beat
  const prompt = await p.evaluate(() => window.SandhiCore.WRITE_PROMPTS.options(window.SandhiCore.storyBrief(window.sandhi && window.SandhiCore.seed(), 2, 0), 3).user);
  check('write.prompt_marks_beat', /Beat 3 \(THE BEAT ASKED ABOUT\)/.test(prompt) && /obvious/.test(prompt) && /things get worse/.test(prompt) && /Thread "/.test(prompt), prompt.slice(0, 120));
  await p.click(`[data-sg="${b3}"] [data-cmd="write.dismiss"]`);
  const closed = (await p.textContent(`[data-sg="${b3}"]`)).trim() === '' && (await call('write.get', {})).class === 'no_proposal';
  check('write.dismiss', closed, closed);
  await p.click('#checks [data-ui="ask-joints"]');
  await p.waitForFunction(() => /on your joints/.test(document.querySelector('#checks').textContent));
  const j = (await call('write.get', {})).data, jText = await p.textContent('#checks');
  const sj = (await call('story.get', {})).data.story;
  check('write.joints_advise', j.kind === 'joints' && JSON.stringify(j.joints.map(x => [x.at, x.joint, x.verdict])) === JSON.stringify([[5, 'but', 'slack'], [6, 'therefore', 'holds']]) && /Reads as “and then”/.test(jText) && /advice, not a relabel/.test(jText) && JSON.stringify(sj) === before, { j, n: sj.beats.length });
  const badBeat = await call('write.options', { beat: 'nope' });
  check('write.unknown_beat', badBeat.class === 'not_found', badBeat);
  check('write.no_errors', errs.length === 0, errs);
  await ctx2.close();
}
{ // tidbits (Batch D): keep one from the panel, place it in a beat, a removed beat unplaces it, the agent door does the same
  const { ctx2, p, errs, call } = await readPage({});
  await p.fill('#tidbit-add input', 'Meat kept too long gets freezer burn.'); await p.click('#tidbit-add button');
  await p.waitForFunction(() => /Tidbits · 1, 1 unplaced/.test(document.querySelector('#tidbits-h').textContent));
  const k = (await call('story.get', {})).data.story.tidbits[0], b4 = (await call('story.get', {})).data.story.beats[3].id;
  await p.selectOption(`#tidbits select[data-tidbit="${k.id}"]`, b4);
  await p.waitForFunction(() => /in beat 4/.test(document.querySelector('#tidbits').textContent));
  const placed = (await call('story.get', {})).data.story.tidbits[0].placed;
  await call('beat.remove', { id: b4 });
  const unplaced = (await call('story.get', {})).data.story.tidbits[0].placed;
  await call('undo', {});
  const restored = (await call('story.get', {})).data.story.tidbits[0].placed;
  const ag = await call('tidbit.add', { text: 'A curious train stop.', note: 'Shimla line' }), empty = await call('tidbit.add', { text: '  ' });
  const ghost = await call('tidbit.update', { id: ag.data.id, patch: { placed: ['nope'] } }), unknown = await call('tidbit.update', { id: ag.data.id, patch: { where: 'x' } });
  const rm = await call('tidbit.remove', { id: ag.data.id }), missing = await call('tidbit.remove', { id: 'k99' });
  check('tidbits.ledger', k.text.startsWith('Meat') && JSON.stringify(placed) === JSON.stringify([b4]) && unplaced.length === 0 && JSON.stringify(restored) === JSON.stringify([b4])
    && ag.ok && empty.class === 'invalid' && ghost.class === 'invalid' && unknown.class === 'invalid' && rm.ok && missing.class === 'not_found', { placed, unplaced, restored, empty: empty.class, ghost: ghost.class });
  check('tidbits.no_errors', errs.length === 0, errs);
  await ctx2.close();
}
{ // interview loop and depth (Batch D): one question on the weakest place; the writer's answer lands where they send it
  const { ctx2, p, errs, call } = await readPage({ nano: 6144 });
  const s0 = (await call('story.get', {})).data.story;
  await call('beat.add', { after: s0.beats[9].id });                                  // an empty beat: the weakest place
  const empty = (await call('story.get', {})).data.story.beats[10];
  await p.click('[data-ui="ask-interview"]');
  await p.waitForFunction(() => /What is on the rock/.test(document.querySelector('#interview-sg').textContent));
  const g = (await call('write.get', {})).data, places = await p.evaluate((st) => window.SandhiCore.weakPlaces(st), (await call('story.get', {})).data.story);
  await p.fill('#iv-answer', 'Gulls on the rope, and the bell still wet.');
  await p.click('[data-ui="iv-beat"]');
  await p.waitForFunction((id) => window.sandhi && document.querySelector(`#beat-${id} textarea.btext`).value.includes('Gulls on the rope'), empty.id);
  await p.waitForFunction(() => /What is on the rock/.test(document.querySelector('#interview-sg').textContent));   // the next question
  await p.fill('#iv-answer', 'A fisherman who counts bell strokes under his breath.');
  await p.click('[data-ui="iv-tidbit"]');
  await p.waitForFunction(() => /Tidbits · 1/.test(document.querySelector('#tidbits-h').textContent));
  const st = (await call('story.get', {})).data.story;
  check('write.interview_lands', g.kind === 'interview' && g.interview.lands === 'beat' && g.interview.place.beat === empty.id && places[0].beat === empty.id
    && st.beats[10].text === 'Gulls on the rope, and the bell still wet.' && st.tidbits[0].text.startsWith('A fisherman'), { g, places: places.slice(0, 2) });
  await call('write.dismiss', {});
  await p.click(`#beat-${s0.beats[2].id} [data-ui="ask-q"]`); await p.waitForSelector(`[data-sg="${s0.beats[2].id}"] [data-ui="ask-depth"]`);
  await p.click(`[data-sg="${s0.beats[2].id}"] [data-ui="ask-depth"]`);
  await p.waitForFunction((id) => /ways to give this beat depth/.test(document.querySelector(`[data-sg="${id}"]`).textContent), s0.beats[2].id);
  const d = (await call('write.get', {})).data;
  check('write.depth', d.kind === 'depth' && d.suggestions.length === 2 && d.suggestions.map(x => x.kind).join() === 'tidbit,plant' && JSON.stringify((await call('story.get', {})).data.story.beats[2]) === JSON.stringify(st.beats[2]), d);
  check('write.interview_no_errors', errs.length === 0, errs);
  await ctx2.close();
}
{ // plot elements (Batch D): the reader proposes structural changes as a diff; only the writer's real click applies them
  const { ctx2, p, errs, call } = await readPage({ nano: 6144 });
  const before = (await call('story.get', {})).data.story;
  await p.fill('#plot-add input', "Ama's boat loses its mast in the fog."); await p.click('#plot-add button');
  await p.waitForFunction(() => /changes to weigh/.test(document.querySelector('#plot-sg').textContent));
  const g = (await call('write.get', {})).data, panel = await p.textContent('#plot-sg');
  const agent = await call('write.apply', { id: g.id });
  await p.evaluate(() => document.querySelector('[data-ui="plot-apply"]').click());   // a scripted click is not the writer's
  await p.waitForTimeout(200);
  const still = (await call('story.get', {})).data.story;
  if (await p.locator('[data-ui="plot-apply"]').count()) { await p.click('[data-ui="plot-apply"]'); await p.waitForFunction(() => document.querySelector('#plot-sg').textContent.trim() === ''); }
  const after = (await call('story.get', {})).data.story, nb = after.beats.find(b => b.label === "Ama's boat loses its mast.");
  await call('undo', {});
  const undone = (await call('story.get', {})).data.story;
  check('write.plot_diff', g.kind === 'plot' && g.changes.length === 2 && /new beat after 6/.test(panel) && /empty, for you to write/.test(panel) && /joint therefore → but/.test(panel), { g, panel: panel.slice(0, 200) });
  check('write.apply_person_only', agent.class === 'person_only' && JSON.stringify(still) === JSON.stringify(before) && after.beats.length === before.beats.length + 1 && nb && nb.text === '' && nb.by === 'model'
    && after.beats[after.beats.indexOf(nb) - 1].id === before.beats[5].id && after.beats.find(b => b.id === before.beats[6].id).joint === 'but' && JSON.stringify(undone) === JSON.stringify(before), { agent: agent.class, n: after.beats.length });
  check('write.plot_no_errors', errs.length === 0, errs);
  await ctx2.close();
}
{ // tidbit placement (Batch D): the reader proposes a beat for each unplaced tidbit; the writer places it with one click
  const { ctx2, p, errs, call } = await readPage({ nano: 6144 });
  await call('tidbit.add', { text: 'Meat kept too long gets freezer burn.' }); await call('tidbit.add', { text: 'A curious train stop.', note: 'Shimla line' });
  await p.click('#tidbits [data-ui="ask-place"]');
  await p.waitForFunction(() => /where your tidbits could live/.test(document.querySelector('#tidbit-sg').textContent));
  const g = (await call('write.get', {})).data, before = (await call('story.get', {})).data.story;
  await p.click('#tidbit-sg button[data-cmd="tidbit.update"]');
  await p.waitForFunction(() => /in beat 2/.test(document.querySelector('#tidbits ul').textContent));
  const after = (await call('story.get', {})).data.story;
  const sb = await p.evaluate((st) => window.SandhiCore.storyBrief(st, -1, 3), after);
  check('write.place', g.kind === 'place' && g.placements.length === 1 && g.placements[0].as === 'character' && g.placements[0].at === 2 && JSON.stringify(before.beats) === JSON.stringify(after.beats)
    && JSON.stringify(after.tidbits[0].placed) === JSON.stringify([after.beats[1].id]) && /Tidbit \(the writer's own observation\): Meat kept too long gets freezer burn\. — placed in beat 2/.test(sb), { g, placed: after.tidbits[0].placed });
  const none = await call('tidbit.update', { id: after.tidbits[1].id, patch: { placed: [after.beats[0].id] } }), nothing = await call('write.place', {});
  check('write.place_needs_unplaced', none.ok && nothing.class === 'invalid', nothing);
  check('write.place_no_errors', errs.length === 0, errs);
  await ctx2.close();
}
{ // novel scale in the editor (Batch E): chapter headers over beats, fold a chapter, the thread ledger per chapter
  const { ctx2, p, errs, call } = await readPage({});
  const s0 = (await call('story.get', {})).data.story;
  for (const [i, b] of s0.beats.entries()) await call('beat.update', { id: b.id, patch: { chapter: i < 3 ? 'The island' : i < 6 ? 'The storm' : 'The bell' } });
  const heads = await p.$$eval('#beats h3.chap', hs => hs.map(h => h.textContent.trim()));
  await p.click('#beats h3.chap button[data-name="The island"]');
  const cards = await p.$$eval('#beats article.beat', a => a.length);
  const allThreads = await p.$$eval('#threads ul li', l => l.length);
  await p.selectOption('#thread-chapter', 'The storm');
  const islandThreads = await p.$$eval('#threads ul li', l => l.length);
  const touches = s0.threads.filter(t => [t.plant, ...t.payoffs].some(id => { const k = s0.beats.findIndex(b => b.id === id); return k >= 3 && k < 6; })).length;
  check('chapters.editor', heads.length === 3 && /^▾ The island\s+beats 1–3/.test(heads[0]) && /The storm\s+beats 4–6/.test(heads[1]) && /The bell\s+beats 7–10/.test(heads[2]) && cards === 7 && islandThreads === touches && allThreads === s0.threads.length, { heads, cards, allThreads, islandThreads, touches });
  check('chapters.no_errors', errs.length === 0, errs);
  await ctx2.close();
}
{ // the learn dialog (Batch G): the 13 principles with their sources and this story's beats; Focus opens one; learn.get for agents
  const { ctx2, p, errs, call } = await readPage({});
  await p.click('.storymenu summary'); await p.click('[data-ui="learn"]');
  await p.waitForFunction(() => document.querySelector('#learn').open);
  const items = await p.$$eval('#learn-list li', l => l.map(x => x.textContent));
  await p.click('#learn-list [data-ui="learn-focus"][data-id="earn"]');
  await p.waitForFunction(() => !document.querySelector('#learn').open && /Earn the ending/.test(document.querySelector('#panel').textContent));
  const one = await call('learn.get', { principle: 'earn' }), bad = await call('learn.get', { principle: 'nope' }), all = await call('learn.get', {});
  check('learn.dialog_and_tool', items.length === 13 && items.every(t => /source/.test(t)) && /in your story: beat/.test(items.join(' ')) && one.ok && one.data.principles.length === 1 && one.data.principles[0].sources.length >= 2
    && bad.class === 'invalid' && all.data.principles.length === 13 && all.data.arcs.length === 6, { n: items.length, one: one.data && one.data.principles[0].name, bad: bad.class });
  check('learn.no_errors', errs.length === 0, errs);
  await ctx2.close();
}
{ // the second UX review's quick wins (2026-10-06b): toasts over dialogs, hidden filter, a visible tour Skip, no old plot text, copy
  const { ctx2, p, errs, call } = await readPage({});
  await p.click('[data-ui="read-open"]'); await p.waitForFunction(() => document.querySelector('#reader').open);
  await p.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array([137, 80, 78, 71, 0, 1])], 'picture.png', { type: 'image/png' })); document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); });
  await p.waitForFunction(() => /picture\.png/.test(document.querySelector('#toast').textContent));
  const overDialog = await p.evaluate(() => document.querySelector('#toast').matches(':popover-open'));
  await p.fill('#read-text', ''); await p.click('#read-actions [data-ui="read-run"]');
  const asksStory = await p.textContent('#read-msg1');
  await p.click('[data-ui="read-close"]');
  const filterShown = await p.evaluate(() => document.querySelector('.chapfilter').checkVisibility());
  await p.fill('#plot-add input', 'Ama loses the mast'); await call('story.demo', {});
  const plotAfter = await p.inputValue('#plot-add input');
  const noReader = await call('write.questions', { beat: 'b1' });
  await p.click('[data-ui="help"]'); await p.click('#splash [data-ui="tour"]');
  const skip = await p.evaluate(() => { const b = document.querySelector('.tour-actions .tour-skip'); const r = b && b.getBoundingClientRect(); return !!r && r.left >= 0 && r.width > 0; });
  await p.keyboard.press('Escape');
  check('ux2b.quick_wins', overDialog && /Paste the story here first/.test(asksStory) && !filterShown && plotAfter === '' && !/reader\.select/.test(noReader.next) && skip, { overDialog, asksStory, filterShown, plotAfter, next: noReader.next, skip });
  check('ux2b.no_errors', errs.length === 0, errs);
  await ctx2.close();
}
{ // the reader chip (Batch X, UX review 2026-10-06b H2): it says who reads; a write ask with no reader offers Choose a reader, and Done runs it
  const { ctx2, p, errs } = await readPage({ nano: 6144, noSelect: true });
  const before = (await p.textContent('#reader-chip')).trim();
  await p.click('#beat-b3 [data-ui="ask-q"]');
  await p.waitForFunction(() => document.querySelector('#reader').open);
  const mode = await p.evaluate(() => ({ title: document.querySelector('#reader-h').textContent, storyStep: document.querySelector('#reader .rstep').checkVisibility(), done: document.querySelector('#reader-done').checkVisibility(), read: document.querySelector('#read-actions [data-ui="read-run"]').checkVisibility() }));
  await p.click('#other-readers summary'); await p.check('#reader input[value="device"]');
  await p.click('#reader-done');
  await p.waitForFunction(() => /Questions from gemini-nano/.test(document.querySelector('[data-sg="b3"]').textContent));
  const after = (await p.textContent('#reader-chip')).trim();
  await p.click('#reader-chip'); await p.waitForFunction(() => document.querySelector('#reader').open);
  await p.click('[data-ui="read-close"]'); await p.click('[data-ui="read-open"]'); await p.waitForFunction(() => document.querySelector('#reader').open);
  const importBack = await p.evaluate(() => ({ title: document.querySelector('#reader-h').textContent, storyStep: document.querySelector('#reader .rstep').checkVisibility() }));
  check('reader.chip_choose_and_return', before === 'Choose an AI reader' && mode.title === 'Who reads your story' && !mode.storyStep && mode.done && !mode.read && after === 'Gemini Nano' && importBack.title === 'Import a story' && importBack.storyStep, { before, mode, after, importBack });
  check('reader.chip_no_errors', errs.length === 0, errs);
  await ctx2.close();
}
{ // chapters and tidbits from the top (Batch X, UX reviews 2026-10-06b: Claude M1, codex M3, M2)
  const { ctx2, p, errs, call } = await readPage({ ctx: { viewport: { width: 390, height: 844 } } });
  await p.click('#beat-b4 details.menu summary'); await p.click('#beat-b4 [data-ui="chapter-here"]');
  await p.fill('[data-chapform="b4"] input', 'The storm'); await p.press('[data-chapform="b4"] input', 'Enter');
  await p.waitForFunction(() => document.querySelectorAll('#beats h3.chap').length === 1);
  const st = (await call('story.get', {})).data.story.beats.map(b => b.chapter || '');
  const second = await call('chapter.start', { beat: 'b8', name: 'The bell' }), s2 = (await call('story.get', {})).data.story.beats.map(b => b.chapter || '');
  const end = await call('chapter.start', { beat: 'b8', name: '' }), s3 = (await call('story.get', {})).data.story.beats.map(b => b.chapter || '');
  const names = await p.$$eval('#chapter-names option', o => o.map(x => x.value));
  await p.click('.storymenu summary'); await p.click('[data-ui="jump-tidbits"]');
  const focus = await p.evaluate(() => document.activeElement === document.querySelector('#tidbit-add input'));
  check('chapters.start_here', JSON.stringify(st) === JSON.stringify(['', '', '', 'The storm', 'The storm', 'The storm', 'The storm', 'The storm', 'The storm', 'The storm'])
    && second.ok && JSON.stringify(s2.slice(7)) === JSON.stringify(['The bell', 'The bell', 'The bell']) && s2[6] === 'The storm' && end.ok && JSON.stringify(s3.slice(7)) === JSON.stringify(['', '', '']) && names.includes('The storm') && focus, { st, s2, s3, names, focus });
  check('chapters.start_no_errors', errs.length === 0, errs);
  await ctx2.close();
}
{ // the Claude review's small findings (Batch Y): saved survives a reload, the first edit of the example says so once, phone layout
  const { ctx2, p, errs, call } = await readPage({ ctx: { acceptDownloads: true, viewport: { width: 390, height: 844 } } });
  await call('beat.update', { id: 'b1', patch: { fortune: 2 } });             // an agent edit: no note
  const agentNote = await p.textContent('#toast');
  await call('undo', {});
  await p.click('#beat-b2 [data-more="b2"] > summary'); await p.focus('#beat-b2 [data-focus="mark:b2:turn"]'); await p.keyboard.press('Space');
  await p.waitForFunction(() => /changing the example/.test(document.querySelector('#toast').textContent));
  await p.focus('#beat-b2 [data-focus="mark:b2:turn"]'); await p.keyboard.press('Space');
  const again = /changing the example/.test(await p.textContent('#toast')) && (await p.evaluate(() => document.querySelector('#toast').classList.contains('show')));
  const dl = p.waitForEvent('download'); await call('story.save', {}); await dl;
  await p.reload(); await p.evaluate(() => window.sandhi.ready);
  const saved = await p.textContent('#savestate');
  const phone = await p.evaluate(() => ({ dir: getComputedStyle(document.querySelector('.plotadd')).flexDirection, link: document.querySelector('[data-ui="ask-q"]').getBoundingClientRect().height, toastTop: getComputedStyle(document.querySelector('#toast')).top }));
  check('ux2b.small_findings', !/changing the example/.test(agentNote) && /Downloaded/.test(saved) && phone.dir === 'column' && phone.link >= 24 && phone.toastTop === '12px', { agentNote, again, saved, phone });
  check('ux2b.small_no_errors', errs.length === 0, errs);
  await ctx2.close();
}
{ // the third UX review (codex 2026-10-08): Done waits for a ready reader; the phone shows the status row; the plot draft survives a reload
  const { ctx2, p, errs } = await readPage({ nano: 6144, noSelect: true, ctx: { viewport: { width: 390, height: 844 } } });
  const status = await p.evaluate(() => { const e = document.querySelector('#savestate'); return { vis: e.checkVisibility(), text: e.textContent }; });
  await p.click('#beat-b3 [data-ui="ask-q"]'); 
  await p.waitForFunction(() => document.querySelector('#reader').open);
  const waits = await p.textContent('#reader-need');
  await p.click('#reader-done');
  const stillOpen = await p.evaluate(() => ({ open: document.querySelector('#reader').open, need: document.querySelector('#reader-need').textContent }));
  await p.click('[data-ui="read-close"]');
  await p.fill('#plot-add input', 'Ama loses the mast'); await p.reload(); await p.evaluate(() => window.sandhi.ready);
  const draft = await p.inputValue('#plot-add input');
  check('ux3.codex_fixes', status.vis && /example/i.test(status.text) && /A question waits/.test(waits) && stillOpen.open && /Choose who reads it first/.test(stillOpen.need) && draft === 'Ama loses the mast', { status, waits, stillOpen, draft });
  check('ux3.no_errors', errs.length === 0, errs);
  await ctx2.close();
}
{ // the third UX review (Claude 2026-10-08): chip names an absent server, Checks counts what it lists, Recent omits the open story,
  // an empty chapter name says so and Esc cancels, How stories work takes focus, the joint stays above a chapter heading
  const { ctx2, p, errs, call } = await readPage({});
  await p.route('http://127.0.0.1:*/**', (route) => route.abort());
  await call('reader.select', { rung: 'machine' }); await call('reader.status', { probe: true });
  await p.waitForFunction(() => /not found/.test(document.querySelector('#reader-chip').textContent));
  const chip = await p.textContent('#reader-chip');
  await call('beat.update', { id: 'b4', patch: { tags: [] } }); await call('beat.update', { id: 'b5', patch: { tags: [] } }); await call('beat.update', { id: 'b6', patch: { tags: [] } });
  const counts = await p.evaluate(() => ({ head: document.querySelector('#checks-h').textContent, items: document.querySelectorAll('#checks li').length }));
  await call('story.new', {}); await call('undo', {});
  const recent = await p.$$eval('#recent button', b => b.map(x => x.textContent));
  await p.click('#beat-b4 details.menu summary'); await p.click('#beat-b4 [data-ui="chapter-here"]');
  await p.press('[data-chapform="b4"] input', 'Enter');
  const emptyMsg = await p.textContent('[data-chapform="b4"] .reader-need');
  await p.press('[data-chapform="b4"] input', 'Escape');
  const formGone = await p.evaluate(() => !document.querySelector('[data-chapform]'));
  await call('chapter.start', { beat: 'b4', name: 'The storm' });
  const order = await p.evaluate(() => { const h = document.querySelector('#beats h3.chap'), j = h.previousElementSibling; return j && j.classList.contains('joint'); });
  await p.click('.storymenu summary'); await p.click('[data-ui="learn"]');
  const learnFocus = await p.evaluate(() => document.activeElement && document.activeElement.dataset.ui);
  await p.click('[data-ui="learn-close"]');
  check('ux3.claude_fixes', chip.trim() === 'Model server · not found' && counts.head === `Checks · ${counts.items} to look at` && !recent.some(t => t.startsWith('The whistle')) && /Name the chapter first/.test(emptyMsg) && formGone && order && learnFocus === 'learn-close',
    { chip, counts, recent, emptyMsg, formGone, order, learnFocus });
  check('ux3.claude_no_errors', errs.length === 0, errs);
  await ctx2.close();
}
{ // the fourth UX review (codex 2026-10-09): the wizard closes by touch and keeps its answers, the reader's wait message names the
  // button it shows, a paragraph split hides the reader step until "Read it with a model", a phone joint is a 44 px target
  const { ctx2, p, errs, call } = await readPage({ ctx: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } });
  await p.click('[data-ui="wizard"]'); await p.fill('#wiz-text', 'The lighthouse');
  await p.tap('#wizard [data-ui="wiz-close"]');
  const closed = await p.evaluate(() => !document.querySelector('#wizard').open && document.querySelector('h2, #title') !== null);
  const title = (await call('story.get', {})).data.story.title;
  await p.click('[data-ui="wizard"]'); const resumed = await p.inputValue('#wiz-text'); await p.tap('#wizard [data-ui="wiz-close"]');
  const joint = await p.evaluate(() => Math.round(document.querySelector('.joint select').getBoundingClientRect().height));
  await p.click('#beat-b3 [data-ui="ask-q"]');
  await p.waitForFunction(() => document.querySelector('#reader').open);
  await p.click('#reader-done');
  const need = await p.textContent('#reader-need');
  await p.click('[data-ui="read-close"]');
  await p.click('[data-ui="read-open"]'); await p.fill('#read-text', 'One fog morning.\n\nThe boats came home.');
  await p.click('[data-ui="read-paste"]'); await p.waitForSelector('#read-result ol');
  const vis = () => p.evaluate(() => ({ step2: getComputedStyle(document.querySelectorAll('#reader .rstep')[1]).display !== 'none', privacy: getComputedStyle(document.querySelector('#read-privacy')).display !== 'none' }));
  const local = await vis();
  await p.click('#read-actions [data-ui="read-run"]'); const asked = await vis();
  check('ux4.codex_fixes', closed && title === 'The whistle' && resumed === 'The lighthouse' && joint >= 44 && /Cancel drops it/.test(need) && !local.step2 && !local.privacy && asked.step2,
    { closed, title, resumed, joint, need, local, asked });
  check('ux4.codex_no_errors', errs.length === 0, errs);
  await ctx2.close();
}
{ // open threads (Batch D): a planted thread with no payoff can be left open on purpose, by the writer or an agent
  const { ctx2, p, errs, call } = await readPage({});
  const t0 = (await call('story.get', {})).data.story.threads[0];
  await call('thread.update', { id: t0.id, patch: { payoffs: [] } });
  const flagged = (await call('checks', {})).data.items.some(c => c.class === 'plant_unpaid' && c.thread === t0.id);
  await p.check(`#threads input[data-thread="${t0.id}"][data-tfield="open"]`);
  await p.waitForFunction((id) => document.querySelector(`#threads input[data-thread="${id}"][data-tfield="open"]`).checked && !document.querySelector('#checks').textContent.includes('never pays off'), t0.id);
  const after = (await call('story.get', {})).data.story.threads[0], dot = await p.getAttribute('#threads .tstate.left', 'title');
  const agentOff = await call('thread.update', { id: t0.id, patch: { open: false } }), badType = await call('thread.update', { id: t0.id, patch: { open: 'yes' } });
  const back = (await call('checks', {})).data.items.some(c => c.class === 'plant_unpaid' && c.thread === t0.id);
  check('thread.left_open', flagged && after.open === true && dot === 'left open on purpose' && agentOff.ok && badType.class === 'invalid' && back, { flagged, open: after.open, dot, bad: badType.class, back });
  check('thread.open_no_errors', errs.length === 0, errs);
  await ctx2.close();
}
{ // the fortune sketch (TaleBrush): draw on the chart; it is kept with the story, misses are ringed, the reader proposes moves
  const { ctx2, p, errs, call } = await readPage({ nano: 6144 });
  await p.click('[data-ui="sketch-start"]');
  const box = await p.locator('#chart svg').boundingBox(), geom = await p.evaluate(() => JSON.parse(document.querySelector('#chart').dataset.geom));
  const scale = box.width / (await p.evaluate(() => document.querySelector('#chart svg').viewBox.baseVal.width));
  const at = (t, v) => [box.x + (geom.x0 + (geom.x1 - geom.x0) * t) * scale, box.y + (geom.T + (5 - v) * (geom.B - geom.T) / 10) * scale];
  await p.mouse.move(...at(0, 4)); await p.mouse.down();
  for (let k = 1; k <= 20; k++) await p.mouse.move(...at(k / 20, 4 - 8 * k / 20));   // a straight fall, +4 to -4
  await p.mouse.up();
  await p.waitForFunction(() => document.querySelector('#chart .sketch'));
  const st = (await call('story.get', {})).data.story, rings = await p.evaluate(() => document.querySelectorAll('#chart .miss').length), bar = await p.textContent('#sketchbar');
  const misses = st.beats.filter((b, i) => Math.abs(Math.round(4 - 8 * i / (st.beats.length - 1)) - b.fortune) >= 2).length;
  check('sketch.drawn_kept_ringed', st.sketch && st.sketch.length === 25 && Math.abs(st.sketch[0] - 4) < 0.6 && Math.abs(st.sketch[24] + 4) < 0.6 && rings >= misses - 1 && rings <= misses + 1 && rings > 0 && /ringed/.test(bar), { s0: st.sketch && st.sketch[0], s24: st.sketch && st.sketch[24], rings, misses, bar });
  const fortunes = JSON.stringify(st.beats.map(b => b.fortune));
  await p.click('[data-ui="ask-shape"]');
  await p.waitForFunction(() => /ways toward your sketch/.test(document.querySelector('#sketchbar').textContent));
  const g = (await call('write.get', {})).data, after = (await call('story.get', {})).data.story;
  check('write.shape_proposes', g.kind === 'shape' && g.moves.length === rings && g.moves.every(m => m.at >= 1 && m.at <= after.beats.length && m.target !== m.fortune) && JSON.stringify(after.beats.map(b => b.fortune)) === fortunes, { g, rings });
  await call('undo', {});
  const undone = (await call('story.get', {})).data.story;
  const bad = await call('story.sketch', { points: [{ t: 0.5, v: 1 }] }), none = await call('write.shape', {});
  const agent = await call('story.sketch', { points: [{ t: 0, v: 0 }, { t: 1, v: 0 }] }), cleared = await call('story.sketch', { points: [] });
  check('sketch.undo_agent_clear', undone.sketch === undefined && bad.class === 'invalid' && none.class === 'invalid' && agent.ok && agent.data.sketch.every(v => v === 0) && cleared.ok && (await call('story.get', {})).data.story.sketch === undefined, { bad: bad.class, none: none.class });
  check('sketch.no_errors', errs.length === 0, errs);
  await ctx2.close();
}
{ // write mode with no reader chosen says so; Stop ends an ask and keeps nothing
  const none = await readPage({});
  const sb = (await none.call('story.get', {})).data.story;
  const r = await none.call('write.questions', { beat: sb.beats[0].id });
  check('write.needs_reader', r.class === 'no_reader' && /Import/.test(r.next), r);
  await none.ctx2.close();
  const { ctx2, p, call } = await readPage({ nano: 6144, hang: true });
  await p.evaluate((id) => { window.__w = window.sandhi.tools['write.options']({ beat: id }); }, sb.beats[0].id);
  await p.waitForFunction(() => window.__nanoCalls.length === 1);
  const waiting = await p.textContent(`[data-sg="${sb.beats[0].id}"]`);
  await call('read.cancel', {}); const w = await p.evaluate(() => window.__w);
  check('write.stop', /Asking Gemini Nano/.test(waiting) && w.class === 'cancelled' && (await call('write.get', {})).class === 'no_proposal' && (await p.textContent(`[data-sg="${sb.beats[0].id}"]`)).trim() === '', { waiting, w: w.class });
  await ctx2.close();
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
  const nm = await call('reader.models', {});
  check('read.nano_no_model_list', nm.class === 'no_reader' && /no list of models/.test(nm.message), nm);
  const proto = [await call('reader.select', { provider: 'constructor' }), await call('reader.select', { server: 'toString' }), await call('read.run', { text: prose, rung: 'toString' })];
  check('read.prototype_names_refused', proto.every(x => x.class === 'invalid') && (await call('reader.status', {})).data.provider.id === 'openrouter', proto.map(x => x.class));
  const keyRefused = await call('reader.key', { key: 'x' });
  check('read.key_person_only', keyRefused.class === 'person_only', keyRefused);
  // an agent reads on the device; sending the story to a provider, or choosing one, is the writer's
  const offRun = await call('read.run', { text: prose, rung: 'provider' }), offRung = await call('reader.select', { rung: 'provider' }), offProv = await call('reader.select', { provider: 'openai' });
  check('read.agent_cannot_send_off_device', [offRun, offRung, offProv].every(x => x.class === 'person_only') && (await call('reader.status', {})).data.rung === 'device', [offRun.class, offRung.class, offProv.class]);
  await p.click('[data-ui="read-open"]'); await p.waitForFunction(() => document.querySelector('#reader').open);
  const shown = await p.evaluate(() => document.querySelectorAll('#read-result li').length);
  const measuredNano = await p.textContent('#read-measured');
  check('read.picker_shows_measured', /8 of 8/.test(measuredNano) && /7,082-word/.test(measuredNano), measuredNano);   // Edge-First honesty: the writer sees the floor
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
  await p.waitForFunction(() => /changed after it was shown/.test(document.querySelector('#read-progress').textContent));
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
  const lockedDuring = await p.evaluate(async () => (await navigator.locks.query()).held.filter(l => l.name.startsWith('sandhi-read-')).length);
  const t0 = Date.now(); const c = await call('read.cancel', {}); const r = await p.evaluate(() => window.__pending);
  const after = (await call('status', {})).data.read;
  const lockedAfter = await p.evaluate(async () => (await navigator.locks.query()).held.filter(l => l.name.startsWith('sandhi-read-')).length);
  check('read.holds_web_lock', lockedDuring === 1 && lockedAfter === 0, { lockedDuring, lockedAfter });   // a hidden tab is not frozen mid-read
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
  check('door.model_context', names.length === 48 && !names.includes('sandhi.read.accept') && !names.includes('sandhi.reader.key') && r5.ok && r5.content && r5.content[0].type === 'text' && r5.structuredContent.ok && j5.door === 'modelContext' && j5.tool === 'status', { n: names.length, j5 });
  await ctx5.close();
}
{ // a page opened as a file stores no key: every local file shares its storage
  const ctx6 = await browser.newContext();
  await ctx6.addInitScript(() => { try { localStorage.setItem('sandhi:intro-seen', '1'); } catch { /* fine */ } delete window.LanguageModel; });
  const p6 = await ctx6.newPage(); await p6.goto(new URL('../index.html', import.meta.url).href); await p6.evaluate(() => window.sandhi.ready);
  await p6.click('[data-ui="read-open"]'); await p6.check('#reader input[value="provider"]');
  await p6.fill('#provider-key', 'sk-test-0000-not-a-real-key'); await p6.locator('#provider-key').blur();
  const told = await p6.waitForFunction(() => /opened as a file/.test(document.querySelector('#read-progress').textContent), null, { timeout: 2000 }).then(() => true, () => false);
  const keys6 = (await p6.evaluate(() => window.sandhi.tools['reader.status']({}))).data.keys;
  check('ladder.no_key_on_file_pages', told && keys6.length === 0, { told, keys6 });
  await ctx6.close();
}
// Past one call. Each beat of The whistle is padded so the story outgrows an 8,192-token LM Studio window (the smallest
// the machine rung accepts); the fixture still finds every beat by its opening words.
const FILL = ' The wind kept on over the snow and nobody spoke of it.'.repeat(40);
const longBeats = SEED.beats.map(b => b.text + FILL), longProse = longBeats.join('\n\n'), longWhole = P.whole(longProse);
check('read.long_fixture_outgrows_window', tok(longWhole.system + '\n' + longWhole.user) > 4096, tok(longWhole.system + '\n' + longWhole.user));
// a stand-in LM Studio on 127.0.0.1:1234 that loaded its model with a `win`-token window; Ollama is not running
async function lmStudioPage(win) {
  const page = await readPage({}), kinds = [];
  await page.p.route('http://127.0.0.1:11434/**', (route) => route.abort());
  await page.p.route('http://127.0.0.1:1234/**', async (route) => {
    const q = route.request();
    if (new URL(q.url()).pathname === '/api/v0/models') return route.fulfill(reply({ data: [{ id: 'stand-in', loaded_context_length: win }] }));
    if (q.method() === 'GET') return route.fulfill(reply({ object: 'list', data: [{ id: 'stand-in' }] }));
    const user = JSON.parse(q.postData()).messages.at(-1).content; kinds.push(user.slice(0, 12));
    return route.fulfill(reply({ model: 'stand-in', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(answerFor(FIX, user)) } }] }));
  });
  await page.call('reader.select', { rung: 'machine', server: 'lmstudio', model: 'stand-in' });
  return { ...page, kinds };
}
{ // split on a story that only just fits whole: its labelling call would not fit, so it reads in parts (forward pass L10)
  const { ctx2, call } = await lmStudioPage(tok(longWhole.system + '\n' + longWhole.user) + 4096);
  const r = await call('read.run', { text: longProse, strategy: 'split' });
  check('read.split_too_long_reads_in_parts', r.ok && r.data.mode === 'two-pass', r.data || r);
  await ctx2.close();
}
{ // a window too small for the whole story: parts, then the outline
  const { ctx2, errs, call, kinds } = await lmStudioPage(8192);
  const r = await call('read.run', { text: longProse });
  const story = (await call('read.get', {})).data.story;
  check('read.two_pass', r.ok && r.data.mode === 'two-pass' && r.data.calls === kinds.length && kinds.length >= 3 && r.data.beats === 10 && story.beats.every((b, i) => b.text === longBeats[i]) && story.threads.length === 6, { report: r.data || r, calls: kinds.length });
  check('read.two_pass_no_errors', errs.length === 0, errs);
  await ctx2.close();
}
{ // a novel (Batch E): chapter by chapter, one beat per chapter; stopped mid-read, the next read resumes from the kept chapters
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
  const novel = ROMAN.map((r, i) => `CHAPTER ${r}\n\n${SEED.beats[i].text}${FILL}`).join('\n\n');
  const page = await readPage({}), { p, call, errs } = page, chapterCalls = [];
  let hangAt = 4;
  await p.route('http://127.0.0.1:11434/**', (route) => route.abort());
  await p.route('http://127.0.0.1:1234/**', async (route) => {
    const q = route.request();
    if (new URL(q.url()).pathname === '/api/v0/models') return route.fulfill(reply({ data: [{ id: 'stand-in', loaded_context_length: 8192 }] }));
    if (q.method() === 'GET') return route.fulfill(reply({ object: 'list', data: [{ id: 'stand-in' }] }));
    const user = JSON.parse(q.postData()).messages.at(-1).content;
    if (user.startsWith('This is chapter')) { chapterCalls.push(+user.match(/^This is chapter (\d+)/)[1]); if (chapterCalls.length === hangAt) return new Promise(() => {}); }
    return route.fulfill(reply({ model: 'stand-in', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(answerFor(FIX, user)) } }] }));
  });
  await call('reader.select', { rung: 'machine', server: 'lmstudio', model: 'stand-in' });
  await p.evaluate((text) => { window.__nr = window.sandhi.tools['read.run']({ text }); }, novel);
  await p.waitForFunction(() => true); for (let k = 0; k < 100 && chapterCalls.length < 4; k++) await p.waitForTimeout(50);
  await call('read.cancel', {}); const first = await p.evaluate(() => window.__nr);
  const firstCalls = chapterCalls.length; hangAt = 0;
  const second = await call('read.run', { text: novel });
  const story = (await call('read.get', {})).data.story;
  const left = await p.evaluate(() => new Promise(res => { const q = indexedDB.open('sandhi-reads', 1); q.addEventListener('success', () => { const c = q.result.transaction('parts').objectStore('parts').count(); c.addEventListener('success', () => res(c.result)); }); q.addEventListener('error', () => res(-1)); }));
  check('read.novel_chapters_resume', first.class === 'cancelled' && firstCalls === 4 && second.ok && second.data.mode === 'chapters' && second.data.chapters === 8 && second.data.resumed === 3
    && chapterCalls.slice(4).join() === '4,5,6,7,8' && story.beats.length === 8 && story.beats[0].text.startsWith('CHAPTER I') && story.beats[7].text.startsWith('CHAPTER VIII') && story.beats[7].chapter === 'CHAPTER VIII' && left === 0,
    { first: first.class, firstCalls, second: second.data || second, calls: chapterCalls, beats: story && story.beats.length, left });
  check('read.novel_no_errors', errs.length === 0, errs);
  await page.ctx2.close();
}
{ // Gemini Nano cannot read in parts (SPEC §5): a story that needs them is refused before any prompt, naming the readers that can
  const { ctx2, p, errs, call } = await readPage({ nano: twoPassInput + 3000 });
  const before = (await call('status', {})).data.read;
  const r = await call('read.run', { text: prose });
  const calls = await p.evaluate(() => window.__nanoCalls.length), after = (await call('status', {})).data.read;
  check('read.nano_refuses_parts', r.class === 'too_long' && calls === 0 && /cannot read a story in parts/.test(r.message) && /\d+ words at once/.test(r.message) && /provider/.test(r.next) && /model server/.test(r.next) && after.proposal === before.proposal && !after.reading, { r, calls });
  // split, when the story fits whole but its labelling call would not: Nano reads it whole instead of in parts
  const tight = await readPage({ nano: tok(whole.system + '\n' + whole.user) + 3000 });
  const sp = await tight.call('read.run', { text: prose, strategy: 'split' });
  check('read.nano_split_tight_reads_whole', sp.ok && sp.data.mode === 'whole' && sp.data.calls === 1, sp.data || sp);
  await tight.ctx2.close();
  check('read.nano_refuse_no_errors', errs.length === 0, errs);
  await ctx2.close();
}
{ // the AI ladder, rung 3: your provider and key. Every call is intercepted; the key is a dummy test value and nothing leaves.
  const { ctx2, p, errs, call } = await readPage({});
  const sent = []; let mode = 'ok';
  const TEST_KEY = 'sk-test-0000-not-a-real-key';
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
  // the dialog in three numbered steps; your provider first and recommended; the others folded away until chosen
  await p.click('[data-ui="read-open"]'); await p.waitForFunction(() => document.querySelector('#reader').open);
  const layout = await p.evaluate(() => ({ steps: [...document.querySelectorAll('#reader .rstep h3')].map(h => h.textContent.trim()), first: document.querySelector('#reader input[name=rung]').value,
    recommended: /recommended/.test(document.querySelector('#reader input[value="provider"]').closest('label').textContent), othersOpen: document.querySelector('#other-readers').open,
    machineVisible: document.querySelector('#reader input[value="machine"]').checkVisibility() }));
  // with no reader chosen, the dialog asks for a provider key; Read it puts the cursor in the key field
  const asks = await p.evaluate(() => ({ fields: document.querySelector('#provider-key').checkVisibility(), prompt: document.querySelector('#key-prompt').checkVisibility() }));
  await p.fill('#read-text', prose); await p.click('#read-actions [data-ui="read-run"]');
  const asked = await p.evaluate(() => ({ progress: document.querySelector('#read-progress').textContent, focus: document.activeElement && document.activeElement.id }));
  check('read.prompts_for_key', asks.fields && asks.prompt && /API key in step 2/.test(asked.progress) && asked.focus === 'provider-key' && (await call('status', {})).data.read.proposal === null, { asks, asked });
  check('read.dialog_steps_provider_first', JSON.stringify(layout.steps) === JSON.stringify(['1 Your story', '2 Who reads it', '3 Read']) && layout.first === 'provider' && layout.recommended && !layout.othersOpen && !layout.machineVisible, layout);
  await p.click('[data-ui="read-close"]');
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
  await p.route('https://openrouter.ai/api/v1/**', (route) => route.fulfill({ status: 401, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: { message: 'Incorrect API key provided: test-0000-not-a-real-key' } }) }));
  r = await call('read.run', { text: prose });   // the echo has no sk- prefix: only the request's own key can find it
  check('ladder.error_scrubs_key', r.class === 'key_rejected' && !r.message.includes('0000-not-a-real-key') && r.message.includes('[key]'), r);
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
  await p.route('http://127.0.0.1:11434/**', async (route) => {
    const q = route.request();
    if (q.method() === 'GET') return route.fulfill(reply({ object: 'list', data: [{ id: 'llama3.2' }] }));
    sent.push({ url: q.url(), headers: q.headers(), body: JSON.parse(q.postData()) });   // Ollama's own chat API: the reply shape is {message, done_reason}
    return route.fulfill(reply({ model: 'llama3.2', message: { role: 'assistant', content: JSON.stringify(FIX.whole) }, done: true, done_reason: 'stop' }));
  });
  const unprobed = (await call('reader.status', {})).data;
  await p.click('[data-ui="read-open"]'); await p.waitForFunction(() => document.querySelector('#reader').open);
  await p.click('#other-readers summary');   // the model server sits under "Other readers"
  await p.check('#reader input[value="machine"]');
  await p.click('[data-ui="read-probe"]');
  await p.waitForFunction(() => /Ollama found, 1 model/.test(document.querySelector('#machine-state').textContent));
  const noModel = await call('read.run', { text: prose });
  await p.waitForFunction(() => document.querySelectorAll('#machine-models option').length === 1);   // the probe fills the model list
  await p.fill('#machine-model', 'llama3.2'); await p.locator('#machine-model').blur();
  await p.waitForFunction(() => /Ollama on this machine/.test(document.querySelector('#read-privacy').textContent));
  await p.waitForFunction(() => !/Pick a model/.test(document.querySelector('#read-measured').textContent), null, { timeout: 3000 }).catch(() => {});   // the model choice redraws the line
  const privacy = await p.textContent('#read-privacy'), measuredLocal = await p.textContent('#read-measured');
  const r = await call('read.run', { text: prose });
  check('read.picker_unmeasured_model', /not measured yet/.test(measuredLocal), measuredLocal);
  check('ladder.machine_model_must_be_chosen', noModel.class === 'no_reader' && /No model is chosen/.test(noModel.message), noModel);
  check('ladder.machine_not_probed_at_load', unprobed.machine.checked === false && unprobed.machine.server === null, unprobed.machine);
  check('ladder.machine_read', r.ok && r.data.reader === 'machine' && r.data.model === 'llama3.2' && r.data.beats === 10 && sent.length >= 1 && !sent[0].headers.authorization && /Ollama on this machine: the story stays on your machine/.test(privacy), { r, privacy });
  check('ladder.ollama_window_per_request', sent[0].url === 'http://127.0.0.1:11434/api/chat' && sent[0].body.options.num_ctx === 16384 && sent[0].body.think === false && sent[0].body.format && sent[0].body.format.type === 'object', sent[0] && { url: sent[0].url, options: sent[0].body.options });
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
{ // Stop while the probe waits on Chrome's local-network prompt: the read ends at once, not after 60 s (forward pass L7)
  const ctx7 = await browser.newContext();
  await ctx7.addInitScript(() => { try { localStorage.setItem('sandhi:intro-seen', '1'); } catch { /* fine */ } delete window.LanguageModel;
    const f0 = window.fetch; window.fetch = (u, o) => (String(u).startsWith('http://127.0.0.1:') ? new Promise(() => {}) : f0(u, o));
    const q = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (d) => (d && /local-network|loopback/.test(d.name) ? Promise.resolve({ state: 'prompt' }) : q(d)); });
  const p7 = await ctx7.newPage(); await p7.goto(base); await p7.evaluate(() => window.sandhi.ready);
  await p7.evaluate((text) => { window.__r = window.sandhi.tools['read.run']({ text, rung: 'machine' }); }, prose);
  await p7.waitForTimeout(300);
  const t7 = Date.now(); await p7.evaluate(() => window.sandhi.tools['read.cancel']({}));
  const r7 = await p7.evaluate(() => window.__r), ms7 = Date.now() - t7;
  check('ladder.stop_ends_probe', r7.class === 'cancelled' && ms7 < 2000, { r7: r7.class, ms7 });
  await ctx7.close();
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

{ // typing survives every redraw: Esc, an agent's view.focus and story.save, another tab's save (forward pass M1)
  const { ctx2, p, errs, call } = await readPage({});
  const b2 = '#beat-b2 textarea.btext', text2 = async () => (await call('story.get', {})).data.story.beats[1].text;
  const typeIn = async (w) => { await p.click(b2); await p.keyboard.press('End'); await p.keyboard.type(' ' + w); };
  await call('view.focus', { principle: 'care' });
  await typeIn('ESCA'); await p.keyboard.press('Escape'); await p.keyboard.type(' ESCB'); await p.waitForTimeout(600);
  await typeIn('VFA'); await call('view.focus', { principle: 'plant' }); await p.keyboard.type(' VFB'); await p.waitForTimeout(600);
  await call('view.focus', { principle: 'all' });
  await typeIn('SVA'); await call('story.save', {}); await p.keyboard.type(' SVB'); await p.waitForTimeout(600);
  const other = await ctx2.newPage(); await other.goto(base); await other.evaluate(() => window.sandhi.ready);
  await typeIn('TBA'); await other.evaluate(() => window.sandhi.tools['beat.update']({ id: 'b9', patch: { fortune: 1 } }));
  await p.waitForFunction(() => document.querySelector('#toast').textContent.includes('another tab'), null, { timeout: 3000 }).catch(() => {});
  await p.keyboard.type(' TBB'); await p.waitForTimeout(600);
  const t = await text2(), b9 = (await call('story.get', {})).data.story.beats[8].fortune;
  check('persist.typing_survives_every_redraw', ['ESCA ESCB', 'VFA VFB', 'SVA SVB', 'TBA TBB'].every(w => t.includes(' ' + w)) && b9 === 1, { tail: t.slice(-60), b9 });
  await other.close();
  // an untouched, focused title follows an agent's edit, and hiding the tab does not write the old title back (L13)
  await p.click('#title'); await call('story.update', { title: 'Agent title' });
  await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForTimeout(100);
  check('persist.untouched_field_never_writes_back', (await call('story.get', {})).data.story.title === 'Agent title' && (await p.inputValue('#title')) === 'Agent title', await p.inputValue('#title'));
  await p.evaluate(() => { delete document.visibilityState; });
  // the writer's and an agent's title edits are two undo steps, not one (L14, T10)
  await p.fill('#title', 'Writer title'); await p.locator('#title').blur();
  await call('story.update', { title: 'Agent again' });
  await call('undo', {});
  check('persist.undo_steps_per_door', (await call('story.get', {})).data.story.title === 'Writer title', (await call('story.get', {})).data.story.title);
  // a draft note being typed survives a reload (L16)
  await call('beat.update', { id: 'b4', patch: { drafts: [{ n: 1, text: 'an older draft', note: '' }] } });
  await p.evaluate(() => { document.querySelector('[data-more="b4"]').open = true; });
  await p.click('#beat-b4 .dnote'); await p.keyboard.type('Why it changed');
  await p.reload(); await p.evaluate(() => window.sandhi.ready);
  check('persist.draft_note_at_reload', (await call('story.get', {})).data.story.beats[3].drafts[0].note === 'Why it changed', (await call('story.get', {})).data.story.beats[3].drafts);
  // two tabs share one journal (L17)
  const tab2 = await ctx2.newPage(); await tab2.goto(base); await tab2.evaluate(() => window.sandhi.ready);
  await tab2.evaluate(() => window.sandhi.tools.arc({})); await call('coverage', {});
  const jn = (await call('journal', { n: 5 })).data.entries.map(e => e.tool);
  check('persist.journal_shared_by_tabs', jn.includes('arc') && jn.includes('coverage'), jn);
  await tab2.close();
  check('persist.redraw_no_errors', errs.length === 0, errs);
  await ctx2.close();
}
{ // after a selective render, a card's byline, Keep-draft button and thread names follow (forward pass L15)
  const { ctx2, p, errs, call } = await readPage({});
  const read = JSON.parse(JSON.stringify(SEED)); for (const b of read.beats) { b.by = 'model'; b.model = 'fixture'; }
  await call('story.load', { story: read });
  const bylines = () => p.evaluate(() => document.querySelectorAll('#beats .byline').length);
  const before = await bylines();
  await p.click('#beat-b1 [data-more="b1"] > summary'); await p.click('#beat-b1 .blabel'); await p.keyboard.type('!'); await p.waitForTimeout(600);   // the name sits in "Label this beat"
  const after = await bylines();
  await call('beat.update', { id: 'b3', patch: { text: '' } });
  await p.click('#beat-b3 textarea.btext'); await p.keyboard.type('Now it has text'); await p.waitForTimeout(600);
  const keep = await p.evaluate(() => document.querySelector('#beat-b3 [data-ui="keep-draft"]').disabled);
  await p.fill('#threads textarea[data-thread="water"]', 'renamed thread'); await p.locator('#threads textarea[data-thread="water"]').blur();
  const plant = (await call('story.get', {})).data.story.threads[0].plant;
  const names = await p.evaluate((id) => document.querySelector(`#beat-${id} [data-plants]`).textContent, plant);
  check('render.card_parts_follow', before === 10 && after === 9 && keep === false && names.includes('renamed thread'), { before, after, keep, names });
  check('render.no_errors', errs.length === 0, errs);
  await ctx2.close();
}
{ // a full browser store: the page says the story is not kept, and keeps it again once there is room (forward pass M3)
  const { ctx2, p, errs, call } = await readPage({});
  await p.evaluate(() => { let n = 0; for (const size of [1e6, 1e5, 1e4, 1e3, 100]) { const x = 'x'.repeat(size); try { for (;;) localStorage.setItem('junk' + n++, x); } catch { /* full at this size */ } } });
  const big = JSON.parse(JSON.stringify(SEED)); big.beats[0].text = 'y'.repeat(150000);
  const r = await call('story.load', { story: big });
  const st = (await call('status', {})).data, note = await p.textContent('#savestate');
  await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('junk')) localStorage.removeItem(k); });
  await call('beat.update', { id: 'b2', patch: { fortune: 1 } });
  const again = (await call('status', {})).data.kept;
  check('persist.full_store_says_so', r.ok && st.kept === false && /storage is full/.test(note) && again === true, { kept: st.kept, note, again });
  check('persist.full_store_no_errors', errs.length === 0, errs);
  await ctx2.close();
}
{ // the agent's one perception act says what the writer has open; a .txt dropped on the read dialog fills it (AR6, T10)
  const { ctx2, p, errs, call } = await readPage({});
  const closed = (await call('status', {})).data.ui;
  await p.click('[data-ui="read-open"]'); await p.waitForFunction(() => document.querySelector('#reader').open);
  const open = (await call('status', {})).data.ui;
  await p.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['Once upon a time there was a dropped story.'], 'story.txt', { type: 'text/plain' })); document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); });
  const filled = await p.waitForFunction(() => document.querySelector('#read-text').value.startsWith('Once upon a time there was a dropped'), null, { timeout: 2000 }).then(() => true, () => false);
  check('status.ui_state', closed.dialog === null && closed.tour === false && closed.typing === false && open.dialog === 'read', { closed, open });
  check('read.txt_drop_fills_dialog', filled, 'not filled');
  check('ui_state.no_errors', errs.length === 0, errs);
  await ctx2.close();
}

{ // imports and hardening (forward pass Batch E): note ids, file size, a kept story that fails the schema, the size limits
  const { ctx2, p, errs, call } = await readPage({});
  const polluted = await p.evaluate(() => window.sandhi.tools['story.update'](JSON.parse('{"notes":{"__proto__":{"care":{"toString":null}}}}')));
  await call('view.focus', { principle: 'care' }); await call('view.focus', { principle: 'all' });
  check('import.note_ids_checked', polluted.class === 'invalid' && errs.length === 0, { polluted: polluted.class, errs });
  const before = JSON.stringify((await call('story.get', {})).data.story);
  await p.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'.repeat(13e6)], 'big.sandhi.json', { type: 'application/json' })); document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); });
  const told = await p.waitForFunction(() => /more than a story this page can hold/.test(document.querySelector('#toast').textContent), null, { timeout: 3000 }).then(() => true, () => false);
  check('import.big_file_refused', told && JSON.stringify((await call('story.get', {})).data.story) === before, told);
  // a story at the limits (400 beats, 100 threads) loads and draws in bounded time
  const big = { sandhi: 1, title: 'Limits', logline: '', belief: '', notes: {}, beats: Array.from({ length: 400 }, (_, i) => ({ id: 'b' + (i + 1), label: '', spine: 'because', joint: null, text: 'A beat.', fortune: 0, tags: [], marks: [], driver: null, avastha: null, kis: null, drafts: [], by: 'writer' })),
    threads: Array.from({ length: 100 }, (_, i) => ({ id: 't' + (i + 1), label: 'thread ' + i, plant: 'b1', payoffs: ['b2'] })) };
  const t0 = Date.now(); const lr = await call('story.load', { story: big }); const drawMs = Date.now() - t0;
  const over = await call('story.load', { story: { ...big, beats: [...big.beats, { ...big.beats[0], id: 'b401' }] } });
  check('import.limits_draw_in_time', lr.ok && drawMs < 8000 && over.class === 'invalid', { drawMs, over: over.class });
  await call('story.demo', {});
  // a kept story that fails the schema is set aside, and the writer is told
  await p.evaluate(() => localStorage.setItem('sandhi:story', JSON.stringify({ story: { sandhi: 1, title: 'broken' }, dirty: true })));
  await p.reload(); await p.evaluate(() => window.sandhi.ready);
  const aside = await p.evaluate(() => localStorage.getItem('sandhi:story:rejected'));
  const toldAside = await p.waitForFunction(() => /did not pass the schema check/.test(document.querySelector('#toast').textContent), null, { timeout: 2000 }).then(() => true, () => false);
  check('import.bad_kept_story_set_aside', toldAside && aside && aside.includes('broken'), { toldAside, aside: aside && aside.slice(0, 60) });
  check('import.no_errors', errs.length === 0, errs);
  await ctx2.close();
}

{ // the UX review's structural changes: sticky header, recent stories, import with a preview, grouped checks, traditions switch
  const { ctx2, p, call } = await readPage({});
  await p.evaluate(() => scrollTo(0, 2500)); await p.waitForTimeout(150);
  const header = await p.evaluate(() => { const r = document.querySelector('.topbar').getBoundingClientRect(); return { top: Math.round(r.top), undo: document.querySelector('#undo').checkVisibility() }; });
  check('ux.header_sticks', header.top === 0 && header.undo, header);
  await p.evaluate(() => scrollTo(0, 0));
  await call('story.update', { title: 'Mine, not saved' }); await call('story.demo', {});   // a replace keeps the story it pushed aside
  await p.click('.storymenu > summary');
  const recentShown = await p.evaluate(() => document.querySelector('#recent button') && document.querySelector('#recent button').textContent);
  await p.click('#recent button'); await p.waitForTimeout(150);
  const rl = await call('story.recent', {});
  check('ux.recent_for_agents', rl.ok && rl.data.stories[0].title === 'Mine, not saved', rl.data);
  check('ux.recent_story_back', /Mine, not saved/.test(recentShown || '') && (await call('story.get', {})).data.story.title === 'Mine, not saved', { recentShown });
  const before = JSON.stringify((await call('story.get', {})).data.story);
  await p.click('[data-ui="read-open"]'); await p.waitForFunction(() => document.querySelector('#reader').open);
  await p.fill('#read-text', 'First paragraph of an imported story.\n\nSecond paragraph.\n\nThird paragraph.');
  await p.click('[data-ui="read-paste"]'); await p.waitForTimeout(150);
  const staged = await p.evaluate(() => ({ sum: document.querySelector('#read-result .sum') && document.querySelector('#read-result .sum').textContent, accept: !document.querySelector('[data-ui="read-accept"]').hidden }));
  const unchangedYet = JSON.stringify((await call('story.get', {})).data.story) === before;
  await p.click('[data-ui="read-accept"]'); await p.waitForFunction(() => !document.querySelector('#reader').open);
  const imported = (await call('story.get', {})).data.story;
  check('ux.import_paragraphs_preview', /3 beats/.test(staged.sum || '') && /one beat per paragraph/.test(staged.sum) && staged.accept && unchangedYet && imported.beats.length === 3, { staged, unchangedYet, n: imported.beats.length });
  await call('story.new', {});
  const grouped = await p.evaluate(() => [...document.querySelectorAll('#checks li')].map(li => li.textContent));
  check('ux.checks_grouped', grouped.length === 1 && /5 beats/.test(grouped[0]) && /Beats 1, 2, 3, 4, 5/.test(grouped[0]), grouped);
  await call('story.demo', {});
  const rowsBefore = await p.evaluate(() => document.querySelectorAll('#chart .rowl').length);
  await call('story.start', { title: 'Plain', lines: [{ stage: 'once', text: 'a' }, { stage: 'oneday', text: 'b' }, { stage: 'until', text: 'c' }] });
  const rowsPlain = await p.evaluate(() => document.querySelectorAll('#chart .rowl').length);
  await p.check('#trad-all');
  const rowsAll = await p.evaluate(() => document.querySelectorAll('#chart .rowl').length);
  check('ux.traditions_switch', rowsBefore === 3 && rowsPlain === 1 && rowsAll === 3, { rowsBefore, rowsPlain, rowsAll });
  await ctx2.close();
}
{ // write first, label later (UX review H6): a beat card shows number, stage, text; its labels wait behind one disclosure with a summary
  const { ctx2, p } = await readPage({});
  const card = await p.evaluate(() => { const c = document.querySelector('#beat-b8'), d = c.querySelector('[data-more="b8"]');
    const shown = [...c.querySelectorAll('input,select,textarea,button,summary')].filter(x => x.checkVisibility()).length;
    return { shown, open: d.open, summary: d.querySelector('.lsum').textContent, name: c.querySelector('.bname').textContent, text: c.querySelector('textarea.btext').checkVisibility() }; });
  check('ux.write_first_card', card.shown <= 5 && !card.open && /the turn/.test(card.summary) && card.name === 'The turn' && card.text, card);
  await ctx2.close();
}
{ // the second UX walk (2026-10-06): wizard answers survive a reload (H1); unlabelled beats are not "idle" (M1); file errors name Import (L1)
  const { ctx2, p, call } = await readPage({});
  await p.click('[data-ui="wizard"]'); await p.waitForFunction(() => document.querySelector('#wizard').open);
  await p.keyboard.type('Survives a reload'); await p.keyboard.press('Enter');
  await p.keyboard.type('A keeper who wants one more winter');                     // typed, never moved on from
  await p.reload(); await p.evaluate(() => window.sandhi.ready);
  await p.click('[data-ui="wizard"]'); await p.waitForFunction(() => document.querySelector('#wizard').open);
  const back = { h: await p.textContent('#wiz-h'), text: await p.inputValue('#wiz-text') };
  if (await p.isEnabled('[data-ui="wiz-back"]')) { await p.click('[data-ui="wiz-back"]'); back.title = await p.inputValue('#wiz-text'); await p.click('[data-ui="wiz-next"]'); }
  for (let k = 0; k < 3; k++) { await p.fill('#wiz-text', `Line ${k + 1}.`); await p.click('#wiz-next'); }
  await p.click('#wiz-finish'); await p.waitForFunction(() => !document.querySelector('#wizard').open);
  const done = (await call('story.get', {})).data.story;
  await p.reload(); await p.evaluate(() => window.sandhi.ready);
  await p.click('[data-ui="wizard"]'); await p.waitForFunction(() => document.querySelector('#wizard').open);
  const freshAfter = { h: await p.textContent('#wiz-h'), text: await p.inputValue('#wiz-text') };
  await p.keyboard.press('Escape');
  check('ux2.wizard_survives_reload', back.h === 'Who is it about, and what do they want?' && back.text === 'A keeper who wants one more winter' && back.title === 'Survives a reload'
    && done.title === 'Survives a reload' && freshAfter.h === 'What is the story called?' && freshAfter.text === '', { back, title: done.title, freshAfter });
  // the finished story's beats carry no principles: the checks say so and open the labels, and never say cut
  const checksText = await p.textContent('#checks');
  await p.click('#checks button.check[data-label]');
  const opened = await p.evaluate(() => [...document.querySelectorAll('#beats details.more')].filter(d => d.open).length);
  check('ux2.unlabelled_not_idle', /No principle yet/.test(checksText) && !/cut it|Idle beat/.test(checksText) && opened === 1, { opened, checksText: checksText.slice(0, 200) });
  await p.evaluate(() => { const i = document.querySelector('#file'); const dt = new DataTransfer(); dt.items.add(new File(['not json'], 'notes.sandhi.json', { type: 'application/json' })); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); });
  const toastText = await p.waitForFunction(() => /is not a sandhi story/.test(document.querySelector('#toast').textContent) && document.querySelector('#toast').textContent, null, { timeout: 2000 }).then(h => h.jsonValue(), () => '');
  check('ux2.file_error_names_import', /use Import/.test(toastText) && !/Read a story/.test(toastText), toastText);
  await ctx2.close();
}
{ // the UX review's quick wins (plan/ux-review-2026-10-04.md): the wizard keeps answers; imports refuse non-text; notices; focus; Esc; errors surface
  const { ctx2, p, call } = await readPage({});
  await p.click('[data-ui="wizard"]'); await p.waitForFunction(() => document.querySelector('#wizard').open);
  await p.keyboard.type('Kept title');
  const blankOff = await p.evaluate(() => document.querySelector('#wiz-skip').disabled);
  await p.keyboard.press('Enter'); await p.keyboard.type('Line one'); await p.keyboard.press('Shift+Enter'); await p.keyboard.type('line two');
  const twoLines = (await p.inputValue('#wiz-text')) === 'Line one\nline two';
  await p.keyboard.press('Enter');                                                  // Enter moves on from a multi-line step too
  const step3 = await p.textContent('#wiz-h');
  await p.keyboard.press('Escape'); await p.click('[data-ui="wizard"]'); await p.waitForFunction(() => document.querySelector('#wizard').open);
  const resumed = await p.textContent('#wiz-h');
  await p.click('[data-ui="wiz-back"]'); const kept = await p.inputValue('#wiz-text');
  await p.click('[data-ui="wiz-blank"]'); await p.waitForFunction(() => !document.querySelector('#wizard').open);
  const blank = (await call('story.get', {})).data.story;
  check('ux.wizard_keeps_answers', blankOff && twoLines && step3 === 'Once upon a time…' && resumed === 'Once upon a time…' && kept === 'Line one\nline two'
    && blank.title === 'Kept title' && blank.logline === 'Line one\nline two' && blank.beats.length === 5, { blankOff, twoLines, step3, resumed, kept, title: blank.title, beats: blank.beats.length });
  await p.click('[data-ui="wizard"]'); await p.waitForFunction(() => document.querySelector('#wizard').open);
  const fresh = await p.textContent('#wiz-h');                                      // a finished wizard starts fresh
  await p.keyboard.type('Only a title'); await p.click('#wiz-finish'); await p.waitForFunction(() => !document.querySelector('#wizard').open);
  check('ux.wizard_finish_now', fresh === 'What is the story called?' && (await call('story.get', {})).data.story.title === 'Only a title', fresh);
  await call('story.demo', {});
  // a file that is not text is refused, on the read dialog's drop
  await p.click('[data-ui="read-open"]'); await p.waitForFunction(() => document.querySelector('#reader').open);
  await p.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array([137, 80, 78, 71, 0, 0, 0, 13, 255, 254, 0, 1])], 'picture.png', { type: 'image/png' })); document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); });
  const refused = await p.waitForFunction(() => /picture\.png" is not a text file/.test(document.querySelector('#toast').textContent), null, { timeout: 2000 }).then(() => true, () => false);
  check('ux.non_text_file_refused', refused && (await p.inputValue('#read-text')) === '', refused);
  await p.click('[data-ui="read-close"]');
  // removing a beat says so; Undo clears the notice
  await p.click('#beat-b3 details.menu summary'); await p.click('#beat-b3 [data-cmd="beat.remove"]');
  const removed = await p.textContent('#toast'); await p.click('#undo');
  const cleared = await p.evaluate(() => !document.querySelector('#toast').classList.contains('show'));
  check('ux.remove_says_so_undo_clears', /Beat removed/.test(removed) && cleared, { removed, cleared });
  // a toggle keeps keyboard focus; Esc closes the beat menu; an empty Add is disabled
  await p.click('#beat-b2 [data-more="b2"] > summary');
  await p.focus('#beat-b2 [data-focus="mark:b2:turn"]'); await p.keyboard.press('Space'); await p.waitForTimeout(100);
  const focusKept = await p.evaluate(() => document.activeElement && document.activeElement.dataset.focus);
  await p.click('#beat-b4 details.menu summary'); await p.keyboard.press('Escape');
  const menuClosed = await p.evaluate(() => !document.querySelector('#beat-b4 details.menu').open);
  const addOff = await p.evaluate(() => document.querySelector('#thread-add button').disabled);
  check('ux.focus_esc_add', focusKept === 'mark:b2:turn' && menuClosed && addOff, { focusKept, menuClosed, addOff });
  // a failure nobody caught still reaches the writer
  await p.evaluate(() => { setTimeout(() => { throw new Error('a test failure'); }); });
  const surfaced = await p.waitForFunction(() => /Something went wrong: .*a test failure/.test(document.querySelector('#toast').textContent), null, { timeout: 2000 }).then(() => true, () => false);
  check('ux.errors_surface', surfaced, surfaced);
  await ctx2.close();
}

{ // UX leftovers: the example is named; a phone chart names every stage; a phone hides readers it cannot run
  const { ctx2, p, call } = await readPage({});
  const ex = await p.textContent('#savestate');
  await call('beat.update', { id: 'b1', patch: { fortune: 1 } });
  const mine = await p.textContent('#savestate');
  check('ux.example_named', /example story/.test(ex) && /not saved to a file/.test(mine), { ex, mine });
  await ctx2.close();
  const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ph.addInitScript(() => { try { localStorage.setItem('sandhi:intro-seen', '1'); } catch { /* fine */ } });
  const pp2 = await ph.newPage(); await pp2.goto(base); await pp2.evaluate(() => window.sandhi.ready);
  const spineSegs = await pp2.evaluate(() => { const y = [...document.querySelectorAll('#chart .rowl')][0].getAttribute('y'); return [...document.querySelectorAll('#chart rect')].filter(r => Math.abs(+r.getAttribute('y') + 14 - +y) < 6).length + ' rects, ' + document.querySelectorAll('#chart .segt').length + ' names'; });
  const named = await pp2.evaluate(() => document.querySelectorAll('#chart .segt').length >= document.querySelectorAll('#chart rect').length);
  await pp2.click('[data-ui="read-open"]'); await pp2.waitForFunction(() => document.querySelector('#reader').open);
  const others = await pp2.evaluate(() => document.querySelector('#other-readers').checkVisibility());
  check('ux.phone_chart_and_readers', named && !others, { spineSegs, named, others });
  await ph.close();
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
// a slow phone paints before the scripts finish: nothing visible may move when they do (Lighthouse CLS 0.63 before the fix)
const slow = await browser.newContext({ viewport: { width: 412, height: 823 }, isMobile: true, hasTouch: true });
await slow.addInitScript(() => { window.__cls = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
const sp = await slow.newPage(); const cdpSlow = await slow.newCDPSession(sp);
await cdpSlow.send('Emulation.setCPUThrottlingRate', { rate: 6 });
await cdpSlow.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 100000 });
await sp.goto(base); await sp.evaluate(() => window.sandhi.ready); await sp.waitForTimeout(800);
const cls = await sp.evaluate(() => window.__cls);
check('layout.no_shift_slow_phone', cls < 0.05, cls);
await slow.close();
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
