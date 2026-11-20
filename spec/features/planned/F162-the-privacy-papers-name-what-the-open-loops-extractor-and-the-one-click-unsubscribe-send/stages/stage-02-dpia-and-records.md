# F162 stage 02 — DPIA, records of processing and capability pages

Needs stage 01: ledger rows C263–C266 in `docs/legal/claims.md` and `apps/server/src/legal-outside-calls.test.ts`. May run next to 03.
Part of [`../plan.md`](../plan.md). Lands on the proof (no review job).

## Step 1 — the DPIA draft

- **Goal:** `docs/legal/dpia.md` says what the extractor sends, the one-click request and the report mail.
- **Seams:** "Description of the processing" (Flow: one sentence group for the extractor, P3; Recipients: the newsletter server after an owner tap, not a sub-processor, P4); "Necessity and proportionality" (Purposes: add open loops and newsletters, P7; a bullet "Open loops" under "Is the data needed?": no header address, 14 days, 10 recipients, 8,000 characters, the quoted text of other people can go along, the stored answer is at most 80 characters and is cleared 90 days after the loop closes; a bullet for the one-click request: fixed body, no mailbox data, no repeat, the link is not kept; a bullet for report mail: no send, the member's chosen mailbox).
- **Decisions:** P3, P4, P6, P7, D3, D5, D7. The six `##` headings and the eight risk rows stay (test 3 and test 6 of `legal-papers.test.ts`). If a risk row text lists the inputs of the AI provider, it names the extractor; no new risk row.
- **Out of scope:** the privacy pages, the registries, `terms.ts` (stage 01 owns the version).

## Step 2 — records of processing and the ledger

- **Goal:** record B names the two purposes and the newsletter server as a recipient that is no sub-processor; the ledger covers the DPIA text.
- **Seams:** `docs/legal/records-of-processing.md` record B "Purposes" row and "Recipients" row (the recipient goes after the part that test 2b reads, or in its own sentence that names no sub-processor id; check that test 2b still passes). `docs/legal/claims.md`: rows C263–C266 already say "Papers: … DPIA"; change a DPIA-section row only where its text now differs (for example the purposes row of the DPIA or of record B). A new claim that no row covers gets a row in "Later additions (F162)" and the count table follows.
- **Decisions:** D1, D7.

## Step 3 — capability pages and DPIA ties

- **Goal:** the behaviour pages point to the papers, and the DPIA numbers are tied to code.
- **Seams:** `docs/capabilities/open-loops.md` rule 2: one sentence that lists the fields the extractor call sends (P3) and names the privacy page; `docs/capabilities/trust.md` rule 21: "The privacy page names this request (F162)"; rule 19: the same for report mail; `docs/capabilities/papers.md` rule 9 (Seams): add F162 to the list. Set the "Checked against" line of each changed page.
- **Test** (add to `apps/server/src/legal-outside-calls.test.ts`):
  10. `dpia.md` holds `${EXTRACT_BODY_MAX.toLocaleString("en-US")} characters` (`8,000 characters`), `${SENT_MAX_AGE_DAYS} days` and `List-Unsubscribe=One-Click`.
  11. `sevenDayLimitProblems` over each line of `docs/legal/dpia.md` returns `[]` (already in `legal-papers.test.ts`; confirm it still passes, no new case).
- **Break check:** change `14 days` in the DPIA extractor bullet to `15 days` locally: case 10 fails; revert.
- **Check:** `bun test apps/server/src/legal-outside-calls.test.ts apps/server/src/legal-papers.test.ts`, then the plan's Proof.

## Done when

- The DPIA and record B name the extractor call, the one-click request and the report mail; ticket Acceptance line 1 holds for every row this stage changed.
- The plan's Proof exits 0; the final message copies the `check:job` line.
