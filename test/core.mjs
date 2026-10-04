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
  flat_fortune: s => { for (const b of s.beats) b.fortune = 1; }
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

const failed = results.filter(r => !r.pass);
const receipt = { gate: 'core', verdict: failed.length ? 'fail' : 'pass', checks: results.length, failed: failed.length, ...(failed.length ? { failures: failed } : {}) };
console.log(JSON.stringify(receipt, null, 1));
process.exit(failed.length ? 1 : 0);
