// Two-doors parity lint (SPEC §0, Build Doctrine): manifest ⊇ command bus.
//   node test/parity.mjs
// From index.html's source alone:
//   1. every data-cmd="<name>" control names a TOOLS entry
//   2. every bus.dispatch('<name>') / ui('<name>') literal names a TOOLS entry
//   3. every TOOLS entry has a handler
//   4. every outcome class used in fail(...) is in the closed set (SPEC §0)
//   5. both doors exist: window.sandhi and navigator.modelContext
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = src.slice(src.indexOf('const TOOLS = ['));
const findings = [];
const names = [...app.matchAll(/\{ name: '([a-z.]+)', description:/g)].map(m => m[1]);
const cmds = new Set([...src.matchAll(/data-cmd="([a-z.]+)"/g)].map(m => m[1]));
const calls = new Set([...src.matchAll(/(?:bus\.dispatch|\bui)\('([a-z.]+)'/g)].map(m => m[1]));
const ternary = [...src.matchAll(/\bui\(e\.shiftKey \? '([a-z.]+)' : '([a-z.]+)'/g)].flatMap(m => [m[1], m[2]]);
for (const t of ternary) calls.add(t);
// the closed set is SPEC §0's own list, read from SPEC.md, so the code and the contract cannot drift apart (forward pass T8)
const spec = readFileSync(new URL('../SPEC.md', import.meta.url), 'utf8');
const classLine = (spec.split('\n').find(l => l.startsWith('**Outcome classes (closed):**')) || '');
const CLASSES = new Set([...classLine.matchAll(/`([a-z_]+)`/g)].map(m => m[1]));
if (CLASSES.size < 10) findings.push('SPEC §0 has no outcome class list');
const used = new Set([...src.matchAll(/(?:fail|readerFail)\('([a-z_]+)'/g)].map(m => m[1]));
// person-only tools exist in the manifest and are refused on every door but the page (SPEC §0)
for (const n of ['read.accept', 'reader.key']) if (!new RegExp(`name: '${n.replace('.', '\\.')}'[^\\n]*\\n?[^\\n]*personOnly: true`).test(app)) findings.push(`${n}: not marked personOnly`);
if (!/t\.personOnly && door !== 'ui'/.test(src)) findings.push('bus does not refuse person-only tools off the ui door');

if (new Set(names).size !== names.length) findings.push('duplicate tool names');
for (const c of cmds) if (!names.includes(c)) findings.push(`data-cmd="${c}" has no manifest entry`);
for (const c of calls) if (!names.includes(c)) findings.push(`dispatch of '${c}' names no manifest entry`);
for (const n of names) {
  const at = app.indexOf(`{ name: '${n}', description:`), next = app.indexOf('{ name: ', at + 10);
  if (!/handler: async/.test(app.slice(at, next < 0 ? undefined : next))) findings.push(`${n}: no handler`);
}
for (const c of used) if (!CLASSES.has(c)) findings.push(`class '${c}' is outside the closed set`);
if (!/navigator\.modelContext\.registerTool/.test(src)) findings.push('no navigator.modelContext door');
if (!/window\.sandhi = \{/.test(src)) findings.push('no window.sandhi door');

const receipt = { gate: 'parity', verdict: findings.length ? 'fail' : 'pass', tools: names.length, data_cmd: cmds.size, dispatch_literals: calls.size, classes_used: [...used].toSorted(), findings };
console.log(JSON.stringify(receipt, null, 1));
process.exit(findings.length ? 1 : 0);
