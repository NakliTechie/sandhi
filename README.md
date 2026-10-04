# sandhi

> Write a story on its spine, or drop in a manuscript, and see it through thirteen principles the masters keep rediscovering. The AI asks and proposes; the writer decides.

*Sandhi* is the Nāṭyaśāstra's word for the joints that join a play's action, like the joints of a limb. This tool checks the joints.

## Install

_TODO: one single-file `index.html`, opened from disk or a static host. No build step, no account._

## What it does

One story model, two ways in:

- **Write.** Start from the Story Spine (*once upon a time… every day… one day… because of that… until finally*). Fill the beats you know. Draw the fortune line you want. The AI proposes options for empty beats, asks the principle questions, and suggests plants for your payoffs. You pick or write your own.
- **Read.** Paste a short story or a chapter. The AI splits it into beats, scores fortune, tags principles, and builds the plant-and-payoff ledger. Full manuscripts come later.

Both ways land on the same views, taken from the explainer [How stories work](https://assets.chiragpatnaik.com/how-stories-work) (copy in [`reference/`](reference/how-stories-work.html)):

- **Fortune line** (Vonnegut), beat by beat, against the six arcs (Reagan et al. 2016).
- **Principle coverage** for this story: which of the 13 principles fire, on which beats.
- **Joint lint** (Parker & Stone): every pair of beats joined by *therefore* or *but*; *and then* is flagged.
- **Plant-and-payoff ledger** (Chekhov, the *bīja*): planted items with no payoff, payoffs with no plant.
- **Earned ending** (Aristotle, Coats): does luck or the hero's choice get them out?

## Context

- **Tier: Tool.** Single file, sovereign, maintained. The manuscript never leaves the writer's machine.
- **Removable AI.** The spine editor, fortune chart, coverage matrix and joint lint work with no model. The AI adds proposals, questions and the read-mode extraction.
- **Where AI runs.** In the browser where possible, BYOK otherwise. Never our server.
- **Direction: Calm.** The cream-paper palette of the explainer.
- Seed: the explainer page, its 13 principles, 9 traditions and the ten-beat story *The whistle*. Its data block (`PRINCIPLES`, `BEATS`, `ARCS`) is the first draft of the story model.

### Prior art (surveyed 2026-10-04)

| Tool | What it does | Gap sandhi takes |
|---|---|---|
| [Sudowrite](https://sudowrite.com) Story Engine, [NovelCrafter](https://www.novelcrafter.com) | Beat sheet in, AI-drafted chapters out; codex for continuity | Cloud; the AI writes the prose |
| [Marlowe](https://authors.ai/marlowe/) (Authors A.I.), Fictionary, AutoCrit, StoryWith | Upload a manuscript, get a structure and pacing report | Cloud upload; Western beat templates; a report, not a workbench |
| [Dramatron](https://arxiv.org/abs/2209.14958) (DeepMind 2022) | Logline → characters → plot → scenes → dialogue | Generates top-down; no principle lens |
| [TaleBrush](https://dspace.kaist.ac.kr/handle/10203/298871) (CHI 2022) | Sketch the protagonist's fortune line to steer generation | Research prototype; borrow the interaction |
| [Narrative-Discourse](https://github.com/PlusLabNLP/Narrative-Discourse) (arXiv:2407.13248) | Story arcs, turning points, valence and arousal; finds LLM stories flat and low on tension | Borrow the arc and turning-point methods |

The 2407.13248 finding sets the stance: LLM-written stories trend positive and lack tension. sandhi uses the model as editor and questioner, not ghostwriter.
