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
check('ladder.providers_https', Object.entries(provs).every(([id, p]) => (id === 'custom' ? p.base === '' : p.base.startsWith('https://'))) && isDeepStrictEqual(Object.keys(provs).toSorted(), ['anthropic', 'custom', 'deepseek', 'gemini', 'groq', 'mistral', 'openai', 'openrouter', 'together']), Object.keys(provs));
const PRESET = { anthropic: 'claude-opus-5-5', deepseek: 'deepseek-flash' };   // the two models measured with the page's prompt (SPEC §5)
check('ladder.model_presets', Object.entries(provs).every(([id, p]) => p.model === PRESET[id]) && Object.entries(provs).every(([id, p]) => id === 'custom' ? !p.keys : String(p.keys).startsWith('https://')), 'presets and key links');
check('ladder.servers_loopback', Object.values(plain(L.SERVERS)).every(x => /^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(x.base) && /^http:\/\/127\.0\.0\.1:\d+\/api/.test(x.native)) && L.SERVERS.ollama.window === 16384, 'servers');

// 4. the OpenAI-compatible body in three JSON modes, strictest first
const schema = { type: 'object', additionalProperties: false, required: ['a'], properties: { a: { type: 'string' } } };
const pr = { system: 'SYS', user: 'USER' };
const bs = plain(L.openaiBody('m', pr, schema, 'schema')), bo = plain(L.openaiBody('m', pr, schema, 'object')), bp = plain(L.openaiBody('m', pr, schema, 'prompt'));
check('ladder.modes_order', isDeepStrictEqual(plain(L.JSON_MODES), ['schema', 'object', 'prompt']), L.JSON_MODES);
check('ladder.body_schema', bs.model === 'm' && bs.response_format.type === 'json_schema' && isDeepStrictEqual(bs.response_format.json_schema.schema, schema) && bs.response_format.json_schema.strict === true
  && bs.messages[0].content === 'SYS' && bs.messages[1].content === 'USER' && bs.max_tokens === undefined, bs);
check('ladder.body_object', bo.response_format.type === 'json_object' && bo.messages[0].content.includes('JSON Schema') && bo.messages[0].content.includes('"required":["a"]'), bo);
check('ladder.body_prompt', bp.response_format === undefined && bp.messages[0].content.includes('JSON Schema'), bp);
const bx = plain(L.openaiBody('m', pr, schema, 'schema', { reasoning_effort: 'none' }));
check('ladder.body_extra', bx.reasoning_effort === 'none' && bx.response_format.type === 'json_schema', bx);

// 4b. Ollama's own chat body: the window per request (its OpenAI API ignores num_ctx and runs in 4,096), no thinking
const os = plain(L.ollamaBody('q', pr, schema, 'schema', 16384)), oo = plain(L.ollamaBody('q', pr, schema, 'object', 16384)), op = plain(L.ollamaBody('q', pr, schema, 'prompt', 16384));
check('ladder.ollama_body', os.options.num_ctx === 16384 && os.think === false && os.stream === false && isDeepStrictEqual(os.format, schema) && os.messages[0].content === 'SYS'
  && oo.format === 'json' && oo.messages[0].content.includes('JSON Schema') && op.format === undefined, { os, oo: oo.format, op: op.format });
check('ladder.parse_ollama', isDeepStrictEqual(plain(L.parseOllama({ model: 'q', message: { content: '{"a":"1"}' }, done_reason: 'stop' })), { json: { a: '1' }, model: 'q' })
  && L.parseOllama({ message: { content: '{"a":' }, done_reason: 'length' }).error === 'too_long' && L.parseOllama({}).error === 'not_json', 'ollama replies');

// 5. replies: plain JSON, fenced JSON, refusal, cut off, not JSON; Anthropic's shape too
const oa = (content, extra) => ({ model: 'x/y', choices: [{ finish_reason: 'stop', message: { content, ...extra } }] });
check('ladder.parse_plain', isDeepStrictEqual(plain(L.parseOpenAI(oa('{"a":"1"}'))), { json: { a: '1' }, model: 'x/y' }), 'plain');
check('ladder.parse_fenced', isDeepStrictEqual(plain(L.parseOpenAI(oa('Here:\n```json\n{"a":"1"}\n```'))).json, { a: '1' }), 'fenced');
check('ladder.parse_refusal', L.parseOpenAI(oa(null, { refusal: 'no' })).error === 'refused', 'refusal');
check('ladder.parse_length', L.parseOpenAI({ choices: [{ finish_reason: 'length', message: { content: '{"a":' } }] }).error === 'too_long', 'length');
check('ladder.parse_prose_braces', isDeepStrictEqual(plain(L.extractJson('{"a":1}\nNote: I used {braces} here.')), { a: 1 }) && isDeepStrictEqual(plain(L.extractJson('{"a":1}\n{"b":2}')), { a: 1 })
  && isDeepStrictEqual(plain(L.extractJson('Sure {not json} here: {"a":"x}y{"} and } more')), { a: 'x}y{' }) && L.extractJson('no object at all') === null, 'prose braces');
check('ladder.parse_not_json', L.parseOpenAI(oa('I cannot help with that.')).error === 'not_json', 'not json');
check('ladder.parse_anthropic', isDeepStrictEqual(plain(L.parseAnthropic({ model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"a":"1"}' }] })), { json: { a: '1' }, model: 'claude-opus-5-5' })
  && L.parseAnthropic({ stop_reason: 'refusal', content: [] }).error === 'refused' && L.parseAnthropic({ stop_reason: 'max_tokens', content: [] }).error === 'too_long', 'anthropic');
check('ladder.model_ids', isDeepStrictEqual(plain(L.modelIds({ data: [{ id: 'b' }, { id: 'a' }, {}, null] })), ['a', 'b']) && L.modelIds({}).length === 0, 'model ids');

// 6. error text: the request's own key is taken out whatever its shape (Mistral's are 32 letters and digits, no prefix)
const KEY32 = 'Q7xY9mN2pL4kR8sT1vW6zA3bC5dE0fG7';
check('ladder.scrub_unprefixed_key', !L.scrub(`Invalid API key: ${KEY32}`, KEY32).includes(KEY32) && L.scrub(`Invalid API key: ${KEY32}`, KEY32).includes('[key]')
  && !L.scrub(`key ...${KEY32.slice(-10)} rejected`, KEY32).includes(KEY32.slice(-10)) && L.scrub('Incorrect API key provided: sk-test-0000-not-a-real-key').includes('[key]')
  && L.scrub('model not found', KEY32) === 'model not found', L.scrub(`Invalid API key: ${KEY32}`, KEY32));

// 7. fingerprints: stable, short, and not the key
const f1 = await L.fingerprint('sk-test-0000'), f2 = await L.fingerprint('sk-test-0000'), f3 = await L.fingerprint('sk-test-0001');
check('ladder.fingerprint', /^key·[0-9a-f]{8}$/.test(f1) && f1 === f2 && f1 !== f3 && !f1.includes('sk-'), [f1, f3]);

const failed = results.filter(x => !x.pass);
console.log(JSON.stringify({ gate: 'ladder', verdict: failed.length ? 'fail' : 'pass', checks: results.length, failed: failed.length, ...(failed.length ? { failures: failed } : {}) }, null, 1));
process.exit(failed.length ? 1 : 0);
