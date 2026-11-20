---
opened: 2026-11-19
landed: 2026-11-20
---

# F145 · One time.ts spelling MINUTE_MS HOUR_MS DAY_MS is used everywhere and a lint rule bans the literals

## Outcome

Every minute, hour and day in the product code is written with `MINUTE_MS`, `HOUR_MS` or `DAY_MS` from the one time module in the core package. A local lint rule fails `bun run lint` when new product code writes `60_000`, `3_600_000`, `86_400_000`, a chain such as `24 * 60 * 60 * 1000`, or a local copy of the three names. A reader then finds each time window in one spelling, and a wrong unit stands out in review (quality pass 2, finding 5).

## Scope

- `MINUTE_MS` joins `HOUR_MS` and `DAY_MS` in `packages/core/src/time.ts`.
- A local ESLint rule `ea/no-time-literals`, with tests that lint virtual files through the real config.
- Non-test source under `apps/*/src`, `packages/*/src` and `tools/*/src`: about 150 lines in about 100 files at the plan base.
- The six local `MINUTE_MS` copies and the `MINUTE`/`HOUR`/`DAY` copies in product code and seed scripts go.
- One rule line in `docs/code-patterns.md` and the styleguide.

## Out of scope

- Test files, test helpers and Playwright code: the test audit (F125) owns them now (plan D3).
- Seconds (`1000` conversions, `SECOND_MS`) and lone multiples such as `120_000` (plan D4, D5).
- Any change of a time value: each rewrite keeps the same number.

## Acceptance

- `bun run lint` exits 0 at error severity for `ea/no-time-literals`.
- `apps/server/src/platform/time-lint.test.ts` passes. It fails when the rule is removed from `eslint.config.js`.
- In the rule scope (non-test source, plan D3), `packages/core/src/time.ts` is the only file that defines `MINUTE_MS`, `HOUR_MS` or `DAY_MS`.
- The value check of the rewrite stages exits 0: each rewritten expression has the old value.

## Slices

Six stages. 01 (the rule) and 02 (a value check for the rewrites) run in parallel; then 03, 04 and 05 (the rewrites) run in parallel; 06 last. No migration, no `bun.lock` change, no owner checkpoint. Detail: `plan.md` § How to run.

## Sequenced

- Plan after: none.
- Build after: none. Gate: none. File overlaps with F143 (file splits), F147 (operator alert texts), the CLI standard (F129) and the bare-code lint rule (F150), which both edit `eslint.config.js`, are advisory: merge master, re-prove.

## Notes

Source: `spec/quality/2026-11-20-pass-2.md` finding 5.
