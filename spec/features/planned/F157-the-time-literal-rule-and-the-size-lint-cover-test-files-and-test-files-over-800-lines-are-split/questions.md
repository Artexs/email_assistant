# F157 questions

Defaults taken by the planner (2026-11-20). None blocks a stage.

1. [important: scope] **Which files count as test code for both rules?** Default: all test code that the rules skip today, not only `*.test.ts`: also `*.spec.ts` (e2e), `*.test-helper.ts` and the helper files under `apps/server/test/` and `tools/*/test/`. So `apps/server/test/integration/fixtures.ts` (805 lines, imported by 332 int files) is split too (stage 12). Undo: keep the helper globs in the ignore lists of stage 04 and stage 20 and drop `fixtures.ts` from stage 12. Plan D1.
2. [minor] **Part size.** Default: each part of a split file is at most 600 lines (under 400 where a topic allows), to leave room under the 800 error. Parts are named `<old base>-<topic>.test.ts`; no part keeps the old name. Plan D6.
3. [minor] **Warnings in test code.** Default: after stage 20 about 173 test files of 401–800 lines (and some new parts) show a `max-lines` warning in `bun run lint`, as product files do. No ticket splits them now. Undo: a follow-up ticket, or a test-only warn limit. Plan D12.
4. [minor] **`time.test.ts`.** Default: it joins `time.ts` outside the time rule, because it pins the three values as literals. Plan D2.
