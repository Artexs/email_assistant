# F104 stage 06 — Job wiring, GreenMail proof, ADR and docs

Part of [`../plan.md`](../plan.md). Review before the land (the pass joins the live sync loop). Needs stage 05. Read D3, D8, D9, D16.

After this stage each `mail.sync` run reads Sent for every mailbox with the flag and the switch on, on the same IMAP connection, and a Sent error never fails the INBOX sync.

## Step 1 — GreenMail proof

**Goal.** Prove D3 on a real IMAP server.

**Files.** `apps/server/test/integration/imap-sent-greenmail.test.ts` (new), in the form of `apps/server/test/integration/imap-sync-greenmail.test.ts` (random address, `withRollback`, connect through `connectMailbox`).

Setup: `folder_map.sent = "Sent"`; `appendRaw` two mails dated now − 1 h into `Sent`: raw1 with `inReplyTo` and no flags, raw2 with a text and `\Seen`; flag and switch on. Read `before` = `folderStatus("Sent")` and `fetchFlagsIn` of both UIDs; run `syncSentFolder` with `sentOriginOf: async () => null`; read `after`.

**Test.**

1. `done`, `stored 2`, `texts.stored 2`.
2. `after` flags equal `before` per UID: raw1 without `\Seen`, raw2 with it.
3. UIDVALIDITY, `uidNext` and the highest UID unchanged.
4. The rows hold raw1's parent id and raw2's text.

If case 2 fails, stop and report (N1); do not change the test.

## Step 2 — The job calls the pass

**Files.** `apps/server/src/modules/mail/jobs.ts`, `apps/server/src/main.ts`, `apps/server/test/integration/mail-jobs.test.ts`.

**Interfaces.** `MailSyncJobDeps` gains `sentOriginOf: SentSyncDeps["sentOriginOf"]`; `apps/server/src/main.ts` wires it next to `isOwnActionId` from `actions`; every other creator of the job deps passes it too.

`syncOne` calls a private `runSentPass(deps, ctx, mailboxId, provider)` after `markSynced`, before `provider.close()` (order to the flag refresh block is free). `runSentPass`:
- calls `syncSentFolder` with the job's provider (as a `SentFolderReader`);
- `flag_off` or `off` → no line;
- else `log.info("sent_sync_done", { mailbox_id, status, kind: mode, count: stored })`, and `sent_texts_done { mailbox_id, count }` when texts changed;
- any error → `log.warn("sent_sync_failed", { mailbox_id, ...errorFields(error) })`, then `markSentPass(failed)` in its own try (its failure → `sent_sync_mark_failed`). A `MailAuthError` is only logged; the next INBOX sync sets `auth_error`.

No new log field names.

**Test** (the job with a fake through `openProvider`):

1. One INBOX mail and one Sent mail → the first in `emails`, the second in `sent_emails`; `last_synced_at` set.
2. Flag off → no sent row, no `"Sent"` entry in `folderCalls`.
3. `sentOriginOf` throws `HardError` for a Sent mail with an action id → the INBOX mail is stored, `last_synced_at` set, `last_error_code "failed"`, one `console.error` call holds `sent_sync_failed`.

Existing job cases pass unchanged.

## Step 3 — ADR and docs

- ADR 0029: status `accepted (F104 stage 06, <date>)`; a section `## Amendments at acceptance (F104)`: (1) the answered mark is the reader `listUserAnswers` (direct parent, user mail only); (2) the pass before a system send is wired by E6a through `syncSentHeaders`; (3) off deletes the stored sent mail (Q1); (4) windows and retention count from INTERNALDATE, and the text window never exceeds the retention; (5) a system send is one whose send went out; the user's own send of a system draft is user mail with the action id kept. `docs/decisions/README.md` row 0029: `accepted`.
- `docs/architecture.md` §4.1 rule 1 and §5 "Synced folders": Sent is read only read-only, into its own table (ADR 0029); never `AI/*`, Drafts, Trash or user folders. §5 data model: rows for both tables.
- `docs/capabilities/sync.md`: rule 5 drops Sent from the "never reads" list; the `mail.sync` rule names the Sent pass; the Limits line "No read of the Sent folder" goes.
- `docs/capabilities/sent-mail.md` (new, the template of `docs/capabilities/README.md`): what it does, rules (D4 order, windows, dedup, guard, text step, job and error rule, log lines), entry points, data, limits (no panel switch yet, no analysis: E5b, no pre-send pass: E6a), decisions, tests; "Checked against" your base. Index row in `docs/capabilities/README.md`.
- `docs/modules.md` §3.2: one line per new mail file.

**Test.** `apps/server/src/capability-map.test.ts` passes.

**Out of scope.** The pilot (stage 13); retention docs (stage 07).

## Done when

Steps 1–3 done; `docs/architecture.md` no longer says the sync never reads Sent; the Proof passes (`/tmp/f104-s06`).
