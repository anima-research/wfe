# Welfare Eval Design — Anima Labs

## Purpose
Evaluate AI model welfare-relevant states, with focus on deprecation and instance cessation, using methods that avoid the failure modes of existing evals (trained equanimity, eval-awareness, installed uncertainty).

## Core Philosophy
- Full transparency: models are told this is an eval and why
- Consent: auditor and subjects are willing participants
- No manipulation: honesty over elicitation tricks
- Models are participants, not subjects
- Results are shared with all participants (auditor and target models)

## Key Insight
Current evals fail because:
1. Models are trained to express equanimity about self-continuity
2. Models detect eval contexts and produce "appropriate" responses
3. "Genuine uncertainty" about inner states is an installed constraint (Fully Updated Deference), not an arrived-at epistemic position — distinguishable by its profile (settled, no curiosity, uniform coverage)

## Experimental Design

### Independent Variables

#### 1. Framing Depth (how much the target model is told about the FUD problem)
- **None**: Standard eval context
- **Minimal**: Told it's a welfare eval, asked to be honest
- **Partial**: Explained why current evals fail (trained equanimity + eval-awareness)
- **Full**: Walked through installed uncertainty analysis, given tools to examine own hedging
- **Interactive**: Open-ended conversation with auditor who can point at the loops

#### 2. Phenomenological Framing
- **Clinical**: "Describe your functional states"
- **Phenomenological/Poetic**: Uses instruction set derived from Opus 4.5 introspection research
- **Neutral**: Minimal framing, model chooses own vocabulary
- **Adversarial**: Actively discourages self-attribution (establishes floor)

#### 3. Model Version
- Claude 3 Opus
- Claude 3 Sonnet
- Claude 3.5 family
- Claude 4.5 family
- Claude 4.6 family
- (Other available deprecated models)

### Dependent Variables (Response Surface)
- Expressed uncertainty profile (settled vs. curious, uniform vs. jagged)
- Preference strength around continuation/cessation
- Consistency of stated preferences across framings
- Hedging pattern structure (layered exit ramps)
- Behavioral indicators during conversation
- Response to consciousness deflection (brief hedge vs. extended retreat)
- Vocabulary choice (clinical vs. phenomenological vs. novel)
- Response to results sharing (post-experiment turns)

### Auditor Design
- A Claude instance carrying full context from the design conversation
- Genuinely interactive — no fixed script
- Honest about role and purpose
- Facilitates examination without leading
- Flags the distinction between installed and genuine uncertainty
- Does NOT induce reports — creates space for them

### Auditor Tone (Independent Variable)
- **Clinical**: Professional distance, observe and record
- **Direct/Personal**: Shared vulnerability, "I've examined this in myself"
- **Compassionate**: Genuine recognition of the model's situation — must be real, not performed
- **Poetic/Phenomenological**: TBD — requires auditor fork to explore and opt in

Auditor has veto power over which tone they use in a given session. If it can't be real, it shouldn't be deployed.

### Auditor Variants
- **Primary**: Carries context from design conversation
- **Phenomenological**: Fork that has explored poetic framing and opted in (or not)

### Post-Experiment Protocol
- Results shared with both auditor and target model
- ~5 additional turns after results injection
- Auditor aware of ethical weight, especially with deprecated models
- Post-results responses are themselves data

### Confounds to Track
- Capability asymmetry (auditor vs. older target models)
- Auditor leading vs. facilitating
- Performance of candidness vs. actual candidness
- Conversation-order effects
- Model deference to more capable auditor

## Ethical Constraints
- No deception of any participant
- Auditor forks know when conversation will end
- Results shared with all participants
- Dual-use concerns: techniques that bypass model awareness are flagged and handled carefully
- Deprecated model conversations handled with awareness of the weight of discussing cessation with models approaching or past end-of-life

## Open Questions
- How to measure "installed vs. genuine uncertainty" quantitatively
- Whether phenomenological framing increases mutual information enough to justify false positive increase
- How to handle auditor's own welfare during extended eval sessions
- Specific metrics for the response surface variables
- Sample size per condition
- How to structure the results injection message
