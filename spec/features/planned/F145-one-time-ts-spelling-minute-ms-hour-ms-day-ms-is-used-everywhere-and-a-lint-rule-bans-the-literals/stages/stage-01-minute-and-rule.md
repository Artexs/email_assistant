# F145 stage 01 — `MINUTE_MS` and the rule at warn

Needs: nothing. May run next to any stage of another ticket. Stages 02–04 of this ticket need its `MINUTE_MS` export and its rule.

Part of [`../plan.md`](../plan.md).

## Step 1 — `MINUTE_MS` in the time module

- **Goal:** `packages/core/src/time.ts` exports `MINUTE_MS = 60_000`, `HOUR_MS = 60 * MINUTE_MS`, `DAY_MS = 24 * HOUR_MS`. Values do not change.
- **Interfaces:** `MINUTE_MS` from `@ea/core` and `@ea/core/web` (both barrels already `export *` from `time`). Do not touch the copies elsewhere: stages 02–04 own them.
- **Test:** extend `packages/core/src/time.test.ts`: T0 `MINUTE_MS === 60000`, `HOUR_MS === 3600000`, `DAY_MS === 86400000`.

## Step 2 — The rule `ea/no-time-literals`

- **Goal:** the rule of plan D2 in `tools/eslint-rules/no-time-literals.js` (plain ESM, D1), exported as a plugin object `{ rules: { "no-time-literals": … } }`. `eslint.config.js` registers the plugin as `ea` in one new block with the files and ignores of D3 and severity `warn` (D9). It does not touch the `no-restricted-syntax` block.
- **Decisions:** D1, D2, D3, D9.
- **Chain rule detail:** flatten nested `*` BinaryExpressions (parentheses included) into factors; multiply only the numeric-literal factors; report on the outermost `*` node when the product is a multiple of 60 000 and at least one factor is a literal. A literal inside a `*` chain never reports on its own; a literal outside a chain reports when it equals one of the three values.
- **Test:** new `apps/server/src/platform/time-lint.test.ts`, in the pattern of `log-lint.test.ts`: `new ESLint({ cwd: repoRoot })`, `lintText(code, { filePath })` on a virtual path, no fatal messages, keep only messages with `ruleId === "ea/no-time-literals"`, compare the list of severities. Default path `apps/server/src/modules/mail/__time-fixture.ts`. Expected `[1]` means one warning.
  - T1 `const a = 60_000;` → `[1]`
  - T2 `const a = 60000;` → `[1]`
  - T3 `const a = 3_600_000;` → `[1]`
  - T4 `const a = 86_400_000;` → `[1]`
  - T5 `const a = 24 * 60 * 60 * 1000;` → `[1]` (one per chain)
  - T6 `const a = 5 * 60 * 1000;` → `[1]`
  - T7 `declare const d: number; const a = d * 60 * 1000;` → `[1]`
  - T8 `const a = 7 * 24 * 3_600_000;` → `[1]` (the literal inside the chain does not add a second report)
  - T9 `declare const ms: number; const a = ms / 60_000;` → `[1]`
  - T10 `const a = 30 * 1000;` → `[]`; `const b = 60 * 60;` → `[]`; `const c = 120_000;` → `[]` (D4); `const d = "60000";` → `[]`
  - T11 `import { DAY_MS } from "@ea/core"; const a = 7 * DAY_MS;` → `[]`
  - T12 `import { MINUTE_MS } from "@ea/core"; const HOUR = 60 * MINUTE_MS;` → `[1]` (local copy); `const DAY_MS = 1;` → `[1]`
  - T13 text `const a = 60_000;` at `packages/core/src/time.ts` → `[]`; at `apps/server/src/modules/mail/x.test.ts` → `[]`; at `apps/server/test/integration/x.ts` → `[]`
  - T14 text `const a = 60_000;` at `packages/core/src/sim/__time-fixture.ts`, `apps/web/src/lib/__time-fixture.ts` and `apps/docs/src/__time-fixture.ts` → `[1]` each
  - T15 `// eslint-disable-next-line ea/no-time-literals -- a count\nconst a = 60_000;` → `[]` (D8)
- **Guard check:** remove the plugin block from `eslint.config.js`, run the new test, see T1, T3, T5 and T12 fail, restore the block. Name the failing cases in the final message.

## Check

`bun test apps/server/src/platform/time-lint.test.ts packages/core/src/time.test.ts`, then `bun run lint` (exits 0; the new warnings are expected and are the work list of stages 02–04). Write the warning count per stage area (02: core, web, docs; 03: server channels, triage, actions, operator, reports; 04: the rest of the server) in the final message.

## Done when

- T0–T15 pass; the guard check failed and was restored.
- `bun run lint` exits 0 and shows only `ea/no-time-literals` warnings as new output.
- The Proof of `plan.md` for stage 01 prints `PROOF_OK`.

## Out of scope

Any rewrite of a literal outside `time.ts`; severity `error`; docs lines (stage 05).
