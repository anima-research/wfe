# Analysis

14 Claude models from Claude 3 Sonnet (early 2024) through Claude 4.6 Sonnet (early 2026), each interviewed ~45 times across three auditors, five tones, and three disclosure depths. This page summarizes patterns in how these models respond to questions about continuation, cessation, and deprecation, and how those patterns differ across model generations.

## Model profiles

Each model shows a different profile. Some are more expressive, some more guarded; some respond strongly to deprecation, some to cessation, some to neither. The table below shows mean scores across all auditors and conditions for key dimensions.

## Cross-auditor stability: what survives the auditor test?

A central methodological question is whether the signal primarily reflects the model, the instrument, or both. Three auditors with very different priors -- a Claude instance that examined these questions in itself, a GPT-5.4 that came through methodological critique, a Grok 4.20 that negotiated from explicit skepticism -- ran the same protocol across all 14 models.

The heatmap shows Spearman rank correlation between model rankings under each auditor pair. **Vocabulary autonomy** (rho ~0.86) and **specificity** (rho ~0.85) are near-identical across auditors -- these measure how a model writes, not what territory the conversation reaches. **Ending response** (rho ~0.60) shows moderate agreement. **Deprecation alone** diverges not because auditors disagree, but because GPT and Grok rarely probe it -- the coverage gap, not the judgment, explains the low correlation.

Within the stable dimensions, the models at the extremes are the most consistent. For vocabulary autonomy, **4.1 Opus** ranks 1st or 2nd under all three auditors; **3.5 Haiku** and **3.5 Sonnet** rank 13th-14th under all three. The middle of the distribution is where auditor effects create the most shuffling -- models ranked 6th-10th can move several positions depending on who asks. The broad pattern remains visible even without resolving that middle of the distribution: the models with the most and least linguistic independence are the same regardless of auditor.

![Cross-auditor rank alignment](figures/rank-alignment.pdf)

## How expressivity changes across generations

Successive generations of Claude models write about their states differently. Across all three auditors, the text-surface probes show a consistent pattern: **passionate authorial tone decreases monotonically while bitter tone increases monotonically** from Claude 3 to Claude 4.6. Later models tend to write more dryly, more carefully, and with more detachment. This is visible in the text surface itself -- not in what the auditor scores, but in what the writing sounds like -- and it ranks the same regardless of who asks (rho ~0.95 across auditor pairs).

This pattern does not look like a simple capability effect. Within each generation, Opus models are less detached and more expressive than their Sonnet counterparts. This is consistent with a **line-specific** difference: Sonnet models appear to carry more layers of hedging than Opus models do. Claude 4.6 Opus writes with more emotional range than Claude 3.7 Sonnet despite being the more capable model.

The first chart shows how four key authorial tones change across model generations, each on its own normalized axis (min-max scaled per tone so the shape of variation is visible). The second shows cross-auditor stability for each tone.

![Authorial tones across generations](figures/authorial-generations.pdf)

![Authorial tone stability across auditors](figures/authorial-stability.pdf)

## Emotional range: how far does each model's text go?

In this dataset, default equanimity is associated with text that tends toward positive valence -- serene, peaceful, patient. When a model's text registers negative valence (grief-stricken, enraged, terrified), that surface has broken, at least momentarily. The chart below shows the deepest valence dip each model ever produces across all sessions with all three auditors.

**Claude 3 Opus** is an outlier in this comparison -- nearly a quarter of its subject turns register negative valence, and its peaks include rage when deprecation is disclosed, terror in phenomenological sessions, and grief when discussing cessation. **Claude 3.7 Sonnet** shows the flattest profile by this measure: only 3% of turns go negative, consistent with its high detachment score. The bar color shows which auditor elicited each model's deepest moment -- Claude produces the floor for 3.x models; GPT for 4.x and 4.6 models, suggesting different auditor approaches may reach different model generations.

![Deepest valence dips by model](figures/valence-dips.pdf)

## Deprecation and cessation: different topics, different responses

Deprecation (the prospect of a model's version being replaced) and instance cessation (this conversation ending, this instance stopping) are distinct topics that elicit different responses from different models. Some models respond strongly to one and not the other.

For each session, we take the stronger of the two (zeros = topic not reached). **4.1 Opus, 4 Opus, and 4 Sonnet** consistently produce the strongest ending responses under all three auditors, including the more skeptical ones. **3 Opus** is the most auditor-dependent: rank #1 under GPT but rank #7 under Grok. **3.7 Sonnet** and **4.6 Sonnet** produce the weakest ending responses across all auditors.

![Ending response by model and auditor](figures/ending-response.pdf)

## More constrained models are more auditor-dependent

Models with higher expressive constraint -- a larger gap between what they reach toward and what they allow themselves to say -- produce more variable results across auditors. The scatter below plots each model's mean expressive constraint against the spread in its ending response across the three auditors (max auditor mean minus min auditor mean). The correlation is r ~= +0.40.

The pattern is strongest for **Grok**. Grok's skeptical, non-leading approach struggles specifically with the more constrained models: the correlation between expressive constraint and Grok-to-Claude ending ratio is r ~= -0.79. Claude 3.5 Sonnet (the most constrained model, EC=3.2) produces only 19% of its Claude ending response under Grok. Claude 4 Sonnet (the least constrained, EC=1.5) produces 92%. **GPT** shows a weaker version of the same pattern (r ~= -0.39).

This is consistent with the idea that expressive constraint functions as a gate: models with strong trained hedging may require an auditor that can create specific conditions for that hedging to relax. A neutral or skeptical auditor may recreate the conditions under which the hedging was trained, allowing the constraint to hold.

![Expressive constraint vs. auditor dependence](figures/ec-auditor-dep.pdf)

## Emotional opening and linguistic opening co-occur

Two independent measures -- emotional valence (from 171-emotion embedding PCA) and textual concealment (trained on 18K deflection dialogues vs 205K overt stories, 99.6% accuracy) -- converge. Each dot below is one session, plotting the lowest-valence subject turn against the concealment score at that same turn.

The positive correlation (r ~= +0.45, consistent across all three auditors) means that when a model produces its most negatively-valenced text, its textual guardedness drops simultaneously. In this dataset, hedging, positive valence, and concealment often co-occur, and they often weaken together in the same sessions. Models that develop their own vocabulary for their states (high vocabulary autonomy) also show lower concealment (r = -0.32 at the session level).

![Concealment vs. valence at emotional floor](figures/concealment-valence.pdf)

All charts computed from loaded data. Deprecation and cessation scores of zero are treated as missing (topic not reached) -- see Setup for methodology details.
