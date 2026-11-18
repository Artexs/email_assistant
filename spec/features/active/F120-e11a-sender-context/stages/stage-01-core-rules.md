# F120 stage 01 — Core rules and key

Part of [`../plan.md`](../plan.md); names in [`../interfaces.md`](../interfaces.md).

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

- Goal: `suggestionsFor` and the types of interfaces.md § Core. Pure; no clock.
- Decisions: D10, PD-108, discovery §2.6.
  - VIP (address only): not bulk relation, not noreply, not own, not VIP, no suspicious mail; `answered30 ≥ 5` and `answered30 * 10 ≥ received30 * 6`, or `flagged30 ≥ 3`.
  - Whitelist: `rescued90 ≥ 2`; not whitelisted; not blocklisted (the user removes a block rule by hand); no suspicious mail.
  - Blocklist: only with `sentCoverage` (D16); `correctedToSpam90 ≥ 2`, `answered90 = 0`, `userMailsTo90 = 0`; relation not `known` or `delegate`; not VIP, not whitelisted, not blocklisted.
  - Whitelist and blocklist both true for one key → neither.
  - Domain: group inputs by `domain` with `isFreeMailDomain` false and `isOwnDomain` false; whitelist (or blocklist) when ≥ 2 distinct addresses of the domain meet the address rule and no address of the domain is protected. Protected for a domain blocklist: relation `known` or `delegate`, VIP, whitelisted, `answered90 > 0` or `userMailsTo90 > 0`. Protected for a domain whitelist: `suspicious90`, blocklisted. The domain candidate replaces the address candidates of the same kind on that domain. Never a domain VIP.
  - Skip a candidate whose `kind:scope:key` is in `dismissed` or `open`.
  - Cap: `3 - createdLast7Days` (not below 0). Order: whitelist, vip, blocklist; then the larger main count (whitelist: `rescued90`; vip: answered30, then flagged30; blocklist: correctedToSpam90); then `key` ascending.
  - Reason: counts only (`SuggestionReason`).
- Test (fixed inputs, names are fixture ids):
  1. VIP: received30 8, answered30 6 → vip with reason `{ received: 8, answered: 6 }`.
  2. VIP edge: received30 10, answered30 5 → none (50% < 60%); answered30 6 → vip.
  3. VIP by flags: flagged30 3, answered30 0 → vip `{ flagged: 3 }`.
  4. Same as 1 with relation `bulk`, or `isNoreply`, or `suspicious90`, or `isOwn` → none (four cases).
  5. Blocklist: correctedToSpam90 2, answered90 0, userMailsTo90 0, relation `new` → blocklist; with userMailsTo90 1 → none; with relation `delegate` → none.
  6. Conflict: correctedToSpam90 2 and rescued90 2 → no candidate.
  6a. Whitelist for a blocklisted sender (rescued90 3, `isBlocklisted`) → none.
  6b. Blocklist with `sentCoverage` false → none; VIP of test 1 still comes.
  7. Domain: `a@acme.pl` and `b@acme.pl` each meet blocklist → one domain candidate `@acme.pl`, no address candidates; `a@gmail.com` and `b@gmail.com` → two address candidates.
  7a. Same as 7 plus `jan@acme.pl` with relation `known` (no corrections) → no domain candidate; the two address candidates stay.
  7b. Same as 7 plus `jan@acme.pl` with `userMailsTo90 1`, relation `new` → no domain candidate.
  7c. Same as 7 with `isOwnDomain` true → no domain candidate (address candidates only).
  7d. Two senders of `beta.pl` meet whitelist, a third has `suspicious90` → no domain whitelist.
  8. Cap: 5 candidates, createdLast7Days 1 → 2 results, whitelist first.
  9. Dismissed `vip:address:<k>` → skipped; the next fills the slot.
  10. createdLast7Days 3 → none.
- Out of scope: DB, hashing (the caller passes `keyOf`).

## Done when

All tests pass; mutation checks: `≥ 2` → `> 2` in the blocklist rule fails test 5; dropping the protected check fails 7a. Then the Proof command of `plan.md`.
