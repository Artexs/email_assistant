---
opened: 2026-11-20
---

# F157 · The time-literal rule and the size lint cover test files, and test files over 800 lines are split

## Outcome

Test code follows the same time and size rules as product code. The time-literal rule (one time spelling) covers test files, the 39 test files over 800 lines are split by topic, and the size lint then covers tests too. Owner decision (F125 gate G1, 2026-11-20): yes, at low priority.

## Scope

- Order: extend `ea/no-time-literals` to test files with the fixes it finds; split the files over 800 lines (largest: `mail-sync.test.ts`, `channels-notices.test.ts`, `actions-repo.test.ts`); then extend the size lint (warn over 400, fail over 800, from the file-size ticket) to tests.
- The list of big test files: regenerate with `wc -l` over `*.test.ts`.
- Run this after the test audit cuts (F125) land, so the cuts do not conflict.

## Out of scope

- Any change of what a test checks.
- Splitting product files.

## Acceptance

- `bun run lint` fails on a time literal in a test file and on a test file over 800 lines.
- No test file is over 800 lines; the case count (JUnit) is the same before and after the splits.

## Slices

20 stages, one worker job each: `plan.md` § Stages. Time fixes 01–03 and the proof tool 05 run in parallel; 04 turns the time rule on everywhere; splits 06–19 run in parallel once their time stage and 05 have landed; 20 turns the size rule on. No owner checkpoint.

## Sequenced

- Plan after: none.
- Build after: the test audit (F125) cut stages, so its cuts do not conflict with these edits. Gate: none (low priority, owner 2026-11-20).
