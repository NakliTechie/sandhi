// CLI reader eval (opt-in; not part of `npm test`): any model reachable from a command line or a subagent reads
// "The whistle" with the page's own prompt and schema, and its raw reply is scored through the page's own pipeline.
//   node test/cli-read.mjs prompt <dir>                  writes <dir>/prompt.txt and <dir>/schema.json (strategy: whole)
//   node test/cli-read.mjs score <reply-file> <name>     extracts the JSON, builds the story, scores it
//   add --story <name> to either: a story in test/stories/ with small hand labels (default: The whistle)
// Examples:
//   codex exec --skip-git-repo-check --ephemeral -s read-only --output-schema <dir>/schema.json -o <dir>/codex.json "$(cat <dir>/prompt.txt)"
//   opencode run -m opencode/space-bunny-free "$(cat <dir>/prompt.txt)" > <dir>/bunny.txt
// Writes test/receipts/cli-<name>.json.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadPage, score, scoreStory, plain } from './score.mjs';

const { C, L, seed, prose: whistle } = loadPage();
const [cmd, a1, a2] = process.argv.slice(2);
// --story <name>: a story in test/stories/ with small hand labels; default: The whistle, scored against the explainer
const si = process.argv.indexOf('--story'), storyName = si > 0 ? process.argv[si + 1] : null;
const prose = storyName ? readFileSync(new URL(`./stories/${storyName}.txt`, import.meta.url), 'utf8').trim() : whistle;
const labels = storyName ? JSON.parse(readFileSync(new URL(`./stories/${storyName}.labels.json`, import.meta.url), 'utf8')) : null;

if (cmd === 'prompt') {
  const p = C.READ_PROMPTS.whole(prose), schema = plain(C.READ_SCHEMAS.whole);
  mkdirSync(a1, { recursive: true });
  // one text: the reader's instructions, the task, and the shape of the answer (as the page's 'object' JSON mode words it)
  const text = `${p.system}\n\n${p.user}\n\nAnswer with one JSON object and nothing else. It follows this JSON Schema:\n${JSON.stringify(schema)}`;
  writeFileSync(join(a1, 'prompt.txt'), text);
  writeFileSync(join(a1, 'schema.json'), JSON.stringify(schema, null, 1));
  console.log(JSON.stringify({ prompt: join(a1, 'prompt.txt'), chars: text.length, schema: join(a1, 'schema.json') }));
} else if (cmd === 'score') {
  const raw = readFileSync(a1, 'utf8'), json = L.extractJson(raw), name = (a2 || 'reader') + (storyName ? `-${storyName}` : '');
  let receipt;
  if (!json) receipt = { gate: 'cli-read', reader: name, error: 'no JSON object in the reply', head: raw.slice(0, 300) };
  else {
    const built = plain(C.storyFromWhole(prose, json, name));
    receipt = built.story
      ? { gate: 'cli-read', reader: name, story: storyName || 'the-whistle', words: C.wordCount(prose), dropped: built.dropped, valid: C.validate(built.story).ok, score: labels ? scoreStory(built.story, labels, C) : score(built.story, seed, prose, C),
          beats: built.story.beats.map((b, i) => `${i + 1} ${b.spine}/${b.joint || '-'} f${b.fortune}${b.marks.length ? ' ' + b.marks.join('+') : ''} | ${b.text.slice(0, 50)}`),
          threads: built.story.threads.map(t => `${t.label}: ${t.plant} -> ${t.payoffs.join(',')}`) }
      : { gate: 'cli-read', reader: name, error: 'no beat quote matched the text', dropped: built.dropped };
  }
  mkdirSync(new URL('./receipts/', import.meta.url), { recursive: true });
  writeFileSync(new URL(`./receipts/cli-${name.replace(/[^a-z0-9._-]+/gi, '_')}.json`, import.meta.url), JSON.stringify(receipt, null, 1));
  console.log(JSON.stringify(receipt, null, 1));
  process.exit(receipt.error ? 1 : 0);
} else {
  console.error('usage: node test/cli-read.mjs prompt <dir> | score <reply-file> <name>');
  process.exit(2);
}
