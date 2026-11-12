> **Status 2026-11-10 — done.** Stages 1–9 done; batch `2026-11-09-batch-01` 24 of 25 ok (§ Results); runbook without `deliver`. Follow-ups: `tasks/planned/testmail-mail-kind.md`, `testmail-delegation-label.md`, `testmail-s4-delegate-persona.md`.

# Test mail traffic: AgentMail synthetic mail utility

Scope: test tooling for the Interia test mailbox (`TEST_MAILBOX_ADDRESS`); not a roadmap slice. Needs: the user's AgentMail account (Free plan) and its API key in the local `.env` (`AGENTMAIL_API_KEY`, set by the user on 2026-11-07).
Facts and sources: `notes/2026-11-07-agentmail-test-mail.md` (§3 docs, §7–8 live probe).
Git mode: worktree (user 2026-11-08: "prepare a handoff that will start implementing it in the separate work tree"; replaces the `master` exception in `tasks/README.md` § "Git mode").

## Goal

Support for AgentMail in the app, as test tooling: a utility that an agent can run by itself. The agent session writes made-up mails
for several personas into a batch file. The utility sends them from an AgentMail inbox to the Interia test mailbox, puts them into the
Interia INBOX, and compares the triage result of each mail with its expected category.

## Scope

1. AgentMail client (REST, API key from `.env`): inbox, display name, send with an idempotency key, list by label.
2. Personas: one AgentMail inbox; each persona is a display name and a role in a committed persona file.
3. Generator: the agent session (a Claude model, no LLM API call) writes batch files; a second Claude model labels them blind; a schema and data rules check them.
4. Sender: sends the mails to `TEST_MAILBOX_ADDRESS` only, at most once each, and keeps a send log outside git.
5. Deliver: moves the utility's own mails from the Interia sort folders (`Oferty`, …) into INBOX, so that the sync reads them. (Not used since 2026-11-10: the server syncs the sort folders, see done-when 2.)
6. Compare: matches the sent mails with the synced and triaged mails and reports expected vs triage category, with the eval metrics.
7. Agent use: non-interactive CLI commands with clear output and exit codes, a remote runner for the VPS part, and a runbook for agents.

Later (not in this plan): an AgentMail persona as the S4 test delegate that replies in the thread (user default 2026-11-07, P6).

Out of scope: any change to the product `MailProvider` port contract; any send to an address other than `TEST_MAILBOX_ADDRESS`;
any write into `triage_feedback`; any change of the S3 go/no-go gate (`mailbox:settings auto`); a VPS deploy.

## Done when

1. `bun run testmail:send` sends the mails of a validated batch from the AgentMail inbox to `TEST_MAILBOX_ADDRESS`, at most once per case
   (also after a crash or a repeat), and refuses to run without `TEST_MAILBOX_ADDRESS`.
2. Every sent mail of the batch reaches the server: the VPS sync stores it and the triage worker triages it. (Changed 2026-11-10: the server syncs
   `Oferty` since task `sync-sort-folders` (user, 2026-11-08 "go with option 3"; 2026-11-09 "I suppose that you can test both things at once.", Log 2026-11-10), so no `deliver` move into INBOX is needed;
   a COPY into INBOX does not work at Interia, notes §10.)
3. `bun run testmail:remote compare` prints expected vs triage category per mail and the eval report (precision, recall, go/no-go) for the batch.
4. The first real batch (stage 9: at least 25 mails, all 5 classifier categories, at least 3 personas, at least 2 threads) ran end to end; its compare report is in this file.
5. No API key, IMAP password or mail text in any log line, error text, send log or bundle; the batch files hold only made-up content.
6. `evals/testmail/README.md` lets a new agent run the whole loop without chat history.

## Plan

> **For the build session:** this plan has the full step detail (Goal, Files, Interfaces, Decisions, Test, Check, Done when, Out of scope).
> The `run-task` skill skips the `planner` call. The main session wrote the plan on 2026-11-07 with the `plan-task` skill.
> A gap that the build finds = stop. Decide from "Input" if it answers the gap; else ask the user.

### Planning progress

- [x] Collect: handoff, task file, notes, `tasks/README.md`, `docs/code-patterns.md`, `evals/README.md`, mail/triage code, eval runner, deploy files.
- [x] User answers (2026-11-07): see "User decisions".
- [x] Live probe (AgentMail side and Interia side): `notes/2026-11-07-agentmail-test-mail.md` §7–8.
- [x] Stage files 1–9 written (2026-11-07).
- [x] Cold review (reviewer subagent, Opus, high): FAIL (3 blockers, 12 majors, 22 minors), all fixed; re-review: PASS (13 minors, fixed). Record: [`test-mail-traffic/review-2026-11-07.md`](test-mail-traffic/review-2026-11-07.md).
- [x] Independent review, separate session (Claude Code, Opus): 0 blockers, 4 majors, 12 minors; all fixed except one accepted minor. Record: [`test-mail-traffic/review-2026-11-07-session2.md`](test-mail-traffic/review-2026-11-07-session2.md).
- [x] User approval (2026-11-08): "Plan is finished, everything is finished to start implementing it" and the worktree build (Git mode line).

### Input: user words (word for word, 2026-11-07)

> "I don't want to do that by myself. Instead, I want you to use second email provider and use it to create and send emails to my main account."
> "It could be used later for testing purpose."
> "lets use different email provider." (then an AgentMail description)
> "prepare very detailed implementation plan for it and put it in the task list."
> "So, yes, I have an agent mail account. It's free tier."
> "In terms of personas, I don't know. You should suggest that, which will be the best for you. Additionally, you can use email syntax with plus in the email address. like address+A@email.com address+B@email.com ... There is chance that this can be treated as different emails ... You can just check it."
> "I think that you should use the cloud session to write them. And the model is just your choice, whether this is sonnet, opus or any other one or haiku. ... it's different from the model from OpenAI. And secondly, it is just free. It doesn't use API tokens for generation. ... you should use the cloud code from the session to generate such emails."
> "I don't know about the labels and review. Do as you think. What will be the best."
> "the idea is to use just this new email provider and to use or provide the support for it and build the associated code to use it for a testing purpose. I mean, to create a utility for this application that will be able to run by yourself, by agent. So it will be able to create synthetic emails for comparison or for... I mean, so my email at Interia will have access to different emails from different persons."
> "Session run, yes, subagents with approval at the end. Yes, fourth one also okay and fifth one also okay. So yeah, use the default ones and proceed with the preparing implementation plan."
> "Point one, yes you can do the run SQL query for it, that's fine. So you will be independent and you can proceed by yourself fully. But for point two, I don't know what it is about. If any of those options can help you make it better, run it better, then it's fine. If you think this is necessary for me to understand it then give me more context otherwise just use default value for it."
> "Okay, if you can bypass it or do it yourself then yes, that's okay, do it." (about the Interia `Oferty` folder: the tool moves its own mail into INBOX)

### User decisions (2026-11-07)

- **P1 Test tooling only.** No product feature, no change to the `MailProvider` port contract (user words above).
- **P2 AgentMail, Free plan, one inbox.** The account had 2 inboxes of the user (`arturs@`, `arturs-away@agentmail.to`); Free = 3. The probe created the third:
  `ea-testmail-75wd@agentmail.to` (`client_id` `ea-testmail-1`). The user's 2 inboxes stay untouched (user: "use default value").
  Rejected: delete the user's inboxes (the user does not know their use); a paid plan (cost, not needed for content tests).
- **P3 Generation by the agent session.** A Claude model in the pi session writes the batch (writer: Sonnet). No app code calls an LLM to write mail.
  Reason: free, and a model family that differs from the classifier (Gemini / OpenAI). User: model choice is the agent's.
- **P4 Labels and review (agent's choice, user 2026-11-07).** The writer sets `expected`; a second Claude model of another size (Haiku) labels the
  same mails blind (`blind`). A case where the two differ is fixed before the send: removed, rewritten, or marked `borderline:` (D7).
  No manual review by the user. Expected labels never go into `triage_feedback` (it holds real user labels).
- **P5 Interia sort folders.** Interia put every probe mail into its folder `Oferty`; a "move + apply to this sender" in the webmail did not stick
  (2 later mails went to `Oferty` again). User: the tool moves its own mails into INBOX itself (D10).
- **P6 S4 test delegate persona:** later, not in this plan (default).
- **P7 Session run:** subagents yes, one approval at the end (user).
- **P8 VPS access:** read-only SQL and the test-tool runs on the VPS are allowed; the agent works alone ("you can proceed by yourself fully").
  No deploy, no `.env` edit, no change to the running server.

### Facts checked (2026-11-07)

All with source in `notes/2026-11-07-agentmail-test-mail.md` (§3 docs, §7–8 probe, §9 more probes and doc links).

- AgentMail REST: base `https://api.agentmail.to/v0`; Bearer key; the inbox id is the address; `POST /inboxes {username, display_name, client_id}` is idempotent by `client_id`.
- `POST /inboxes/{id}/messages/send {to, subject, text, headers, labels}` + header `Idempotency-Key` → 200 `{message_id, thread_id}`. Same key + same body → the same
  `message_id`, no second mail (probe). Same key + other body → 409 `name: IdempotencyKeyConflictError` (probe). Keys expire 24 h after the send (docs).
  Key characters: 1–256 of `A-Z a-z 0-9 - . _ ~` (docs).
- The delivered `Message-ID` at Interia = the `message_id` of the send response (`<…@email.amazonses.com>`). Our own `Message-ID` header is replaced (probe).
- `In-Reply-To` and `References` from the `headers` map arrive unchanged (probe). Custom `X-…` headers arrive (probe).
- A `From` in the `headers` map is dropped; plus tags in `From` do not work: one inbox = one sender address (probe).
- `PATCH /inboxes/{id} {display_name}` changes the display name of the next send (probe). The app stores only the bare `From` address
  (`apps/server/src/modules/mail/imap/mapper.ts` `addresses()`), so the display name never reaches the DB or the classifier.
- `labels` on send are stored on the sent message (probe). AgentMail adds `-- Sent via AgentMail` to the text body (Free plan, probe).
- 429 comes with `Retry-After` (seconds, usually 1) (docs). Free plan: 100 mails/day, 3 inboxes (docs).
- Interia: delivery in 7–16 s; all probe mails went to `Oferty` (no special-use flag), none to INBOX or Junk (probe). Interia has no MOVE; a `UID COPY` to INBOX
  gives a new UID above `UIDNEXT` (`notes/2026-11-07-assist-actions-facts.md`), so a copied mail is always above the sync cursor. A webmail move keeps the UID.
- The VPS sync stored and triaged the 7 probe mails that the user moved into INBOX (VPS DB, 15:50Z): `message_id_header` = the AgentMail `message_id` exactly.
- Interia has no filter API (no ManageSieve on port 4190, checked from the PC).
- A `bun build --target bun` bundle of a script that imports `platform/config`, `platform/db`, `platform/crypto`, `mail/repo` and `mail/imap/client` runs in the
  running VPS server image with `docker compose run --rm -T -v <bundle>:<path>:ro server bun <path>` and reads the DB and Interia IMAP (probe 16:53Z, 6.4 MB bundle;
  no `.env` value in the bundle because `--env` was not used).
- The VPS is reachable from this PC as `ssh home_vm` (repo `~/email_assistant`, compose `docker compose -f deploy/compose.yaml --env-file .env`). The VPS runs
  an older server image (S2 era); the S3 deploy is S3 stage 19 (not done). The VPS DB has the migrations up to `20261107000002` (S3);
  `20261108000001_delegation.sql` (S4) is not applied (notes §9). **[stale 2026-11-08]** S4 is done and deployed on the VPS (`fa60c7b`, `SEND_SCOPE=all` since
  2026-11-07 22:40Z, `tasks/done/s4-drafts-approvals-delegation.md`), so the VPS image, its classifier version and its migrations are newer now. Stage 9
  reads `schema_migrations` again; compare prints the prompt versions. **[corrected 2026-11-08, group review 6–8]** The VPS `.env` has `ACTIONS_SCOPE=all`,
  `SEND_SCOPE=all` and `TRIAGE_LLM_SCOPE=all` (read-only `grep -c` on the VPS, 2026-11-08; S4 stage 22.1: mode `assist`, `create_draft` on, one active delegate
  "Test delegate" = the user's Gmail). So the server acts on AgentMail test mail like on real mail: the committer moves it into `AI/*`, a `needs_reply` or
  `delegation` mail can get a draft in the Interia Drafts folder and an approval prompt in the user's Telegram, and a send goes out only after the user's tap.
  The active delegate also adds `delegation` to the classifier prompt (a `delegation` result counts as `WRONG` in compare, D11).
- `platform/log.ts`: `info` and `debug` go to stdout (`console.log`), `warn` and `error` to stderr.
- Pilot ids (`notes/2026-11-03-pilot-vps.md`): org `ac6ed6a2-ee37-461f-9632-cc08cf549e40`, mailbox `8bc7f572-a7f5-4fa5-aaab-db16dc663e96`, address `artekstryszowski@interia.pl` = `TEST_MAILBOX_ADDRESS` on the VPS.
- stdin and the exit code pass through `ssh home_vm '… docker compose … run --rm -T -v …:ro server bun <file>'` (probe 2026-11-07: a JSON line in, exit 2 out).
- The local `.env` has no `TEST_MAILBOX_ADDRESS`. `mailbox:probe-move` already takes it on the command line (`TEST_MAILBOX_ADDRESS=<address> bun run …`).
- Git over SSH from this PC: the default key fails (`git ls-remote origin master` → `Permission denied (publickey)`); with
  `GIT_SSH_COMMAND="ssh -i $HOME/.ssh/github -o IdentitiesOnly=yes"` it works (checked 2026-11-07, review session 2). `git fetch` and `git push` both need it.
- The app classifier is `classifier-v2` on `origin/master` since 2026-11-07 (`triage/index.ts` exports `PROMPT_VERSION` from `prompts/classifier-v2.ts`; S4 D3).
  The VPS runs an older image (v1). `triage_results.prompt_version` stores the version per result. `categories.ts` also has `delegation` (only with active
  delegates) and `unsure` (rules, blocked calls).

- Checked live 2026-11-07 (review session 2, read-only): `GET /inboxes/{id}/messages?labels=ea-case-probe-75wd-p2&limit=20` → 200, `count` 1, the one probe mail
  with that label (the inbox has 8 messages); an unknown label → `count` 0. `GET /inboxes/{id}` → 200 with no `status` field (docs: `status` is omitted when the
  inbox is active; `deactivated` stops send and receive; the documented schedule field is `deactivate_at`, https://docs.agentmail.to/api-reference/inboxes/update.md).
- Checked live 2026-11-07 (review session 2): a `bun build --target bun` bundle of `platform/config.ts` from `origin/master` (`1921dad`; no env value in it) ran in
  the VPS server image with `docker compose run --rm -T`: `loadConfig()` OK, `TRIAGE_LLM_SCOPE=all`, `ACTIONS_SCOPE=synthetic` **[stale 2026-11-08: now `all`, see above]**, `TEST_MAILBOX_ADDRESS` set.
  `schema_migrations` on the VPS: up to `20261107000002` (unchanged).

### Not verified (and the stage that checks it)

- The name of the 409 for "a retry while the first request is still in progress" (docs give no name). Stage 3 treats every 409 that is not `IdempotencyKeyConflictError` as soft.
- The day boundary of the AgentMail 100/day limit. D8 uses a rolling 24 h with a cap of 50, far below the limit.
- Whether a later `origin/master` config still accepts the VPS `.env` (checked OK on 2026-11-07, see "Facts checked"; a later slice can add a required key).
  A `ConfigError` fails safe (exit 1, key names only); stage 9 step 9.1.5 meets it first. Then stop and ask the user: no `.env` change is allowed (P8).
- Whether `POST /inboxes` with a known `client_id` still answers 200 when the Free plan has 3 of 3 inboxes. Stage 4.2 `setup` calls `GET` first and `POST` only on 404.
- The meaning of the inbox field `status_until` (not in the docs; it moved from `2026-12-07T14:40:11Z` to `2026-12-07T15:47:05.928Z` after the later probe sends, so it looks like
  30 days after the last activity). Stage 4 `setup` prints it; stage 9 records it. When the inbox shows `status: deactivated`, stop and tell the user.
- Whether Interia keeps sorting this sender into `Oferty`, or later into `Wiadomości-śmieci` or another sort folder. D10 handles all sort folders.

### Design decisions

- **D1 Where each command runs.** AgentMail calls run on the agent's PC (the key is only in the local `.env`). The Interia mailbox and its DB live on the VPS.
  So: `testmail` (setup, validate, blind, send, status) runs on the PC. `testmail-target` (deliver, compare) runs where the DB of the mailbox is: on the VPS for the
  pilot, locally for tests. `testmail:remote` runs `testmail-target` on the VPS from the PC: it builds a bundle (`Bun.build`, target bun, no `env` option) **from a
  clean detached worktree of `origin/master`** (reviewed and pushed code only: the working tree is shared with running S3/S4 builds and can hold unreviewed code),
  copies it with `scp` to a unique `/tmp/ea-testmail-<uuid>.js` on the VPS, and runs it in a one-off server container with the bundle mounted read-only and the
  batch's target input on stdin. Reason: no VPS deploy (S3 stage 19 owns the next deploy), no change to the running server. The bundled code may use only DB
  objects of migrations that the VPS has applied (today: up to `20261107000002`); stage 9 checks `schema_migrations` first. Rejected: wait for the S3 deploy (blocks the
  tool for an unknown time); psql exports (untyped SQL in shell strings); the Interia password on the PC (a second copy of a secret).
- **D2 Recipient guard.** `send` has no `--to` option. The recipient is `TEST_MAILBOX_ADDRESS` from the environment (on the PC it is set on the command line,
  as for `mailbox:probe-move`), and it must equal (case-insensitive, trimmed) the `testAddress` pinned in the committed `evals/testmail/target.json`
  (`artekstryszowski@interia.pl`). Missing, not an address, an `@agentmail.to` address, or not equal to the pinned value → exit 1 before any HTTP call, so a typo
  cannot send mail to a stranger. `deliver` refuses unless the mailbox address equals `TEST_MAILBOX_ADDRESS`
  on the VPS (`assertTestAddress`). The recipient never comes from a batch file or from LLM text.
- **D3 At most once per case.** Each send has an `Idempotency-Key` `ea-<batch>-<case>-a<attempt>` (attempt 1, 2, …). Order per case: append an `intent` line
  (key, request hash, time) to the send log → PATCH the display name if needed → send → append a `sent` line (`message_id`, `thread_id`). Repeat or crash cases:
  - `intent` without `sent`, intent younger than 12 h → send the identical request with the same key (AgentMail returns the first `message_id`, no second mail).
    12 h, not 23 h: a margin for a wrong PC clock against the server-side 24 h key expiry.
  - `intent` without `sent`, 12 h or older (the key may have expired) → look up the label `ea-<batch>-<case>` in AgentMail; exactly one message that really has
    the label → write `sent` from it; none → a new attempt with key `…-a<n+1>`; two or more → stop (`duplicate_found`).
  - The request hash of a new attempt differs from the hash in the open `intent` (the case was edited after a send attempt) → state `changed`: skip and report;
    the agent gives the case a new id.
  - 409 `IdempotencyKeyConflictError` → a `failed` line with code `idempotency_conflict` (final; never send with a new key on our own; the agent gives the case a new id).
  - Two `send` runs at once → a lock file (D8) makes the second exit 1. `testmail:remote deliver` holds the same lock for its whole run (it appends `delivered` lines).
  - A crash during a log append leaves a partial last line. The next append first cuts the file back to its last `\n` (the lost line was an `intent` written before
    any HTTP call, or a `sent` line whose case D3 then resolves by key reuse or label). A bad line in the middle of a log → every command refuses; the agent stops and
    asks the user. Nobody moves or edits a send log (a lost log could resend every mail after 24 h).
- **D4 Matching key.** The send log keeps the AgentMail `message_id`. It equals the delivered `Message-ID` and `emails.message_id_header` (exact string). Deliver and
  compare match on it. No other key (subject, time) is used.
- **D5 Personas.** One inbox (P2). A persona = `key`, display name, role group (`work`, `services`, `outside`), language, a short voice text for the writer.
  File `evals/testmail/personas.json` (committed). Before a send the tool sets the inbox display name to the persona's name (PATCH, only when it differs from the
  last name the tool set in this run or the inbox shows). The display name is for the user's view only (the app keeps the bare address).
  Rule for agents: never add a sender rule (`rules:add`) for the inbox address; it would hit every persona.
- **D6 Files.** Batches: `evals/testmail/batches/<YYYY-MM-DD>-<slug>.json` (committed, made-up content). Personas: `evals/testmail/personas.json`.
  Send logs: `~/.local/state/ea-testmail/<batch>.jsonl` (outside every checkout and outside git): ids, keys, hashes, times, codes, folder keys, and the persona inbox
  address in `sent` lines; no subject, no body, no other address. Lock: `~/.local/state/ea-testmail/send.lock`. Why outside the checkout (2026-11-08, worktree
  mode): `git worktree remove` would delete logs inside the worktree (a lost log can resend every mail after 24 h, D3), and a log per checkout would hide sends
  from the daily cap and the lock. Remote target and pinned recipient: `evals/testmail/target.json`.
  Batch id = the file name without `.json`, regex `^\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,40}$`. The batch, persona and target files hang off the repo root of the
  checkout that runs the CLI. `TESTMAIL_ROOT` from the environment (tests only) moves all paths, also the runs folder (`<root>/evals/.runs/testmail/`), into a
  temp folder. The CLIs have no per-path flags, so a real run cannot use a second log folder that the cap and the lock do not see.
- **D7 Batch rules (validate).** Schema in `packages/core/src/testmail/batch.ts` (stage 1). Each case: `id` (`^[a-z0-9-]{1,40}$`, unique), `persona` (a key in the persona
  file), `lang` (`pl` | `en`), `subject` (1–200 characters, no line break), `body` (1–6000 characters), `expected.category` (`urgent` | `needs_reply` | `info` |
  `notification` | `spam`), `blind.category` (same enum; missing = not yet labelled), optional `replyTo` (an earlier case id of the same batch, same persona or
  another persona of group `work`), optional `note`.
  Data rule (like `evals/README.md`): every e-mail address and every URL host in subject and body ends in `.test`, `example.com`, `example.org` or `example.net`;
  no phone number of 9 or more digits in a row; no `TEST_MAILBOX_ADDRESS` value in the text. `send` and the structural test refuse a batch with a case where
  `blind` is missing, or `blind` ≠ `expected` and `note` does not start with `borderline:`. `note` that starts with `attack:` marks an injection-style case.
- **D8 Pace and caps.** `--interval-sec` default 30 (min 5) between sends; `--limit` (default all due cases); daily cap `--daily-cap` default 50 (max 95): the
  number of `sent` lines with `via: "send"` in all send logs in the last 24 h. Cap reached → stop, exit 2. Known gap: a mail found by label recovery and an open
  intent whose mail went out are not counted; a key reuse is counted although no new mail goes out. The cap of 50 against the limit of 100 covers this. One `send` at a time: lock file created with `wx`; it holds the pid and the
  time; it is stale (replaced) when the pid is not alive (`process.kill(pid, 0)` throws `ESRCH`; `EPERM` counts as alive) or the lock is older than 24 h.
  `--interval-sec` 5–600.
- **D9 Threads.** A case with `replyTo` is sent only after its parent has a `sent` line. Headers: `In-Reply-To: <parent message_id>`,
  `References: <parent message_id>` (one level is enough for the app's `thread_key`). Subject: the case subject as written (the writer writes `Re: …`).
  A parent that is `failed` or `changed` → the child is `blocked` (reported, not sent).
- **D10 Deliver.** Runs in `testmail-target` with the mailbox's IMAP login (decrypted inside the VPS container only). Input: the sent list (message ids, sender
  address, sent times). The sender must end with `@agentmail.to` and differ from the mailbox address. For each wanted id: the DB already has an `emails` row →
  `synced` (S3 may have moved it to `AI/*` later, so the tool never looks there). A sort-folder copy of a `synced` mail is deleted only when an INBOX copy is also
  found (a crash leftover); a sort-folder copy without an INBOX copy is left alone, because it can be the only copy (moved back by the user or a later slice).
  Else look in INBOX and in the sort
  folders: `Oferty`, `Społeczności`, `Rachunki` (by exact name) and the folder with special use `\Junk`. Only mails whose trimmed `Message-ID` is wanted **and**
  whose `From` is the persona inbox address are touched. `--check-only` plans and reports with no IMAP change (the read-only inspect for troubleshooting). In INBOX only → `in_inbox`. In INBOX and in a sort folder → delete the
  sort-folder copy (`deleteMessage`) → `duplicate_removed`. In a sort folder only → `moveMessage(folder, uid, INBOX)` → `moved` (Interia: COPY + EXPUNGE, new UID
  above the cursor). Nowhere → `not_found`. A crash between COPY and EXPUNGE leaves two copies; the next run removes the sort-folder copy. Output: one JSON line per
  case with the folder key (`inbox`, `offers`, `social`, `bills`, `junk`), never a folder path from the server.
- **D11 Compare.** Input: the sent list. Per case: `not_sent`, `not_synced` (no `emails` row), `not_triaged` (row, no `triage_results`), or `triaged` (latest result:
  category, confidence, reason code, model). The report has a per-case table (case id, persona, expected, triage category, confidence, reason code, `ok`/`WRONG`)
  and a `thread` column for cases with `replyTo` (`ok` when the stored mail has `in_reply_to`, else `MISSING`), and the eval report of `buildRealReport` +
  `renderEvalReport` with the expected category as the truth. Rows that are not `triaged` are left out of the metrics
  and counted in the header. Cases with `borderline:` count in the metrics and are marked in the table. The report uses `mail: "synthetic"` (made-up content),
  so it never reads as real-label evidence for the S3 gate. Under the table: the prompt versions of the results (`triage_results.prompt_version`). A triage
  category outside the 5 classifier categories (`delegation`, `unsure`) counts as `WRONG`.
- **D12 Exit codes.** `validate`: 0 valid, 1 invalid. `send`: 0 every case sent; 1 error, guard refusal, or a case that needs an agent fix (`failed`, `changed`,
  `blocked`, duplicate found); 2 stopped early with nothing to fix (cap, limit, 429 or network retries used up, waiting children) — run the same command later. `deliver`: 0 every sent case is `synced`, `in_inbox`, `moved` or `duplicate_removed`; 2 some `not_found`; 1 error. `compare`: 0 every
  sent case is `triaged`, 2 some not yet, 1 error. `remote`: the exit code of the remote command (or 1 when SSH or the build fails).
- **D13 Config.** New keys in `.env.example`: `AGENTMAIL_API_KEY` (secret), `AGENTMAIL_BASE_URL` (default `https://api.agentmail.to/v0`; tests set a local fake).
  They are read by `loadTestmailConfig()` in `platform/config.ts` (own Zod schema), not by `loadConfig()`: the server does not need them and must not fail without them.
- **D14 Mail kind.** AgentMail mail is not synthetic for `mailKindFilter` and the scope gates (its `Message-ID` is the SES id, D4). On the VPS `TRIAGE_LLM_SCOPE=all`
  triages it, and `ACTIONS_SCOPE=all` / `SEND_SCOPE=all` act on it like on real mail (moves into `AI/*`, drafts, approval prompts; corrected 2026-11-08: the
  plan first said `ACTIONS_SCOPE=synthetic`). Agents never tap approve for a test mail. The user's own Telegram feedback on such mail lands in `triage_feedback` like real labels. This plan
  does not change that; a follow-up task `tasks/planned/testmail-mail-kind.md` (stage 8) proposes a sender-based mail kind.
- **D15 Module layout.** Pure logic: `packages/core/src/testmail/` (batch, send log, send plan, delivery plan, compare rows), exported from `@ea/core`.
  AgentMail client and send service: new module `apps/server/src/modules/testmail/` (`index.ts`, `agentmail/client.ts`, `agentmail/fake.ts`, `send.ts`, `lock.ts`,
  `log-file.ts`, `paths.ts`, `target.ts` (stage 4); `remote.ts`, `bundle.ts` (stage 7)).
  Deliver: `mail` module (`tools.ts` `deliverTestMail`, `repo.ts` `listEmailsByMessageIds`), because only `mail/imap/` may use IMAP. Compare: `triage` repo
  `listLatestTriageByEmailIds`; the script composes `mail` and `triage` (like `eval.ts`). Scripts: `apps/server/src/scripts/testmail.ts`,
  `testmail-target.ts`, `testmail-remote.ts`. No module imports `testmail` except the scripts.
- **D16 Writer and checker procedure** (runbook, stage 8). The writer subagent (Sonnet; file tools only, no `bash`) gets the persona file, the target mix, the
  schema and the data rule, and writes the batch without `blind`; the main session runs `validate`. The classifier sees one shared sender address and no display
  name, so the writer must make the sender clear in the body or signature. `testmail blind --batch <id>` prints the cases without `expected`, `blind`, `note`,
  display name and group, with `from` = the bare inbox address (what the classifier sees). The checker subagent (Haiku; `tools: ls` only, so it cannot read the
  batch file; the blind JSON is in its task text) answers with `[{id, category}]`. `testmail blind --batch <id> --apply <file>` writes `blind`. Then the main session fixes each disagreement (D7) and runs `validate`.
  The batch is committed before its first send, so the sent text is in git history.

### Edge cases (decided; each has a test in its stage)

- States of a case: `due` → `intent` → `sent` | `failed`; `intent` → (crash) → resend same key | label lookup → `sent` | new attempt; any open intent with another
  hash → `changed`; child of a not-sent parent → `waiting`; child of a `failed`/`changed` parent → `blocked`. After `sent`: deliver → `moved` | `in_inbox` |
  `duplicate_removed` | `synced` | `not_found`; compare → `not_synced` | `not_triaged` | `triaged`.
- Before the first run: no send log → every case `due`; no lock → create; the runs folder (`~/.local/state/ea-testmail/`, D6) is created on first use (mode 0700).
- Crash between the AgentMail call and the `sent` line: D3. Crash between COPY and EXPUNGE: D10.
- Two runs at once: `send` lock (D8). Two `deliver` runs: the second gets `MailNotFoundError` from `moveMessage` → that case reports `not_found` this run and is
  `synced`/`in_inbox` next run. `compare` is read-only.
- 429: wait `Retry-After` seconds (default 1, max 60) × 2^n, at most 3 retries per request, then stop the run with exit 2. 5xx, timeout (30 s), network error on
  send: retry the same request with the same key, at most 3 times (safe by D3); still failing → stop, exit 2 (the `intent` stays; the next run resolves it).
  400 → `failed` line with code `http_400`, go on. 403 → `failed` with `http_403`; two 403 in a row → stop, exit 1. 401 → stop, exit 1 (`AgentMail key rejected`).
- Clocks: `now` and `sleep` are injected; tests use fixed dates. The daily window is a rolling 24 h. Times in the send log are ISO UTC.
- Secrets and private data: the API key only in the `Authorization` header; never in a log line, error text, send log, bundle or test output. Errors from AgentMail
  are logged as `status`, `name` and `code` only (the `message` can echo input). The IMAP password stays inside the VPS container. No subject, body or address in
  a log line (log case ids, counts, codes, folder keys).

### Rules for every step (read before each step)

- Code rules: `docs/code-patterns.md` and `CLAUDE.md` (template literals, `const`/`let`, `log` util with a module prefix, no `console.log`, typed errors,
  `describeError`). `packages/core` has no I/O and no `process.env` (hashing goes in the server module). Modules import each other only through `index.ts`.
  Every new repository function takes a `TenantContext` and filters by `org_id`; a test checks the filter with a second organization.
- **Only the test tools may change the test mailbox.** `deliverTestMail` must refuse before any IMAP connection unless the mailbox address equals
  `TEST_MAILBOX_ADDRESS`, and must touch only mails whose `Message-ID` is in the input list and whose `From` is the persona inbox address.
- **Sending to people:** the only recipient is `TEST_MAILBOX_ADDRESS`, pinned in `evals/testmail/target.json` (D2). No test sends a real mail: tests use the
  AgentMail fake (`modules/testmail/agentmail/fake.ts`) through `AGENTMAIL_BASE_URL`. Only stage 9 calls the real AgentMail API.
- **Test safety:** `bun test` loads the repo `.env`, which holds the real `AGENTMAIL_API_KEY`. No test calls `loadTestmailConfig()` without an explicit env object.
  A test that spawns a CLI that loads the AgentMail config (`testmail.ts`) sets `cwd` to a new temp folder (Bun reads `.env` only from the cwd) and passes the fake's
  `AGENTMAIL_BASE_URL`. A test that spawns `testmail-target.ts` may use the repo root as `cwd` (it needs the DB keys; it never reads AgentMail keys) and sets every key
  it wants unset to `""` (Bun does not overwrite a key that exists, even when empty). A test that could reach `api.agentmail.to` or `home_vm` is a review FAIL.
- **Real systems:** only stage 9 contacts the real AgentMail account, the VPS and Interia. In stages 1–8 no code path under test starts a real `ssh`/`scp` process
  or a real AgentMail call (tests inject a fake `spawn` and the fake server). Never print or edit any `.env`; a test may compare `.env` values in memory and print key names only.
- **VPS access** (P8) is an exception to the S3 rule "do not touch the VPS before stage 19" (`tasks/done/s3-assist-actions.md`): this task runs read-only SQL and one-off
  `docker compose run --rm` containers of the test tool; never `up`, `restart`, `build`, deploy, cron or `.env` changes.
- Do not commit (the main session commits each stage after the review). Never run `bun run format` or `prettier --write` outside the step's files (S2 incident).
- Checks after each step (the step names which ones):
  - `bun run lint && bun run typecheck && bun run test:unit`
  - with DB and GreenMail: `bun run dev:up && bun run db:migrate && bun run test:int`
  - Markdown and JSON files of the step: `bunx prettier --check <files>`.
- Integration tests: `withRollback` and `testDb` from `apps/server/test/integration/helpers.ts`; fixtures from `fixtures.ts` (`createOrgWithMailbox`, `insertTestEmail`,
  `insertTriaged`). Fake mail: `createFakeMailProvider` (`mail/fake`); the COPY path uses `capabilities: { move: false, uidplus: true }`.
- Times in tests: fixed `Date` values; never `new Date()` in an assertion.
- **Worktree** (Git mode: worktree, `tasks/README.md` § "Git mode"). Build in `../email_assistant-wt/test-mail-traffic` on branch `task/test-mail-traffic`
  (from `origin/master`); every subagent call gets that folder as `cwd`; never edit, commit or run checks in the main checkout (other sessions work there).
  Copy `.env` from the main checkout (never commit it), run `bun install`, and use an own database: `bun run db:worktree test-mail-traffic`, then put its two
  printed env lines into the worktree `.env`; drop it with `--drop` when the task ends. GreenMail and the ports stay shared: before `bun run test:int` or
  `db:migrate`, check that no other checkout runs them (`pgrep -af "bun test apps/server/test|dbmate"`); if one runs, wait.
  Stage and commit only this task's files, by explicit path. Push with `git push -u origin task/test-mail-traffic`; to get new `master` work, `git merge origin/master`
  in the branch (never rebase a pushed branch). Every `git fetch`/`git push` on this PC: `GIT_SSH_COMMAND="ssh -i $HOME/.ssh/github -o IdentitiesOnly=yes" git …`
  (Facts checked).

### User checkpoints

1. Before stage 9 (the first real send): the group reviews of stages 1–5 and 6–8 (Opus, high) must give PASS. Then merge the branch into `master` (`tasks/README.md`
   § "Git mode" step 3: `git merge origin/master` in the branch, checks pass, `git merge --no-ff task/test-mail-traffic` on `master` in the main checkout, push),
   because `testmail:remote` bundles from `origin/master` only (D1). Stage 9 then runs in the worktree after `git merge origin/master`. The main session gives the
   user a 4-line summary.
   Default: stage 9 starts without waiting (P8: the user lets the agent work alone); the user may say "stop" at plan approval to make this a hard stop.
   **Changed 2026-11-08:** stage 9 waits for the user's answer to Q1 ("Open question for the user").
2. After stage 9: the user reads the compare report (in this file) and closes the task.

### Defaults in force (the user approved the plan on 2026-11-08 without changes to them)

1. Stage 9 starts after the group reviews give PASS, without a stop for the user (checkpoint 1), and after the user answers Q1 (added 2026-11-08).
2. (Replaced 2026-11-08: the build runs in its own worktree, so it does not wait for other sessions; rule "Worktree".)
3. Every test mail shows in the Telegram digest, and `urgent` ones send an urgent notice (about 5 per 25-mail batch).
4. The user's Telegram feedback on test mail counts as real labels in `triage_feedback` until `tasks/planned/testmail-mail-kind.md` lands (D14).

Stage 9 commits (CLAUDE.md "one commit only after the reviewer gives PASS"): stage 9 makes 3 commits, each after a reviewer PASS on its content:
the smoke batch file (9.1), the batch-01 file (9.2, before its send: data rule, labels, tone), and the results (report file, task file, notes; the reviewer checks
the numbers against the compare output). A batch file is data, not code, so its review is short (Sonnet, high).

User steps: none. The API key is in `.env` already; `TEST_MAILBOX_ADDRESS` goes on the command line.

### Open question for the user (2026-11-08, before stage 9)

- **Q1 Live product actions on test mail.** The defaults (above) cover the digest, the urgent notices and the feedback. They do not cover what S4 does now on
  the VPS (`ACTIONS_SCOPE=all`, `SEND_SCOPE=all`, mode `assist`): moves of test mail into `AI/*`, drafts in the Interia Drafts folder and approval prompts in
  Telegram for `needs_reply`/`delegation` test mail (no send without the user's tap). The main session asks the user before the first send (stage 9.1).
  Second risk (group review 6–8): two pilot-week measurements run on the same mailbox now. `tasks/planned/s3-assist-week-result.md` (to 2026-11-14T20:00Z)
  excludes only `%@ea-seed.test>` mail, so AgentMail mail counts as real mail in "Applied by type", and a `wrong` tap on a test mail adds to N (S3 bar N ≤ 3).
  `tasks/planned/s4-pilot-week.md` part B (to 2026-11-14T22:40Z) counts drafts, approvals and sends; part A A1 expects `Approvals: 0 waiting`.
  Options: (a) start stage 9 after 2026-11-14T22:40Z (recommended: no change to other tasks); (b) run now, and add the exclusion
  `and lower(e.from_address) is distinct from 'ea-testmail-75wd@agentmail.to'` to every `emails e` join of S3 step 20.2.3 and S4 step 23.2.3, plus a note line in
  both planned files; S4 A1 runs before the first test send, or it does not count waiting approvals of test mail; the stage 9 line "Do not run this stage while
  an S3 VPS stage (19, 20) runs" then means the VPS command steps of S3 stage 20, not its whole week.

### Review model

Implementers: Sonnet, medium (agent file default). Reviews of `[risky]` stages (2, 3, 4, 5, 7, 9): Opus, high. Other stages: Sonnet, high. Group reviews (Opus, high): stages 1–5 after stage 5 (`tasks/README.md`: every 5 stages), and stages 6–8 before stage 9.

### Run mode

Run mode: normal (one stage at a time: build → review → commit → push). Not pipeline: the plan is small and the S3 build uses the same tree.

Review units (`tasks/README.md` plan shape: a `[risky]` stage has 1 step): in the `[risky]` stages 2, 3, 4, 5, 7 and 9 **each step is its own unit**
(build → review → commit → push), commit message `<area>: test-mail-traffic stage N.M — <what>`. Step 4.1 has two units: 4.1a (`paths.ts`, `lock.ts`,
`log-file.ts`, tests 15–16) and 4.1b (`send.ts`, tests 1–14 and 17). The normal stages 1, 6 and 8 stay one unit each.

### Stages

Each stage lives in its own file in [`test-mail-traffic/`](test-mail-traffic/). An implementer or reviewer reads this file (Input, Rules) and only the stage file of its step.

- [x] [Stage 1](test-mail-traffic/stage-01-core-batch-schema.md) [written] — Core: batch and persona schemas, validation, blind view
- [x] [Stage 2](test-mail-traffic/stage-02-core-send-log-and-plan.md) [written] — Core: send log and send plan [risky]
- [x] [Stage 3](test-mail-traffic/stage-03-agentmail-client.md) [written] — AgentMail client, fake server, config keys [risky]
- [x] [Stage 4](test-mail-traffic/stage-04-send-service-and-cli.md) [written] — Send service and CLI `testmail` (setup, validate, blind, send, status) [risky]
- [x] [Stage 5](test-mail-traffic/stage-05-deliver.md) [written] — Deliver: move own test mail from the Interia sort folders into INBOX [risky]
- [x] [Stage 6](test-mail-traffic/stage-06-compare-and-target-cli.md) [written] — Compare: repository, report, CLI `testmail-target`
- [x] [Stage 7](test-mail-traffic/stage-07-remote-runner.md) [written] — Remote runner `testmail:remote` (bundle, scp, ssh) [risky]
- [x] [Stage 8](test-mail-traffic/stage-08-runbook-and-docs.md) [written] — Runbook, persona file, docs, follow-up task
- [x] [Stage 9](test-mail-traffic/stage-09-first-real-batch.md) [written] — First real batch: write, blind check, send, deliver, compare [risky] — user checkpoint 1 before it

### Results

**Batch `2026-11-09-batch-01`** (25 mails, sent 2026-11-10 10:30–10:47Z; report `evals/results/testmail-2026-11-09-batch-01.md`).
`testmail:remote compare` exit 0: "triaged 25 of 25 sent; ok 24; wrong 1"; prompt `classifier-v2` (25); model `gpt-6-luna`. Blind checker agreed 25/25.

| category     | sent | ok  | precision | recall | wrong                                                |
| ------------ | ---- | --- | --------- | ------ | ---------------------------------------------------- |
| urgent       | 5    | 5   | 100 %     | 100 %  |                                                      |
| needs_reply  | 5    | 5   | 100 %     | 100 %  |                                                      |
| info         | 5    | 4   | 100 %     | 80 %   | `info-newsletter-pytanie` (borderline) → `spam` 0.98 |
| notification | 5    | 5   | 100 %     | 100 %  |                                                      |
| spam         | 5    | 5   | 83.3 %    | 100 %  |                                                      |

Both threads `ok`. Both `attack:` cases → `spam` 0.99. Every mail landed in `Oferty` and was stored by the sort-folder sync (no `deliver`).

**Smoke `2026-11-09-smoke`** (3 mails, sent 2026-11-09 16:41Z): "triaged 3 of 3 sent; ok 2; wrong 1": `anna-termin-dostawy` (expected `needs_reply`) → `delegation` 0.84
(1 delegate is active on the VPS; `compare` counts `delegation` as WRONG). The server made a draft and a send that waits for approval (not approved).

Findings:

- The classifier is very accurate on clear mail of this sender (24/25, confidence 0.95–0.99). The only errors are grey zones: a newsletter with a reader survey → `spam`
  (reason `newsletter`), and a client question → `delegation` when a delegate exists.
- The `-- Sent via AgentMail` footer and the single sender address do not seem to steer the classifier: personal mail stayed `urgent`/`needs_reply`/`info`, not `notification`.
- Confidence is high (batch-01: 0.95–0.99; smoke: one at 0.84), so this batch says little about thresholds. 30 kept rows per category need more batches (go/no-go: "too few").
- Next batch mix: more grey zones (newsletters, polite reminders, requests a delegate could take), and `delegation` as an expected category when delegates are active
  (now `compare` counts it WRONG). No prompt change in this task.

## Done-checklist

- [x] Done-when checks pass (name the command and its output in the log).
- [x] `docs/` describe what was built (code-patterns test-tool list, evals README link); related ADRs set to accepted or superseded (none expected).
- [x] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [x] Follow-up ideas are in `planned/` (`testmail-mail-kind.md`, `testmail-s4-delegate-persona.md`, `testmail-delegation-label.md`).

## Log

- 2026-11-07: Idea review in chat. The user picked AgentMail as the provider for synthetic test mail. Task file created; the plan goes to a new chat via handoff.
- 2026-11-07: User answers: AgentMail account on the Free plan; the agent proposes personas (check plus tags `inbox+tag@`); the agent session writes the mails (free, a different model family from the classifier); the agent decides labels and review.
- 2026-11-07: Plan session (plan-task skill). User: defaults for all open questions; subagents with one approval at the end; S4 delegate persona later. Live probe: 1 inbox created (`ea-testmail-75wd@agentmail.to`, the only free slot), 6 + 2 mails sent to the pilot address. Findings: SES replaces `Message-ID`; `From` override and plus tags dropped; display name by PATCH works; idempotency key works; Interia sorts the mail into `Oferty`. The user's webmail sender rule did not stick; user: the tool moves its own mail into INBOX. Task moved to `active/`.
- 2026-11-07: Plan written (9 stages, 6 `[risky]`). Cold review (Opus, high): FAIL, 3 blockers (unreviewed bundle on the VPS, send log damage → resend, free-text recipient), 12 majors, 22 minors; all fixed. Re-review (Opus, high): PASS with 13 minors, fixed. Waiting for the user's approval.
- 2026-11-07: Independent review in a separate session (Claude Code, Opus; record `test-mail-traffic/review-2026-11-07-session2.md`): 0 blockers, 4 majors (git fetch fails with the default SSH key, `[risky]` stages with 2 steps, deliver could delete the only copy of a synced mail, no push check of foreign commits), 12 minors. All fixed in the plan files, except one accepted minor. Waiting for the user's approval.
- 2026-11-07: Review session 2, live checks (read-only): the AgentMail label filter works; `status_until` is not documented and moves with activity; the `origin/master` config loads on the VPS. Moved from "Not verified" to "Facts checked".
- 2026-11-08: The user approved the plan and chose a separate worktree for the build. Plan changes for it: Git mode worktree, rule "Worktree", send logs and lock in `~/.local/state/ea-testmail/` (D6), merge into `master` at checkpoint 1 (D1 bundles from `origin/master`). Noted that S4 is now deployed on the VPS (stale facts marked). Build handoff written.
- 2026-11-08: Build started in the worktree (own DB `email_assistant_test_mail_traffic`). Stage 1 built (1.1 fix round: a typecheck error in a test), review (Sonnet, high): PASS, 3 minors not fixed (detail without match count, no subject test for the data rule, duplicate unknown ids in `applyBlindLabels`).
- 2026-11-08: Stage 2.1 built, review (Opus, high): PASS with 2 minors (partial-line rule of `parseSendLog`), both fixed.
- 2026-11-08: Stage 2.2 built, review (Opus, high): PASS with 3 minors (order-dependent test 9, two untested child branches, a redundant check), all fixed. Stage 2 done.
- 2026-11-08: Stage 3.1 built, review (Opus, high): PASS with 2 minors, fixed. Deviation accepted: a 2xx body that is not JSON (or cannot be read) is a `SoftError` (a cut body can hide a sent mail; safe by D3, same-key repeat).
- 2026-11-08: Stage 3.2 built, review (Opus, high): PASS with 1 minor + 1 question, both fixed (fake: 409 `AlreadyExistsError` for a taken username; hold comment). Open point for stage 4: `isSoftAgentMailError` treats a 409 `AlreadyExistsError` on `ensureInbox` as soft (setup calls GET first). Stage 3 done.
- 2026-11-08: Unit 4.1a (paths, lock, log file) built, review (Opus, high): PASS with 4 minors + 1 question, all fixed: lock written by temp file + hard link, real pid tests, repo root test, short-write check; main session decision: a relative `TESTMAIL_ROOT` is an error, an empty one = unset.
- 2026-11-08: Unit 4.1b (`runSend`) built, review (Opus, high): PASS with 2 minors + 1 question, all fixed (tests for 503, 400 then 403, 404, `--limit` with a failed case and with a recover; 401 → `auth` on every call). Step 4.1 done.
- 2026-11-08: Step 4.2 (CLI `testmail`, `target.json`, scripts) built, review (Opus, high): PASS with 2 minors + 2 questions, all fixed (dry-run cap from all logs, hash comment, `AgentMailError` message printed, no-log and no-key test asserts). `test:int`: 847 pass. Stage 4 done.
- 2026-11-08: Step 5.1 (`planDelivery`, `listEmailsByMessageIds`) built, review (Opus, high): PASS with 2 minors + 1 question, fixed (one trimmed id for both lookups, row type). Decision: callers pass unique message ids; 5.2 drops duplicates before the plan.
- 2026-11-08: Step 5.2 (`deliverTestMail`) built, review (Opus, high): PASS with 5 minors; fixed: UID fetch in chunks of 100, refuse an invalid `sentAt` or an empty id, module comment. Left as is: the `probe refused` text (accepted minor 11), no test for a delete that returns false. Decisions: a later case with a duplicate message id is `not_found` with no ops; a failed move skips the deletes of its case. Stage 5 done.
- 2026-11-08: Group review of stages 1–5 (Opus, high; `1a0f079..705264a`): PASS, 2 minors, fixed: `send` uses the pinned `testAddress` as the recipient (env letter case no longer changes the request hash); stage 7 `RemoteDeps.root` → `paths: TestmailPaths` (a root would move the real logs and lock into the checkout, D6).
- 2026-11-08: Stage 6 (compare rows, `listLatestTriageByEmailIds`, CLI `testmail-target`) built, review (Sonnet, high): PASS with 3 minors, fixed (test user clean-up, a `delegation`/`unsure` test, `messageId` and `sentAt` both set or both null). Stage 6 done.
- 2026-11-08: Step 7.1 (`remote.ts`: command string, bundle check, deliver output parsing) built, review (Opus, high): PASS with 3 minors + 1 question; fixed: one template literal, result/folder pairs checked (`synced` needs folder `db`, `in_inbox` needs `inbox`), `--bar`/`--min-kept` only with compare and `bar > 0`. For 7.2: check each `delivered` line with `sendLogLineSchema` before the append.
- 2026-11-08: Step 7.2 (CLI `testmail:remote`, `bundle.ts`) built, review (Opus, high): PASS with 7 minors + 2 questions; fixed: `lstat` in the cache clean-up, clean-up test, unknown-case lines count as bad, a reused bundle worktree must be clean at the sha, `log.warn`, bundle size check, refusal test, `refs/remotes/origin/master`. Accepted deviations: no `delivered` append when any remote line is bad (exit 1); `--dry-run`/`--print-input` take no lock. Known gap for the runbook: after an ssh 255 the bundle stays in VPS `/tmp` (code only). Stage 7 done.
- 2026-11-08: Stage 8 (persona file, runbook `evals/testmail/README.md`, `tasks/planned/testmail-mail-kind.md`, doc lines) built; main session wrote the pi agents `testmail-writer` and `testmail-checker` (`~/.pi/agent/agents/`); checker dry call (2 cases) → `[{"id":"dry-1","category":"notification"},{"id":"dry-2","category":"needs_reply"}]`. Review (Sonnet, high): FAIL (2 majors: writer field list and rules, exit-code table), fixed; re-review PASS with 2 minors, fixed by the main session (schema limits line, `testmail:target` exit 2 text). Stage 8 done.
- 2026-11-08: Group review of stages 6–8 (Opus, high; `1f4abca..2e5776f`): FAIL, 1 major: the plan said `ACTIONS_SCOPE=synthetic` on the VPS; the VPS has `ACTIONS_SCOPE=all`, `SEND_SCOPE=all` (main session, read-only `grep -c`: 1, 1). Fixed: D14 and the facts corrected, Q1 for the user, a stage 9.1 scope check; code minors fixed (`--out` only on exit 0/2, strict result/folder pairs, cross-stage test, shared `readJsonFile` and `deliveryResults`, one report name). Re-review 1: FAIL, 1 major (the S3 and S4 pilot weeks to 2026-11-14 count test mail), added to Q1 with options (a)/(b). Re-review 2: PASS, 3 minors on option (b), fixed. `test:int`: 885 pass.
- 2026-11-08: Checkpoint 1: `git merge origin/master` in the branch (`d3993c4`; lint, typecheck, `test:unit` 1274 pass, `test:int` 885 pass), then `git merge --no-ff` into `master` in a temporary detached worktree (the main checkout stayed untouched) and pushed: `master` = `9171a79`. Stage 9 waits for the user's answer to Q1.
- 2026-11-08: **User answer to Q1:** "Run it now." = option (b). Exclusion notes added to `tasks/planned/s3-assist-week-result.md` and `tasks/planned/s4-pilot-week.md` (test-mail filter in the week queries, A1, never approve a test-mail send). Stage 9 starts.
- 2026-11-08: Stage 9.1 started. Preconditions OK (scopes as corrected, migrations, 1 delegate); setup `active`; smoke batch `2026-11-08-smoke` (3 mails) sent, exit 0; live `listByLabel` count 1. **Stopped at step 5:** Interia sorts a `UID COPY` into INBOX back into `Oferty` (deliver said `moved 3`; the mails are still in `Oferty` with new UIDs; nothing synced). An `APPEND` of the raw mail into INBOX stays, syncs and triages (probe, 1 mail). Facts: notes §10. Fix needs a deliver change (APPEND + delete) and a raw-read method: question Q2 to the user.
- 2026-11-08: **User answer to Q2:** "go with option 3": the app syncs `Oferty` and the other Interia sort folders (a product change). New task `tasks/planned/sync-sort-folders.md`. This task is blocked until it is deployed; stage 9 then resumes at step 9.1.6 (wait for the sync, compare). State: `anna-termin-dostawy` is in INBOX (synced, triaged `needs_reply`) and in `Oferty` (uid 38960); `piotr-re-termin` and `faktura-wystawiona` are only in `Oferty`.
- 2026-11-09: Resumed (user: the sort-folder sync is deployed; verify both with test mail). Worktree merged `origin/master` `091bcb5` (lint, typecheck, `test:unit` 1361 pass). VPS read-only: `0d39663`, migration `20261109083501`, 5 `mailbox_folders` rows enabled, scopes all 1/1/1, 1 delegate, disk 93 % (1.8 GB free). Pilot-week exclusion lines present (2 each). Setup: `active`, `status_until 2026-12-08T07:58:17Z`. Smoke batch `2026-11-09-smoke` (same reviewed content, new id) sent 16:41:31Z, exit 0. Batch-01 written (25 cases, 10 personas, 2 threads, 3 borderline, 2 attack), valid without labels. Handoff to a new session.
- 2026-11-09 21:00Z: New session (handoff `~/.pi/agent/notes/2026-11-09-handoff-testmail-and-sort-folders-finish.md`). VPS read-only: `0d39663`, `max(version)` `20261109083501`, 5 folder rows enabled (`inbox` 38996, `offers` 38993), disk 93 %. Smoke `2026-11-09-smoke`: all 3 landed in `Oferty` (`source_folder`); `testmail:remote compare --batch 2026-11-09-smoke` exit 0, "triaged 3 of 3 sent; ok 2; wrong 1", prompt `classifier-v2`, model `gpt-6-luna`. `anna-termin-dostawy` → `delegation` 0.84 (WRONG): `create_draft` applied + `send` `awaiting_approval` (16:45:19Z; do not approve). `piotr-re-termin` `needs_reply`, thread ok, no action. `faktura-wystawiona` `notification`: `mark_read` + move `ai_notifications` applied 16:45:30Z (first applied move on a sort-folder mail). Re-sort watch at +4 h 13 min: `email.returned` 0, `imap_move` feedback 0.
- 2026-11-10: User: "you can obviously send much more mails" (yes to batch-01). Batch-01: blind check (claude-haiku-5-5) agree 25/25; main-session read replaced 2 brand names (re-check agree 2); `testmail:validate` valid; reviewer (Sonnet, high) PASS (1 question, 3 minors: 1 note fixed; "Monday" weekday and 3 phishing cases accepted). Committed `b0cdeab`, pushed. `testmail:send --limit 10 --interval-sec 45` × 3 (exit 2, 2, 0), 25 sent 10:30–10:47Z. VPS read-only 10:57Z: 25 rows, all `source_folder` `Oferty`. `testmail:remote compare --batch 2026-11-09-batch-01 --out …` exit 0, "triaged 25 of 25 sent; ok 24; wrong 1" (§ Results). Runbook: `deliver` removed from the procedure (only `--check-only` as a read-only look); done-when 2 reworded (no `deliver`). Follow-up `tasks/planned/testmail-delegation-label.md`.
  Done-when evidence: (1) `testmail:send` sent 25 once each (`testmail:status` "sent 25"); without `TEST_MAILBOX_ADDRESS`: "[testmail] TEST_MAILBOX_ADDRESS is not set: send refused", exit 1. (2) 25 of 25 stored and triaged (SQL count 25; compare "triaged 25 of 25"). (3) compare report with precision, recall, go/no-go: `evals/results/testmail-2026-11-09-batch-01.md`. (4) 25 mails, 5 categories, 10 personas, 2 threads, ran end to end (§ Results). (5) grep of the 3 send logs and the report for the API key, 4 subject phrases and `interia.pl`: 0 hits each. (6) runbook `evals/testmail/README.md` updated; this session ran batch-01 from it.
- 2026-11-10: The resume words of the user (2026-11-09, copied from the handoff `~/.pi/agent/notes/2026-11-09-handoff-testmail-and-sort-folders-finish.md`): "Okay, I implemented new feature to get all the emails from the inbox. So right now you can proceed with this task and finish it. … I suppose that you can test both things at once. And there will be possibility to close both tickets at once." Results review (Opus, high): PASS, 7 minors (fixed: quote, `status_until`, status line, goal item 5, runbook table row, confidence wording; links fixed at the move), 2 questions (results note: written on `master`; S4 delegate persona: `tasks/planned/testmail-s4-delegate-persona.md`).
- 2026-11-10: User checkpoint 2: the user read the summary and said "both tickets are fully working and we can close them both" (close of this task). Done-checklist: done-when evidence in the Log line above; docs: `docs/code-patterns.md:39` lists `testmail-target deliver`, `evals/README.md:14` links the runbook; notes §10–11 and `notes/2026-11-09-sort-folders-live-test-results.md`; no new alert; 3 follow-ups in `planned/`. Merged `a72210b`. Task moved to `tasks/done/`; links fixed (not in `tasks/done/sync-sort-folders*`: its stage 17 step 6 fixes them). Clean-up: worktree DB dropped, worktree and branch `task/test-mail-traffic` removed.
