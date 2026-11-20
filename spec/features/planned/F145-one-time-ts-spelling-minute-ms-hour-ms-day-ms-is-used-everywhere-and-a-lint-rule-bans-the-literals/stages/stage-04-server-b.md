# F145 stage 04 — Rewrite server: mail, platform, scripts and the rest

Needs stage 01: `MINUTE_MS` in `packages/core/src/time.ts` and the `ea/no-time-literals` warnings. May run next to 02 and 03 (no shared file).

Part of [`../plan.md`](../plan.md).

## Area

Every `ea/no-time-literals` warning under `apps/server/src/` that is not in stage 03's five modules: `modules/{mail,trust,replies,loops,audit,testmail,lab,delegation,contacts}/`, `platform/`, `scripts/`, the composition roots, and any module that stage 03 does not name. At the plan base, about 54 lines, among them `mail/fake/index.ts` (`86_400_000`), `mail/flags.ts`, `mail/tools.ts`, the SMTP socket timeout, `platform/llm/client.ts` and `platform/llm/testing.ts`, `delegation/chaser.ts`, `contacts/flags.ts`, `testmail/lock.ts`, and the `MINUTE`/`HOUR`/`DAY` copies in `scripts/e2e-*-rows.ts`. The warnings at `HEAD` are the list.

## Step 1 — Rewrite the literals

- **Goal:** each warning in the area is gone; each value is the same (D6).
- **Decisions:** D6, D7 (import from `@ea/core`), D8.
- **Edge cases:**
  - The rate limiter `60_000 / rpm` is ms per minute: `MINUTE_MS / rpm`. The fake LLM default `rpm: 60_000` in `platform/llm/testing.ts` is a count: keep it under a D8 disable comment.
  - The fake mail adapter `Math.floor(t / 86_400_000)` is a day number: `t / DAY_MS`.
  - The `e2e-*-rows.ts` seed scripts define `MINUTE`, `HOUR`, `DAY`: delete them and import the core names; rename uses (`3 * HOUR` → `3 * HOUR_MS`). Seed values do not change, so the e2e suites see the same rows.
  - A timeout that reads better in seconds (`socketTimeout: 60_000`) still is a minute: `MINUTE_MS`. Do not convert to seconds.
  - `platform/` sits below every module; it may import `@ea/core` (it does today for other names).
- **Test:** no new test; existing tests of the area stay green.

## Check

`bunx eslint apps/server/src` shows no `ea/no-time-literals` warning outside stage 03's five modules. `bun test apps/server/src/platform apps/server/src/modules/mail apps/server/src/scripts` passes.

## Final message

A table `file · old → new` for every changed expression, and each D8 disable with its reason.

## Done when

- No `ea/no-time-literals` warning in the area.
- No value changed (review).
- The Proof of `plan.md` for stage 04 prints `PROOF_OK`.

## Out of scope

Test files and `apps/server/test/` (D3); `tools/mail-oauth-spike/` (D10); seconds (D5); stage 03's modules.
