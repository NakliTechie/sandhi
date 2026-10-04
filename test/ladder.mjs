// Ladder gate (SPEC §3): the AI ladder's pure half, run in Node from the page's #sandhi-ladder block.
//   node test/ladder.mjs
// Order and readiness of the rungs, the "where the words go" labels, the OpenAI-compatible request in its three
// JSON modes, reply parsing for both API shapes, key fingerprints, and that every provider host is https.
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import vm from 'node:vm';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const src = (/<script id="sandhi-ladder">([\s\S]*?)<\/script>/.exec(page) || [])[1];
const ctx = vm.createContext({ crypto: globalThis.crypto, TextEncoder });
vm.runInContext(src, ctx);
const L = ctx.SandhiLadder;
const plain = (o) => JSON.parse(JSON.stringify(o));
const results = [];
const check = (id, pass, detail) => results.push({ id, pass: !!pass, ...(pass ? {} : { detail }) });

// 1. order and readiness: closest first; Nano that still needs a download is available but not ready
const d = async (o) => plain(await L.detectLadder(o));
let r = await d({ probeMachine: async () => 'ollama', nanoState: async () => 'ready', hasKey: async () => true });
check('ladder.order', isDeepStrictEqual(r.rungs, ['machine', 'device', 'provider']) && r.ready === 'machine' && r.server === 'ollama', r);
r = await d({ nanoState: async () => 'download', hasKey: async () => true });
check('ladder.download_not_ready', isDeepStrictEqual(r.rungs, ['device', 'provider']) && r.ready === 'provider' && r.best === 'provider', r);
r = await d({ nanoState: async () => 'download' });
check('ladder.only_download', r.ready === null && r.best === 'device', r);
r = await d({ probeMachine: async () => { throw new Error('refused'); }, nanoState: async () => { throw new Error('x'); } });
check('ladder.throwing_probes_read_as_absent', r.rungs.length === 0 && r.ready === null && r.best === null && r.device === 'absent', r);
check('ladder.no_probes', (await d()).rungs.length === 0, 'rungs without probes');

// 2. where the words go
check('ladder.labels', /stays on your machine/.test(L.rungLabel('machine', { server: 'ollama' })) && /Ollama/.test(L.rungLabel('machine', { server: 'ollama' }))
  && /stays on this device/.test(L.rungLabel('device')) && /OpenRouter, with your key: the story leaves this device/.test(L.rungLabel('provider', { provider: 'openrouter' })), 'labels');
check('ladder.local', L.rungIsLocal('machine') && L.rungIsLocal('device') && !L.rungIsLocal('provider'), 'rungIsLocal');

// 3. providers: every listed host is https; the only preset model is Anthropic's; local servers are loopback
const provs = plain(L.PROVIDERS);
check('ladder.providers_https', Object.entries(provs).every(([id, p]) => (id === 'custom' ? p.base === '' : p.base.startsWith('https://'))) && Object.keys(provs).length >= 8, provs);
check('ladder.model_presets', Object.entries(provs).every(([id, p]) => (id === 'anthropic' ? p.model === 'claude-opus-5-5' : !p.model)), 'presets');
check('ladder.servers_loopback', Object.values(plain(L.SERVERS)).every(x => /^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(x.base)), 'servers');

// 4. the OpenAI-compatible body in three JSON modes, strictest first
const schema = { type: 'object', additionalProperties: false, required: ['a'], properties: { a: { type: 'string' } } };
const pr = { system: 'SYS', user: 'USER' };
const bs = plain(L.openaiBody('m', pr, schema, 'schema')), bo = plain(L.openaiBody('m', pr, schema, 'object')), bp = plain(L.openaiBody('m', pr, schema, 'prompt'));
check('ladder.modes_order', isDeepStrictEqual(plain(L.JSON_MODES), ['schema', 'object', 'prompt']), L.JSON_MODES);
check('ladder.body_schema', bs.model === 'm' && bs.response_format.type === 'json_schema' && isDeepStrictEqual(bs.response_format.json_schema.schema, schema) && bs.response_format.json_schema.strict === true
  && bs.messages[0].content === 'SYS' && bs.messages[1].content === 'USER' && bs.max_tokens === undefined, bs);
check('ladder.body_object', bo.response_format.type === 'json_object' && bo.messages[0].content.includes('JSON Schema') && bo.messages[0].content.includes('"required":["a"]'), bo);
check('ladder.body_prompt', bp.response_format === undefined && bp.messages[0].content.includes('JSON Schema'), bp);

// 5. replies: plain JSON, fenced JSON, refusal, cut off, not JSON; Anthropic's shape too
const oa = (content, extra) => ({ model: 'x/y', choices: [{ finish_reason: 'stop', message: { content, ...extra } }] });
check('ladder.parse_plain', isDeepStrictEqual(plain(L.parseOpenAI(oa('{"a":"1"}'))), { json: { a: '1' }, model: 'x/y' }), 'plain');
check('ladder.parse_fenced', isDeepStrictEqual(plain(L.parseOpenAI(oa('Here:\n```json\n{"a":"1"}\n```'))).json, { a: '1' }), 'fenced');
check('ladder.parse_refusal', L.parseOpenAI(oa(null, { refusal: 'no' })).error === 'refused', 'refusal');
check('ladder.parse_length', L.parseOpenAI({ choices: [{ finish_reason: 'length', message: { content: '{"a":' } }] }).error === 'too_long', 'length');
check('ladder.parse_not_json', L.parseOpenAI(oa('I cannot help with that.')).error === 'not_json', 'not json');
check('ladder.parse_anthropic', isDeepStrictEqual(plain(L.parseAnthropic({ model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"a":"1"}' }] })), { json: { a: '1' }, model: 'claude-opus-5-5' })
  && L.parseAnthropic({ stop_reason: 'refusal', content: [] }).error === 'refused' && L.parseAnthropic({ stop_reason: 'max_tokens', content: [] }).error === 'too_long', 'anthropic');
check('ladder.model_ids', isDeepStrictEqual(plain(L.modelIds({ data: [{ id: 'b' }, { id: 'a' }, {}, null] })), ['a', 'b']) && L.modelIds({}).length === 0, 'model ids');

// 6. fingerprints: stable, short, and not the key
const f1 = await L.fingerprint('sk-test-0000'), f2 = await L.fingerprint('sk-test-0000'), f3 = await L.fingerprint('sk-test-0001');
check('ladder.fingerprint', /^key·[0-9a-f]{8}$/.test(f1) && f1 === f2 && f1 !== f3 && !f1.includes('sk-'), [f1, f3]);

const failed = results.filter(x => !x.pass);
console.log(JSON.stringify({ gate: 'ladder', verdict: failed.length ? 'fail' : 'pass', checks: results.length, failed: failed.length, ...(failed.length ? { failures: failed } : {}) }, null, 1));
process.exit(failed.length ? 1 : 0);
