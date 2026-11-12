# AgentMail as the source of synthetic test mail for the Interia test mailbox

Written 2026-11-07. Idea approved by the user; plan: `spec/features/done/2026-11/F036-test-mail-traffic/plan.md` (stage files in `spec/features/done/2026-11/F036-test-mail-traffic/stages/`).
Runbook: evals/testmail/README.md

## 1. The idea (user, 2026-11-07)

The Interia test mailbox (`TEST_MAILBOX_ADDRESS`) has too few and too similar mails. Evals and live tests need more variety:
mail from different persons, about different things. The user does not want to write the mails by hand.

The app gets support for AgentMail (https://agentmail.to) as test tooling: a utility that an agent can run by itself.
It creates synthetic mails (LLM-written) from several AgentMail persona inboxes and sends them to the Interia mailbox.
Each mail has an expected category, so the triage result can be compared with it.

## 2. What the repo has now (checked 2026-11-07)

- `MailProvider` port (`apps/server/src/modules/mail/port.ts`), one real adapter `imap/` (imapflow) and `imap/smtp.ts` (nodemailer). ADR 0010.
- `bun run mailbox:seed` (`apps/server/src/scripts/mailbox-seed.ts`, `modules/mail/seed.ts`): IMAP-APPEND into the INBOX of
  `TEST_MAILBOX_ADDRESS` only. `--eval-cases synthetic|injection|all` appends the eval cases with their own `From`,
  a `Message-ID` `<eval-<id>-<uuid>@ea-seed.test>` and the header `X-EA-Seed: 1`. APPEND does not send.
- `evals/cases/*.json`: `synthetic.json` = 80 cases, 16 per category (urgent, needs_reply, info, notification, spam);
  `injection.json` = 12. Schema `evalCaseSchema` (`packages/core/src/triage/eval-case.ts`). `bun run eval` classifies them with the LLM,
  no mailbox needed. `bun run eval --real` reads labels from `triage_feedback`.
- S1b go/no-go needs at least 30 kept rows per category (`--min-kept 30`, bar 0.98). `spec/features/done/2026-11/F018-s1b-shadow-triage/plan.md`: every category is
  `no-go: too few`. So the S3 automatic moves cannot pass the gate with the current data.
- Scope gates: `TRIAGE_LLM_SCOPE` and `ACTIONS_SCOPE` value `synthetic` select mail by the `@ea-seed.test>` Message-ID suffix.
  `TRIAGE_LLM_SCOPE=all` triages all mail of `TEST_MAILBOX_ADDRESS` only (ADR 0013).
- LLM providers: `apps/server/src/platform/llm/` (Gemini, OpenAI).
- S4 plan needs "a second address the user owns" as the test delegate (P2, P3, stage 22): it receives a delegation and replies.

## 3. AgentMail facts (docs read 2026-11-07)

- Each inbox is a real address `<username>@agentmail.to`. Create: `POST /v0/inboxes {username}`. Auth: one API key (Bearer).
  Base URL `https://api.agentmail.to/v0`; an EU API `https://api.agentmail.eu` exists.
- Send: `POST /v0/inboxes/{inbox_id}/messages/send` with `to`, `cc`, `bcc`, `reply_to`, `subject`, `text`, `html`, `attachments`,
  `labels` and a free `headers` map. Response: `message_id`, `thread_id`. Errors: 400, 403 `message_rejected`, 404, 409, 429 with `Retry-After`.
  Source: https://docs.agentmail.to/api-reference/inboxes/messages/send.md
- Reply in thread: `POST /v0/inboxes/{inbox}/messages/{id}/reply`. List mail: `GET /v0/inboxes/{inbox}/messages`. Webhooks, WebSockets, polling.
- IMAP `imap.agentmail.to:993` and SMTP `smtp.agentmail.to:465` (TLS). Login = inbox address + API key. `From` must be the inbox address.
  Source: https://docs.agentmail.to/imap-smtp.md
- Plans: Free = 3 inboxes, 100 mails/day, no credit card. Developer (paid) = 10 inboxes, 1,000/day, 10 custom domains. Startup = 150 inboxes.
  Source: https://docs.agentmail.to/knowledge-base/rate-limits.md (the agent sign-up page says Free has 1 custom domain: the two pages differ).
- A new Free account: at most 3 new recipients in the first hour, 5 in the first day, 10 in the first week. Our use has 1 recipient.
  Source: https://docs.agentmail.to/knowledge-base/agent-sign-up-limits.md
- Terms: no cold outreach, no spam to people who did not ask (ToS 8(h)); suspension on complaints. Mail to the user's own test mailbox
  is not cold outreach. Source: https://docs.agentmail.to/knowledge-base/cold-outreach.md
- Docs index for agents: https://docs.agentmail.to/llms.txt (append `.md` to a page URL for Markdown).
- [not verified] the `headers` map can set `Message-ID`; a display name per message; Interia puts AgentMail mail into INBOX, not its spam folder;
  an inbox can change its display name (`PATCH /v0/inboxes/{id}`) between sends.

## 4. Limits that shape the design

- **Persons = inboxes.** Each sender address is one AgentMail inbox: 3 on Free, 10 on Developer. All addresses are `@agentmail.to`
  unless a custom domain is set (paid, needs DNS). To get more "persons", options are: a paid plan, a different display name per
  persona on the same inbox [not verified], or `mailbox:seed` (APPEND) for cases that need many senders or domains.
- **Sender rules work.** A persona address can get a whitelist, VIP or blocklist rule, so these paths get real tests.
- **Daily cap:** 100 mails/day on Free; the Gemini free-tier quota is shared by the worker and the eval runner.
- **Data:** AgentMail is a US third party. Send only made-up content, never real mail from the pilot mailbox. API key in `.env` only.

## 5. Value

- More cases per category fix the go/no-go "too few" (about 40–50 per category).
- Real delivery: SPF/DKIM, the Interia spam filter, real INTERNALDATE, mail that arrives over time (sync ticks), real threads.
- Later: an AgentMail persona as the S4 test delegate that replies in the thread (replaces the manual step in S4 stage 22).

## 6. User answers (2026-11-07)

- AgentMail account: exists, Free plan (3 inboxes, 100 mails/day).
- Personas: the agent proposes them. The user suggests plus tags (`inbox+a@…`, `inbox+b@…`) as more sender addresses: check live.
  The AgentMail SMTP docs say `From` must be the inbox address, so a tag in `From` can fail [not verified for the REST API].
  The app treats `a+x@` and `a+y@` as different senders (`splitAddress` keeps the tag; only the noreply check in
  `packages/core/src/triage/rules.ts:60` strips it).
- Generation: the agent session (a Claude model) writes the mails. No LLM API call, so no token cost, and a model family that is not the classifier's.
- Labels and review: the agent decides (proposal in the handoff: a second blind labelling pass by another Claude model).

## 7. Live probe 2026-11-07 14:40Z (AgentMail side)

Script: `/tmp/ea-am-probe/probe.ts` (not in git), output `/tmp/ea-am-probe/out.txt`. Recipient: the pilot address (`TEST_MAILBOX_ADDRESS` on the VPS).

- The account already had 2 inboxes of the user (`arturs@agentmail.to`, `arturs-away@agentmail.to`). Free = 3, so only 1 slot was free.
  The probe created `ea-testmail-75wd@agentmail.to` (`client_id` `ea-testmail-1`, display name `EA Test Mail`). The inbox id is the address.
- After the first PATCH the inbox shows `status_until: 2026-12-07T14:40:11Z` (30 days after create) [meaning not verified: maybe a Free-plan expiry].
- `POST /inboxes/{id}/messages/send` → 200 `{message_id, thread_id}`. `message_id` is the SES id `<…@email.amazonses.com>`, not our `Message-ID` header.
- `headers` map: AgentMail accepts and stores `Message-ID`, `X-EA-Seed`, `X-EA-Case`, `In-Reply-To`, `References`, `From` (GET message shows them under `headers`).
  What reaches Interia: see section 8.
- `labels` on send: stored (`sent` + our labels, for example `ea-case-probe-75wd-p2`). `GET …/messages?labels=` can filter by them (docs).
- `From` override in `headers` (plus tag + display name): accepted with 200; AgentMail's own `from` field still shows the inbox address.
- `PATCH /inboxes/{id} {display_name}` works at once: the next send has `from` `Jan Kowalski <inbox>`.
- `Idempotency-Key` header on send: the same key + same body → 200 with the same `message_id`, no second mail. Same key + other body → 409
  `IdempotencyKeyConflictError`. Keys expire 24 h after the send (docs: https://docs.agentmail.to/idempotency.md).
- The app stores only the bare `From` address (`mail/imap/mapper.ts` `addresses()`); the display name never reaches the DB or the classifier.
  So per-mail display names give no sender variety to the app; only distinct addresses (plus tags) do.

## 8. Live probe 2026-11-07 (Interia side, checked 15:30Z)

Read-only check on the VPS: SQL on `emails`, and a one-off IMAP script (`/tmp/ea-am-probe/inspect.ts`, run in the server container with `docker compose run --rm -T -v /tmp/ea-inspect.ts:/app/ea-inspect.ts:ro server bun /app/ea-inspect.ts`; read-only folder locks, no flags changed).

- **Folder:** Interia put all 6 probe mails into its folder `Oferty` (offers tab; no special-use flag), not into INBOX and not into `Wiadomości-śmieci` (Junk).
  The app syncs INBOX only, so none of them reached the DB (`emails` has 0 rows from `%agentmail.to` 50 min after the send). Delivery took 7–16 s.
- **Message-ID:** SES replaces it. The delivered `Message-ID` = the `message_id` in the AgentMail send response (`<…@email.amazonses.com>`). Our `<…@ea-seed.test>` is lost, so AgentMail mail is never "synthetic" for `mailKindFilter` / the scope gates.
- **Custom X- headers arrive:** `X-Ea-Seed: 1`, `X-Ea-Case: …` (name case changed by the transport). The app stores none of them (only `x-ea-action-id`).
- **In-Reply-To / References from the `headers` map arrive** unchanged, so threads can be built (p5 → p2).
- **`From` override in `headers` is dropped:** p3 (plus tag + name) and p3b (name only) arrived as `EA Test Mail <ea-testmail-75wd@agentmail.to>`.
  Plus tags in `From` do not work. One inbox = one sender address.
- **`PATCH display_name` before a send works:** p4 arrived as `Jan Kowalski <ea-testmail-75wd@agentmail.to>`. But the app keeps only the bare address.
- **Body footer:** AgentMail appends `-- Sent via AgentMail` to the text body (Free plan; seen in the AgentMail preview).
- Header `X-Interia-Antivirus: OK`; no spam score header seen.

## 9. More probe results and doc facts (2026-11-07, plan session)

- **Webmail sender rule did not stick.** The user moved the 6 probe mails from `Oferty` to `Odebrane` with "apply to all messages from this sender"
  (Interia help: https://pomoc.poczta.interia.pl/wiadomosci-i-obsluga-poczty/news-nowi-nadawcy-w-folderze-oferty,nId,2354572). Two later probe mails
  (`EA probe filter check f1` 15:47Z, `f2` 15:49Z) still went to `Oferty`. The user then moved f1 by hand; f2 is still in `Oferty`. User decision: the tool moves its own mail.
- **No filter API at Interia:** port 4190 (ManageSieve) closed on `poczta.interia.pl`, `imap.poczta.interia.pl`, `sieve.interia.pl` (checked from the PC).
  Private filters exist only in the webmail (Ustawienia → Filtry → Dodaj filtr; help: https://pomoc.poczta.interia.pl/moje-konto-i-ustawienia/news-jak-automatycznie-sortowac-poczte-tworzenie-filtrow,nId,23489473). Not tried.
- **Moved mail syncs:** the 7 probe mails moved into INBOX by the user were stored and triaged by the VPS at 15:50Z (`sync … fetched 7, stored 7`);
  `emails.message_id_header` = the AgentMail `message_id` exactly. Triage: 4 × `info/fyi`, 3 × `notification/automated_system` (gpt or gemini, as the VPS config).
- **Bundle in the VPS image:** `bun build <script> --target bun --outfile x.js` of a script that imports `platform/config`, `platform/db`, `platform/crypto`,
  `mail/repo`, `mail/imap/client` gave a 6.4 MB file with no `.env` value in it (no `--env` flag). It ran in the live image with
  `docker compose -f deploy/compose.yaml --env-file .env run --rm -T -v /tmp/x.js:/tmp/x.js:ro server bun /tmp/x.js` and read the DB and Interia IMAP (16:53Z).
- **stdin and exit code pass through** `ssh home_vm '… docker compose … run --rm -T -v …:ro server bun <file>; code=$?; rm -f <file>; exit $code'`
  (a JSON line in, `exit=2` out, 2026-11-07).
- **VPS DB migrations** (read-only `select version from schema_migrations`, 2026-11-07): up to `20261107000002` (S3). `20261108000001_delegation.sql` (S4) is not applied.
- **AgentMail docs facts used by the plan:**
  - `client_id` makes inbox/draft creation idempotent; sends use the `Idempotency-Key` header; keys: 1–256 characters of `A-Z a-z 0-9 - . _ ~`, scoped to the
    organization, expire 24 h after the send; a retry during processing → 409 (name not given). Source: https://docs.agentmail.to/idempotency.md and
    https://docs.agentmail.to/knowledge-base/preventing-duplicate-sends.md
  - 429 has `Retry-After`, "usually 1" second. Source: https://docs.agentmail.to/knowledge-base/rate-limits.md (that page also says Free = no custom domain).
  - List messages filters: `labels`, `from`, `to`, `subject`, `before`, `after`; `limit`, `page_token`. Source: https://docs.agentmail.to/api-reference/inboxes/messages/list.md
  - Update inbox: `PATCH /inboxes/{id}` with `display_name`, `status`, `deactivate_at`, `signature`, `metadata`. Source: https://docs.agentmail.to/api-reference/inboxes/update.md
- **Interia folders** (`notes/2026-11-03-interia-imap-capabilities.md`): `Oferty`, `Rachunki`, `Społeczności` (no flag), `Wiadomości-śmieci` = `\Junk`.
  The Interia account is the user's only account (real and test use), so the deliver step moves mail in a real mailbox: only the tool's own mails.

## 10. Stage 9.1 smoke run (2026-11-08, task `test-mail-traffic`)

- Preconditions (VPS, read-only): `ACTIONS_SCOPE=all` 1, `SEND_SCOPE=all` 1, `TRIAGE_LLM_SCOPE=all` 1; migrations up to `20261108000001`; 1 active delegate;
  VPS repo `fa60c7b`. PC Bun 1.4.4 builds the bundle; the VPS image runs it (worked).
- `testmail:setup`: `status active`, `status_until 2026-12-07T15:47:05.928Z` (unchanged by the setup GET).
- Send: batch `2026-11-08-smoke`, 3 mails, 07:58:16Z–07:58:38Z, exit 0. The send log holds no subject, body or recipient.
- Live `listByLabel` (our client, real API) for the first case label → count 1. **Verified.**
- `testmail:remote deliver` bundled `origin/master` `b6a0742` and ran in the VPS image. The 3 mails were in `Oferty` (folder key `offers`).
- **Finding: Interia sorts an IMAP `UID COPY` into INBOX back into `Oferty`.** Deliver reported `moved 3` (COPY + EXPUNGE without error), but a read-only
  inspect right after shows the 3 mails in `Oferty` again with new UIDs (38957–38959 → 38960–38962), and none in INBOX. The VPS sync stored none of them.
  No mail was lost or doubled. So the D10 move (COPY + EXPUNGE) does not work at Interia for this sender.
- **Finding: IMAP `APPEND` into INBOX stays.** A probe APPENDed the raw source of one smoke mail (`anna-termin-dostawy`, from `Oferty` uid 38960) into
  INBOX (uid 38963, same INTERNALDATE). After 45 s and after the next sync it was still in INBOX; the VPS stored it (`stored 1`) and triaged it
  (`needs_reply`, `question`). The `Oferty` copy (uid 38960) is still there.
- **Finding: `\Junk` is `AI/Spam` now** (S3 set the flag), and `Wiadomości-śmieci` has no flag. Deliver's `junk` key resolves to `AI/Spam`, a product folder.
- **Update (sync-sort-folders, 2026-11-09):** the sync reads `Oferty` now (and `Społeczności`, `Rachunki`, `Wiadomości-śmieci`; `spec/features/done/2026-11/F058-sync-sort-folders/plan.md`). AgentMail mail that Interia sorts into `Oferty` is stored and triaged there, so the `deliver` step is not needed. A COPY into INBOX does not work at Interia (finding above); APPEND does.
- Probe scripts (not in git): `/tmp/ea-tmt-inspect/` (read-only inspect; APPEND probe).

## 11. Stage 9 with the sort-folder sync (2026-11-09/10)

- Smoke `2026-11-09-smoke` (3) and batch `2026-11-09-batch-01` (25): Interia put all 28 mails into `Oferty`. The VPS sync stored and triaged each within about 10 minutes
  (sync at minute 0, 5, 10 …). No `deliver` run.
- Classifier on this sender: 24/25 ok on batch-01 (`classifier-v2`, `gpt-6-luna`); smoke: a client question → `delegation` (1 delegate active).
- `testmail:send --limit 10 --interval-sec 45`: 3 runs for 25 mails (about 17 minutes). `status_until` after batch-01: `2026-12-10T10:30:47.019Z` (`testmail:setup` 2026-11-10 ~11:05Z; = 30 days after the first send of batch-01).
- Sort-folder actions seen on test mail: the results note `notes/2026-11-09-sort-folders-live-test-results.md`.
