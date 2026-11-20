# F145 stage 02 — Rewrite core, web and docs

Needs stage 01: `MINUTE_MS` in `packages/core/src/time.ts` and the `ea/no-time-literals` warnings. May run next to 03 and 04 (no shared file).

Part of [`../plan.md`](../plan.md).

## Area

Every `ea/no-time-literals` warning under `packages/core/src/`, `apps/web/src/` and `apps/docs/src/`. At the plan base, about 38 lines: core `sim`, `digest`, `loops`, `metrics` (`m2.ts`, `m5.ts`), `web/replies.ts`, `replies/eligibility.ts`, `testmail/plan.ts`; web `lib/operator-view.ts`, `lib/approvals-view.ts`, `lib/delete-organization.ts`, `islands/OperatorPage.tsx`, the activity `DelegateHintProvider`; docs `autonomy-evidence.ts`. The warnings at `HEAD` are the list, not this line.

## Step 1 — Rewrite the literals

- **Goal:** each warning in the area is gone; each value is the same (D6).
- **Decisions:** D6 (unit swap, no value change), D7 (core uses a relative `time` import; web uses `@ea/core/web`; docs uses `@ea/core`), D8 (a non-time literal keeps its value under a disable comment with a reason).
- **Local copies:** delete the `MINUTE_MS` copies in `metrics/m5.ts`, `sim/live/bot.ts`, `sim/live/executive.ts` and `sim/plan-week.ts`, and the `MINUTE`/`HOUR` copies in `apps/web/src/lib/operator-view.ts`; import the core names instead. An exported constant keeps its name and value (`DELEGATION_DEFAULT_DUE_MS = 3 * DAY_MS`).
- **Edge cases:**
  - A web file must not import the server barrel `@ea/core` when its folder imports only `@ea/core/web`; follow what the file's neighbours import.
  - A core file in `packages/core/src/web/` imports `../time`, never `@ea/core`.
  - A literal in a comment or a string is not a warning; leave it.
- **Test:** no new test. The existing tests of the changed files are the check that values stayed; `time-lint.test.ts` from stage 01 stays green.

## Check

`bunx eslint packages/core/src apps/web/src apps/docs/src` shows no `ea/no-time-literals` warning. `bun test packages/core apps/web/src/lib apps/docs/src` passes.

## Final message

A table `file · old → new` for every changed expression, and each D8 disable with its reason. The Haiku review evaluates each pair.

## Done when

- No `ea/no-time-literals` warning in the area.
- No value changed (review).
- The Proof of `plan.md` for stage 02 prints `PROOF_OK`.

## Out of scope

Test files and test helpers (D3); seconds (D5); server code (stages 03, 04); the rule severity (stage 05).
