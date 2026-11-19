# F120 stage 05 — Suggestion engine and commands [risky]

Part of [`../plan.md`](../plan.md). Decisions P3, D10, D11, PD-108. Names: interfaces.md § Contacts module.

Carry-over reads: stage 01 `suggestionsFor`, stage 03 pass, `apps/server/src/modules/config/rules.ts` (`addSenderRule`, results), `docs/capabilities/actions-and-undo.md` (audit pattern), discovery notes §2.6.

## Step 1 — the generator in the pass

- Goal: after the profile upsert, in the same transaction and only when `senderFlags().suggestions` is true (stage 03b), `refreshMailboxProfiles` also:
  1. marks `open` rows `withdrawn` (pattern null, `ended_at = now`) only when (D11) a sender rule of that kind covers the pattern (mailbox or org scope), a "never" condition of D10 is now true for the key (bulk, noreply, suspicious mail, VIP, whitelisted, blocklisted, known or delegate for a blocklist, lost Sent coverage for a blocklist), or a new domain row of the same kind covers the address. A count or ratio that drops below the rule does not withdraw (no flicker);
  2. marks `open` rows older than 30 days `expired`;
  3. builds `SuggestionInput` per address from the stage 03 read, plus the sender rules of the mailbox and the org and the own mailbox domains, and calls `suggestionsFor` with `dismissed` (last 90 days), `open`, `createdLast7Days` (any status) and `sentCoverage` (stage 03b);
  4. inserts the candidates as `open` with `pattern` (the address, or `@domain`) and `reason`.
- A whitelist of `@domain` or a VIP of `@domain` covers an address. A blocklist pattern covers it the same way.
- Test (`contacts-suggestions.test.ts`, with `seedSenderActivity`):
  1. Sender with 6 of 8 answered in 30 days → one `open` VIP row, `reason {received: 8, answered: 6}`.
  2. Second pass, same data → still one row (unique index, no duplicate, no error).
  3. User adds VIP `anna@acme.pl` by hand → next pass marks the row `withdrawn`, `pattern` null.
  4. 5 qualifying senders, empty week → 3 rows; next pass the same week → 0 new; pass 8 days later → up to 3 new.
  5. Dismissed 10 days ago → not suggested again; dismissed 91 days ago → suggested again.
  6. Flag `sender_suggestions` off → profiles written, no suggestion rows.
  7. Open row created 31 days ago → `expired`.
  8. VIP row open; the ratio drops to 50% next pass → still `open`; the sender turns `bulk` → `withdrawn`.
  9. Seeded open address blocklist rows for `a@acme.pl` and `b@acme.pl` (created 8 days ago); the pass makes the domain row `@acme.pl` → both address rows `withdrawn`.
  10. Sent sync switch off → no blocklist row; an open blocklist row → `withdrawn`.

## Step 2 — Accept and Dismiss

- `acceptSuggestion(deps, ctx, { id, actor, via })`, owner only (the route checks the role; the command trusts it). One transaction: lock the row `FOR UPDATE`; not found or another org → `not_found`; not `open` → `already`; call `addSenderRule(trx, ctx, { mailboxId: row.mailbox_id, pattern: row.pattern, kind: row.kind, actor, now })`: `added` or `exists` → status `accepted`, `ended_by = actor`, `pattern = null`, audit `suggestion.accepted`; `limit` → `rule_limit`, the row stays `open`; `mailbox_not_found` → `not_found`.
- `dismissSuggestion`: lock; `open` → `dismissed`, `pattern = null`, audit `suggestion.dismissed`; else `already`.
- Audit data: `mailbox_id`, `kind`, `scope`, `via`. Never the pattern or the key.
- Two taps at once (Accept and Dismiss): the row lock orders them; the second answers `already`; exactly one rule at most.
- Test:
  1. Accept VIP → a VIP rule with the pattern exists for the mailbox; row `accepted`; one `suggestion.accepted` audit row with no address in its data.
  2. Accept when the rule already exists → `accepted`, no second rule.
  3. Accept at the rule limit (seed `SENDER_RULE_LIMIT` rules) → `rule_limit`, row `open`, no audit row.
  4. Dismiss → `dismissed`; Accept after it → `already`, no rule.
  5. Race: Accept and Dismiss on two connections → one ends `accepted` or `dismissed`, the other `already`; rule count 0 or 1, matching the winner.
  6. Org B id → `not_found`.

## Done when

All tests pass; mutation: drop the `status = 'open'` check in Accept → test 4 fails. Then the Proof command.

## Carry-over from the stage 03b review (2026-11-18)
See `../review-3b.md` (Stage 05 lines): Sent coverage with a missing Sent folder; frozen profiles of auth_error and host_blocked mailboxes.

## Carry-over from the stage 04 review (2026-11-19)
FIRST COMMIT of this stage: the tests TG1 to TG3, the two comment fixes N10 and the docs line N5 from `../review-4.md`, each test with a saved mutation log.
