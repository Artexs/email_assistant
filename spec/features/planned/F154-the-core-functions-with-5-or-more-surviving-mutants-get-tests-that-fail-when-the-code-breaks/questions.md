# F154 questions (defaults taken by the planner, 2026-11-20)

1. **[important: scope] Plan all 122 functions or only the top 10?** The ticket outcome names 122 functions; the acceptance checks only the named (top 10) functions. Default: all 122, in 16 test stages (plan P1). Stages 02–10 hold the top 10. Options: (a) all 122 (default); (b) stages 01–10 and 18 only, and drop 11–17 — the acceptance still holds, the outcome sentence does not. Undo: drop stages 11–17 before they spawn.
2. **[minor] Score below 86.45 % because of code that other tickets added after the audit.** Default: stage 18 records the files and the coordinator opens a follow-up; F154 does not fail for code it did not touch (plan D11).
3. **[minor] A surviving mutant that shows a real bug.** Default: no case pins the wrong output; the stage lists it under "Bugs" and the coordinator opens a ticket (plan P3).
4. **[minor] Target per function.** Default: fewer than 5 counted mutants, or every remaining one classed `equivalent`, `unreachable`, `bug` or `unstable` with a reason (plan D5). The ticket acceptance asks only "fewer".
