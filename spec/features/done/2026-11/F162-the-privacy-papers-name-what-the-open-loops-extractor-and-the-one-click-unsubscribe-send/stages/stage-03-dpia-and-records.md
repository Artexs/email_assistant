# F162 stage 03 — DPIA, records of processing and risk R10

Needs stage 01: rows C263–C266 in `docs/legal/claims.md`. Needs stage 02: `apps/server/src/legal-outside-calls.test.ts`. May run next to 04.
Part of [`../plan.md`](../plan.md). Lands on the proof (no review job).

## Step 1 — the DPIA draft

- **Goal:** `docs/legal/dpia.md` says what the extractor sends, the one-click request and report mail, and assesses the one-click risk.
- **Seams:**
  - "Description of the processing": Flow (one sentence group for the extractor, P3), Recipients (the newsletter server after an owner tap, not a sub-processor, P4), Modes (the report-mail exception, P9).
  - "Necessity and proportionality": Purposes (open loops, newsletters, P7); under "Is the data needed?" one bullet each for open loops (no header address, 14 days, 10 recipients, 8,000 characters, quoted mail of other people can go along, the stored answer of at most 80 characters goes 90 days after the loop closes), the one-click request (fixed body, the link as the newsletter wrote it, no repeat, the link is not kept) and report mail (no send, the member's chosen mailbox); "Less intrusive options" (P9).
  - "Risks", "Measures", "Residual risk": R10 (P10), in the form of R9. Measures: one owner tap per sender; only senders whose mail is all `info` or `notification` and not suspicious; the trusted `dkim=pass` and signed-header rule; https only, no redirect, no repeat; at most 20 requests per organization and 3 per sender domain per hour (`docs/capabilities/trust.md` rule 21).
- **Decisions:** P3, P4, P6, P7, P9, P10, D3, D5. The six `##` headings stay (test 3 of `legal-papers.test.ts`). If the R1 text lists what the provider gets, it names the extractor too.
- **Out of scope:** the in-app pages, the registries, `terms.ts` (stage 01 owns the version).

## Step 2 — records of processing and the ledger

- **Goal:** record B names the two purposes, report mail and the newsletter server as a recipient that is no sub-processor; the ledger covers the new DPIA text.
- **Seams:** `docs/legal/records-of-processing.md` record B "Purposes" and "Recipients" rows. The newsletter server goes in its own sentence that names no sub-processor id (test 2b reads the ids in that row). `docs/legal/claims.md`: change each DPIA or record B row whose text now differs (Purposes, Modes); add rows for R10 and its measures in "Later additions (F162)"; the count table and the row count pin in `apps/docs/src/security/claims.test.ts` follow (D1).
- **Decisions:** D1.

## Step 3 — the DPIA tie

- **Test** (add a `describe("dpia")` to `apps/server/src/legal-outside-calls.test.ts`; strings built from the constants, D3):
  10. `dpia.md` holds the en body-cap string, the en age string and `ONE_CLICK_BODY`.
  11. The DPIA has a row `R10` with two levels `medium` and `low` (the regex form of test 6 of `legal-papers.test.ts`), and a Measures row `R10`.
- **Break check:** change `14 days` in the DPIA open-loops bullet to `15 days` locally: case 10 fails; revert.
- **Check:** `bun test apps/server/src/legal-outside-calls.test.ts apps/server/src/legal-papers.test.ts apps/docs/src/security/claims.test.ts`.

## Done when

- The DPIA and record B name the extractor call, the one-click request and report mail; R10 has levels, measures and a residual line.
- Ticket Acceptance line 1 holds for every row this stage added or changed.
- The plan's Proof exits 0; the final message copies the `check:job` line.
