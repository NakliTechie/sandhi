// Core gate (SPEC §4): schema, round trip with the explainer, checks, arc fit. Pure Node, no deps.
//   node test/core.mjs
// Runs the page's #sandhi-core script in a vm and compares it with the explainer's DATA block.
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import vm from 'node:vm';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ref = readFileSync(new URL('../reference/how-stories-work.html', import.meta.url), 'utf8');
const coreSrc = (/<script id="sandhi-core">([\s\S]*?)<\/script>/.exec(page) || [])[1];
const ctx = vm.createContext({});
vm.runInContext(coreSrc, ctx);
const C = ctx.SandhiCore;
const D = vm.runInContext(ref.split('/* DATA:BEGIN */')[1].split('/* DATA:END */')[0] + ';({SOURCES,PRINCIPLES,BEATS,ARCS})', vm.createContext({}));
// vm objects carry another realm's prototypes; JSON makes them comparable
const plain = (o) => JSON.parse(JSON.stringify(o));

const results = [];
const check = (id, pass, detail) => results.push({ id, pass: !!pass, ...(pass ? {} : { detail }) });
const firstDiff = (a, b, path = '') => {
  if (isDeepStrictEqual(a, b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff(a[k], b[k], `${path}.${k}`); if (d) return d; }
  }
  return { path, got: a, want: b };
};

// 1. the library matches the explainer
check('library.sources', isDeepStrictEqual(plain(C.SOURCES), plain(D.SOURCES)), firstDiff(plain(C.SOURCES), plain(D.SOURCES)));
const without = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const libP = plain(D.PRINCIPLES).map(p => without(p, ['story', 'beats']));
check('library.principles', isDeepStrictEqual(plain(C.PRINCIPLES), libP), firstDiff(plain(C.PRINCIPLES), libP));
const ts = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];
const arcFns = D.ARCS.every((a, i) => C.ARCS[i].id === a.id && C.ARCS[i].name === a.name && ts.every(t => Math.abs(C.ARCS[i].fn(t) - a.fn(t)) < 1e-12));
check('library.arc_functions', arcFns, 'arc ids, names or functions differ');

// The explainer's data shape (reference/how-stories-work.html, DATA block) <-> story. Test-only: the page never converts.
// The projection to the explainer round-trips; the story carries more than the explainer holds (threads, joints after b3,
// drivers, avastha, kis, logline, belief), so story -> explainer -> story is lossy by design.
const renderDrafts = d => d.map(x => `<s>Draft ${x.n}: ${x.text}</s> ${x.note}`).join(' ');
function parseDrafts(html) {
  if (!html) return [];
  const out = [], re = /<s>Draft (\d+): ([\s\S]*?)<\/s>\s*([\s\S]*?)(?=\s*<s>|$)/g;
  let m; while ((m = re.exec(html))) out.push({ n: +m[1], text: m[2], note: m[3] });
  return out;
}
function toExplainer(s) {
  const a = C.arcMatch(s), cov = C.coverage(s);
  return {
    BEATS: s.beats.map((b, i) => { const o = { n: i + 1, spine: b.label || C.spineName(b.spine), f: b.fortune, text: b.text, tags: b.tags.slice() }; if (b.drafts.length) o.draft = renderDrafts(b.drafts); return o; }),
    STORY: Object.fromEntries(cov.map(c => [c.id, { story: s.notes[c.id] || '', beats: c.beats }])),
    ARCS: C.ARCS.map(x => (x.id === a.best ? { id: x.id, name: x.name, d: `${x.d} ${s.title}.`, ours: true } : { id: x.id, name: x.name, d: x.d }))
  };
}
const LABEL_SPINE = { 'Once upon a time': 'once', 'Every day': 'everyday', 'One day': 'oneday', 'Until finally': 'until', 'And ever since then': 'since' };
function fromExplainer(d, title) {
  return { sandhi: C.SCHEMA, title: title || 'Untitled', logline: '', belief: '',
    beats: d.BEATS.map(b => ({ id: 'b' + b.n, label: b.spine, spine: LABEL_SPINE[b.spine] || 'because',
      joint: b.spine === 'But' ? 'but' : b.spine === 'Therefore' ? 'therefore' : null, text: b.text, fortune: b.f, tags: b.tags.slice(),
      marks: b.spine === 'The turn' ? ['turn'] : b.spine === 'The low point' ? ['low'] : [], driver: null, avastha: null, kis: null,
      drafts: parseDrafts(b.draft), by: 'writer' })),
    threads: [], notes: Object.fromEntries(d.PRINCIPLES.filter(p => p.story).map(p => [p.id, p.story])) };
}

// 2. the seed is valid, and its projection to the explainer matches the explainer and round-trips
const seed = C.seed();
const v = C.validate(seed);
check('seed.valid', v.ok, v.errors);
const want = { BEATS: plain(D.BEATS), STORY: Object.fromEntries(plain(D.PRINCIPLES).map(p => [p.id, { story: p.story, beats: p.beats }])),
  ARCS: plain(D.ARCS.map(a => without(a, ['fn']))) };
const got = plain(toExplainer(seed));
check('seed.to_explainer', isDeepStrictEqual(got, want), firstDiff(got, want));
const back = fromExplainer({ BEATS: plain(D.BEATS), PRINCIPLES: plain(D.PRINCIPLES) }, 'The whistle');
check('explainer.from.valid', C.validate(back).ok, C.validate(back).errors);
const again = plain(toExplainer(back));
check('explainer.round_trip', isDeepStrictEqual(again, want), firstDiff(again, want));
check('seed.text_matches_explainer', seed.beats.every((b, i) => b.text === D.BEATS[i].text && b.label === D.BEATS[i].spine), 'beat text or label differs');

// 3. checks: the seed is clean; each class has a fixture that fires it (SPEC §0, row 8)
const classes = (s) => plain(C.checks(s)).map(c => c.class);
check('checks.seed_clean', classes(seed).length === 0, plain(C.checks(seed)));
const mut = (fn) => { const s = C.seed(); fn(s); return s; };
const removeBeat = (s, id) => { s.beats = s.beats.filter(b => b.id !== id); for (const t of s.threads) { if (t.plant === id) t.plant = null; t.payoffs = t.payoffs.filter(x => x !== id); } };
// workplan Batch A test: blanking beat 2 flags beat 8's payoff as unplanted
const noB2 = mut(s => removeBeat(s, 'b2'));
const hit = plain(C.checks(noB2)).find(c => c.class === 'payoff_unplanted' && c.thread === 'whistle');
check('fixture.payoff_unplanted (remove beat 2)', hit && hit.beat === 'b8', plain(C.checks(noB2)));
const fixtures = {
  beat_empty: s => { s.beats[3].text = ''; },
  beat_idle: s => { s.beats[3].tags = []; },
  joint_unlabelled: s => { s.beats[4].joint = null; },
  joint_slack: s => { s.beats[4].joint = 'and-then'; },
  plant_unpaid: s => { s.threads[0].payoffs = []; },
  payoff_early: s => { s.threads[0].plant = 'b5'; },
  thread_unused: s => { s.threads.push({ id: 't1', label: 'x', plant: null, payoffs: [] }); },
  ending_luck: s => { s.beats[8].driver = 'luck'; },
  no_turn: s => { s.beats[7].marks = []; },
  flat_fortune: s => { for (const b of s.beats) b.fortune = 1; },
  low_not_lowest: s => { s.beats[0].fortune = -5; s.beats[6].fortune = -4; }
};
for (const [cls, fn] of Object.entries(fixtures)) {
  const s = mut(fn), ok = C.validate(s).ok, fired = classes(s);
  check(`fixture.${cls}`, ok && fired.includes(cls) && fired.every(c => c === cls), { valid: ok, fired });
}
const blank = C.blankStory();
check('blank.valid', C.validate(blank).ok, C.validate(blank).errors);
check('blank.five_empty_beats', isDeepStrictEqual(classes(blank), ['beat_empty', 'beat_empty', 'beat_empty', 'beat_empty', 'beat_empty']), classes(blank));

// 4. arc fit on the writer's numbers: The whistle is a Man in a hole (the explainer's own reading)
const a = plain(C.arcMatch(seed));
check('arc.whistle_is_hole', a.best === 'hole' && a.r === 0.874, a);
// one rule, one owner: the arc reads the same written beats the flat-fortune check reads
const flatPlusEmpty = mut(s => { s.beats = s.beats.slice(0, 5); s.threads = []; s.beats.forEach((b, i) => { b.fortune = i < 3 ? 2 : 0; if (i >= 3) b.text = ''; }); });
check('arc.agrees_with_flat_check', C.arcMatch(flatPlusEmpty).best === null && classes(flatPlusEmpty).includes('flat_fortune'), { arc: plain(C.arcMatch(flatPlusEmpty)), fired: classes(flatPlusEmpty) });
check('arc.flat_has_no_shape', C.arcMatch(mut(fixtures.flat_fortune)).best === null, plain(C.arcMatch(mut(fixtures.flat_fortune))));

// 5. the validator rejects what it should (closed vocabularies, unknown fields, dangling ids)
const rejects = {
  bad_spine: s => { s.beats[0].spine = 'climax'; },
  bad_joint: s => { s.beats[4].joint = 'and'; },
  fortune_range: s => { s.beats[0].fortune = 6; },
  fortune_int: s => { s.beats[0].fortune = 1.5; },
  bad_tag: s => { s.beats[0].tags = ['care', 'drama']; },
  dup_tag: s => { s.beats[0].tags = ['care', 'care']; },
  unknown_beat_field: s => { s.beats[0].mood = 'grim'; },
  unknown_story_field: s => { s.author = 'x'; },
  dup_beat_id: s => { s.beats[5].id = 'b1'; },
  dup_thread_id: s => { s.threads[1].id = s.threads[0].id; },
  model_without_id: s => { s.beats[0].by = 'model'; },
  model_id_too_long: s => { s.beats[0].by = 'model'; s.beats[0].model = 'm'.repeat(201); },
  too_many_beats: s => { s.beats = Array.from({ length: C.LIMITS.beats + 1 }, (_, i) => C.newBeat('b' + (i + 1), { text: 'x' })); s.threads = []; },
  too_many_threads: s => { s.threads = Array.from({ length: C.LIMITS.threads + 1 }, (_, i) => ({ id: 'x' + i, label: 'x', plant: 'b1', payoffs: [] })); },
  dangling_plant: s => { s.threads[0].plant = 'b99'; },
  dangling_payoff: s => { s.threads[0].payoffs = ['b99']; },
  bad_note_key: s => { s.notes.drama = 'x'; },
  model_without_by: s => { s.beats[0].model = 'nano'; },
  wrong_schema: s => { s.sandhi = 2; }
};
// each rejection names the field it rejects, so a different guard firing cannot pass it (a vacuous negative)
const REJECT_PATH = { dup_beat_id: 'beats[5].id', dup_thread_id: 'threads[1].id', model_without_id: 'beats[0].model', model_id_too_long: 'beats[0].model', too_many_beats: 'beats', too_many_threads: 'threads', bad_note_key: 'notes.drama' };
for (const [name, fn] of Object.entries(rejects)) {
  const r = plain(C.validate(mut(fn))), want = REJECT_PATH[name];
  check(`rejects.${name}`, !r.ok && (!want || r.errors.some(e => e.path === want)), r.errors.slice(0, 3));
}
check('accepts.agent_provenance', C.validate(mut(s => { s.beats[0].by = 'agent'; })).ok, 'rejected');
check('accepts.model_provenance', C.validate(mut(s => { s.beats[0].by = 'model'; s.beats[0].model = 'gemini-nano'; })).ok, 'rejected');

// 6. read mode, pure part: the model's quotes cut the writer's own prose; labels come from the model; bad quotes drop
const S0 = plain(seed);   // this realm's copy, so isDeepStrictEqual compares values, not vm prototypes
const prose = seed.beats.map(b => b.text).join('\n\n');
const first = (t, n) => t.split(/\s+/).slice(0, n || 8).join(' ');
const LABEL_KEYS = ['label', 'spine', 'joint', 'fortune', 'tags', 'marks', 'driver', 'avastha', 'kis'];
const labelsOf = (b) => Object.fromEntries(LABEL_KEYS.map(k => [k, k === 'joint' || k === 'driver' || k === 'avastha' || k === 'kis' ? (b[k] || 'none') : b[k]]));
const idx = Object.fromEntries(seed.beats.map((b, i) => [b.id, i]));
const wholeJson = {
  title: 'The whistle',
  beats: [...seed.beats.map(b => ({ start: first(b.text), ...labelsOf(b) })), { start: 'a dragon flew over the harbour and sang', ...labelsOf(seed.beats[0]) }],
  threads: [...seed.threads.map(t => ({ label: t.label, plant: first(seed.beats[idx[t.plant]].text), payoffs: t.payoffs.map(b => first(seed.beats[idx[b]].text)) })),
    { label: 'made up', plant: 'nothing like this sentence is in the story', payoffs: [] }]
};
// one quote with straight quotes and a hyphen where the text has curly quotes and an em dash
wholeJson.threads[0].payoffs = ["Someone had to climb. The grown-ups were down"];
const w = C.storyFromWhole(prose, plain(wholeJson), 'fixture');
const ws = w.story && plain(w.story);
check('read.whole.valid', ws && C.validate(ws).ok, ws ? C.validate(ws).errors : 'no story');
check('read.whole.prose_is_writers', ws && ws.beats.length === 10 && ws.beats.every((b, i) => b.text === seed.beats[i].text), ws && ws.beats.map(b => b.text.slice(0, 30)));
check('read.whole.labels', ws && ws.beats.every((b, i) => isDeepStrictEqual(Object.fromEntries(LABEL_KEYS.map(k => [k, b[k]])), Object.fromEntries(LABEL_KEYS.map(k => [k, S0.beats[i][k]])))), 'labels differ');
check('read.whole.provenance', ws && ws.beats.every(b => b.by === 'model' && b.model === 'fixture'), 'by/model');
check('read.whole.threads', ws && ws.threads.length === 6 && ws.threads.every((t, i) => t.plant === S0.threads[i].plant && isDeepStrictEqual(t.payoffs, S0.threads[i].payoffs)), ws && ws.threads);
check('read.whole.drops_made_up_quotes', isDeepStrictEqual(plain(w.dropped), { beats: 1, quotes: 1 }), plain(w.dropped));
check('read.whole.checks_clean', ws && C.checks(ws).length === 0, ws && plain(C.checks(ws)));
const folded = C.foldText(prose);
check('read.fold.curly_and_dashes', C.findQuote(folded, "So Tavi went - two hundred steps, the way he'd carried the water") >= 0, 'not found');
check('read.fold.rejects_short', C.findQuote(folded, 'Tavi') === -1, 'short quote matched');
// chunks: cover the text, none over the limit, each cut on a blank line when the window has one
const chunks = plain(C.chunkText(prose, 900));
const covered = chunks.map(c => prose.slice(c.start, c.end)).join('');
check('read.chunks', chunks.length > 2 && covered === prose && chunks.every(c => c.end - c.start <= 900) && chunks.slice(0, -1).every(c => prose.slice(c.end - 2, c.end) === '\n\n'), chunks);
// text without blank lines still splits: single newlines first, then sentence ends; a hard cut only with no break at all
const lines = Array.from({ length: 200 }, (_, i) => `Line ${i} of a story with no blank lines between its paragraphs at all.`).join('\n');
const lc = plain(C.chunkText(lines, 4000));
check('read.chunks_single_newlines', lc.length >= 4 && lc.every(x => x.end - x.start <= 4000 && lines[x.end - 1] === '\n' || x.end === lines.length) && lc.map(x => lines.slice(x.start, x.end)).join('') === lines, lc.map(x => x.end - x.start));
const sentences = Array.from({ length: 300 }, (_, i) => `Sentence ${i} goes on a little.`).join(' ');
const sc = plain(C.chunkText(sentences, 2000));
check('read.chunks_sentences', sc.length >= 4 && sc.every(x => x.end - x.start <= 2000) && sc.slice(0, -1).every(x => /\.\s$/.test(sentences.slice(x.end - 2, x.end))), sc.map(x => x.end - x.start));
const blob = 'x'.repeat(5000);
check('read.chunks_hard_cut', isDeepStrictEqual(plain(C.chunkText(blob, 2000)).map(x => x.end - x.start), [2000, 2000, 1000]), plain(C.chunkText(blob, 2000)));
// two passes: scenes per chunk, then labels over all scene summaries
const scenesJson = chunks.flatMap(c => seed.beats.filter(b => prose.indexOf(b.text) >= c.start && prose.indexOf(b.text) < c.end)
  .map(b => ({ start: first(b.text), summary: b.label, fortune: b.fortune, introduces: [], uses: [] })));
const anchored = C.anchorScenes(prose, [...scenesJson, { start: 'this scene never happened in the story at all', summary: 'x', fortune: 0, introduces: [], uses: [] }]);
check('read.two_pass.anchor', anchored.scenes.length === 10 && anchored.dropped === 1, plain(anchored).dropped);
const labelsJson = { title: 'The whistle', beats: seed.beats.map((b, k) => ({ scene: k + 1, ...labelsOf(b) })),
  threads: seed.threads.map(t => ({ label: t.label, plant_scene: idx[t.plant] + 1, payoff_scenes: t.payoffs.map(b => idx[b] + 1) })) };
const two = plain(C.storyFromLabels(prose, anchored.scenes, labelsJson, 'fixture').story);
check('read.two_pass.same_as_whole', isDeepStrictEqual(two.beats, ws.beats) && isDeepStrictEqual(two.threads.map(t => [t.plant, t.payoffs]), ws.threads.map(t => [t.plant, t.payoffs])), 'differs');
// split: the bounds call anchors the beats, the labels call labels them by number; same story as the whole read
const bounds = C.anchorScenes(prose, wholeJson.beats.map(b => ({ start: b.start })));
const texts = plain(C.beatTexts(prose, bounds.scenes));
check('read.split.beat_texts', texts.length === 10 && texts.every((t, i) => t === S0.beats[i].text) && bounds.dropped === 1, { n: texts.length, dropped: bounds.dropped });
const splitJson = { title: 'The whistle', beats: S0.beats.map((b, k) => ({ beat: k + 1, ...labelsOf(b) })),
  threads: S0.threads.map(t => ({ label: t.label, plant_beat: idx[t.plant] + 1, payoff_beats: t.payoffs.map(b => idx[b] + 1) })) };
const split = plain(C.storyFromSplit(prose, bounds.scenes, splitJson, 'fixture').story);
check('read.split.same_as_whole', isDeepStrictEqual(split.beats, ws.beats) && isDeepStrictEqual(split.threads.map(t => [t.plant, t.payoffs]), ws.threads.map(t => [t.plant, t.payoffs])), 'differs');
check('read.split.prompts', C.READ_PROMPTS.bounds('x').system.length < C.READ_PROMPTS.whole('x').system.length / 3 && C.READ_PROMPTS.beatLabels(['a', 'b']).user.includes('Beat 2:\nb'), 'prompt shape');
// a beat that opens with dialogue, a dash or an ellipsis keeps its opening mark (the model's quote often drops it)
const talk = 'The fog came early and thick that night over the harbour.\n\n“Hush, Tavi,” said everyone on the quay, and nobody listened.\n\n—And then the rope snapped, and the bell fell silent for good.\n\n…and so the island waited in the dark for the boats.';
const tw = C.storyFromWhole(talk, { title: 't', beats: [{ start: 'The fog came early and thick that night' }, { start: 'Hush, Tavi, said everyone on the quay' }, { start: 'And then the rope snapped, and the bell' }, { start: 'and so the island waited in the dark' }], threads: [] }, 'fixture');
const tb = tw.story ? plain(tw.story).beats.map(b => b.text) : [];
check('read.opening_marks_kept', tb.length === 4 && tb[1].startsWith('“Hush') && tb[2].startsWith('—And') && tb[3].startsWith('…and') && tb[0].endsWith('harbour.') && tb[1].endsWith('listened.'), tb);
// a reply of the wrong shape is coerced or dropped row by row, never a crash that loses the whole read
const odd = { title: 't', beats: [{ start: first(seed.beats[0].text), tags: 'care, want', marks: { turn: true }, spine: 'once' }, null, 7, { start: first(seed.beats[1].text), tags: ['care'], marks: 'turnaround' }],
  threads: [null, { label: 'w', plant: first(seed.beats[1].text), payoffs: 'beat eight' }, { label: 'x', plant: 5, payoffs: [null, 3] }] };
const oddRuns = { whole: () => C.storyFromWhole(prose, odd, 'f'), whole_obj: () => C.storyFromWhole(prose, { beats: { a: 1 }, threads: 'no' }, 'f'),
  scenes: () => C.anchorScenes(prose, [null, { start: first(seed.beats[0].text), introduces: 'whistle', uses: 3 }]),
  labels: () => C.storyFromLabels(prose, plain(C.anchorScenes(prose, [{ start: first(seed.beats[0].text) }])).scenes, { beats: 'x', threads: [{ plant_scene: 1, payoff_scenes: 'y' }] }, 'f'),
  split: () => C.storyFromSplit(prose, plain(C.anchorScenes(prose, [{ start: first(seed.beats[0].text) }])).scenes, { beats: [null, { beat: 1, tags: 'care' }], threads: 7 }, 'f') };
const oddOut = Object.fromEntries(Object.entries(oddRuns).map(([k, fn]) => { try { fn(); return [k, 'ok']; } catch (e) { return [k, e.message]; } }));
check('read.malformed_rows_no_crash', Object.values(oddOut).every(x => x === 'ok'), oddOut);
const oddWhole = plain(C.storyFromWhole(prose, odd, 'f'));
check('read.malformed_rows_coerced', oddWhole.story && oddWhole.story.beats.length === 2 && oddWhole.story.beats[0].tags.length === 0 && oddWhole.story.beats[1].marks.length === 0 && oddWhole.dropped.beats === 2, oddWhole.dropped);
// a quote repeated or out of order is dropped and counted, never an empty or overlapping beat
const dupJson = { title: 't', beats: [0, 1, 0, 2, 1, 3].map(i => ({ start: first(seed.beats[i].text) })), threads: [] };
const dw = plain(C.storyFromWhole(prose, dupJson, 'f'));
check('read.whole.repeated_quote_counted', dw.story && dw.story.beats.length === 4 && dw.dropped.beats === 2 && dw.story.beats.every(b => b.text.trim()), { n: dw.story && dw.story.beats.length, dropped: dw.dropped });
const ds = plain(C.anchorScenes(prose, [0, 3, 6, 0, 8].map(i => ({ start: first(seed.beats[i].text) }))));
check('read.scenes.repeated_quote_counted', ds.scenes.length === 4 && ds.dropped === 1 && ds.scenes.every((x, i) => !i || x.pos > ds.scenes[i - 1].pos) && C.beatTexts(prose, ds.scenes).every(t => t.trim()), { pos: ds.scenes.map(x => x.pos), dropped: ds.dropped });
// a payoff that repeats its plant's line word for word anchors where it is repeated, after the plant
const echo = 'Oren said a bell is not loud, it is steady and true.\n\nThe fog came and the boats were lost out on the water.\n\nTavi whistled, and remembered: a bell is not loud, it is steady and true.';
const ew = plain(C.storyFromWhole(echo, { title: 'e', beats: [{ start: 'Oren said a bell is not loud' }, { start: 'The fog came and the boats were lost' }, { start: 'Tavi whistled, and remembered' }], threads: [{ label: 'steady', plant: 'a bell is not loud, it is steady and true', payoffs: ['a bell is not loud, it is steady and true'] }] }, 'f'));
check('read.payoff_repeating_plant', ew.story && ew.story.threads.length === 1 && ew.story.threads[0].plant === 'b1' && ew.story.threads[0].payoffs[0] === 'b3', ew.story && ew.story.threads);
// labels match whatever case the model writes them in
const cap = plain(C.coerceLabels({ spine: 'Once', joint: 'Therefore', marks: ['Turn'], driver: 'Choice', avastha: 'Arambha', kis: 'Ki', tags: ['Care'], fortune: 2 }));
check('read.labels_any_case', cap.spine === 'once' && cap.joint === 'therefore' && cap.marks[0] === 'turn' && cap.driver === 'choice' && cap.avastha === 'arambha' && cap.kis === 'ki' && cap.tags[0] === 'care', cap);
// quote folding: decomposed accents, soft hyphens, zero-width spaces, guillemets and non-breaking hyphens
const nfd = 'Ārambha begins the story here, and the whole island waits.'.normalize('NFD');
const fq = (text, q) => C.findQuote(C.foldText(text), q);
check('read.fold.unicode', fq(nfd, 'Ārambha begins the story here') === 0 && fq('The sea\u00ADwall held, and the grown\u200Bups lit fires.', 'The seawall held, and the grownups lit') === 0 && fq('He said «hush» and the gull flew off into the dark.', 'He said "hush" and the gull flew off') === 0 && fq('A well\u2011known whistle came out of the fog.', 'A well-known whistle came out of the fog') === 0, 'a form did not match');
// scripts that end sentences without . ! ? still split at sentence ends; a cut never splits a surrogate pair
const hindi = Array.from({ length: 80 }, (_, i) => `धीरे धीरे घंटी बजी और नावें घर लौटीं ${i}।`).join(' ');
const hc = plain(C.chunkText(hindi, 700));
check('read.chunks_devanagari', hc.length >= 3 && hc.slice(0, -1).every(x => /।\s*$/.test(hindi.slice(x.start, x.end))), hc.map(x => hindi.slice(x.end - 3, x.end)));
const emoji = '🔔'.repeat(1001);
const ec = plain(C.chunkText(emoji, 501));
check('read.chunks_surrogates', ec.every(x => !/[\uD800-\uDBFF]$/.test(emoji.slice(x.start, x.end))) && ec.map(x => emoji.slice(x.start, x.end)).join('') === emoji, ec.map(x => x.end - x.start));
// a story in a script without spaces between words has words to count
const ja = 'タビは霧の夜に塔へ登った。ベルは鳴らなかった。彼は口笛を吹いた。'.repeat(40);
check('read.word_count_unspaced', C.wordCount(ja) >= 200, C.wordCount(ja));
// the New-story wizard's story: beats in the order given, joints from the stage words, valid; no lines gives the blank spine
const sp = plain(C.storyFromSpine({ title: ' T ', lines: [{ stage: 'once', text: 'a' }, { stage: 'everyday', text: '' }, { stage: 'oneday', text: 'b' }, { stage: 'because', text: 'c' }, { stage: 'until', text: 'd' }, { stage: 'since', text: 'e' }] }));
check('spine.story_from_lines', C.validate(sp).ok && sp.title === 'T' && isDeepStrictEqual(sp.beats.map(b => b.joint), [null, null, 'but', 'therefore', 'therefore', 'therefore']) && sp.beats.map(b => b.id).join() === 'b1,b2,b3,b4,b5,b6', sp.beats.map(b => b.joint));
check('spine.no_lines_is_blank_spine', isDeepStrictEqual(plain(C.storyFromSpine({})).beats.map(b => b.spine), ['once', 'everyday', 'oneday', 'because', 'until']), 'not the blank spine');
check('spine.bad_stage_invalid', !C.validate(plain(C.storyFromSpine({ lines: [{ stage: 'climax', text: 'x' }] }))).ok, 'accepted');
// ids stay fresh after a load of long numeric ids
const longIds = [{ id: 'b' + '9'.repeat(20) }, { id: 'b100000000000000000' }];
const nid = C.nextId('b', longIds);
check('ids.next_after_long_ids', /^[a-z0-9-]{1,40}$/.test(nid) && !longIds.some(x => x.id === nid), nid);

// schemas: every object closes additionalProperties and requires all its keys (structured-output rules)
const closed = (o) => !o || typeof o !== 'object' || ((o.type !== 'object' || (o.additionalProperties === false && isDeepStrictEqual([...o.required].toSorted(), Object.keys(o.properties).toSorted()))) && Object.values(o).every(closed));
check('read.schemas_closed', Object.values(plain(C.READ_SCHEMAS)).every(closed), 'open object in a schema');
// open threads (Batch D): a thread left open on purpose is not flagged; open must be a boolean
{
  const left = mut(t => { t.threads[0].payoffs = []; t.threads[0].open = true; });
  const notLeft = mut(t => { t.threads[0].payoffs = []; });
  const bad = mut(t => { t.threads[0].open = 'yes'; });
  check('thread.open_silences_unpaid', C.validate(left).ok && !plain(C.checks(left)).some(c => c.class === 'plant_unpaid') && plain(C.checks(notLeft)).some(c => c.class === 'plant_unpaid') && !C.validate(bad).ok, C.validate(bad).errors);
}
// tidbits (Batch D): optional; each placed in distinct existing beats
{
  const ok1 = mut(t => { t.tidbits = [{ id: 'k1', text: 'Meat kept too long gets freezer burn.', note: '', placed: ['b2'] }, { id: 'k2', text: 'A curious train stop.', note: 'Shimla line', placed: [] }]; });
  const ghost = mut(t => { t.tidbits = [{ id: 'k1', text: 'x', note: '', placed: ['b99'] }]; });
  const dupe = mut(t => { t.tidbits = [{ id: 'k1', text: 'x', note: '', placed: [] }, { id: 'k1', text: 'y', note: '', placed: [] }]; });
  const extra = mut(t => { t.tidbits = [{ id: 'k1', text: 'x', note: '', placed: [], where: 'beat 2' }]; });
  check('tidbits.validated', C.validate(ok1).ok && !C.validate(ghost).ok && !C.validate(dupe).ok && !C.validate(extra).ok && C.validate(plain(C.seed())).ok, [C.validate(ghost).errors, C.validate(dupe).errors]);
}
// plot proposals (Batch D): inserts and relabels only; inserts keep their order; the result validates
{
  const s0 = plain(C.seed());
  const ch = plain(C.coercePlot({ changes: [
    { op: 'insert', beat: 6, stage: 'because', joint: 'but', fortune: -4, label: 'Ama\'s boat loses its mast.', why: 'w' },
    { op: 'insert', beat: 6, stage: 'because', joint: 'therefore', fortune: -5, label: 'Tavi sees the mast go.', why: 'w' },
    { op: 'insert', beat: 0, stage: 'once', joint: '', fortune: 0, label: 'A storm warning.', why: 'w' },
    { op: 'relabel', beat: 7, stage: '', joint: 'but', fortune: s0.beats[6].fortune, label: '', why: 'w' },
    { op: 'relabel', beat: 8, stage: s0.beats[7].spine, joint: s0.beats[7].joint, fortune: s0.beats[7].fortune, label: '', why: 'no change' },
    { op: 'delete', beat: 2, why: 'not an op' }, { op: 'insert', beat: 99, label: 'x', why: '' }, { op: 'insert', beat: 3, label: '', why: 'no label' } ] }, s0));
  const n = plain(C.applyPlot(s0, ch, 'm'));
  const at = (lab) => n.beats.findIndex(b => b.label === lab);
  check('plot.coerce_apply', ch.length === 4 && C.validate(n).ok && n.beats.length === s0.beats.length + 3 && at('A storm warning.') === 0 && at('Tavi sees the mast go.') === at('Ama\'s boat loses its mast.') + 1
    && n.beats[at('Ama\'s boat loses its mast.') - 1].id === s0.beats[5].id && n.beats.find(b => b.id === s0.beats[6].id).joint === 'but' && n.beats[0].text === '' && n.beats[0].by === 'model', { ch, labels: n.beats.map(b => b.label) });
}
// weak places (Batch D interview): empty beats first, then the checks, thin beats, unserved principles; at most 8
{
  const st = mut(t => { t.beats[4].text = ''; t.beats[2].text = 'Too short.'; t.beats.forEach(b => { b.tags = b.tags.filter(x => x !== 'cut'); }); });
  const w = plain(C.weakPlaces(st));
  check('interview.weak_places', w[0].beat === 'b5' && w[0].at === 5 && w.some(x => x.text === 'Beat 3 is thin: 2 words.') && w.some(x => x.principle === 'cut') && w.length <= 8 && plain(C.weakPlaces(plain(C.seed()))).every(x => x.kind !== 'beat' || x.at), w);
  const iv = plain(C.coerceInterview({ place: 1, question: 'Q?', lands: 'note' }, st)), bad = C.coerceInterview({ place: 99, question: 'Q?' }, st);
  check('interview.coerce', iv.place.beat === 'b5' && iv.lands === 'note' && bad === null, iv);
}
// chapters (Batch E): headings after a blank line; 3 or more; prose that starts with 'Part of' is not a heading
{
  const t = 'Preface.\n\nCHAPTER I. The Fog\n\nOne.\n\nChapter Twenty-One\n\nTwo.\n\nPart of the reason she left.\n\nChapter 3: Late\n\nThree.\n\nIV.\n\nFour.';
  const ch = plain(C.splitChapters(t));
  check('chapters.split', ch.map(c => c.title).join('|') === 'CHAPTER I. The Fog|Chapter Twenty-One|Chapter 3: Late|IV.' && ch[0].start === 0 && ch.at(-1).end === t.length && ch.every((c, k) => !k || c.start === ch[k - 1].end) && C.splitChapters('a\n\nChapter 1\n\nb\n\nChapter 2\n\nc') === null, ch);
}
check('write.schemas_closed', Object.values(plain(C.WRITE_SCHEMAS)).every(closed), 'open object in a write schema');
// the sketch (TaleBrush): 25 values from -5 to 5; a drawn path resamples to them; beats 2 or more away are the misses
{
  const sk = plain(C.sketchFrom([{ t: 0, v: -4 }, { t: 0.5, v: 4 }, { t: 1, v: -4 }]));
  check('sketch.resampled', sk.length === C.SKETCH_N && sk[0] === -4 && sk[12] === 4 && sk[24] === -4 && sk[6] === 0 && C.sketchFrom([{ t: 0.5, v: 1 }]) === null, sk);
  const st = plain(C.seed()); st.sketch = sk;
  const bad = plain(C.seed()); bad.sketch = [1, 2, 3];
  const big = plain(C.seed()); big.sketch = Array(25).fill(6);
  check('sketch.validated', C.validate(st).ok && !C.validate(bad).ok && !C.validate(big).ok && C.validate(plain(C.seed())).ok, C.validate(bad).errors);
  const m = plain(C.sketchMisses(st)), s0 = plain(C.seed());
  const expect = s0.beats.map((b, i) => ({ at: i + 1, f: b.fortune, t: Math.round(C.sketchAt(sk, i / (s0.beats.length - 1))) })).filter(x => Math.abs(x.t - x.f) >= 2);
  check('sketch.misses', m.length === expect.length && m.length > 0 && m.every((x, k) => x.at === expect[k].at && x.target === expect[k].t), { m, expect });
}

const failed = results.filter(r => !r.pass);
const receipt = { gate: 'core', verdict: failed.length ? 'fail' : 'pass', checks: results.length, failed: failed.length, ...(failed.length ? { failures: failed } : {}) };
console.log(JSON.stringify(receipt, null, 1));
process.exit(failed.length ? 1 : 0);
