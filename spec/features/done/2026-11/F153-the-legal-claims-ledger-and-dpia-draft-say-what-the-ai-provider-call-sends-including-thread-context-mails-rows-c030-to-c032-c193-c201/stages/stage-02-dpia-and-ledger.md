# F153 stage 02 — DPIA draft, rows C193 and C201, capability pages, and the scan of `docs/legal`

Part of [`../plan.md`](../plan.md).

Needs stage 01: `sevenDayLimitProblems` (`@ea/core`), rows C031, C032, C261 and C262 in `docs/legal/claims.md`, the `describe("the 7-day limit")` block of `apps/server/src/legal-papers.test.ts`.
May run next to 03 (no shared file).

## Step 1 — the DPIA draft

- Files: `docs/legal/dpia.md`.
- Decisions: P1, P4, P5. Three places: the "Flow" bullet, the "Is the data needed?" bullet on the 7-day limit, and the R1 measure ("Only mail up to 7 days old … and a bounded context"). Each says: the 7-day limit is for the classified mail, with two exceptions (a one-off operator backfill, the optional history check); up to three context mails go along, each with sender, subject, date and up to 500 characters of body, with no age limit; with the trust ladder on (optional, off by default), a history check classifies up to 500 mails of the last 30 days (when the feature is turned on, at connect, on request, after a model change), capped at $0.25. Cite `docs/capabilities/triage.md` rule 3 and `docs/capabilities/trust.md` rule 8. R1 keeps its levels.
- Check: `bun test apps/server/src/legal-papers.test.ts` (headings, risk levels and paths still hold).

## Step 2 — rows C193 and C201, and the capability and architecture pages

- Files: `docs/legal/claims.md`, `docs/capabilities/triage.md`, `docs/capabilities/trust.md`, `docs/architecture.md`.
- Decisions: P1, D4. C193 and C201 quote the new DPIA sentences; their source adds `docs/capabilities/trust.md` rule 8 where the row names the history check. No row is added, so the counts table stays.
- `triage.md`: rule 3 names the content of P5 and "no age limit" (`listThreadContext`); the rule-list line "Mail older than 7 days is not sent to the LLM" names the classified mail and its two exceptions.
- `trust.md`: the "Privacy text" paragraph of its notes says point (2), the 7-day sentence, is done by this change; points (1), (3), (4) stay open (plan P8).
- `docs/architecture.md`: the after-an-outage line "Mail older than 7 days is stored but not sent to the LLM" names the classified mail and says the context mails can be older.

## Step 3 — the scan covers `docs/legal`

- Files: `apps/server/src/legal-papers.test.ts`.
- Decisions: D2.
- Test (in the stage 01 `describe`):
  1. Every line of each file of `docs/legal/*.md` (the `papers` list of the test) passes `sevenDayLimitProblems`.
  2. Rows C193 and C201 pass it (by id).
  3. `dpia.md` holds "history check", "30 days" and "500 characters".
- Check: `bun test apps/server/src/legal-papers.test.ts`. Put the old C201 text back by hand: cases 1 and 2 fail. Undo. Report both outputs.
- Done when: the cases pass on the new text and fail on the old one.

## Done when

The three steps' checks pass, and the Proof of `plan.md` prints `PROOF_OK` after the last commit.

## Out of scope

The privacy policy, the registry and `TERMS_HISTORY` (stage 01; `dpia.md`, `claims.md` and the capability pages are not in the legal digest, so this stage needs no new version); the public claim (stage 03); ADR texts.
