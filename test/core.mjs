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

// 2. the seed is valid and round-trips to the explainer with nothing lost
const seed = C.seed();
const v = C.validate(seed);
check('seed.valid', v.ok, v.errors);
const want = { BEATS: plain(D.BEATS), STORY: Object.fromEntries(plain(D.PRINCIPLES).map(p => [p.id, { story: p.story, beats: p.beats }])),
  ARCS: plain(D.ARCS.map(a => without(a, ['fn']))) };
const got = plain(C.toExplainer(seed));
check('seed.to_explainer', isDeepStrictEqual(got, want), firstDiff(got, want));
const back = C.fromExplainer({ BEATS: plain(D.BEATS), PRINCIPLES: plain(D.PRINCIPLES) }, 'The whistle');
check('explainer.from.valid', C.validate(back).ok, C.validate(back).errors);
const again = plain(C.toExplainer(back));
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
check('arc.whistle_is_hole', a.best === 'hole' && a.r > 0.8, a);
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
  dup_beat_id: s => { s.beats[1].id = 'b1'; },
  dangling_plant: s => { s.threads[0].plant = 'b99'; },
  dangling_payoff: s => { s.threads[0].payoffs = ['b99']; },
  bad_note_key: s => { s.notes.drama = 'x'; },
  model_without_by: s => { s.beats[0].model = 'nano'; },
  wrong_schema: s => { s.sandhi = 2; }
};
for (const [name, fn] of Object.entries(rejects)) check(`rejects.${name}`, !C.validate(mut(fn)).ok, 'accepted');
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
// chunks: paragraph-aligned, cover the text, none over the limit unless one paragraph is
const chunks = plain(C.chunkText(prose, 900));
const covered = chunks.map(c => prose.slice(c.start, c.end)).join('');
check('read.chunks', chunks.length > 2 && covered === prose && chunks.every(c => c.end - c.start <= 900 || !prose.slice(c.start, c.end).trim().includes('\n\n')), chunks);
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
// schemas: every object closes additionalProperties and requires all its keys (structured-output rules)
const closed = (o) => !o || typeof o !== 'object' || ((o.type !== 'object' || (o.additionalProperties === false && isDeepStrictEqual([...o.required].toSorted(), Object.keys(o.properties).toSorted()))) && Object.values(o).every(closed));
check('read.schemas_closed', Object.values(plain(C.READ_SCHEMAS)).every(closed), 'open object in a schema');

const failed = results.filter(r => !r.pass);
const receipt = { gate: 'core', verdict: failed.length ? 'fail' : 'pass', checks: results.length, failed: failed.length, ...(failed.length ? { failures: failed } : {}) };
console.log(JSON.stringify(receipt, null, 1));
process.exit(failed.length ? 1 : 0);
