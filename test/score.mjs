// Shared by the reader evals (live.mjs, cli-read.mjs): load the page's pure blocks in a vm, and score a reading of
// "The whistle" against the explainer's own labels. The score measures agreement with one editorial reading, not truth.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const plain = (o) => JSON.parse(JSON.stringify(o));

export function loadPage() {
  const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const ctx = vm.createContext({ crypto: globalThis.crypto, TextEncoder });
  for (const id of ['sandhi-core', 'sandhi-ladder']) vm.runInContext(new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`).exec(page)[1], ctx);
  const C = ctx.SandhiCore, L = ctx.SandhiLadder, seed = plain(C.seed());
  return { C, L, seed, prose: seed.beats.map(b => b.text).join('\n\n') };
}

export function score(story, seed, prose, C) {
  const startOf = (t) => prose.indexOf(t.slice(0, 60));
  const seedAt = new Map(seed.beats.map((b, i) => [startOf(b.text), i]));
  const aligned = story.beats.map(b => ({ b, s: seedAt.get(startOf(b.text)) })).filter(x => x.s !== undefined);
  const contains = (b, i) => b.text.includes(seed.beats[i].text.slice(0, 40));
  const n = aligned.filter(x => x.s > 0).length;
  const agree = (k) => aligned.filter(x => x.s > 0).filter(x => (x.b[k] || null) === (seed.beats[x.s][k] || null)).length;
  const beatOf = (id) => story.beats.find(b => b.id === id);
  return {
    beats: story.beats.length, boundaries_matching_seed: `${aligned.length}/10`,
    turn_on_the_whistle: story.beats.some(b => b.marks.includes('turn') && contains(b, 7)),
    low_on_the_gull: story.beats.some(b => b.marks.includes('low') && contains(b, 6)),
    joints_agree: `${agree('joint')}/${n}`, spine_agree: `${agree('spine')}/${n}`,
    threads: story.threads.length,
    whistle_thread: story.threads.some(t => t.plant && contains(beatOf(t.plant), 1) && t.payoffs.some(p => contains(beatOf(p), 7))),
    arc: plain(C.arcMatch(story)).best, checks: plain(C.checks(story)).map(c => c.class)
  };
}

// A story with small hand labels (test/stories/<name>.labels.json): did the reading find the turn, the low point and
// each labelled thread? A label is a short exact quote; the reading finds it when a beat it marks contains the quote.
const has = (b, q) => !!b && b.text.includes(q);
export function scoreStory(story, labels, C) {
  const beatOf = (id) => story.beats.find(b => b.id === id);
  const marked = (m) => story.beats.filter(b => b.marks.includes(m));
  const found = (t) => story.threads.some(x => x.plant && has(beatOf(x.plant), t.plant) && x.payoffs.some(p => has(beatOf(p), t.payoff)));
  return {
    beats: story.beats.length,
    turn: labels.turn.length ? marked('turn').some(b => labels.turn.some(q => has(b, q))) : null,
    low: labels.low.length ? marked('low').some(b => labels.low.some(q => has(b, q))) : null,
    threads_found: `${labels.threads.filter(found).length}/${labels.threads.length}`,
    threads_named: story.threads.length,
    checks: plain(C.checks(story)).map(c => c.class)
  };
}
