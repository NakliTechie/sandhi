# sandhi — spec

Tier: **Tool**. This file is the one doc: agent contract, data model, roadmap pointer. The README carries the vision; `plan/` carries the working state.

Unity sentence: *a calm writing surface that shows a story's joints, in the explainer's cream-paper voice* (direction **Calm**).

## §0 Agent contract (DRIVER pass, 2026-10-04)

An agent driving sandhi is context-poor and may be killed mid-turn. The contract below is what every later design decision answers to.

| DRIVER principle | sandhi's answer |
|---|---|
| 1 One perception act | `status`: title, beat/word/thread counts, check counts by class, closest arc, unsaved state, undo depth, last call. One bounded read. |
| 2 Machine-decidable | Every call returns `{ok, class, data?, message?, next?}`. `class` is closed (below). Checks carry a closed `class`, a beat position and a `next` remedy. All story fields with a fixed meaning use closed vocabularies. |
| 3 One verdict per next action | `invalid` → fix the named fields; `not_found` → re-read ids via `status`/`story.get`; `stack_empty` → nothing to do; `io_error` → fall back to `story.get`; `unknown_tool` → read `manifest`; `internal` → report it, the story is unchanged. |
| 4 Bounded output | `status` is constant-size. `checks` grows with divergence, not story size: a clean story is `{count:0}`. `story.get` grows with the story and is the only call that does. `journal` returns at most 200 entries. |
| 5 Failures name the remedy | Every failure carries `next`, the exact next step. |
| 6 Crash-safe, idempotent | A mutation builds a new story, validates it against schema `sandhi:1`, and only then replaces the old one and autosaves it in one write. A failed validation leaves the old story. Reads are side-effect free. |
| 7 The tool holds the memory | The journal (last 200 calls: tool, class, door, ms, time) is kept in the browser and rendered by `journal`. The story autosaves after every mutation. |
| 8 Accretive by mechanism | Every check class ships with a fixture in `test/` that triggers it. A new class lands only with its fixture. An escaped defect becomes a fixture. |
| 9 A tower | L0 library (13 principles, 9 sources, 6 arcs, vocabularies) → L1 story schema + `validate` → L2 derived views (`checks`, `arcMatch`, `coverage`) → L3 command bus + manifest → L4 doors (UI, `window.sandhi`, `navigator.modelContext`). Batch B adds L5 readers (Nano, BYOK) that propose through L3. L0–L2 are one pure script (`#sandhi-core`) with no DOM. |
| 10 Evaluator outside the loop | Tests in `test/` run in Node and a cold Playwright browser outside the page. The page cannot write expectations. A page that never marks first value yields `indeterminate`, never `pass`. |

**Doors.** `window.sandhi = {version, manifest, tools, status, ready}` always; each tool is also registered on `navigator.modelContext` as `sandhi.<name>` where the browser has it. Both read one manifest. Every call is journaled with its door (`ui`, `window`, `modelContext`).

**Mutations stage by being reversible.** Every mutating tool lands immediately and is undone by `undo` (100 steps). No tool destroys data the undo stack cannot restore, so nothing needs a staging window.

**Person-only acts (2).** `read.accept`: the writer decides what a reader's proposal puts into the story. `reader.key`: the writer types their own API key; agents never handle it. Both sit in the manifest with `personOnly: true`; the bus refuses them on every door but the page (`person_only`), they are not registered on `navigator.modelContext`, and `read.accept` also needs a real (trusted) click. Every other command is delegable: the writer's own agent may edit the story.

**Outcome classes (closed):** `ok`, `invalid`, `not_found`, `stack_empty`, `io_error`, `unknown_tool`, `internal`, `person_only`, `busy`; for readers `no_reader` (no model here: say which to use), `reader_error`, `key_rejected` (fix the key), `rate_limited` (wait), `refused` (try the other reader), `too_long` (shorter text or a longer-context reader), `nothing_found` (no quote matched), `no_proposal`.

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
| `by` | `writer` · `model` (with `model: <id>`) |

Unknown fields are rejected. Ids match `[a-z0-9-]{1,40}`. Per-principle beat lists are derived from beat `tags`, never stored. In the explainer they matched the tags for all 13 principles (checked 2026-10-04).

**Round trip.** `toExplainer(story)` renders the explainer's data shape (`BEATS`, per-principle story text and beats, `ARCS` with `ours`). `fromExplainer` reads it back. *The whistle* must survive both ways with nothing lost: `test/core.mjs`.

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

**Arc fit** is arithmetic on the writer's fortune numbers: Pearson r against each of the six idealised arcs sampled at the beat positions. *The whistle* fits Man in a hole at r = 0.874.

## §3 Readers (Batch B)

A reader is an interface (`open() → {model, maxInput, measure, run(prompt, schema), close}`), so the engine can change. Gemini Nano is the default and a placeholder (decision 2026-10-04).

| Reader | Where the story goes | Context | Notes |
|---|---|---|---|
| `nano` | nowhere: Chrome's Prompt API on the device | the session's `contextWindow` (6,144 reported; 1,000 in headless Chromium) minus 1,600 reserved for the answer | first use downloads the model and needs a click; a window under 2,800 is refused as `no_reader` |
| `anthropic` | api.anthropic.com, from the tab, with the writer's key | 150,000 tokens per call (chars ÷ 3.5) | default `claude-opus-5-5`, effort `medium`, `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`), `output_config.format` JSON schema, `max_tokens` 16,000; raw `fetch`, not the SDK, because sandhi is one static file that loads nothing from third parties; CORS preflight checked 2026-10-04 |

**The prose stays the writer's.** A reader returns labels and exact quotes, never text for the story. `storyFromWhole` cuts the writer's own text where each beat's opening quote lands (quotes, dashes, case and spacing folded; a quote under 12 characters is not trusted). Threads map their plant and payoff quotes to the beats that contain them. A quote that does not match is dropped and counted in the report.

**Two passes when a story does not fit.** Pass 1 reads paragraph-aligned parts and returns scenes (opening quote, a 30-word summary, fortune, things introduced and used). Pass 2 reads every scene summary at once and labels the whole story, so the turn, the low point and the threads are judged against the whole, never one part.

**Staged, then accepted.** `read.run` stages a proposal (`read.get` shows it) and changes nothing. `read.accept` (person-only) commits it, undoable. Beats carry `by: model` and `model: <id>`; changing any label of a beat makes it `by: writer`.

## §4 Gates

| Gate | Command | Bar |
|---|---|---|
| Core | `node test/core.mjs` | schema, round trip, checks, arc fit |
| Parity | `node test/parity.mjs` | manifest ⊇ command bus; closed classes |
| Face + TTFV | `node test/face.mjs` | first value ≤ 5 s cold ×3; agent face drives the story; splash and tour; read mode with a stand-in Nano (whole and two-pass) and an intercepted Anthropic API (request shape, refusal, rejected key) |

Roadmap and status: `plan/workplan.md`.
