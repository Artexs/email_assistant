# F144 stage 01 — characterization test of today's sender activity read

Part of [`../plan.md`](../plan.md). Lands on the worker's proof.

Needs: nothing. Reads `readSenderActivity` (`apps/server/src/modules/contacts/activity.ts`) as it is at `HEAD`.
Writes for later stages: `apps/server/test/integration/contacts-activity-golden.test.ts`. Stages 02–06 keep it unchanged (plan rule).
May run next to anything: it adds one test file and changes no product code. F142 stage 01 also changes the `matchSender` and no-reply folds; the fixture is ASCII, so the literals hold (F142 01-T2). On a conflict, merge master and re-prove.

## Step 1 — the fixture and the golden output (D1)

- **Goal:** one test file that fails when any field, any row, any scope result or the statement count of the read changes.
- **Files:** the new test file. Use `seedSenderActivity` with explicit dates from `ago`; it writes `imap_move` feedback, `in_reply_to`, `parent_message_id` and automatic Sent mail. Delegations it does not write: insert them in the test with the delegation repository or Kysely in the rollback transaction. Do not change shared fixtures that other test files use.
- **Fixture (`NOW` and `ago` of `contacts-fixtures.ts`, one organization, one mailbox):**
  - `a@example.com`: 6 incoming mails over 60 days (2 in the last 30), 6 user Sent replies with `parent_message_id` set to each mail's Message-ID and delays of 2, 3, 4, 5, 6, 7 hours (median 4.5), 2 answered and 1 flagged flag, 1 unseen mail older than 7 days, categories `info` ×4 and `action` ×2, one feedback `wrong` → `spam`.
  - `b@example.com`: 5 incoming mails that each name one of 5 user Sent mails in `In-Reply-To` with delays of 1, 2, 3, 4, 5 hours (median 3); 2 user Sent mails to `b` in To or Cc; one feedback source `imap_move` on a mail with category `spam` (moved back and rescued); one result with suspicious reasons.
  - `news@example.com`: 3 mails with a `List-Id` header and one with `List-Unsubscribe`; one mail whose headers have `texts_cleared_at` set.
  - `noreply@example.com`: 2 mails (bulk by name).
  - `boss@example.com` as an active delegate with 2 delegations of the mailbox in the window, and one Sent mail to it.
  - `vip@sub.example.com` matched by a VIP sender rule; `x@example.org` as a look-alike that a domain scope must not return.
  - An own Sent alias (`me-alias@example.com` as Sent From) that also wrote one incoming mail, and a test-mail sender: both get no row.
  - One mail of `a` at 91 days (outside), one at exactly `NOW − 90 days` (inside), and one at 30 days + 1 h (outside the 30-day counts).
- **Interfaces:** none.
- **Test (numbered, in the file):**
  1. Full pass: `toEqual` on a literal array of every `SenderActivity` field of every row, sorted by address. Each field of `SenderActivity` is non-default for at least one row (write a short comment over the literal that names the row that covers each field).
  2. `only: { address: "a@example.com" }`: `toEqual` on the literal one-row array (delays and `delegationsTo` stay at their empty values, D9).
  3. `only: { domain: "example.com" }`: `toEqual` on the literal rows; `x@example.org` is absent.
  4. Statement count, counted with a `withPlugin` counter that increments in `transformResult` (executed statements; a `transformQuery` counter also counts each embedded builder, plan D3, review B1): full pass equals the literal `HEAD` count; each scope equals its literal `HEAD` count.
  5. Tenant: a second organization with the same addresses and twice the mail; test 1 still gives the same literal, and the read with org A's `ctx` and org B's mailbox id returns `[]` (plan rule form).
- **How to write the literals:** run the read at `HEAD`, read the output, and check each value against the fixture by hand before you paste it. A value that does not follow from the fixture is a question in your final message (a bug of today's read is not fixed here).
- **Check:** `bun test apps/server/test/integration/contacts-activity-golden.test.ts` passes.
- **Guard check:** remove the `emails.org_id` filter of the window in `activity.ts`, see test 5 fail, restore. Change `since30` to 31 days, see test 1 fail, restore. Commit no such change.
- **Done when:** the five tests pass at `HEAD` and the Proof prints `PROOF_OK`.
- **Out of scope:** any product code change; any edit of existing test files.
