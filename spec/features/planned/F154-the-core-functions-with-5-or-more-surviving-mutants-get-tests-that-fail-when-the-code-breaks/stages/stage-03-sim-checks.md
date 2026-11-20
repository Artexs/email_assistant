# F154 stage 03 — sim text checks: spread, case, opening, word counts

Needs stage 01: `scripts/test-audit/mutation-gaps.ts` and the run lock in `mutation.sh`. May run next to 02, 04–17.

Part of [`../plan.md`](../plan.md). Method: plan.md § Stage method. Decisions P2, P3, D5–D10.

## Functions (audit counts at `4ce3f351`)

| File | Function | Count |
| --- | --- | --- |
| `sim/checks.ts` | `checkSpread` | 38 (top 10) |
| `sim/checks.ts` | `checkCase` | 24 (top 10) |
| `sim/checks.ts` | `openingOf` (private; through `checkBatch`) | 12 |
| `sim/checks.ts` | `wordCount` (private) | 5 |
| `sim/sent-checks.ts` | `wordCount`, `checkSentCase` | 5, 5 |
| `sim/draft-checks.ts` | `draftCodeChecks` | 9 |

Mutate globs: `src/sim/checks.ts`, `src/sim/sent-checks.ts`, `src/sim/draft-checks.ts`.

## Cases (fixed values)

Use the `slot()`, `text()` and `codes()` helpers of `sim/checks.test.ts`. The tolerances at `HEAD`: length 10 points, HTML 5, language 3 (constants in `sim/checks.ts`).

`checkSpread` (each asserts the exact issue array, `code` and `detail`):
1. Empty input, and texts whose ids match no slot, and texts all `dropped: true` → `[]`.
2. 10 pairs, all planned and written `short`, plain, one language → `[]`.
3. Length edge: 10 pairs, 9 written short and 1 medium against all planned short → actual 90/10/0, plan 100/0/0, difference 10 = tolerance → no `length_share`. With 8 short and 2 medium → `[{ code: "length_share", detail: "80/20/0|100/0/0" }]`.
4. HTML edge: 20 pairs; plan 1 HTML (5 %), written 2 HTML (10 %) → difference 5 → no issue; written 3 HTML (15 %) → `{ code: "html_share", detail: "15|5" }`.
5. Language: plan 50/50 `en`/`pl` over 10 pairs, written texts detected 6 `pl` and 4 `en` → `{ code: "lang_share", detail: "40/60|50/50" }` (langs sorted: `en`, `pl`). A text with an `unknown` language counts as its planned one: replace one wrong text with an unknown-language text → that pair does not move the share.
6. Order and joint issues: one input that breaks all three shares → the three issues in the order `length_share`, `html_share`, `lang_share`.

`checkCase`:
7. `text.id !== slot.id` → exactly `[{ id: slot.id, code: "slot_unknown" }]` and no other code.
8. `test.each` of one code per row, each with a slot and text that break only that rule, asserting `codes(...)` equals `[code]`: `html_missing`, `html_unexpected`, `text_part_unexpected`, `signature_missing`, `urgent_keyword`, `diacritics_missing` (4 diacritics fail, 5 pass), `attachment_not_named` (name in another case: `"Umowa.PDF"` in the body counts as named for `umowa.pdf`), `planted_missing` (empty `planted` and a planted string absent), `expected_points_missing`, `thread_count_mismatch`, `lang_mismatch`. Skip a row the current test file already has with an exact `toEqual`.
9. A clean case → `[]`.

`checkBatch` / `openingOf`:
10. Two texts whose bodies differ only in the first line and in whitespace and case after it → the second gets `opening_repeat`. A one-line body uses the whole body. A body whose rest is shorter than the opening length → no issue.

Word counts:
11. Through the public checks: a text of words separated by two spaces and a newline counts as the same word count as single spaces (kills the `/\s/` and `split` mutants in both files).

`checkSentCase`, `draftCodeChecks`: one case per surviving mutant cluster with the exact issue list; use the inputs of the existing test files.

## Done when

- `results/stage-03.md` meets D5 and D6 for every function in the table.
- Last step: `bun run check:job`.

## Out of scope

- Changes to the tolerances or the bucket limits.
