---
opened: 2026-11-19
---

# F142 · Loops, delegation and the send limit compare addresses with the one address rule, and a scan test keeps it so

## Outcome

Loops, delegation and the send limit compare addresses with the one address rule, and a scan test keeps it so. Today the open loops, the delegate list and the per-recipient send limit each fold addresses their own way. So a reply from a Greek or Turkish address, or a padded one, can leave a loop open and chased, though the user already has the reply. The sender profile and the data request match already use the one rule. After this ticket every compare in these three areas gives the same answer as the sender profile, and a scan test fails when a private fold comes back.

## Scope

- The one rule gets one name in `@ea/core` (`normalizeAddress`) and its SQL form moves to the platform DB layer, so the delegation module can use it.
- The send limit and the sender rule patterns use the one rule.
- The delegation module: add a delegate, refuse a mailbox address, refuse a duplicate, and find the delegate of a reply.
- The loops module and the core loop rules: loop creation, own addresses and aliases, the reply read, and the close match.
- One scan test over these files fails on a private lower-case fold of an address.

## Out of scope

- The other private folds that the scouts found: reply drafts, outgoing sender checks, triage payloads, mail sync, test mail, login emails (`scouts.md`, scout 1 § 5). The coordinator can open a follow-up ticket.
- A migration: no stored column, index or CHECK changes; old rows stay as they are.
- The split of the delegation repository into one file per aggregate (F143) and the split of the sender activity read (F144).

## Acceptance

- `normalizeSenderAddress` and `normalizeSenderPattern` no longer exist; `normalizeAddress` is the one export of the rule (typecheck).
- A send to `ΝΊΚΟΣ@example.gr` and five recent sends to `νίκος@example.gr` hold the sixth send with `recipient_day` (unit test).
- A delegate add of `İlker@Example.com` stores `ilker@example.com`, and a second add of `ilker@example.com` gives `exists` (integration test).
- A loop to `ΝΊΚΟΣ@example.gr` closes on a reply outside the thread from `νίκος@example.gr` with the loop subject (integration test).
- `bun test apps/server/src/address-rule-scan.test.ts` passes at the last stage, and fails when a `.toLowerCase()` of an address or an SQL `lower(` goes back into a scanned file (plan.md § Done when, 6 items).

## Slices

Five stages, one worker each. Stage 01 first; then 02, 03 and 04 in parallel; then 05. No migration, no `bun.lock` change. Stage 03 is `[risky]` and gets a review. Detail: `plan.md` § How to run.

## Sequenced

Plan after: none.
Build after: none. Overlap: the delegation repository split (F143) and the sender activity split (F144) touch files of stages 01 and 02; whichever lands second merges master and re-proves.

## Notes

Source: `spec/quality/2026-11-20-pass-2.md` finding 2. Scout packets: `scouts.md`.
