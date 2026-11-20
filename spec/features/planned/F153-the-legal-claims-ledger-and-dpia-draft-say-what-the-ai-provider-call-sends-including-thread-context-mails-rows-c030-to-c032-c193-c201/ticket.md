---
opened: 2026-11-20
---

# F153 · the legal claims ledger and DPIA draft say what the AI provider call sends, including thread context mails (rows C030 to C032, C193, C201)

## Outcome

the legal claims ledger and DPIA draft say what the AI provider call sends, including thread context mails (rows C030 to C032, C193, C201).

<!-- Two to four sentences: what becomes true for a user or operator. -->

## Scope

- <!-- Boundary and starting seam, not an edit list. -->

## Out of scope

- <!-- Nearby work that is not part of this ticket. -->

## Acceptance

- <!-- One observable result or check per line. -->

## Notes

<!-- Optional decisions or open questions; no progress log. -->

## Context

Found by the Opus review of F121 stage 02 (2026-11-20). Ledger row C032 says the assistant does not send mail older than 7 days to the AI provider. This is false: the call also sends up to three earlier mails of the same thread as context (sender, subject, up to 500 characters of body), with no age limit (`listThreadContext` in `apps/server/src/modules/mail/repo/lookup.ts`). Rows C031, C193 and C201 (the DPIA draft) carry the same wording. Details and a proposed fix: `spec/features/active/F121-e10b-public-pages-and-demo/stage-02-open.md`.

## Done when

- `docs/legal/claims.md` rows C030–C032, C193 and C201 state the thread context mails and the 7-day rule for the classified mail only.
- The public security page claim `ai-provider-receives` moves the context sentence from "does not promise" into the claim, with its proof row.
- `bun run docs:build` prints `claim_check ok`.
