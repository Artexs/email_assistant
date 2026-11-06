# s2-telegram — Stage 22

Part of [`../s2-telegram.md`](../s2-telegram.md). Read that file's "Input" and "Rules for every step" first.

## Stage 22 — Docs, notes, known alerts

Prettier rule for this stage: `bunx prettier --check` must pass on every new Markdown file. `docs/architecture.md`, `docs/modules.md` and `docs/roadmap.md` already fail `--check` at HEAD (S1b stage 35 log): for them, the edits must not add new problems (compare `bunx prettier --check` output before and after; the main-session bar of S1b).

- [ ] **22.1 Architecture, modules, code patterns, roadmap, ADR 0005, runbook**
  - Goal: `docs/` describe S2 as built (one source per fact, `tasks/README.md`).
  - Files: change `docs/architecture.md`, `docs/modules.md`, `docs/code-patterns.md`, `docs/roadmap.md`, `docs/decisions/0005-telegram-first.md`, `deploy/README.md`.
  - Interfaces: none (docs).
  - Decisions (what goes where; take the facts from the code and the stage files, not from memory):
    - `architecture.md` §4.4: the ✅ / ✏️ rules (P5: ✅ = the shown category; latest wins; the same answer twice writes nothing; `unsure` lines only ✏️). §5: the ER diagram and the table rows for `chat_links` (with `org_id`, the two unique keys, private chat ids only), `chat_link_tokens` (hash only, `org_id`), `digests` (slot key, period, `sent_at`; no text), the new `outbox` (kinds, dedup key, statuses, error codes), `mailboxes.status_changed_at`, the `digest_times` default. §6.2: plain text, no link previews, private chats only, unlinked chats get no reply (and the D3 exception), long polling with the 401 / 409 rules, `setMyCommands`, two bots, token handling (D8). §7: retention row "message text `outbox.text` 90 days" (the retention job does not exist yet: follow-up), the bot token in the secrets line. §8: the jobs (`channels.notifier` every 15 s = detection + sender; `channels.digest` every minute), quiet hours 22:00–07:00 for notices, the sync-late rule (30 min, 10 min after start, one notice per episode, "works again"), `auth_error` → notice → `mailbox:password`.
    - `modules.md`: §2 graph and edge notes (`channels → config`, `channels → audit`, `reports → mail`, `reports → config`, `mail → audit`); §3.1 tenancy (`getMembership`, `setDigestTimes`, `digest:times`); §3.2 mail (`listMailboxes`, `countWaiting`, `changeMailboxStatus`, `status_changed_at`, `updateMailboxPassword`, `mailbox:password`); §3.4 triage (`listTriagedBetween`, `countTriagedBetween`, `latestFeedback`, `getLabelTarget`, `skipIfSame`); §3.5 actions (`listActionsForEmails`); §3.6 audit (the new events: `chat.linked`, `chat.unlinked`, `mailbox.paused`, `mailbox.resumed`, `mailbox.password_changed`); §3.7 reports and §3.8 channels: "Built in S2" with the real file names and what each does, and "Owns" (`digests`; `chat_links`, `chat_link_tokens`, `outbox`); §4: the new CLIs (`telegram:check`, `telegram:link`, `telegram:unlink`, `digest:times`, `mailbox:password`).
    - `code-patterns.md`: the D18 list of entry points without a `TenantContext`; "Only `channels/telegram/` imports `grammy` (ESLint rule)"; "Telegram errors: log only `telegramErrorLabel(error)`; never `error.message` of an inner error, `payload` or `description`".
    - `roadmap.md`: an "S2 state (date)" line like the S1b one (built, the dev run result of stage 21, the VPS state); the S2 scripts in §4.
    - ADR 0005: stays `accepted`; add one "Implementation (S2)" line under Consequences: long polling with grammY, an outbox for scheduled messages, private chats only, plain-text messages.
    - `deploy/README.md`: a "Telegram" section: the pilot bot token goes into the VPS `.env` (user only), `telegram:check`, `telegram:link` (the link is a 15-minute one-time secret), `digest:times`, what `409` in the log means; link to the `auth_error` section of stage 19.
  - Test: none (docs).
  - Check: the prettier rule above; `bun run lint` (unchanged code).
  - Done when: the files say what the code does, and the prettier rule holds.
  - Out of scope: changing decisions (only describe what was built).

- [ ] **22.2 Note with the Telegram facts, known alerts**
  - Goal: a later agent finds the verified Telegram and grammY facts and the meaning of each new log line.
  - Files: create `notes/<build date>-telegram-bot-facts.md`; change `docs/known-alerts.md`.
  - Interfaces: none.
  - Decisions:
    - Checkpoint 2 decision (user, 2026-11-06), write it in the note: a triage result whose transaction starts before a digest's `periodEnd` but commits after the digest read is in no digest (the next period starts after `periodEnd`). The window is milliseconds (the LLM call is outside the save transaction); urgent notices are not affected (24 h look-back with dedup). Accepted, no code change.
    - The note: the "Facts checked on 2026-11-05" and "Not verified" lists of the task file, plus what stages 21 and 23 showed (the real error texts if seen, the urgent notice time, grammY under Bun 1.3.14 in the image). Each fact with its source and date.
    - `known-alerts.md`, one entry per new log line (template of the file, newest first): `telegram: the bot token was rejected (401): check TELEGRAM_BOT_TOKEN; polling stopped`; `telegram: another process polls this bot token (409); …`; `telegram: polling failed: <label>; next try in <n> min`; `telegram: setMyCommands failed: <label>`; `telegram token rejected (401): check TELEGRAM_BOT_TOKEN; sending paused for 10 min`; `outbox <id>: <code>; sending paused for <s> s`; `outbox <id>: the user blocked the bot (403)`; `outbox <id>: Telegram refused the message (<code>)`; `outbox <id>: sent again after a stale send (a duplicate is possible)`; `outbox <id>: lost the claim after the send`; `notices for org <id> failed: <label>`; `digest for org <id> user <id> failed: <label>`; `callback failed: <label>`. Each with the cause and what to do.
  - Test: none (docs).
  - Check: `bunx prettier --check notes/<build date>-telegram-bot-facts.md docs/known-alerts.md`.
  - Done when: the check passes.
  - Out of scope: alerts that did not happen in S2.

- [ ] **22.3 Follow-ups in `tasks/planned/`**
  - Goal: ideas that S2 found but did not build are not lost.
  - Files: create `tasks/planned/retention-job.md`, `tasks/planned/telegram-review-command.md` (template of `tasks/README.md`, status `planned`).
  - Decisions:
    - `retention-job.md`: the daily `platform.retention` job of architecture §7/§8 does not exist. It must clear `emails.body_text` after 30 days, subjects and addresses after 90, `outbox.text` after 90 (S2), old `chat_link_tokens` rows, and the other §7 rows. Needs: S2. Checkpoint 2 decision (user, 2026-11-06): the job's migration adds `CREATE INDEX outbox_email_idx ON outbox (email_id) WHERE email_id IS NOT NULL` and the same for `digest_id`, so the cascade deletes do not scan the whole outbox.
    - `telegram-review-command.md`: a `/review` command that shows more unlabeled mail with ✅ / ✏️ than the 15 digest lines (more labels for the S1b and S3 go/no-go tables).
    - If the user answered "yes" to the open question about an admin notice for the LLM pause and the daily cap, add `tasks/planned/llm-pause-notice.md` too; else leave it out.
  - Test: none.
  - Check: `bunx prettier --check tasks/planned/retention-job.md tasks/planned/telegram-review-command.md`.
  - Done when: the files exist and pass the check.
  - Out of scope: building them.
