# F154 stage 11 — digest render, review list, schedule, callbacks

Needs stage 01: `scripts/test-audit/mutation-gaps.ts` and the run lock in `mutation.sh`. May run next to 02–10, 12–17.

Part of [`../plan.md`](../plan.md). Method: plan.md § Stage method. Decisions P2, P3, D5–D10.

## Functions (audit counts at `4ce3f351`)

| File | Function | Through (exported) | Count |
| --- | --- | --- | --- |
| `digest/digest.ts` | `renderListed`, `sortItems`, `cutToLimit` (private) | `renderDigestWithBrief` | 13, 10, 7 |
| `digest/digest.ts` | `renderDigestWithBrief`, `renderDigestMinimal` | themselves | 6, 5 |
| `digest/digest.ts` | `briefOptions` (private) | `renderDigestWithBrief` (a digest with brief sections) | 5 |
| `digest/review.ts` | `renderListed` (private) | `renderReviewPage` | 6 |
| `digest/schedule.ts` | `dueDigestSlot` | itself | 5 |
| `digest/callback.ts` | `isReplyCallback` | itself | 6 |
| `digest/callback.ts` | `base64UrlToUuid` (private; `uuidToBase64Url` is private too) | `encodeCallback` and `parseCallback` round trip of a delegate pick callback | 6 |

Mutate globs: `src/digest/digest.ts`, `src/digest/review.ts`, `src/digest/schedule.ts`, `src/digest/callback.ts`.

## Cases (fixed values)

Use the item and facts builders of `digest/digest.test.ts`. Fixed clock `2026-03-02T07:00:00Z`, time zone `Europe/Warsaw`. Assert the whole message text or the exact line array.

Cases 1–3 and 6 go through `renderDigestWithBrief`; case 7 through `renderReviewPage`.

1. `sortItems`: three items received at 08:00, 09:00, 10:00 on one day → listed newest first; two items with the same time → the tie order the code has at `HEAD` (kills the `+` and the tie-branch mutants).
2. `renderListed` (digest): an empty list → no section; one item → the exact section; the item count over the shown limit → the "and N more" line with the exact N.
3. `cutToLimit`: a message exactly at `MESSAGE_MAX_CHARS` → unchanged; one character over → cut at the last whole line with the cut marker; the boundary of `end` (kills `end + 1`).
4. `renderDigestWithBrief`: a brief that makes the text exactly `MESSAGE_MAX_CHARS` → one message; one character more → the split the code does at `HEAD` (kills `<` vs `<=`).
5. `renderDigestMinimal`: `mailboxProblems` 0 → no problem line; 1 → the problem line (kills `>= 0`).
6. `briefOptions`: each branch once, asserting the exact options object.
7. `digest/review.ts` `renderListed`: an empty review list, one item, and the over-limit line; exact text.
8. `dueDigestSlot`: a slot key equal to the late key → the code's result at `HEAD`; one before and one after → due and not due (kills `>=`).
9. `isReplyCallback`: one callback of each family → `true` only for the reply family; a reply callback with a missing field → `false`.
10. `base64UrlToUuid` through `parseCallback`: `encodeCallback` of a delegate pick callback with email id `00000000-0000-4000-8000-000000000001` gives `dp:<22 chars>:<22 chars>`; `parseCallback` of it returns the same callback (round trip). Write the encoded string as a literal too. A part that the `dp:` pattern accepts but that does not encode back to itself (the round-trip check in `base64UrlToUuid`) → `parseCallback` returns `null`; use `kind: "delegate_pick"`.

## Done when

- `results/stage-11.md` meets D5 and D6 for every function in the table.
- Last step: `bun run check:job`.

## Out of scope

- The notice renderers (stage 12) and the text tables (stage 13).
