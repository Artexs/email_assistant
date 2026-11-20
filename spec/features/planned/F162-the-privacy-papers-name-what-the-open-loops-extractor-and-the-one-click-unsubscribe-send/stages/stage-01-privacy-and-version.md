# F162 stage 01 — privacy pages, registries, legal version and code ties `[risky]`

Needs: nothing new; F153 (landed) wrote rows C261, C262 and the version `2026-11-20`.
Part of [`../plan.md`](../plan.md). Review: `claude-opus-5-5` before the land.

## Step 1 — the in-app texts (one legal version)

- **Goal:** the privacy page (en and pl), the AI rows of the sub-processor registry and the data-category registry say P3–P7, and one new legal version carries the change.
- **Seams:** `apps/web/src/legal/{en,pl}/privacy.md`; `packages/core/src/legal/subprocessors.ts` (`openai` and `gemini` `dataReceived`: add "for open loops: subject, local send time, number of recipients and up to 8,000 characters of the text of own Sent mail", same meaning in Polish); `packages/core/src/legal/data-categories.ts` (`unsubscribe-data`, P5; fix its comment); `packages/core/src/web/terms.ts` (`TERMS_HISTORY`, D4).
- **Decisions:** P1, P3 (the "AI model" bullet gets one sentence group after the triage and reply-draft parts; "AI results" gets the stored ask or promise), P4 (new bullet "Newsletter senders" in "Who receives data", before "Mail provider"), P6 ("Digests and notices" purpose and "Mail provider" bullet), P7 (two purpose bullets), D3, D5. The pl and en pages keep the same `##` headings.
- **Interfaces:** the version string comes from `nextLegalVersion` at the last commit; `legal-version.test.ts` prints the line to append.
- **Out of scope:** the DPIA and records texts other than the one `unsubscribe-data` row (stage 02); the docs site (stage 03); any `tg_consent_text` change (it already names the open-loops data).

## Step 2 — ledger rows and the operator line

- **Goal:** each new claim has a row; changed claims have their rows changed.
- **Seams:** `docs/legal/claims.md` (D1: section "Later additions (F162)", rows C263–C266, count table rows and total; rows C136, C139 for the AI registry rows; row C174 says members and other people; any privacy-section row whose text now differs, for example a purposes row); `docs/legal/records-of-processing.md` (only the `unsubscribe-data` subjects cell: `users, others`); `deploy/README.md` (D6).
- **Decisions:** D1, D6. Each new row ends with "Papers: …" like C261 (C263, C264: privacy policy, registry, DPIA; C265, C266: privacy policy, DPIA).
- **Out of scope:** rows of the DPIA section (stage 02 checks them).

## Step 3 — code ties

- **Goal:** a change of the extractor input, the prompt pointer or the one-click request fails a test until the papers follow.
- **Files:** new `apps/server/src/legal-outside-calls.test.ts` (D2). Constants come from `@ea/core` (`EXTRACT_BODY_MAX`, `SENT_MAX_AGE_DAYS`, `SENT_MAX_RECIPIENTS`, `EXTRACT_TEXT_MAX`, `reportMailKinds`), `./modules/triage` (`prompts`), `./modules/loops` (`MAX_ATTEMPTS`; add the export to the loops index if missing), `./platform/public-http` (`ONE_CLICK_BODY`, `ONE_CLICK_USER_AGENT`).
- **Test** (numbered; exact strings of D3):
  1. Fixed values: `EXTRACT_BODY_MAX` 8000, `SENT_MAX_AGE_DAYS` 14, `SENT_MAX_RECIPIENTS` 10, `EXTRACT_TEXT_MAX` 80, `MAX_ATTEMPTS` 3, `prompts.extractor.version` `extractor-v1`, `ONE_CLICK_BODY` `List-Unsubscribe=One-Click`, `reportMailKinds` length 4. A change here is the signal to re-check the papers (say so in the test name).
  2. `test.each` over en and pl privacy pages: each holds the body cap, the age limit and the recipient limit in its D3 form (`8,000 characters` / `8000 znaków`, `14 days` / `14 dni`, `10 recipients` / `10 adresatów`).
  3. `test.each` over en and pl: each holds `List-Unsubscribe=One-Click`.
  4. Row C263 holds `8,000 characters`, `extractor-v1` and the word `extractorInputOf` in its source; row C264 holds `14 days`, `10 recipients` and `three`.
  5. Row C265 holds `ONE_CLICK_BODY` and `ONE_CLICK_USER_AGENT` as text.
  6. The `openai` and `gemini` `dataReceived` en texts hold `8,000 characters`; pl texts `8000 znaków`.
  7. `unsubscribe-data` subjects equal `["users", "others"]` (in `data-categories.test.ts` if it has a subjects table, else here).
  8. `sevenDayLimitProblems` over both privacy pages returns `[]` (exists in `legal-papers.test.ts`: confirm it still passes; no new case).
  9. `deploy/README.md` does not contain `does not yet name the one-click request`.
- **Break check:** set `EXTRACT_BODY_MAX` to 7999 locally: cases 1, 2, 4, 6 fail; revert.
- **Check:** `bun test apps/server/src/legal-outside-calls.test.ts`, then the plan's Proof.

## Done when

- Ticket Acceptance lines 2, 3, 4 hold; line 1 holds for C263–C266.
- `legal-version.test.ts` passes with the new last entry.
- The plan's Proof exits 0; the final message copies the `check:job` line.
