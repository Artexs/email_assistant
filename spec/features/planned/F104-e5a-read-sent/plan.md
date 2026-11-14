# F104 · E5a Read Sent — plan

> **Status 2026-11-14 — planned.** Plan base: f36794e. 12 stages; nothing built yet. Builds after F095 and F099 are in `spec/features/done/`.

Ticket: [ticket.md](ticket.md). Defaults for the owner: [questions.md](questions.md). Sources: `docs/product/stage-2/epics/E05-open-loops.md` § Discovery, `docs/product/stage-2/epics/E05-discovery-notes.md` §4.1, §6, §8, `docs/product/stage-2/decisions.md` PD-115–PD-117, PD-129 (also PD-045, PD-076, PD-077, PD-080, PD-109), `docs/decisions/0029-read-sent-folder-read-only.md` (draft), `docs/product/stage-2/05-execution-plan.md` §2.1 row 10, `docs/product/stage-2/06-architecture-review.md` (E5a row: "Own table and cursor (ADR 0029): clean").

## Input

Owner and product words, word for word:

- PD-116: "Read Sent per ADR 0029: read-only (`BODY.PEEK`; no flag, move, delete or append), own table, never triaged; system sends linked by `X-EA-Action-Id`; one "answered by the user" mark that E3, E4-B, E5, E6 and E11 read. Per-mailbox switch "Track my sent mail": on for new mailboxes with one line at connect, off for existing mailboxes until the owner turns it on; org flag `sent_sync` off until the pilot passes. Architecture §4.1 rule 1 changes when E5a lands."
- PD-117: "Sent depth: headers of the last 30 days at connect (history check, threading), text and analysis for the last 14 days; then incremental with each sync run."
- E5 notes §4.1: "Switch: per mailbox "Track my sent mail". New mailboxes: on, with one line in the connect flow ("The assistant reads Sent, never changes it, to see what you wait for"). Existing mailboxes: off until the owner turns it on."
- E5 notes §4.1: "Health: a mailbox with the switch on and no sent mail seen for 7 days gets one notice ("No sent mail seen: does your mail app keep a copy in Sent?")."
- E5 notes §8: "Setup check at connect (Sent seen in the last 30 days?) and the 7-day "no sent mail seen" notice".
- E5 notes §4.1: "Privacy: recipients of sent mail are third-party personal data: the new columns join the DSR address map (E7-T3) and the org-delete test, whichever ticket lands second adds them. Logs: ids and counts only."
- ADR 0029 decision 2: "Stored: `Message-ID`, `In-Reply-To`, `References`, thread key, `To`, `Cc` (never `Bcc`), subject, sent time, `X-EA-Action-Id`, auto-submitted and list markers, and the text under the same retention as `emails.body_text`."
- Owner (PD-115): "You can go with defaults." Owner rule (2026-11-13): owner checkpoints are not a stop; an owner step only for what needs the owner's hands.

### Product decisions

- **P1 (PD-116)** Read-only; own table; never triaged; system sends linked; one answered mark; the switch; the org flag. → D1–D11.
- **P2 (PD-117)** Headers 30 days, text 14 days at the first pass; then incremental with each sync run. → D4, D7.
- **P3 (notes §4.1, §8)** The settings card shows a setup line ("no sent mail in the last 30 days") after the first pass; the 7-day notice goes once per quiet period. → D13, D15.
- **P4 (notes §4.1)** No LLM reads sent text in this ticket (E5b does). No new sub-processor.

### Design decisions

- **D1 Two tables, one migration (stage 01).** `sent_emails` (one row per sent mail of a mailbox) and `mailbox_sent_sync` (one row per mailbox: switch, Sent path, cursor, pass state). Columns are in stage 01. Each gets RLS with the one `tenant_rows` policy and joins `TENANT_TABLES` of `rls-policy.test.ts`. Reason: ADR 0029 decision 2 (own table) and the architecture review ("E3a header capture should be a side table … E5a's own `sent_mail` table is right"). Rejected: a `mailbox_folders` row with role `sent` (the folder loop in `syncMailbox` and the folders card would treat it as a synced folder, and `pickSyncFolders` reserves the Sent path); columns on `emails` (sent mail must never reach triage, the digest, moves or Undo).
- **D2 The switch lives in `mailbox_sent_sync.enabled`.** No row = off. Connect inserts the row with `enabled` = the org flag `sent_sync` at connect time (D11). `enabled_at` is the epoch of the current "on" period: each off → on sets it again. Rejected: a key in `mailbox_settings.tool_switches` (tool switches gate actions and expire ready rows; this switch is consent to read).
- **D3 Read-only by type and by PEEK.** `port.ts` gets `SentFolderReader = Pick<MailProvider, "folderStatus" | "fetchAbove" | "fetchContent" | "searchSinceIn" | "fetchByUidsIn">`. The Sent pass and its helpers take only this type, so no write method is reachable from them (typecheck). Every body read of imapflow 1.7.8 is `BODY.PEEK` or `BINARY.PEEK` (fact F1), so no read sets `\Seen`. Tests: the fake's `folderCalls` hold no write method for the Sent path (stage 04); on GreenMail a Sent mail without `\Seen` keeps no `\Seen` and keeps its UID (stage 06). Rejected: EXAMINE (read-only SELECT): a lock option in both adapters and the contract for a guarantee that the type and PEEK already give, and the E9 adapters (Graph, Gmail) have no EXAMINE.
- **D4 The header step `syncSentHeaders`** (`mail/sent-sync.ts`, stage 04; its pure rules in `mail/sent-rules.ts`, stage 03). Order: flag `sent_sync` (else `flag_off`) → state row enabled (else `off`) → path = `mailboxes.folder_map.sent` (else `no_folder`) → a path that differs from the row's `path` resets the cursor (a new first pass) → `folderStatus(path)` (`MailFolderMissingError` → `folder_missing`) → mode: `initial` (cursor null), `incremental` (same UIDVALIDITY), `rescan` (other UIDVALIDITY) → metas: incremental `fetchAbove` + `filterAboveCursor`; else `fetchSince(provider, path, now − 30 d)` → chunks of 50 → per chunk: plan rows (D6), then one guarded transaction (D5) that upserts the rows and, in `incremental`, moves the cursor → after the last chunk of `initial`/`rescan`: cursor = `max(uidNext − 1, highest kept uid)` and `first_pass_at = now` when null. A meta with INTERNALDATE before now − 30 d is not stored (counted `tooOld`); the incremental cursor still passes it. Dedup key = `baseDedupKey(normalizeMessageId(messageId), contentHash(meta))` (the incoming rule); a key twice in one call keeps the first. Each row records its location: `path`, `uidvalidity`, `uid` (an IMAP UID names a mail only inside one folder and one UIDVALIDITY). Upsert: `ON CONFLICT (mailbox_id, dedup_key) DO UPDATE SET path, uidvalidity, uid, updated_at` (a rescan or a new path moves the location of a known mail). Rejected: the incoming copy machinery (`decideIncoming`): Sent mail is never moved by the system, so copies need no folder checks.
- **D5 One guard against races.** Each write transaction of the pass locks the state row (`FOR UPDATE`) and checks that `enabled`, `enabled_at`, `path`, `uidvalidity` and `last_uid` still equal what the pass read; else it writes nothing and the pass returns `cursor_moved`. The switch setter (D10) takes the same lock. So a switch off (or off → on) during a pass, a second pass on another connection (the CLI, later the E6a committer) and a path change never leave rows of an old period.
- **D6 Row content.** Per meta: `message_id` (normalized), `parent_message_id` = normalized `In-Reply-To`, else the last `References` id, else null; `references_ids` (normalized, order kept); `thread_key` = `threadKey(meta, dedupKey)` (same function as incoming mail); `from_address`, `to_addresses`, `cc_addresses` lower case, trimmed, unique, order kept (the mapper never reads `Bcc`); `subject`; `sent_at` = the `Date` header, else INTERNALDATE; `internal_date`; `path`, `uidvalidity`, `uid`. Origin (cold review 1, M2): the header `X-EA-Action-Id` holds the id of the system's draft, also on a draft the user sends from a mail app (`actions/send.ts` `saveSentCopy` locates by `prepared.draft.id`; `notes/2026-11-13-reply-drafts-facts.md` § E6). An injected `sentOriginOf(ctx, mailboxId, actionId)` (in `actions`, stage 03) answers `system` when that id is a `send` action of the mailbox, or a `create_draft` of the mailbox whose `send` action (`depends_on_action_id`) has `status = 'applied'` or `send_started_at` set; `draft` when it is a `create_draft` or `send` of the mailbox without such a send; else null (not a uuid, another mailbox, unknown). `system` → `origin = 'system'`, `action_id` = the id, `content = 'headers_only'`, no text ever. `draft` → `origin = 'user'` with `action_id` = the id (a link for E6a: "the user sent the system's draft by hand", PD-076). null → `origin = 'user'`, `action_id` null. User mail: `content = 'pending'` when `internal_date ≥ now − textWindow` (D7), else `'headers_only'`.
- **D7 The text step `fetchSentTexts`** (stage 05). `textWindow = min(14 d, organizations.data_retention_days)` (the retention may be shorter than 14 days; text past it must not be fetched; cold review 1, minor 5). After the header step, in the same call: (a) one UPDATE sets `pending` rows with `internal_date < now − textWindow` to `headers_only`; (b) at most 100 `pending` rows of the current `path` and UIDVALIDITY, oldest `internal_date` first: `fetchContent(path, uid)` each; `{ text: null, capture: null }` → `gone`; else `stored` with `body_text` = text cut to 100 000 characters, and from the capture `auto_submitted`, `precedence`, `list_id`, `has_calendar`. The write is guarded: `WHERE id AND content = 'pending' AND path AND uid AND uidvalidity` equal the read. A UID names one mail only within one folder and one UIDVALIDITY (RFC 9051 §2.3.1.1), so the guard holds all three; pending rows of an old path never match the current path and expire by (a). Rejected: text in the header step (a first pass of 14 days of mail would hold the sync job for minutes; the limit spreads it over runs).
- **D8 `syncSentFolder`** = header step, then text step when the header step ended `done`. It is the one entry point for the job and for later callers (E6a). Result: `{ status, mode, fetched, stored, system, tooOld, texts: { stored, gone, expired } }`; `status` ∈ `flag_off`, `off`, `no_folder`, `folder_missing`, `cursor_moved`, `done`. The header step writes `last_pass_at` and `last_error_code` (`no_folder`, `folder_missing`, else null) after each call except `flag_off` and `off`, so a caller of the header step alone (E6a) keeps the state too.
- **D9 Job wiring** (stage 06). `syncOne` in `mail/jobs.ts` calls `syncSentFolder` on the same provider after `markSynced`; `MailSyncJobDeps` gains `sentOriginOf`, wired in `main.ts` next to `isOwnActionId`. Any error is caught: one `sent_sync_failed` warn line, `last_error_code = 'failed'` (its own try), and the INBOX result stands; a `MailAuthError` here is also only logged (the next sync run finds it). Lines: `sent_sync_done { mailbox_id, status, kind: mode, count: stored }` and, when texts changed, `sent_texts_done { mailbox_id, count }`. No subject, address or path in any line; the folder is the key `sent` when a line needs it. `log.warn` writes to `console.error` (`platform/log.ts` line 135).
- **D10 The answered mark is a reader** (stage 07): `listUserAnswers(db, ctx, emailIds)` returns, per incoming email id, the earliest user sent mail (`origin = 'user'`) of the same mailbox whose `parent_message_id` equals `emails.message_id_header`: `{ answeredAt: sent_at, sentEmailId }`. Reason: the INBOX pass and the Sent pass run in either order (backfill, a folder turned on later, mail moved into INBOX), and a stored mark would need both passes to write it; the reader needs nothing and drops with the rows when the switch goes off (consent). Only the direct parent counts; "a later reply in the thread" is a reader's own rule (E5b close rules). System sends never count: their thread link is known from `actions`; the user's own send of a system draft counts (it is user mail, D6). Rejected: a column on `emails` (hot table, two writers, other tickets add columns there).
- **D11 Switch setter and connect** (stage 08). `setSentSync(db, ctx, mailboxId, { enabled, actor, at })` in `mail/sent-switch.ts`, one transaction: `enabled: true` with the org flag off → `flag_off` (turning off always works, also with the flag off, so the owner can withdraw consent after an operator rollback; cold review 1, M3); no mailbox → `not_found`; lock or insert the state row; same value → `same`; on: `enabled = true`, `enabled_at = at`, path, cursor, `first_pass_at`, `last_pass_at`, `last_error_code` null; off: `enabled = false`, `enabled_at` null, the same fields null, and `DELETE` of the mailbox's `sent_emails` rows (default, owner to confirm, Q1); audit `mailbox.sent_sync_changed` `{ mailbox_id, enabled, count }` (count = rows deleted). `connectMailbox` reads `isFeatureOn(deps.db, ctx, "sent_sync")` before its transaction and inserts the state row in it with that value; the `mailbox.connected` audit data gains `sent_sync: <boolean>`. A mailbox connected while the flag is off starts off (Q3).
- **D12 Settings API** (stage 09). `SettingsWebView` gains `sentSync`: null when the flag is off and the switch is off; else `{ flagOn, enabled, folder: string | null, firstPassDone, lastSentAt: ISO | null, storedCount, errorCode: "no_folder" | "folder_missing" | "failed" | null }`. `storedCount` counts user mail (`origin = 'user'`) of the current path with `internal_date ≥ now − 30 d`; `lastSentAt` is the newest user mail's `internal_date` of the current path. Route `PATCH /api/settings/:mailboxId/sent-sync` `{ enabled: boolean }`, owner only; `flag_off` and `not_found` → 404. CLI: `bun run mailbox:settings sent-sync --org-id … --mailbox-id … --value on|off`; `show` prints the sent status.
- **D13 Panel** (stage 10). A card "Sent mail" on the mailbox settings page when `sentSync` is not null: the switch, the plain line, the note that off deletes, one status line (pure helper `sentStatusLine`). With `flagOn` false the card says tracking is paused for the organization and the switch can only go off. The connect dialog shows the plain line when `me.features` holds `sent_sync`. Every text is an `en` and `pl` key.
- **D14 Retention** (stage 07). `clearSentBodies`: `body_text` null when `internal_date < now − data_retention_days`. `clearSentHeaders`: `subject`, `from_address`, `to_addresses`, `cc_addresses`, `references_ids` cleared when `internal_date < now − 90 d`; the row (ids, thread key, parent id, times) stays for reply delays (E11a), like `emails` keeps its row. Counted from `internal_date`, not `created_at`: a first pass stores mail up to 30 days old, and its text must not live longer than the period after it was sent. Default, owner to confirm (Q2).
- **D15 Notice `sent_missing`** (stage 11). Rule per mailbox: flag on, mailbox `active`, switch on, `first_pass_at` set, `last_error_code` null (an error has its own card line; the notice's question would mislead; cold review 1, minor 8); `quietSince = max(newest user internal_date of the current path, first_pass_at)`; `now − quietSince ≥ 7 d` → one row per owner, dedup `sent_missing:<mailbox id>:<quietSince ms>`; else cancel pending rows of the kind for the mailbox. A new sent mail or a new first pass starts a new period. Owners only (Q6). Needs `mailbox_id` (a CHECK as `send_held`).
- **D16 Docs.** Stage 06 sets ADR 0029 to accepted with five amendment lines (the mark is the reader of D10; decision 3's pass before a system send is wired by E6a; off deletes the stored sent mail; the windows and retention count from INTERNALDATE; the origin rule of D6), changes `docs/architecture.md` §4.1 rule 1 and §5 (sync rules, data model) to "reads Sent read-only (ADR 0029), never changes it", and adds the capability page `docs/capabilities/sent-mail.md` with its index row. Stages 07–11 extend that page. Stage 07 adds the §7 retention rows and the delete line.
- **D17 Texts.** Panel texts are keys in `apps/web/src/i18n/en.ts` and `pl.ts` (typecheck forces both). The notice text is a `NoticeTexts` entry in `packages/core/src/texts/notices.ts` with `en` and `pl`. Polish follows the F098 glossary (`spec/features/active/F098-e7-t1-polish-ui-i18n-frame-first/plan.md` P6; the lane may be `done/` at build time).

### Edge cases (answers; the stage tests cover them)

1. Flag off, switch on: no pass, no notice; the card shows "paused" and the owner can still turn the switch off (it deletes the rows); rows stay otherwise (retention clears text and headers). The flag back on: incremental from the old cursor; mail older than 30 days is skipped, text only for the text window.
2. Switch off during a pass: the next chunk fails the D5 check; no row of the old period stays (the setter deleted them in its own transaction).
3. Switch off → on: new `enabled_at`; a new first pass over 30 days.
4. No `\Sent` folder in `folder_map`: `no_folder`; the card says so; when the committer later creates `Sent` (`createFolderResolver`), the next run starts a first pass there.
5. Sent folder deleted or renamed on the server: `folder_missing`; the card says so.
6. UIDVALIDITY changes: `rescan` over 30 days; known rows get the new UIDs; pending rows of the old UIDVALIDITY expire to `headers_only` after 14 days.
7. The same mail twice in Sent: one row (dedup key).
8. A crash after the provider fetch, before the commit: nothing written; the next run repeats (initial: the cursor is set only at the end; incremental: the cursor moves with each chunk).
9. A crash between `fetchContent` and the text write: the row stays `pending`; the next run fetches it again.
10. Two orgs: every repository function filters by `org_id`; RLS under it.
11. A header `X-EA-Action-Id` that is not a uuid or not of this mailbox: user mail with `action_id` null (`sentOriginOf` answers null).
12. A mailbox removed: its rows go by the FK cascade inside `delete_mailbox`.
13. Clocks: windows are UTC milliseconds from `deps.now()`; dates on the card and in the notice are formatted in the organization time zone.
14. The user sends the system's draft from a mail app that keeps `X-EA-Action-Id`: a user row with `action_id` set (D6); it counts as an answer and E6a can see "sent by the user".
15. A Sent path change: rows of the old path stay with their old location; the text step, the summary and the notice read only the current path (D7, D12, D15).
16. Secrets and private data: no subject, address, path or text in a log line, an error text or an audit row; audit rows hold ids, booleans and counts.

## Facts checked

- **F1** imapflow 1.7.8 (`bun.lock`) builds every body fetch with `setBodyPeek`: `source`, `headers` and `bodyParts` become `BODY.PEEK[...]` or `BINARY.PEEK[...]` (`lib/commands/fetch.js` lines 53–70, 99–110, 134–140, read in `~/.cache/.bun/install/cache/imapflow@1.7.8@@@1`, 2026-11-14).
- **F2** imapflow `getMailboxLock` reopens a folder when its `readOnly` mode differs from the open one (`lib/imap-flow.js` line 4590). The client never passes `readOnly` today (`mail/imap/client.ts`), so all locks are SELECT.
- **F3** `folder_map.sent` comes from special-use `\Sent` at connect (`mail/connect.ts` `SPECIAL_USE_KEYS`, `buildFolderMap`); the committer can create `Sent` and store it (`actions/committer.ts` `DEFAULT_PATHS`, `createFolderResolver`). Interia marks `Wysłane` `\Sent` (`notes/2026-11-03-interia-imap-capabilities.md`).
- **F4** The sync never syncs the Sent path: `discoverFolders` passes the `drafts`, `sent`, `trash` and `ai_*` paths as reserved to `pickSyncFolders` (`mail/sync.ts` `RESERVED_MAP_KEYS`).
- **F5** `MessageMeta` holds `to`, `cc`, never `bcc` (`mail/imap/mapper.ts` `toMessageMeta`; the fake's `toMeta`). `actionId` = header `X-EA-Action-Id` (`META_QUERY` fetches it).
- **F6** `fetchContent(folder, uid)` returns `{ text, capture }`; `capture` has `autoSubmitted`, `precedence`, `listId` (≤ 300), `hasCalendar`; `{ text: null, capture: null }` when the UID is not in the folder (`mail/port.ts`, F100 stage 02, landed).
- **F7** `fetchSince(provider, folder, since)` is exported from `mail/sync.ts` and needs only `searchSinceIn` and `fetchByUidsIn`; its parameter type is `MailProvider`.
- **F8** `isOwnActionId(db, ctx, mailboxId, actionId)` refuses a non-uuid and matches `create_draft` and `send` actions of the mailbox (`actions/repo/planned.ts`); the sync gets it injected as `SyncDeps.isOwnActionId` (`main.ts` line 87).
- **F9** The flag `sent_sync` exists (`packages/core/src/features.ts`, epic `E5a`, remove-by `2027-03-01`, default off). `isFeatureOn(db, ctx, flag)` is in `tenancy/features.ts`, exported by `tenancy/index.ts`; tests set a flag with `upsertOrgFeature` and reset the kill list with `configureFeatures({ off: [] })` (`apps/server/test/integration/tenancy-features.test.ts`). `/api/me` returns `features` (`packages/core/src/web/me.ts`); `AccountCard.tsx` reads `me.features.includes("security_log")`.
- **F10** The scheduler never runs one job twice at once in a process (`platform/scheduler.ts` line 31). The committer is another job on another connection.
- **F11** Notice kinds at `f36794e`: 12, the last `send_held` (`packages/core/src/notices/kinds.ts`); the newest migration that sets `outbox_kind_check` is `20261114100003_outbox_send_held.sql`; the newest migration is `20261114110001_feedback_source_review.sql`. F100 stage 16 (planned) adds `weekly_report` to the same CHECK.
- **F12** The settings view is built in `config/view.ts` from injected deps (`listSyncFolders`), wired in `apps/server/src/web.ts` `settingsRouteDeps`; the folder switch route is `PATCH /settings/:mailboxId/sync-folders/:key` (`config/routes.ts`), owner only. `config` may not import `mail` (`apps/server/src/modules/layers.json`: `mail → config` only).
- **F13** Layers: `mail` imports `tenancy`, `config`, `audit`; `channels` imports `mail` and `tenancy` (`apps/server/src/modules/layers.json`, `docs/modules.md` lines 86–90). No new module edge in this plan: `sentOriginOf` lives in `actions` and reaches `mail` as an injected function (composition root `main.ts`), as `isOwnActionId` does.
- **F14** Retention: `apps/server/src/retention.ts` calls each clear function per organization; `RETENTION_TEXT_DAYS = 90`; mail body after `organizations.data_retention_days` (default 30); `retention-clear.test.ts`, `retention-job.test.ts`.
- **F15** Fake provider: `deliver(folder, msg, { internalDate })` creates the folder; `folderCalls` lists every call with its folder; `resetUidValidity(next, folder)`; `failOn(method, error)`; `remove(folder, uid)` (`mail/fake/index.ts`).
- **F16** GreenMail tests: `appendRaw(imap, folder, raw, flags)` creates the folder (`mail/imap/tools.ts`); `connectMailbox` with `openImapProvider` and `verifySmtpLogin` inside `withRollback` (`imap-sync-greenmail.test.ts`); `setFolderMapEntry(db, ctx, mailboxId, key, path)` (`mail/repo/mailboxes.ts`).
- **F17** Log fields allowed now: `mailbox_id`, `count`, `status`, `kind`, `reason`, `folder_key`, `error`, `error_code` (`platform/log-fields.ts`); `errorFields(error)` (`platform/errors.ts`). F103 stage 01 (planned) splits the names into kind lists; these names exist in both forms.
- **F18** Audit events are in `auditEvents` (`apps/server/src/modules/audit/repo.ts`), e.g. `mailboxSyncFolderChanged: "mailbox.sync_folder_changed"`.
- **F20** The system's drafts and sends carry `X-EA-Action-Id` = the draft action id (`actions/drafts.ts` `buildDraftMessage` passes `draftActionId: action.id`; `actions/send.ts` `saveSentCopy` locates the Sent copy by `prepared.draft.id`). A send action points to its draft by `actions.depends_on_action_id`; `actions.send_started_at` exists (F099 stage 02).
- **F21** `log.warn` and `log.error` write to `console.error` (`platform/log.ts` line 135); tests spy on `console.error` (`actions-close.test.ts` line 301).
- **F22** `organizations.data_retention_days` is an integer > 0, default 30 (`20261103000002_tenancy.sql` line 6); `getOrganization(db, ctx)` returns the row (`tenancy/repo.ts`, exported by `tenancy/index.ts`).
- **F19** `delete_mailbox` deletes the `mailboxes` row; tables with `FOREIGN KEY (mailbox_id, org_id) REFERENCES mailboxes (id, org_id) ON DELETE CASCADE` go with it (`20261114100002_rls_tenant_policies.sql` line 106 is the current body).

## Not verified

- **N1** GreenMail keeps `\Seen` off and the UID unchanged after `BODY.PEEK[]` fetches. Stage 06 step 1 checks it. If GreenMail sets `\Seen`, the worker stops and reports (a GreenMail quirk or a bug in our read path; do not weaken the test).
- **N2** Interia keeps a copy of webmail and phone-app sends in `Wysłane`. No note says so: `notes/2026-11-03-interia-imap-capabilities.md` says only that SMTP saves no copy. Stage 12 check 4 shows the count on the pilot.
- **N4** Interia webmail and the phone app set `In-Reply-To` or `References` on a reply, so `listUserAnswers` finds real answers. Stage 12 check 9 counts the matches.
- **N3** The size of the pilot's Sent folder (30 days). Stage 12 check 5 prints it; the text limit of D7 bounds the run time either way.

## Done when

1. With the flag and the switch on, a sync run stores the user's sent mail of the last 30 days, text for the last 14 days, and later runs add new mail. Shown by: stage 04–06 tests.
2. The pass never writes to Sent: no write method in the fake's `folderCalls` for the Sent path; on GreenMail the flags and UIDs are unchanged. Shown by: stage 04 test 9, stage 05 test 10, stage 06 step 1.
3. A system send is a row with `origin = 'system'` and no text, and never counts as user mail; the user's own send of a system draft is user mail with `action_id` set. Shown by: stage 04 test 4, stage 07 tests 2 and 6.
4. `listUserAnswers` gives the reply time for an answered incoming mail. Shown by: stage 07 step 1 tests.
5. Sent text and headers follow D14 in the daily retention run. Shown by: stage 07 step 2 tests.
6. The switch: on starts a first pass; off deletes the rows; both write an audit row; owner only; 404 with the flag off. Shown by: stage 08 step 1 and stage 09 step 1 tests.
7. A new mailbox starts on when the flag is on, off when it is off. Shown by: stage 08 step 2 tests.
8. The settings page shows the card and the connect dialog the line, in `en` and `pl`. Shown by: stage 10 tests, lint and typecheck.
9. The `sent_missing` notice: one per owner per quiet period of 7 days. Shown by: stage 11 tests.
10. Pilot: after the owner's switch, `mailbox:settings show` prints a stored count above 0, and the logs hold no `sent_sync_failed` line. Shown by: stage 12 checks.

## Rules for every stage

- Read `ticket.md`, this file and your one stage file. A gap or a deviation from a decision is a question in your final message, not a choice. Stop and report it.
- Never call a provider write method (`moveMessage`, `transferByAppend`, `deleteMessage`, `setFlags`, `appendMessage`, `ensureFolder`) from Sent code. Sent code takes a `SentFolderReader`, never a `MailProvider`.
- Sent mail never enters `emails`, triage, the digest, moves or Undo.
- Logs: event form `log.info("sent_sync_done", { … })`, fields only from `platform/log-fields.ts` (after F103 stage 01: in the kind list of the value). Never a subject, an address, a folder path, mail text or `error.message`. Errors as `...errorFields(error)`.
- Every repository function takes a `TenantContext` and filters by `org_id`; each new one gets a tenant-filter test (two orgs).
- Tests: repos in `withRollback`; fixed clocks (`NOW = new Date("2026-11-20T10:00:00Z")` unless the stage says otherwise); `waitFor` for time-driven code; no sleep over 100 ms. A test that turns on `sent_sync` uses `upsertOrgFeature` and starts with `configureFeatures({ off: [] })`.
- Migrations: a new dbmate file with up and down, then `bun run db:types`; never edit `platform/db/schema.ts` by hand. A migration stage never builds next to another migration (any ticket).
- Format only the files of your stage (`bunx prettier --write <files>`), never the repo.
- Merge `master` before the proof when another ticket landed a change in your files (advisory overlaps: § How to run step 5).
- No bare codes in code comments (`D4`, `F104`, `PD-116`): state the rule; name ADR 0029 or the ticket folder path when a source is needed.
- Update `docs/capabilities/sent-mail.md` (from stage 06 on) in the same change as the behaviour; refresh its "Checked against" line.
- End the final message with `Decisions for the owner` (`.agents/limen/styleguide.md`).

## Proof

Run after the last commit, as one bash call with nothing after it; read the logs in a separate call. In the final message list as proven only what a saved log shows. `NN` = the stage number.

```
mkdir -p /tmp/f104-sNN && bun run lint > /tmp/f104-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f104-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f104-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f104-sNN/int.log 2>&1 && echo PROOF_OK
```

While it works, a worker runs only the tests of the code it changed; the full chain runs once, as the proof. If `/tmp` is out of inodes (`df -i /tmp`), remove `/tmp/node-compile-cache` (`notes/2026-11-14-handoff-after-compaction.md`).

## Owner checkpoints

None. The defaults marked "default, owner to confirm" are in [questions.md](questions.md) and do not stop the build.

## Owner steps

| # | Who | When | What |
| --- | --- | --- | --- |
| U1 | Owner | Stage 12, after the deploy and the flag | In the panel: Settings → the pilot mailbox → "Sent mail" → turn on "Track my sent mail". It is the owner's consent for an existing mailbox (PD-116); the coordinator does not switch it by CLI. |

`bun run db:migrate` on the shared dev DB after stages 01 and 11 land: the coordinator runs it (no secret).

## Review

Review job (board reviewer: `--engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high`) before the land of stages 01 (migration), 03 (the origin rule in `actions`), 04 (read-only pass, dedup, cursor), 05 (mail text into a new table), 06 (the pass in the live sync loop), 07 (retention of mail text), 08 (consent switch, delete) and 11 (migration, notice to people). The reviewer may run `test:int` at the candidate commit. Stage 12 is the coordinator's runbook with its own checks.

## Stages

| # | Stage | Size | Review |
| --- | --- | --- | --- |
| 01 | [Migration: `sent_emails`, `mailbox_sent_sync`](stages/stage-01-migration.md) `[risky]` | ~200 lines | review |
| 02 | [Repository: state and rows](stages/stage-02-repository.md) | ~330 lines | — |
| 03 | [Read-only port type, pure Sent rules, origin of an action id](stages/stage-03-rules.md) | ~300 lines | review |
| 04 | [Header pass](stages/stage-04-header-pass.md) `[risky]` | ~450 lines (one risky step, mostly tests) | review |
| 05 | [Text step](stages/stage-05-text-step.md) | ~250 lines | review |
| 06 | [Job wiring, GreenMail proof, ADR and docs](stages/stage-06-wiring-and-docs.md) | ~300 lines | review |
| 07 | [Answered reader, summaries, retention](stages/stage-07-readers-and-retention.md) | ~320 lines | review |
| 08 | [Switch: setter and connect](stages/stage-08-switch.md) `[risky]` | ~250 lines | review |
| 09 | [Settings API and CLI](stages/stage-09-settings-api-and-cli.md) | ~350 lines (thin glue over stage 08) | — |
| 10 | [Panel: card and connect line](stages/stage-10-panel.md) | ~250 lines | — |
| 11 | [Notice `sent_missing`](stages/stage-11-notice.md) `[risky]` | ~300 lines | review |
| 12 | [Pilot deploy](stages/stage-12-pilot-deploy.md) `[risky]` | runbook | coordinator |

## How to run (coordinator)

1. Move the folder to `spec/features/active/` and commit before the first spawn (a worktree sees only committed files). Run `scripts/plan-drift.sh spec/features/active/F104-e5a-read-sent f36794e` first; exit 1 → a refresh job (`.agents/limen/planner.md` § Refresh job).
2. Per stage, after the stage before has landed (`limen land --keep-open`); no two F104 stages run at once (stages 08–11 edit the same docs, cold review 1, minor 10):
   ```
   limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
     --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
     --prepare 'bash scripts/limen-prepare.sh' --label "<what the stage changes> · F104" \
     'Implement F104 stage NN. Read spec/features/active/F104-e5a-read-sent/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: the Proof command of plan.md for your stage (/tmp/f104-sNN), one bash call with nothing after it, run after the last commit; read the logs in a separate call. In the final message, list as proven only what a saved log shows.'
   ```
3. Stages 01 and 11: no other migration in build at the same time (any ticket). After each lands, run `bun run db:migrate` on the shared dev DB. Stage 11's migration lists the notice kinds of `master` at its base (F100 stage 16 adds `weekly_report` to the same CHECK).
4. Review before the land for the stages in § Review. Drop the job DB after the land (`spec/build.md` TRACK).
5. Advisory overlaps (start anyway; a land conflict → resume the worker to merge `master` and prove again): `mail/jobs.ts` (F100 stage 06, F103 conversion stages), `mail/sync.ts` one line (F100 stage 05, F103), `mail/connect.ts`, `web.ts`, `config/routes.ts`, `config/view.ts` (F102 E4-A), `packages/core/src/notices/*`, `channels/notices/index.ts` and `texts/notices.ts` (F100 stage 16), `apps/web` (F101 Astro 7, F102), `retention.ts` (F106 when planned), `docs/architecture.md`.
6. Add to each F104 spawn after F103 stage 01 has landed: "New log field names go to the kind list of their value in `platform/log-fields.ts` (F103 stage 01)."
7. Stage 12 is no worker job: the coordinator runs its runbook on the VPS (pre-approved), then asks the owner for U1, then runs its checks.

## Seams with other tickets

- **S1 E6a (F115):** the committer calls `syncSentHeaders` (or `syncSentFolder`) for the mailbox right before a system send of a reply draft (ADR 0029 decision 3, PD-077), with a `SentFolderReader` of its own provider and the same `sentOriginOf`; a `cursor_moved` result means "another pass ran"; then E6a reads `listUserAnswers`, and a user row whose `action_id` is the draft's id means "the user sent this draft by hand" (PD-076 `sent_by_user`). E6b reads `sent_emails.body_text` (`content = 'stored'`, `origin = 'user'`).
- **S2 E5b (F116):** the analysis reads rows with `content = 'stored'` and `origin = 'user'`, and the markers (`auto_submitted`, `precedence`, `list_id`, `has_calendar`); loops reference `sent_emails (id, org_id)` (the unique pair exists for a FK). E5b adds the E5a mark to the F100 answered-check candidates (F100 plan seam S4, D22) and its M2 rows.
- **S3 E3a (F100):** M1 and the answered check can read `listUserAnswers` next to `email_flags.answered` (F100 S4); this plan does not edit F100 code.
- **S4 E4-B (F110):** the history check reads `listUserAnswers` and `sent_emails.to_addresses` ("the user wrote to this sender").
- **S5 E11a (F120):** reply delays = `listUserAnswers.answeredAt − emails.received_at`; sent counts per recipient from `sent_emails`.
- **S6 E7-T3 (F106):** the DSR address map lists `sent_emails.from_address`, `to_addresses`, `cc_addresses` (addresses) and `subject`, `body_text` (message text); `mailbox_sent_sync` holds no personal data. The organization delete removes both tables by the FK cascade of `mailboxes`. E7-T4 (F107) papers name "sent mail headers and text".
- **S7 E9a (F117):** a Graph or Gmail adapter implements the five `SentFolderReader` methods; `folder_map.sent` holds the provider's Sent folder (Gmail `[Gmail]/Sent Mail`).
- **S8 E2b (F113):** the scripted executive APPENDs a Sent copy (GreenMail SMTP saves none), so the live lab can score Sent-side cases.

## Planning progress

- [x] Collect: ticket, epic page, discovery notes, ADR 0029, decisions, §2.1, architecture review, F099 and F100 plans, F103 seams, code at `f36794e` (mail module, connect, sync, jobs, port, imap client, fake, committer folder resolver, config routes and view, notices, retention, migrations, web settings and connect dialog).
- [x] Facts F1–F19 (imapflow source read in the Bun cache).
- [x] Stage files 01–12 (the discovery estimate was about 7; the header pass, the switch and the API each got their own stage to stay near 300 lines).
- [x] Cold review 1 ([plan-review-1.md](plan-review-1.md), FAIL: 3 major, 14 minor); fixes below.

## Cold review

Review 1 (`plan-review-1.md`, Opus 5.5 high, fresh context, candidate `5f7062a`): FAIL, 3 major, 14 minor. All fixed or answered in the commit after it:

- **M1 (blocking) path change mixes folders in the text step:** fixed. `sent_emails.path` (stage 01); the upsert moves `path` with the UID (D4); the text step lists and guards by path, UIDVALIDITY and UID (D7, stages 02 and 05, stage 05 test 11).
- **M2 the user's send of a system draft counted as a system send:** fixed. `origin` column; `sentOriginOf` in `actions` (stage 03 step 3) says `system` only for a send that went out; a draft sent by the user is user mail with `action_id` as a link (D6, D10, seam S1).
- **M3 no way to withdraw consent with the flag off:** fixed. Off works with the flag off (D11); the view shows the card while the switch is on (`flagOn` false = "paused", D12, D13); the rollback text is true now (stage 12).
- Minor 1 console spy: fixed (`console.error`, F21, stage 06). Minor 2 read-only check: fixed (a `folderCalls` snapshot, stages 04 and 05). Minor 3 failure on the 2nd call: fixed (a wrapping reader, stage 05 test 8). Minor 4 CLI facts: fixed (explicit `case`, `show` calls `getSentSyncView`, stage 09). Minor 5 text past retention: fixed (`textWindow = min(14 d, retention)`, D7, F22). Minor 6 N2 without source: fixed (N2 says no note covers it). Minor 7 answered mark on real mail: fixed (N4, stage 12 check 9). Minor 8 misleading notice: fixed (no notice while `last_error_code` is set, D15, stage 11 test 8b). Minor 9 old-path counts: fixed (summary and health read the current path, D12, stage 07). Minor 10 parallel doc edits: fixed (all stages sequential, How to run step 2, ticket Slices). Minor 11 no review for 06 and 07: fixed (§ Review; 03 too). Minor 12 printed command before it exists: fixed (stage 08 prints no command; stage 09 adds it). Minor 14 `layers.json` path: fixed (F12, F13).
- Minor 13 stages 04 and 09 large: not split. Stage 04 is one `[risky]` step whose bulk is 16 test cases on one fixture; stage 09 is thin glue over stage 08 with existing patterns for each part. Both fit one job; the review called the split optional.


## Log

- 2026-11-14: plan written at `f36794e`.
- 2026-11-14: cold review 1 (FAIL) fixed: `path` and `origin` columns, `sentOriginOf`, off with the flag off, text window under retention, sequential stages, more review jobs.
