> **Status 2026-11-06 — in progress.** The plan is approved by the user (commit 6773a42). Stage 0: steps 0.2 and 0.3 done; step 0.1 (user, BotFather) open, deferred by the user until stage 21. Stages 1–10 done; checkpoint 2 passed (user go). Stages 11–15 done. Left: stages 16–23, then the done-checklist.

# S2 Telegram

Scope: `docs/roadmap.md` §2, row S2. Modules: `docs/modules.md`. Needs: S1b (code done). The S1b shadow run (`tasks/planned/s1b-shadow-run.md`) limits only the VPS stage 23.

## Goal

Digest and urgent notices on the user's phone through a Telegram bot. The user corrects the AI with one tap. Works in shadow mode.

## Done when

- The user gets the digest in Telegram at the set times; each line has ✅ / ✏️ buttons that write `triage_feedback`.
- An urgent mail gives a notice ≤ 10 minutes after it arrives (5-minute sync + one tick).
- An IMAP login error gives an `auth_error` notice.
- The digest shows "last sync HH:MM", also when it is empty.
- `/digest`, `/pause`, `/resume`, `/status` work.
- Tests: an update from an unlinked chat gets no reply; a used or expired link token fails.
- Dev and pilot use two different bots.

## Plan

> **For the build session:** this plan has the full step detail (Goal, Files, Interfaces, Decisions, Test, Check, Done when, Out of scope). The `run-task` skill skips the `planner` call. The main session wrote the plan on 2026-11-05 without subagents (user rule; handoff `~/.pi/agent/notes/2026-11-05-handoff-s2-telegram-plan.md`).

### Planning progress

All 24 stage files were written on 2026-11-05 (main session, no subagents). The plan is complete; a build session starts at stage 0.

### Input (from the task start, 2026-11-05)

User words (handoff 2026-11-05):

- "I can create those bots and I will provide necessary information during the implementation of exact steps." So stage 0 and stage 23 have user steps (BotFather, tokens into `.env`). The build stops at these steps and asks the user. The agent never reads, prints or receives a bot token.
- "Regarding product points, give me your suggestions and go with them." So the product defaults P1–P6 below are decisions. The user can change them when they approve the plan.
- Quality bar: "the plan is without broken edge cases". The decisions below solve the edge cases; the build does not invent new behaviour. A gap found in the build = stop and ask the main session.

Product defaults (planner proposal, accepted by the user as "go with them", 2026-11-05):

- **P1 Digest times:** 08:00 and 16:00 in the organization timezone (`Europe/Warsaw` for the pilot). The S2 migration sets the default of `memberships.digest_times` to `{08:00,16:00}` for new rows. Existing rows (the pilot owner has `{}`) get the times with the new CLI `bun run digest:times`. Why: new organizations need no extra step; a migration does not change user data in secret; the same tenancy function serves the S5 settings page later.
- **P2 Digest content:** mail triaged since the last _sent_ scheduled digest of this user (first digest: since the link time − 24 h; never more than 7 days back). Section NEEDS ACTION first (`urgent`, `needs_reply`, `delegation` from S4, `unsure`), then section OTHER MAIL (`info`, `notification`, `spam`). Each line says what the system would do (shadow mode). **Change from the handoff proposal ("other categories as counts"):** the other categories also get lines while there is room (P3), because S3 needs the ✅ / ✏️ labels of exactly these categories for its go/no-go table. The counts of all categories stay in the header and in "+N more".
- **P3 Digest size:** at most 15 mail lines with buttons, in one message of at most 4096 characters. Lines that do not fit (more than 15, or over 4096 characters) go into one "+N more: 2 info, 3 spam" line. No second message (cut, not split): one digest = one message = one keyboard.
- **P4 Quiet hours:** 22:00–07:00 in the organization timezone, for notices only (`urgent`, `auth_error`, `sync_stale`, `sync_ok`). The sender never sends a notice in quiet hours; the notice waits until 07:00. Digests go out at their set times (the user picks them). No silent sends (`disable_notification` is never set).
- **P5 Buttons:** ✅ = the category of the line is right: `recordFeedback` with `trueCategory` = the shown category (verdict `right`). ✏️ = the bot sends a small picker message with 5 categories (Urgent, Reply, Info, Notification, Spam) and Cancel; a pick writes `trueCategory` = the pick (`recordFeedback` sets `right` or `wrong`). A second tap with another answer writes a new row: the latest row wins (as in `listLabeledResults`). A tap with the same answer as the latest row of the mail writes nothing and answers "Already saved". An `unsure` line has only ✏️ (`recordFeedback` refuses a verdict without a category on `unsure`).
- **P6 Commands:** `/pause` sets every `active` mailbox of the organization to `paused`; `/resume` sets every `paused` mailbox to `active`. Both are conditional updates, so `auth_error` is never hidden or changed. Only a member with the role `owner` may use them. Paused = no sync, no triage (both jobs read only `active` mailboxes), no urgent and no sync-late notice for that mailbox; digests still come and show "paused since". `/status` shows per mailbox: mode, status, last sync, LLM calls of the current quota day of the cap; then the mail that waits for triage (all mailboxes), the next digest time, the quiet hours and the triage scope. `/digest` sends the digest now (P2 period up to now; it does not move the period). `/help` lists the commands.

Main-session design decisions (2026-11-05; why in each line):

- **D1 Plain text.** No `parse_mode`: subjects and AI text need no escaping, and a bad character cannot break a send with HTTP 400. Every send and edit has `link_preview_options: { is_disabled: true }` (no link preview fetch). Subjects: links become `[link]`; control characters and bidi override characters are removed; whitespace collapses to one space.
- **D2 Private chats only.** A link works only in a private chat (`chat.type = "private"`, chat id > 0). Updates from groups, channels and bots get no reply. One chat per user per organization and one user per chat: a new link replaces the old one.
- **D3 Unlinked chats get no reply.** Exception: `/start <token>` where the token row exists but is used or expired gets one short reply, so the real user knows to ask for a new link. An unknown or malformed token gets no reply. A stranger cannot find an existing token (256 random bits).
- **D4 Outbox.** Digests and notices are rows in a new `outbox` table with a unique dedup key per event `(org_id, user_id, dedup_key)`. Exactly one row per event; delivery is at least once: a duplicate message is possible only when the process dies or the network breaks between the Telegram answer and the DB commit. Command replies and button answers go out at once, not through the outbox.
- **D5 Digest text in the outbox.** `digests` keeps the period (slot, start, end, sent time); the text lives in `outbox.text`. Retention (90 days, like digest text in architecture §7) needs the retention job, which does not exist yet: a follow-up in `tasks/planned/` (stage 22).
- **D6 `mailboxes.status_changed_at`** (new column, set only when the status really changes). It separates `auth_error` episodes for the notice dedup key and gives "paused since".
- **D7 Way out of `auth_error`:** new CLI `bun run mailbox:password` (password on stdin, IMAP and SMTP login test, encrypted store, `auth_error → active`). Today `mailbox:connect` refuses an existing address, so without it the `auth_error` notice would be a dead end.
- **D8 Token safety.** `TELEGRAM_BOT_TOKEN` comes only from env. No log line, error text or DB row holds it. Telegram errors are logged only as labels: `GrammyError <method> <code>` or `HttpError <method>`. Never log `error.message` of an inner error, `HttpError.error`, `GrammyError.payload` (it holds the message text) or `GrammyError.description`. `platform/scheduler.ts` logs `describeError` instead of `error.message` (stage 20).
- **D9 Polling.** grammY long polling (`bot.start`) with `allowed_updates: ["message", "callback_query"]`. 401 → polling stops with one `error` line (token rejected). 409 (another process polls this token) → one `error` line, then a new start after 1, 2, 4 … at most 30 minutes. The bot command list is set with `setMyCommands` at each start.
- **D10 AI text in a line:** `info` → the summary (`save_summary` payload), else the reason sentence (`triage_results.reason`). Both are already marked by `markUntrustedText` (S1b). Fixed texts for `triage_error`, `llm_blocked`, `blocklist`; below the threshold: the reason plus "AI guess: Info, 55%". The prompt is not changed (a prompt change needs a new version and an eval).
- **D11 Test mail** (synthetic Message-ID) shows "🧪 test" in digests and notices.
- **D12 Sync notices.** "Sync is late" only for `active` mailboxes whose last good sync (or connect time, if never synced) is older than 30 minutes, and only after the process has run for 10 minutes (a restart after downtime gives no false notice; the first sync comes within 5 minutes). One notice per episode (episode = the `last_synced_at` value). After a sent "late" notice, "sync works again" when the sync is fresh again. An unsent "late" or `auth_error` notice that is out of date becomes `failed` / `outdated`.
- **D13 Who gets what.** Urgent notices and digests: every linked member of the organization. `auth_error`, `sync_stale`, `sync_ok`: linked owners only.
- **D14 Sender limits.** At most 3 messages per user per 15-second tick (Telegram FAQ: about one message per second per chat). 429 → wait `retry_after`. Network error or HTTP 5xx → backoff 30 s doubling to 15 min. 401 → the sender pauses 10 min with one `error` line. 403 (bot blocked) → `failed` / `blocked`. 400 → `failed` / `bad_request`. Older than 24 h → `failed` / `expired`.
- **D15 Late digests.** A missed slot is sent if the server comes back within 6 hours ("late"); an older missed slot is skipped. Slots before the link time never count. Slot keys are local wall-clock strings `YYYY-MM-DDTHH:MM`, so a daylight-saving change gives no double and no lost digest.
- **D16 Module borders.** `channels` owns `chat_links`, `chat_link_tokens`, `outbox` and the jobs (notifier + sender, digest scheduling). `reports` owns `digests` and builds the digest text. `channels → reports`; `reports` never imports `channels` (no cycle). New edges: `channels → config`, `channels → audit`, `reports → mail`, `reports → config`, `mail → audit` (stage 19: a status change and its audit row in one transaction).
- **D17 grammY border.** Only `apps/server/src/modules/channels/telegram/` imports `grammy` (ESLint `no-restricted-imports` rule, stage 0). Tests in `apps/server/test/` may import `grammy` types and classes.
- **D18 Entry points without a `TenantContext`** (scheduler or token entry, like `listSyncTargets`): `findChatLink`, `listLinkedChats`, `useLinkToken`, `findLinkToken`, `replaceChatLink` (cross-tenant delete by chat id), `claimDueOutbox`. `docs/code-patterns.md` lists them (stage 22).
- **D19 Membership is the anchor.** `chat_links`, `chat_link_tokens`, `digests` and `outbox` have a foreign key `(org_id, user_id) → memberships ON DELETE CASCADE`: a removed member loses the links, tokens, digests and messages.

Facts checked on 2026-11-05 (sources):

- grammY: latest version 1.46.0 (npm, 2026-08-26). Source read (`src/bot.ts`, `src/core/client.ts`, `src/core/error.ts`, GitHub `grammyjs/grammY` main): the polling loop rethrows 401 and 409 (so `bot.start()` rejects), sleeps `retry_after` on 429 and 3 s on other errors; updates are handled one by one; without `bot.catch` grammY prints the error and stops the bot; `bot.stop()` aborts the long poll and confirms the offset with one more `getUpdates` call; `sensitiveLogs` is `false` by default, so `HttpError.message` has no URL.
- Local probe on the Mac (grammY 1.46.0, Bun 1.4.4, a fake Bot API server on 127.0.0.1, no real token): the node build of grammY runs under Bun (fetch shim `node-fetch`); a network error gives `HttpError` "Network request for 'getMe' failed!", and its inner `.error` (a `TypeError`, code `ECONNREFUSED`) **holds the URL with the token**; `String(error)` and `error.stack` do not. A `GrammyError` keeps the request `payload` (the message text). 409 and 401 make `bot.start()` reject; `start()` works again after that. `bot.stop()` rejects with `HttpError` when the API is down. Tests work with `new Bot(token, { botInfo })` plus `bot.api.config.use(transformer)` and `bot.handleUpdate(update)`: no network; `ctx.reply` and `ctx.answerCallbackQuery` go through the transformer. `/start abc_DEF-123` gives `ctx.match = "abc_DEF-123"`. An error that an API transformer throws is not wrapped: it comes out as it is (not `HttpError`). `editMessageText` with the same content gives `GrammyError` 400 whose description contains "message is not modified" (fake server text; the real text is not verified).
- Telegram Bot API pages (core.telegram.org/bots/api/…, read 2026-11-05): `sendMessage` text 1–4096 characters after entity parsing, `parse_mode` optional, `link_preview_options.is_disabled`; `callback_data` 1–64 bytes; `answerCallbackQuery` text 0–200 characters; an update is confirmed by `getUpdates` with a higher offset, and updates are kept at most 24 hours; chat id has at most 52 significant bits (safe in `bigint` and a JS number); `retry_after` = seconds to wait; `editMessageText` has a 48-hour limit only for business messages; entity offsets count UTF-16 code units. Deep links (bots/features): `t.me/<bot>?start=<payload>`, payload up to 64 characters of `A-Z a-z 0-9 _ -`, the bot gets `/start <payload>`. Bots FAQ: about 1 message per second per chat, about 30 per second in total.
- node-postgres on the dev DB: `time[]` comes back as `["08:00:00","16:00:00"]` (strings with seconds), `bigint` as a string.

Not verified (each stage that depends on it says how it checks it):

- How Telegram counts the 4096 limit (UTF-16 units or code points). The plan uses JS `string.length` (UTF-16 units), which is never smaller.
- A limit on the number of inline buttons in one message (not on the pages). The digest uses at most 30 buttons.
- The Telegram description texts "message is not modified", "bot was blocked by the user", "chat not found" (the plan uses the error codes; only the "not modified" case reads the description).
- grammY under Bun 1.3.14 (the server image; the probe used Bun 1.4.4). Stage 23 runs `telegram:check` in the image.
- The BotFather token format `<digits>:<35 characters>`; the config check is loose (`^\d+:[A-Za-z0-9_-]{20,}$`).

### Rules for every step (read before each step)

- Code rules: `docs/code-patterns.md`. Most important here: `packages/core` has no I/O and no `process.env`. Other modules import a module only through its `index.ts`. Every repository function takes a `TenantContext` and filters by `org_id`, except the entry points of D18 and the S1a/S0 ones. Template literals, no `+` for strings. `createLog("<module>")`, never `console.log`. Status changes and their `audit_log` row go in one transaction.
- **No secret and no mail data in a log line or an error message.** Never log: the bot token, a link token, mail text, a subject, an address, a summary, a reason, a message text, a button label or button data, a chat id, a Telegram user name. Log ids (uuid), counts, codes, kinds and times only. For a Telegram error use only `telegramErrorLabel(error)` (stage 5); for any other error `describeError(error)` (S1b).
- **grammY border (D17):** only `apps/server/src/modules/channels/telegram/` imports `grammy`.
- **Messages:** plain text (no `parse_mode`), `link_preview_options: { is_disabled: true }`, text length (JS `length`) 1–4096, every `callback_data` ≤ 64 bytes (UTF-8). Message texts come from the text functions of stages 3, 4 and the reply texts of the stage that owns the command; tests check the key words.
- **Unlinked chats get no reply** (D3). Every handler finds the chat link first. A button answer never says whether a mail id exists in another organization.
- **LLM gate unchanged:** S2 adds no LLM call. `TRIAGE_LLM_SCOPE` keeps its default `off`; no step changes it. Only stage 21 sets `synthetic` on the Mac (a few free-tier calls).
- **Do not touch the VPS** (`ssh home_vm`, its cron, its `.env`, `~/ea-48h-end.sh`) before stage 23 and the user's go. Never print or edit any `.env`; the user edits it.
- Do not commit (the main session commits each stage after the review).
- Checks after each step (the step names which ones):
  - `bun run lint && bun run typecheck && bun run test:unit`
  - with DB: `bun run dev:up && bun run db:migrate && bun run test:int` (dev `db` on port 5433, GreenMail; `.env` has `MIGRATOR_DATABASE_URL`).
  - Markdown files: `bunx prettier --check <files>` (`bun run lint` is ESLint only).
- Integration tests: `withRollback` from `apps/server/test/integration/helpers.ts`; `createOrgWithMailbox`, `insertTestEmail`, `pauseOtherMailboxes` from `fixtures.ts`; S2 adds `addMember`, `linkChat`, `randomChatId` (stage 6), `insertTriaged` (stage 8) and `isolateChannels` (stage 10) to `fixtures.ts`, and `telegram-helpers.ts` (stage 14: `testBotInfo`, `recordCalls`, `messageUpdate`, `callbackUpdate`). Jobs that read all organizations (notices, sender, digest job) call `isolateChannels(trx)` first, inside the rollback transaction: the dev DB can hold chat links and outbox rows from manual runs. A statement that must fail runs inside a savepoint (`trx.savepoint`). Tests that need two connections use their own new org and delete it at the end.
- Times in tests: fixed `Date` values, and the organization timezone `Europe/Warsaw` (CET = UTC+1 in November, CEST = UTC+2 in summer). Never `new Date()` in an assertion.
- Fake Telegram in tests: a fake `ChatChannel` (stage 5) for the jobs; for the router a real grammY `Bot` with `botInfo` and an API transformer that records the calls (fact list above). No test calls the real Telegram API.
- Code that runs in a transaction it may get from a caller uses the S1a pattern: `db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run)`.

### User checkpoints

The main session stops after the commit of the named stage and gives the user a short summary: what was built, the check commands and their output, open issues. The next stage starts only after the user says go.

1. After stage 0 — the user created both bots; `bun run telegram:check` shows the dev bot (the build cannot go on without the dev token).
2. After stage 10 — tables and repositories (schema errors are the most expensive to fix later). Group review of stages 1, 6, 8, 9, 10.
3. After stage 20 — all code is built and wired. Group review of stages 11–20. Then stage 21 is the user's own run on the phone.
4. Before stage 23 — VPS deploy: needs S1b stage 37 done (`tasks/planned/s1b-shadow-run.md`) and the user's go. A deploy in the S1b shadow week restarts the server: stage 23 names the risk.

### Review model

As in S1b (user decision 2026-11-04): stage reviews run on Sonnet, high, also for `[risky]` stages. Opus, high reviews the critical stages 1 (migration), 6 (linking), 10 and 11 (outbox, sending), 14 (router), 16 (buttons), 19 (credentials), and the group reviews at checkpoints 2 and 3. Implementers run on default Sonnet.

### Stages

Each stage lives in its own file in [`s2-telegram/`](s2-telegram/). An implementer or reviewer reads this file (Input, Rules, checkpoints) and only the stage file of its step. The main session ticks the step boxes in the stage file and the stage box here.

- [ ] [Stage 0](s2-telegram/stage-00-bots-grammy-config-and-check.md) — Setup: bots (user step), grammY, config key, `telegram:check` — user checkpoint 1 after it
- [x] [Stage 1](s2-telegram/stage-01-s2-tables-migration.md) — S2 tables migration [risky]
- [x] [Stage 2](s2-telegram/stage-02-core-local-time-and-digest-schedule.md) — Core: local time and the digest schedule
- [x] [Stage 3](s2-telegram/stage-03-core-message-texts-buttons-and-notices.md) — Core: message model, text helpers, button data, notice texts
- [x] [Stage 4](s2-telegram/stage-04-core-digest-renderer.md) — Core: digest renderer [risky]
- [x] [Stage 5](s2-telegram/stage-05-telegram-errors-and-send.md) — Telegram adapter: error labels and send [risky]
- [x] [Stage 6](s2-telegram/stage-06-chat-linking.md) — Chat linking: links and one-time tokens [risky]
- [x] [Stage 7](s2-telegram/stage-07-link-and-digest-times-clis.md) — CLIs: `telegram:link`, `telegram:unlink`, `digest:times`
- [x] [Stage 8](s2-telegram/stage-08-read-queries-and-mailbox-status.md) — Read queries and the mailbox status time [risky]
- [x] [Stage 9](s2-telegram/stage-09-reports-digests-and-digest-message.md) — Reports: digests table and the digest message [risky]
- [x] [Stage 10](s2-telegram/stage-10-outbox-repository.md) — Outbox repository [risky] — user checkpoint 2 after it
- [x] [Stage 11](s2-telegram/stage-11-outbox-sender.md) — Outbox sender [risky]
- [x] [Stage 12](s2-telegram/stage-12-notice-detection.md) — Notice detection [risky]
- [x] [Stage 13](s2-telegram/stage-13-digest-job.md) — Digest job [risky]
- [x] [Stage 14](s2-telegram/stage-14-update-router.md) — Update router [risky]
- [x] [Stage 15](s2-telegram/stage-15-polling-and-bot-commands.md) — Polling and the bot command list
- [ ] [Stage 16](s2-telegram/stage-16-feedback-buttons.md) — Feedback buttons [risky]
- [ ] [Stage 17](s2-telegram/stage-17-help-status-and-digest-commands.md) — Commands: `/help`, `/status`, `/digest`
- [ ] [Stage 18](s2-telegram/stage-18-pause-and-resume.md) — Commands: `/pause`, `/resume` [risky]
- [ ] [Stage 19](s2-telegram/stage-19-mailbox-password.md) — `mailbox:password`: leave `auth_error` [risky]
- [ ] [Stage 20](s2-telegram/stage-20-server-wiring-and-log-test.md) — Server wiring, shutdown and the log test [risky] — user checkpoint 3 after it
- [ ] [Stage 21](s2-telegram/stage-21-dev-run-with-the-dev-bot.md) — Dev run with the dev bot: the user tries it on the phone [risky]
- [ ] [Stage 22](s2-telegram/stage-22-docs-and-notes.md) — Docs, notes, known alerts
- [ ] [Stage 23](s2-telegram/stage-23-vps-deploy-with-the-pilot-bot.md) — VPS deploy with the pilot bot [risky] — user checkpoint 4 before it

### Results (filled in stages 21 and 23)

_Not yet._

## Questions for the user

Answered 2026-11-05: the user approved the plan as written, so each question keeps the plan default (1 lines for other mail: yes; 2 the D3 exception: yes; 3 `mailbox:password` in S2: yes; 4 the LLM pause notice: no follow-up file; 5 the VPS deploy time: the user decides at checkpoint 4). A later answer changes the named stage.

1. **P2, a change from the handoff proposal:** the digest also gives lines (with ✅ / ✏️) to `info`, `notification` and `spam` mail while there is room in the 15 lines, not only counts. Why: S3 needs labels of exactly these categories. Keep it? (Stage 4.)
2. **D3:** an unlinked chat gets no reply, except `/start` with a link that exists but is used or expired (a short "ask for a new link" reply). Unknown links get no reply. Keep the exception, or no reply at all? (Stage 14.)
3. **D7, scope added:** `bun run mailbox:password` so the user can leave `auth_error` (today there is no way back). Keep it in S2? (Stage 19.)
4. **Admin notice when the LLM pause or the daily cap starts:** not in the done-when and not in this plan. Add it as a follow-up task? (Stage 22.3 adds `tasks/planned/llm-pause-notice.md` only on "yes".)
5. **VPS deploy time:** stage 23 needs S1b stage 37 done. Deploy during the S1b shadow week (one server restart in that week; your ✅ / ✏️ taps then also give labels for S1b), or after the week?

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap, code patterns); ADR 0005 stays accepted (implementation notes added).
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-02: Created from `docs/roadmap.md` and `docs/architecture.md` §11.
- 2026-11-02: Changed after the cold review (`tasks/done/mvp-plan-review.md`) and the user's answers (IMAP, home VPS, own Postgres).
- 2026-11-05: Moved to `active/`. The main session writes the full file-level plan (handoff `~/.pi/agent/notes/2026-11-05-handoff-s2-telegram-plan.md`). Checked the handoff "Current state" against the code: no difference.
- 2026-11-05: Plan written: 24 stages (0–23), one file per stage in `s2-telegram/`; 17 stages `[risky]`. Facts checked: grammY 1.46.0 source and a local probe (Bun 1.4.4, fake Bot API), Bot API pages, `pg` types of `time[]` and `bigint`. Product defaults P1–P6 and design decisions D1–D19 are under "Input"; 5 questions for the user. `bunx prettier --check` passes on all plan files.
- 2026-11-05: The user approved the plan ("Okay"). The 5 questions keep the defaults (see "Questions for the user"). Next: a build session with `/skill:run-task tasks/active/s2-telegram.md`, starting at stage 0.
- 2026-11-06: Handoff for the build: `~/.pi/agent/notes/2026-11-06-handoff-s2-telegram-build.md` (start at stage 0, step 0.1 is the user's BotFather step).
- 2026-11-06: Stage 0 partly built: steps 0.2 and 0.3 done, reviewer PASS (Sonnet). Step 0.1 (BotFather, dev token in `.env`) and the manual `bun run telegram:check` run stay open for the user (checkpoint 1). Minor review finding, not fixed: `telegram-check.ts` prints `failed: ConfigError` without the key names.
- 2026-11-06: The user asked to go on without the bot tokens: step 0.1 waits until stage 21 (the dev run); stages 1–20 use a fake Telegram. Stage 1 built (migration `20261106000001_telegram.sql`, schema types, 7 schema tests), reviewer PASS (Opus, high). Minor finding for stage 6: `telegram-schema.test.ts` has a local `addMember`; replace it with the `fixtures.ts` helper.
- 2026-11-06: Stage 2 built (`packages/core/src/digest/`: local time, quiet hours, digest schedule; 33 tests), reviewer PASS (Sonnet). Extra export `nextLocalDate` (shared next-date rule of 2.1 and 2.2), accepted by the reviewer.
- 2026-11-06: Stage 3 built (`packages/core/src/digest/`: message model, text helpers, labels, button data, would-do text, AI text, notice texts; `removeLinks`, `AI_FOLDER_NAMES` in core, used by `mail/connect.ts`), reviewer PASS (Sonnet). Accepted: one `eslint-disable no-control-regex` with a reason in `text.ts`. Main session moved the stray folder comment in `connect.ts` (minor finding).
- 2026-11-06: Stage 4 built (`renderDigest` in `packages/core/src/digest/digest.ts`, 16 tests). Review round 1 FAIL (no mixed-category "+N more" test); fixed with 3 tests; round 2 PASS (Sonnet). Kept: no shadow line when there is no mailbox (tested).
- 2026-11-06: Stage 5 built (`ChatChannel` port, Telegram adapter `telegram/api.ts`, `toChannelError`, fake channel in `channels/fake/channel.ts`; 10 tests), reviewer PASS (Sonnet). Main session removed the fake from `channels/index.ts` (minor finding): tests import `channels/fake/channel` directly, as in `mail`.
- 2026-11-06: Stage 6 built (`channels/repo.ts`, `channels/linking.ts`, `getMembership`, audit `chat.linked` / `chat.unlinked`, fixtures `addMember` / `linkChat` / `randomChatId`; 12 tests; the stage 1 local `addMember` is gone), reviewer PASS (Opus, high). Main session added the missing chat C assertion (minor). Open for the checkpoint 2 group review: a chat that moves to another org leaves no `chat.unlinked` audit row in the old org. Two parallel consumes for one chat: the second fails on a unique key and rolls back; `bot.catch` (stage 14) logs it with `describeError`.
- 2026-11-06: Stage 7 built (CLIs `telegram:link`, `telegram:unlink`, `digest:times`; `setDigestTimes`; shared `scripts/pick-member.ts` for the member choice of 7.1 and 7.3), reviewer PASS (Sonnet). The manual `telegram:link` run with a real bot moves to stage 21 (no token yet). The manual `digest:times` run set the dev owner's times to `{08:00,16:00}`.
- 2026-11-06: Stage 8 built (`setMailboxStatus` moves `status_changed_at` only on a real change; `changeMailboxStatus`, `listMailboxes`, `countWaiting`, `listTriagedBetween` / `countTriagedBetween` (raw `sql`, bound parameters, `org_id` on both tables), `listActionsForEmails`, `countEventsBetween`, fixture `insertTriaged`; 8 tests), reviewer PASS (Sonnet). Kept: `categories: []` returns no rows. Two optional minors not fixed (a redundant `FolderKey` cast, a double `MailboxStatus` declaration).
- 2026-11-06: Stage 9 built (`reports` module: digest rows, `digestPeriodStart`, `buildDigestMessage`; 8 tests), reviewer PASS (Sonnet). Main session added the missing test of the 7-day cap on a sent digest end (minor finding).
- 2026-11-06: Stage 10 built (outbox in `channels/repo.ts`: insert with dedup, claim with `FOR UPDATE SKIP LOCKED` and stale reclaim, sent / release / fail with the lock check, cancel, `listSentStaleEpisodes`; fixture `isolateChannels`; 9 tests). Review round 1 FAIL (Opus, high): test 7 did not test the mailbox filter of the cancel; fixed with a second mailbox in the same org (a mutation check proves it). Round 2 PASS. `claimDueOutbox` with `orgIds: []` returns no rows.
- 2026-11-06: Checkpoint 2 group review (Opus, high, `6b453aa..1932119`): PASS with minors. Fixed in one commit (review PASS, Opus, high): a moved chat writes `chat.unlinked` (`chat_moved`) in the old member's org (closes the stage 6 open point; stage 6 file updated); `unlinkUser` audit data has `user_id`; `insertOutbox` checks the buttons, so a bad row cannot block the claim. Left for the user: an outbox index on `email_id` / `digest_id` (for the retention job), the digest visibility race at `periodEnd` (milliseconds), the "no settings row" text of the digest (`shadow`) vs `/status` (stage 17).
- 2026-11-06: Checkpoint 2: the user said go and accepted the three proposals: the outbox `email_id` / `digest_id` indexes go to the retention follow-up (stage 22.3); the digest race is accepted and noted (stage 22.2); the digest maps "no settings row" to `none` like `/status` (stage 17.1, test 6).
- 2026-11-06: Stage 11 built (`channels/sender.ts` `createOutboxSender`; fake channel `onSend` hook; 15 tests), reviewer PASS (Opus, high). Added after the review: tests that prove the in-memory send pause after 429 / 401 (a mutation check proves them). Accepted deviations: `markDigestSent` runs only when `markOutboxSent` returns true; `warn` lines for `expired` / `no_chat` (row id only); a 429 without `retry_after` waits 30 s.
- 2026-11-06: Stage 12 built (`channels/notices.ts` `detectNotices`: urgent, `auth_error`, sync late, sync works again; 12 tests), reviewer PASS (Sonnet; `test:int` 3 runs, the file alone 6 runs). Learned: rows inserted in one transaction share `created_at`, so tests must not rely on the outbox insert order (find rows by `dedup_key`).
- 2026-11-06: Stage 13 built (`channels/digest-job.ts` `scheduleDigests`: digest row and outbox row in one transaction, late slots, per-link errors; 12 tests), reviewer PASS (Sonnet; `test:int` 2 runs). Optional minor not done: no test for the rollback path when the outbox row already exists (the test transaction cannot show the rollback).
- 2026-11-06: Stage 14 built (`channels/telegram/bot.ts` router, `channels/texts.ts`, test helpers `telegram-helpers.ts`; 12 router tests), reviewer PASS (Opus, high). Minors fixed: one shared `isNotModified` in `telegram/errors.ts`; a test for the button answer / edit error branches. Fact: `bot.handleUpdate` rethrows as `BotError`; `bot.catch` runs only in `bot.start` (stage 15 uses it). Question for the user: a linked chat that sends its used `/start <token>` again gets "ask for a new link" (plan D3).
- 2026-11-06: Stage 15 built (`channels/telegram/polling.ts` `startPolling`, `BOT_COMMANDS`; 8 tests on a fake Bot API), reviewer PASS (Sonnet). Deviation: the 409 retry count resets after a good `getUpdates` (API transformer), not in `onStart` (it fires before the first `getUpdates`, so the delay would stay at 1 min). Minors fixed: tests for the reset and for a failing `bot.stop()`; a dead `onStart` guard removed.
