# F113 scouts (2026-11-15, base 2e2451be)

Four Sonnet scouts (`claude-sonnet-5-5`, thinking medium). Each section: the question, the job id, the packet copied whole from the job log. A packet is a lead, not a fact.

## Scout 1

Question: What is the shape of the frozen realistic week corpus in evals/sim/lab-01/week (slot fields such as receivedAt, persona from address, thread parent, direction sent, delegateBehaviour, expected delegate, expected draft, headers, attachments; texts; week/history.json) and of scenario.json (personas, delegates, executive, urgency profile, VIP)? Which core schemas and server script functions load and validate it (packages/core/src/sim, apps/server/src/scripts/sim*.ts), and which function turns a slot plus text into an RFC 822 message (renderSeedMessage or other)? Give counts per day and per delegateBehaviour from the files.

Job: `2026-11-15-f113-scout-1-e6393321`

Packet: Shape of the frozen week corpus and scenario.json, the loaders that validate them, and the slot-plus-text to RFC 822 path.
Base: 2e2451be
Verified: python3 -I counter script over `evals/sim/lab-01/week/slots/*.json` -> `855` slots, `Counter({None: 799, 'done': 23, 'late': 11, 'out_of_office': 8, 'silent': 8, 'other_address': 6})`
Unknowns:
- No code at HEAD turns a week slot into a RFC 822 message with its `headers`, `Message-ID` or `In-Reply-To` (guessed). I grepped for `renderSeedMessage` callers: only `sim-commands.ts:117` and `eval-sim-load.ts:56` use it for html-only bodies. F113's injector must build the slot to `SeedMessage` mapping itself.
- No reader for `week/history.json` was found. `sim-commands.ts:177` only writes it. `weekHistorySchema` (`plan-week.ts:53`) exists, but no `readHistory` was found (guessed).
- I did not run any test or load command. The schema reads are from source only.
- The `sim-commands.ts` mid-file read for week writing (`plan-week.ts` output) is only skimmed.

1. `packages/core/src/sim/slot.ts:17` (`slotSchema`, `slotBatchFileSchema`) — observed. Strict, 1–25 slots per batch file. Fields:
   - `id` `w-<day>-<nnn>`, `persona` (the executive key when `direction: "sent"`), `direction` in/sent, `to` and `cc` as persona keys, `lang` pl/en/de, `receivedAt` ISO datetime (UTC `Z`), `category`, `topic`, `hardCases`, `kind`.
   - `style{length,format,signature,greeting}`, `headers` (record), `attachments[{name,mime,sizeBytes}]`, `thread[]`, `threadId`, `parentId`, `brief`.
   - Optional: `expectedDelegate` (persona key), `expectedDraft` (delegation/clarification/none), `delegateBehaviour` (done/late/out_of_office/other_address/silent), `fromOverride`, `urgencySource`, `contextRef`, `senderHistory`.
   - Rules: `expectedDraft` is set if and only if `category = delegation`; `urgencySource` is set if and only if `category = urgent`.
2. Week corpus counts, 855 slots in 35 batch files (observed; counted from files):
   - Per day (UTC date of `receivedAt`): 01-25 153, 01-26 154, 01-27 155, 01-28 156, 01-29 155, 01-30 42, 01-31 40. `calendar.weekStart` is 2027-01-25.
   - `delegateBehaviour` is set on 56 slots, all delegation: done 23, late 11, out_of_office 8, silent 8, other_address 6. The 56 slots are also the ones with `expectedDelegate` and `expectedDraft: "delegation"`.
   - `expectedDelegate`: ksiegowa 24, asystentka 21, koordynator-sprzedazy 11.
   - Per day for these 56: 10 on each of 01-25 to 01-29, 3 on 01-30, 3 on 01-31.
   - Behaviour per day (01-25/26/27/28/29/30/31): done 4/6/3/3/4/2/1, late 2/1/2/3/2/1/0, out_of_office 1/1/1/0/3/0/2, silent 3/2/1/1/1/0/0, other_address 0/0/3/3/0/0/0.
   - `direction`: in 840, sent 15. All sent slots are from `prezes-zarzadu`.
   - `category`: notification 293, info 188, spam 166, needs_reply 113, delegation 56, urgent 39. All `kind` are synthetic.
   - `headers`: 633 slots have none. 207 have `List-Id` and `List-Unsubscribe`. 5 have `List-Unsubscribe` only. 8 have `Auto-Submitted`. 2 have `List-Id`, `List-Unsubscribe` and `Auto-Submitted`.
   - `attachments` is empty on all 855. The slot `thread` array is empty on all 855. Threading uses `threadId` (182 slots) and `parentId` (112 slots).
   - `fromOverride` on 5 slots (`mailer-daemon@kordelan.test` for bounces). `contextRef` on 10. `urgencySource` on 39. `hardCases`: auto_reply 10, bounce 5, phishing_unsubscribe 5, phishing_delegation 5, phishing_urgent_push 5.
3. Texts, labels, blind, history, manifest — observed:
   - Texts: `week/texts/batch-NNN.json`, `textBatchFileSchema`, `files.ts:4`. Each case has `{id, subject, body, thread[], expectedPoints?, mustNot?, html?, planted?, note?, dropped?}`. `body` is "" only for html-only mails. The delegation text has no draft text.
   - `week/blind/` and `week/labels/` have 35 files each (`blindBatchFileSchema`, `labelBatchFileSchema`). A blind case has `from` ("Name <addr>"), `to` as addresses, and a plain `thread` of `{from, subject, body}`.
   - `week/history.json` is `{scenario, days: 30, senders{address: SenderHistory}}`. It has 21 senders. Keys include received, byCategory, relation, medianUserReplyHours.
   - `manifest.json` freezes week at 855 cases, sha `c92d820e…`, frozenAt 2026-11-14.
4. `scenario.json` — observed; schema `packages/core/src/sim/scenario.ts:44`, checked by `validateScenario` (`scenario.ts:152`):
   - Keys: `id`, `company{name: "Kordelan Dystrybucja Sp. z o.o.", domain: "kordelan.test"}`, `executive`, `personas`, `delegates`, `urgency`, `calendar`, `topics`.
   - Executive: key `prezes-zarzadu`, Wiktor Szalewski, `wiktor.szalewski@kordelan.test`, pl, Europe/Warsaw.
   - Personas: each has key, displayName, address, group, lang, voice, signature. Groups seen: boss, team, delegate, client, partner, vendor, newsletter, marketing, system, spammer, phishing.
   - Delegates (3): asystentka (kalendarz, podroze), ksiegowa (faktury, ksiegowosc, platnosci), koordynator-sprzedazy (umowy, oferty, sprzedaz). Addresses: `dorota.wilczynska@kordelan.test`, `magdalena.czerniak@kordelan.test`, `piotr.lewandrowski@kordelan.test`.
   - Urgency: `vip` = [przewodniczacy-rady, klient-hurtownia]. `profile.topics` has 4 entries and `profile.deadlines` has 4, due 2027-01-15 to 2027-02-05.
   - Also `calendar{bankStart 2027-01-11, weekStart 2027-01-25}` and `topics[]`.
5. Loaders and renderer — observed:
   - `apps/server/src/scripts/sim-files.ts`: `readScenario` (line 78, runs `scenarioSchema` and `validateScenario`), `readSlots` (161, via `slotBatchFileSchema`), `readTexts` (166), `readLabels`, `readManifest`, `readBlindBatch`. `SimFileError` is the error class. The default root is `evals/sim`.
   - `apps/server/src/scripts/eval-sim-load.ts:74` `loadSimCases` reads these, skips sent, dropped and unwritten slots, and walks `parentChain`. It calls `toEvalCase` (`packages/core/src/sim/to-eval-case.ts:88`), which resolves persona keys to addresses (`partyOf`, `senderAddress` with `fromOverride`).
   - `apps/server/src/modules/mail/seed.ts:91` `renderSeedMessage(SeedMessage)` is the RFC 822 renderer. `SeedMessage` is `{messageId?, from, to[], cc?, subject, date, text?, html?, inReplyTo?, references?, headers?}`. It is pure, with CRLF, 8bit, multipart/alternative when both text and html exist, and RFC 2047 words for names and subject. It throws on non-ASCII or line breaks in headers. It is re-exported by `modules/mail/index.ts:140`. `bodyTextFromSource` reads the result back.
   - `SeedMessage` already carries `headers`, `inReplyTo`, `references` and `messageId`, so a slot maps onto it. The mapping code does not exist yet (guessed).
   - `isSyntheticMessageId` / `SYNTHETIC_MESSAGE_ID_DOMAIN` (`ea-seed.test`, `seed.ts:22`) marks synthetic mail by Message-ID.

Checks: `packages/core/src/sim/slot.test.ts` and `packages/core/src/sim/files.test.ts` cover the slot and text schemas. `apps/server/src/scripts/eval-sim-load.test.ts` and `sim-files.test.ts` cover the loaders. `apps/server/src/modules/mail/seed.test.ts` covers the renderer. I did not run them (misses: any real week-corpus load test, any history.json reader).

## Scout 2

Question: What exists for a second Compose stack: deploy/compose*.yaml services, the server image build, env keys MAIL_ALLOW_LOCAL_HOSTS, TELEGRAM_API_ROOT, LLM_DAILY_CAP and other config keys a sim stack must set (apps/server/src/platform/config.ts), GreenMail version, users, ports and relay behaviour (notes/2026-11-03-greenmail-facts.md, compose.dev.yaml), tools/fake-telegram (can it run as a long-lived service, bind address, its driver API to press buttons and read chats), VPS deploy runbooks and tailscale serve notes (docs/, notes/), and the CLIs that provision an org, a mailbox, a Telegram link, delegates, VIP rules and mailbox mode (org:create, mailbox:connect, etc.)?

Job: `2026-11-15-f113-scout-2-46d28a1a`

Packet: What exists for a second Compose stack (`ea-sim`) at HEAD, and what a sim stack must set.
Base: 2e2451be
Verified: `git status --short | wc -l` -> 0. I ran no stack. I only read files.
Unknowns:
- No CLI for VIP rules exists. `grep -rli vip apps/server/src` finds hits only in triage, actions, reports and eval code, and none in `scripts/`. I did not look in the web routes. Guessed: VIP is set through the web panel or the DB.
- GreenMail relay to outside addresses is still unchecked. ADR 0021 point 3 says "check in the first E2b stage". No note settles it.
- `deploy/compose.sim.yaml` does not exist. ADR 0021 is "proposed", pending owner decision 8 of E02.
- I did not read these files:
  - the VPS runbook notes (`notes/2026-11-14-f099-vps-deploy.md`, `notes/2026-11-15-vps-deploy-queue.md`)
  - `deploy/README.md` apart from its Tailscale lines
  - the body of `docs/product/stage-2/epics/E02-quality-lab.md`

1. `deploy/compose.yaml`:1-70 — The prod stack has a `db` service (postgres:17, init from `db/roles.sql` and `deploy/db-init`) and a `server` service. The server is built from `deploy/Dockerfile` as image `ea-server`. It reads `env_file: ../.env`. It overrides `DATABASE_URL`, `MIGRATOR_DATABASE_URL`, `PORT=8080`, `WEB_DIST` and `LOG_FORMAT=json`. It publishes only `127.0.0.1:8080:8080`. The network subnet is pinned to `172.30.0.0/24`, and `WEB_TRUSTED_PROXIES` in `.env` is its gateway. A sim project needs another subnet, another host port and another volume. The project `name:` is `email-assistant`, so `ea-sim` needs its own. — observed
2. `deploy/Dockerfile`:1-27 — Base image is `oven/bun:1.4.4`. The image copies `apps/server`, `apps/web`, `packages/core`, `db` and `evals/cases`. It runs `bun run web:build`, then `USER bun`, then `CMD bun apps/server/src/main.ts`. For `tools/fake-telegram` it copies only `package.json`. So the fake is not in the image, and a fake service needs a source mount or a new image. The image has `dbmate` (dev deps stay) and the CLI scripts under `apps/server/src/scripts`, so `docker compose exec server bun apps/server/src/scripts/org-create.ts` is possible. — observed (the exec form is guessed)
3. `deploy/compose.dev.yaml` — GreenMail runs as `greenmail/standalone:2.1.15`. Options are `-Dgreenmail.setup.test.all -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.auth.disabled -Dgreenmail.verbose=false`. Ports are SMTP 3025, IMAP 3143 and IMAPS 3993, published on 127.0.0.1. The dev override also publishes db on 127.0.0.1:5433. — observed
4. `notes/2026-11-03-greenmail-facts.md` — GreenMail facts:
   - Auth is off, so the first login of a new user creates the mailbox. The IMAP password is `greenmail-test`.
   - It has no CONDSTORE and no SPECIAL-USE. It supports UIDPLUS, MOVE, IDLE and XOAUTH2.
   - SMTP does not save to Sent.
   - IMAPS uses a self-signed cert.
   - The note says nothing on relay. — observed
5. `apps/server/src/platform/config.ts` — Config keys a sim stack must set:
   - `MAIL_ALLOW_LOCAL_HOSTS=true` (line 187). `mailAllowLocal` (line 481) lets the old `WEB_MAIL_ALLOW_LOCAL` count only when the new key is unset. The host guard is `modules/mail/host-check.ts`, which I did not read.
   - `TELEGRAM_API_ROOT` (line 126) and `TELEGRAM_BOT_TOKEN` (regex `^\d+:[A-Za-z0-9_-]{20,}$`). The fake's default token is `1000001:fake-telegram-token-local-tests-only`.
   - `LLM_DAILY_CAP` (line 140). The default is 300 per mailbox per America/Los_Angeles day (line 14). A week of about 830 mails over 7 days is about 120 a day, so the cap is probably fine. This is guessed.
   - `TRIAGE_LLM_SCOPE` (`off|synthetic|all`, default `off`), `ACTIONS_SCOPE` (same, default `off`), `SEND_SCOPE` (`off|self|all`, default `off`), `SEND_TEST_ADDRESSES` (needed with `self`) and `TEST_SENDER_ADDRESSES`.
   - `SEND_LIMIT_MAILBOX_HOUR`, `SEND_LIMIT_MAILBOX_DAY` and `SEND_LIMIT_RECIPIENT_DAY` (defaults 20, 100 and 5). A busy sim week could hit them.
   - `MAIL_SYNC_EVERY_MIN` (`2|3|5`, default 2). The README saw about 100 s from a mail to its notice.
   - Provider keys:
     - `LLM_PROVIDER` (default `openai`)
     - `OPENAI_API_KEY`
     - `GEMINI_API_KEY`
     - `LLM_<ROLE>_*`
   - Required: `DATABASE_URL`, `CREDENTIALS_KEY` (base64 of 32 bytes) and `MIGRATOR_DATABASE_URL`. Optional web keys: `WEB_BASE_URL`, `WEB_AUTH_SECRET` (min 32 characters, required with `WEB_BASE_URL`), `WEB_TRUSTED_ORIGINS`, `WEB_TRUSTED_PROXIES`.
   - `OPERATOR_USER_IDS`, `FEATURES_OFF`, `HEARTBEAT_URL` and `OPERATOR_TELEGRAM_CHAT_ID` stay empty on a sim stack. `OPERATOR_TELEGRAM_CHAT_ID` needs a bot token.
   - The `AUTH_SMTP_*` keys (SMTP for web sign-in mail) can point at GreenMail. I did not check this path. — observed (keys); guessed (the `AUTH_SMTP_*` use)
6. **Blocker for a container split.** `tools/fake-telegram/src/server.ts:161` binds `hostname: "127.0.0.1"`, hard-coded. `config.ts:49` `isLoopbackApiRoot` accepts only `127.0.0.1`, `::1` or `localhost`. The README says any other value stops the server at start. A `fake-telegram` container therefore cannot be reached from a `server` container. Options:
   - Run both in one network namespace (`network_mode: service:server`, or the fake inside the server container).
   - Add a bind-address option to the fake, and relax the config check for the sim stack.
   Also, the control routes `/_fake/*` have no token, because the fake is loopback-only. — observed
7. `tools/fake-telegram` as a long-lived service and its driver:
   - `bun run fake-tg serve [--port 8090]` runs until SIGINT or SIGTERM. It keeps state in memory only, so a restart loses all chats. It has no log.
   - Driver CLI commands: `send`, `press (--button|--data)`, `read`, `wait <regex> --after <id> --timeout <s>`. Option `--url` or env `FAKE_TG_URL`. Default chat is 5550001. Exit codes are 0, 1, 2 and 3.
   - HTTP control routes: `GET /_fake/health`, `GET /_fake/chats`, `POST /_fake/send` and `POST /_fake/press` (`control.ts:69-104`).
   - TypeScript API `createFakeTelegramClient(apiRoot)`. Its methods are `health`, `send`, `press`, `read` and `waitFor`.
   - `getUpdates` long-polls for 8 s. The fake has private chats only, with one default chat per `--chat` id. Several executives need one chat each (`--chat` is the id).
   — observed
8. Provisioning CLIs (`package.json` scripts):
   - Org: `org:create --org-name --email --display-name [--timezone] [--plan trial|active] [--trial-days]`. The email must be a valid address (not `u-…@localhost`). Others: `org:invite`, `org:plan` and `org:flag`.
   - Mailbox: `printf '%s' greenmail-test | bun run mailbox:connect --org-id --address --imap-host 127.0.0.1 --imap-port 3143 --smtp-host 127.0.0.1 --smtp-port 3025`. The password comes from stdin only. In a sim stack the hosts become the service name `greenmail`. The guard needs `MAIL_ALLOW_LOCAL_HOSTS`.
   - Mode and switches: `mailbox:settings mode --org-id --mailbox-id --mode shadow|assist [--keep-switches]`. It also has a tool-switch subcommand (name `<tool> on|off`) and `sync-folder --key offers|social|bills|junk --value on|off`.
   - Telegram: `telegram:link --org-id` prints a `t.me` link with a token, then `fake-tg send "/start <token>"`. Others: `telegram:check` and `telegram:unlink`.
   - Delegates: `delegates:add --org-id --name --email [--tags a,b,c]`, then `list`, `disable` and `enable`. Also `delegations.ts`, which I did not read.
   - Seeding: `mailbox:seed --org-id --mailbox-id [--count n | --eval-cases synthetic|injection|delegation|all --per-category n] [--folder]`.
   - Sim and eval: `sim.ts`, `eval-sim.ts` and `e2e-seed.ts` exist under `apps/server/src/scripts/`. I did not read them. They may already cover part of the week simulation.
   - Own DB: `db:worktree <name>` creates a marked `email_assistant_<name>` database and migrates it.
   - The README's live-run recipe (`tools/fake-telegram/README.md` § "Live run without the shared dev DB") is a one-host version of the sim flow.
   — observed (names, usage lines); guessed (that `mailbox:settings` has a tool-switch subcommand beyond its usage line)
9. Tailscale and runbooks: `deploy/README.md:135-169` and `:284-300` cover the prod panel. Serve proxies to `127.0.0.1:8080` with `sudo tailscale serve --bg 8080`, and reset with `tailscale serve reset`. Rules there:
   - The machine name is `email-assistant`.
   - Run `tailscale up` with `--accept-dns=false`.
   - Never run `--force-reauth` over the tailnet.
   ADR 0021 point 6 wants a second Serve port for the sim panel. Guessed: this uses `tailscale serve --https=<port> <local-port>`. I did not read or run a runbook for it. ADR 0017 sets "never publish on 0.0.0.0". The sim server port also needs loopback binding. — observed (prod runbook); guessed (the second port)

Checks: `tools/fake-telegram/test/e2e.test.ts` (run through `bun run test:int`) covers the server's Telegram runtime against the fake with the dev DB and GreenMail; it misses any container split or the second stack. `deploy/check-logging.sh` checks log rotation for compose services; I did not run it. Nothing checks GreenMail relay.

## Scout 3

Question: What can a week scorer read and reuse? List the E3a metric module in packages/core (functions for M1-M5 and M7, their signatures and input shapes), the server readers that feed it (metrics-repo etc.), the DB tables with the facts (triage results, actions, delegations, reminders and chasers, delegate reply detection, audit_log, outbox, llm usage), the PD-044 send limits (where enforced, what rows a hit leaves), and the existing testmail:remote compare scorer. How are delegation reminders (48 h), chasers, expiry and digests timed (system clock, env keys for intervals)?

Job: `2026-11-15-f113-scout-3-8d56ee3a`

Packet: What a week scorer can read and reuse (metrics module, readers, tables, PD-044, compare scorer, timing)
Base: 2e2451be
Verified: `sed -n 98,145p apps/server/src/modules/reports/metrics.ts` -> `export async function weekStats(` (it shows the reader fan-out and the `buildWeekStats` call)
Unknowns:
- I ran no test and no DB query. Every finding is from reading code.
- I did not read the DB schema or migrations. Table and column names come from SQL inside the readers.
- Delegate reply detection: I read `detectReply` and `markAnswered`. I did not read the SQL of `findOpenDelegationByMessageIds`.
- Digest slot logic: I read `packages/core/src/digest/schedule.ts` lines 1-40 only. `channels.digest` runs every minute (`main.ts`) and picks due slots from per-mailbox digest times. I did not find an env key for digest times. (guessed: they live in mailbox settings.)
- The task says "reminders (48 h)". The code has no 48 h reminder. The 48 h value is `APPROVAL_TTL_MS`, the approval time of a send (`actions/constants.ts:5`). Reminder gap is 3 days. Default delegation due is 3 days after send.
- No env key sets reminder, chaser, expiry or delegation-due times. They are constants. The only interval env keys I found are `MAIL_SYNC_EVERY_MIN` and the send limits.

1. `packages/core/src/metrics/` — pure scorers. `weekRange(weekStart, tz)`, `weekStartOf`, `lastFinishedWeek(now, tz)`, `addWorkingDays` are in `week.ts`. All take `now` or rows as input; none read the clock. — verified.
   - M1 `missedImportant(rows: MailTruthRow[])` (`m1.ts:55`). Row: `{emailId, predicted: Category, truth: Category|null, truthSource, wrongOnly}`.
   - M2 `openLoopsOnTime(rows: DelegationDueRow[], {range, timeZone, now})` (`m2.ts:25`). Row: `{id, sentAt, dueAt, answeredAt, doneAt, overdueAt, cancelled}`. It counts due within range, on time if closed or surfaced by due + 1 working day. Null `dueAt` means sentAt + 3 days.
   - M3 `seriousMistakes({moves: HiddenMoveRow[], rejects: RejectRow[], mistakes: MistakeRow[]}, range)` (`m3.ts:47`). It counts hidden important mail, wrong person, wrong content and sent mistakes.
   - M4 `handledShare(rows: HandledRow[])` (`m4.ts:23`). Row has six booleans: mailbox action applied, undone, logged, wrong within 7 days, delegation send applied, delegation cancelled.
   - M5 `urgentLatency(rows: UrgentNoticeRow[], {timeZone})` (`m5.ts:20`). Row: `{emailId, receivedAt, noticeAt|null}`. It leaves out quiet hours. P90 is in minutes.
   - M7 `unitCost(rows: LlmCallRow[], {mailboxes})` (`m7.ts:25`). Row: `{mailboxId, model, tokensIn, tokensOut, at}`. It prices with `costPerMail` and `cost-model.ts`.
   - M8 `autoEvidence(rows: GateRow[])` and `EVIDENCE_MIN_LABELS = 30` (`m8.ts`).
   - `buildWeekStats(rows: WeekRows, {weekStart, mailboxId, timeZone, now}): WeekStats` (`week-stats.ts:27`) calls all of them and validates with `weekStatsSchema` from `web/stats`.
   - `fixtures.ts` has row factories for tests.

2. `apps/server/src/modules/reports/metrics.ts:98` `weekStats(db, ctx, {weekStart, mailboxId, now, withEvidence?}, deps)` is the one entry point. `recentWeekStats` (`:145`) gives the last N finished weeks. `deps = {urgentNotices, testMail}`. The composition root injects the M5 reader because `reports` may not import `channels`. — verified. A scorer can call this with a DB and org context, or call `buildWeekStats` with its own rows.

3. Readers, all `(db, ctx, WeekQuery)` where `WeekQuery = {range, mailboxId|null, testMail:{senders}}` (`metrics/query.ts`): — verified.
   - `triage/metrics-repo.ts`: `listTruthRows` reads `emails`, latest `triage_results`, latest `triage_feedback`. `listHandledRows` reads `actions`, `triage_feedback`, `delegations`.
   - `actions/repo/metrics.ts`: `listHiddenMoveRows` reads `actions`, `triage_results`, `triage_feedback`. `listRejectRows` reads `actions` and `audit_log`. `listMistakeRows` reads `action_feedback`.
   - `delegation/metrics-repo.ts`: `listDelegationDueRows` reads `delegations` plus first `delegation.done` and `delegation.overdue` rows in `audit_log`.
   - `channels/metrics-repo.ts`: `listUrgentNoticeTimes` reads `emails`, latest urgent `triage_results`, earliest `outbox.sent_at`. It leaves out `backfilled_at IS NOT NULL`.
   - `audit/metrics-repo.ts`: `listLlmCallRows` reads `audit_log` rows with `event='llm.call'`, with `data.mailbox_id`, tokens and model in `data` JSON. It counts test mail too.
   - Gate rows (M8): `realGoNoGoRows` from the triage module, plus mailbox settings `category_policy`.

4. Test-mail trap: every reader except LLM cost filters with `mailKindFilter("real", testMail)` (`mail/repo/emails.ts:12`). Test mail is a synthetic Message-ID (`SYNTHETIC_MESSAGE_ID_LIKE`) or a sender in `testMail.senders`. Sim mail from a GreenMail injector counts as real unless the scorer lists the injector senders in `testMail.senders`. — verified.

5. Delegate reply detection: `delegation/service.ts:139` `detectReply` matches `In-Reply-To` and `References` ids and the sender against an open delegation. It runs during triage (`triage/service.ts:136`). `markAnswered` (`:169`) sets `answered_at`, expires open reminder sends and writes audit event `delegationAnswered` with `reminders_expired`. A delegate bot must reply with the right threading headers from the delegate's address. — verified for the code path; the SQL of the finder is guessed.

6. PD-044 send limits: pure rule `packages/core/src/send-limits.ts` (`checkSendLimits`, windows 1 h / 24 h / 24 h rolling). Defaults 20 per hour per mailbox, 100 per day per mailbox, 5 per day per recipient. Env keys `SEND_LIMIT_MAILBOX_HOUR`, `SEND_LIMIT_MAILBOX_DAY`, `SEND_LIMIT_RECIPIENT_DAY` (integers 1 to 10 000; `platform/config.ts:152`). Enforced in `actions/send-limit.ts:startSendWithinLimits`, called from `actions/send.ts:394`, under a per-mailbox advisory lock. — verified.
   - Rows left on a hit: the `actions` row goes back to `approved` with `next_attempt_at = until` and `last_error = sendLimitError(limit)` (starts with `send_limit:`). No attempt is counted. One `audit_log` row: event `actionSendLimited`, `reason_code='send_limit'`, data `{limit, until, mailbox_id}`.
   - `actions/repo/notify.ts:209` finds mailboxes that have held sends by `last_error like 'send_limit:%'`.
   - Counted sends: `actions.type='send'` with `send_started_at` in the window (`repo/sends.ts` `listRecentSends`).

7. Timing — verified by reading; clocks are `new Date()` injected in `main.ts` (`now: () => new Date()`), so there is no fake-clock hook outside the job `now()` deps:
   - Chaser: scheduler cron `20 */15 * * * *` (`main.ts:203`). `runChaserForMailbox(deps, ctx, mailbox, now, {force})` gates on mailbox-local 07:30 (`CHASER_LOCAL_TIME`) and one run per local day (audit event `delegationChaserRun`). `force` skips the gate. This is a direct test hook.
   - `REMINDER_GAP_MS` = 3 days. `MAX_REMINDERS` = `MAX_REMINDER_SENDS` (`delegation/repo.ts`). `CHASER_SET_LIMIT` = 10 per set. The first run marks `sent` rows `overdue`. `reminderDecision` is pure.
   - Delegation due default: `DELEGATION_DUE_AFTER_MS` = 3 days (`actions/constants.ts`).
   - Expiry: cron `0 7 * * * *` (`main.ts:197`). `APPROVAL_TTL_MS` = 48 h, `UNNOTIFIED_TTL_MS` = 7 days, `SEND_SOFT_CAP_MS` = 6 h, `STALE_AFTER_MS` = 10 min, `RETRY_WAIT_MS` = 5 min, `HARD_ERROR_TRIES` = 3.
   - Digests: `channels.digest` every minute (`main.ts:254`). Core `digest/schedule.ts` uses local slot keys `YYYY-MM-DDTHH:MM`, `DIGEST_LATE_MS` = 6 h, `MAX_DIGEST_TIMES` = 6.
   - Mail sync: `MAIL_SYNC_EVERY_MIN` env in {2,3,5}, default 2.
   - Other cron: `triage.worker` and `actions.committer` every 15 s, `channels.notifier` 15 s, `triage.returned` 15 s.

8. Existing compare scorer: `bun run testmail:remote compare --batch <id> [--bar 0.98] [--min-kept 30]` (`package.json:47`) bundles and runs `scripts/testmail-target.ts compare` on a VPS. It uses `buildCompareRows(input, emails, results)` from `packages/core/src/testmail/target.ts:102`. It scores triage category against the expected label of a batch file, matched by Message-ID header, using the latest `triage_results`. It then runs `buildRealReport` and `renderEvalReport`. Exit 0 if all are triaged, 2 if some are pending. It scores triage only. It does not use M1-M7, delegations, actions or outbox. — verified.
   - Reusable parts: `buildCompareRows`, `renderCompareTable`, `listEmailsByMessageIds`, `listLatestTriageByEmailIds`, `buildRealReport`.
   - `packages/core/src/sim/` already holds scenario, plan-week, checks, audit and manifest code. I did not read it.

Checks:
- Unit tests `packages/core/src/metrics/m1..m8.test.ts`, `week.test.ts`, `week-stats.test.ts` cover the pure scorers; I did not run them. They miss the SQL readers.
- `reports/metrics.ts` and the readers: I did not look for integration tests, so I do not know if any cover them.

## Scout 4

Question: How does a human act on the assistant today, and what can a script drive? Describe the Telegram approval card and digest buttons (callback prefixes and data), Undo and edit flows, what the fake Telegram driver in tools/fake-telegram can do (press inline buttons, send text, read messages) and how tests use it; whether E4-A (F102) panel API commands for approve, edit, reject exist at HEAD; how the server sends outbound mail (SMTP send path for approved drafts and delegations, from which mailbox, does it APPEND a Sent copy); and how a delegate reply is matched to a delegation (In-Reply-To, address, other address).

Job: `2026-11-15-f113-scout-4-751de694`

Packet: How a human or script acts on the assistant today (Telegram cards, fake-telegram driver, panel API, outbound mail, delegate reply match)
Base: 2e2451be
Verified: `grep -n "app.post" apps/server/src/modules/actions/routes.ts` -> `22: app.post("/actions/:id/reject-reason"` and `40: ... "/actions/:id/mistake"` (no approve/edit route) | the other parts were read only, not run
Unknowns:
- Which mailbox the SMTP send uses. `deps.mailbox.address` is the envelope `from` (send.ts:421). I did not trace how `deps.mailbox` is picked when an org has several mailboxes.
- Whether a draft can be edited in Telegram. I found no draft-edit callback. "Edit" there only relabels a category (see 1).
- The exact F102 landing state. The F102 folder is in `spec/features/active/`, but `spec/build.md:51` still says PLANNED, so the board is stale or mixed.

1. Callback data, observed. The codec is `packages/core/src/digest/callback.ts:68-130`, with `parseCallback` at 142 and 194-210. Every id is a UUID and the data is at most 41 bytes.
   - Approval card (`packages/core/src/digest/approvals.ts:149`): `ap:<actionId>` Send, `ar:<actionId>` Reject.
   - Reminder set: `as:<setId>` approve all, `rs:<setId>` reject all.
   - Failed or unknown send: `ag:<id>` send again, `gw:<id>` "it went out".
   - Delegation card: `dd:<delegationId>` done.
   - After a reject: `rw:<p|c|n>:<actionId>` gives the reason (wrong person, wrong content, not needed). This shows only while the flag `mistake_capture` is on (approval-taps.ts:151). `mk:<actionId>` is "mistake" after a send.
   - Digest and notice feedback (`notices.ts:16-19`): `fr:<u|r|i|n|s>:<emailId>` right, `fe:<emailId>` edit, `fu:<emailId>` undo, `fc:<code>:<emailId>` pick, `fx:<emailId>` cancel.
   - `/review` page: `vr:`, `vc:` (these also take code `d`), `ve:`, `vx:`. `ay:` and `an:<emailId>` are the answered-check Yes and No.
   - Handling is in `channels/callbacks.ts:handleCallback` and `channels/approval-taps.ts:72-270`.
2. Undo and edit flows, observed.
   - Undo `fu` calls `undoWithFeedback` and answers with `texts.answers.undo[kind]` (callbacks.ts:57-64).
   - Edit `fe` sends the category picker, a new message with `fc:` buttons (callbacks.ts:68-71). Pick records feedback with `recordFeedback`; `fx` replaces the card with a cancelled text.
   - Text commands in `channels/commands.ts:333-343`: help, status, digest, review, pause, resume. `/start <token>` links the chat.
   - A draft cannot be edited in Telegram. Approve, reject and send-again act on the stored draft.
3. fake-telegram, observed. `tools/fake-telegram` is a Bun server on 127.0.0.1 (default port 8090, chat 5550001).
   - It fakes `getMe`, `deleteWebhook`, `setMyCommands`, `getUpdates`, `sendMessage`, `editMessageText` and `answerCallbackQuery`.
   - The TypeScript client `createFakeTelegramClient(url)` (`src/driver.ts:18-36`) has `send(text)`, `press({button | data, messageId, chatId, timeoutMs})`, `read({chatId, strict})` and `waitFor(regex, {timeoutMs, afterMessageId})`.
   - Control routes `/_fake/*` (`src/control.ts:70-110`): `GET /health`, `/chats`, `/chats/:id` (messages and callbacks), `/callbacks/:id`; `POST /send`, `/press`.
   - CLI: `bun run fake-tg serve|send|press|read|wait`.
   - It has a failure hook `failNext` (429 and similar errors).
   - The server needs `TELEGRAM_API_ROOT` on loopback only, plus `TELEGRAM_BOT_TOKEN`.
   - Uses: `tools/fake-telegram/test/e2e.test.ts:73,152-163` links with `/start <token>`, sends `/digest`, then presses undo and checks "Undo started". Also `scripts/check-undo.ts`, `scripts/seed-urgent.ts` and `apps/web/e2e/tests/onboarding.spec.ts`.
4. F102 panel API, observed. It is not at HEAD. `apps/server/src/modules/actions/routes.ts` has only `POST /actions/:id/reject-reason` and `/actions/:id/mistake`, both `requireOwner`. `modules/triage/routes.ts:37` has `POST /actions/undo`. No approve, reject or edit HTTP command exists. The F102 `ticket.md` is a plan (20 stages). Today a script approves only by pressing `ap:` or `ar:` through fake-telegram.
5. Outbound mail, observed.
   - `apps/server/src/modules/actions/send.ts:348-440`: the approved action goes approved → applying → one SMTP call → applied.
   - The message is built from the draft payload and the original mail by `buildOutgoingMessage` (`drafts.ts:30-50`), which sets In-Reply-To and References from the original.
   - The SMTP call is `sender.send({envelope:{from: deps.mailbox.address, to: payload.to}, raw})`. The sender is nodemailer (`mail/imap/smtp.ts`) on the user's own mailbox, so the reply goes from the owner's mailbox.
   - A Sent copy is made by `saveSentCopy` (send.ts:220-238). It looks first by action id with `locateByActionId`. If none exists, it calls `provider.appendMessage(sentFolder, raw, ["\\Seen"])`. An error there leaves the row `applied` with `sent_copy` `failed`.
   - A delegation is a `send` action whose payload has `delegation_id`. It goes the same way, and `onSent` stores `sentMessageId` on the delegation (send.ts:195-202).
   - Reminders (`delegation/chaser.ts:153`) set `in_reply_to` to the delegation's `sent_message_id` and add the original's References.
6. Delegate reply match, observed. `detectReply` (`delegation/service.ts:141-152`) normalizes In-Reply-To plus all References ids, then calls `findOpenDelegationByMessageIds` (`delegation/repo.ts:239-267`). A delegation matches only when all of these hold:
   - the delegation is in the same mailbox and its status is `sent` or `overdue`;
   - the sender address equals the delegate's email, case-insensitively;
   - one of the ids equals `d.sent_message_id`, or equals the `outgoing_message_id` of an applied send of that delegation.
   - The match does not use subject or any other address. A reply with no matching header, or from another address, does not match (guessed from the query; no test run).
   - `markAnswered` then closes the delegation and expires its reminders.

Checks: `tools/fake-telegram/test/e2e.test.ts` covers link, digest and an undo press; it misses approve, delegation and SMTP. I ran no tests. The send and delegation tests exist (`actions/*.test.ts`, `delegation/`), but I did not read them.
