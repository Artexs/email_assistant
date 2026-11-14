# F100 · E3a Measure — plan

> **Status 2026-11-14 — planned.** 16 stages written; cold review: see § Cold review. Nothing built yet. The build waits for F095 (E1) in `spec/features/done/` and, per stage, for the F097 stages named in § How to run.

Sources: `docs/product/stage-2/epics/E03-measured-core.md` (epic page with "Discovery"), `docs/product/stage-2/epics/E03-discovery-notes.md` (design sketch §2, cross-epic §5), `docs/product/stage-2/decisions.md` (PD-056–PD-069; also PD-030, PD-044, PD-045, PD-077, PD-108, PD-113, PD-127), ADR 0028 (autonomy evidence), the F097 plan (`spec/features/planned/F097-e2a-offline-lab/plan.md`, seams S2), `docs/product/stage-2/05-execution-plan.md` §2.1 row 6 and §2.5. Dropped tickets absorbed: `spec/features/dropped/2026-11/F033-handled-share-metric/`, `F042-handled-share-delegations/`, `F073-openai-budget-alert/`.

## Input

### Owner words (word for word)

- E3 discovery decisions: "in default values" (`decisions.md` PD-056 to PD-069).
- Planner job rules (2026-11-14, `task.md` of this job): "no owner checkpoints for confirmation; an owner step only for what needs the owner's hands (real secrets, real money, a phone); small questions get a default in questions.md."
- Board (`spec/build.md` NEXT, owner decision 2026-11-13): "VPS, ssh and deploy steps are pre-approved; the coordinator does them (backup first, name the rollback target, verify after)."

### Product decisions (from `decisions.md`; do not reopen)

- **P1 (PD-056)** E3 splits. This ticket is **E3a Measure**: metric module, weekly report, stats page, M3 capture, header capture, IMAP flags, 2-min sync, M7, F033, F042, F073. One metric module in `packages/core`; the E2b week scorer calls it.
- **P2 (PD-057)** M3 counts: an automatic move that hid mail whose true label is `urgent`, `needs_reply` or `delegation` (also whitelisted or VIP mail moved to spam); a draft rejected as "wrong person"; a draft rejected as "wrong content"; a sent mail marked "this was a mistake" within 7 days. Not counted: "not needed" or no reason, edits, Undo of unimportant mail. Capture: optional reason buttons after a reject and a "mistake" button on the send result.
- **P3 (PD-058, PD-030)** M1 on real mail = corrections + `/review` labels + moved-back mail with a label + `\Answered` mail the system did not mark `needs_reply` (confirmed in `/review`); the report calls it a lower bound. Labels measure; they never unlock `auto`.
- **P4 (PD-059)** M7 = all LLM calls + a hosting share (Hetzner CX23 €5.99 per month ÷ 20 mailboxes) + a backup share; target ≤ $5 per mailbox per month; no cost-reduction work.
- **P5 (PD-063)** Header capture: `From` display name, `Reply-To`, `Return-Path`, the receiving server's `Authentication-Results`, `List-Unsubscribe`, attachment list, link hosts, IMAP flags; same retention as the mail text. The phishing rules are E3b.
- **P6 (PD-065)** M5 = 90th percentile of (urgent notice sent − mail arrival). Sync every 2 min instead of 5; fall back to 3 min if the pilot host throttles. IDLE stays in E8.
- **P7 (PD-066)** Weekly report: a Monday message (M1, M2, M3 with counts first, then M4, M5, M7, and per category its `auto` evidence) and a read-only stats page (8 weeks, per mailbox) on one stats API route; the handled-share line goes into the daily digest. E4's autonomy page and E7's console read the same route.
- **P8 (PD-067)** F073 joins E3a: the quota pause is named in `/status` and the digest; the owner sets the provider budget alert.
- **P9 (PD-068, PD-045)** E3a stores the IMAP flags once, for the M1 `\Answered` signal and the E4-B history check. New user-visible behaviour ships behind feature flags, default off.

### Cross-epic inputs (built into this plan; `05-execution-plan.md` §2.5)

- **X1 (E6 notes §5, PD-077)** Header capture also stores `Auto-Submitted`, `List-Id`, `Precedence` and a `text/calendar` marker. Reject reasons cover every send kind (reply drafts later). → D2, D21.
- **X2 (E11 notes §5, PD-113)** The flag store keeps `\Seen` and `\Flagged`, with the first time each was seen. → D6.
- **X3 (E5 notes §5a, PD-127)** M2 has two numbers, "surfaced on time" and "closed on time"; E5 loop rows plug in later. → D12.
- **X4 (E4 notes §5)** E4-B reads `List-Unsubscribe` and the flags from this capture, no second capture; E4-A shows the reason select through the E3a route. → D2, D6, D21.
- **X5 (E8 page "Input from the E3 discovery")** The E8 latency alert reads the M5 definition (`emails.received_at`, `outbox.sent_at`). → D15.
- **X6 (E7 notes)** The operator console reads the stats service per organization. → D19.
- **X7 (F097 seam S2)** E3a reuses `wilsonInterval` and counts `source = 'review'` labels as the random sample. → D11, D17.
- Not built here: E6's draft outcome line in the weekly report (no reply drafts exist; E6a adds a section, seam S5).

### Design decisions

- **D1 Two migrations.** Stage 04 holds the tables: `email_headers`, `email_flags`, `action_feedback`, and `triage_feedback.source` gains `answered_check`. It waits for F097 stage 03, which changes the same `triage_feedback_source_check` (adds `review`); this migration lists all seven sources. Stage 14 adds `weekly_report` to `outbox_kind_check`, because the schema test compares that CHECK with `noticeKinds` exactly and a kind needs its renderer and detector in the same change (code patterns § Add a notice kind). Rejected: one migration per feature stage (five migrations to serialize against other tickets); the outbox kind in stage 04 (a kind without a renderer and a detector fails the registry tests).
- **D2 Captured fields.** `CapturedHeaders` (in `mail/port.ts`, so E9 adapters return the same shape): `fromName` (≤ 200 chars), `replyTo` (addresses, lower case, ≤ 5), `returnPath` (address, lower case), `authResults` (the topmost `Authentication-Results` value, ≤ 1,000 chars), `listUnsubscribe` (≤ 1,000), `listId` (≤ 300), `autoSubmitted` (≤ 100), `precedence` (≤ 50), `hasCalendar` (a `text/calendar` part or top type), `attachments` (≤ 20 of `{ name ≤ 200 | null, type ≤ 100, size, inline }`) and `attachmentCount` (all), `links` (≤ 50 of `{ host, textHost | null }`, hosts lower case without port, deduplicated by the pair) and `linkCount`, `partsKnown` (false when only the header block was read). Every string loses U+0000 and is trimmed; an empty string is null. Header values come from `parsed.headerLines` (first line of each key = the topmost), never from `parsed.headers`, because mailparser drops the `List-*` headers there (fact F1). Links come from the HTML part: each `<a href>` with an `http` or `https` URL gives `host`; when the visible text of the link (tags removed) is a URL or a bare host (`^[a-z0-9.-]+\.[a-z]{2,}$`), `textHost` is its host. Without an HTML part, `http(s)://` URLs in the text part give hosts with `textHost` null. Rejected: storing raw header blocks (more personal data, no fixed shape).
- **D3 Port change.** `MailProvider.fetchBodyText` becomes `fetchContent(folder, uid): Promise<MailContent>` with `MailContent = { text: string | null; capture: CapturedHeaders | null }` (capture null only when the UID is gone). Over the body size limit: `text` null and the capture from a header-only fetch with `partsKnown: false`. New `fetchFlagsIn(folder, uids): Promise<{ uid: number; flags: string[] }[]>` (UID FETCH FLAGS; `[]` for a missing folder; unknown UIDs left out). Rejected: a second fetch of the source for headers (one more round trip per mail).
- **D4 Store the capture.** One `email_headers` row per stored mail, inserted in the transaction of the `emails` insert (`applyChunk`), only when the insert inserted. Mail stored before this ticket has no row (no back-capture); the backfill path captures like the sync. A capture that fails to parse stores `null` capture → no row, and the sync goes on (a counted `capture_failed` event line).
- **D5 Header retention.** The text fields of `email_headers` follow the mail body (`organizations.data_retention_days`): `clearCapturedHeaders` sets `from_name`, `reply_to`, `return_path`, `auth_results`, `list_unsubscribe`, `list_id` to null, `attachments` and `links` to `[]`, and sets `texts_cleared_at`. It keeps `attachment_count`, `link_count`, `has_calendar`, `auto_submitted`, `precedence`, `parts_known` (codes and counts). Retention calls it with the body cut-off.
- **D6 Flag store and refresh.** `email_flags` (one row per mail): `seen`, `answered`, `flagged` (the latest read), `first_seen_at`, `first_answered_at`, `first_flagged_at` (the first refresh that saw the flag; never reset), `checked_at`, and the answered check (`answered_check` `yes`/`no`, `answered_check_at`, `answered_check_by`). The sync job refreshes flags inside its run, on the same connection, when the last refresh of that mailbox in this process is ≥ 10 min old (an in-memory map; a restart refreshes at the first run): mail of the mailbox received in the last 30 days with a known folder and UID, oldest `checked_at` first (never-checked first), at most 3,000 per run, grouped by `emails.folder`, `fetchFlagsIn` in chunks of 500. The write is guarded: it updates only while `emails.folder` and `emails.uid` still equal what the run read (a move in between skips the mail). A refresh error never fails the sync (one `flags_refresh_failed` event line). Rejected: a separate job (one more IMAP login per mailbox per run; throttle risk on Interia).
- **D7 Sync interval.** Config `MAIL_SYNC_EVERY_MIN` ∈ `2`, `3`, `5`, default `2`; `main.ts` schedules `*/<n> * * * *`; the `/resume` text says "within <n> minutes". Rejected: a hard-coded 2 (the PD-065 fallback would need a code change).
- **D8 LLM pause cause (F073).** `latestLlmPause(db, ctx, since)` reads the newest `llm.call` audit row of the organization in the last 2 h; when its `reason_code` is a config or soft LLM error code, the answer is `{ code, since }` (since = the first row of the uninterrupted run of error rows). `/status` adds one line: quota code `http_429_quota` → "LLM: paused since HH:MM: the provider quota or budget is spent (http_429_quota)."; other codes → "LLM: paused since HH:MM (<code>)." The digest footer gets the same line through a new optional `DigestInput.llmPause`. No flag: it corrects an operator status text (questions Q4). The OpenAI dashboard budget alert is owner step O1; the steps go to `deploy/README.md`.
- **D9 Week.** A week starts Monday 00:00 in the organization time zone and ends at the next Monday 00:00 (`weekRange(weekStart, timeZone)` through `localToInstant`, so a DST week has 167 or 169 hours). `weekStartOf(at, timeZone)` gives the Monday (`YYYY-MM-DD`). `addWorkingDays(at, n, timeZone)` adds local weekdays (Mon–Fri, no holiday list) and keeps the local clock time.
- **D10 Metric module.** Pure functions in `packages/core/src/metrics/` (new folder, exported from `@ea/core`): one function per metric, input = plain rows, output = numbers and their counts. No DB, no clock (the caller passes `now`). The E2b week scorer calls the same functions with sim rows.
- **D11 M1 (missed important mail).** Per real mail received in the week with a triage result: `predicted` = the latest triage category; `truth` = `true_category` of the latest feedback row (any source) or null; `truthSource` = that row's source. `important` = truth ∈ {`urgent`, `needs_reply`}, or truth null with no "wrong" verdict and predicted ∈ {`urgent`, `needs_reply`}. `miss` = truth `urgent` and predicted ≠ `urgent` (no urgent notice), or truth `needs_reply` and predicted ∈ {`info`, `notification`, `spam`} (the digest's "other mail" section). Output: `important`, `misses`, misses by source (`correction` = cli, telegram, web, undo; `review`; `moved_back` = imap_move; `answered_check`), and the random sample (rows whose truth source is `review`: labelled, important, misses, Wilson 95 % upper bound of the miss rate). The report prints "lower bound". Default, owner to confirm (Q1): the miss rule follows the digest sections.
- **D12 M2 (open loops on time, delegations).** A delegation counts in the week when its due time `due = due_at ?? sent_at + 3 days` is in the week and it was sent (`sent_at` not null) and is not `cancelled`. `deadline = addWorkingDays(due, 1, tz)`. `closedOnTime` = `answered_at ≤ deadline` or a `delegation.done` audit row at or before `deadline`. `surfacedOnTime` = closed on time, or a `delegation.overdue` audit row at or before `deadline` (the chaser raised it). `deadline > now` → `pending` (left out of both rates). E5 adds loop rows later (seam S4).
- **D13 M3 (serious mistakes).** Events, each in the week of its own time: (a) `hidden_important`: an original (`reverses_action_id` null) `move` action with status `applied` or `undone`, `applied_at` in the week and target folder ≠ `inbox`, of mail whose truth (D11) ∈ {`urgent`, `needs_reply`, `delegation`}, or of VIP mail (`triage_results.vip`) or mail whose sender is whitelisted now, moved to `ai_spam`; one event per mail. (b) `wrong_person`, (c) `wrong_content`: a rejected `send` whose `action_feedback` row `reject_reason` has that reason, in the week of the reject (the `action.rejected` audit row). (d) `sent_mistake`: an `action_feedback` row `mistake`, in the week of the send's `applied_at`. Shown, not counted: `not_needed` reasons and rejects without a reason (`rejected` sends with no reason row). Default, owner to confirm (Q2): the event week.
- **D14 M4 (handled share, F033 + F042).** Denominator: real mail received in the week with a triage result. `handled`: category ∈ {`spam`, `notification`, `info`} and an original mailbox action (`move`, `mark_read`, `flag`) with status `applied` and none `undone`, and no "wrong" feedback created within 7 days after the triage; or category `delegation` with a delegation `send` (`payload.kind = 'delegation'`) `applied` and the delegation not `cancelled`. `wouldHandle`: the same first rule with status `logged` (shadow mode). `save_summary` never counts (it is applied in every scope).
- **D15 M5 (urgent notice time).** Per real, non-backfilled mail received in the week whose latest category is `urgent`: `noticeAt` = the earliest `sent_at` of its `urgent` outbox rows. Mail that arrived in quiet hours (22:00–07:00 org time, `isQuietTime`) is left out (the hold is a product rule) and counted as `quietHours`. Output: `urgent`, `noticed`, `withoutNotice`, `p90Minutes` (nearest rank, `ceil(0.9 × n)`), `quietHours`. Default, owner to confirm (Q10). The E8 alert reads the same reader.
- **D16 M7 (cost).** Per week: every `llm.call` row → `costPerMail(model, tokensIn ?? 0, tokensOut ?? 0, at)`; a model without a price counts in `unpricedCalls`. `perMailboxMonthUsd = llmUsdWeek × 30 / 7 / mailboxes + hostingUsdMonth + backupUsdMonth`, where `mailboxes` = active mailboxes of the organization (≥ 1) and the constants live in `packages/core/src/metrics/cost-model.ts` with source and date: hosting $7.10 per month (CX23 €5.99, E3 notes §4) ÷ 20 mailboxes = $0.355; backup $0.05 per mailbox (assumption, E3 notes §4 "< 0.1"); target $5. Default, owner to confirm (Q6).
- **D17 M8 (auto evidence).** Per mailbox and bar category: `auto` (the category policy), the real-label row of `goNoGoFor` (`kept`, `precision`, `decision`) and the Wilson 95 % lower bound of precision (`tp = round(precision × kept)`). The holdout gate file is not on the server (fact F12) and the history check and tripwire are E4-B: their fields are not in the view yet (seam S2). `wilsonInterval` comes from F097 D23; if it does not exist when stage 09 runs, stage 09 adds it with exactly that signature.
- **D18 Real mail.** Every metric reads real mail only: `mailKindFilter("real", testMail)` with the `TestMailRule` of F097 stage 01 (`TEST_SENDER_ADDRESSES`). M5 also leaves out backfilled mail (`backfilled_at` not null).
- **D19 Server shape.** Row readers live in the module that owns the table (`triage`, `actions`, `delegation`, `audit`, `mail`, `channels`), one file each, each with a tenant-filter test. `reports/metrics.ts` exports `weekStats(db, ctx, input, deps)`; the M5 reader is a dependency (`UrgentNoticeReader`), because `reports` may not import `channels` (`channels → reports` exists). The web route gets it from `web.ts`; the weekly detector passes its own. The operator console (E7) calls `weekStats` per organization.
- **D20 Stats route and CLI.** `GET /api/stats?weeks=<1–12, default 8>&mailboxId=<uuid>` (both roles; newest week first; the current, unfinished week is not in the list) → `{ weeks: WeekStats[] }`. Flag `stats_page` off → 404 `not_found`; a foreign or unknown mailbox → 404. `bun run stats:week --org-id <uuid> [--mailbox-id <uuid>] [--week YYYY-MM-DD]` prints one week (counts and rates, no ids of mail, no text) and ignores the flag (operator tool).
- **D21 M3 capture.** Table `action_feedback (org_id, action_id, kind, reason, user_id, via, created_at, updated_at)`, unique `(org_id, action_id, kind)`; kinds `reject_reason` (reason `wrong_person`, `wrong_content`, `not_needed`) and `mistake` (reason null); `via` `telegram`, `web`, `cli`. Service `recordRejectReason` (a `send` with status `rejected`; owner only; a later reason replaces the earlier one) and `markSentMistake` (a `send` with status `applied` and `applied_at` ≥ now − 7 days; owner only; once: a second tap answers "already"). Telegram: when the flag `mistake_capture` is on, the edit after a single reject carries one row of three buttons (`rw:<p|c|n>:<action id>`); a reason tap edits the card to the reject line plus "Reason: …" and no buttons. The send result of kind `sent` carries `[⚠️ This was a mistake]` (`mk:<action id>`) when its view says `mistakeButton: true` (the detector sets it from the flag); a tap edits the card with "⚠️ Marked as a mistake HH:MM." A set reject (`reject_set`) gets no reason buttons. Web: `POST /api/actions/:id/reject-reason { reason }` and `POST /api/actions/:id/mistake` (owner only), the same service; E4-A puts them on the approvals page.
- **D22 Answered check.** Candidates: real mail of the chat's mailboxes received in the last 14 days with `email_flags.answered = true`, latest category ∈ {`info`, `notification`, `spam`}, no feedback row, `answered_check` null; oldest first; at most 5. When the flags `review_command` and `answered_check` are both on and candidates exist, `/review` sends a second message after the random page: "You replied to these mails, but the assistant did not mark them 'needs reply'. Did they need a reply?", each item with `[✅ Yes n]` (`ay:<email id>`) and `[➖ No n]` (`an:<email id>`). Yes → one `triage_feedback` row (`source = 'answered_check'`, verdict `wrong`, true category `needs_reply`, `skipIfSame`) and `answered_check = 'yes'`, one transaction. No → `answered_check = 'no'` only (a "no" says nothing about the category). Default, owner to confirm (Q5).
- **D23 Weekly report.** Outbox kind `weekly_report`; strict view = the organization's `WeekStats` for the last finished week (all mailboxes together) plus `weekStart`, `timeZone`, `answeredWaiting`; no mail text, no address, no id of a mail. One row per linked member (both roles) when the flag `weekly_report` is on, dedup key `weekly_report:<weekStart>`. Time: Monday, at the member's first digest time at or after 07:00 local, else 08:00; the detector queues it from that time until Monday 23:59 local; later it skips the week (the stats page has it). The detector first checks which members lack the row and computes `weekStats` once per organization per tick only when one does. Default, owner to confirm (Q3, Q9).
- **D24 Handled-share line.** When the flag `handled_share` is on, the daily digest footer gets "🤖 Handled in the last 7 days: 62% (124 of 200)" (M4 over the 7 days before the digest time); with every mailbox in shadow mode and no applied plan: "🤖 Would handle in the last 7 days: …" from `wouldHandle`. No line when the denominator is 0.
- **D25 Stats page.** `/stats` page (one island) behind `stats_page`: a mailbox select ("All mailboxes" + each), and one table, rows = the metrics, columns = the last 8 finished weeks, newest left; every cell shows the rate and its count. `/api/me` gains `features: string[]` (the keys that are on for the organization) so the nav shows "Stats" only when `stats_page` is on.
- **D26 Flags.** New registry entries, epic `E3a`, remove-by `2027-03-01`, default off: `weekly_report`, `handled_share`, `mistake_capture`, `answered_check` (`stats_page` exists). Header capture, the flag store, the 2-min sync and the M7 numbers are not user-visible and need no flag.
- **D27 Counts.** Every rate in a message, the page and the CLI prints its count ("1 of 23"). A rate with denominator 0 prints "–". M1 prints "lower bound".
- **D28 Snapshot and recompute.** The Monday message is a snapshot at its queue time; the stats route and the CLI recompute from the DB, so a later label can change an old week there. The view holds the snapshot.
- **D29 Pilot signal probe.** `bun run mailbox:signals --org-id <uuid> --mailbox-id <uuid> [--days 30]` (read-only) prints counts for INBOX mail of the window: total, with `\Answered`, `\Seen`, `\Flagged`, with an `Authentication-Results` line, the distinct `authserv-id` values (the first token of the header, a server name), with `List-Unsubscribe`, capture failures. Its result goes into `notes/2026-11-13-measured-core-facts.md` and decides nothing in this plan (the E3b `auth_fail` rule and the E4-B signal read it).
- **D30 Logs.** Every new log line is an event (`log.info("<code>", { fields })`, fields from `platform/log-fields.ts`); new field names go into that list (counts and codes only).

### Edge cases decided

- **States × events, capture and flags:** a mail stored in a folder, then moved by us → its flags are read in the new folder (the row's `folder` and `uid` follow the move); moved by the user to an unsynced folder → the UID is not found, the row keeps its last flags; a UIDVALIDITY change (rescan) → the guarded write skips rows whose `uid` changed during the run; a paused or `auth_error` mailbox → no sync run, no refresh; a suspended organization → no sync (existing rule).
- **States × events, reject reason:** a reason tap on a send that is not `rejected` (approved meanwhile by another owner) → "This send is not rejected." and no row; on an expired send → the same; the same reason twice → one row, `updated_at` changes; a reason after the 24 h outbox expiry → still works (the tap edits the stored card when it exists, else only answers).
- **States × events, mistake:** a tap on a send older than 7 days → "Too late: a mistake can be marked within 7 days of the send."; on a `failed` send → the button is never shown (only `sent` results); a second tap → "Already marked."; an assistant (not owner) → the owner-only text.
- **States × events, weekly report:** flag turned on on a Tuesday → the first report comes next Monday; a member linked on Monday after the slot → still gets it until 23:59; a member removed (unlinked) → no row; an organization suspended → the notifier skips it (existing rule), the week is lost; a week with no mail → the report says "No mail this week." and still shows M2 and M7.
- **Crash and repeat:** the capture row and the mail row share a transaction (a crash loses both; the next sync stores both). A flag refresh that dies after some chunks → those rows have new `checked_at`, the rest are refreshed next time. A weekly row is unique by `(org_id, user_id, dedup_key)`; a crash between two members queues the second at the next tick. A reason upsert and its feedback for the answered check are each one transaction.
- **Two runs at once:** the scheduler never overlaps two ticks of one job; one server process runs the jobs. The web reason route and a Telegram tap on the same action → the upsert keeps the later reason.
- **Tenants:** every new repository function filters `org_id` on every joined table; a tenant-filter test per function (code patterns § Data access). `email_headers` and `email_flags` reach `emails` by `(email_id, org_id)`; `action_feedback` reaches `actions` by `(action_id, org_id)`.
- **Clocks and time zones:** week bounds and working days in the organization time zone through `localToInstant`; tests use Europe/Warsaw and the DST week of 2026-10-26 (Monday after the 2026-10-25 change: the week before has 169 hours); `now` comes from the caller in every function; tests pass fixed instants.
- **Secrets and private data:** captured header values, link hosts, attachment names and display names never reach a log line, an error text, a test name or a CLI line (the signals CLI prints counts and `authserv-id` server names only). The weekly view holds numbers only. The new tables join the organization delete by cascade; the E7-T3 DSR map gets `email_headers` and `email_flags` (seam S6).

## Facts checked

- **F1** mailparser 3.14.1 (`node_modules/mailparser/package.json`), probe 2026-11-14 with a hand-made multipart message: `parsed.headers` has no `list-unsubscribe` and no `list-id` (and `parsed.list` is undefined) while `parsed.headerLines` keeps both raw lines; two `Authentication-Results` lines come in header order in both `headers.get(...)` (an array) and `headerLines`; `From: "Jan <ceo@corp.test>" <x@evil.test>` gives `from.value[0] = { name: "Jan <ceo@corp.test>", address: "x@evil.test" }`; a `text/calendar` part is in `attachments` with `contentType: "text/calendar"`; `Return-Path` parses to an address object; an HTML-only mail has `text` undefined and `html` a string. Stage 01 test 1 repeats this message as a fixture.
- **F2** Interia capabilities: IDLE yes, MOVE no, UIDPLUS yes, CONDSTORE no, KEYWORDS no (`notes/2026-11-03-interia-imap-capabilities.md`). No CHANGEDSINCE: the flag refresh fetches FLAGS by UID.
- **F3** The sync runs `*/5 * * * *` (`apps/server/src/main.ts`); the scheduler skips a tick while the job runs (`platform/scheduler.ts`, croner `protect`). The sync uses one IMAP connection per mailbox per run (`mail/jobs.ts` `syncOne`).
- **F4** `llm.call` audit rows hold `role`, `model`, `tokens_in`, `tokens_out`, `mailbox_id` in `data` and the outcome in `reason_code` (`audit/repo.ts` `recordLlmCall`); today only `triage/service.ts` writes them. The pause object lives in the triage job's memory (`triage/pause.ts`), so `/status` (Telegram runtime) cannot read it; the audit rows can.
- **F5** Urgent notices: one outbox row per member, dedup `urgent:<email id>` (`channels/notices/urgent.ts`); the sender holds every non-digest row in quiet hours 22:00–07:00 (`channels/sender.ts`, `QUIET_HOURS` in `packages/core/src/digest/local-time.ts`).
- **F6** Feature flags exist (F087): `featureFlags` already holds `stats_page` (epic E3a); `isFeatureOn(db, ctx, flag)` in `tenancy`; no product code reads a flag yet; `/api/me` has no feature list; the nav has 4 tabs (`apps/web/src/components/shell/nav-items.ts`).
- **F7** F097 interfaces this plan uses (its stage files, 2026-11-14): stage 01 `TestMailRule { senders }`, `mailKindFilter(kind, rule)`, `testMailRule(config)` or the composition-root variant; stage 03 feedback source `review` and the CHECK `triage_feedback_source_check`; stage 04 `reviewMessage(deps, link)` in `channels/commands.ts` and the review page; D23 `wilsonInterval(successes, n, z = 1.959964) → { lower, upper }` in `packages/core/src/triage/metrics.ts`.
- **F8** Delegations: `markDelegationSent` sets `due_at = coalesce(due_at, now + DELEGATION_DUE_AFTER_MS)`; the chaser writes `delegation.overdue`; close and answer write `delegation.done` and `delegation.answered` (`delegation/{repo,chaser,service}.ts`).
- **F9** Retention: the body follows `data_retention_days`; other texts go after 90 days; `clearMailHeaders` already clears `emails` header columns (`mail/repo/retention.ts`, `apps/server/src/retention.ts`).
- **F10** Prices: `llmPrices` has `gpt-6-luna`, `gemini-3.8-flash`, `gemini-3.5-flash-lite`; no `gpt-6.1-terra` (`packages/core/src/triage/cost.ts`).
- **F11** Move targets: `inbox`, `ai_info`, `ai_notifications`, `ai_spam`, `ai_manual` (`packages/core/src/triage/planners.ts`); the spam plan moves to `ai_spam`.
- **F12** The server image copies `apps`, `packages`, `db` and `evals/cases` only (`deploy/Dockerfile`): the F097 gate files under `evals/results/gate/` are not on the server.
- **F13** `apps/server/src/modules/mail/sync.ts` is 609 lines and `triage/repo.ts` 629 (over the 400-line rule): new code goes into new files; the edits in these two files stay small.

## Not verified

- **N1** Interia sets `\Answered` when the owner replies from webmail or the phone app. Stage 03 run (C2) counts it. Without it the answered check finds nothing; the E5a "answered by the user" mark replaces it later (E5 notes §6).
- **N2** Interia adds `Authentication-Results`. Stage 03 run (C2). Only E3b reads it.
- **N3** One login per mailbox every 2 min is not throttled by Interia. C4 watches 24 h of sync event lines after the deploy; on throttling the coordinator sets `MAIL_SYNC_EVERY_MIN=3` on the VPS.
- **N4** `UID FETCH <500 uids> (FLAGS)` works on Interia. GreenMail in stage 02; the real host in the stage 03 run.

## Done when

1. `bun run mailbox:signals` ran on the pilot mailbox and its counts are in `notes/2026-11-13-measured-core-facts.md`. Shown by: C2 lines in that note.
2. A mail stored by the sync has one `email_headers` row with the D2 fields, written in the same transaction; retention clears its texts with the body. Shown by: stage 05 integration tests.
3. The sync run refreshes `email_flags` (at most every 10 min per mailbox, guarded write). Shown by: stage 06 integration tests; after C3 `select count(*) from email_flags` > 0 on the VPS.
4. The sync runs every `MAIL_SYNC_EVERY_MIN` minutes (default 2); `/status` and the digest name an LLM pause with its code. Shown by: stage 07 tests; C3 sync lines 2 min apart.
5. `weekStats` returns M1–M5, M7, M8 for one organization and week; `GET /api/stats` and `bun run stats:week` use it. Shown by: stages 08–11 tests.
6. With `weekly_report` on, each linked member gets one `weekly_report` row per week on Monday; the text leads with M1, M2, M3 with counts. Shown by: stage 14 tests; C6 the first pilot report.
7. Reject reasons and the mistake tap write `action_feedback` rows behind `mistake_capture`, and M3 counts them. Shown by: stage 12 tests.
8. `/review` adds the answered check behind `answered_check`; a "yes" writes `source = 'answered_check'` feedback. Shown by: stage 13 tests.
9. The daily digest has the handled-share line behind `handled_share`; the stats page shows 8 weeks behind `stats_page`; `docs/capabilities/measurement.md` exists and the touched pages are updated. Shown by: stages 14–16.

## Seams (for other tickets; not built here)

- **S1 E3b (F109):** reads `email_headers` (phishing rules, attachments in the prompt and summary, `List-Unsubscribe` as a signal) and the `authserv-id` facts of D29.
- **S2 E4-B (F110):** reads `email_flags` and `email_headers` for the history check (no second capture); adds the holdout, history-check and tripwire fields to `WeekStats.m8` as optional fields (a view change must still accept views of the last 24 h); its autonomy page reads `GET /api/stats`.
- **S3 E4-A (F102):** the approvals page calls `POST /api/actions/:id/reject-reason` (the reason select) and may show the mistake action.
- **S4 E5 (F104, F116):** loop rows plug into `m2` as new fields (`loopsDue`, …) through the same core module; the E5a "answered by the user" mark joins the answered check candidates (D22).
- **S5 E6a (F115):** reject reasons already cover any `send` kind; the draft outcome line is a new section of the weekly view (optional field); `auto_submitted`, `precedence`, `list_id`, `has_calendar` exist.
- **S6 E7 (F099, F106, F107):** the operator console calls `weekStats` per organization; the DSR map and the organization delete name `email_headers` (text), `email_flags`, `action_feedback`; `docs/cost-model.md` reads weekly M7.
- **S7 E8 (F114):** the latency alert reads `listUrgentNoticeTimes` and the M5 rule (D15); IDLE replaces the 2-min poll later.
- **S8 E2b (F113):** the week scorer calls `packages/core/src/metrics/` with sim rows.

## Rules for every stage

- Read `CLAUDE.md`, `.agents/limen/styleguide.md`, `docs/code-patterns.md`, the ticket, this file and your stage file first. Build only your stage.
- `packages/core` stays pure: no `fs`, no `process.env`, no `Date.now()`, no DB. Functions take `now` and `timeZone` as arguments.
- Every repository function takes a `TenantContext` and filters `org_id` on every table it touches; each new one gets a tenant-filter case (another organization's rows never appear).
- Logs: new lines are events with fields from `platform/log-fields.ts`; add a new field name there in the same stage. Never log, throw or print a captured header value, a display name, an attachment name, a link host, a subject, an address, mail text or a key. Test names hold no mail data.
- Never read or print `.env`. Tests build config from literal env objects.
- A new user-visible behaviour reads its flag with `isFeatureOn(db, ctx, "<key>")` once per run or per request.
- A notice text comes only from a renderer in `packages/core/src/notices/`; the producer queues facts with `queueNotice` (code patterns § Notices are facts).
- A stage that changes a type or a port fixes every caller, both adapters and every test in the same stage.
- Format only the files of your stage: `bunx prettier --write <files>`. Never the whole repo (S2 incident: a builder ran the repo-wide formatter).
- No temporary file inside the worktree (`bun run lint` lints every `.ts` file): use `/tmp/f100-sNN/`.
- Comments state the rule in one sentence; no bare codes (`D14`, `F100`, `PD-057`) in code comments; name an ADR or a ticket folder path when a source is needed.
- Two migrations in the whole ticket (stages 04 and 14). No `bun.lock` change and no new dependency in any stage.
- A new import between modules → `bun run graph:modules` and commit `docs/diagrams/module-graph.{md,json}` (code patterns § Layers and borders).
- Commit by explicit path (`git add <paths>`), never `git add -A`.
- `bun run test:int:ci` runs in your own DB (the prepare script makes it); no lock. Never run `bun run test:e2e`.
- Do not edit `spec/build.md`, `docs/product/stage-2/*` or another ticket.
- A gap or a deviation is a question in your final message, not a choice.
- Test helpers: `createOrgWithMailbox` (`apps/server/test/integration/fixtures.ts`), the fake mail provider `createFakeMailProvider` (`mail/fake/index.ts`), the contract suite `apps/server/test/contract/mail-provider.ts`, the Telegram test helpers (`apps/server/test/integration/telegram-helpers.ts`), `waitFor` (`apps/server/test/wait-for.ts`), the web route helpers (`apps/server/test/integration/web-helpers.ts`). This plan adds `metricRows` fixtures in `packages/core/src/metrics/fixtures.ts` (stage 08; stage 09 adds to it) and `seedWeek` in `apps/server/test/integration/metrics-fixtures.ts` (stage 10; stages 11–14 reuse it).

## Proof

Run after the last commit, as one bash call with nothing after it; read the logs in a separate call. In the final message list as proven only what a saved log shows. `NN` = the stage number.

```
mkdir -p /tmp/f100-sNN && bun run lint > /tmp/f100-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f100-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f100-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f100-sNN/int.log 2>&1 && echo PROOF_OK
```

While it works, a worker runs only the tests of the code it changed; the full chain runs once, as the proof.

## Owner checkpoints

None. The coordinator builds on the review results; the decisions marked "default, owner to confirm" are in [questions.md](questions.md) and do not stop the build.

## Owner steps

| # | Step | When | Needs the owner because |
| --- | --- | --- | --- |
| O1 | Set a monthly budget alert on the OpenAI project (steps in `deploy/README.md` § "LLM provider budget", written by stage 07). | Any time after stage 07 lands. The build does not wait. | The OpenAI account and its money (F073). |

## Coordinator steps (no owner)

| # | Step | When |
| --- | --- | --- |
| C1 | `bun run db:migrate` on the shared dev DB (main checkout). | After stage 04 lands, and again after stage 14 lands. |
| C2 | Deploy the image with stages 01–03 to the VPS (pre-approved; backup first, name the rollback target, verify after). Run `bun run mailbox:signals --org-id … --mailbox-id …` for the pilot mailbox in the app container (`--days 30`). Append its printed lines (counts and server names only) to `notes/2026-11-13-measured-core-facts.md` under "E3a stage 03 run (date)", and answer N1, N2, N4 there. | After stage 03 lands. |
| C3 | Deploy stages 04–07 (the migration runs in the deploy) with `MAIL_SYNC_EVERY_MIN` unset (default 2). Verify: the `server_listening` line, two sync runs 2 min apart in the log, `email_headers` rows for mail stored after the deploy, `email_flags` rows after 10 min. | After stage 07 lands. |
| C4 | Watch 24 h of sync lines on the VPS after C3: count `sync … the next tick tries again` warnings and `auth_error` changes of the pilot mailbox. More than 3 soft failures in an hour, or an `auth_error`, that did not happen in the 24 h before → set `MAIL_SYNC_EVERY_MIN=3` in the VPS `.env` (not a secret), restart, write it in the ticket log and in the note of C2. | 24 h after C3. |
| C5 | Deploy the rest; turn on for the pilot organization with `bun run org:flag` (syntax: its usage line): `stats_page`, `weekly_report`, `handled_share`, `mistake_capture`, `answered_check`. `answered_check` needs `review_command` (F097) on. | After stage 16 lands. |
| C6 | After the first Monday with `weekly_report` on: run `bun run stats:week --org-id … --week <that Monday − 7 days>` on the VPS and copy its lines (counts only) into the ticket log. This is the "first E3a weekly report" trigger of the E5 second pass (PD-119, PD-120, PD-122). | First Monday after C5. |

## Review

- A review job before the land for stages 02 (port, both adapters), 04 (`[risky]` migration), 05 (`[risky]` sync write path), 06 (`[risky]` flag write guard), 10 (tenant filters), 11 (route, CLI), 12 (taps that change data, owner checks), 13 (labels), 14 (`[risky]` second migration, notices to people). Model: the board's reviewer (`spec/build.md` § TRACK: `claude-sonnet-5-5`, high). The reviewer may run `bun run test:int:ci` at the candidate commit.
- Other stages land on the worker's proof.

## Stages

| # | Stage | Size | Mark |
| --- | --- | --- | --- |
| 01 | [Capture parser](stages/stage-01-capture-parser.md) — `CapturedHeaders`, `captureFromParsed`, link hosts | ~250 lines | |
| 02 | [Port and adapters](stages/stage-02-port-and-adapters.md) — `fetchContent`, `fetchFlagsIn`, IMAP and fake, contract | ~250 lines | review |
| 03 | [`mailbox:signals` probe](stages/stage-03-signals-probe.md) — read-only counts on the pilot (C2) | ~150 lines | |
| 04 | [Migration](stages/stage-04-migration.md) — `email_headers`, `email_flags`, `action_feedback`, feedback source | ~220 lines | [risky], review |
| 05 | [Store the capture](stages/stage-05-store-capture.md) — sync and backfill write, retention | ~250 lines | [risky], review |
| 06 | [Flag refresh](stages/stage-06-flag-refresh.md) — in the sync run, guarded write | ~280 lines | [risky], review |
| 07 | [Sync every 2 min and the LLM pause line](stages/stage-07-sync-interval-and-pause.md) (F073) | ~220 lines | |
| 08 | [Core metrics I](stages/stage-08-core-metrics-1.md) — week math, M1, M2, M3 | ~300 lines | |
| 09 | [Core metrics II](stages/stage-09-core-metrics-2.md) — M4, M5, M7, M8, `WeekStats` schema | ~300 lines | |
| 10 | [Row readers](stages/stage-10-row-readers.md) — one reader per owner module | ~350 lines | review |
| 11 | [Week service, stats route, `stats:week`](stages/stage-11-week-service.md) | ~250 lines | review |
| 12 | [Reject reasons and the mistake tap](stages/stage-12-mistake-capture.md) | ~320 lines | review |
| 13 | [Answered check in `/review`](stages/stage-13-answered-check.md) | ~220 lines | review |
| 14 | [Weekly report and the handled-share line](stages/stage-14-weekly-report.md) — outbox kind migration | ~320 lines | [risky], review |
| 15 | [Stats page](stages/stage-15-stats-page.md) — `/api/me` features, nav, page | ~280 lines | |
| 16 | [Docs and capability pages](stages/stage-16-docs.md) | docs | |

## How to run (coordinator)

1. Before the first spawn: F095 (E1) is in `spec/features/done/`. Move the ticket: `git mv spec/features/planned/F100-e3a-measure spec/features/active/`, commit (the worktrees see only committed files).
2. Order and lanes.
   - Lane A (mail): 01 → 02 → 03 → (C2). Then 05 after 02 and 04; 06 after 05.
   - Lane B (schema): 04 after F097 stage 03 has landed on `master` (it changes the same CHECK). Stages 04 and 14 are the migrations of this ticket: never next to another ticket's migration stage, and C1 runs after each.
   - Lane C (core): 08 → 09 (any time; next to lanes A and B).
   - 07 any time after 02 (both edit `main.ts` and `mail/jobs.ts` area lightly: not next to 06).
   - 10 after 04, 09, and F097 stages 01 and 03 landed. 11 after 10. 12 after 04 and 09 (next to 10/11 is fine; 12 and 13 both edit `channels/callbacks.ts`: not next to each other). 13 after 06, 10 and F097 stage 04 landed. 14 after 11, 12 and 13 (it uses `countAnsweredWaiting` of 13; 12 and 14 edit the same notice files: in order). 15 after 11. 16 after all.
3. Shared files with other tickets (advisory, `05-execution-plan.md` § 2.4): stage 02 and 05 edit `mail/sync.ts`, `mail/port.ts`, both mail adapters (F097 stage 01 edits `mail/repo/emails.ts`; F085 and E5a F104 edit the sync later); stage 12 and 13 edit `channels/callbacks.ts` and `packages/core/src/digest/callback.ts` (F097 stages 03–04 edit the same files: F100 12 and 13 run after them). The later job merges `master` before its proof.
4. Spawn a stage (`NN`, `<slug>` from the stage list):

   ```
   limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
     --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
     --prepare 'bash scripts/limen-prepare.sh' --label "F100-sNN <slug> · F100" \
     "Implement F100 stage NN. Read spec/features/active/F100-e3a-measure/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: the Proof command of plan.md for your stage (/tmp/f100-sNN), one bash call with nothing after it, run after the last commit; read the logs in a separate call. In the final message, list as proven only what a saved log shows."
   ```

5. Review (stages in § Review): spawn and poll `limen jobs <id>`; a finding → `limen continue <job-id> "<fix>"`, then review again (at most 2 rounds, then decide from "Input" or ask the owner):

   ```
   limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
     --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
     --review --detached --branch <B> --label "review s<NN> · F100" \
     "Review F100 stage NN on <B> against spec/features/active/F100-e3a-measure/plan.md and stages/stage-NN-<slug>.md. Check that every numbered test exists and asserts what the stage says, every decision the stage cites, every org_id filter, and that no log line, error or view holds a captured header value, an address, a subject, mail text or a key. Quote file and line for each finding."
   ```

6. Land: `limen land <job-id> --yes --keep-open` (stage 16: without `--keep-open`; it closes the ticket). Drop the job DB from the main checkout: `bun run db:worktree <YYYY-MM-DD>-<hash> --drop`.
7. Coordinator steps C1–C6 at the times of § Coordinator steps. Owner step O1: tell the owner after stage 07 lands; do not wait.
8. Workers often break the one-`&&` proof form. Accept a check when its saved log shows the pass. A check with no proof at all → `limen continue`.

## Planning progress

- [written] ticket.md, plan.md, questions.md
- stages: see the files in `stages/`; a stage is written when its file exists (resume at the first missing file of the § Stages list).

## Cold review

Not run yet.

## Log

- 2026-11-14: plan written by the planner job.
