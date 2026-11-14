---
opened: 2026-11-13
---

# F107 · E7-T4 Papers and cost

## Outcome

A visitor of the panel reads a privacy policy, terms and a DPA in Polish and English, each marked "DRAFT, not legal advice", that describe the real setup and nothing else. An auditor finds a DPIA draft, records of processing, a breach procedure and a claims list with a source for each claim. The owner reads the cost per mailbox per month from pilot data. When a later ticket adds a table or an outside service, a test fails until the papers name it (privacy as a product feature, `spec/vision.md`).

## Scope

- Stage 2 row 13 of `docs/product/stage-2/05-execution-plan.md` §2.1; epic E07 notes §9–§11 (S6e, PD-049).
- The six legal pages and their links on the sign-in, setup and Account pages; the terms version bump.
- One sub-processor list and one data-category list that pages, papers and tests share (the E10b security page reads the same list, PD-101).
- The internal papers and the claims list; cost model v1 and ADR 0020.
- One VPS deploy and a read-only cost measurement on the pilot.

## Out of scope

- Legal review, real names or addresses, a price decision (P21).
- The security-and-data and pricing pages (E10b) and the docs site (E10a).
- Paper changes for later features (read Sent, mailbox OAuth, sender profiles): those tickets update the lists and texts ([plan.md](plan.md) D12).

## Acceptance

- Each of the six pages `/legal/<pl|en>/<privacy|terms|dpa>` opens without a session and starts with the draft line in its language.
- After the deploy, a member with the old terms version sees the terms dialog once.
- `docs/legal/claims.md` lists each claim of the papers with its source file.
- An integration test fails when a database table is in no data category.
- `docs/cost-model.md` shows the cost per mailbox per month at 50, 100 and 200 mails a day, and a unit test checks the table against the code.
- The full list is § Done when of [plan.md](plan.md) (8 checks).

## Slices

One worker job per stage, 01 → 08, in order; stage 07 is the coordinator's VPS stage ([plan.md](plan.md) § How to run). No migration and no lockfile change, so the ticket may build next to other tickets. No owner checkpoint stops the build.

## Sequenced

- Plan after: F106 (account data: delete, export, data requests; its stages exist).
- Build after: F106 in `spec/features/done/`.
- Gate: —

## Notes

Old segment file: `tasks/planned/s6e-papers-cost.md` (history). Master plan decisions P21, D18–D20, D27, D28: `tasks/active/s6-pre-sale.md`.
