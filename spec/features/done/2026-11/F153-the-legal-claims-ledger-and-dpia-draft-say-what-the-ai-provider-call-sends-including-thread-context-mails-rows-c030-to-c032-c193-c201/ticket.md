---
opened: 2026-11-20
landed: 2026-11-20
---

# F153 · the legal claims ledger and DPIA draft say what the AI provider call sends, including thread context mails (rows C030 to C032, C193, C201)

## Outcome

The legal papers, the claims ledger and the public security page say what the AI provider gets, and no text says that mail older than 7 days never reaches it. Today the privacy policy, the DPIA draft and ledger rows C032, C193 and C201 say so. But each classified mail takes up to three earlier mails of its thread along as context, with no age limit, and with the trust ladder on (off by default) a history check classifies up to 500 mails of the last 30 days. A buyer or auditor who reads the papers then sees the true flow.

## Scope

- The capability page of triage states what the classifier call sends; the ledger rows cite it.
- The DPIA draft and its rows C193 and C201; new ledger rows for the context mails and the history check.
- The privacy policy (English and Polish), the AI rows of the sub-processor registry and their ledger rows, with a new legal version.
- The public claim `ai-provider-receives`: the context sentence moves from "What this product does not promise" into the claim.
- One shared check that fails when a legal or public text names the 7-day limit without the thread context.

## Out of scope

- Any change of what the code sends (no age limit on context mails, no change of the history check).
- Turning the flag `trust_ladder` on.
- The reply-draft call (the privacy policy already names what it sends).
- A deploy of the docs site or a release of the server.

## Acceptance

- Ledger rows C031, C032, C193 and C201 state the thread context mails, and the 7-day rule only for the classified mail (C030 names only the provider and needs no change).
- A ledger row states sender, subject, date and up to 500 characters of the body of up to three context mails, with no age limit; a test ties the numbers to the production prompt.
- The privacy policy and the DPIA draft name the context mails and the history check, in both languages where the paper has two.
- The claim `ai-provider-receives` holds the context sentence and cites the new row; the "does not promise" section no longer holds it.
- `bun run docs:build` prints `claim_check ok`.
- The shared 7-day check fails on the old wording of C032 (test case with that exact text).

## Slices

Three stages, one worker job each: 01, then 02 and 03 in parallel. Detail and the user step: `plan.md` § How to run.

## Sequenced

Plan after: none.
Build after: none. Gate: none; stage 01 adds a legal version, which the coordinator names in the release notes (`plan.md` § User checkpoints and user steps).

## Notes

Found by the review of the public security page stage of the public pages work (F121 stage 02, 2026-11-20); its file `spec/features/active/F121-e10b-public-pages-and-demo/stage-02-open.md` holds the first fix proposal. The history-check sentence is the owner decision of 2026-11-18 in `docs/owner-decisions.md` ("F110 history check: the privacy page says no mail older than 7 days goes to the model").
