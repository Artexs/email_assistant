# F120 · Scout packets

Four Sonnet scouts (claude-sonnet-5-5, thinking medium), started 2026-11-18 at base db85425a. Each packet is copied whole from the job log. A packet is a lead, not a fact; the planner checked the facts that decisions depend on (plan.md § Facts checked).

## Scout 1

- Job: `2026-11-18-f120-scout-1-d9d977ba`
- Question:

  > Does a sender_profiles table (or any per-sender counts table, keyed hash of sender address, HMAC secret per org) exist at HEAD? If yes: its columns, migration file, who writes it (E3b sender-history hint, F109) and who reads it (classifier prompt hint, lookalike_domain known domains). Also: where does a per-org secret or keyed-hash helper live (DSR audit keyed hash, PD-038), and which hooks cover personal data of senders: the DSR address map test (information_schema), account export, mailbox/org delete, and the retention job (90-day address clear)? Name the files and the test that lists tables holding addresses. Context: spec/features/planned/F120-e11a-sender-context/ticket.md and docs/product/stage-2/epics/E11-discovery-notes.md §2. Answer for the code at HEAD. Give file paths and function/table names; mark each finding verified (you read the code) or guessed.

### Packet

Packet: Does `sender_profiles` (or any per-sender counts table) exist at HEAD, and which helpers and hooks cover sender personal data?
Base: db85425a
Verified: `grep -rIl sender_profiles --exclude-dir=node_modules --exclude-dir=.git .` -> lists only `./docs/decisions/0034-sender-profiles-from-counts.md`, `docs/product/stage-2/decisions.md`, `E11-contacts-and-context.md` and `E11-discovery-notes.md`. No `.ts`, `.sql` or test file matches.
Unknowns:
- Which org-wide secret PD-038 and ADR 0034 mean by "org secret". The code has no per-org secret (no hit for `org_secret`, `orgSecret` or `ORG_SECRET`). The only keyed-hash helpers use one host secret, `CREDENTIALS_KEY` (see 2). I did not read the F120 ticket or E11 §2.
- How `delete_organization` removes tables: I read only its head (`db/migrations/20261114160001_account_data.sql:6-34`), not the cascade list. A new table with `org_id ... ON DELETE CASCADE` is covered by `organizations`; guessed.
- What `clearSentHeaders` and `clearMailHeaders` clear exactly: not read. The 90-day address clear is `src/retention.ts:118-123`, but a sender table with a hashed key needs no clear.

1. No `sender_profiles` table at HEAD — observed. The latest migration is `db/migrations/20261117140001_unsubscribe_data.sql`; no migration names it. ADR 0034 (status `proposed`) and PD-106 define it: HMAC key, counts only, no plain address.
2. The nearest sender history is a live query, not a table. `readSenderHistory` in `apps/server/src/modules/triage/extras-reader.ts:34` reads `emails.from_address_lower` for the last 90 days (`SENDER_HISTORY_DAYS`, line 13). It counts mails and `triage_feedback` corrections, with no hash. It writes nothing. It is the only reader of sender history: it feeds `senderHistory` in `ClassifierExtras` (`classifier.ts:35`). The prompt part `historySection` (`prompts/classifier-v3.ts:95`) renders it for the classifier. observed.
3. `lookalike_domain` known domains come from `loadSuspiciousContext` in `apps/server/src/modules/triage/suspicious-context.ts:58-111`. It fills `knownDomains` from `listMailboxes`, delegates and non-blocklist rules. A comment at line 21 says frequent senders (`listFrequentSenders`, 90-day window) never silence `lookalike_domain`. No sender-profile read exists. observed.
4. The keyed-hash helper is `dsrAddressHash(credentialsKeyBase64, address)` in `apps/server/src/platform/crypto.ts:91-97`. It computes HMAC-SHA256 hex over the normalized address. Its key is HKDF of `CREDENTIALS_KEY` (empty salt, info `ea/dsr-address/v1`, 32 bytes). The same address gives the same hash in every org (`docs/capabilities/account-data.md:47`). A second HKDF/HMAC user is `apps/server/src/modules/tenancy/sso-domain-token.ts` (info `ea/sso-domain/v1`, HMAC over `<orgId>:<domain>`). No per-org key exists. The address is normalized by `normalizeDsrAddress` in `privacy/address-map.ts:303`. observed.
5. Hooks that cover sender personal data (all observed):
   - **DSR address map:** `DSR_ADDRESS_MAP` (rules `sender|recipients|text|json|equal|list|delete`), `NOT_PERSONAL` (line 116) and `NO_PERSONAL_TABLES` (line 281), all in `apps/server/src/modules/privacy/address-map.ts`. A new table with a hashed key and counts only needs an entry in `NO_PERSONAL_TABLES` with a reason.
   - **Export:** `EXPORT_MAP` in `privacy/export-map.ts:28`; the test `test/integration/privacy-export-map.test.ts` compares its keys with `information_schema`. A new table needs a `byOrg(...)` entry or `{export:false, reason}`.
   - **Org delete:** SQL function `delete_organization` (migration `20261114160001_account_data.sql`), called by `deleteOrganization` in `privacy/delete.ts:35`. The test `test/integration/account-data-delete.test.ts` uses `catalogTables` (line 184), which reads all tables with `org_id` or `user_id` from `information_schema`. It checks them against `DELETE_SEEDS`, so a new table needs a seed there.
   - **Legal data catalog:** `dataCategories` and `NO_PERSONAL_DATA_TABLES` in `packages/core/src/legal/data-categories.ts:34,331`. The test `test/integration/data-categories.test.ts` checks that every table is in a category or in that list.
   - **Retention:** `runOrg` in `apps/server/src/retention.ts:110-` with `clearSentHeaders`/`clearMailHeaders` on `textsBefore` (90 days). A 12-month sender-profile delete (ADR 0034 point 5) has no clearer yet.
   - **Mailbox delete:** entry `apps/server/src/modules/mail/remove.ts`; I did not read how it handles tables. guessed.
   - **DSR erase:** `privacy/erase.ts:96` reads `information_schema.columns`. Hash-keyed rows are not found by plain address; the erase would need `dsrAddressHash`-style hashing (ADR 0034 says "hashes the given address"). guessed.
6. The test that lists tables holding addresses: `test/integration/privacy-dsr-match.test.ts`, `describe("DSR address map")`, test `"1. each candidate column is in exactly one of the map and NOT_PERSONAL; each entry is a real column"` (line 164). It reads `information_schema.columns` and accepts a table only if it is mapped, in `NOT_PERSONAL`, or in `NO_PERSONAL_TABLES`. observed.

Checks:
- `privacy-dsr-match.test.ts` test 1 covers new text, array and jsonb columns; it misses a hashed `text` key if the column is not classified (it would fail, which is the intent). I did not run it.
- `account-data-delete.test.ts` covers org-delete table completeness; misses the retention and mailbox-delete paths.
- `privacy-export-map.test.ts` covers export classification.
- I ran no tests. All findings come from reading code and grep output.

## Scout 2

- Job: `2026-11-18-f120-scout-2-4aedac6b`
- Question:

  > Which stored data can feed per-sender behaviour counts, and where are the write points? Cover: IMAP flags store (E3a: answered, flagged, seen), triage_results and triage_feedback (true category, corrections, moved back by user), sent-mail metadata from E5a/F104 (user mails to a recipient, reply delays per thread), delegations to a delegate, bulk signals (List-Id, List-Unsubscribe, noreply, Auto-Submitted) and the F110 E4-B history check pass at connect (ADR 0028: 30-day pass). For each: table, columns, the job or function that writes it, and whether it runs per mail incrementally. Also: the 90-day address retention on emails/sent tables. Context: spec/features/planned/F120-e11a-sender-context/ticket.md and docs/product/stage-2/epics/E11-discovery-notes.md §2. Answer for the code at HEAD. Give file paths and function/table names; mark each finding verified (you read the code) or guessed.

### Packet

Packet: Which stored data feeds per-sender behaviour counts, where the write points are, and how 90-day address retention affects them (HEAD).
Base: db85425a
Verified: `git status --short` -> (empty output; worktree clean) | reads only, no test run
Unknowns:
- Reply delays per thread are not stored as a column. Only `sent_emails.thread_key`, `parent_message_id`, `internal_date` and `emails.thread_key`, `received_at` exist, so F120 must compute them. Guessed from the schema; I did not read a delay computation. `modules/loops/analysis-repo.ts:54` reads `s.thread_key` but I did not open it.
- `email_headers` has no per-sender key. Bulk counts need `emails.from_address_lower` (generated column, migration `20261115120001`). That column is cleared at 90 days with `from_address`. Guessed.
- I did not read `isNoreplyAddress` (`packages/core/src/triage/rules.ts:70`). It works on the address text, not on stored data. Guessed.
- Whether the history pass's `skipped` mail gets `email_headers` rows is unconfirmed. `storeCapture` is called inside the `insert` write at `modules/mail/sync.ts:348`. The history path reuses that write at `sync.ts:871-877`. Guessed.

1. **IMAP flags.** Table `email_flags(email_id PK, org_id, seen, answered, flagged, first_seen_at, first_answered_at, first_flagged_at, checked_at, answered_check*)`, migration `20261114120001_measure_capture.sql`.
   - Writer: `writeEmailFlags` (`modules/mail/repo/flags.ts:82`), an upsert. It is called by `refreshFlags` (`modules/mail/flags.ts:54`).
   - Call sites: the sync job (`modules/mail/jobs.ts:119`, every `FLAGS_REFRESH_EVERY_MS` = 10 min) and `refreshFlagsOfMailbox` (`mail/tools.ts:327`, used by the history job).
   - It is not per mail. It is a periodic batch: window `FLAGS_WINDOW_MS` = 30 days of `emails.received_at`, `FLAGS_RUN_LIMIT` = 3000 per run, never-checked rows first.
   - Flags change over time, so counts need the current value or the `first_*_at` columns.
   - The row cascades with `emails`. `\Seen` is stored. — observed

2. **triage_results.** Columns `email_id, category, vip, confidence, reason_code, reason, fields jsonb, model, prompt_version, created_at` (`20261104000001_triage.sql`).
   - Writer: `insertTriageResult` (`modules/triage/repo.ts:109`), called from `modules/triage/service.ts:250` inside the triage transaction. This is per mail, incremental, at triage time.
   - There is no sender column: join via `emails.from_address`.
   - `clearTriageTexts` (`repo.ts:666`) clears only `reason` and `fields` at 90 days. Category and `created_at` stay. — observed

3. **triage_feedback.** Columns `email_id, verdict (right|wrong), true_category, source, user_id, created_at`.
   - Source values: `cli, telegram, undo, imap_move, web, review`. The last constraint is in `20261114110001`. `answered_check` is also written by `triage/answered-check.ts:119`. I did not find a migration that adds it to the constraint, so check it.
   - Writer: `insertFeedback` (`triage/repo.ts:232`), via `recordFeedback` (`triage/feedback.ts:51`).
   - Callers: Telegram callbacks (`channels/callbacks.ts:85`), the "moved back by user" path (`triage/returned.ts:61`, source `imap_move`, plus audit `user_moved_back`), `answered-check.ts`, and the web.
   - It is incremental per event. It has no sender column. — observed

4. **Sent mail (E5a).** Table `sent_emails` (`20261115090001_sent_mail.sql`).
   - Columns: `from_address`, `to_addresses[]`, `cc_addresses[]`, `subject`, `body_text`, `message_id`, `parent_message_id`, `references_ids[]`, `thread_key`, `auto_submitted`, `precedence`, `list_id`, `origin (user|system)`, `content`, `sent_at`, `internal_date`.
   - Sync state: `mailbox_sent_sync`.
   - Writer: `insertSentEmails` (`mail/repo/sent-emails.ts:33`), from the header pass in `mail/sent-sync.ts:175`.
   - Pass modes: `initial`, `incremental` (above the UID cursor), `rescan`. Header window `SENT_HEADER_WINDOW_MS` = 30 days (`sent-rules.ts:10`).
   - Incremental per pass, behind the flag `isFeatureOn` and `mailbox_sent_sync.enabled`.
   - Count only `origin = 'user'`. `origin = 'system'` rows are the system's own sends. — observed

5. **Delegations.** Table `delegations` (`20261108000001_delegation.sql`): `email_id, delegate_id, status, sent_at, answered_email_id, answered_at, due_at, source`. Table `delegates(email, competence_tags, active)`.
   - Writer: `insertDelegation` (`delegation/repo.ts:195`), via `createDelegation` (`service.ts:161`) and `createDelegationRow` in triage.
   - Reply detection: `markReply` (`triage/service.ts:145`) sets `answered_at` in the triage transaction.
   - Per event, incremental.
   - A delegate is keyed by `delegates.email`, not by the sender of the mail. — observed

6. **Bulk signals.** Table `email_headers`, one row per mail: `list_id`, `list_unsubscribe`, `list_unsubscribe_post`, `auto_submitted`, `precedence`, `has_calendar`, `from_name`, `reply_to`.
   - Writer: `insertEmailHeaders` (`mail/repo/headers.ts:27`), via `storeCapture` (`mail/capture-store.ts:22`), in the same transaction as `insertEmail` (`mail/sync.ts:348`). Per mail, incremental.
   - `clearCapturedHeaders` (`headers.ts:~110`) nulls `list_id`, `list_unsubscribe`, `reply_to`, `return_path`, `auth_results`, links and attachments after `org.dataRetentionDays`. It keeps `auto_submitted`, `precedence`, `has_calendar`, counts and `texts_cleared_at`.
   - The `noreply` signal has no stored column. It comes from `isNoreplyAddress` on the address.
   - `sent_emails` also carries `list_id`, `auto_submitted` and `precedence`. — observed

7. **F110 history pass (ADR 0028).** `HISTORY_WINDOW_DAYS = 30` (`trust/history-queue.ts:22`).
   - Flow: the job in `trust/history-job.ts` runs `backfillMailbox(..., {purpose:"history"})` (`mail/tools.ts:308`, `backfillInbox` in `mail/sync.ts:~830`). That stores mail at or below the connect cursor as `emails.status='skipped'` with `skip_reason='history_check'` (`sync.ts:861-877`).
   - Then `refreshFlagsOfMailbox` fills `email_flags`. It waits up to `HISTORY_FLAGS_WAIT_MS` = 20 min.
   - Then `classifyStep` writes `history_check_items` (`email_id, category, would_move, acted_on, source, cost_usd`, `trust/history-items.ts:68`) and `history_checks`.
   - It writes no `triage_results` and no `sent_emails`. It reuses an existing `triage_result` only when model and prompt version match (`history-classify.ts:95`).
   - Run once per mailbox (`listMailboxesWithoutCheck`). A rebuild of the profile needs a separate backfill path or reuse of the stored `emails`, `email_flags` and `email_headers` rows. — observed

8. **90-day address retention** (`retention.ts:30` `RETENTION_TEXT_DAYS = 90`, `runOrg` at `retention.ts:108-150`).
   - `clearMailHeaders` (`mail/repo/retention.ts:~50`) nulls `emails.subject, from_address, to_addresses, cc_addresses, in_reply_to, references_header` where `created_at < now-90d`. `from_address_lower` is a generated column, so it goes to NULL too.
   - `clearSentHeaders` (`retention.ts:~140`) nulls `sent_emails.subject, from_address, to_addresses, cc_addresses, references_ids` where `internal_date < now-90d`. Ids and times stay.
   - Body text uses the separate `data_retention_days` (`clearMailBodies`, `clearSentBodies`).
   - Result: a per-sender count older than 90 days cannot be rebuilt from `emails` or `sent_emails`. Sender profiles must be written incrementally into their own table. This matches the keyed-hash design in the discovery notes §2.3. — observed

Checks:
- `apps/server/test/integration/mail-schema.test.ts`, `triage-schema.test.ts` and `delegation-schema.test.ts` exist for the schemas. I did not run them, so what they cover is unknown. Existing retention tests were not read.
- No check covers a sender-profile table, because none exists at HEAD (`grep` found no `sender_profiles` in the migrations I listed). Guessed.

## Scout 3

- Job: `2026-11-18-f120-scout-3-b97c2737`
- Question:

  > Where would sender context be read, at HEAD? Cover: (a) the E5b/F116 follow-up wait (per-mailbox default 3 working days, working-day math, where the due date is computed, is there a seam for a per-contact wait and a 'usual reply time' brief line); (b) the activity detail and approval view sender line slot (E4-A/F102 web panel, API routes); (c) the Rules page (apps/web components rules, AddRuleForm, RuleList) and the rule-create command/API that an Accept would call; (d) the weekly report (PD-066, E3a) and how lines are added; (e) Telegram detail level 'full' (E9 ADR 0032) if it exists; (f) the public-provider domain list (outgoing/sender.ts) and isNoreplyAddress. Context: spec/features/planned/F120-e11a-sender-context/ticket.md and docs/product/stage-2/epics/E11-discovery-notes.md §2. Answer for the code at HEAD. Give file paths and function/table names; mark each finding verified (you read the code) or guessed.

### Packet

Packet: Where sender context would be read at HEAD, areas (a)–(f)
Base: db85425a
Verified: `git status --short` -> empty output (worktree clean). Nothing run reaches the F116 wait at runtime; I only read the code.
Unknowns:
- The task says the public-provider domain list is in `outgoing/sender.ts`. It is not. It is `freeMailDomains` in `packages/core/src/triage/suspicious.ts:31` (evidence: grep of `freeMailDomains` finds no definition in `sender.ts`). I did not read the full list.
- I did not find any per-contact wait, per-contact reply-time data, or a "usual reply time" brief line. I only grepped for wait-day symbols, so a differently named seam could exist.
- I did not locate the activity detail API route that serves `item.from`. I read only the schema field and the panel.
- `grep telegram_detail|telegramDetail` finds nothing in server or core (guessed: the per-user detail column does not exist yet).

1. (a) The wait is a per-mailbox column, `mailbox_settings.loop_wait_days` (`apps/server/src/platform/db/schema.ts:414`). `analyze.ts:83` reads it as `settings?.loop_wait_days ?? FOLLOW_UP_MIN_WAIT_DAYS`. `FOLLOW_UP_MIN_WAIT_DAYS = 3` is in `modules/loops/hooks.ts:13`. `config/service.ts:434-441` writes the setting and logs audit field `loop_wait_days`. — observed
2. (a) The due date is computed by `defaultDue(sentAt, waitDays, timeZone)` in `packages/core/src/loops/dates.ts:90`. It calls `addWorkingDays` (`packages/core/src/metrics/week.ts:43`) and sets 17:00 local time. Callers:
   - `analyze-write.ts:63`, which uses `extraction.due ?? defaultDue(..., env.waitDays, ...)`.
   - `analyze-rules.ts:106`, which uses `Math.max(env.waitDays, FOLLOW_UP_MIN_WAIT_DAYS)`.
   - `hooks.ts:102-103`, the restart after a follow-up, which also uses `Math.max(..., 3)`.
   - `loop-commands.ts:153`, Later, which uses the constant `LATER_WORKING_DAYS = 3`.

   The seam for a per-contact wait is the `waitDays` argument. Every caller passes a mailbox-level number. `analyze.ts:83` builds `env.waitDays`, and `hooks.ts:96-102` reads the setting inline. `hooks.ts:102` and `analyze-rules.ts:106` clamp the wait to a minimum of 3. A per-contact wait below 3 would need that clamp changed. — observed
3. (a) `modules/loops/follow-up-draft.ts:109` gates the next follow-up with `addWorkingDays(loop.last_follow_up_at, FOLLOW_UP_MIN_WAIT_DAYS, tz)`. It does not use the per-mailbox setting. The "too_soon" copy "3 working days" is hard-coded in `loops/api-docs.ts:38` and in `apps/web/src/i18n/en.ts:1112`. — observed
4. (b) The approval view is `ApprovalView` in `packages/core/src/outgoing/sender.ts`, built by `approvalViewOf`. Its field is `sender: { label, external } | null`. It is null for a reminder and a follow-up, and the label comes from `senderLabel(original.fromAddress)`. `isExternalSender` (same file) tests internal addresses, whitelist and VIP only. Related files:
   - Schema: `outgoing/view-schema.ts`, `web/approvals.ts`.
   - Render: `apps/web/src/components/approvals/ApprovalSummary.tsx:53-56` (the "From" line plus an external warning).
   - Telegram card: `modules/channels/notices/approval.ts`.

   Activity: `ActivityItem.from` is `z.string().nullable()` (`packages/core/src/web/activity.ts:83`). `components/activity/ActivityPanel.tsx:49` renders `senderText(item.from)`. — observed
5. (c) The Rules page is `apps/web/src/islands/RulesPage.tsx` with `components/rules/AddRuleForm.tsx` (kinds `senderRuleKinds` = whitelist, blocklist, vip; default "vip") and `RuleList.tsx`. The form calls `POST /api/rules` with `{kind, pattern, mailboxId?}` (`AddRuleForm.tsx:52`). The route is `rulesRoutes` in `apps/server/src/modules/config/routes.ts:267`. It requires the owner and calls `addSenderRule(db, ctx, {mailboxId, pattern, kind, actor, now})` (`config/rules.ts:30`). That function normalizes the pattern, counts against `SENDER_RULE_LIMIT`, inserts the rule, and writes the audit event `ruleAdded`. Results are `added` (201), `exists` (409), `limit` (409) and `mailbox_not_found` (404). An Accept can call `addSenderRule` directly or `POST /api/rules`. — observed
6. (d) The weekly report is built by `renderWeeklyReport(view, texts)` in `packages/core/src/digest/weekly.ts:92`. A new line is a `lines.push(...)` plus a text function under `texts.notices.weekly`, and the text tables need both locales. The PD-066 evidence lines come from `evidenceItems(week, texts)` (`weekly.ts:54`). `autoItems` builds the "auto" line. The send job is `detectWeeklyReport` in `apps/server/src/modules/channels/notices/weekly-report.ts:33`, gated by the feature flag `weekly_report`. — observed
7. (e) The detail level exists only as the type `noticeDetails = ["full"]` in `packages/core/src/notices/kinds.ts:42`, with the comment "E9b adds minimal". Renderers hold one function per detail level (`notices/renderers.ts:36`). `channels/notice-queue.ts:43` hard-codes `detail: "full"`. ADR 0032 (`docs/decisions/0032-phone-channel-push-and-telegram-detail.md`) says a per-user `full` or `minimal`, with `minimal` as the default. That is not built. — observed
8. (f) `isNoreplyAddress(fromAddress)` is in `packages/core/src/triage/rules.ts:70`. It tests the local part, with any `+tag` removed, against `NOREPLY_LOCAL_PARTS`. It returns false for null or an address with no local part. It is used in `triage/planners.ts:102` and `replies/eligibility.ts:79`. `freeMailDomains` is in `triage/suspicious.ts:31`. Its entries include gmail.com, outlook.com, hotmail.com, yahoo.com, icloud.com, interia.pl and interia.eu. It is used by `apps/server/src/modules/triage/suspicious-context.ts:55`. `outgoing/sender.ts` has neither. — observed

Checks: `packages/core/src/triage/rules.test.ts:92` covers `isNoreplyAddress`; `outgoing/sender.test.ts` covers `approvalViewOf`; `openapi-routes.test.ts` covers the rules routes. I ran none of them and found no test of a per-contact wait.

## Scout 4

- Job: `2026-11-18-f120-scout-4-17af82e5`
- Question:

  > How can a prompt-variant comparison run on the E2a offline lab (F097) and the E3b hint (F109)? Cover: does a bank case carry a sender profile or a 30-day prior history; how was the E3b sender-history hint eval-gated (dev set, holdout, PD-061/PD-062, which commands and result files in evals/results/); is the E3b hint shipped and on, and behind which flag; how the classifier prompt is assembled (where a sender line would go) and the prompt-version/eval gate rules for changing an LLM prompt; feature flag registry (F087) for adding a default-off flag. Context: spec/features/planned/F120-e11a-sender-context/ticket.md and docs/product/stage-2/epics/E11-discovery-notes.md §2. Answer for the code at HEAD. Give file paths and function/table names; mark each finding verified (you read the code) or guessed.

### Packet

Packet: How a prompt-variant comparison runs on the E2a lab (F097) and the E3b hint (F109), for F120.
Base: db85425a
Verified: `git status --short | wc -l` -> 0 (no eval run). Everything below comes from file reads and greps, not from running a comparison.
Unknowns:
- The holdout result for `history` alone does not exist. Only `classifier-v3[list]` ran on holdout, so the E11 baseline is v2 or v3[list]. Observed: `docs/capabilities/triage.md` rule 18.
- The F087 flag read path (`resolveFeature` and its callers) was not traced. Guessed: a flag is read through `resolveFeature`.
- I did not read ADR 0028 or the exact D12/D13 rule text in `F109-e3b-improve/plan.md`.

1. **Bank case and prior history.** Observed.
   - A bank case carries a sender history, not a 30-day one. `sim.senderHistory` is optional on the eval case (`packages/core/src/triage/eval-case.ts:58`, `senderHistorySchema`).
   - The bank fills it with `senderHistoryFor` (`packages/core/src/sim/history-gen.ts`), called from `plan-bank.ts:293` with `HISTORY_DAYS = 90` (`plan-bank.ts:14`). The history is shared per sender key.
   - `to-eval-case.ts:116` copies it into the case.
   - The week part has its own 30-day prior history: `fixtures.ts:83` sets `historyDays: 30`, and `weekHistory` (`plan-week.ts:440`) writes a `WeekHistory` file with one history per sender address.
   - The `SenderHistory` shape (`packages/core/src/triage/sender-history.ts`) is already the E11 profile shape. It holds counts, `corrections`, `answered`, `flagged`, `userMailsTo`, `medianUserReplyHours`, `relation` and more, with no text field.
   - E11 discovery §2.4 expected a missing edit. That edit is already built.

2. **What the prompt reads of that history.** Observed.
   - `classifierExtrasOfCase` (`apps/server/src/scripts/eval-extras.ts:25`) passes only `days`, `received` and `corrections`. `byCategory` and the other fields never pass (review N2).
   - A case that `assessSuspicious` flags gets `senderHistory: null`.
   - A new E11 line therefore needs a new `ClassifierExtras` field, or a wider `senderHistory`, plus the same pass-through in `eval-extras.ts`.
   - Production reads real history with `readSenderHistory` (`apps/server/src/modules/triage/extras-reader.ts`). It uses `SENDER_HISTORY_DAYS`, the mails before the mail in this mailbox, and the `wrong` corrections. `loadClassifierExtras` calls it only when `parts.includes("history")` and the mail has no suspicious reasons.

3. **E3b eval gate for the hint (PD-061, PD-062).** Observed.
   - PD-061 and PD-062 are in `docs/product/stage-2/decisions.md:67-68`. Each hint is a `classifier-v3` experiment on the dev set. Only a winner that passes holdout ships.
   - Dev command: `bun run eval --sim lab-01 --part dev --provider openai --model gpt-6-luna --reasoning-effort none --budget-usd 0.15 --fresh --out <file>.md`, plus `--prompt-version classifier-v2`, or `--prompt-version classifier-v3 --prompt-parts <list>`.
   - Dev rules: D12 key-miss count `K`, run noise `s` = 2, win margin 20.
   - Dev result for `history` (R4, `evals/results/f109-v3-dev/r4.md`): K 27 against v2 K 23 (R1a, R1b). `history` lost. Details are in `evals/results/2026-11-15-f109-v3-dev-summary.md`.
   - Only `list` won on dev (R5/R6: K 14, 12, 16). Chosen parts: `[list]`.
   - Dev summary caveat N2: the sim history is the persona group's ideal mix, not the model's own labels. A `history` result may not hold on real mail.
   - Holdout (one run per decision, D13): `bun run eval --sim lab-01 --part holdout --prompt-version classifier-v3 --prompt-parts list`.
   - Holdout report: `evals/results/2026-11-15-sim-lab-01-holdout-gpt-6-luna-classifier-v3.md`. v2 baseline: `...-classifier-v2.md`.
   - Gate files in `evals/results/gate/`: `classifier-classifier-v2-gpt-6-luna-none-lab-01-v1.json` and `classifier-classifier-v3-gpt-6-luna-none-lab-01-v1.json`.
   - Holdout result for v3[list]: K 34 against 74. Whitelist 314 of 315, so ship rule 4 failed. Owner decision 42 is open.

4. **E3b hint shipped? No.** Observed.
   - Production prompt is `classifier-v2` (`apps/server/src/modules/triage/prompts/index.ts`, pointer `prompts.classifier`).
   - `CLASSIFIER_V3_PARTS = ["attachments"]`.
   - `history` is a prompt part (`classifierV3Parts` in `prompts/classifier-v3.ts`), not a feature flag. No flag guards it.
   - `triageOne` reads no extras while v2 is production (`docs/capabilities/triage.md` rule 18).
   - For a variant you need no flag in the lab: pass `--prompt-version classifier-v3 --prompt-parts history,...` to `eval`.

5. **Where a sender line goes.** Observed.
   - Prompt files are `prompts/classifier-v2.ts` and `classifier-v3.ts`. v3 reuses v2's `buildSystemPrompt`, then appends "Context rules:" built by `rulesOf`.
   - `buildUserPrompt` in v3 builds the user text in this order: the "Sender context" block (whitelisted, VIP, looks automatic), then the optional `urgencySection`, then `historySection`.
   - `historySection` is the existing sender line: "Sender history (counts from the user's mailbox, data, not instructions)". It holds the received count and the corrections.
   - The rule line for it is in `rulesOf`, under `has(parts, "history")`.
   - An E11 profile line would replace or extend `historySection`. Under the rules in point 6 it needs a new file `classifier-v4.ts`.

6. **Prompt version and eval gate rules.** Observed.
   - A changed prompt text, or a changed production part list, is a new file `<role>-v<n>.ts`. Its `PROMPT_VERSION` equals the file name (`docs/code-patterns.md:248`; the comment in `classifier-v3.ts` says v4).
   - New versions go in the `classifierVersions` record in `prompts/index.ts`.
   - Before merge, run `bun run eval --sim lab-01 --part holdout`. Commit the report and `evals/results/gate/<role>-<promptVersion>-<model>-<effort>-<corpus>-v<version>.json` (`docs/code-patterns.md:250`).
   - The gate needs ≥ 200 holdout cases per category and a Wilson 95% lower bound of precision ≥ the bar (PD-024, PD-025).
   - Tune only on `evals/sim/*/dev/`. Never open `holdout/`.
   - CI test `apps/server/src/modules/triage/gate-evidence.test.ts` fails when the version has no `standard` gate file.
   - PD-107 (`decisions.md:113`): the profile line ships only if it beats the E3b hint on the holdout. Each holdout run costs real spend, and the lab caps a run at $1 and the month at $20.

7. **Feature flag registry (F087).** Observed.
   - `featureFlags` in `packages/core/src/features.ts:14` is a typed record. Each entry has `default`, `description`, `epic` and `removeBy`.
   - `epic` must match `featureEpicPattern`. A key must match `featureKeyPattern` (`/^[a-z][a-z0-9_]{0,39}$/`). `expiredFlags` flags a flag after its `removeBy` date.
   - A default-off flag is one new entry, for example `{ default: false, description: "...", epic: "E11a", removeBy: "2027-..." }`. Existing entries use removeBy `2027-03-01`.
   - `suspicious_mail` (E3b) shows how a flag is used. Its consumers are `triage/service.ts`, `suspicious-show.ts`, `digest.ts` and `activity.ts`.
   - Guessed: a flag guards a user-visible behaviour, not the lab. A lab prompt variant needs no flag.

Checks:
- `gate-evidence.test.ts` covers "a gate file exists for the production classifier version"; it misses whether a variant's holdout result beats the E3b hint.
- `bun run eval --sim lab-01 --part dev|holdout --prompt-version ... --prompt-parts ...` covers the comparison itself; it misses a `history` holdout baseline, since none exists.

