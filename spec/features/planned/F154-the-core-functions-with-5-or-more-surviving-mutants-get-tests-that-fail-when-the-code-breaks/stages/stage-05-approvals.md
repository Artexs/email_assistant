# F154 stage 05 — approval cards and approval texts

Needs stage 01: `scripts/test-audit/mutation-gaps.ts` and the run lock in `mutation.sh`. May run next to 02–04, 06–17.

Part of [`../plan.md`](../plan.md). Method: plan.md § Stage method. Decisions P2, P3, D5–D10.

## Functions (audit counts at `4ce3f351`)

| File | Function | Count |
| --- | --- | --- |
| `digest/approvals.ts` | `renderApprovalRequest` | 29 (top 10) |
| `digest/approvals.ts` | `chatQuoteText` (private), `replyRecipientLines` (private) | 11, 10 |
| `digest/approvals.ts` | `renderApprovalSetRequest` | 6 |
| `texts/approvals.ts` | `tries`, `softCap`, `contentSoft`, `rejected` | 9, 9, 8, 6 |

At `HEAD` the approval texts are split into `texts/approvals-en.ts` and `texts/approvals-pl.ts` (D9): the four text functions now exist once per locale. Measure and cover both locale files.

Mutate globs: `src/digest/approvals.ts`, `src/texts/approvals.ts`, `src/texts/approvals-en.ts`, `src/texts/approvals-pl.ts`.

## Cases (fixed values)

Use the view builders of `digest/approvals.test.ts` and `approvals-follow-up.test.ts`. Assert the whole `text` of the rendered message with `toBe` (or the exact line array), not a fragment.

`renderApprovalRequest`, one case per branch, each with one fixed view (`now` = `2026-03-02T09:00:00Z`, `timeZone` = `Europe/Warsaw`), English texts unless the row says Polish:
1. Title per kind: `delegation` with recipient name, `delegation` with name `null`, `clarification`, `reminder`, `reply`, `follow_up`. Each asserts the exact first line.
2. The inactive recipient marker: name set and `recipientInactive: true` → the title holds `<name> <inactive text> <address>`.
3. `synthetic: true` → first line ends with ` · <common.test text>`.
4. Version line: `version` 1 → no version line; `version` 2 → the version line is the second line.
5. Sender line: `sender: null` → no From line; `external: false` → `From: <label>`; `external: true` → `From: <label> · <externalSender text>`; the stored English unknown-sender label renders as the Polish placeholder with Polish texts.
6. `dueDate` set → the due line; `null` → none. `followUpNumber` set on a follow-up → the number line.
7. Reply gaps: a reply view with `gaps: ["termin", "kwota"]` → the line `fill("termin; kwota")` right after the head and an empty line; `gaps: []` → no fill line.
8. Body cut and quote flags: a body over the limit → the `bodyCut` line; a quote with a link → `linksHidden`; a quote over the limit → `quoteCut`.

`chatQuoteText` (through the card's quote):
9. A quote whose header has a sender line `Od: Jan <jan@firma.pl>` and whose body has `www.firma.pl` and `jan@firma.pl` → the header keeps the bare address, the body shows neither the domain nor the address, `replaced` shows as the `linksHidden` line. A quote with no `\n\n` treats every line as header.

`replyRecipientLines`:
10. To, Cc and a Reply-To that differs from From → one line each in that order; a Reply-To equal to From → no Reply-To line; a recipient list that cannot fit one message → `RangeError` with the message `"the recipients of a reply do not fit a card"`.

`renderApprovalSetRequest`:
11. One case per surviving mutant cluster (the set title and its count line), with the exact text.

Text functions (both locales, `test.each` over `en` and `pl`):
12. `tries(1, "")`, `tries(3, "")`, `tries(3, "550")` → the exact strings at `HEAD` (code `""` means no code).
13. `contentSoft("")` (unknown) and `contentSoft("552")`; `softCap("452")`.
14. `rejected(null, "Faktura")` and `rejected("Anna", "Faktura")`.

A text whose current output reads wrong (a missing word, a wrong form) is a P3 question, not an expected value.

## Done when

- `results/stage-05.md` meets D5 and D6 for every function in the table (per locale file at `HEAD`).
- Last step: `bun run check:job`.

## Out of scope

- Any text change. Other approval renderers with fewer than 5 counted mutants.
