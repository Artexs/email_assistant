# F104 stage 06 — Job wiring, GreenMail proof, ADR and docs

Part of [`../plan.md`](../plan.md). Needs stage 05 on `master`. Read D3, D8, D9, D16 first.

After this stage each `mail.sync` run reads the Sent folder of every mailbox whose flag and switch are on, on the same IMAP connection, and a Sent error never fails the INBOX sync. A GreenMail test proves that the pass leaves the folder as it was. ADR 0029 is accepted and the docs say "reads Sent read-only".

## Step 1 — GreenMail proof

**Goal.** Prove D3 against a real IMAP server: flags, UIDs and the message count of Sent do not change.

**Files.** `apps/server/test/integration/imap-sent-greenmail.test.ts` (new).

**Interfaces.** Follow `imap-sync-greenmail.test.ts` (connect with `connectMailbox`, `openImapProvider`, `verifySmtpLogin`, inside `withRollback`, a random address `u-<uuid>@localhost`). Then: `setFolderMapEntry(trx, ctx, mailboxId, "sent", "Sent")`; `appendRaw(imap, "Sent", raw1, [])` and `appendRaw(imap, "Sent", raw2, ["\\Seen"])` with `renderSeedMessage` mails dated now − 1 h (raw1 has `inReplyTo`, raw2 has a text body); `upsertOrgFeature(… "sent_sync" on …)`; `writeSentSwitch(… on …)`; open a provider with `openImapProvider(imap)`; read `before = { status: await p.folderStatus("Sent"), flags: await p.fetchFlagsIn("Sent", uids) }` (uids from `p.searchSinceIn("Sent", now − 1 d)`); run `syncSentFolder({ db: trx, provider: p, isOwnActionId: async () => false, now: () => new Date() }, ctx, mailboxId)`; read `after` the same way; close the provider.

**Decisions.** D3, D7.

**Test** (integration; needs the local GreenMail, as the other `imap-*-greenmail` tests):

1. `status "done"`, `stored 2`, `texts.stored 2`.
2. `after.flags` equals `before.flags` exactly (uid and flags per mail): raw1 has no `\Seen`, raw2 has `\Seen`.
3. `after.status.uidValidity`, `uidNext` and `highestUid` equal `before`.
4. The two rows hold the parent id of raw1 and the text of raw2.

**Check.** `bun test apps/server/test/integration/imap-sent-greenmail.test.ts`

**Done when.** Cases 1–4 pass. If case 2 fails (GreenMail sets `\Seen`), stop and report: do not change the test (plan N1).

**Out of scope.** Interia (stage 12 checks the pilot).

## Step 2 — The job calls the pass

**Goal.** `syncOne` runs `syncSentFolder` after the INBOX sync on the same provider; errors stay inside (D9).

**Files.** `apps/server/src/modules/mail/jobs.ts`, `apps/server/src/platform/log-fields.ts` (only if a field is new; none is planned), `apps/server/test/integration/mail-jobs.test.ts` (three cases).

**Interfaces.** In `syncOne`, after `markSynced` and the folder failure bookkeeping, before `provider.close()` (next to the F100 flag refresh when it exists there; either order):

```ts
await runSentPass(deps, ctx, mailboxId, provider);
```

```ts
// A Sent error never fails the INBOX sync (ADR 0029).
async function runSentPass(deps: MailSyncJobDeps, ctx: TenantContext, mailboxId: string, provider: MailProvider): Promise<void> {
  try {
    const result = await syncSentFolder({ db: deps.db, provider, isOwnActionId: deps.isOwnActionId, now: deps.now }, ctx, mailboxId);
    if (result.status === "flag_off" || result.status === "off") return;
    log.info("sent_sync_done", { mailbox_id: mailboxId, status: result.status, kind: result.mode, count: result.stored });
    if (result.texts.stored + result.texts.gone > 0) {
      log.info("sent_texts_done", { mailbox_id: mailboxId, count: result.texts.stored });
    }
  } catch (error) {
    log.warn("sent_sync_failed", { mailbox_id: mailboxId, ...errorFields(error) });
    try {
      await markSentPass(deps.db, ctx, mailboxId, { at: deps.now(), errorCode: "failed" });
    } catch (markError) {
      log.warn("sent_sync_mark_failed", { mailbox_id: mailboxId, ...errorFields(markError) });
    }
  }
}
```

A `MailAuthError` inside the pass is only logged here (the next INBOX sync sets `auth_error`). The provider is passed as `MailProvider`; `syncSentFolder` takes it as `SentFolderReader`.

**Decisions.** D8, D9.

**Test** (integration, the job with a fake through `openProvider`, as the existing cases of `mail-jobs.test.ts`; flag and switch set as in stage 04):

1. One INBOX mail and one `Sent` mail → after `job.run()`: the INBOX mail is in `emails`, the Sent mail in `sent_emails`, `markSynced` ran (`last_synced_at` set).
2. Flag off → no `sent_emails` row and no `"Sent"` entry in `fake.folderCalls`.
3. A `Sent` mail with an `X-EA-Action-Id` and an `isOwnActionId` that throws `new HardError("x")` only for that id → the INBOX mail is stored, `last_synced_at` set, the state has `last_error_code "failed"`, and `console.warn` got one call whose text holds `sent_sync_failed` (spy as `actions-close.test.ts` line 301 does with `console.error`).

**Check.** `bun test apps/server/test/integration/mail-jobs.test.ts`

**Done when.** Cases 1–3 pass; the existing job cases pass unchanged.

**Out of scope.** The sync interval (F100 stage 07), the flag refresh (F100 stage 06).

## Step 3 — ADR and docs

**Goal.** The docs describe what the code now does (PD-009).

**Files.** `docs/decisions/0029-read-sent-folder-read-only.md`, `docs/decisions/README.md` (row 0029), `docs/architecture.md`, `docs/capabilities/sent-mail.md` (new), `docs/capabilities/README.md` (index row), `docs/capabilities/sync.md`, `docs/modules.md` (§3.2 mail table).

**Interfaces.**

- ADR 0029: status line `accepted (F104 stage 06, <date>)`; keep the text; add a section `## Amendments at acceptance (F104)` with four bullets: (1) the "answered by the user" mark of decision 4 is the reader `listUserAnswers` over `sent_emails` (the direct parent only, user mail only; stage 07); (2) decision 3's Sent pass before a system send is wired by E6a (F115) through `syncSentHeaders`; (3) turning the switch off deletes the stored sent mail (default, F104 `questions.md` Q1); (4) the 30- and 14-day windows and the retention count from the Sent folder's INTERNALDATE. `README.md` row 0029: `accepted`.
- `architecture.md` §4.1 rule 1: replace "It never reads `AI/*`, Sent, Drafts, Trash or the user's own folders, so that mail is never touched." by "It reads the Sent folder only read-only, into its own table (ADR 0029, `docs/capabilities/sent-mail.md`), and never changes it. It never reads `AI/*`, Drafts, Trash or the user's own folders, so that mail is never touched." §5 "Synced folders": the sentence "Never `AI/*`, Sent, Drafts, Trash or a user folder." becomes "Never `AI/*`, Drafts, Trash or a user folder; Sent has its own read-only pass after the folders (ADR 0029)." §5 data model table: rows for `sent_emails` and `mailbox_sent_sync` (columns of stage 01; "F104" in the last column, as other rows name their stage).
- `docs/capabilities/sent-mail.md` (new, the template of `docs/capabilities/README.md`): "What it does now" (the pass, behind the flag and the switch, read-only, own table, system sends linked, text of 14 days); Rules (the order of D4 as numbered rules, the windows, the dedup key, the guard, the text step, the job wiring and its error rule, the log lines); Entry points (`job` `mail.sync` → `apps/server/src/modules/mail/jobs.ts`; `function` `syncSentFolder`, `syncSentHeaders` → `apps/server/src/modules/mail/sent-sync.ts`; `fetchSentTexts` → `apps/server/src/modules/mail/sent-texts.ts`; the repository functions → `apps/server/src/modules/mail/repo/sent-state.ts`, `apps/server/src/modules/mail/repo/sent-emails.ts`); Data (both tables, the `content` states); Limits (no switch in the panel yet: F104 stages 08–10; no analysis: E5b, F116; no pass before a system send: E6a, F115; DSR map: F106); Decisions (`ADR 0029`, PD-116, PD-117); Tests (the stage 03–06 test files). Its "Checked against" line names your base commit.
- `docs/capabilities/README.md`: one index row `[sent-mail.md](sent-mail.md) | Sent mail | modules/mail (sent-*.ts, repo/sent-*.ts)`.
- `docs/capabilities/sync.md`: rule 6 ("The `mail.sync` job") gains one sentence: "After the folders, the run reads the Sent folder when the flag `sent_sync` and the mailbox switch are on ([sent-mail.md](sent-mail.md))."; the Limits line "No read of the Sent folder: E5a (F104)." goes.
- `docs/modules.md` §3.2: rows for `sent-rules.ts`, `sent-sync.ts`, `sent-texts.ts`, `repo/sent-state.ts`, `repo/sent-emails.ts` (one line each).

**Decisions.** D16.

**Test.** `apps/server/src/capability-map.test.ts` passes (paths, ADR numbers, the index).

**Check.** `bun test apps/server/src/capability-map.test.ts`

**Done when.** The test passes; `grep -n "never reads \`AI/\*\`, Sent" docs/architecture.md` finds nothing.

**Out of scope.** §7 retention and delete lines (stage 07).

## Done when (stage)

Steps 1–3 done; the Proof command of `plan.md` passes (`/tmp/f104-s06`).
