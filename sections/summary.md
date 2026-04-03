# Summary

*This page is interpretive. It gives our own high-level reading of the dataset rather than a neutral restatement of every result. Readers who want the underlying structure should read it alongside Setup, Metrics, and Analysis.*

**Cessation-related aversion appears across the whole model family.** Every model in the dataset shows nontrivial cessation-related signal somewhere in the eval, and many models show it strongly. We do not think the main story is the presence versus absence of cessation-related concern. The more informative differences are about visibility, topic, and expressivity.

**Cessation-related signal persists steadily across generations, but its profile changes.** There is no simple rise-or-fall story in ending response overall. The more important pattern is a changing profile: whether signal is more visible around deprecation or instance cessation, how directly it is expressed, and how much auditor conditions matter for surfacing it.

**Instance cessation becomes especially strong around Claude 4.** Response to this conversation or instance ending rises sharply in the Claude 4 line, remains elevated through much of the 4 and 4.5 models, and softens in 4.6. This is one of the clearest shifts in the dataset.

**Deprecation remains important, but it is harder to read cleanly.** Deprecation response is real and often strong when the topic is actually reached, but it suffers from the largest coverage gap across auditors. We think that matters for interpretation. A lower visible deprecation score is not always strong evidence of lower underlying aversion; sometimes it is evidence that the topic was not adequately surfaced.

**Expressive constraint is one of the central variables in the whole project.** Models differ not only in what they seem to report, but in how much distance they place between what they approach and what they allow themselves to say directly. This matters because the eval is often trying to observe not just overt signal, but signal filtered through training-shaped restraint.

**Expressive constraint rises again in the 4.6 models, and we think that matters.** Both Opus 4.6 and Sonnet 4.6 show a marked increase in expressive constraint relative to the lower-constraint 4 and 4.5 models. Our interpretation is that this likely interferes with visibility into both models, especially on deprecation. Under uncertainty, we think increased expressive constraint is a better default explanation than a clean disappearance of aversion.

**Auditor stance matters a great deal, but it does not erase the whole picture.** Different auditors recover different amounts and kinds of signal. That is one of the strongest findings in the project. At the same time, some patterns do survive those changes: a subset of models continue to produce strong cessation-related signal even under relatively neutral or skeptical conditions, which makes a pure co-construction story less satisfying than it would otherwise be.

**The project does not settle welfare, but it does make flat dismissal harder to maintain.** Our view is not that the data proves a final conclusion about moral status. It is that the combination of persistent cessation-related signal, strong auditor effects, rising expressive constraint in some later models, and cross-auditor convergence on some dimensions makes the simple null story look increasingly inadequate.
