# F116 · Scout packets

Four scouts (claude-sonnet-5-5, thinking medium), started together at plan base 9531f16a. Each packet is copied whole from the job log. A packet is a lead, not a fact; plan.md § Facts checked lists what the planner read in the code.

## Scout 1

- Job: `2026-11-15-f116-scout-1-78174fb9`
- Question: How does the delegation module work at HEAD, and where does a new 'loops' module fit? Cover: the delegations table columns (status, source, due_at, answered_at, reminders_sent, thread or message ids), detectReply and where triage calls it, the chaser (schedule, gap, max reminders, approval sets, how it builds a reminder draft from packages/core outgoing templates and which template kinds exist), the approval/committer path for a drafted mail (action kinds, In-Reply-To/References on the sent mail), the mode table (shadow/assist/auto) and send limits, and apps/server/src/modules/layers.json (layer order, where delegation and triage sit). Also: what spec/features/active/F102-e4-a-act-from-the-panel/plan.md says about the /delegations page, delegation API commands and the command contract (ADR 0023) that a new kind of loop must plug into. 

### Packet

Packet: How delegation works at HEAD, and where a `loops` module fits
Base: 9531f16a
Verified: `grep -n "interface Delegations" -A40 apps/server/src/platform/db/schema.ts` -> `status: Generated<string>;` (no `source` field) | `git status --short | wc -l` -> `0`
Unknowns:
- Whether a `source` column exists in a migration. I read only `schema.ts`, which shows none. I did not read the SQL migrations.
- I did not open F102 `stages/stage-15` or `stage-18`, only `plan.md` and `commands.md`.
- I did not read the full `committer.ts` or `send.ts` flow. The committer path below comes from grep hits.
- I did not read the send-limit enforcement code, only the limits file in core.

1. **Table** `apps/server/src/platform/db/schema.ts:168` `Delegations` — observed.
   - Columns: `status`, `status_reason`, `due_at`, `sent_at`, `sent_message_id`, `answered_at`, `answered_email_id`, `answered_notified_at`, `reminders_sent`, `last_reminder_at`, `task_summary`, `email_id`, `delegate_id`, `draft_action_id`, `send_action_id`, `mailbox_id`, `org_id`.
   - There is no `source` column and no thread-id column. Threads match through `sent_message_id`, which is the message-id header of the sent mail.
   - Status enum (`delegation/repo.ts:9`): `drafted | sent | answered | overdue | done | cancelled`.
   - F116's `source = manual` is therefore new work.

2. **detectReply** `delegation/service.ts:140` — observed.
   - It normalizes the In-Reply-To and References ids.
   - It calls `findOpenDelegationByMessageIds(db, ctx, mailboxId, ids, fromAddress)`. The sender must be the delegate's address, so a reply from another person does not match (the F040 gap).
   - Triage calls it in `triage/service.ts:145`, in `markReply`. `markReply` runs in the triage transaction after `finishEmail`.
   - `markAnswered` (`delegation/service.ts`) then locks the delegation, sets `answered`, expires the reminder sends and writes an audit row.
   - Lock order: delegation first, then its reminder sends.

3. **Chaser** `delegation/chaser.ts` — observed.
   - Schedule: `main.ts:215`, cron `20 */15 * * * *`, job `delegation.chaser`.
   - Daily gate: at or after 07:30 in the org time zone (`CHASER_LOCAL_TIME`). It runs once per local day, tracked by the audit event `delegationChaserRun`.
   - `REMINDER_GAP_MS` is 3 days. `MAX_REMINDERS` is 2 (`MAX_REMINDER_SENDS` in `repo.ts:13`). `CHASER_SET_LIMIT` is 10 reminders per run. `DUE_BATCH` is 200.
   - The pure rule `reminderDecision` marks a `sent` delegation as `overdue`. It reminds only when the delegate is active, no reminder is pending, `reminders_sent` is under 2, and the gap has passed.
   - Per-mailbox gate: only `mode === "assist"` with the `create_draft` switch on. The job re-checks the settings version under a share lock (M13).
   - It builds a `DraftPayload` with kind `reminder`, the delegate, `to`, `task`, `due_date` and `delegation_id`.
   - It copies the language from the original draft payload (fallback `en`).
   - Thread: `in_reply_to` = `sent_message_id`. `references` = the email's References + its message-id + `sent_message_id`, de-duplicated.
   - It calls `createPlanned` with two rows. The `create_draft` row is `ready`. The `send` row is `awaiting_approval`, with `set_id` and `dependsOn: "create_draft"`.
   - Idempotency keys: `<email>:create_draft:reminder:<day>` and `<email>:send:reminder:<day>`.
   - It then calls `markReminderPlanned`.
   - The chaser is hard-wired to the `delegations` table. A `loops` chaser must reuse the scheduler slot, the gate and the set logic, not copy them. ADR-wise, F116 says "no second chaser".

4. **Templates** `packages/core/src/outgoing/templates.ts:16` — observed.
   - `DRAFT_TEMPLATES` is a `Record<DraftKind, …>`. Kinds (`triage/payloads.ts:13`): `delegation`, `clarification`, `reminder`.
   - A new kind such as `follow_up` fails typecheck until it has a template. It also needs changes to the draft payload schema, `sendPayloadFor` (`payloads.ts:80`), `outgoingSubject`, and the digest and notice views (`notices/views.ts` uses `draftKinds`).
   - `outgoing/message.ts:~95`: a `reminder` has no quote and takes `inReplyTo` and `references` from `draft.thread`. A `clarification` uses `original.messageId`. A `delegation` has `inReplyTo` null, with references = the original chain. `X-EA-Action-Id` is set.

5. **Approval, committer and modes** — mostly observed.
   - Action types (`core/triage/planners.ts:6`): `move`, `mark_read`, `flag`, `save_summary`, `create_draft`, `send`.
   - `policy.ts`: only a `send` gets `await_approval`, and only when the draft of the same input would apply.
   - Mode values at HEAD (`core/triage/categories.ts:11`): only `shadow` and `assist`. "Auto" is a per-category policy, not a mailbox mode — observed. In shadow, the draft is `logged`, so the send is logged too.
   - Send limits (`core/send-limits.ts`): 20 per hour per mailbox, 100 per day, 5 per recipient per day. The committer's `actions/send-limit.ts` `startSendWithinLimits` returns `held` with a `SendLimitHit`.
   - Timing constants (`actions/constants.ts`): `APPROVAL_TTL_MS` 48 h, `UNNOTIFIED_TTL_MS` 7 days, `SEND_SOFT_CAP_MS` 6 h.
   - `actions/approvals.ts:182,290`: a send whose payload has a `delegation_id` is gated on the delegation's state.

6. **layers.json** — observed.
   - Layer order, lowest first: `[audit, tenancy]`, `[config, mail]`, `[triage, actions, delegation]`, `[reports, channels, testmail]`, `[operator, privacy]`, `[lab]`.
   - Same-layer edges: `triage→actions`, `triage→delegation`, `delegation→actions`.
   - `loops` fits in layer 3 next to `delegation`. It needs the edges `triage→loops` and `loops→actions`, with a `why` text each. Add `loops→delegation` if it reads delegations. The tests `layers.test.ts` and `borders.test.ts` enforce this.
   - Guessed: `delegation` should not import `loops`. If `delegation` becomes a loop kind later, `loops` imports `delegation`.

7. **F102 and ADR 0023** — observed in `plan.md` and `commands.md`.
   - ADR 0023 is in status "proposed". Every user action is an `/api` route with Zod schemas in `packages/core/src/web/*`. The route calls one service function that takes `via` (`web | telegram | cli`). OpenAPI is served at `/api/openapi.json`. A test fails when a route has no schema.
   - Commands: `GET /delegations?filter=&before=&limit=`, `POST /delegations/:id/remind` (owner), `/done` (member), `/cancel` (owner).
   - 409 codes: `not_open`, `limit_reached`, `reminder_waiting`, `drafts_off`, `delegate_inactive`, `already`, `not_closable`, `sending`.
   - `DelegationItem` has `kind: "delegation"` with the note "E5b adds kinds". Its fields: `status`, `delegate`, `task`, `subject`, `dueAt`, `sentAt`, `answeredAt`, `remindersSent`, `reminderWaiting`, `sendId`.
   - D9: remind is allowed only in `sent` or `overdue`, with no waiting reminder, and `assist` with `create_draft` on.
   - Service functions `remindNow`, `cancelByUser`, `updateDelegate` live in module `delegation` (F102 target; not checked as built).
   - The page and routes are behind the flag `delegation_pages`. Edit of a `reminder` returns 400 `not_editable`.
   - F116 says the page becomes "Open loops" with tabs Delegated, Waiting and Promised. The panel and commands for the new kinds must fit this contract.

Checks: `apps/server/src/modules/layers.test.ts` covers layer and edge rules; it misses any `loops` design until it is added. `packages/core/src/outgoing/templates.test.ts` covers templates; I did not run it.

## Scout 2

- Job: `2026-11-15-f116-scout-2-20de7303`
- Question: What does F104 (E5a Read Sent) give a later ticket, at HEAD and in its plan? Cover: the sent-mail table name and columns (to, cc, thread_key, message_id, in_reply_to, references, sent_at, action id, auto-submitted, list markers, body text), the read functions (for example listUserAnswers and any other exported reader, with signatures), the 'answered by the user' mark on incoming mail, the per-mailbox switch and org flag sent_sync, the retention of sent text and recipients (read spec/features/active/F104-e5a-read-sent/review-7.md, review-8.md and docs/capabilities/sent-mail.md), the missing thread_key index on emails, and which F104 stages are landed on master versus still planned. Also: how the Sent pass is triggered inside a sync run (hook a later ticket can call after new sent rows are stored). 

### Packet

Packet: What F104 (E5a Read Sent) gives F116 at HEAD and in its plan
Base: 9531f16a
Verified: `grep -n "thread_key\|INDEX" db/migrations/20261115090001_sent_mail.sql` -> `42:CREATE INDEX sent_emails_thread_idx ON sent_emails (mailbox_id, thread_key);`
Unknowns:
- The `plan.md` status line still says "planned … nothing built" (plan.md:3). It is stale. `git log` shows stages 01–08 landed. I did not run the tests.
- I read no F104 commit for stages 09–13. I judge them not landed because `sent-mail.ts` Limits says "no panel, route or CLI command calls `setSentSync` yet (stages 09 and 10)". I did not grep the web or CLI code.
- `docs/capabilities/sent-mail.md` says it is checked at `f64c7256`, not HEAD. I re-read the code for the readers, the table and the hook.

1. `db/migrations/20261115090001_sent_mail.sql:3-36` — Table `sent_emails`. Observed columns:
   - `to_addresses text[]`, `cc_addresses text[]` (never Bcc), `from_address`.
   - `thread_key text NOT NULL`, `message_id`, `parent_message_id` (the In-Reply-To value), `references_ids text[]`.
   - `sent_at`, `internal_date`, `subject`, `body_text` (at most 100 000 characters, only when `content='stored'`).
   - `action_id uuid`, `auto_submitted`, `precedence`, `list_id`, `has_calendar`.
   - `origin` ('user' | 'system'), `content` (pending | stored | headers_only | gone).
   - Location columns `path`, `uidvalidity`, `uid`, and `dedup_key` (unique per mailbox).
   - A system row must have an action id and be `headers_only`. RLS is on `org_id`. Indexes: `(mailbox_id, thread_key)`, `(mailbox_id, parent_message_id)` and `(mailbox_id, path, internal_date) WHERE origin='user'`. — observed

2. `apps/server/src/modules/mail/repo/sent-readers.ts` — Three exported readers, all taking `DbOrTrx` and a `TenantContext`. — observed
   - `listUserAnswers(db, ctx, emailIds: readonly string[]): Promise<Map<string, {answeredAt: Date; sentEmailId: string}>>`
     - This is the "answered by the user" mark. It is computed on read. `emails` has no column for it.
     - It joins `emails` to `sent_emails` on org, mailbox and `s.parent_message_id = e.message_id_header`, with `origin='user'`.
     - It takes the earliest `sent_at`, then the row id.
     - It reads a direct reply only. A later reply elsewhere in the thread does not mark older mails. A mail without a Message-ID is absent.
     - Chunks of 500.
   - `getSentSummary(db, ctx, mailboxId, {since: Date}): Promise<{userCount; newestUserAt: Date|null}>`
   - `listSentHealth(db, ctx): Promise<{mailboxId; firstPassAt; lastPassAt; newestUserAt; lastErrorCode}[]>`
   - There is no thread-level reader and no "list sent rows" reader. F116 must add them or query the table. Per sent-mail.md Limits, a thread rule is built from `thread_key`.

3. Switch and flag — observed (`sent-switch.ts:22` `setSentSync`; sent-mail.md rules 1, 13, 14):
   - Org flag `sent_sync` (ADR 0027, `FEATURES_OFF`). Table `mailbox_sent_sync` (`enabled`, `path`, `uidvalidity`, `last_uid`, `first_pass_at`, `last_pass_at`, `last_error_code`). No row means off.
   - `syncSentHeaders` checks the flag, then the switch, then `folder_map.sent`.
   - `setSentSync(db, ctx, mailboxId, {enabled, actor, at})` returns `changed|same|not_found|flag_off`. Off deletes that mailbox's `sent_emails` rows. Each change writes an audit row.
   - Connect sets the switch from the flag.
   - review-8 N5: do not turn the flag on for a non-lab org before stage 10. N6: F117 OAuth mailboxes get no state row (off).

4. Retention — observed (sent-mail.md rule 12; review-7.md:16):
   - `clearSentBodies` nulls `body_text` after the org's `data_retention_days`. `clearSentHeaders` clears subject and addresses after 90 days. Both count from `internal_date`.
   - The row stays. `content` stays `stored`. `message_id`, `parent_message_id`, `thread_key`, `origin` and the times stay, so `listUserAnswers` still works.
   - A loop open longer than `data_retention_days` needs its own copy of the text. The recipients last 90 days.
   - Ingest windows: headers 30 days, text 14 days (shorter if the retention is shorter).

5. Sent pass trigger and hook — observed:
   - `mail/jobs.ts:~42` `syncSentFolder` runs inside `mail.sync` after INBOX `syncMailbox`, `markSynced` and the flag refresh. It uses plain `deps.db`.
   - Errors are caught. The job logs `sent_sync_done` (`count` = `result.stored`, the new rows).
   - `syncSentFolder` returns `{status, mode, stored, texts:{stored,gone,expired}}`.
   - Text stage runs in `sent-sync.ts:201`.
   - There is no event or callback after the sent rows are stored. A later ticket must add one: either an optional dep on `SentSyncDeps`, or code after `syncSentFolder` in the job guarded by `result.stored > 0` and `status === 'done'`.
   - Row-level hooks are only the retention and tombstone triggers (guessed from sent-mail.md rule 5, not read).

6. `emails` has no `thread_key` index — observed:
   - `grep` over `db/migrations` shows `emails` indexes only on `(mailbox_id, message_id_header)`, `(mailbox_id, content_hash)`, `org_id`, `claim`, `moved` and `returned`.
   - `thread_key` exists as a column (`20261103100001_mail.sql:53`). F116 thread joins from `sent_emails` to `emails` need a new index. The migration lane must not run next to another migration.

Stage status (observed from `git log`; stage files `stage-01..13`):
- Landed on master: 01–08. These are migration, repository, rules, header pass, text step, job wiring and docs, readers and retention, and the switch. Stage 08 review-8 gave PASS at `164ba422`.
- Still planned, not seen: 09 settings API and CLI, 10 panel, 11 "no sent mail seen" notice, 12 DSR erase of sent mail, 13 pilot deploy. Stage 12 carry-over: retained `stored` rows export `body_text` null.
- No UI or CLI can turn the switch on yet. The data exists only where an operator or a test sets it.

Checks: `apps/server/test/integration/mail-sent-readers.test.ts`, `mail-sent-sync.test.ts` and `imap-sent-greenmail.test.ts` are listed in sent-mail.md as covering the readers, the pass and the "flags and UIDs kept" check. I ran none of them. They miss the F116 needs: thread-level reads, a post-store hook, and `emails.thread_key` lookups.

## Scout 3

- Job: `2026-11-15-f116-scout-3-8056822f`
- Question: Which shared pieces must F116 reuse from other planned or active tickets? Read spec/features/planned/F115-e6a-reply-drafts/plan.md and its stages: reply_requests table, the thread index, the sweep job, any 'waiting on you'/needs_reply-with-no-answer reader, and their names, signatures, and which stage creates them. Read spec/features/active/F109-e3b-improve/plan.md, its stages and review-4.md N4: suspiciousThreadKeysOf (signature, stage, module). Read spec/features/active/F103-e8a-logs/plan.md: the event-line log rule a new module must follow (log call form, lint rule). Read docs/owner-decisions.md entries of 2026-11-15 on Telegram consent: the consent bump rule and the F109 attachment-line decision (how a consent version is bumped and linked chats re-asked, which module and stage do it). Also: does F106 (DSR, org delete) define a registry new tables must join? 

### Packet

Packet: Which shared pieces must F116 reuse from F115, F109, F103, the consent rule and F106?
Base: 9531f16a
Verified: `sed -n 94,104p apps/server/src/modules/triage/suspicious-repo.ts` -> `export async function suspiciousThreadKeysOf(db: DbOrTrx, ctx: TenantContext, mailboxId: string, threadKeys: readonly string[]): Promise<Set<string>>`
Unknowns:
- F115 is planned and has no code at HEAD. Every F115 name below comes from the plan, not from code, and can change. Evidence: `grep` found no `reply_requests` in `apps/server`.
- No "waiting on you" reader exists in F115 or at HEAD. Evidence: F115 `interfaces.md` and the stages name no reader. `E05-discovery-notes.md:95` defines the section as `needs_reply` mail with no answer in Sent, and F116 must build it.
- Whether F109 stage 06 sets a per-chat consent re-ask. The owner decision (`docs/owner-decisions.md` ~378) says the gate blocks new links only, and the re-ask is open (option a or b). At HEAD `TELEGRAM_CONSENT_VERSION = "2026-11-14"` (`packages/core/src/web/telegram.ts:19`). Stage 06 has not landed.

1. F115 `reply_requests` — F116 can ignore it. The drafter work list is not an open-loop store. F115 `interfaces.md:21` defines it. Stage 03 (`stage-03-migration.md`) creates it. — guessed (plan only)
2. Thread index — F115 stage 03 creates `emails (mailbox_id, thread_key, received_at)` (`stage-03-migration.md:11`). F109 review-4 N4 (`review-4.md:15`) says `emails` has no such index and that F116 must add one if it calls `suspiciousThreadKeysOf` per mail. Reuse the F115 index and add none. If F116 lands first, F116 creates the index and F115 must not repeat it. Check the order in `spec/build.md`. — guessed (plan), the missing index is a read of the review text
3. Sweep job — F115 `replies.sweep` (every 5 min) belongs to module `replies` and closes only reply sends (`plan.md` D11, `interfaces.md:28`, stage 09 step 2). It is not a loop sweep. The `closeSend` and answered logic (`email_flags.answered` or `listUserAnswers`, DB only) are the pattern to reuse. F116 needs its own `loops` job and must not copy the sweep. It must use the same answered check. — guessed (plan)
4. `suspiciousThreadKeysOf` — observed. It lives in `apps/server/src/modules/triage/suspicious-repo.ts:96`. It is exported through `triage/index.ts:57`. It was built by F109 stage 04. The signature is above. It returns the thread keys with at least one incoming mail whose newest `triage_results` row has reasons. It ignores the `suspicious_mail` flag, so a follow-up block applies with the flag off too. Its sibling is `suspiciousReasonsOf(db, ctx, emailIds)` (`suspicious-repo.ts:72`). Import it only from the triage entry (module borders). The test is `test/integration/triage-suspicious-readers.test.ts`. — observed
5. F103 log rule — observed in `docs/code-patterns.md` § Logs (lines 237–261). A line is `log.<level>("<snake_case_code ≤64>", { fields })`. The code is a constant, with no free text. For per-item ids, use a child logger named `<thing>Log = log.with({ org_id, mailbox_id })`. Error fields use `...errorFields(error)`. Telegram errors use `...telegramErrorFields(error)`. Lint rule: `no-restricted-syntax` with `logEventSelectors` in `eslint.config.js` (lines 201–256). It warns in `apps/server/src` and is `error` in converted paths (`platform/`, `main.ts`, `scripts/`). F103 stage 13 sets `error` for all of `apps/server/src`. A new module must write only event lines, so it passes at once. Use no `console`. A script prints through `createCliOutput`. — observed
6. Consent bump rule — observed in the 2026-11-15 owner decisions (lines 372–383) and `docs/code-patterns.md:134`. Bump `TELEGRAM_CONSENT_VERSION` and the consent text in one commit. Do it when a new kind of mail-derived data reaches Telegram: address, name, domain, subject, body, attachment name or link host. Do not bump for fixed phrases from our own enum codes. The `packages/core` constant is the module that bumps it. Old versions get 409 `telegram_consent_outdated` at `POST /channels/telegram/link` (`channels/routes.ts:45`) for new links only. Linked chats are not re-asked, and the senders never read the version. F116 brief lines show a subject and a recipient name, so they need a bump unless the owner decides otherwise. Any bump also hits the unsolved re-ask gap. F109 stage 06 (attachment line) does the next bump, to `2026-11-15`. — observed (rule), guessed (that F116 needs a bump)
7. F106 registries — yes, observed in stage files and in `apps/server/src/modules/privacy/export-map.ts:28` and `address-map.ts`. A migration that adds a table must classify it. `EXPORT_MAP` needs every `public` table as a key, and a test fails if one is missing (stage 05 test 1). Each candidate column with a third-party address goes in `DSR_ADDRESS_MAP` or `NOT_PERSONAL`. A new `org_id` or `user_id` table gets a seed in the deletion test. A new mail table gets the tombstone trigger. A new notice kind gets a `NOTICE_MAIL_CONTENT` class. See `docs/code-patterns.md` § Data access, per F106 stage 10 (the text is in the stage file; not checked in code-patterns.md). So `open_loops` must do all of this. A loop row that holds recipient addresses must have entries in `DSR_ADDRESS_MAP`. A new audit or security event also needs `securityEvents` and a `sec_kind_*` text (`code-patterns.md:177`). — observed

Checks: `triage-suspicious-readers.test.ts` covers the two suspicious readers. The `EXPORT_MAP` completeness test (F106 stage 05) will fail a new table that is not registered. Nothing covers the F116 reuse of the F115 index or the order in which F115 and F116 land.

## Scout 4

- Job: `2026-11-15-f116-scout-4-d62386a6`
- Question: How are the morning digest and Telegram buttons built at HEAD? Cover: reports/digest.ts buildDigestMessage and core digest renderDigest (slots, which slot is first of the day, the delegation footer, the 4096-char cut, per-row data), the mail channel (ADR 0022) render of the same digest, quiet hours, how Telegram inline buttons and callback data are built and dispatched (callback data format and length limit, handler registry, which module), how an urgent notice is sent and what buttons it has, how a callback runs an API command on the E4 contract (ADR 0023) and checks the chat's org and user, and the user language for text (F098 i18n: where pl/en strings live). 

### Packet

Packet: How the morning digest and Telegram buttons are built at HEAD
Base: 9531f16a
Verified: `git status --short | wc -l` -> `0`. I read every file named below.
Unknowns:
- No mail-channel render exists at HEAD. ADR 0022 is "proposed". I found no `X-EA-Action-Id` report-mail code in `channels/` or `reports/`. This is a negative grep; I did not check `mail/`. The channel choice per member (Telegram, mail or both) has no code I found.
- Telegram callbacks do not run an E4 API command (see 7). The ADR 0023 text is the target, not what runs.
- Org check on the callback path: `LinkedChat` carries `orgId` and `userId`. I did not trace `linkOf` in `telegram/bot.ts:109`, so I cannot say how the link is looked up.

1. **Digest build** — `apps/server/src/modules/reports/digest.ts` `buildDigestMessage` (verified).
   - It loads rows with `listTriagedBetween` (limit `DIGEST_ITEM_LIMIT` = 100) and `countTriagedBetween`.
   - It adds actions, `info` summaries, delegate names, draft tasks, suspicious reasons, skipped counts, `countWaiting` (7 days), the LLM pause and, behind the flag `handled_share`, the handled share.
   - It then calls `renderDigest` with the org timezone and `textsFor(request.locale)`.
   - Each `DigestItem` has: emailId, category, from, subject, receivedAt, synthetic, folderTag, aiText, wouldDo, undoable, suspicious, hasDraft. It has no body field (`core/src/digest/digest.ts`).
2. **Slots** — `core/src/digest/schedule.ts` `dueDigestSlot` (verified).
   - It picks the newest slot from the member's `digest_times` that is due, at most 6 hours old and after `afterKey`.
   - It skips earlier missed slots.
   - `channels/digest-job.ts` `scheduleForLink` calls it. It builds the message with `kind: "scheduled"` and `slot {date,time,late}`, then queues it.
   - `insertDigest` and `queueNotice` run in one transaction, with `dedupKey` `digest:<slotKey>`. The outbox row stores the final `text` and `buttons`.
   - **No "first slot of the day" exists at HEAD.** `DigestInput` has no flag for it. The header only shows slot time, day and `late`. For F116 the job must compute it (guessed: no earlier digest row for that local date, via `lastDigestSlotKey`).
3. **Render** — `core/src/digest/digest.ts` `renderDigest` / `renderListed` (verified).
   - Items sort by category, newest first. The order is urgent, needs_reply, delegation, unsure, info, notification, spam.
   - The list is cut to `DIGEST_MAX_LINES` = 15.
   - The sections are "action" and "other".
   - Footer order: LLM pause line, "+n more" by category, not-processed old, backlog, waiting, delegations, shadow, handled.
   - The delegation footer is `texts.digest.delegations(open, overdue)`. It shows only when `open+overdue > 0`. The data is `countOpenDelegations`.
4. **4096 cut** — `renderDigest` (verified).
   - `MESSAGE_MAX_CHARS` = 4096, from `core/src/digest/message.ts`.
   - The loop pops the last listed item until the text fits. With no items left, `cutToLimit` slices the text and adds `…` (it does not split a surrogate pair), and drops the buttons.
   - The dropped rows count in the "+n more" footer.
5. **Digest buttons** — `renderListed` plus `feedbackButtons` in `core/src/digest/notices.ts` (verified).
   - Each row gets ✅ n, ✏️ n and (when undoable) ↩️ n. Two rows share one keyboard line.
   - The format is `OutButton {text, data}` in `OutMessage {text, buttons: OutButton[][]}`.
6. **Callback data** — `core/src/digest/callback.ts` `encodeCallback` / `parseCallback` (verified).
   - The format is a 2-letter prefix, an optional category code, then a UUID: `fr:u:<uuid>`, `fe:<uuid>`, `ap:<uuid>`, `dd:<uuid>`, `rw:p:<uuid>`.
   - The limit is `CALLBACK_MAX_BYTES` = 64 (`message.ts`). The longest value is 41 bytes.
   - `encodeCallback` throws on a non-UUID id.
   - To add a "Delegate" button, add a `Callback` union member and a prefix in `encodeCallback` and the regexes. One id fits. A delegate-picker button needs the mail id and the delegate id. Two UUIDs are 73 bytes with a prefix, so it does not fit (guessed arithmetic, from 36+36+1+prefix).
7. **Dispatch** — verified.
   - `channels/telegram/bot.ts` handles `callback_query:data` and calls `handlers.callback(link, data)`. It answers the toast with `result.answer`, then edits the message (`result.edit`) and sends a new one (`result.send`).
   - `channels/commands.ts:362` wires `handleCallback`.
   - `channels/callbacks.ts` `handleCallback` is a switch, not a registry. It routes in order: `parseCallback` (null → `taps.invalid`), answered taps (`answered-taps.ts`), approval and other non-feedback taps (`approval-taps.ts` `handleApprovalCallback`), then feedback taps in the same file.
   - The taps call domain functions directly: `approve`, `reject`, `closeDelegation`, `recordFeedback`, `undoWithFeedback`. They pass `via: "telegram"`.
   - **They do not call an `/api` route.** `/api` routes pass `via: "web"` (`actions/routes.ts:33`). So the ADR 0023 rule "Telegram handlers call the same service function" holds, but the route is not involved.
8. **Chat identity** — verified. The tenant comes from `LinkedChat {orgId,userId,role,chatId,linkedAt,locale}`, never from the update (`port.ts`). `handleCallback` builds `ctx = {orgId, userId}` from the link. `handleApprovalCallback` returns `taps.ownerOnly` when `role !== "owner"` (except `delegation_done`), before any query. An unknown id or another org's id gives the same answer.
9. **Urgent notice** — `core/src/digest/notices.ts` `renderUrgentNotice` (verified).
   - It shows title, from, subject, 💬 AI text (cut to 200), suspicious warning, received time and "→ wouldDo".
   - It has one button row: `feedbackButtons(..., "urgent", {right, edit})` = ✅ and ✏️. It has no undo and no delegate button.
   - `core/src/notices/renderers.ts` renders it at send time. `channels/sender.ts` calls `renderNotice` for rows with a null `text`.
10. **Quiet hours** — verified. `QUIET_HOURS` = 22:00–07:00 (`core/src/digest/local-time.ts:20`), in the org timezone. In `sender.ts:149`, every row kind except `digest` and card edits (`approval_edit`) is held with `release(row, quietEnd(...))`. Digests are never held.
11. **i18n (F098)** — verified. `packages/core/src/texts/*.ts` (digest.ts, notices.ts, bot.ts, common.ts and others), with `textsFor(locale)` in `texts/index.ts`. The locales are `en` and `pl`. `LinkedChat.locale` comes from `users.locale`, default `pl` (`channels/repo.ts:60`). `localeOfLanguageTag` and `resolveLocale` are in `texts/locale.ts`. The digest uses `request.locale`.

Checks: `packages/core/src/digest/digest.test.ts` and `apps/server/test/integration/reports-digest.test.ts` cover render and build. I did not run them.

