# F104 stage 12 — Data requests: sent mail that goes

Part of [`../plan.md`](../plan.md). **[risky]**: privacy, a delete of mail data (review before the land). Needs stage 11. Read D5, D18, Q11, `docs/capabilities/account-data.md`.

Added by refresh 1: F106 landed first, so this ticket adds the sent columns (E5 notes §4.1). Stage 01 registered them (a sent row loses the address). This stage applies F106 D9 ("the only party besides the organization's own mailboxes") to sent mail: such a mail goes, with a tombstone, so a later pass does not store it again.

## Step 1 — Find and erase [risky]

**Files.** `apps/server/src/modules/privacy/dsr-match.ts`, `apps/server/src/modules/privacy/erase.ts`, `apps/server/src/modules/privacy/dsr.ts`, `apps/server/src/scripts/org-dsr.ts`; new test `apps/server/test/integration/privacy-dsr-sent.test.ts`.

**Interfaces.**
- `DsrMatch.sentMails: { id: string; dedupKey: string }[]`: sent rows of the org where the person is in `to_addresses` or `cc_addresses` (or is `from_address`), and every other address of those three is an own mailbox address (the own list of `findMails`). `findMentions` takes the ids as a second exclusion list for `sent_emails` rows, so a mention never lists a sent mail that goes.
- `dsrIsEmpty` counts `sent_mails` (a person only in sent mail gets no "check the spelling" warning).
- The encrypted find report gets a `sent_mails` array: `id`, `mailbox_id`, `sent_at`, `from_address`, `to_addresses`, `cc_addresses`, `subject`, `body_text` (the access copy holds what the erase deletes).
- `DsrCounts.sent_mails`; the `dsr.find` and `dsr.erase` audit data gain `sent_mails` (a number).
- `org:dsr` prints `sent mails <n>` and `erased sent mails <n>`; never an address.

**Erase order** (inside the existing transaction):
1. After the `mailbox_folders` lock, lock the org's `mailbox_sent_sync` rows `FOR UPDATE`, ordered by mailbox id. The Sent pass writes under the same row lock (D5), so a chunk planned before the erase waits and then meets the tombstone.
2. Match (now with `sentMails`).
3. Tombstones for the dedup keys of the mails and the sent mails, in one call.
4. Delete the sent mails.
5. Kept sent rows in the mentions with `content = 'pending'` → `headers_only` (their text could name the person again).
6. Scrub (as before), the empty after-match check, the audit row.

**Test** (`NOW = 2026-11-20T10:00:00Z`; own mailboxes `boss@x.test` and `team@x.test`; the person `p@x.test`; sent rows by `insertSentEmails`):

1. Find: S1 from boss to p → a sent mail that goes; S2 from boss to p and `q@x.test` → a mention of `sent_emails.to_addresses`; S3 from boss, to team, cc p → goes. `sent_mails 2`.
2. Erase: S1 and S3 deleted, 2 tombstones more; S2 has `to {q@x.test}` and the subject scrubbed; S2 was `pending` → `headers_only`; a kept `stored` row stays `stored` with `[removed]` in its text.
3. Store S1 by a first pass of a fake (so its key is the real one), erase, turn the switch off and on, and pass again with S1 and a new mail to p → no row for S1; the new mail is stored (the F106 limit: erase again).
4. The audit row has `sent_mails 2` and no address; the CLI output has the count lines and no address; the find report holds S1 and S3 in `sent_mails`.
4b. A person only in sent mail: `dsrIsEmpty` is false; no spelling warning.
5. A transaction that holds the mailbox's state row lock makes the erase wait; after its release the erase finishes and the after-match is empty.
6. Org B's sent rows with p stay whole.
7. An own address is refused; no sent row changes.
8. The existing F106 find, erase and outbox suites pass (`sent_mails 0` where a case compares the counts).

## Step 2 — Docs

- `docs/capabilities/account-data.md`: the find rule for sent mail, the erase order (lock, tombstones, `headers_only`), and Limits lines: "Run `org:dsr --erase` again after the first pass of a newly turned on 'Track my sent mail', and after its text step: sent mail and text stored later can name the person." "A system send whose incoming mail an erase deleted reads as user mail after a new first pass (its action is gone)."
- `docs/capabilities/sent-mail.md`: a rule for data requests; refresh "Checked against".
- `docs/architecture.md` §7 Delete or DSR lines: sent mail joins the data requests.

**Test.** `apps/server/src/capability-map.test.ts` passes.

## Done when

Steps 1–2 done; the Proof passes (`/tmp/f104-s12`).
