# F145 stage 01 — `MINUTE_MS` and the rule at warn

Needs: nothing. May run next to 02.

Part of [`../plan.md`](../plan.md).

## Step 1 — `MINUTE_MS` in the time module

- **Goal:** `packages/core/src/time.ts` exports `MINUTE_MS = 60_000`, `HOUR_MS = 60 * MINUTE_MS`, `DAY_MS = 24 * HOUR_MS`; same values.
- **Interfaces:** `MINUTE_MS` from `@ea/core` and `@ea/core/web` (both barrels `export *` from `time`). Copies elsewhere belong to stages 03–05.
- **Test:** extend `packages/core/src/time.test.ts`: T0 `MINUTE_MS === 60000`, `HOUR_MS === 3600000`, `DAY_MS === 86400000`.

## Step 2 — The rule `ea/no-time-literals`

- **Goal:** the rule of plan D2 in `tools/eslint-rules/no-time-literals.js`; the plugin object `ea` in `tools/eslint-rules/index.js` (D1: later local rules join this object). `eslint.config.js` registers the plugin once, in one new block with the files and ignores of D3, severity `warn` (D9). The `no-restricted-syntax` block stays as it is.
- **Decisions:** D1, D2, D3, D9.
- **Factor detail:** flatten nested `*` nodes (parentheses and right nesting included); unwrap `as`, `satisfies` and `!` around a factor; a factor is a numeric literal, a unit name (`MINUTE_MS`, `HOUR_MS`, `DAY_MS`) or other. Fold only integer literal factors, in integer arithmetic (`Number.isSafeInteger` before `%`). Report once, on the outermost `*` node.
- **Test:** new `apps/server/src/platform/time-lint.test.ts`, in the pattern of `log-lint.test.ts` (`lintText` on a virtual path, no fatal messages); keep messages with `ruleId === "ea/no-time-literals"`, compare the list of severities. Default path `apps/server/src/modules/mail/__time-fixture.ts`. `[1]` is one warning. Cases with `d` declare it first.

| # | Code | Expect |
|---|---|---|
| T1 | `const a = 60_000;` | `[1]` |
| T2 | `const a = 60000;` / `const a = 6e4;` / `const a = -60_000;` | `[1]` each |
| T3 | `const a = 3_600_000;` / `const a = 86_400_000;` | `[1]` each |
| T4 | `const a = 24 * 60 * 60 * 1000;` | `[1]` (one per chain) |
| T5 | `const a = 5 * 60 * 1000;` / `1000 * 60 * 60` / `60 * (60 * 1000)` / `(60 as number) * 1000` | `[1]` each |
| T6 | `const a = d * 60 * 1000;` / `d / 60_000` | `[1]` each |
| T7 | `const a = 7 * 24 * 3_600_000;` | `[1]` (no second report for the inner literal) |
| T8 | `const a = 1.5 * 60_000;` / `const a = 1.5 * 60 * 1000;` | `[1]` each (D2 b) |
| T9 | `30 * 1000` / `60 * 60` / `120_000` / `"60000"` / `60 * 60 * 24 * 30` (seconds, from the auth token expiry) | `[]` each |
| T10 | `import { DAY_MS, MINUTE_MS } from "@ea/core"; const a = 7 * DAY_MS; const b = 90 * MINUTE_MS;` | `[]` |
| T11 | `60 * MINUTE_MS` / `120 * MINUTE_MS` / `24 * HOUR_MS` / `48 * HOUR_MS` / `d * 24 * HOUR_MS` (with the import) | `[1]` each (D2 d) |
| T12 | `const HOUR = 60;` / `export const DAY_MS = 1;` / `class A { MINUTE_MS = 1; }` | `[1]` each (D2 c) |
| T13 | text of T1 at `packages/core/src/time.ts`, `apps/server/src/modules/mail/x.test.ts`, `apps/web/src/x.spec.ts`, `packages/core/src/loops/x.test-helper.ts`, `apps/web/e2e/x.ts`, `apps/server/test/integration/x.ts` | `[]` each |
| T14 | text of T1 at `packages/core/src/sim/__f.ts`, `apps/web/src/lib/__f.ts`, `apps/web/src/islands/__f.tsx`, `apps/docs/src/__f.ts`, `tools/fake-telegram/src/__f.ts` | `[1]` each |
| T15 | `// eslint-disable-next-line ea/no-time-literals -- a count` then T1 | `[]` (D8) |

- **Guard check:** remove the plugin block from `eslint.config.js`, run the test, see T1, T4, T8, T11 and T12 fail; restore. Remove the chain flattening (report literals only) and see T4 and T5 fail; restore.

## Check

`bun test apps/server/src/platform/time-lint.test.ts packages/core/src/time.test.ts`, then `bun run lint` (exits 0; the new warnings are the work list of stages 03–05). Give the warning count per area of stages 03, 04, 05 in the final message.

## Done when

- T0–T15 pass; both guard checks failed and were restored (failing cases named in the final message).
- `bun run lint` exits 0; new output is only `ea/no-time-literals` warnings.
- The Proof of `plan.md` for stage 01 prints `PROOF_OK`.

## Out of scope

Rewrites outside `time.ts`; severity `error`; docs (stage 06).
