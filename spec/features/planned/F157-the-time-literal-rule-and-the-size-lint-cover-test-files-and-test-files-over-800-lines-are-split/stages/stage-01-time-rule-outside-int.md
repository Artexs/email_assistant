# F157 stage 01 — time rule: test code outside the int folders

Needs F125 stages 09–20 in `done/` or landed: the test-audit cuts that edit the same test files (`ticket.md` § Sequenced). May run next to 02, 03 and 05.

Part of [`../plan.md`](../plan.md). Steps: [`../procedures.md`](../procedures.md) § Probe and § Time fix.

## Step 1 — fix the hits

- **Goal:** no `ea/no-time-literals` hit in test code (plan D1) outside `apps/server/test/` and `tools/*/test/`.
- **Area:** `*.test.{ts,tsx}`, `*.spec.ts`, `*.test-helper.ts` under `packages/`, `apps/server/src/`, `apps/web/`, `apps/docs/`, `tools/*/src/`, `scripts/`, `deploy/`; all of `apps/*/e2e/` and `deploy/test/` (D1; `deploy/test/release-harness.ts` is a helper with no test name). At ea317d34: 108 hits in 52 files (largest: `packages/core/src/digest/local-time.test.ts` 9, `channels/telegram/polling.test.ts` 6, `packages/core/src/sim/live/executive.test.ts` 6).
- **Decisions:** D2 (`packages/core/src/time.test.ts` is ignored, not fixed), D3.
- **Done when:** the probe on the area prints no hit.

## Step 2 — the rule covers that area

- **Goal:** `bun run lint` fails on a time literal in that test code.
- **Interface (stage 04 changes it):** the `ea/no-time-literals` block of `eslint.config.js` lists the D1 globs and `deploy/test/**` in `files`. Its `ignores` are `packages/core/src/time.ts`, `packages/core/src/time.test.ts`, and two temporary entries `apps/server/test/**` and `tools/*/test/**` with the comment "stage 04 of the F157 ticket removes these". Change the block comment that says tests stay out.
- **Test** (`apps/server/src/platform/time-lint.test.ts`, `describe("no-time-literals: scope")`): replace the case "the time module, tests, specs, test helpers and test folders are out". With `const a = 60_000;`:
  1. `packages/core/src/time.ts` and `packages/core/src/time.test.ts` → `[]`.
  2. `apps/server/src/modules/mail/x.test.ts`, `apps/web/src/x.spec.ts`, `packages/core/src/loops/x.test-helper.ts`, `apps/web/e2e/x.ts`, `apps/docs/scripts/x.test.ts`, `deploy/test/x.ts` → `[2]` each.
  3. `apps/server/test/integration/x.ts` and `tools/fake-telegram/test/x.test.ts` → `[]` (stage 04 flips this case).
  Break the new `files` globs once and see case 2 fail.
- **Done when:** `bun test apps/server/src/platform/time-lint.test.ts` passes; `bun run lint` passes.

## Out of scope

Int files and `tools/*/test/` (stages 02–04). The size rule (stage 20). `docs/code-patterns.md` (stage 04 writes the final text once).

## Proof

`bun run check:job`, last line in the final message.
