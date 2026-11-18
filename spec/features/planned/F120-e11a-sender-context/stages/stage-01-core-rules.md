# F120 stage 01 — Core rules and key

Part of [`../plan.md`](../plan.md). Names: [`../interfaces.md`](../interfaces.md).

Carry-over reads: `packages/core/src/triage/sender-history.ts` (`SenderHistory`, `relationOf`, `bulkSignals`), `packages/core/src/triage/suspicious.ts` (`freeMailDomains`, `registrableDomain`), `apps/server/src/platform/crypto.ts` (`dsrAddressHash`), discovery notes §2.5–§2.6.

## Step 1 — the key

- Goal: `senderKeyHash` (D3).
- Files: `apps/server/src/platform/crypto.ts` and its test.
- Decisions: D3. Info string `ea/sender-profile/v1`; message `<orgId>:<value>`; hex output. Throws `CryptoError` on a bad key, as `dsrAddressHash`.
- Test:
  1. Same key, org `o1`, `a@x.pl` twice → equal.
  2. Org `o1` vs `o2`, same address → different.
  3. `senderKeyHash(k, o1, "a@x.pl") !== dsrAddressHash(k, "a@x.pl")` (different info).
  4. A key of 31 bytes → throws.
  5. Output matches `/^[0-9a-f]{64}$/`.

## Step 2 — wait math

- Goal: `contactWaitDays`, `usualReplyDays` (D12) in `packages/core/src/contacts/` (new folder, exported from the core index).
- Test (`contactWaitDays(hours, samples)`):
  1. (20, 5) → 2. 2. (5, 5) → 1. 3. (100, 5) → 7. 4. (200, 9) → 7. 5. (20, 4) → null. 6. (null, 7) → null. 7. (0, 5) → 1.
  - `usualReplyDays`: 30 → 1; 10 → 1; 47 → 2; 60 → 3 (round half up: 2.5 → 3).

## Step 3 — suggestion rules

- Goal: `suggestionsFor` and the types of interfaces.md § Core. Pure; no clock inside (the caller passes counts).
- Decisions: D10, PD-108, discovery §2.6 table.
  - VIP (address only): not bulk relation, not noreply, not own, not VIP, no suspicious mail; `answered30 ≥ 5` and `answered30 * 10 ≥ received30 * 6`, or `flagged30 ≥ 3`.
  - Whitelist: `movedBack… + correctedAway… ≥ 2` (count of distinct mails is the caller's); not whitelisted; no suspicious mail.
  - Blocklist: `correctedToSpam90 ≥ 2`, `answered90 = 0`, `userMailsTo90 = 0`; relation not `known` or `delegate`; not VIP, not whitelisted, not blocklisted.
  - Whitelist and blocklist both true for one key → neither.
  - Domain: group inputs by `domain` with `isFreeMailDomain` false; whitelist (or blocklist) when ≥ 2 distinct addresses of the domain meet the address rule; the domain candidate replaces those address candidates of the same kind. Never a domain VIP.
  - Skip a candidate whose `kind:scope:key` is in `dismissed` or `open`.
  - Cap: `3 - createdLast7Days` (not below 0). Order: whitelist, vip, blocklist; then the larger main count (whitelist: moved+corrected; vip: answered30, then flagged30; blocklist: correctedToSpam90); then `key` ascending.
  - Reason: counts only (`SuggestionReason`).
- Test (fixed inputs, names are fixture ids):
  1. VIP: received30 8, answered30 6 → vip with reason `{ received: 8, answered: 6 }`.
  2. VIP edge: received30 10, answered30 5 → none (50% < 60%); answered30 6 → vip.
  3. VIP by flags: flagged30 3, answered30 0 → vip `{ flagged: 3 }`.
  4. VIP blocked: same as 1 with relation `bulk` → none; with `isNoreply` → none; with `suspicious90` → none; with `isOwn` → none.
  5. Blocklist: correctedToSpam90 2, answered90 0, userMailsTo90 0, relation `new` → blocklist; with userMailsTo90 1 → none; with relation `delegate` → none.
  6. Conflict: correctedToSpam90 2 and correctedAway 2 → no candidate.
  7. Domain: `a@acme.pl` and `b@acme.pl` each meet blocklist → one domain candidate `@acme.pl`, no address candidates; `a@gmail.com` and `b@gmail.com` → two address candidates.
  8. Cap: 5 candidates, createdLast7Days 1 → 2 results, whitelist first.
  9. Dismissed key `vip:address:<k>` → skipped; the next one fills the slot.
  10. createdLast7Days 3 → empty.
- Check: `bun test packages/core/src/contacts`.
- Out of scope: DB, hashing of domains (the caller passes `keyOf`).

## Done when

Tests 1–5, 1–7, 1–10 pass; mutation check: change `≥ 2` to `> 2` in the blocklist rule → test 5 fails. Then the Proof command of `plan.md`.
