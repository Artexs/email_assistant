# F142 stage 04 — loop creation, the delegate button and the chaser rows use the one rule

Part of [`../plan.md`](../plan.md). Lands on the worker's proof.

Needs stage 01: `normalizeAddress`, `storedAddressForm` (`@ea/core`); `normalizedAddress` (`apps/server/src/platform/db`).
May run next to 02 and 03: it changes the loops files that stage 03 does not touch (`loops/analyze*.ts`, `loops/analysis-repo.ts`, `loops/delegate.ts`, `loops/due-rows.ts`, the rest of `loops/`) and `packages/core/src/loops/extractor.ts`, plus their tests. It edits no capability page (stage 05 writes the line).

## Step 1 — the Sent analysis (D5, D8)

- **Goal:** a loop made from a Sent mail links the right delegate and stores a deliverable counterpart (`storedAddressForm`, plan D5); the promise and wait rules compare by the rule.
- **Files and interfaces:**
  - `packages/core/src/loops/extractor.ts` (`sentSkipReason`): the own set and the recipients go through `normalizeAddress`. The `Auto-Submitted` fold is not an address: marker `// not an address: <reason>` (plan D9).
  - `loops/analyze.ts`: the mailbox env holds `ownAddresses` and `delegates[].email` as stored; compares fold them.
  - `loops/analyze-write.ts` (`askOf` and the promise counterpart): the delegate match compares `normalizeAddress` forms; the counterpart is `storedAddressForm` of the matched or first To (else first Cc) address, as today.
  - `loops/analyze-rules.ts`: `lowerAll` is deleted (callers map `normalizeAddress`). `promisesTo` compares `normalizedAddress("counterpart") in (…)`. The wait restart compares rule forms of the loop's To and Cc with the new mail's recipients.
- **Test** (core unit `packages/core/src/loops/extractor.test.ts`; integration: the loops analysis tests in `apps/server/test/integration/`; fixed clock):
  - 04-T1 guard (unit): `ownAddresses: ["Boss@Example.com"]`, to `[" boss@example.com"]`, cc `[]` → `"own_only"`. The base code does not give `own_only` (no trim).
  - 04-T2 guard (int): a delegate added as `İlker@Example.com`; a Sent ask to `ilker@example.com` → a `delegated` loop linked to that delegate, counterpart `ilker@example.com`. The base code makes a `waiting` loop.
  - 04-T3 pin (int): a Sent ask to `Ann@Example.com` → counterpart `ann@example.com`; to `ΝΊΚΟΣ@example.gr` → counterpart `νίκος@example.gr` (stored form, not the rule form).
  - 04-T4 guard (int): an open `promised` loop with counterpart `νίκος@example.gr`, wait from `2026-11-02T09:00:00Z`; a Sent mail on `2026-11-03` to `νίκοσ@example.gr` closes it with `later_reply`. Revert `promisesTo` to `lower(counterpart)`: it stays open.
  - 04-T5 guard (int): an open `waiting` loop to `νίκος@example.gr` in thread T; a later Sent mail in T to ` ΝΊΚΟΣ@example.gr` restarts the wait. The base code does not (no trim).
- **Done when:** 04-T1 to 04-T5 pass.

## Step 2 — the delegate button and the chaser rows (D8)

- **Files and interfaces:**
  - `loops/delegate.ts` (`delegable`): the sender and each mailbox address compare by `normalizeAddress`.
  - `loops/due-rows.ts` (`loopDueRows`): the test-sender filter is `normalizedAddress("l.counterpart") in (…)` with the senders mapped by `normalizeAddress`.
  - `loops/analysis-repo.ts`: the test-only sender filter is `normalizedAddress("s.from_address") in (…)` with mapped senders. The `lower(s.message_id)` match is a message id, not an address: it keeps its form with the marker (plan D9 bans `ilike` too).
- **Test:**
  - 04-T6 guard (int): mailbox address `İlker@Example.com`; a mail from `ilker@example.com` is not delegable. The base code says delegable.
  - 04-T7 guard (int): test-mail sender `İlker@Example.com`; a loop with counterpart `ilker@example.com` is a test row in `loopDueRows`. The base code says not.
- **Done when:** 04-T6 and 04-T7 pass.

## Step 3 — sweep

Grep `toLowerCase`, `toLocaleLowerCase`, `lower(`, `upper(` and `ilike` in the non-test files of `apps/server/src/modules/loops/` (except `reply-read.ts` and `match.ts`, stage 03) and `packages/core/src/loops/` (except `replies.ts`). An address fold moves to the rule (compare) or to `storedAddressForm` (write). A text fold (for example the eval text normalizer) gets the marker with its reason.

## Out of scope

`reply-read.ts`, `match.ts`, `packages/core/src/loops/replies.ts` (stage 03). Delegation module (stage 02). Capability pages.

## Done when

Steps 1–3 done, then the Proof of `plan.md` with `NN=04` prints `PROOF_OK`. The result lists each guard removal and its failing test.
