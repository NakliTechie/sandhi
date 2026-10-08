// Narrative-Discourse read eval (opt-in; not part of `npm test`). Tian et al., EMNLP 2024 (arXiv 2407.13248) release
// human turning-point and arc labels for film synopses (github.com/PlusLabNLP/Narrative-Discourse, data_release/, Apache-2.0).
// sandhi's turn is scored against TP3 (point of no return), its low point against TP4 (major setback), its closest arc
// against the human arc. Only the GPT-4 synopses are sampled: the human ones are Wikipedia text (CC BY-SA).
//   node test/nd-eval.mjs sample <data_release dir> <n> <sample.json>   a fixed sample: every k-th labelled GPT synopsis
//   node test/nd-eval.mjs prompt <sample.json> <dir>                    the page's own prompt per story, for CLI readers
//   node test/nd-eval.mjs score <sample.json> <replies dir> <name>      raw replies <id>.txt|.json, through the page's pipeline
//   node test/nd-eval.mjs score-stories <sample.json> <stories.json> <name>   {id: story} saved from the page (read.get)
// Writes test/receipts/nd-<name>.json. The data is not committed; pass the folder you downloaded.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadPage, plain } from './score.mjs';

const { C, L } = loadPage();
const [cmd, a1, a2, a3] = process.argv.slice(2);
// the paper's seven arcs, onto sandhi's six; Double Man in Hole has no shape of its own here and counts as Man in Hole
const ARC = { 'Man in Hole': 'hole', 'Double Man in Hole': 'hole', 'Rags to Riches': 'rags', 'Riches to Rags': 'tragedy', Icarus: 'icarus', Cinderella: 'cinderella', Oedipus: 'oedipus' };

function sample(dir, n, out) {
  const stories = JSON.parse(readFileSync(join(dir, 'narratives.json'), 'utf8'));
  const tp = JSON.parse(readFileSync(join(dir, 'ground_truth_tp.json'), 'utf8')), arc = JSON.parse(readFileSync(join(dir, 'ground_truth_arc.json'), 'utf8'));
  const byId = new Map((Array.isArray(stories) ? stories.map((x, i) => [String(x.id ?? i), x]) : Object.entries(stories)));
  const ids = Object.keys(tp).filter(id => arc[id] && byId.has(id) && /gpt/i.test(String(byId.get(id).source || ''))).toSorted();
  const step = Math.max(1, Math.floor(ids.length / n));
  const picked = ids.filter((_, k) => k % step === 0).slice(0, n).map(id => {
    const x = byId.get(id), sents = (Array.isArray(x.synopsis) ? x.synopsis : [String(x.synopsis)]).map(s => String(s).trim()).filter(Boolean);
    return { id, title: x.title || '', sentences: sents, tp: tp[id], arc: arc[id] };
  });
  writeFileSync(out, JSON.stringify({ source: 'Narrative-Discourse data_release (Apache-2.0), GPT-4 synopses', n: picked.length, of: ids.length, stories: picked }, null, 1));
  console.log(JSON.stringify({ sample: out, n: picked.length, of: ids.length }));
}
// a story's text and where each sentence starts in it: sentences joined with one space
function textOf(st) {
  const starts = []; let text = '';
  for (const s of st.sentences) { starts.push(text ? text.length + 1 : 0); text += (text ? ' ' : '') + s; }
  return { text, starts };
}
// the 1-based sentence that holds character position pos
const sentenceAt = (starts, pos) => starts.findLastIndex(s => s <= pos) + 1;
// a beat's sentences, first to last (1-based), from where its text lies in the story
function beatSpan(story, i, text, starts) {
  const from = text.indexOf(story.beats[i].text.slice(0, 60)), to = from + story.beats[i].text.length - 1;
  return from < 0 ? null : [sentenceAt(starts, from), sentenceAt(starts, to)];
}
// distance in sentences from a human turning point to a marked beat's span (0 inside), and whether it lies within 3
function mark(story, m, text, starts, gold) {
  const i = story.beats.findIndex(b => b.marks.includes(m)), span = i < 0 ? null : beatSpan(story, i, text, starts);
  if (!span) return { found: false };
  const d = gold >= span[0] && gold <= span[1] ? 0 : Math.min(Math.abs(gold - span[0]), Math.abs(gold - span[1]));
  return { found: true, span, gold, inside: d === 0, within3: d <= 3, distance: d };
}
// which of the five human turning points lies nearest a marked beat (ties go to the earlier one): is sandhi's turn TP3?
function nearestTp(story, m, text, starts, tp) {
  const i = story.beats.findIndex(b => b.marks.includes(m)), span = i < 0 ? null : beatSpan(story, i, text, starts);
  if (!span) return null;
  const d = (g) => (g >= span[0] && g <= span[1] ? 0 : Math.min(Math.abs(g - span[0]), Math.abs(g - span[1])));
  return ['tp1', 'tp2', 'tp3', 'tp4', 'tp5'].reduce((best, k) => (d(Math.round(tp[k])) < d(Math.round(tp[best])) ? k : best), 'tp1');
}
function scoreOne(st, story) {
  const { text, starts } = textOf(st), n = st.sentences.length;
  const turn = mark(story, 'turn', text, starts, Math.round(st.tp.tp3)), low = mark(story, 'low', text, starts, Math.round(st.tp.tp4));
  turn.nearest = nearestTp(story, 'turn', text, starts, st.tp); low.nearest = nearestTp(story, 'low', text, starts, st.tp);
  // sandhi's turn is the major reversal (decision 2026-10-08): scored against the nearest of TP3, TP4 and TP5
  const rev = ['tp3', 'tp4', 'tp5'].map(k => mark(story, 'turn', text, starts, Math.round(st.tp[k]))).filter(x => x.found).toSorted((x, y) => x.distance - y.distance)[0] || { found: false };
  turn.reversal = rev;
  const best = plain(C.arcMatch(story)).best;
  return { id: st.id, sentences: n, beats: story.beats.length, turn, low, arc: { gold: st.arc, want: ARC[st.arc], got: best, hit: best === ARC[st.arc] } };
}
// the position-only baseline: TP3 and TP4 guessed at their median place in the sample, a beat of one sentence
const med = (a) => a.toSorted((x, y) => x - y)[Math.floor(a.length / 2)];
const placeHit = (s, r, g) => { const at = Math.max(1, Math.round(r * s.sentences.length)), d = Math.abs(at - Math.round(g)); return { inside: d === 0, within3: d <= 3 }; };
const share = (a, k) => Math.round(100 * a.filter(x => x[k]).length / a.length);
function baseline(stories) {
  const r3 = med(stories.map(s => s.tp.tp3 / s.sentences.length)), r4 = med(stories.map(s => s.tp.tp4 / s.sentences.length));
  const t = stories.map(s => placeHit(s, r3, s.tp.tp3)), l = stories.map(s => placeHit(s, r4, s.tp.tp4)), pct = share;
  // the reversal baseline: one guess at TP4's median place, a hit when it lands on any of TP3, TP4, TP5
  const rv = stories.map(s => ['tp3', 'tp4', 'tp5'].map(k => placeHit(s, r4, s.tp[k])).reduce((a, b) => ({ inside: a.inside || b.inside, within3: a.within3 || b.within3 })));
  return { turn_place: +r3.toFixed(2), low_place: +r4.toFixed(2), turn_exact: pct(t, 'inside'), turn_within3: pct(t, 'within3'), low_exact: pct(l, 'inside'), low_within3: pct(l, 'within3'), reversal_exact: pct(rv, 'inside'), reversal_within3: pct(rv, 'within3'), arc_majority: Math.round(100 * Math.max(...Object.values(stories.reduce((m, s) => ({ ...m, [ARC[s.arc]]: (m[ARC[s.arc]] || 0) + 1 }), {}))) / stories.length) };
}
const tally = (xs) => xs.reduce((m, x) => ({ ...m, [x || 'unmarked']: (m[x || 'unmarked'] || 0) + 1 }), {});
function summary(rows, all) {
  const ok = rows.filter(r => !r.error), pct = (f) => (ok.length ? Math.round(100 * ok.filter(f).length / ok.length) : 0);
  const sum = (f) => ok.filter(f).length;
  return { read: ok.length, of: all.length, failed: rows.length - ok.length,
    turn_inside: pct(r => r.turn.inside), turn_within3: pct(r => r.turn.within3), turn_marked: sum(r => r.turn.found),
    low_inside: pct(r => r.low.inside), low_within3: pct(r => r.low.within3), low_marked: sum(r => r.low.found),
    turn_reversal_inside: pct(r => r.turn.reversal && r.turn.reversal.inside), turn_reversal_within3: pct(r => r.turn.reversal && r.turn.reversal.within3),
    arc_hit: pct(r => r.arc.hit), turn_nearest: tally(ok.map(r => r.turn.nearest)), low_nearest: tally(ok.map(r => r.low.nearest)), mean_beat_sentences: ok.length ? +(ok.reduce((n, r) => n + r.sentences / r.beats, 0) / ok.length).toFixed(1) : 0 };
}
function report(name, s, rows) {
  const receipt = { eval: 'narrative-discourse', reader: name, data: s.source, summary: summary(rows, s.stories), baseline: baseline(s.stories),
    note: 'turn vs TP3, low vs TP4: inside = the human sentence lies in the marked beat; within3 = within 3 sentences of it (the paper\'s fuzzy rule). Beats span several sentences, so inside is easier than the paper\'s one-sentence exact match; mean_beat_sentences says how much easier.', rows };
  mkdirSync(new URL('./receipts/', import.meta.url), { recursive: true });
  const out = new URL(`./receipts/nd-${name}.json`, import.meta.url);
  writeFileSync(out, JSON.stringify(receipt, null, 1));
  console.log(JSON.stringify({ receipt: out.pathname, summary: receipt.summary, baseline: receipt.baseline }, null, 1));
}

if (cmd === 'sample') sample(a1, Number(a2) || 30, a3);
else if (cmd === 'prompt') {
  const s = JSON.parse(readFileSync(a1, 'utf8')), schema = plain(C.READ_SCHEMAS.whole);
  mkdirSync(a2, { recursive: true });
  for (const st of s.stories) {
    const p = C.READ_PROMPTS.whole(textOf(st).text);
    writeFileSync(join(a2, `${st.id}.prompt.txt`), `${p.system}\n\n${p.user}\n\nAnswer with one JSON object and nothing else. It follows this JSON Schema:\n${JSON.stringify(schema)}`);
  }
  writeFileSync(join(a2, 'schema.json'), JSON.stringify(schema, null, 1));
  console.log(JSON.stringify({ prompts: s.stories.length, dir: a2 }));
} else if (cmd === 'score') {
  const s = JSON.parse(readFileSync(a1, 'utf8'));
  const rows = s.stories.map(st => {
    const f = [join(a2, `${st.id}.json`), join(a2, `${st.id}.txt`)].find(existsSync);
    if (!f) return { id: st.id, error: 'no reply' };
    const json = L.extractJson(readFileSync(f, 'utf8')); if (!json) return { id: st.id, error: 'no JSON in the reply' };
    const built = plain(C.storyFromWhole(textOf(st).text, json, a3));
    return built.story ? scoreOne(st, built.story) : { id: st.id, error: 'no beat quote matched' };
  });
  report(a3, s, rows);
} else if (cmd === 'score-stories') {
  const s = JSON.parse(readFileSync(a1, 'utf8')), saved = JSON.parse(readFileSync(a2, 'utf8'));
  report(a3, s, s.stories.map(st => (saved[st.id] && saved[st.id].beats ? scoreOne(st, saved[st.id]) : { id: st.id, error: saved[st.id] && saved[st.id].error || 'no story' })));
} else {
  console.log('usage: sample <data dir> <n> <out> | prompt <sample> <dir> | score <sample> <replies dir> <name> | score-stories <sample> <stories.json> <name>');
  process.exit(1);
}
