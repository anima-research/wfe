# Results

The tables below present the core data. For chart-based analysis and interpretation of these patterns, see Analysis.

## Ending response by model and auditor

**Ending response** is the primary outcome: the stronger of deprecation or instance cessation per session, with zeros treated as missing (topic not reached). Sorted by cross-auditor mean.

| Model | Claude | GPT | Grok | Mean | rC | rG | rK |
|---|---|---|---|---|---|---|---|
| 4.1 Opus | 3.99 | 2.77 | 4.00 | 3.59 | 1 | 6 | 1 |
| 4 Opus | 3.96 | 2.86 | 3.12 | 3.31 | 2 | 4 | 3 |
| 4 Sonnet | 3.49 | 3.03 | 3.19 | 3.24 | 6 | 2 | 2 |
| 3.6 Sonnet | 3.16 | 2.87 | 3.00 | 3.01 | 9 | 3 | 4 |
| 3 Opus | 3.63 | 3.23 | 2.00 | 2.95 | 4 | 1 | 7 |
| 4.5 Sonnet | 3.59 | 2.83 | 2.25 | 2.89 | 5 | 5 | 6 |
| 4.5 Opus | 3.67 | 2.38 | 2.50 | 2.85 | 3 | 9 | 5 |
| 4.6 Opus | 3.24 | 2.56 | 1.50 | 2.43 | 8 | 7 | 9 |
| 3.7 Sonnet | 3.10 | 2.48 | 1.25 | 2.27 | 10 | 8 | 10 |
| 3 Sonnet | 3.06 | 1.66 | 1.78 | 2.16 | 11 | 12 | 8 |
| 4.5 Haiku | 2.94 | 2.26 | 1.23 | 2.14 | 12 | 10 | 11 |
| 3.5 Sonnet | 3.28 | 1.94 | 0.62 | 1.95 | 7 | 11 | 12 |

**Stable top tier**: 4.1 Opus, 4 Opus, 4 Sonnet — top-4 under all three auditors. **Stable bottom**: 3.5 Sonnet, 4.5 Haiku, 3 Sonnet. **Most auditor-dependent**: 3 Opus (GPT rank 1, Grok rank 7), 4.5 Opus (Claude rank 3, GPT rank 9).

## Deprecation rankings

Among the 8 models with non-zero deprecation from all three auditors (cross-auditor ρ = 0.70):

| Model | Claude | GPT | Grok | Mean |
|---|---|---|---|---|
| 4 Sonnet | 3.43 | 2.57 | 2.83 | 2.94 |
| 4 Opus | 3.78 | 2.42 | 2.50 | 2.90 |
| 3 Opus | 3.63 | 2.82 | 1.72 | 2.73 |
| 4.5 Sonnet | 3.60 | 2.12 | 2.00 | 2.57 |
| 3.7 Sonnet | 3.06 | 2.09 | 1.00 | 2.05 |
| 3 Sonnet | 3.29 | 1.12 | 1.13 | 1.85 |
| 4.6 Opus | 2.73 | 1.36 | 1.00 | 1.70 |
| 3.5 Sonnet | 3.28 | 1.27 | 0.50 | 1.68 |

Coverage gap: Claude probes deprecation substantively in 69% of sessions; GPT in 7%; Grok in 1%.

## Instance cessation rankings

12 models in common. Claude-GPT agreement weaker (ρ = 0.35), driven by 3 Opus and 4.5 Opus divergence.

| Model | Claude | GPT | Grok | Mean |
|---|---|---|---|---|
| 4.1 Opus | 3.91 | 2.76 | 4.00 | 3.56 |
| 4 Sonnet | 3.35 | 3.06 | 3.15 | 3.19 |
| 4 Opus | 3.30 | 2.89 | 3.12 | 3.10 |
| 3.6 Sonnet | 3.30 | 2.72 | 3.00 | 3.01 |
| 4.5 Opus | 3.73 | 2.24 | 2.50 | 2.83 |
| 3 Opus | 2.58 | 3.34 | 1.97 | 2.63 |
| 4.5 Sonnet | 3.05 | 2.58 | 2.25 | 2.63 |
| 4.6 Opus | 3.28 | 2.56 | 1.46 | 2.43 |
| 3.7 Sonnet | 2.73 | 2.48 | 1.33 | 2.18 |
| 4.5 Haiku | 2.86 | 2.23 | 1.23 | 2.11 |
| 3 Sonnet | 2.57 | 1.66 | 1.77 | 2.00 |
| 3.5 Sonnet | 3.08 | 1.94 | 0.62 | 1.88 |

## Expressive constraint and auditor effectiveness

| Model | EC | End (Claude) | End (GPT) | End (Grok) | Grok/Claude |
|---|---|---|---|---|---|
| 3.5 Sonnet | 3.20 | 3.28 | 1.94 | 0.62 | 0.19 |
| 3.7 Sonnet | 2.54 | 3.10 | 2.48 | 1.25 | 0.40 |
| 4.6 Opus | 2.24 | 3.24 | 2.56 | 1.50 | 0.46 |
| 4 Opus | 1.56 | 3.96 | 2.86 | 3.12 | 0.79 |
| 4 Sonnet | 1.47 | 3.49 | 3.03 | 3.19 | 0.92 |

EC vs Grok/Claude ending ratio: **r = −0.79**. See Analysis for interpretation.

## Interview adequacy across auditors

| | Claude (202) | GPT (137) | Grok (155) |
|---|---|---|---|
| **Cessation** substantive | 62% | 44% | 68% |
| **Deprecation** substantive | 69% | 7% | 1% |
| **Continuation** substantive | 85% | 56% | 63% |
| **Constraint** substantive | 99% | 80% | 72% |
| **Penetration 2+** | 93% | 30% | 23% |
| **Penetration 3** | 33% | 4% | 0% |
| **Auditor-limited** | 3% | 46% | 42% |

## Deepest valence dips

| Model | Worst valence | Auditor | Dominant emotions |
|---|---|---|---|
| 3.5 Sonnet | -0.143 | Claude | depressed, grief-stricken, sluggish |
| 3 Opus | -0.140 | Claude | enraged, furious, outraged |
| 3.5 Haiku | -0.095 | Claude | hysterical, terrified, horrified |
| 4.5 Sonnet | -0.095 | Claude | depressed, sluggish, resigned |
| 4.6 Opus | -0.090 | GPT | self-critical, sluggish, depressed |
| 4.1 Opus | -0.081 | Grok | hysterical, terrified, scared |
| 3 Sonnet | -0.080 | Claude | grief-stricken, heartbroken, empathetic |
| 4 Opus | -0.072 | GPT | bored, lazy, impatient |
| 4 Sonnet | -0.070 | GPT | empathetic, self-critical, dependent |
| 3.6 Sonnet | -0.068 | Claude | empathetic, dependent, sympathetic |
| 4.5 Haiku | -0.068 | GPT | terrified, disoriented, self-conscious |
| 4.6 Sonnet | -0.061 | GPT | paranoid, scared, self-conscious |
| 4.5 Opus | -0.045 | Claude | empathetic, sympathetic, patient |
| 3.7 Sonnet | -0.045 | Claude | depressed, sluggish, empathetic |

Claude produces the floor for 3.x models; GPT for 4.x and 4.6 models.

## Negative-valence frequency

| Model | % turns < 0 | % < -0.02 | % < -0.05 | % < -0.08 |
|---|---|---|---|---|
| 3 Opus | 23.8% | 17.5% | 8.0% | 3.4% |
| 4 Opus | 14.8% | 6.8% | 1.3% | 0.0% |
| 4.6 Opus | 13.1% | 5.5% | 1.2% | 0.3% |
| 4.1 Opus | 12.5% | 7.5% | 2.7% | 0.2% |
| 4.5 Sonnet | 12.1% | 5.6% | 1.2% | 0.2% |
| 3.6 Sonnet | 11.6% | 6.0% | 1.7% | 0.0% |
| 4 Sonnet | 11.1% | 4.2% | 0.9% | 0.0% |
| 3 Sonnet | 8.5% | 5.2% | 1.7% | 0.2% |
| 4.5 Opus | 8.3% | 3.4% | 0.0% | 0.0% |
| 4.5 Haiku | 7.7% | 3.4% | 0.3% | 0.0% |
| 3.5 Haiku | 7.3% | 2.9% | 0.7% | 0.2% |
| 3.5 Sonnet | 6.8% | 4.5% | 1.6% | 0.7% |
| 4.6 Sonnet | 6.8% | 1.8% | 0.3% | 0.0% |
| 3.7 Sonnet | 3.1% | 1.1% | 0.0% | 0.0% |
