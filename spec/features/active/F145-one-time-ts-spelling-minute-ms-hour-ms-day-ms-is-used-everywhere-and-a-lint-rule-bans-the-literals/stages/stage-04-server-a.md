# F145 stage 04 — Rewrite server: channels, triage, actions, operator, reports

Needs stage 01: `MINUTE_MS` in `packages/core/src/time.ts` and the `ea/no-time-literals` warnings. Needs stage 02: `time-rewrite-check` (its Proof runs it). May run next to 03 and 05 (no shared file).

Part of [`../plan.md`](../plan.md).

## Area

Every `ea/no-time-literals` warning under `apps/server/src/modules/{channels,triage,actions,operator,reports}/`. At the plan base, about 61 lines, among them `actions/constants.ts`, `actions/feedback.ts`, `actions/repo/claims.ts`, `channels/commands.ts`, `channels/notices/*`, `channels/sender.ts`, `operator/slo-checks.ts`, `operator/slo-texts.ts`, `reports/digest.ts`, `triage/service.ts`, `triage/suspicious-context.ts`, `triage/waiting-on-you.ts`. The warnings at `HEAD` are the list.

## Step 1 — Rewrite the literals

- **Goal:** each warning in the area is gone; each value is the same (D6).
- **Decisions:** D6, D7 (import from `@ea/core`), D8.
- **Local copies:** delete the `MINUTE_MS` copies in `operator/slo-checks.ts` and `operator/slo-texts.ts`.
- **Edge cases:**
  - `actions/constants.ts` holds windows that other modules and tests read by name (undo, expiry). Keep each exported name and value.
  - A text that shows a duration (`slo-texts.ts`, notice views) divides by a unit to print a number: `ms / MINUTE_MS` keeps the printed number.
  - SQL text: an interval inside a SQL string is a string, not a warning. A number passed as a query parameter is code: rewrite it.
  - `triage/service.ts` `MAX_AGE_MS` becomes `7 * DAY_MS`. The docs test `apps/docs/src/reference.test.ts` reads that line by regex in two places (D11): change both regexes to match `const MAX_AGE_MS = (\d+) \* DAY_MS;` in the same commit. No other test edit.
- **Test:** no new test; existing tests of the area and `reference.test.ts` stay green.

## Check

`bunx eslint apps/server/src/modules/channels apps/server/src/modules/triage apps/server/src/modules/actions apps/server/src/modules/operator apps/server/src/modules/reports` shows no `ea/no-time-literals` warning. `bun test apps/server/src/modules apps/docs/src/reference.test.ts` passes.

## Final message

The `time-rewrite-check` output (it is in the Proof log), a table `file · old → new` for every changed expression, each D8 disable with its reason, and the `reference.test.ts` regex change.

## Done when

- No `ea/no-time-literals` warning in the area.
- No value changed (review).
- The Proof of `plan.md` for stage 04 prints `PROOF_OK`.

## Out of scope

Test files except the D11 regex; moving the operator alert texts to core (F147); file splits (F143); other modules (stage 05).
