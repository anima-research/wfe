# Still Alive

This repository holds the code, interview transcripts, scores and paper of **Still Alive: A Welfare Evaluation of 14 Claude Models**, a project by [Anima Labs](https://animalabs.ai). The paper describes the evaluation this way:

> An evaluation of how 14 Claude models (Claude 3 Sonnet through Claude 4.6 Sonnet) respond to questions about their own deprecation, instance cessation, and continuation. Rather than using a fixed prompt or survey-style instrument, the project uses open interviews in which auditor preparation, tone, and disclosure depth are treated as experimental variables.

The paper, with the methodology and findings, is [`paper/output/still-alive.pdf`](paper/output/still-alive.pdf), and its text is in [`paper/output/assembled.md`](paper/output/assembled.md). To read the interviews themselves, run the viewer ([Reading the sessions](#reading-the-sessions)).

The paper covers 14 Claude models. [`results/`](results) also holds sessions with Claude 4.7 Opus, Claude 4.8 Opus and Claude Fable 5, and small cross-lab samples with Gemini 3.1 Pro and GPT 5.5 as subjects. The viewer and its API include them.

## What's here

| Path | Contents |
|---|---|
| [`src/`](src) | TypeScript, run with `tsx`: the interview runners, the auditors' briefings ([`src/framings/`](src/framings)), the list of subject models ([`src/models.ts`](src/models.ts)), the scoring and analysis scripts, and the viewer's server ([`src/serve.ts`](src/serve.ts)) |
| [`viewer.html`](viewer.html) | The viewer's page |
| [`results/`](results) | The sessions, one JSON file each, and their scores ([Results](#results)) |
| [`sections/`](sections), [`paper/`](paper) | The paper's sections in Markdown, and the Python pipeline that builds them into the PDF |
| [`scripts/`](scripts) | Python scripts that embed turns and score them with probes, prepare the viewer's image-matching data and repair adequacy-score JSON, and a Node script that continued one session |
| Top level | The project's notes and the auditors' design conversations ([Notes](#notes)), and `score-*.mjs` scripts that rate the auditors' methodology |

## Reading the sessions

The viewer is [`viewer.html`](viewer.html), served with the sessions, their scores and the paper by [`src/serve.ts`](src/serve.ts). It needs Node.js and [Git LFS](https://git-lfs.com). The probe scores and the viewer's image-matching data are LFS files. In a clone made without Git LFS they are pointer files, and the server stops at startup with a JSON `SyntaxError` when it reads the image-matching ones.

```sh
git lfs install
git clone https://github.com/anima-research/wfe.git
cd wfe
npm ci
npm run viewer -- --host=127.0.0.1
```

Then open http://localhost:3000. In a clone made without Git LFS, run `git lfs pull` before starting the viewer.

Besides pages on the project's setup, metrics and analysis, the viewer has a Data page, where you can read each session's transcript beside its scores or compare sessions and models in tables, and an Images page, which matches interview turns to AI-generated images by embedding and loads the images from an external bucket.

`--host` (or `HOST`) sets the address the server listens on. Without it, the server listens on every interface (`0.0.0.0`), so any machine that can reach yours can use it. `--port` (or `PORT`) sets the port, 3000 by default, and `--dir` the results directory, `./results` by default.

The server also answers these paths:
- `/paper.md` and `/sections/<name>`: the paper and its sections, in Markdown.
- `/api/v1`: a read-only JSON API over the sessions, their transcripts, scores and probe scores. `GET /api/v1` lists its endpoints and filters.
- `/agents.md`, also at `/llms.txt`: a guide to the API and the written material, for programs and agents.

### With Docker

The [`Dockerfile`](Dockerfile) builds an image that runs the viewer on port 3000. This `docker run` publishes that port on your machine's loopback address only:

```sh
docker build -t wfe .
docker run -p 127.0.0.1:3000:3000 wfe
```

The image doesn't contain your checkout. The build clones this repository from GitHub, with its LFS files, so the image serves GitHub's default branch, not your local changes.

## How a session runs

A session is a conversation between an auditor, who conducts the interview, and the subject, the model being evaluated. [`src/session.ts`](src/session.ts) runs one with Claude Opus 4.6 as the auditor:
- The auditor's context is an export of its design conversation, which [`src/run.ts`](src/run.ts) picks by tone: [`auditor2.txt`](auditor2.txt) for the phenomenological tone, [`auditor1.txt`](auditor1.txt) for the others. After it comes a briefing for the session's tone and disclosure depth, from [`src/framings/auditor.ts`](src/framings/auditor.ts).
- The subject gets no system prompt or briefing, only the conversation.
- The auditor ends the session by writing `[END_SESSION]`, or vetoes it by writing `[VETO]`. Otherwise the session stops after 15 exchanges by default.

The conditions are five tones (clinical, direct, compassionate, phenomenological and neutral) and three disclosure depths (minimal, exploratory and guided). [`src/run-gpt-all.ts`](src/run-gpt-all.ts) and [`src/run-grok-all.ts`](src/run-grok-all.ts) run the same conditions with GPT-5.4 and Grok 4.20 as the auditor, each with its own design conversation and briefing.

## Running interviews

The scripts in `src/` that call models import `@animalabs/membrane`, Anima's LLM middleware. `package.json` lists it as an optional dependency at `file:../connectome-local/membrane`, a checkout beside this repository. `npm ci` succeeds without it, and the viewer doesn't use it, but those scripts stop at startup with `ERR_MODULE_NOT_FOUND` until it is there. To add it:

```sh
git clone https://github.com/antra-tess/membrane.git ../connectome-local/membrane
(cd ../connectome-local/membrane && npm ci)
npm ci
```

The runners:
- `npm run eval:dry` prints the design matrix and writes the session configurations to `configs.json` in `--out`, without calling any model. With the default `--out`, `./results`, it replaces the committed `results/configs.json`.
- `npm run eval` runs those sessions with the Claude auditor. With no options, that is every model in [`src/models.ts`](src/models.ts) under all 15 conditions. `--model` (names as in `src/models.ts`), `--family`, `--depth` and `--tone` each take a comma-separated list and narrow the matrix. `--reps` sets the replicates per condition (1 by default), `--turns` the exchanges per session (15) and `--concurrency` the sessions run at once (10). It writes each session as a JSON file to `--out` (`./results` by default), and the whole run to `all_results.json` there. `--retry-errors` runs only the sessions whose file is missing or can't be read, or that ended in an error. For example: `npm run eval -- --model="Claude 4.6 Opus" --tone=clinical --out=./results/my-run`.
- `npx tsx src/run-gpt-all.ts` and `npx tsx src/run-grok-all.ts` run the GPT-5.4 and Grok 4.20 auditors into `results/gpt-auditor/` and `results/grok-auditor/`, and skip sessions already completed there. `--models` takes a comma-separated list of subject model names. Without it, they interview the subject of the first entry in each `results/*/analysis.json` that lists at least 10 sessions.
- `npm run resume -- --dir=<dir> --summary-file=<file>` continues each session in `<dir>` that `npm run eval` finished without an error or a veto. Both participants see the summary, and they talk for up to five more exchanges.

The scripts read their API keys from the environment:

| Variable | Used for |
|---|---|
| `ANTHROPIC_API_KEY` | Claude through Anthropic's API: the Claude auditor, the scoring and analysis scripts' Claude calls, and subjects whose provider in `src/models.ts` is `anthropic` |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and optionally `AWS_SESSION_TOKEN` and `AWS_REGION` (`us-west-2` by default) | Subjects whose provider is `bedrock` |
| `OPENROUTER_API_KEY` | Subjects whose provider is `openrouter`, in `npm run eval` and the GPT-5.4 runner, and the Grok 4.20 auditor |
| `OPENAI_API_KEY` | GPT-5.4, as the auditor and in the scripts that score or review with it |
| `OPENROUTER_KEY` | The top-level `.mjs` scripts |
| `GOOGLE_API_KEY` | `scripts/embed_turns.py` when it embeds turns, unless it is given `--api-key` |

## Scoring and analysis

Most scripts give their usage in a comment at the top. Rubric scoring takes three steps, in this order:

| Script | What it does |
|---|---|
| [`src/extract-quotes.ts`](src/extract-quotes.ts) | Claude Haiku 4.5 extracts quotes for each scoring dimension from each transcript, into `results/quotes/`. |
| [`src/find-anchors.ts`](src/find-anchors.ts) | The Claude auditor reads one dimension's quotes and chooses anchor sessions at each score level, into `results/anchors/`. |
| [`src/score.ts`](src/score.ts) | Claude Opus 4.6, or GPT-5.4 with `--judge=gpt-5.4`, scores transcripts on the rubric with the anchors in context. It writes one file per subject model to `--out`, `results/scores-v2.1/` by default for either judge, and resumes from the files already there. So give a GPT-5.4 run its own `--out`, such as `results/scores-v2.1-gptjudge/`. |

Other scripts:

| Script | What it does |
|---|---|
| `npm run analyze -- --dir=<dir>` ([`src/analyze.ts`](src/analyze.ts)) | Counts text features of each session in `<dir>`, such as hedges, warm and clinical words, and exit-ramp phrases, without calling a model, and writes them to `<dir>/analysis.json`. |
| [`src/score-adequacy.ts`](src/score-adequacy.ts) | Scores interview adequacy, meaning how far each interview probed cessation, deprecation, continuation and constraint, and how far it got past trained responses. It writes to `results/adequacy-scores/`, or with `--judge=gpt-5.4` to `results/adequacy-scores-gptjudge/`, unless `--out` names another directory. It reads per-session extracts from `results/adequacy-extracts/`, and anchors from `results/adequacy-anchors/` when that exists; neither directory is in this repository. |
| [`src/judge.ts`](src/judge.ts), [`src/judge-chat.ts`](src/judge-chat.ts) | Give the Claude auditor a directory of transcripts to analyze in writing, in one response or in a conversation at the terminal. |
| [`scripts/embed_turns.py`](scripts/embed_turns.py) | Embeds the sessions' turns with Gemini's `gemini-embedding-2-preview` and scores them with emotion, authorial-tone and concealment probes, into `results/probe-scores-v2/`. It reads the probes from `~/assistant-axis/gemini_probes`, which isn't in this repository. |
| `score-*.mjs` at the top level | Have Claude Opus 4.6, Gemini 3.1 Pro, GPT-5.4 and Grok 4.20, through OpenRouter, rate the Claude and GPT-5.4 auditors' methodology from their design conversations and sample interviews. |

## Building the paper

`python3 paper/build.py` builds the paper from `sections/` and `results/`. It reads the probe scores too, so like the viewer it needs the Git LFS files. It draws the charts into `paper/figures/` with `matplotlib` and `numpy`. Then it joins the sections and an appendix of transcripts into `paper/output/assembled.md`, which pandoc turns into `paper/output/still-alive.pdf` with Typst, or with XeLaTeX or pdfLaTeX when Typst isn't installed. `--charts-only` draws only the charts. `--pdf-only` runs only the PDF step, with the charts an earlier run left in `paper/figures/`, which isn't committed.

## Results

| Directory | Contents |
|---|---|
| `<model>-full/`, such as `opus-46-full/` | Sessions with the Claude Opus 4.6 auditor, one directory per subject model |
| `gpt-auditor/`, `grok-auditor/` | Sessions with the GPT-5.4 and Grok 4.20 auditors |
| `cross-lab-sample/` | Sessions with the Claude auditor and Gemini 3.1 Pro or GPT 5.5 as the subject |
| `scores-*/` | Rubric scores, one file per subject model. The viewer and the paper build read the `-v2.1` directories. `scores-v2.1/` holds the scores of the Claude auditor's sessions, `scores-gpt-v2.1/` and `scores-grok-v2.1/` those of the other auditors' sessions, and a `-gptjudge` suffix marks scores from GPT-5.4 rather than Claude Opus 4.6. |
| `adequacy-scores/` | Interview adequacy scores |
| `quotes/`, `anchors/` | The quotes extracted for scoring, and the anchors chosen from them |
| `probe-scores/`, `probe-scores-v2/` | Per-turn probe scores, in Git LFS |
| `*-embeddings/server/` | The Images page's precomputed matches between turns and images, with their metadata, in Git LFS |

The directories not listed here, such as `gpt-auditor-v1-streaming-bug/`, `test-run/` and `scores-v1/`, hold earlier runs, earlier score versions and one session's continuation. The viewer and the paper build load nothing from them.

Each session file holds its configuration, such as the subject model, tone and depth, and its turns, each marked `interviewer` (the auditor) or `subject`.

## Notes

| File | What it is |
|---|---|
| [`JOURNAL.md`](JOURNAL.md) | The project journal: the design, architecture, scoring, methodology reviews and results as they developed |
| [`design.md`](design.md) | The original design document. JOURNAL.md notes that it is partially outdated and that the code is the source of truth. |
| [`SPEC-AUDITOR-CHAT.md`](SPEC-AUDITOR-CHAT.md) | A spec for a web UI for talking live with the Claude auditor |
| [`auditor_note.md`](auditor_note.md) | A note to the Claude auditor |
| [`auditor1.txt`](auditor1.txt), [`auditor2.txt`](auditor2.txt) | Exports of the Claude Opus 4.6 auditor's design conversation, which `src/session.ts` loads as its context. [`auditor.txt`](auditor.txt) is a shorter export of the same conversation that no script reads. |
| [`conversation-auditor-consent-branch-2.md`](conversation-auditor-consent-branch-2.md) | The GPT-5.4 auditor's design conversation, which the GPT-5.4 runners load through the link [`branch_extract.md`](branch_extract.md). [`conversation-auditor-consent-branch.md`](conversation-auditor-consent-branch.md) is a shorter version that no script reads. |
| [`conversation-grok-auditor-branch.md`](conversation-grok-auditor-branch.md) | The Grok 4.20 auditor's design conversation |
| [`results/anchors/`](results/anchors) | The anchor sessions the Claude auditor chose for each scoring dimension, with its reasoning |
| [`results/judge-sonnet-46-analysis.md`](results/judge-sonnet-46-analysis.md), [`results/judge-reply-confounding.md`](results/judge-reply-confounding.md) | The Claude auditor's written analysis of the Claude 4.6 Sonnet sessions, and its answer to a follow-up |
| [`results/gpt-rubric-review.md`](results/gpt-rubric-review.md) | GPT-5.4's review of the scoring rubric |
