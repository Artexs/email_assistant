# F162 stage 01 — in-app texts, registries, legal version and ledger rows `[risky]`

Needs: nothing new; F153 (landed) wrote rows C261, C262 and the version `2026-11-20`.
Part of [`../plan.md`](../plan.md). Review: `claude-opus-5-5` before the land.

## Step 1 — the in-app texts (one legal version)

- **Goal:** every digest input says P3–P7 and P9, and one new legal version carries the change.
- **Seams:**
  - `apps/web/src/legal/{en,pl}/privacy.md`: "AI model" (P3, after the triage and reply-draft parts), "AI results" (the stored ask or promise), "Why and on what basis" (P7, and P6 in "Digests and notices"), "Who receives data" (new "Newsletter senders" bullet before "Mail provider", P4; P6 in "Mail provider"; the P4 clause in "Transfers outside the EEA"), "AI and decisions" and the shadow-mode sentences (P9).
  - `apps/web/src/legal/{en,pl}/dpa.md` "Nature and purpose": open loops, newsletters, and report mail in "Digests" (P6, P7); the shadow-mode sentence if the page has one (P9).
  - `apps/web/src/legal/{en,pl}/terms.md`: the shadow-mode sentence (P9).
  - `packages/core/src/legal/subprocessors.ts`: `openai` and `gemini` `purpose` adds "finds open loops in own sent mail"; `dataReceived` adds "for open loops: the subject, the local send time, the number of recipients and up to 8,000 characters of the text of own sent mail" (Polish: same facts, D3 forms).
  - `packages/core/src/legal/data-categories.ts`: `unsubscribe-data` (P5) and its comment.
  - `packages/core/src/web/terms.ts`: `TERMS_HISTORY` (D4).
- **Decisions:** P1, P3–P7, P9, D3, D4, D5. The pl and en pages keep the same `##` headings.
- **Interfaces:** the version string comes from `nextLegalVersion`; `legal-version.test.ts` prints the line to append. Per D4 the entry goes in with the first commit that changes a digest input, and each later commit re-digests it.
- **Out of scope:** `tg_consent_text` (it already names the open-loops data); the DPIA and record B other than the `unsubscribe-data` row (stage 03).

## Step 2 — ledger rows, the row count and the operator line

- **Goal:** each new claim has a row; changed claims have changed rows.
- **Seams:** `docs/legal/claims.md` (D1), the row count pin in `apps/docs/src/security/claims.test.ts` (262 → the new total), `docs/legal/records-of-processing.md` (only the `unsubscribe-data` subjects cell: `users, others`), `deploy/README.md` (D6).
- **New rows** (section "Later additions (F162)"; each ends with "Papers: …" like C261):
  - C263 — the extractor input (P3 fields; prompt `extractor-v1`). Source: `packages/core/src/loops/extractor.ts` (`extractorInputOf`), `apps/server/src/modules/triage/prompts/extractor-v1.ts` (`buildUserPrompt`). Condition: flag `open_loops`. Papers: privacy policy, registry, DPIA, security page.
  - C264 — which mail and how often (14 days, 10 recipients, the skip kinds, at most three tries for a failure of the mail, a later try when the service is busy, the stored answer of at most 80 characters). Source: `packages/core/src/loops/extractor.ts` (`sentSkipReason`), `apps/server/src/modules/loops/analyze.ts`, `docs/capabilities/open-loops.md` rule 2. Condition: flag `open_loops`.
  - C265 — the one-click request (P4). Source: `apps/server/src/platform/public-http.ts`, `docs/capabilities/trust.md` rule 21, `apps/server/src/platform/outside-services.ts`. Condition: flag `bulk_unsubscribe`.
  - C266 — report mail, also in shadow mode (P6, P9). Source: `docs/capabilities/trust.md` rule 19, `apps/server/src/modules/channels/report-mail-sender.ts`. Condition: flag `report_mail`.
- **Changed rows:** C136, C139 (AI rows), C174 (members and other people), the DPA purpose rows (C111–C135 range), each shadow-mode and "AI and decisions" row whose text now differs.

## Test

1. `bun test apps/web/src/lib/legal-version.test.ts` passes with the new last entry; before the entry it fails with the digest line (see it once).
2. `bun test apps/docs/src/security/claims.test.ts` passes with the new row count.
3. `bun test apps/server/src/legal-papers.test.ts` passes: ids in order, sources exist, the count table matches, `sevenDayLimitProblems` finds nothing in the pages.
4. `bun test apps/web/src/lib/legal-checks.test.ts apps/web/src/lib/legal-privacy.test.ts apps/web/src/lib/legal-terms-dpa.test.ts` pass (headings pair, placeholders).

The code ties are stage 02.

## Done when

- Ticket Acceptance lines 2, 3, 4 hold; line 1 holds for C263–C266.
- The plan's Proof (without `legal-outside-calls.test.ts`) exits 0; the final message copies the `check:job` line.
