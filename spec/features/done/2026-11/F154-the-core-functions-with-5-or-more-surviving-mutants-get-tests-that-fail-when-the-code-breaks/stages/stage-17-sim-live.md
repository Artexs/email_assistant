# F154 stage 17 — sim live run: days, dates, env guard, executive, message ids

Needs stage 01: `scripts/test-audit/mutation-gaps.ts` and the run lock in `mutation.sh`. May run next to 02–16.

Part of [`../plan.md`](../plan.md). Method: plan.md § Stage method. Decisions P2, P3, D5–D10.

## Functions (audit counts at `4ce3f351`)

| File | Function | Through (exported) | Count |
| --- | --- | --- | --- |
| `sim/live/calendar-days.ts` | `isRealDate`, `formatDay` | themselves | 13, 5 |
| `sim/live/executive.ts` | `cardsOf` | itself | 10 |
| `sim/live/executive.ts` | `kindOf` (private) | `cardsOf` (the card `kind`) | 9 |
| `sim/live/date-shift.ts` | `shiftDatesInText` | itself | 9 |
| `sim/live/run-plan.ts` | `planLiveRun` | itself | 8 |
| `sim/live/env-guard.ts` | `sendAddressesAllowed` (private) | `checkSimEnv` | 6 |
| `sim/live/message.ts` | `parseLabMessageId` | itself | 5 |

Mutate globs: one per file above.

## Cases (fixed values)

1. `isRealDate` (planner probe at `a5399ff1`, all held): `(2026, 2, 29)` → `false`; `(2028, 2, 29)` → `true`; `(1900, 2, 29)` → `false`; `(2000, 2, 29)` → `true`; `(2026, 4, 31)` → `false`; `(2026, 13, 1)` → `false`; `(2026, 0, 1)` → `false`; `(2026, 1, 0)` → `false`; `(2026, 12, 31)` → `true`.
2. `formatDay` (probe): `(2026, 3, 5)` → `"2026-03-05"`; `(987, 11, 22)` → `"0987-11-22"`.
3. `parseLabMessageId`: build ids with `labMessageId` and the slot and run id shapes of `sim/live/message.test.ts` (the `LAB_ID` pattern refuses other shapes). Bracketed and bare forms → the same `{ slotId, runId }`; spaces around → trimmed; only an opening or only a closing bracket → `null`; a foreign id `<x@y>` → `null`.
4. `checkSimEnv` send addresses: allowed list `["lab@example.test"]`; raw `" LAB@example.test "` → no issue; `"lab@example.test, other@example.test"` → the send-address issue; `""` and unset → the code's result at `HEAD`.
5. `shiftDatesInText`: a Polish and an English date in one text shifted by 7 days → the exact text; a date-like string that is not a real date → unchanged; the flag the `BooleanLiteral` mutant flips → its branch once.
6. `kindOf` through `cardsOf`: one button of each kind → the exact kind string.
7. `cardsOf`: a message with a callback and no id, an id and no callback, and both → the exact card list (kills `||` vs `&&`).
8. `planLiveRun`: two slots at the same time → the tie order at `HEAD`; out-of-order slots → sorted by `at` (kills `<=`).

## Done when

- `results/stage-17.md` meets D5 and D6 for every function in the table.
- Last step: `bun run check:job`.

## Out of scope

- The lab mail client and bots in `apps/server`.
