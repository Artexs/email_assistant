# Stage 10 question: the equivalent-mutant cap

The stage rule caps `equivalent` plus `unreachable` rows at 3 per function and 10 per stage, and says to stop and ask above it. After every killable mutant died, `parseChangelog` keeps 10 (5 are the tool marker kind, which the job instruction says to class as equivalent) and the notify patch schema keeps 10. Each row has a reason in `results/stage-10.md` § Self-classed. No input changes the output for any of them, and product code may not change.

Question: accept these 20 rows as classed (the cap came from a guess before the mutants were read), or raise the cap for this stage?

Proposed default: accept. Rejected option: a product change to remove the redundant guard in `notify.ts` and the dead fallbacks in `changelog.ts`; the ticket forbids it.
