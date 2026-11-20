# F154 stage 11 — digest render, review list, schedule, callbacks

Needs stage 01: `scripts/test-audit/mutation-gaps.ts` and the run lock in `mutation.sh`. May run next to 02–10, 12–17.

Part of [`../plan.md`](../plan.md). Method: plan.md § Stage method. Decisions P2, P3, D5–D10.

## Functions (audit counts at `4ce3f351`)

| File | Function | Count |
| --- | --- | --- |
| `digest/digest.ts` | `renderListed`, `sortItems`, `cutToLimit` | 13, 10, 7 |
| `digest/digest.ts` | `renderDigestWithBrief`, `renderDigestMinimal`, `briefOptions` | 6, 5, 5 |
| `digest/review.ts` | `renderListed` | 6 |
| `digest/schedule.ts` | `dueDigestSlot` | 5 |
| `digest/callback.ts` | `isReplyCallback`, `base64UrlToUuid` | 6, 6 |

Mutate globs: `src/digest/digest.ts`, `src/digest/review.ts`, `src/digest/schedule.ts`, `src/digest/callback.ts`.

## Cases (fixed values)

Use the item and facts builders of `digest/digest.test.ts`. Fixed clock `2026-03-02T07:00:00Z`, time zone `Europe/Warsaw`. Assert the whole message text or the exact line array.

1. `sortItems` (through the digest render): three items received at 08:00, 09:00, 10:00 on one day → listed newest first; two items with the same time → the tie order the code has at `HEAD` (kills the `+` and the tie-branch mutants).
2. `renderListed` (digest): an empty list → no section; one item → the exact section; the item count over the shown limit → the "and N more" line with the exact N.
3. `cutToLimit`: a message exactly at `MESSAGE_MAX_CHARS` → unchanged; one character over → cut at the last whole line with the cut marker; the boundary of `end` (kills `end + 1`).
4. `renderDigestWithBrief`: a brief that makes the text exactly `MESSAGE_MAX_CHARS` → one message; one character more → the split the code does at `HEAD` (kills `<` vs `<=`).
5. `renderDigestMinimal`: `mailboxProblems` 0 → no problem line; 1 → the problem line (kills `>= 0`).
6. `briefOptions`: each branch once, asserting the exact options object.
7. `digest/review.ts` `renderListed`: an empty review list, one item, and the over-limit line; exact text.
8. `dueDigestSlot`: a slot key equal to the late key → the code's result at `HEAD`; one before and one after → due and not due (kills `>=`).
9. `isReplyCallback`: one callback of each family → `true` only for the reply family; a reply callback with a missing field → `false`.
10. `base64UrlToUuid`: `base64UrlToUuid` of the 22-character form of `00000000-0000-4000-8000-000000000001` → that UUID; a 21-character input → `null`; an input with `+` or `/` → `null`. Take the encoder from `callback.ts` to build the input; write the literal into the test.

## Done when

- `results/stage-11.md` meets D5 and D6 for every function in the table.
- Last step: `bun run check:job`.

## Out of scope

- The notice renderers (stage 12) and the text tables (stage 13).
