# F142 stage 04 — loop creation, the delegate button and the chaser rows use the one rule

Part of [`../plan.md`](../plan.md). Lands on the worker's proof.

Needs stage 01: `normalizeAddress` (`@ea/core`), `normalizedAddress` (`apps/server/src/platform/db`).
May run next to 02 and 03: it changes the loops files that stage 03 does not touch (`loops/analyze*.ts`, `loops/analysis-repo.ts`, `loops/delegate.ts`, `loops/due-rows.ts`, the rest of `loops/`) and `packages/core/src/loops/extractor.ts`, plus their tests. It edits no capability page (stage 05 writes the line).

## Step 1 — the Sent analysis (D5, D8)

- **Goal:** a loop made from a Sent mail stores its counterpart in the rule form, links the right delegate, and the promise and wait rules find old and new rows alike.
- **Files and interfaces:**
  - `packages/core/src/loops/extractor.ts` (`sentSkipReason`): the own set and the recipients go through `normalizeAddress`. The `Auto-Submitted` fold is not an address: marker `// not an address: <reason>` (plan D9).
  - `loops/analyze.ts`: the mailbox env holds `ownAddresses` and `delegates[].email` in the rule form.
  - `loops/analyze-write.ts` (`askOf` and the promise counterpart): the To and Cc addresses go through `normalizeAddress`; the counterpart is stored in that form; the delegate match compares rule forms.
  - `loops/analyze-rules.ts`: `lowerAll` is deleted (callers map `normalizeAddress`). `promisesTo` compares `normalizedAddress("counterpart") in (…)`. The wait restart compares rule forms of the loop's To and Cc with the new mail's recipients.
- **Test** (core unit `packages/core/src/loops/extractor.test.ts`; integration: the loops analysis tests in `apps/server/test/integration/`; fixed clock):
  - 04-T1 (unit): `ownAddresses: ["Boss@Example.com"]`, to `[" boss@example.com"]`, cc `[]` → `"own_only"`. The old fold gives `null` (no trim); see it fail.
  - 04-T2 (int): delegate stored `νίκος@example.gr` (old form); a Sent ask to `ΝΊΚΟΣ@example.gr` → a `delegated` loop linked to that delegate, counterpart `νίκοσ@example.gr`.
  - 04-T3 (int): a Sent ask to `Ann@Example.com` → counterpart `ann@example.com`.
  - 04-T4 (int): an open `promised` loop with counterpart `νίκος@example.gr` (old form, wait from `2026-11-02T09:00:00Z`); a later Sent mail to `ΝΊΚΟΣ@example.gr` on `2026-11-03` closes it with `later_reply`. Revert `promisesTo` to `lower(counterpart)`: it stays open; the test fails.
  - 04-T5 (int): an open `waiting` loop to `νίκος@example.gr` in thread T; a later Sent mail in T to ` ΝΊΚΟΣ@example.gr` restarts the wait.
- **Done when:** 04-T1 to 04-T5 pass.

## Step 2 — the delegate button and the chaser rows (D8)

- **Files and interfaces:**
  - `loops/delegate.ts` (`delegable`): the sender and each mailbox address compare by `normalizeAddress`.
  - `loops/due-rows.ts` (`loopDueRows`): the test-sender filter is `normalizedAddress("l.counterpart") in (…)` with the senders mapped by `normalizeAddress`.
  - `loops/analysis-repo.ts`: the test-only sender filter is `normalizedAddress("s.from_address") in (…)` with mapped senders. The `lower(s.message_id)` match is a message id, not an address: write it as `s.message_id ilike …` or keep it with the marker.
- **Test:**
  - 04-T6 (int): a mail from ` BOSS@Example.com` when the mailbox address is `boss@example.com` is not delegable.
  - 04-T7 (int): test-mail sender `Test@Example.com`; a loop with counterpart `test@example.com` is a test row in `loopDueRows`.
- **Done when:** 04-T6 and 04-T7 pass.

## Step 3 — sweep

Grep `toLowerCase`, `toLocaleLowerCase` and SQL `lower(` in the non-test files of `apps/server/src/modules/loops/` (except `reply-read.ts` and `match.ts`, stage 03) and `packages/core/src/loops/` (except `replies.ts`). An address fold moves to the rule. A text fold (for example the eval text normalizer) gets the marker with its reason.

## Out of scope

`reply-read.ts`, `match.ts`, `packages/core/src/loops/replies.ts` (stage 03). Delegation module (stage 02). Capability pages.

## Done when

Steps 1–3 done, then the Proof of `plan.md` with `NN=04` prints `PROOF_OK`. The result lists each guard removal and its failing test.
