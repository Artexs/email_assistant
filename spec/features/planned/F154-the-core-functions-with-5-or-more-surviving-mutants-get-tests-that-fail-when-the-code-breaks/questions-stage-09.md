# Question from the public content stage

Three of the five listed functions keep survivors that no test can kill (list in `results/stage-09.md`, "Self-classed"). Non-marker equivalent or unreachable rows: `parseAllowList` 10, `safeNextPath` 4, `r4ExternalAsset` 3, stage total 17. The plan cap is 3 per function and 10 per stage.

Question: accept these classes as they stand?

Proposed default: yes. Every row has a one-line reason. The cause is code that cannot differ in output: the empty-entry and empty-reason checks of `parseAllowList` both reduce to "no ` | ` in the line", and the origin guard of `safeNextPath` can never fire after the checks above it.

Option: a later ticket removes the redundant code (a product change; out of scope here).
