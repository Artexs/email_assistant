> **Status 2026-11-08 — in progress — plan written and reviewed; waits for the user's approval (and the answers to Q6, Q7).** 18 stage files (1–17, stage 7 as 7a and 7b), cold review and re-review fixed. Left: the user's approval, commit and push. No code yet. Then the build (`run-task`, stage 1 first, checkpoint 0) and the VPS deploy (stage 16, checkpoint 2).

# Sync the Interia sort folders and the spam folder (Oferty, Społeczności, Rachunki, Wiadomości-śmieci)

Scope: product change of the mail sync (S1a sync, S3 actions). Source: `tasks/active/test-mail-traffic.md` stage 9.1 and `notes/2026-11-07-agentmail-test-mail.md` §10.
Needs: nothing. Blocks: `test-mail-traffic` stage 9 (its test mail lands in `Oferty`).
Git mode: worktree.
Run mode: normal (see "Run mode").

> **For the build session:** this plan has the full step detail (Goal, Files, Interfaces, Decisions, Test, Check, Done when, Out of scope).
> The `run-task` skill skips the `planner` call. The main session wrote the plan on 2026-11-08 with the `plan-task` skill.
> A gap that the build finds = stop. Decide from "Input" if it answers the gap; else ask the user.

## Why

Interia sorts new mail into tabs that are IMAP folders: `Oferty`, `Społeczności`, `Rachunki` (no special-use flag). The app reads only INBOX
(`docs/architecture.md` §"Pipeline rules" 1: "The system reads only INBOX"), so it never sees mail that Interia sorts into these folders.
In real use a manager gets mail in all of them. The test tool also showed it: all AgentMail test mail lands in `Oferty`, and an IMAP `UID COPY`
into INBOX goes back to `Oferty` (notes §10). So a move into INBOX is no fix.

## User words (2026-11-08)

> "Third point is definitely okay to read the offerty. I mean, in the real scenarios there will be more emails across the inbox, so all of them have to be read.
> So, go with option 3. And also all other sources of emails that are available in the inbox."

> "1. yes, but all the emails there should be treated and processed by the internal tool, i mean most of the spam emails should be rejected. but sometimes there are few valuable emails. so perhaps its good to check them also. so app will check all the emails from inbox."
> "All other answers are default ones. Your suggested answers."
> "So I assume that's a completely new plan of implementation, so you should prepare me a handoff for detailed planning session for it."

## User decisions (2026-11-08)

- **U1 Folders:** sync INBOX, `Oferty`, `Społeczności`, `Rachunki` **and** the Interia spam folder `Wiadomości-śmieci`. Every mail there goes through the
  normal pipeline (rules, classifier): most spam folder mail ends as `spam`, but a valuable mail there must be found. The app's own folders (`AI`, `AI/*`)
  and `Wysłane`, `Wersje robocze`, `Kosz` stay out.
- **U2 Actions:** the committer acts on mail from every synced folder like on INBOX mail (moves into `AI/*`); Undo returns it to the folder it came from.
- **U3 First sync of a new folder:** only mail of the last 24 hours.
- **U4 Deploy:** now (do not wait for 2026-11-14), with a note in both pilot-week tasks.

## User answers to Q1–Q5 (2026-11-08, word for word)

> "1, stays where it is. and the purpose of checking of these emails is only to verify if there are correct emails but by accident which wouldn't happen shouldn't happen but perhaps and there is that possibility so in the most times you want to move those emails\
> 2\. move to appropriate categorized folder\
> The rest are your defaults values. So yes and proceed."

The questions (with the defaults that the user took for Q3–Q5) are in "Questions for the user" below.

- **U5 (Q1):** a `spam` result for mail in `Wiadomości-śmieci` leaves the mail there (no move). The spam folder is checked only to find the rare valid mail
  that landed there by accident. (The last part of the answer reads as "most times you [do not] move those emails": it agrees with "stays where it is".)
- **U6 (Q2):** a valid mail in `Wiadomości-śmieci` moves to the folder of its category. Reading (D11, shown to the user in the plan summary):
  `info` → `AI/Info`, `notification` → `AI/Notifications` (as U2), and `urgent`, `needs_reply`, `delegation` → INBOX (the folder where these categories stay).
  The cold review (M3) added the normal move gate and "no flag, no urgent notice" for this mail (D11, D12, D23): the user confirms at the plan approval.
- **U7 (Q3, default):** digest lines and notices of mail outside INBOX show its folder; "stays in INBOX" names the real folder.
- **U8 (Q4, default):** a read-only count on the VPS now (done: F4); a separate daily LLM limit for spam folder mail (start value from the count, default 100).
  **Changed by the count (D14, the user confirms at the plan approval):** no separate limit in this task.
- **U9 (Q5, default):** a `reviewer` subagent for the cold review, one user approval at the end; the build starts with a spike stage on the real
  mailbox (own gate); this task adds its migration before S5a adds its own.

## Goal

The sync reads INBOX and the Interia sort folders, stores and triages their mail like INBOX mail, and the actions and Undo work for mail from every synced folder.

## Done when

1. New mail in `Oferty`, `Społeczności`, `Rachunki` or `Wiadomości-śmieci` is stored, triaged, and shows in the digest with its folder (dev run on GreenMail, stage 14).
   On the VPS: new `Oferty` mail is stored and triaged after the deploy; the other three folders have rows with a cursor at their highest UID, and no old mail
   of these folders is stored (stages 16–17; F4: they get almost no mail).
2. Each synced folder has its own UID cursor and UIDVALIDITY check; a mail that the user moves between synced folders is not stored twice (stage 7a, 7b and 8 tests).
3. A move action takes the mail from the folder where it is; Undo brings it back to its source folder, not to INBOX (stage 10 tests, stage 14 dev run).
4. Spam folder rules: `spam` stays in `Wiadomości-śmieci`; `urgent`, `needs_reply`, `delegation` get a move into INBOX and `info`, `notification` a move into
   `AI/*`, each under the normal move gate (D11, D12); no flag and no urgent notice for spam folder mail (D23) (stage 3, 11, 12 tests, stage 14 dev run).
5. `test-mail-traffic` is unblocked: its status line and its stage 9 file say that `deliver` is not needed (stage 17). Its own stage 9 run is that task's
   done-when (changed 2026-11-08 from "stage 9 runs to the end": the smoke mails are older than the 24 h first-sync window at deploy time, D20).
6. ADR 0014 replaces the rule "The system reads only INBOX"; `docs/architecture.md` says which folders the sync reads (stage 15).
7. Both pilot-week tasks have the deploy note with its UTC time (U4, stage 16).

## Input

### Facts checked (2026-11-08)

- **F1 Interia folders** (read-only count on the VPS, script `/tmp/ea-ssf-count/count.ts`, not in git): delimiter `/`. LIST attributes: `Wiadomości-śmieci`
  `\HasNoChildren \Noinferiors \Spam`, imapflow special use **none**; `AI/Spam` imapflow special use `\Junk` (by name); `Oferty`, `Społeczności`
  `\Noinferiors`; `Rachunki` `\HasNoChildren`. Other folders: INBOX, `Wysłane`, `Wersje robocze`, `Kosz`, `AI`, `AI/Notifications`, `EA-test`.
- **F2 Interia UIDVALIDITY and UIDNEXT:** UIDVALIDITY = 1 for all 12 folders. SELECT/EXAMINE gives no UIDNEXT (as in 2026-11-03). STATUS gives
  `UIDNEXT 1` for **every** folder (wrong). imapflow 1.7.8 returns the server value as is (`node_modules/imapflow/lib/commands/status.js`).
  So `inboxStatus()` returns `uidNext` 1 today, and a sync with an empty window would set the cursor to 0 (D4).
- **F3 One UID counter for the mailbox:** in the same 8 days `Oferty` holds UIDs 38797–38964 and INBOX 38803–38963; the highest UID of the mailbox is
  in `Oferty` (38964). Same as the S3 and S4 probes (`notes/2026-11-03-interia-imap-capabilities.md`).
- **F4 Volumes** (INTERNALDATE, 2026-10-31..2026-11-08 UTC): INBOX 83 (about 10/day); `Oferty` 56 (about 7/day; 774 in total); `Społeczności` 0
  (18 in total, highest UID 35156); `Rachunki` 0 (1 in total, UID 32543); `Wiadomości-śmieci` 3 (7 in total, last 2026-11-05, highest UID 38892).
  LLM calls: 176 (2026-11-06, the backfill), 14 (2026-11-07), 1 (2026-11-08 until 09:43Z). `LLM_DAILY_CAP` default 300.
- **F5 VPS DB** (same script): `mailboxes.uidvalidity` 1, `last_uid` 38963; `folder_map` = `junk: Wiadomości-śmieci` (connect 2026-11-03), `sent: Wysłane`,
  `trash: Kosz`, `drafts: Wersje robocze`, `ai_info: AI/Info`, `ai_spam: AI/Spam`, `ai_manual: AI/Manual`, `ai_notifications: AI/Notifications`;
  capabilities `move` false, `uidplus` true. The VPS checkout is `fa60c7b`.
- **F6 GreenMail 2.1.15** (local probe 2026-11-08, `/tmp/ea-ssf-probe/greenmail.ts`, not in git): each folder has its own UID counter from 1; all folders of a
  user share one UIDVALIDITY value; STATUS and SELECT give the right UIDNEXT; delimiter `.` (`AI/Info` is `AI.Info`); imapflow marks `Wiadomości-śmieci` as
  `\Junk` by name; a non-ASCII folder name works for CREATE, APPEND, SELECT and STATUS; `status()` of a missing folder throws an error with `code: "NotFound"`.
- **F7 APPEND transfer** (same GreenMail probe): the raw source of a mail (170 bytes = RFC822.SIZE) APPENDed to INBOX with the source flags and INTERNALDATE
  keeps size, INTERNALDATE, `\Flagged` and the `Message-ID` (GreenMail adds `\Recent`). So the `content_hash` stays the same. A `UID EXPUNGE` of the source → true.
- **F8 Interia COPY and APPEND** (notes §10, S3 stage 19): a `UID COPY` of `Oferty` mail into INBOX goes back to `Oferty` (new UIDs). An APPEND of the raw
  mail into INBOX stays, syncs and triages. A COPY of INBOX mail into `AI/Spam` stays; the Undo COPY of it back into INBOX stays. A webmail move keeps the UID.
- **F9 imapflow** `getMailboxLock(path, { readOnly: true })` opens with EXAMINE (`mailbox.readOnly` true, count script). `append(path, raw, flags, date)`
  returns `{ uid }` with APPENDUID (S4). `fetchOne(uid, { source: true })` returns the raw bytes (`fetchBodyText`).
- **F10 Code:** the forward move already starts from `emails.folder` (`actions/apply.ts:305`); only the reverse targets INBOX (`apply.ts:298`). The INBOX-only
  places: "Differences found at collect" items 2–4.
- **F11 Deploy rule:** `deploy/README.md` (lines 139, 224): "Roll back the code, not the migration." Migrate step: `$C run --build --rm server bun run db:migrate`,
  then `$C up -d --build --wait`.

### Not verified (and the stage that checks it)

- **NV1** A COPY from `Oferty` or `Wiadomości-śmieci` into `AI/*` stays, and the COPY back stays (Interia re-sorts a COPY into INBOX only?). Stage 1.
- **NV2** An APPEND transfer from `Wiadomości-śmieci` into INBOX at Interia stays and keeps size, INTERNALDATE and `Message-ID`. Stage 1 checks it with a
  synthetic probe mail only: it is not proven for mail that Interia classified as spam (there is no own test mail in that folder). F8 (an APPEND of `Oferty`
  mail into INBOX stays) makes it likely. Stage 17 checks the first real rescue, if one happens.
- **NV1 note:** stage 1 also moves one of the test tool's own AgentMail smoke mails that Interia sorted into `Oferty` (notes §10: `piotr-re-termin` or
  `faktura-wystawiona`), out and back, with a 5-minute wait, because a synthetic APPEND was never classified by Interia (review M2).
- **NV3** STATUS UIDNEXT stays 1 after new mail arrives (F2 is one reading). Stage 1 reads it again. D4 does not depend on it.
- **NV4** The first sync after the deploy stores about 6–9 `Oferty` mails and no mail older than 24 h. Stage 16.
- **NV5** Whether Interia deletes old mail in `Wiadomości-śmieci` by itself. Not needed: a mail that is gone gives `mail_not_found` (no notice for an original).

### Design decisions

- **D1 Synced folders live in a new table `mailbox_folders`.** One row per synced folder of a mailbox: `key`, `path`, `role`, `enabled`, and its cursor
  (`uidvalidity`, `last_uid`). Keys: `inbox`, `offers`, `social`, `bills`, `junk` (the test tool's keys, plus `inbox`). Roles: `inbox`, `sort`, `junk`.
  Rejected: `mailboxes.folder_map` (it holds move targets, no cursor); a provider constant only (no cursor per folder, no off switch).
- **D2 Discovery by exact name.** `packages/core/src/mail/sync-folders.ts` holds the provider defaults `SYNC_FOLDER_DEFAULTS` (`offers` = `Oferty`,
  `social` = `Społeczności`, `bills` = `Rachunki` with role `sort`; `junk` = `Wiadomości-śmieci` with role `junk`). At the start of each sync run the job
  lists the folders once (`provider.listFolders()`) and inserts a row (enabled, no cursor) for each default path that the server lists exactly (case-sensitive).
  It never picks a path that is a `folder_map` value of `drafts`, `sent`, `trash` or an `ai_*` key, nor `AI` or a path under `AI` + delimiter.
  It never changes an existing row (a disabled row stays disabled). The `\Junk` and `\Spam` flags are not used (F1: `\Junk` is on `AI/Spam`).
  Every mailbox has an INBOX row from its creation (migration, `connectMailbox`, test fixture).
- **D3 Cursor per folder; old columns stay for a code rollback.** The migration copies `mailboxes.uidvalidity` and `last_uid` into the INBOX row. The sync reads and
  writes only the folder rows; the write of the INBOX row also writes the two `mailboxes` columns in the same transaction (dual write), so the old code
  (`fa60c7b`) runs on the new schema after a code rollback (F11). The migration only adds: no rename, no dropped column. `emails.inbox_uid` keeps its name
  and now means "the last known UID in `source_folder`"; `emails.undo_pending_at` keeps its name and now means "a system move into a synced folder is in
  flight" (D9). Follow-up `tasks/planned/drop-mailbox-cursor-columns.md` (stage 15) renames them and drops the dual write after the pilot weeks.
- **D4 Folder status (Interia UIDNEXT).** `folderStatus(folder)` returns `{ uidValidity, uidNext, highestUid }`. `highestUid` = the UID of `*` (0 when the
  folder is empty). `uidNext` = the largest of the STATUS value, the SELECT value and `highestUid + 1` (values that are not finite are left out; at least 1).
  So the cursor after an initial sync or a rescan (`max(uidNext - 1, highest kept UID)`, unchanged) is the highest UID of the folder, also when the window
  is empty. This also fixes the hidden INBOX case (F2).
- **D5 One run per mailbox, folder by folder.** Order: INBOX, then the `sort` rows in the order of `SYNC_FOLDER_DEFAULTS`, then `junk`. One IMAP connection.
  A `MailAuthError` anywhere stops the run (the mailbox becomes `auth_error`, as now). Any other error in INBOX stops the run as now (`last_synced_at`
  not set). An error in another folder (also `CursorMovedError`) gives one `warn` line with the folder key, and the run goes on with the next folder.
  `last_synced_at` is set when INBOX synced, so a broken sort folder gives no "sync is late" notice. A row whose path the server does not list is skipped with
  one `warn` line. A disabled row is skipped. The run state (`matched`, `newKeys`) spans all folders of the run; `matched` records the folder of each match (D7).
  Discovery (`listFolders`, `ensureSyncFolders`) runs before INBOX: a `MailAuthError` there stops the run; any other error gives one `warn` line
  (`sync <mailboxId>: folder discovery failed: <describeError(error)>`) and the run goes on with the existing rows (all of them treated as listed).
  A folder that fails 3 runs in a row gets one `error` line (`sync <mailboxId> folder <key>: failed 3 runs in a row`) until it syncs again
  (an in-memory counter in the job, like the triage cap warning), so a broken spam folder does not stay silent (review m11).
- **D6 Stored row fields.** New mail: `folder` = `source_folder` = the synced folder path; `uid` = `inbox_uid` = its UID there. New column
  `emails.source_folder text NOT NULL DEFAULT 'INBOX'` (all old rows came from INBOX). Invariant: `folder <> source_folder` ⇔ a system move put the mail
  there (it replaces `folder <> 'INBOX'`). The partial index `emails_moved_idx` gets the predicate `folder <> source_folder`.
- **D7 Dedup across folders** (pure, `decideIncoming` with the synced folder S; one source per rule: stage 6). `matched` maps an email id (or a `run:` id of
  a row that this run stored) to the folder where this run matched or stored it. "Free" = not in `matched`. "Seen elsewhere" = a copy in `matched` with a
  folder ≠ S.
  - a copy (any, also matched) with a fresh `undo_pending_at` (younger than 24 h) → `move_in_flight`: store nothing (D9);
  - else a free copy with `folder` = S → `update_uid` (sets `uid`; also `inbox_uid` when `folder` = `source_folder`);
  - else the first free copy (lowest copy number) → `check_folder` in its `folder`. Its folder is a system folder (`folder` ≠ `source_folder`): still there
    → a second identical copy, new row `#n` (old rule), **but** `cross_copy` when a copy was seen elsewhere in this run; gone → `returned` (the user put it
    into S). Its folder is its source folder (≠ S): still there → `cross_copy`: store nothing, count it (one mail in two synced folders: the `anna` case);
    gone → `relocated` (the user moved it between synced folders);
  - else (no free copy) a copy seen elsewhere → `cross_copy` with no locate (a rescan or a `returned` in an earlier folder of this run, review M1);
    `relocated` never applies to a `run:` id;
  - else a new row `#n` (two identical copies in S, old rule) or the base key (no copy).
- **D8 Writes of a check.** `returned`: `folder` = `source_folder` = S, `uid` = `inbox_uid` = the new UID, `returned_at` = now, only while the row is
  system-moved (`folder <> source_folder`). `relocated`: `folder` = `source_folder` = S, `uid` = `inbox_uid` = the new UID, no `returned_at`, no feedback,
  no triage, only while the row is still in its old source folder. A conditional update that changes no row counts 0 (a committer or another run won).
  A `returned` into a synced folder that is not the row's old source (the user files an `AI/Info` mail into `Oferty`, or a rescued mail into `Oferty`)
  counts as `wrong` feedback like any return (`triage.returned`): the user did not keep the system's move (review question 1, decided).
- **D9 Move marker** (`undo_pending_at`, the D22 rule of S3 made general). Set by Undo (as now) and by the committer in its own commit before the IMAP call
  of a forward move with target `inbox` (the rescue, D12). Cleared in the final transaction of that move (applied or failed), as for reverse moves now.
  A marker older than 24 h is a leftover. The sync checks the marker before any locate (D7). Change against S3: a reverse move whose IMAP part ran but
  whose commit did not is no longer marked `returned` by the sync; the committer writes the location.
- **D10 Actions.** The forward move starts from `emails.folder` (as now). The reverse move (Undo) targets `emails.source_folder` with the hint `inbox_uid`
  (was INBOX). The location write: target = `source_folder` → `inbox_uid` = new UID, `moved_at` = null; else `moved_at` = now. Flags work in `emails.folder` (as now).
- **D11 Plan for mail from the spam folder (U5, U6; changed by the cold review M3, the user confirms at the plan approval).** Spam folder mail is
  controlled by its sender (Interia put it there for a reason; its `From` can be forged), so it gets the normal gates and no extra push.
  `planActions` gets `{ fromJunk }`. `fromJunk` = the mail's `source_folder` is the path of the mailbox's `junk` row. For `fromJunk`: `spam` → no action
  (the mail stays); `urgent` → move `inbox` (no flag); `needs_reply` → move `inbox`; `delegation` → move `inbox` + the draft and send as now (a send always
  waits for the user's tap); `info` → summary + move `ai_info`; `notification` → mark read + move `ai_notifications`; `unsure` → move `ai_manual` (only with
  `move_unsure`, as now). The VIP rule is unchanged (no automatic move or mark read of a VIP mail, also not into INBOX). Mail from INBOX and the `sort`
  folders: the plan is as now (U2). The blocklist rule (spam, no LLM call) is unchanged.
- **D12 The rescue move into INBOX.** New move target `inbox` (payload `{ folder: "inbox" }`), resolved to `INBOX` without `ensureFolder` and without
  `folder_map`. Policy: the same rule as every move (architecture §4.3): `assist`, the `move` switch ON, the category's `auto` ON (go/no-go), moves supported,
  not VIP; else `log_only`. So on the VPS today (`auto` off for `urgent` and `needs_reply`) a rescue is `logged`: the digest line reads "would move to INBOX"
  with `📁 Wiadomości-śmieci`, and the user moves the mail by hand or turns `auto` on (`mailbox:settings auto --category urgent --value on --force`).
  `delegation` has no `auto` flag, so its rescue is always `logged`. Transfer: when the target is INBOX and the mail's `source_folder` is not INBOX,
  the committer uses `transferByAppend` (raw source + flags without `\Recent`/`\Deleted` + INTERNALDATE, APPEND to INBOX, then `UID EXPUNGE` of the
  source; F7, F8), else `moveMessage` as now. The ensure rule of S3 (locate in the target and the source first) stays. The Undo of a rescue is a normal COPY
  move back into the spam folder. If stage 1 shows that a COPY out of a sort or spam folder into `AI/*` is sorted back (NV1), stop: the main session proposes
  "transfer by APPEND for every move out of a `sort` or `junk` folder" and asks the user.
- **D13 Triage.** One pipeline for all folders. The classifier gets no folder hint (a prompt change needs an eval run: follow-up
  `tasks/planned/classifier-folder-hint.md`). Mail older than 7 days is skipped as now. `TriageMailbox` gets `junkFolder` (the path of the `junk` row,
  also when it is disabled); `ClaimedEmail` gets `source_folder`.
- **D14 No separate LLM limit for spam folder mail (U8 changed by F4).** The spam folder got 3 mails in 8 days, all sort folders together about 7 a day,
  and the cap is 300. A limit would protect against a load that the pilot does not have. Follow-up `tasks/planned/junk-llm-cap.md` (stage 15) holds the
  design (a count of `llm.call` rows for spam folder mail per quota day). The user confirms this change at the plan approval.
- **D15 Digest and notice texts (U7).** A digest line and an urgent notice of a mail whose `source_folder` is not INBOX show `📁 <source folder>`
  (cut to 30 characters) in the first line. Approval messages do not change (they quote the task, not the mail's place; follow-up if the user asks). "stays in INBOX" becomes "stays in <current folder>". The `action_failed` texts name the source folder ("could not
  move a mail back to <source folder>") and the current folder ("The mail stays in <folder>"). Folder paths come from the server's folder list, never from
  mail text. Log lines and audit rows keep folder keys only.
- **D16 Off switch and tools.** `bun run mailbox:settings sync-folder --key offers|social|bills|junk --value on|off` (audit `mailbox.sync_folder_changed`).
  INBOX has no switch. Switching a row on again clears its cursor (a new 24 h first sync, U3). `show` lists the synced folders. `mailbox:audit` compares each
  enabled folder with the rows that have that `folder`. `mailbox:rescan` forces a rescan of every synced folder. `mailbox:backfill` stays INBOX-only.
  `mailbox:seed --folder <path>` (test tool, test mailbox only) APPENDs into another folder for the dev run.
- **D17 Migration `sync_folders`** (stage 2): the new table with its checks, the INBOX rows from `mailboxes`, `emails.source_folder`, the new
  `emails_moved_idx`. Down: drop the table, the column and the new index, and create the old index. Down loses only the cursors of the non-INBOX folders
  and the source folder of non-INBOX mail. Use it only before live use; after the deploy, roll back the code (D3).
- **D18 Test tool.** `SORT_FOLDER_NAMES` (`packages/core/src/testmail/delivery.ts`) comes from `SYNC_FOLDER_DEFAULTS` (one source). `deliverTestMail`
  finds the `junk` folder by its default name, not by `\Junk` (fixes notes §10 finding 3). The tool stays; `test-mail-traffic` does not need it after the deploy.
- **D19 Audit events.** `mailbox.sync_folder_added` (data: `mailbox_id`, `folder_key`, `role`) for each row that discovery inserts, in the same transaction;
  `mailbox.sync_folder_changed` (data: `mailbox_id`, `folder_key`, `enabled`).
- **D20 Deploy (U4).** Deploy during the pilot weeks. Before it, a note in both week tasks: the change, its UTC time, and "report N (wrong moves) for all
  mail and for `source_folder = 'INBOX'` mail" (S3) and "count drafts and approvals for all mail and for INBOX mail" (S4). The first sync takes only the last
  24 h of each new folder (U3); about 6–9 `Oferty` mails (F4), so about 5 moves (`notification` is `auto` on). The smoke mails of 2026-11-08 07:58Z are
  outside that window after 2026-11-09 07:58Z; `test-mail-traffic` sends a new smoke batch.
- **D21 Log lines.** Per folder: `sync <mailboxId> folder <key>: <mode>, fetched n, stored n, uid updated n, returned n, relocated n, cross copies n,
move in flight n, skipped own n, ignored below cursor n` (info). `sync <mailboxId> folder <key>: not on the server, skipped` (warn).
  `sync <mailboxId> folder <key>: <describeError(error)>; the next tick tries again` (warn). `sync <mailboxId>: added sync folders <keys>` (info; keys
  comma-separated without spaces, e.g. `offers,social,bills,junk`). The D5 discovery and 3-runs lines. New error classes have fixed messages without a path
  (`MailFolderMissingError`: "IMAP folder not found"), because `jobs.ts` logs `error.message` of an INBOX error.
  The job line: `synced <mailboxId>: folders n, fetched n, stored n, uid updated n, returned n` (sums). Never a path, address or subject.
- **D22 Coordination with S5a.** S5a (`tasks/active/s5a-web-foundation.md`) plans its own migration (`web_panel`) and a `bun.lock` change. This task
  adds its migration first (U9) and changes no `bun.lock`. The build tells the S5a session through the user (end summary) and a log line here; this task never
  edits the S5a files (another session works on them).

- **D23 No urgent notice for spam folder mail (review M3).** The urgent notice (`channels/notices.ts`) skips a mail whose `source_folder` is the `junk`
  path. Such mail shows in the digest (NEEDS ACTION, `📁 Wiadomości-śmieci`). Reason: an injected "urgent" text must not push a spam-folder mail to the phone.
- **D24 Known limits (written in ADR 0014).** (a) A return into a synced folder that is not the row's source, below that folder's cursor, is not seen
  (Interia keeps the UID). (b) A mail that the user moves between two synced folders in the seconds between their passes of one run is not stored.
  (c) A row whose source became INBOX by a user move out of `Oferty` gets its Undo by COPY into INBOX, which Interia may sort back (F8). (d) After a code
  rollback the old code ends a `ready` move `{ folder: "inbox" }` as `bad_payload` and sends an Undo of `Oferty` mail to INBOX. (e) `mailbox:audit` shows a
  cross copy as `cross`, not as `missing` (stage 13.2).
  (f) A spam folder mail that the user moves into INBOX by hand (the Q6 default path) keeps its UID at Interia, so it is below the INBOX cursor: the row
  stays `folder` = `Wiadomości-śmieci` (stale location, the mail itself is fine in INBOX).

### Edge cases (decided; each has a test in its stage)

- **Folder row states × events:** new (no cursor) → initial 24 h (7a.T1, 7a.T2); incremental (7a.T3); UIDVALIDITY change → rescan 7 days for that folder only
  (7a.T8); disabled → skipped, never re-enabled by discovery (4.T4, 7a.T4); enabled again → cursor cleared → initial (4.T6); path no longer listed → skipped
  with a warn (7a.T5); empty window at Interia → cursor = highest UID (5.T7, 7a.T2).
- **Mail row states × events:** in its source folder; system-moved (`AI/*` or the INBOX rescue); move in flight; returned; relocated; cross copy; seen
  elsewhere in the same run (6.T1–T15, 7b.T1–T11, 8.T1–T8, 10.T1–T13).
- **Before the first run:** INBOX row from the migration with the old cursor → incremental, no change for INBOX (2.T1, 7a.T1). Sort rows appear on the first
  run after the deploy → initial 24 h (7a.T1).
- **Crash and repeat:** sync between the IMAP read and the commit → the folder cursor did not move → the next run repeats; the dedup key and the cross-copy rule
  stop duplicates (7b.T1, 7a.T10). Rescue between APPEND and EXPUNGE → both copies → the ensure deletes the source copy (10.T5). After the IMAP part, before the
  commit → the ensure finds the target only → `applied` with no second transfer (10.T6). Marker set → the sync stores no copy meanwhile (7b.T8, 10.T7).
- **Two runs at once:** the CAS on the folder row (`CursorMovedError`) → a warn, the next folder runs (7a.T9).
- **Two tenants:** every new repository function filters by `org_id` and has a test with a second organization (4.T1–T10, 2.T6, 7b.T11, 13.2 T5).
- **Restart after downtime:** each folder fetches all UIDs above its cursor; mail older than 7 days is skipped as now (no new rule).
- **Interia UID facts:** one UID counter (F3); a webmail move keeps the UID: a user move into a synced folder below that folder's cursor is not seen (known limit,
  8.T4; follow-up `tasks/planned/sync-return-to-other-folder.md`).
- **Secrets and private data:** log lines hold the mailbox id and folder keys only (D21); digest texts hold folder paths from the server list (D15), never mail text
  as a folder; the spike and count scripts print no subject, address or body.

## Plan

### Planning progress

- [x] Collect (2026-11-08): the handoff, this file, notes §10 (`notes/2026-11-07-agentmail-test-mail.md`), the Interia notes, `docs/architecture.md` §4.1–4.6, §5, §6.1,
      ADR 0010, `docs/code-patterns.md`, `tasks/README.md`, the code (`mail/{sync,sync-rules,port,repo,jobs,connect,tools,locate,open}.ts`, `mail/imap/client.ts`,
      `mail/fake/index.ts`, `actions/{apply,undo,move,committer}.ts`, the claim in `actions/repo.ts`, `triage/service.ts` and the daily cap, `triage/repo.ts`
      `listTriagedBetween`, `packages/core/src/triage/{planners,policy,settings}.ts`, `packages/core/src/digest/{digest,would-do,notices}.ts`,
      `packages/core/src/testmail/delivery.ts`, `reports/digest.ts`, `channels/notices.ts`, `scripts/mailbox-settings-args.ts`), the migrations, the integration
      fixtures, `deploy/README.md`, the pilot-week tasks, `tasks/active/test-mail-traffic.md`, `tasks/active/s5a-web-foundation.md`. Differences: below.
- [x] Worktree `../email_assistant-wt/sync-sort-folders`, branch `task/sync-sort-folders` from `origin/master` `1f882b5`.
- [x] User answers to Q1–Q5 (2026-11-08): U5–U9.
- [x] Facts checked: the read-only VPS count (F1–F5), the local GreenMail probe (F6–F7), imapflow source (F2, F9).
- [x] Design decisions D1–D24, edge cases.
- [x] Stage files `sync-sort-folders/stage-NN-<slug>.md`(18 files, each marked `[written]` in "Stages").
- [x] Cold review (`reviewer` subagent, Opus, high; record [`sync-sort-folders/review-2026-11-08.md`](sync-sort-folders/review-2026-11-08.md)): FAIL, 0 blockers,
      4 majors, 17 minors, 2 questions; all fixed (stage 7 split into 7a and 7b; D7, D11, D12 changed; D23, D24 added). Re-review (Opus, high): FAIL,
      0 blockers, 2 majors (N1: a nested imapflow lock in `transferByAppend` would hang the committer; N2: stale test numbers after the 7a split), 10 minors;
      all fixed (stage 9 lock order, test refs, `matched` only for real matches, cross copies only from synced folders, rollback with pending spam-folder rows). Second re-review (Opus, high): **PASS** with 8 minors, all fixed.
- [ ] User approval, commit, push.

### Differences found at collect (2026-11-08)

1. `origin/master` is `1f882b5` (the handoff names `1d9d504`; `230b972` and its merge came after). The main checkout is 6 commits behind and holds
   the uncommitted S5a plan work of another session. So this task works only in its worktree.
2. The forward move already starts from `emails.folder` (`actions/apply.ts:305`). Only the reverse target is INBOX (`apply.ts:298`), with the
   `inbox_uid` hint (`apply.ts:306`) and `inboxUid` / `movedAt` in the location write (`apply.ts:339-345`). `actions/undo.ts` has no INBOX rule:
   it only inserts the reverse rows.
3. More INBOX-only places than the handoff lists: the port calls `inboxStatus()` and `fetchBodyText(uid)`; `repo.ts` `listRecentlyMoved`
   (`folder <> INBOX` = "moved by the system"), `markEmailReturned` (sets INBOX), `updateEmailUid` (sets `inbox_uid`), `listInboxEmailKeys`
   (`mailbox:audit`), `requeueTooOld` (backfill); the partial index `emails_moved_idx … WHERE folder <> 'INBOX'`; the texts "stays in INBOX"
   (`packages/core/src/digest/would-do.ts:90`) and "back to INBOX" / "stays in INBOX" (`packages/core/src/digest/notices.ts:90,117,124`).
4. The folder-aware port calls have no UID range fetch (`fetchAbove`), no folder status (UIDVALIDITY, UIDNEXT) and no body fetch.
5. S5a (`tasks/active/s5a-web-foundation.md`, plan session in progress) also adds a migration (`web_panel`) and changes `bun.lock`.
   `tasks/README.md`: only one task at a time adds a migration. The two tasks need an order (D22).
6. `buildFolderMap` stores a `junk` key from `\Junk` at connect (`mail/connect.ts:31`); `deliverTestMail` resolves `junk` by `\Junk`
   (`mail/tools.ts:214-216`), which is `AI/Spam` now. The VPS `folder_map.junk` is `Wiadomości-śmieci` (F5).
7. The S3 week ends at 2026-11-14T20:00Z, the S4 part B at 2026-11-14T22:40Z (the handoff names 22:40Z for both).
8. Checked later in this session (F5): the VPS commit is `fa60c7b`. The env scopes were not read again (the handoff and notes §10 give them).

### Questions for the user (2026-11-08, answered: U5–U9)

- **Q1 Spam result for mail in `Wiadomości-śmieci`.** Default: the mail stays there; the plan logs "stays in the spam folder"; no move.
  Why: no write in the mailbox, `AI/Spam` keeps only the system's own spam decisions, and an Undo is not needed. Other: move it into `AI/Spam` (U2 as is).
- **Q2 Valuable mail in `Wiadomości-śmieci`** (`urgent`, `needs_reply`, `delegation`, `unsure`). Default: it stays in that folder, and the digest line
  and the urgent notice name the folder. `info` and `notification` move into `AI/*` as U2 says. Why: Interia sorts a COPY into INBOX back
  (notes §10), so a move into INBOX can fail; a later task can add it after a probe. Other: a "rescue" move into INBOX in this task.
- **Q3 Digest text for mail outside INBOX.** Default: every digest line and notice of a mail outside INBOX shows its folder
  (`📁 Oferty`), and "stays in INBOX" becomes "stays in <folder>". Other: no folder in the texts.
- **Q4 LLM limit for the spam folder, and a read-only count now.** Default: yes to a read-only count on the VPS now (IMAP, number of mails per day
  and folder for 7 days, numbers only). With it the plan sets a separate daily LLM limit for spam folder mail (start value 100), so spam
  cannot use the 300-call cap before real mail. Other: no count; no separate limit.
- **Q5 How to run the session.** Default: as in `test-mail-traffic` (P7): a `reviewer` subagent for the cold review, one approval at the end.
  The build has a spike stage on the real mailbox first (one synthetic probe mail APPENDed into `Oferty` and `Wiadomości-śmieci`, COPY to a
  probe folder and back, then deleted), with its own gate. This task adds its migration before S5a adds its own.

### Open questions at the plan approval (2026-11-08; the plan uses the defaults)

- **Q6 Gate for spam folder mail (cold review M3).** Default (D11, D12, D23): spam folder mail gets no flag and no urgent notice; VIP mail there is never
  moved by the system; the move into INBOX uses the normal category gate (`auto`). On the VPS `auto` is off for `urgent` and `needs_reply`, so a valid mail
  there shows in the digest as "would move to INBOX" with `📁 Wiadomości-śmieci`, and you move it by hand, or turn the rescue on per category
  (`mailbox:settings auto --category urgent --value on --force`). Why: a spam mail controls its own text, so an injected "urgent" must not push it to
  your phone or into INBOX by itself. A mail that you move by hand keeps its place in the app's records as the spam folder (D24 f; harmless).
  Other: the move at once with no gate (U6 as first written).
- **Q7 No separate LLM limit for spam folder mail (D14).** The count (F4) shows 3 spam folder mails in 8 days. Default: no limit now, a follow-up task holds it.
  Other: build the limit (start value 100) in this task.

### Rules for every step (read before each step)

- Code rules: `docs/code-patterns.md` and `CLAUDE.md` (template literals, `const`/`let`, the `log` util with a module prefix, no `console.log`, typed errors,
  `describeError`). `packages/core` has no I/O and no `process.env`. Modules import each other only through `index.ts`. Only `mail/imap/` imports `imapflow`.
- Every new repository function takes a `TenantContext` and filters by `org_id`; a test checks the filter with a second organization.
- **Only the committer changes the mailbox.** The sync reads only. The exceptions are the test tools that refuse every address except `TEST_MAILBOX_ADDRESS`
  (`mailbox:seed`, also with `--folder`). Never use imapflow's own MOVE fallback (it deletes the source after a failed COPY): COPY or APPEND first, EXPUNGE last.
- **Logs:** mailbox id and folder keys only (D21). Never a folder path, an address, a subject or a body in a log line or an audit row.
- **Real systems:** only stages 1, 16 and 17 contact the VPS or Interia, and only the main session runs them. In the other stages no code path under test
  opens a real IMAP connection to Interia (tests use `createFakeMailProvider` or the local GreenMail). Never print or edit any `.env`.
- Do not commit (the main session commits each step after the review). Never run `bun run format` or `prettier --write` outside the step's files (S2 incident).
- Checks after each step (the step names which ones):
  - `bun run lint && bun run typecheck && bun run test:unit`
  - with DB and GreenMail: `bun run db:migrate && bun run test:int` (GreenMail and Postgres must run: `bun run dev:up`; on this PC run docker commands
    through `newgrp docker <<'EOF' … EOF`, see `notes/2026-11-08-docker-socket-newgrp.md` in the main checkout, or ask the main session).
  - Markdown files of the step: `bunx prettier --check <files>`.
- Integration tests: `withRollback` and `testDb` from `apps/server/test/integration/helpers.ts`; fixtures from `fixtures.ts` (`createOrgWithMailbox`,
  `insertTestEmail`, `insertTriaged`, `insertAction`). Fake mail: `createFakeMailProvider` (`mail/fake`); the Interia mode is
  `{ capabilities: { move: false, uidplus: true }, globalUids: true, keepUidOnUserMove: true, uidNextValue: 1 }` (options from stage 5).
- Times in tests: fixed `Date` values; never `new Date()` in an assertion.
- **Worktree** (Git mode: worktree, `tasks/README.md` § "Git mode"). Build in `../email_assistant-wt/sync-sort-folders` on branch `task/sync-sort-folders`;
  every subagent call gets that folder as `cwd`; never edit, commit or run checks in the main checkout (other sessions work there). Before the first
  build step the main session copies `.env` from the main checkout (never commit or print it) and creates an own DB: `bun run db:worktree sync-sort-folders`,
  then puts its two printed env lines into the worktree `.env`; drop it with `--drop` when the task ends. GreenMail and the ports stay shared: before
  `bun run test:int` or `db:migrate`, check that no other checkout runs them (`pgrep -af "bun test apps/server/test|dbmate"`); if one runs, wait.
  Stage and commit only this task's files, by explicit path. Push with `git push -u origin task/sync-sort-folders`; to get new `master` work, run
  `git merge origin/master` in the branch (never rebase a pushed branch). Every `git fetch`/`git push` on this PC:
  `GIT_SSH_COMMAND="ssh -i $HOME/.ssh/github -o IdentitiesOnly=yes" git …`.
- Names used in every stage: `INBOX` (constant from `mail/port.ts`), `SyncFolderRow` (stage 2, narrowed in stage 4), `SyncFolderKey`, `SyncFolderRole`, `SYNC_FOLDER_DEFAULTS`,
  `MoveTarget`, `MOVE_TARGET_NAMES` (stage 3), `FolderStatus` (stage 5), `MOVE_PENDING_MAX_AGE_MS` = 24 h (stage 6; the old `UNDO_PENDING_MAX_AGE_MS`).

### User checkpoints

0. Before stage 1: the user says yes to the spike on the real mailbox (U9, "own gate"). The main session asks in one short message (what it writes, for how long, and the cleanup).
1. After stage 1: the main session compares the result with NV1–NV3. As expected → go on without a stop. Else stop, write the fact, and ask the user (D12).
2. Before stage 16: the group reviews give PASS, and the stage 14 dev run passed. The main session gives a 4-line summary (expected first-sync counts, moves,
   the rollback) and waits for the user's "deploy". Reason: the deploy changes the live pilot mailbox during the pilot weeks.
3. After stage 17: the user looks at a digest with `📁 Oferty` lines (optional: tap ↩️ on a moved `Oferty` mail and check in the webmail that it is back in
   `Oferty`). Then the main session closes the task.

### Review model

Implementers: Sonnet, medium (agent file default). Reviews of the `[risky]` stages (1, 2, 4, 5, 6, 7a, 7b, 8, 9, 10, 11, 16): Opus, high. Stage 3: Opus, high
(the plan decides what the committer does to real mail). Stages 12, 13, 15, and the result texts of the operation stages 14 and 17: Sonnet, high. In stage 1 the reviewer checks the
spike script before the run. Group reviews (Opus, high): stages 2–4 after stage 4; stages 5–8 after stage 8; stages 9–11 after stage 11; stages 12–15 and the
whole branch diff before stage 16. Stage 7a and 7b count as two stages of the range 5–8.

### Run mode

Run mode: normal (one step at a time: build → review → commit → push the branch). Not pipeline: the `[risky]` stages build on each other's interfaces
(port → rules → loop → actions), so a review finding would redo the later stages. Each `[risky]` stage has one step = one review unit. The normal stages
3, 12, 13, 15 are one review unit per step. Commit message: `mail: sync-sort-folders stage N.M — <what>` (area `actions`, `triage`, `core`, `tasks`, `docs` as fits).

### Stages

Each stage lives in its own file in [`sync-sort-folders/`](sync-sort-folders/). An implementer or reviewer reads this file (Input, Rules) and only the stage file of its step.

- [ ] [Stage 1](sync-sort-folders/stage-01-spike-real-mailbox.md) [written] — Spike on the real mailbox: sort-folder and spam-folder moves [risky] — main session; checkpoints 0 and 1
- [ ] [Stage 2](sync-sort-folders/stage-02-migration-sync-folders.md) [written] — Migration `sync_folders`; the INBOX cursor in `mailbox_folders` [risky]
- [ ] [Stage 3](sync-sort-folders/stage-03-core-folders-and-plan.md) [written] — Core: sync folder defaults; plan for spam folder mail; the `inbox` move target and its policy
- [ ] [Stage 4](sync-sort-folders/stage-04-folder-repository.md) [written] — Folder repository: list, discovery insert, switch, junk path [risky] — group review 2–4
- [ ] [Stage 5](sync-sort-folders/stage-05-port-folder-reads.md) [written] — Port and adapters: folder status, fetch above, body text, folder list per folder [risky]
- [ ] [Stage 6](sync-sort-folders/stage-06-sync-rules.md) [written] — Sync rules across folders (pure) [risky]
- [ ] [Stage 7a](sync-sort-folders/stage-07a-sync-loop-per-folder.md) [written] — Sync loop per folder: discovery, new mail, errors [risky]
- [ ] [Stage 7b](sync-sort-folders/stage-07b-sync-incoming-across-folders.md) [written] — Sync: cross copies, relocated, returned, move in flight across folders [risky]
- [ ] [Stage 8](sync-sort-folders/stage-08-returns-below-cursor.md) [written] — Sync: returns below the cursor per source folder; the Interia keep-UID cases [risky] — group review 5–8
- [ ] [Stage 9](sync-sort-folders/stage-09-transfer-by-append.md) [written] — Adapter: move into INBOX by APPEND (`transferByAppend`) [risky]
- [ ] [Stage 10](sync-sort-folders/stage-10-actions-source-folder.md) [written] — Actions: Undo to the source folder, the rescue move, the move marker [risky]
- [ ] [Stage 11](sync-sort-folders/stage-11-triage-source-folder.md) [written] — Triage: plan by the source folder [risky] — group review 9–11
- [ ] [Stage 12](sync-sort-folders/stage-12-digest-notice-texts.md) [written] — Digest and notice texts with the folder
- [ ] [Stage 13](sync-sort-folders/stage-13-tools.md) [written] — Tools: `mailbox:settings sync-folder`, `mailbox:audit` per folder, `mailbox:rescan`, `mailbox:seed --folder`
- [ ] [Stage 14](sync-sort-folders/stage-14-dev-run-greenmail.md) [written] — Dev run on GreenMail with the fake Telegram [risky] — main session
- [ ] [Stage 15](sync-sort-folders/stage-15-docs-adr-followups.md) [written] — Docs, ADR 0014, notes, follow-up tasks — group review 12–15 + branch
- [ ] [Stage 16](sync-sort-folders/stage-16-merge-and-vps-deploy.md) [written] — Merge into `master` and VPS deploy [risky] — main session; checkpoint 2 before it
- [ ] [Stage 17](sync-sort-folders/stage-17-live-checks-and-close.md) [written] — Live checks, unblock `test-mail-traffic`, close [risky] — main session; checkpoint 3

### Results

Not yet (stages 1, 14, 16 and 17 write their results here).

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built; ADR 0014 is accepted; ADR 0010 says "amended by 0014".
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/` (`drop-mailbox-cursor-columns.md`, `junk-llm-cap.md`, `classifier-folder-hint.md`, `sync-return-to-other-folder.md`, `backfill-per-folder.md`).

## Log

- 2026-11-08: Created from the `test-mail-traffic` stage 9.1 finding. The user chose "sync the sort folders" over the APPEND move and the webmail filter.
- 2026-11-08: User answers: U1 also the spam folder (all mail is checked), U2–U4 the defaults. Handoff for the planning session written.
- 2026-11-08: Plan session (`plan-task`, Claude Code, Opus) started in the worktree. Collect done; 8 differences logged; Q1–Q5 asked.
- 2026-11-08: User answers to Q1–Q5 (U5–U9): spam stays in the spam folder; valid spam-folder mail moves to the folder of its category; defaults for Q3–Q5.
  Read-only VPS count (F1–F5): STATUS UIDNEXT is 1 for every Interia folder; one UID counter; small volumes (D14 drops the separate LLM limit).
  Local GreenMail probe (F6–F7). Design D1–D22 written. D3: the migration only adds, so a code rollback stays possible during the pilot weeks.
- 2026-11-08: Stage files written (1–17; stage 7 as 7a and 7b). Cold review: FAIL (4 majors, 17 minors), fixed; M3 changed D11/D12 (spam folder mail gets the
  normal move gate, no flag, no urgent notice: D23) and needs the user's yes (Q6). Re-review: FAIL (2 majors, 10 minors), fixed. Second re-review: PASS (8 minors, fixed). Q6 and Q7 wait for the approval.
  The `test-mail-traffic` status line now links `tasks/active/sync-sort-folders.md`.
