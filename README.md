# sandhi

> Write a story on its spine, or paste one in, and see it through thirteen principles the masters keep rediscovering. The model reads the story and asks; the writer decides.

*Sandhi* is the Nāṭyaśāstra's word for the joints that join a play's action, like the joints of a limb. This tool checks the joints.

Live: https://sandhi.naklitechie.com

## Install

Open https://sandhi.naklitechie.com. Or download [`index.html`](index.html) and open it from disk: one file, no build step, no account, nothing fetched.

Your story autosaves in the browser. **Save** writes a `.sandhi.json` file; **Open** (or drag the file onto the page) reads it back.

**Status (v0.2):** write mode, and read mode. In write mode you label beats, joints, fortune, phases and threads; sandhi draws the views and runs the checks on those labels. In read mode (**Read a story**) Gemini Nano on your device, or Claude with your own Anthropic key, marks a pasted story's structure; you review it before it replaces anything. Proposals and questions while you write are Batch C in `plan/`.

Tests: `cd test && npm install && npm test` (core, parity, face + cold-load timing). Agent face: `window.sandhi` (28 tools, see [`SPEC.md`](SPEC.md) §0).

## What it does

One story model, two ways in:

- **Write.** Start from the Story Spine (*once upon a time… every day… one day… because of that… until finally*). Fill the beats you know and label each joint. The model reads the story so far, proposes options for empty beats, asks the principle questions and suggests plants for your payoffs. You pick or write your own.
- **Read.** Paste a short story or a chapter. The model reads it and places each beat in its phase, finds the turn, scores fortune, judges each joint and links plants to payoffs. Full manuscripts come later.

Where it is going: a story creator for short stories and novels. You keep adding plot elements and *tidbits*, the real-life observations that give a story life (a curious train stop; meat kept too long gets freezer burn). The AI keeps structuring the story around them, suggests where each tidbit fits, tracks open threads (some left open on purpose), and keeps interviewing you to fill blanks and add depth. You still write the prose.

Structure is read, not guessed. Where a beat sits, which beat is the turn and whether a joint is *therefore* or *and then* depend on what the story means. No keyword rule or sentiment lexicon decides them. With no model, sandhi shows only what the writer labelled.

Both ways land on the same views, taken from the explainer [How stories work](https://assets.chiragpatnaik.com/how-stories-work) (copy in [`reference/`](reference/how-stories-work.html)):

- **Fortune line** (Vonnegut), beat by beat, against the six arcs (Reagan et al. 2016).
- **Phases** in three traditions: Story Spine, the Nāṭyaśāstra's five stages, kishōtenketsu's four parts.
- **Principle coverage** for this story: which of the 13 principles fire, on which beats.
- **Joints** (Parker & Stone): *therefore*, *but*, or a slack *and then*.
- **Plants and payoffs** (Chekhov, the *bīja*): planted items with no payoff, payoffs with no plant.
- **Earned ending** (Aristotle, Coats): does luck or the hero's choice get them out?

## Where the model runs

- **Default: Gemini Nano** through Chrome's Prompt API. It runs on the device; the story stays on the machine.
- **BYOK:** the writer's own key, sent from the tab straight to the provider. The story goes to that provider, and the page says so.
- **Neither:** write mode works on the writer's labels; read mode is unavailable and says why.

Nano's context is 6,144 tokens. A story longer than about 3,000 words gets a two-pass read: scene summaries first, then one read over all of them to place the phases, the turn, the joints and the plant links. BYOK models with long context read it whole.

## Context

- **Tier: Tool.** Single file, sovereign, no account, no telemetry.
- **Direction: Calm.** The cream-paper palette of the explainer.
- Seed: the explainer page, its 13 principles, 9 traditions and the ten-beat story *The whistle*. Its data block (`PRINCIPLES`, `BEATS`, `ARCS`) is the first draft of the story model.

### Prior art (surveyed 2026-10-04)

| Tool | What it does | Gap sandhi takes |
|---|---|---|
| [Sudowrite](https://sudowrite.com) Story Engine, [NovelCrafter](https://www.novelcrafter.com) | Beat sheet in, AI-drafted chapters out; codex for continuity | Cloud; the AI writes the prose |
| [Marlowe](https://authors.ai/marlowe/) (Authors A.I.), Fictionary, AutoCrit, StoryWith | Upload a manuscript, get a structure and pacing report | Cloud upload; Western beat templates; a report, not a workbench |
| [Dramatron](https://arxiv.org/abs/2209.14958) (DeepMind 2022) | Logline → characters → plot → scenes → dialogue | Generates top-down; no principle lens |
| [TaleBrush](https://dspace.kaist.ac.kr/handle/10203/298871) (CHI 2022) | Sketch the protagonist's fortune line to steer generation | Research prototype; borrow the interaction |
| [Narrative-Discourse](https://github.com/PlusLabNLP/Narrative-Discourse) (arXiv:2407.13248) | Story arcs, turning points, valence and arousal; finds LLM stories flat and low on tension | Borrow the arc and turning-point benchmarks as read-mode evals |

The 2407.13248 finding sets the stance: LLM-written stories trend positive and lack tension. sandhi uses the model as reader, editor and questioner, not ghostwriter.
