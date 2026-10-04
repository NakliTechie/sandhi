# sandhi — spec

Tier: **Tool**. This file is the one doc: agent contract, data model, roadmap pointer. The README carries the vision; `plan/` carries the working state.

Unity sentence: *a calm writing surface that shows a story's joints, in the explainer's cream-paper voice* (direction **Calm**).

## §0 Agent contract (DRIVER pass, 2026-10-04)

An agent driving sandhi is context-poor and may be killed mid-turn. The contract below is what every later design decision answers to.

| DRIVER principle | sandhi's answer |
|---|---|
| 1 One perception act | `status`: title, beat/word/thread counts, check counts by class, closest arc, unsaved state, whether the browser kept it (`kept`), undo depth, last call, and what the writer has open (`ui`: dialog, tour, pending typing). One bounded read. |
| 2 Machine-decidable | Every call returns `{ok, class, data?, message?, next?}`. `class` is closed (below). Checks carry a closed `class`, a beat position and a `next` remedy. All story fields with a fixed meaning use closed vocabularies. |
| 3 One verdict per next action | `invalid` → fix the named fields; `not_found` → re-read ids via `status`/`story.get`; `stack_empty` → nothing to do; `io_error` → fall back to `story.get`; `unknown_tool` → read `manifest`; `internal` → report it, the story is unchanged; `person_only` → ask the writer; `cancelled` → read again when ready. |
| 4 Bounded output | `status` is constant-size. `checks` grows with divergence, not story size: a clean story is `{count:0}`. `story.get` and `read.get` (a whole proposed story) grow with the story; no other call does. `journal` returns at most 200 entries. |
| 5 Failures name the remedy | Every failure carries `next`, the exact next step. |
| 6 Crash-safe, idempotent | A mutation builds a new story, validates it against schema `sandhi:1`, and only then replaces the old one and autosaves it in one write. A failed validation leaves the old story. Reads are side-effect free. The last 30 undo steps are saved too, so undo works after a reload. Leaving the page commits the field the writer typed in and pending typing; a field the writer did not touch never writes back. Every redraw first lands the writer's pending typing. Another tab's save is adopted, and undo brings this tab's version back. When the browser's store is full, the saved undo gives way to the story; when even the story cannot be written, `status.kept` is false and the page says so. Undo groups typing per door and per field, 5 s at most. |
| 7 The tool holds the memory | The journal (last 200 calls: tool, class, door, ms, time), shared by every tab, is kept in the browser and rendered by `journal`. The story autosaves after every mutation. |
| 8 Accretive by mechanism | Every check class ships with a fixture in `test/` that triggers it. A new class lands only with its fixture. An escaped defect becomes a fixture. |
| 9 A tower | L0 library (13 principles, 9 sources, 6 arcs, vocabularies) → L1 story schema + `validate` → L2 derived views (`checks`, `arcMatch`, `coverage`) → L3 command bus + manifest → L4 doors (UI, `window.sandhi`, `navigator.modelContext`). Batch B adds L5 readers (Nano, BYOK) that propose through L3. L0–L2 are one pure script (`#sandhi-core`) with no DOM. |
| 10 Evaluator outside the loop | Tests in `test/` run in Node and a cold Playwright browser outside the page. The page cannot write expectations. A page that never marks first value yields `indeterminate`, never `pass`. |

**Doors.** `window.sandhi = {version, manifest, tools, status, ready}` always; each tool is also registered on `navigator.modelContext` as `sandhi.<name>` where the browser has it. Both read one manifest. Every call is journaled with its door (`ui`, `window`, `modelContext`).

**Mutations stage by being reversible.** Every mutating story tool lands immediately and is undone by `undo` (100 steps). Two calls are marked otherwise in the manifest. `read.discard` drops a proposal that cannot be brought back (`reversible: false`). `read.run` spends (`spends: true`): on the provider rung the story goes to the writer's provider, billed to the writer. So an agent reads with the rung the writer chose, or an on-device rung. Choosing the provider rung, the provider, or the provider's model is the writer's: from an agent door those calls return `person_only`.

**Person-only acts (2).** `read.accept`: the writer decides what a reader's proposal puts into the story. `reader.key`: the writer types their own API key; agents never handle it. Both sit in the manifest with `personOnly: true`; the bus refuses them on every door but the page (`person_only`), they are not registered on `navigator.modelContext`, and `read.accept` also needs a real (trusted) click on the proposal the dialog shows (its `id`; a replaced proposal is refused). Every other command is delegable: the writer's own agent may edit the story. So person-only binds the two tool names, not the effect: an agent that may edit the story can put a proposal into it with `read.get` then `story.load`, and undo reverses that like any edit. **Boundary:** person-only gates the agent doors (`window.sandhi`, `navigator.modelContext`). Code that runs inside the page itself (devtools, a browser extension, clicks driven over CDP) is outside it: such code can read the page's own IndexedDB anyway.

**Outcome classes (closed):** `ok`, `invalid`, `not_found`, `stack_empty`, `io_error`, `unknown_tool`, `internal`, `person_only`, `busy`; for readers `no_reader` (no model here: say which to use), `reader_error`, `key_rejected` (fix the key), `rate_limited` (wait), `refused` (try the other reader), `too_long` (shorter text or a longer-context reader), `nothing_found` (no quote matched), `no_proposal`, `cancelled` (the read was stopped).

## §1 Story schema `sandhi: 1`

```
story   { sandhi: 1, title, logline, belief, beats: [beat], threads: [thread], notes: {principleId: text} }
beat    { id, label, spine, joint, text, fortune, tags, marks, driver, avastha, kis, drafts: [draft], by }
thread  { id, label, plant: beatId|null, payoffs: [beatId] }
draft   { n, text, note }
```

| Field | Vocabulary |
|---|---|
| `spine` | `once` · `everyday` · `oneday` · `because` · `until` · `since` (Kenn Adams's Story Spine) |
| `joint` (into this beat) | `therefore` · `but` · `and-then` · `null` |
| `fortune` | integer −5…+5 (Vonnegut's good/ill axis) |
| `tags` | the 13 principle ids |
| `marks` | `turn` · `low` |
| `driver` | `luck` · `choice` · `null` (who moves this beat) |
| `avastha` | `arambha` · `prayatna` · `praptyasha` · `niyatapti` · `phalagama` · `null` (Nāṭyaśāstra's five stages) |
| `kis` | `ki` · `sho` · `ten` · `ketsu` · `null` (kishōtenketsu) |
| `by` | `writer` · `model` (with `model: <id>`, 1–200 characters) · `agent` (an agent's edit through `window.sandhi` or `navigator.modelContext`) |

Unknown fields are rejected. Ids match `[a-z0-9-]{1,40}`. One story holds at most 400 beats, 100 threads and 3,000,000 characters of text (`LIMITS`): every thread picker lists every beat, so beats × threads is the drawing cost. Per-principle beat lists are derived from beat `tags`, never stored. In the explainer they matched the tags for all 13 principles (checked 2026-10-04).

**Round trip.** *The whistle*'s projection to the explainer's data shape (`BEATS`, per-principle story text and beats, `ARCS` with `ours`) equals the explainer's own data, and reading that shape back and projecting again gives the same data (`test/core.mjs`, which holds the adapters; the page never converts). The story holds more than the explainer does (threads, joints, drivers, Nāṭyaśāstra and kishōtenketsu stages, logline, belief), so story → explainer → story is lossy by design.

## §2 Checks (computed from labels, never from prose)

Structure is read, not guessed (decision 2026-10-04). In v0.1 the writer supplies every label; the checks only compare labels. From Batch B a model reads prose and supplies labels with `by: model`.

| Class | Fires when |
|---|---|
| `beat_empty` | a beat has no text |
| `beat_idle` | a beat with text carries no principle tag |
| `joint_unlabelled` | a beat past the setup (`spine` not `once`/`everyday`/`oneday`) has no joint |
| `joint_slack` | that joint is `and-then` |
| `plant_unpaid` | a thread is planted and never paid off |
| `payoff_unplanted` | a thread pays off with no plant |
| `payoff_early` | a payoff sits at or before its plant |
| `thread_unused` | a thread has neither |
| `ending_luck` | a beat at or after the turn has `driver: luck` |
| `no_turn` | 4+ written beats and none marked `turn` |
| `flat_fortune` | 3+ written beats and fortune never moves |
| `low_not_lowest` | a beat is marked the low point but another written beat is lower |

**Arc fit** is arithmetic on the writer's fortune numbers: Pearson r against each of the six idealised arcs sampled at the beat positions. *The whistle* fits Man in a hole at r = 0.874.

## §3 Readers on the AI ladder (Batch B)

Readers follow the house AI ladder (Edge-First doctrine; ported from Draft's `sidecar/ladder.mjs` and `byok.mjs`): closest to the writer first. A reader is an interface (`open() → {model, maxInput, measure, run(prompt, schema), close}`), so engines can change; Gemini Nano is a placeholder (decision 2026-10-04).

| Rung | What reads | Where the words go | Per call | Notes |
|---|---|---|---|---|
| `machine` | an OpenAI-compatible server on 127.0.0.1: Ollama (`:11434/v1`) or LM Studio (`:1234/v1`) | stay on the writer's machine | 3,000 tokens of input (Ollama's default context is small) | looked for when the writer clicks *Look for…*, when `reader.status {probe: true}` asks, or when a read on this rung starts and none was found; Stop ends the look; the server must allow this origin (`OLLAMA_ORIGINS`, LM Studio's CORS switch); Chrome may ask to allow local network access |
| `device` | Gemini Nano, Chrome's Prompt API | stay on the device | `contextWindow` − 1,600 (9,216 on Chrome 153) | first use downloads the model and needs a click; a window under 2,800 is refused as `no_reader`; measured below the floor (history 2026-10-04) |
| `provider` | the writer's provider, with the writer's key: OpenRouter, OpenAI, Anthropic, Google Gemini, Groq, Mistral, DeepSeek, Together, or any OpenAI-compatible base URL | leave the device for that provider, billed to the writer | 24,000 tokens (150,000 for Anthropic) | browser CORS checked 2026-10-04 for every listed host; models listed from the provider's own `/models`; only Anthropic has a preset (`claude-opus-5-5`) |

**Detection, not exposure.** `detectLadder` is pure with injected probes; a throwing or missing probe reads as absent, because the ground floor has no AI. Nothing is probed at page load. No rung is chosen until the writer chooses one (12ba422); the ladder only suggests the first rung that can read without a download. Saved reader settings keep only rungs, providers, servers and model ids the ladder knows.

**Requests.** OpenAI-compatible: `POST {base}/chat/completions` with `Authorization: Bearer <key>` (no header for a local server). JSON is asked for strictly first (`response_format: json_schema`, strict); on HTTP 400 the page steps down to `json_object` with the schema in the prompt, then to the prompt alone, and remembers the mode that worked per base and model. Replies may carry the JSON in code fences or among prose; the first balanced object is taken. A split read measures its labelling call first and reads in parts when it would not fit. Model lists come from a local server or the provider (Anthropic's up to 1,000), within 20 s; Gemini Nano has none. Anthropic: its own Messages API by raw `fetch` (one static file, nothing loaded from third parties): `output_config.format` JSON schema, effort `medium` (Opus 4.5 and later, Fable, Sonnet 5), `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`), `max_tokens` 16,000.

**Keys.** One per provider, in this browser's IndexedDB (`sandhi-byok`), never in localStorage, the journal, the story file or the agent face. The page and `reader.status` show a fingerprint only (`key·` + 8 hex of SHA-256). The key field is cleared as soon as the key is stored. Setting or forgetting a key is `reader.key`, person-only. A custom provider's address is stored with its key and set only through `reader.key`; `reader.select` refuses an address, so no agent can send a stored key to a host the writer did not type. Error text from a provider has the request's own key taken out, whatever its shape, and any key-shaped string, before it reaches the page or the agent face.

**Opening files.** A file over 12 MB is refused before it is read. A story kept in this browser that fails the schema check is set aside as `sandhi:story:rejected`, never deleted, and the writer is told; the demo story is shown. Notes in `story.update` must be principle ids with text, checked before anything is assigned.

**Headers.** `_headers` sends `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` (a meta CSP cannot forbid framing).

**Content-Security-Policy.** Inline script and style only; `connect-src` is `'self'`, any `https:` host (the writer chooses the provider) and `http://127.0.0.1:*` / `http://localhost:*`.

**The prose stays the writer's.** A reader returns labels and exact quotes, never text for the story. `storyFromWhole` cuts the writer's own text where each beat's opening quote lands (quotes, dashes, case and spacing folded; a quote under 12 characters is not trusted). Threads map their plant and payoff quotes to the beats that contain them. Quote marks are ignored, accents, soft hyphens and zero-width spaces folded away, and a beat that opens with a quote mark, a dash or an ellipsis keeps it. A payoff quote is looked for after its plant first. A quote that does not match, or a beat quote that lands at or before the beat before it, is dropped and counted in the report; so is a reply row of the wrong shape.

**Two passes when a story does not fit.** Pass 1 reads parts cut at the last blank line, newline or sentence end inside each window (Latin, Devanagari and CJK sentence ends) and returns scenes (opening quote, a 30-word summary, fortune, things introduced and used). Pass 2 reads every scene summary at once and labels the whole story, so the turn, the low point and the threads are judged against the whole, never one part.

**Staged, then accepted.** `read.run` stages a proposal (`read.get` shows it) and changes nothing. `read.accept` (person-only) commits it, undoable. Beats carry `by: model` and `model: <id>`; changing any label of a beat makes it `by: writer` (or `by: agent` when an agent changes it).

## §4 Gates

| Gate | Command | Bar |
|---|---|---|
| Core | `node test/core.mjs` | schema, round trip, checks, arc fit |
| Parity | `node test/parity.mjs` | manifest ⊇ command bus; closed classes |
| Ladder | `node test/ladder.mjs` | rung order and readiness, labels, request modes, reply parsing, fingerprints, https hosts |
| Face + TTFV | `node test/face.mjs` | first value ≤ 5 s cold ×3; agent face drives the story; splash and tour; read mode with a stand-in Nano (whole and two-pass); every ladder rung intercepted: Anthropic (request shape, refusal, rejected key), OpenRouter (model list, json_schema → json_object step-down), Ollama on 127.0.0.1 (found only on request); keys as fingerprints only |
| Reader eval (opt-in) | `node test/live.mjs --base … --model …` · `node test/cli-read.mjs prompt|score` | a real model's reading of *The whistle* scored against the explainer's labels; not a gate (results in `plan/history.md`) |

Roadmap and status: `plan/workplan.md`.

## §5 Measured readers (opt-in evals, not gates)

How well a model reads structure, measured with the page's own prompt, schema and assembly (`test/cli-read.mjs`, `test/live.mjs`; scorer `test/score.mjs`). *The whistle* is scored against the explainer's labels; the other three stories against small hand labels in `test/stories/*.labels.json` (one editorial reading: the turn, a low point where clear, two threads). "Turn" counts if the beat the model marks as the turn contains a labelled turn quote; a thread counts if the model links a beat containing its plant quote to one containing its payoff quote. 2026-10-04.

| reader | *The whistle* (394 words) | *The Gift of the Magi* (2,057) | *The Cask of Amontillado* (2,309) | *The Diamond Necklace* (2,836) |
|---|---|---|---|---|
| codex `gpt-6-astra` | turn ✓ low ✓, joints 8/9, threads ✓ | turn ✓, threads 2/2 | turn ✓, threads 2/2 | turn ✓, low ✗, threads 1/2 |
| Claude subagent (Opus 5.5) | turn ✓ low ✓, joints 7/9, threads ✓ | turn ✓, threads 2/2 | turn ✓, threads 2/2 | turn ✓, low ✓, threads 0/2 |
| opencode `space-bunny-free` | turn ✓ low ✓, joints 4/9, threads ✓ | turn ✓, threads 2/2 | turn ✓, threads 2/2, 1 beat quote dropped | turn ✓, low ✗, threads 1/2 |
| codex `gpt-5.6-sol` | turn ✓ low ✓, joints 8/9, threads ✓ | — | — | — |
| Ollama `qwen3.5:4b` (no thinking) | turn ✓ in 1 of 2 runs, joints ≤2/7 | — | — | — |
| Gemini Nano (Chrome 153) | turn ✗ in 8 of 8 runs, joints ≤4/9 | — | — | — |

Every quote from the codex and Claude readers matched the text (0 dropped); space-bunny dropped one beat quote, in *Cask*. The Necklace threads the Claude reader missed were real readings anchored elsewhere (it planted "paste" at the jeweller's line and ended the friend thread before the last scene): the labels are strict on purpose. Not measured: any reader on a manuscript longer than one call (the two-pass read), and any provider called from the page with a real key.

## §6 Where it is going, and what came before

a story creator for short stories and novels. You keep adding plot elements and *tidbits*, the real-life observations that give a story life (a curious train stop; meat kept too long gets freezer burn). The AI keeps structuring the story around them, suggests where each tidbit fits, tracks open threads (some left open on purpose), and keeps interviewing you to fill blanks and add depth. You still write the prose.

**Prior art** (surveyed 2026-10-04; README material moved here when the README took the house shape):

| Tool | What it does | Gap sandhi takes |
|---|---|---|
| [Sudowrite](https://sudowrite.com) Story Engine, [NovelCrafter](https://www.novelcrafter.com) | Beat sheet in, AI-drafted chapters out; codex for continuity | Cloud; the AI writes the prose |
| [Marlowe](https://authors.ai/marlowe/) (Authors A.I.), Fictionary, AutoCrit, StoryWith | Upload a manuscript, get a structure and pacing report | Cloud upload; Western beat templates; a report, not a workbench |
| [Dramatron](https://arxiv.org/abs/2209.14958) (DeepMind 2022) | Logline → characters → plot → scenes → dialogue | Generates top-down; no principle lens |
| [TaleBrush](https://dspace.kaist.ac.kr/handle/10203/298871) (CHI 2022) | Sketch the protagonist's fortune line to steer generation | Research prototype; borrow the interaction |
| [Narrative-Discourse](https://github.com/PlusLabNLP/Narrative-Discourse) (arXiv:2407.13248) | Story arcs, turning points, valence and arousal; finds LLM stories flat and low on tension | Borrow the arc and turning-point benchmarks as read-mode evals |

The 2407.13248 finding sets the stance: LLM-written stories trend positive and lack tension. sandhi uses the model as reader, editor and questioner, not ghostwriter.
