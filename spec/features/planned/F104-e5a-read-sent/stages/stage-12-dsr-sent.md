# F104 stage 12 — Data requests: sent mail that goes

Part of [`../plan.md`](../plan.md). **[risky]**: privacy and a delete of mail data (review before the land). Needs stage 11. Read D5, D18, Q11, and `docs/capabilities/account-data.md` (find and erase rules, Limits).

Added by refresh 1: F106 (account data) landed before this ticket, and the E5 rule says the ticket that lands second adds the sent columns. Stage 01 registered them, so a sent row loses the person's address in an erase. This stage applies F106 decision D9 ("the only party besides the organization's own mailboxes") to sent mail: such a sent mail goes, with a tombstone, so a later Sent pass does not store it again.

After this stage `org:dsr --find` counts the person's sent mails, and `org:dsr --erase` deletes them, tombstones them, and stops the text fetch of kept sent rows that named the person.

## Step 1 — Find and erase [risky]

**Files.** `privacy/dsr-match.ts`, `privacy/erase.ts`, `privacy/dsr.ts`, `scripts/org-dsr.ts`; tests in `privacy-dsr-find.test.ts`, `privacy-dsr-erase.test.ts` and a new `privacy-dsr-sent.test.ts`.

**Interfaces.**
- `DsrMatch.sentMails: { id: string; dedupKey: string }[]`: sent rows of the org where the person is in `to_addresses` or `cc_addresses` (or is `from_address`), and every other address of `from_address`, `to_addresses`, `cc_addresses` is an own mailbox address (the own list of `findMails`). Mentions never list a sent mail that goes.
- `DsrCounts.sent_mails`; the `dsr.find` and `dsr.erase` audit data gain `sent_mails` (flat number); the `auditEvents` comments name it.
- `org:dsr` prints `sent mails <n>` (find) and `erased sent mails <n>` (erase), next to the mail lines; never an address.

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
3. After the erase, turn the switch off and on, and run `syncSentHeaders` on a fake that holds S1 and a new mail to p → no row for S1; the new mail is stored (the F106 limit: erase again).
4. The audit row has `sent_mails 2` and no address; the CLI output has the two count lines and no address.
5. A transaction that holds the mailbox's state row lock makes the erase wait; after its release the erase finishes and the after-match is empty.
6. Org B's sent rows with p stay whole.
7. An own address is refused; no sent row changes.
8. The existing F106 find, erase and outbox suites pass (`sent_mails 0` where a case compares the counts).

## Step 2 — Docs

- `docs/capabilities/account-data.md`: the find rule for sent mail, the erase order (lock, tombstones, `headers_only`), and a Limits line: "Run `org:dsr --erase` again after the first pass of a newly turned on 'Track my sent mail', and after its text step: sent mail and text stored later can name the person."
- `docs/capabilities/sent-mail.md`: a rule for data requests; refresh "Checked against".
- `docs/architecture.md` §7 Delete or DSR lines: sent mail joins the data requests.

**Test.** `capability-map.test.ts` passes.

## Done when

Steps 1–2 done; the Proof passes (`/tmp/f104-s12`).
