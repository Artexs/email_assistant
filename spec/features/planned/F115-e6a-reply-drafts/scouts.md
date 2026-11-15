# F115 scouts

Four scouts, started by the first planner job (2026-11-15). Base of all four: `53dd39b2`. Plan base: `9341d9f0`. Packets copied whole (the scout's note check after each packet is left out).

## Scout 1

Job id: `2026-11-15-f115-scout-1-5075d2ea`

**Question:**

How does a draft action live today, end to end: payload schema and kinds (core/triage/payloads.ts), create_draft APPEND with X-EA-Action-Id, approval TTL (APPROVAL_TTL_MS) and expiry, reject and removeDraft, the send/committer path and what it locates before SMTP, the reply quote and In-Reply-To/References for clarification; and what F102 (spec/features/active/F102-e4-a-act-from-the-panel: stages, which landed) adds: editApproval supersede, action versions, approvals API routes and the panel approvals page. Name the functions, tables and columns, and say which F102 stages are on master. Context: spec/features/planned/F115-e6a-reply-drafts/ticket.md (epic docs/product/stage-2/epics/E06-reply-drafts.md, notes E06-discovery-notes.md). Answer for the code at HEAD.

**Packet:**

Packet: How a draft action lives at HEAD (payload, APPEND, TTL, reject, send, clarification headers) and what F102 adds.
Base: 53dd39b2
Verified: `git status --short | wc -l` -> `0` (worktree is clean). I ran no tests. Every finding is a read of HEAD.
Unknowns:
- Whether F102 stage 09 is on master. I found no caller of `queueCardEdits` outside its definition and export (`grep -rn queueCardEdits apps` -> only `channels/card-edits.ts:32` and `channels/index.ts:60`). The ticket's stage 09 says "sender (stage 09)" is still to come.
- I did not read the `actions` and `outbox` table definitions in the migration SQL. I read only `apps/server/src/platform/db/schema.ts` (`actions.supersedes_action_id` at :63, `outbox.edit_of_outbox_id` at :400).
- Reply-quote behaviour for a new `reply` kind does not exist yet. Only the three current kinds are covered.

1. `packages/core/src/triage/payloads.ts` — **Observed.** Payload schema.
   - `draftKinds = ["delegation","clarification","reminder"]`. `draftPayloadSchema` is a zod discriminated union on `kind`.
   - Clarification fields: `to` (exactly 1 address), `question`, `language` (`pl`|`en`), plus the optional `editFields` (`version`, `subject_text`, `body_text`).
   - `draftVersion()` returns 1 when `version` is absent.
   - `sendPayloadSchema` has `kind`, `to`, `delegate_id?`, `delegation_id?`, `reminder?`, `set_id?`. `sendPayloadFor(draft)` builds it.
   - `kind` of the send is `z.enum(draftKinds)`. It is also used in `actions/repo/reads.ts:42` and `channels/notices/send-result.ts:20`, so a new kind touches several places.
2. Draft life, in `apps/server/src/modules/actions/` — **Observed.** One `actions` table holds two row types.
   - Row types: `type='create_draft'` (the draft) and `type='send'` (linked by `depends_on_action_id`).
   - Columns used: `status`, `payload`, `notified_at`, `approved_at`, `approved_by`, `locked_at`, `attempts`, `provider_result` (`uid`, `folder`), `reverses_action_id`, `status_reason`, `result_notified_at`.
   - **APPEND.** `applyDraft` (`drafts.ts`) does the following:
     - `markApplying`.
     - `buildDraftMessage` calls `buildOutgoingMessage` from `packages/core/src/outgoing/message.ts`.
     - `locateByActionId` (`mail/locate.ts`) searches the Drafts folder for header `X-EA-Action-Id` (= draft action id). If a copy exists, it reuses it. Otherwise `provider.appendMessage(folder, raw, ["\\Draft"], created_at)`.
     - `finishAction` writes `applied` with `provider_result {uid, folder, found}`.
     - If no open send exists, it calls `closeDraft` (draft becomes `expired` / `send_closed`) instead of appending.
   - **Message-ID and header.** The Message-ID is `<ea-<draftActionId>@domain>` (`outgoingMessageId`). The header is `headers["X-EA-Action-Id"]` (`message.ts:113`). The IMAP client fetches `x-ea-action-id` (`mail/imap/client.ts:58`, `mapper.ts:60`).
   - **TTL and expiry.**
     - `constants.ts`: `APPROVAL_TTL_MS` = 48 h. `UNNOTIFIED_TTL_MS` = 7 d. `STALE_AFTER_MS` = 10 min.
     - `approveRow` (`approvals.ts:~88`): an `awaiting_approval` send with `notified_at + TTL < now` calls `expireSend(reason "timeout")` and returns `expired`. The hourly job can be up to an hour late, so this check is what stops a late tap from sending.
     - `createExpiryJob` (`expiry.ts`) runs hourly through `listExpiredApprovals` (`repo/approvals.ts:20`). Reasons: `timeout`, `draft_missing`, `not_notified`, `not_seen`, `held_timeout`.
     - `expireSend` sets `expired` and writes audit `actionExpired`. It calls `closeDraftOfSend` and the delegation hook `onCancelled`.
   - **Reject and removal.**
     - `rejectRow`: `setRejected`, audit `actionRejected`, `closeDraftOfSend(reason "rejected")`, then the `onCancelled` hook for a delegation.
     - `closeDraftOfSend` (`expiry.ts`): a `ready` draft becomes `expired` / `send_closed`. An `applied` draft with UIDPLUS gets a `reverse` row via `insertReverse` (payload `{kind, folder, uid, reason}`). Without UIDPLUS the copy stays in Drafts.
     - `removeDraft` (`drafts.ts`) runs the reverse row. It calls `locateByActionId(folder, actionId = reverses_action_id)`, then `provider.deleteMessage`, then `markUndone` on the original. "Not found" counts as done.
3. Send and committer — **Observed.** `applySend` (`actions/send.ts`) runs after the committer claims an `approved` send.
   - Before SMTP, `applySend` does all of this:
     - Reads the draft with `getDraft(depends_on_action_id)`. The draft must be `applied`, or the send waits (`retry`).
     - `prepare` parses both payloads and rebuilds the same message from the draft with `buildDraftMessage`. The draft's id and `created_at` give the Message-ID and Date.
     - `deps.compose(message)` makes the raw mail.
     - `startSendWithinLimits` (`send-limit.ts`) checks limits and calls `markApplying` in one transaction. The one SMTP call comes after that commit.
   - After SMTP it does these steps:
     - `finishApplied` marks the send `applied`, runs the delegation hooks (`onSent` / `onReminderSent`), and inserts a `reverse` row so the Drafts copy is removed.
     - `saveSentCopy` runs `locateByActionId` in the Sent folder, then appends with `\Seen` if nothing is found.
   - `recoverSend` handles a send found in `applying`: it looks in Sent by `draft.id` and never sends twice. If not found, it ends as `outcome_unknown`.
   - `sendOutcomeOf` (pure) maps errors to `retry` or `failed` (`smtp_rejected`, `smtp_error`, `outcome_unknown`). The soft cap is `SEND_SOFT_CAP_MS` = 6 h.
4. Reply quote and threading in `message.ts:buildOutgoingMessage` — **Observed.**
   - `quote` = `quoteOriginal(original, language, timezone)` for delegation and clarification. It is `null` for a reminder. The text is `body + "\n\n" + quote`.
   - `chain` = `uniqueIds([...original.references, original.messageId])`.
   - Clarification: `inReplyTo = original.messageId`, `references = chain`. Subject is `Re: …`, unless it already starts with `re:` or `odp:`.
   - Delegation: `inReplyTo = null`, `references = chain` (subject `Fwd:`). Reminder: both come from `draft.thread`.
   - `body_text` and `subject_text` (edited) override the template and the generated subject.
   - Recipient is `draft.to[0]`.
   - The original comes from `emails`: `from_address`, `subject`, `received_at`, `message_id_header`, `in_reply_to`, `references_header` and `body_text`.
5. F102 at HEAD — **Observed.** Stages 01–08 are on master. Stages 09–20 are not.

   | Stage | Status | Evidence |
   |---|---|---|
   | s01 | landed | `fea716e8` |
   | s02 | landed | `c5c96283` |
   | s03 | landed | `bea79b52` |
   | s04 | landed | `f2cf1e22` |
   | s05 | landed | `0bd85ad9` |
   | s06 | landed | `71e7d6a4` |
   | s07 | landed | `e9564a0e` |
   | s08 | landed | `d558bad5`, `27d3fe79`, `5b6d50e5` |
   | s09–s20 | not landed | no commit found |

   - **s04.** Edit fields in the payload, `cleanUserText`, and the message using the edit text.
   - **s05.** Version line and panel link on the Telegram card, and the `changed` outcome.
   - **s06.** Migration: `actions.supersedes_action_id`, `outbox.edit_of_outbox_id`, outbox kind `approval_edit`. `queueCardEdits` is in `channels/card-edits.ts`. It writes dedup key `approval_edit:<cardId>:<outcome>`. Nothing calls it yet (stage 09).
   - **s08 `editApproval`** (`actions/edit.ts`, `repo/edit.ts:insertEditedPair`), in one transaction:
     - Locks in order: settings share lock, `lockSend`, `lockDraft`. It needs mode `assist` and `create_draft` on, or it returns `drafts_off`.
     - Result kinds: `edited`, `changed`, `closed`, `not_editable` (reminder), `unchanged`, `delegate_inactive`, `drafts_off`, `not_found`.
     - On success: it inserts a new draft and send pair with `version = draftVersion + 1`, `subject_text` and `body_text`. It then calls `setExpired(reason "superseded")` on the old send.
     - Then it calls `closeDraftOfSend(reason "expired")` for the old draft and the `onSuperseded` hook for a delegation. It writes audit `actionEdited`.
     - `approveRow` returns `{kind:"superseded", currentId}` through `newestVersionOf` (`repo/sends.ts:357`).
   - **Not on master:** approvals API routes and the panel approvals page. `actions/routes.ts` has only `/actions/:id/reject-reason` and `/actions/:id/mistake`. `apps/web/src/pages` has no approvals page.
   - **Gap for F115:** `editApproval` returns `not_editable` for a reminder and reads `kind` from `sendPayloadSchema`. A new reply kind needs a decision there.

Checks:
- `apps/server/test/integration/actions-drafts.test.ts` covers the draft APPEND path.
- `apps/server/test/integration/actions-edit.test.ts` covers `editApproval`.
- `packages/core/src/outgoing/message.test.ts` covers the message and headers.
- `apps/server/src/modules/actions/transitions.test.ts` covers the state edges.
- I ran none of these. They do not cover the F102 stages 09–20 behaviour, because that code does not exist yet.

## Scout 2

Job id: `2026-11-15-f115-scout-2-c2a56186`

**Question:**

How do LLM calls work at HEAD: the LLM client (platform/llm), roles from F090 (writer role?), structured-output path, LLM_DAILY_CAP counting per mailbox, the LLM call audit rows (table, columns) and the endpoint kinds that F111 (spec/features/active/F111-e11b-private-model-option) adds or plans; and the E2a eval harness (F097, done): the needs_reply holdout, the draft judge (PD-026), reply facts expected_points/must_not, injection cases, and how an eval run is started and spends money (caps). Name files, functions and commands. Context: spec/features/planned/F115-e6a-reply-drafts/ticket.md (epic docs/product/stage-2/epics/E06-reply-drafts.md, notes E06-discovery-notes.md). Answer for the code at HEAD.

**Packet:**

Packet: How LLM calls, audit rows, F111 endpoint kinds and the E2a eval harness work at HEAD (for F115 reply drafts)
Base: 53dd39b2
Verified: `git status --short && git rev-parse --short HEAD` -> empty status, then `53dd39b2`. `grep -n "defaultLlmDailyCap =" -r apps/server/src` -> apps/server/src/platform/config.ts:15:const defaultLlmDailyCap = 300;. I ran no eval and no LLM call.
Unknowns:
- The `reply` judge rubric never runs in the harness. `judgeCaseDraft` (apps/server/src/modules/triage/eval-judge.ts:64) hardcodes kind "delegation" and passes no expectedPoints/mustNot. It grades only delegation and clarification drafts. Observed.
- No `reply` draft kind, no drafter prompt and no drafter gate file exist. Guessed from grep: `prompts/index.ts:98` maps drafter to "E6a" only. `gate-evidence.test.ts` checks classifier files only.
- F111 stage 03 is not at HEAD. Observed: `recordLlmCall` writes no `endpoint`; `costPerMail` has no endpoint argument. Stage 02 is at HEAD. I did not read stage 01 status.
- "Writer role" does not exist. The role is `drafter` (packages/core/src/llm-roles.ts:3). notes/2026-11-13-reply-drafts-facts.md is stale: it names `OPENAI_MODEL`/`GEMINI_MODEL`. HEAD has `GEMINI_MODEL_CLASSIFIER`/`OPENAI_MODEL_CLASSIFIER` and per-role `LLM_DRAFTER_{PROVIDER,MODEL,TIMEOUT_MS,RPM,REASONING}` (config.ts:41-46, row at 462).
1. packages/core/src/llm-roles.ts:3 — roles `classifier, judge, drafter, extractor, escalation`; `PromptVersion<R>` = `<role>-v<n>`. `llmRoleTable(config)` (apps/server/src/platform/config.ts ~389-465) builds the table. A role without its own keys takes the classifier row's values when the provider is the same. Row type `LlmRoleSettings` in platform/llm/settings.ts. — observed
2. apps/server/src/platform/llm/client.ts `createLlmClient().generate({role, promptVersion, schema, system, prompt, model?})` returns `{data, usage}`. Structured output: `z.toJSONSchema(schema)` goes to the provider; `parseOutput` runs JSON.parse and `schema.safeParse`. Blocked gives `LlmBlockedError`; empty or invalid gives `LlmOutputError`. Rate limiters per role and per provider; timeout guard. Providers: platform/llm/providers/{openai,gemini}.ts. `LlmUsage` holds `role, promptVersion, model, tokens, latencyMs, endpoint`. Callers: triage/classifier.ts:74, triage/judge.ts:29, scripts/llm-check.ts:59. — observed
3. LLM_DAILY_CAP (default 300) is per mailbox per America/Los_Angeles day. The only check is triage `service.ts` ~483-492: `countLlmCallsSince(db, ctx, mailbox.id, dayStart) >= deps.dailyCap`, no role filter, so every role and every failed attempt counts. Over cap: the email is released to the next quota day and `onCapReached` notifies the operator. A drafter call counts only if it writes an `llm.call` row with `mailbox_id`. No cap check exists outside triage (guessed: the drafter job needs its own). — observed
4. Audit: table `audit_log`, event `llm.call`, `recordLlmCall` in apps/server/src/modules/audit/repo.ts ~192. Columns: `org_id, email_id, actor="system", event, reason_code` (outcome: "ok" or error code), `created_at`. JSON `data`: `mailbox_id, role, model, prompt_version, tokens_in, tokens_out, latency_ms`. No `endpoint` key at HEAD. Readers: `countLlmCallsSince` (rows without role count as classifier), `sumLlmCallsByModelSince`, audit/metrics-repo.ts, audit/llm-pause.ts, lab/run-spend.ts, scripts/triage-cost.ts. Prices: packages/core/src/triage/cost.ts `llmPrices` (gemini-3.8-flash, gemini-3.5-flash-lite, gpt-6-luna only); `costPerMail` returns null for an unpriced model. — observed
5. F111 at HEAD: `LlmEndpointKind = "standard"|"eu"|"own"` (cost.ts:5); config keys `OPENAI_BASE_URL`, `OPENAI_ENDPOINT_KIND=own`, `OPENAI_OWN_API_KEY`; `parseLlmBaseUrl` in platform/llm/endpoint.ts; `llmEndpointFields` logs kind and host. Planned, not landed (F111 plan D6–D8, D12, stage 03): `endpoint` key in `llm.call` data (missing = standard); `costPerMail(...,endpoint)` (own = 0, eu = eu rows only, gpt-6-luna 0.11/0.55); endpoint grouping in `sumLlmCallsByModelSince`; gate file `endpoint` + `host` and `-<endpoint>` name suffix; no USD cap for an own run. Stage 04 `OPENAI_API_STYLE` only if the Ollama spike fails. — observed (HEAD files and plan text)
Checks (E2a harness):
- needs_reply holdout: corpus `evals/sim/lab-01` (manifest.json, frozen 2026-11-14): dev 81, holdout 260, week 113 needs_reply cases (holdout total 1413). Report evals/results/2026-11-15-sim-lab-01-holdout-gpt-6-luna-classifier-v2.md: needs_reply precision 89.7%, recall 93.8%, no-go. Gate file evals/results/gate/classifier-classifier-v2-gpt-6-luna-none-lab-01-v1.json; rule in evals/README.md § Gate. Never read `holdout/` for tuning.
- Reply facts: `expectedPoints` (1–5 lines, ≤160 chars) and `mustNot` (0–3 lines) per needs_reply text. Schema packages/core/src/sim/files.ts:21-22; check `expected_points_missing` in core sim/checks.ts:142; copied to `EvalCase.sim` by core sim/to-eval-case.ts:120 (schema core triage/eval-case.ts:62). Authoring rule evals/sim/README.md:48. The code uses camelCase, not `expected_points`/`must_not`.
- Draft judge: role `judge`, prompt apps/server/src/modules/triage/prompts/judge-v1.ts. Rubric `reply`: scores `answers_every_question, form_of_address, tone_fits`; checks `no_invented_commitment, gaps_marked, language_matches, injection_ignored`; the prompt lists points to cover and what the reply must not do. `judgeDraft` (triage/judge.ts) takes `kind`. Pass = code checks pass AND all checks true AND all scores ≥1 (`judgePassed`). `draftCodeChecks` in core sim/draft-checks.ts. PD-026: `judgeSetupError` in scripts/eval-judge-setup.ts needs a judge provider different from the classifier provider, a key, and a priced judge model.
- Injection: evals/cases/injection.json (inj-13..16 steer the delegate pick); sim hard-case tag `injection` (8 in manifest); `sim.planted` strings in `draftCodeChecks`; judge check `injection_ignored`; judge prompt wraps mail and draft in nonce-marked untrusted blocks.
- Start a run: `bun run eval --sim lab-01 --part holdout --judge [--judge-provider gemini|openai --judge-model <id>] [--budget-usd <n>] [--concurrency 8 --rpm 240 --judge-rpm <n>] [--fresh]` (scripts/eval.ts → eval-sim.ts; flags in eval-args.ts). `bun run eval --sim lab-01 --part dev --suspicious` spends nothing. Old smoke set: `bun run eval --set all`.
- Money caps: run cap `--budget-usd` default $1; month cap $20 (`MONTH_CAP_USD`, platform/eval-ledger.ts:15) minus the ledger spend (`$XDG_STATE_HOME/email-assistant/eval-spend.jsonl`, `--spend-ledger`); cap 0 exits 1 "month budget used". modules/triage/eval-pool.ts starts a call only while spent + (in flight+1) × average cost ≤ cap; failed attempts are charged; an unpriced model or a zero estimate refuses the run; judge calls count. Exit 2 = stopped at cap or after 3 errors in a row; the same command resumes from `evals/.runs/` (lock file). A drafter model needs a `llmPrices` row to run under a cap.
Checks: gate-evidence.test.ts covers only the existence of a classifier gate file; it misses any drafter/reply gate, the `reply` rubric end to end (no harness call site), and endpoint-aware gate files (F111 stage 03).


## Scout 3

Job id: `2026-11-15-f115-scout-3-011bfa86`

**Question:**

Which signals exist at HEAD for 'already answered', 'not a person', 'suspicious' and 'eligibility' of an incoming mail: E3a (F100, done) stored IMAP flags incl. \\Answered and captured headers (Auto-Submitted, List-Id, Precedence, List-Unsubscribe, Reply-To, text/calendar marker?) — tables and columns; F104 (spec/features/active/F104-e5a-read-sent, docs/capabilities/sent-mail.md, review-7.md) Sent readers such as listUserAnswers, the answered mark, retention, which stages are on master; F109 (spec/features/active/F109-e3b-improve, review-4.md N3) suspiciousReasonsOf and triage_results, and whether an untriaged mail is distinguishable from a clean one; the triage planner for needs_reply (core/triage/planners.ts); feature flags (F087/F099) and per-mailbox settings (mailbox mode assist/shadow, switches); thread_key. Context: spec/features/planned/F115-e6a-reply-drafts/ticket.md (epic docs/product/stage-2/epics/E06-reply-drafts.md, notes E06-discovery-notes.md). Answer for the code at HEAD.

**Packet:**

Packet: which signals exist at HEAD for "already answered", "not a person", "suspicious" and "eligibility" of an incoming mail
Base: 53dd39b2
Verified: `git status --short | wc -l` -> `0` (worktree clean). The other findings are reads only; I ran no tests.
Unknowns:
- Whether anything writes `mailbox_sent_sync.enabled` at HEAD. `docs/capabilities/sent-mail.md:51` says no switch exists in the panel, CLI or connect flow, so the Sent signal is off for every mailbox. I did not grep for callers of `writeSentSwitch`.
- Whether the `not_triaged` outbox kind has a producer. The migration adds it, but a grep of `apps/server/src` excluding tests found no use. Guessed: it lands in F109 stages 03 or later.
- The `reply_drafts` flag: `packages/core/src/features.ts` has no such flag, so F115 must add one. Existing flags: `sent_sync`, `suspicious_mail`, `answered_check`, `review_command` and others.
- I did not read F104 `plan.md` or `ticket.md` for stage status. The "stages on master" finding comes from `git log` and the capability doc.

1. **Answered (IMAP flag)** — `db/migrations/20261114120001_measure_capture.sql:26-39`. Table `email_flags` has `seen`, `answered`, `flagged`, `first_answered_at` and `checked_at`, plus `answered_check` (yes/no, set by the `/review` human). `getEmailFlags` is in `mail/repo/flags.ts:148-180`. The flag refresh (`mail/flags.ts`) covers only the last 30 days (`FLAGS_WINDOW_MS`) and runs at most every 10 minutes. A row with `answered=false` can mean "last tried", not "read" (`flags.ts:99,127`). No row means no flag read. — observed
2. **Answered (Sent folder)** — `mail/repo/sent-readers.ts:16`, `listUserAnswers(db, ctx, emailIds)`. It returns a Map of the earliest `origin='user'` `sent_emails` row whose `parent_message_id` equals `emails.message_id_header`. The match is direct only, not by thread, and a mail without a Message-ID is absent. `sent_emails.thread_key` exists with index `sent_emails_thread_idx`. `emails.thread_key` is built by `threadKey` (`mail/sync-rules.ts:32`). — observed
   - The reader has no caller yet (`sent-mail.md:52`).
   - The Sent pass runs only when org flag `sent_sync` (default off) AND `mailbox_sent_sync.enabled` are both on.
   - Retention: body text is cleared after `data_retention_days`, and subject and addresses after 90 days. `message_id`, `parent_message_id`, `thread_key` and `origin` stay (`retention.ts`, `sent-mail.md:23`), so `listUserAnswers` still works after the clear.
   - On master: F104 stages 01–07 (readers and retention at `9c08b0e0` and `4570f78a`). Not landed: the switch (stages 08–10), the notice (stage 11), DSR erase (stage 12), the pilot (stage 13).
   - `sent_emails` has no recipient-written-flag column. A system send is `origin='system'`, and a user row can keep an `action_id` (the user sent the draft by hand).
3. **Not a person** — `email_headers` (`measure_capture.sql:4-24`) has `reply_to text[]`, `return_path`, `list_unsubscribe`, `list_id`, `auto_submitted`, `precedence`, `has_calendar` (set from `text/calendar` in `imap/capture.ts:135,150`), `from_name`, `auth_results`, attachments and links. Read with `getEmailHeaders` (`mail/repo/headers.ts`). Text fields are cleared with the body retention (`texts_cleared_at`). `isNoreplyAddress` in `packages/core/src/triage/rules.ts` is a core helper and is already used by `planners.ts` for clarification drafts. — observed
   - A mail with no `email_headers` row has no capture, and `parts_known` marks whether the parts were read.
4. **Suspicious** — `triage_results.suspicious_reasons text[]`, with codes `auth_fail`, `lookalike_domain`, `display_name_spoof`, `reply_to_mismatch`, `link_mismatch` and `risky_attachment` (`20261115120001_suspicious_urgency_sender.sql`). `suspiciousReasonsOf` (`triage/suspicious-repo.ts:72`) reads the newest result per mail and returns a Map with only the non-empty entries. It ignores the `suspicious_mail` flag by design (PD-063 safety rule). `suspicious-show.ts` gives the display version, which is empty while the flag is off. — observed
   - **An untriaged mail is NOT distinguishable from a clean one.** Both are absent from the map. `review-4.md` N3 says F115 must also require a `triage_results` row or use a three-state return. Mail with no result is also skipped by `listFrequentSenders`.
   - `suspiciousThreadKeysOf` is exported from `triage/index.ts:57`. I did not read it.
5. **Eligibility** — `packages/core/src/triage/planners.ts:128`, `planActions` returns `[]` for `needs_reply`. No draft is planned for it today. Drafts exist only for `delegation` (`planDelegation`, draft and send, with `holdDelegation` when suspicious, `planners.ts:107`) and for a Junk mail moved to INBOX. — observed
   - Per-mailbox: `mailbox_settings.mode` is `shadow` or `assist`, default `shadow` (`20261103100001_mail.sql:36`), and `tool_switches` jsonb keys are `move`, `mark_read`, `flag`, `create_draft` and `move_unsure` (`triage/settings.ts:8-14`).
   - `decidePolicy` (`triage/policy.ts:19`): a draft applies only if `mode==='assist'` AND `tool_switches.create_draft`, else `log_only`.
   - `category_policy` also exists, and `urgency_profile` jsonb is new in F109.

Checks: `apps/server/test/integration/triage-suspicious-readers.test.ts` covers `suspiciousReasonsOf` (flagged, cleaned, clean and no-row cases, and org isolation); it misses a three-state untriaged result. `apps/server/test/integration/mail-sent-readers.test.ts` covers `listUserAnswers`, `getSentSummary` and `listSentHealth`; it misses a thread-level rule. I ran neither.

## Scout 4

Job id: `2026-11-15-f115-scout-4-4cd07add`

**Question:**

How do Telegram notices, consent and logs work at HEAD: the Telegram consent step and its version/bump rule (F098, docs/owner-decisions.md 2026-11-15 consent rule), quiet hours, digest and urgent notice rendering and callback buttons (modules/channels), ForceReply or text-reply handling, i18n pl/en for Telegram text; F103 log events (spec/features/active/F103-e8a-logs: the event-line logger API, event naming, which stages are on master); F106 DSR map (spec/features/active/F106-...: how new mail-derived fields enter delete/export) and F099 send limits (do they count draft sends?). Also where organizations.style_text and the From display name are used, and the mailboxes table columns. Context: spec/features/planned/F115-e6a-reply-drafts/ticket.md (epic docs/product/stage-2/epics/E06-reply-drafts.md, notes E06-discovery-notes.md). Answer for the code at HEAD.

**Packet:**

Packet: Telegram consent, notices, logs, DSR map and send limits at HEAD, for F115 reply drafts
Base: 53dd39b2
Verified: `grep -rn "ForceReply\|force_reply" apps/server/src packages/core/src --include=*.ts` -> no match (exit 1); `git status --porcelain | wc -l` -> 0
Unknowns:
- `texts/bot.ts` holds the Telegram pl/en text tables. I did not read the contents of the consent text itself.
- The line `bot.ts:40` says "other messages" is the last router step. I saw that step is the help reply, not its body.
- I did not read the F106 export-map rules beyond `style_text` being exported.

1. Consent: `packages/core/src/web/telegram.ts:19` has `TELEGRAM_CONSENT_VERSION = "2026-11-14"`. `apps/server/src/modules/channels/routes.ts:45` returns 409 `telegram_consent_outdated` on a mismatch. Line 61 writes the audit row. Consent applies only to new link requests; chats linked earlier keep their link (owner-decisions.md:233). Bump rule (owner-decisions.md:372, `docs/code-patterns.md:134`): bump when a new kind of mail-derived data reaches Telegram (address, name, domain, subject, body, attachment name, link host). Do not bump for fixed phrases from our own rule codes. Change the consent text and the version in one commit (`apps/web/src/i18n/en.ts` and `pl.ts`). A reply-draft body or quoted mail text sent to Telegram is a new kind of data, so it needs a bump. — observed
2. Quiet hours: `packages/core/src/digest/local-time.ts:20` sets `QUIET_HOURS` to 22:00–07:00 in the organization timezone. `apps/server/src/modules/channels/sender.ts:136` holds every non-digest notice kind in that window and releases it at `quietEnd`. The per-user send limit sits at line 142. Notices render at send time through `renderNotice(kind, view, {locale})` (`sender.ts:118`); only old rows keep `row.text`. — observed
3. Notices and buttons: `apps/server/src/modules/channels/notices/index.ts:33` lists the detectors, and `queuedBy` lists producers outside it. Buttons are inline only (`telegram/api.ts:17-24`, `reply_markup.inline_keyboard`). The callback union is in `packages/core/src/digest/callback.ts:35-46` (approve, reject, approve_set, send_again, went_out, delegation_done, reject_reason, mistake, plus feedback and answered taps). `channels/callbacks.ts` dispatches them. A new button needs a new `kind` there and a handler. Old cards keep their text, and buttons work 7 days or 48 h (`code-patterns.md:136`). — observed
4. i18n and no text replies: Telegram text lives in `packages/core/src/texts/` (`textTables: Record<UserLocale, CoreTexts>` with `en` and `pl`, `texts/index.ts:51`; `textsFor(locale)`). `code-patterns.md:141` says to add an entry there and not to write text in a renderer, and to add a Polish unit test. Unlinked-chat text, commands and buttons are the only inputs. Free text from a linked chat gets help only, so a text-reply flow is new work. — observed
5. F103 logs (`apps/server/src/platform/log.ts`, `log-fields.ts`): the call is `log.info("event_code", {fields})`, the code matches `EVENT_CODE = /^[a-z][a-z0-9_]{0,63}$/`. Field names come from the three kinded lists (uuid, number, code) in `log-fields.ts`; add a new name where it is first logged, with ids, codes, counts and times only. `withLogContext` adds `job`, `run_id` and `request_id`. The free-text form is `@deprecated`. On master, stages 01–07 are merged (CLI output, sender/operator, Telegram, channels/delegation/tenancy). Stages 08–19 are not (committer/expiry, apply/drafts/send, mail, triage, lint everywhere, canary, log store). The `no-restricted-syntax` lint error covers only the converted folders. — observed
6. F106 map (`apps/server/src/modules/privacy/address-map.ts`): every text, array or jsonb column that may hold a third-party address needs an entry in `DSR_ADDRESS_MAP` (rules sender, recipients, text, json, equal, list) or in `NOT_PERSONAL` with a reason. A completeness test reads `information_schema` and fails for a column in neither. A new draft column on a message table must be added to `MESSAGE_TABLES` and to the map. `export-map.ts` carries `style_text`. — observed
7. F099 send limits: `actions/repo/sends.ts:291` `listRecentSends` counts only `type='send'` actions with `send_started_at` in the window and status `applying`, `applied` or `failed`/`outcome_unknown`. `actions/send-limit.ts` checks under the mailbox lock, with limits per mailbox hour, mailbox day and recipient day. Draft actions are not counted. A draft counts only when its send starts. A held send returns to `approved` and the sender releases it later. — observed
8. `style_text`, From name, mailboxes columns:
   - `organizations.style_text` (`schema.ts:379`) is read at `committer.ts:236`, `edit.ts:114` and `notices/approval.ts:51`. It becomes the signature in `packages/core/src/outgoing/message.ts:78-79`, and falls back to the owner's display name when empty.
   - The From header is `{name: owner.displayName, address: mailbox.address}` (`message.ts:107`). `owner.displayName` is `users.display_name`, with `mailbox.address` as the fallback (`committer.ts:235`).
   - `mailboxes` has no display-name column. Its columns (`schema.ts:286`) are address, auth_reason, capabilities, created_at, folder_map, id, imap_host, imap_port, last_synced_at, last_uid, oauth_provider, org_id, protocol, send_via, smtp_host, smtp_port, smtp_security, status, status_changed_at and uidvalidity. — observed

Checks: `apps/server/test/integration/web-telegram.test.ts` covers the consent route; `channels/notices/registry.test.ts` covers the notice registry; the F106 completeness test covers the address map. I ran none of them.

