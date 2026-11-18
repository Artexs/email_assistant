# F110 scout packets

Four scouts ran before this planner job (base 53dd39b2; plan base 9341d9f0). Each packet is copied whole from the job log, then the job's final note check (`result`).

## Scout 1 · `2026-11-15-f110-scout-1-f5ed38fb`

**Question:** Where do IMAP flags (\Seen, \Answered, \Flagged) and the List-Unsubscribe, List-Unsubscribe-Post, List-Id and Authentication-Results headers get captured and stored (F100 E3a flag store and header capture), which tables and columns hold them, and which readers exist? Also: how does the backfill (scripts/mailbox-backfill.ts) run, can it run from the server at connect, and how does the classifier get called on a sample (cost cap, LLM budget)? Context: spec/features/planned/F110-e4-b-earn-trust/ticket.md. Answer for the code at HEAD.

### Packet

Packet: Where flags and the four headers are captured and stored, their readers, how the backfill runs, and how the classifier is called with caps.
Base: 53dd39b2
Verified: `git status --short | wc -l` -> `0`. The other findings come from file reads, not from running the code.
Unknowns:
- `List-Unsubscribe-Post` is **not captured** at HEAD. `grep -in "post" capture.ts` finds only a doc comment, and `email_headers` has no such column. (observed)
- No server-side or connect-time backfill path exists. I did not check whether the web panel connect route triggers one. I read `connect.ts` and found no backfill call. (observed for `connect.ts`)
- No function classifies a stored sample. Only the per-mail triage path and the eval harness call `classifyEmail`. (observed)

1. Flags (`\Seen`, `\Answered`, `\Flagged`)
   - Capture: `apps/server/src/modules/mail/flags.ts:49` `refreshFlags`. The `mail.sync` job calls it at `mail/jobs.ts:98`, at most every `FLAGS_REFRESH_EVERY_MS` (10 min) per mailbox. It uses the mail from the last 30 days, up to 3000 per run, in chunks of 500.
   - Store: table `email_flags`. Columns: `seen`, `answered`, `flagged`, `first_seen_at`, `first_answered_at`, `first_flagged_at`, `checked_at`, `answered_check`, `answered_check_at`, `answered_check_by`. See `platform/db/schema.ts:208`. Writes are in `mail/repo/flags.ts:57` `writeEmailFlags`, an upsert that keeps the first-set `first_*` timestamps.
   - Readers: `getEmailFlags` (`repo/flags.ts:158`), used only by `triage/answered-check.ts:108`. `listFlagTargets` is the refresh queue. — observed
2. Headers
   - Capture: `mail/imap/capture.ts` `captureFromParsed` (~line 140). It takes `authResults`, `listUnsubscribe` and `listId` from the topmost header line. Limits are in `mail/port.ts:68-70`: 1000, 1000 and 300 characters.
   - Store: table `email_headers`. Columns: `auth_results`, `list_unsubscribe`, `list_id` (also `return_path`, `reply_to`, `auto_submitted`, `precedence`, `links`, `parts_known` and others). See `schema.ts:222`. `insertEmailHeaders` is at `repo/headers.ts:25`. The migration is `db/migrations/20261114120001_measure_capture.sql`.
   - Readers: `getEmailHeaders` (`repo/headers.ts:52`). `triage/suspicious-context.ts:125-134` uses it for `authResults` and `isList`, which is `listId` or `listUnsubscribe` set. `mail/tools.ts:181-238` counts signals per authserv-id for a tool. Privacy maps are in `privacy/address-map.ts`.
   - Mail stored before capture existed has no row and is never captured later (`docs/capabilities/sync.md`, item 18). — observed
3. Backfill
   - Command: `bun run mailbox:backfill --org-id <uuid> --mailbox-id <uuid> [--days 1-180]` (default 30). It is a one-off CLI: `scripts/mailbox-backfill.ts` calls `backfillMailbox` (`mail/tools.ts:258`), which calls `backfillInbox` (`mail/sync.ts:760`). It then calls `requeueBackfillWindow`.
   - Refusals: a window over 180 days, a mailbox never synced, a UIDVALIDITY change, and a suspended organization (`scripts/mailbox-backfill-gate.ts`).
   - The backfill stores missing INBOX mail with `backfilled_at` set and a header row. It does not move the cursor and does not backfill flags. Flags come later from `refreshFlags`.
   - The only callers of `backfillMailbox` are the CLI script and tests. The server does not call it at connect. `backfillMailbox` is exported from `mail/index.ts:193`, so the server could call it. — observed
4. Classifier on a sample, cost cap and LLM budget
   - `triage/classifier.ts:57` `classifyEmail(llm, {email, sender, allowed, delegates, model?, extras?, prompt?})` makes one LLM call per mail and returns `{analysis, usage, promptVersion}`.
   - Production path: `triage/service.ts:521`, run by `triage/jobs.ts`. A per-mailbox daily cap applies: `LLM_DAILY_CAP`, default 300 calls per day (`platform/config.ts:15,141`). Over the cap, the mail waits and the job logs a warning (`triage/jobs.ts:152-165`).
   - Eval path: `triage/eval.ts:384` `classifyWithRetry` runs over cases and takes a `--limit`. The spend caps are `RUN_CAP_USD = 1` per run and `MONTH_CAP_USD = 20` per month, in `platform/eval-ledger.ts:15-16`. The default is `budgetUsd: RUN_CAP_USD` (`scripts/eval-args.ts:195-233`, `--budget-usd` overrides it). `scripts/llm-check.ts` also calls `classifyEmail`.
   - There is no cost cap for classifying stored real mail outside the daily call cap. — observed
5. Docs that describe these paths: `docs/capabilities/sync.md` items 15 and 18; `docs/decisions/0028-autonomy-evidence-without-user-labels.md` is the likely ADR for flag evidence. — guessed

Checks: `test/integration/mail-flags.test.ts`, `mail-flags-repo.test.ts`, `mail-sync-capture.test.ts` and `mailbox-backfill-cli.test.ts` exist and target these paths; I did not run them. Nothing tests `List-Unsubscribe-Post`, a server-side backfill, or a cost-capped classification of a sample.

### Note check (result)

## Note check
- Flags and the four headers: where they are captured and stored, tables, columns, readers: not proven. I read the files in bash calls that used `;` and `|`, so no qualifying command exists. The `file:line` reads are in the packet. `List-Unsubscribe-Post` is not captured at HEAD, so that part of the question has no capture to name.
- Backfill: how it runs, and whether the server runs it at connect: not proven. The reads used `;`-joined calls. The finding is that only the CLI and tests call `backfillMailbox`, and no connect-time call exists. I did not check whether the web panel connect route triggers a backfill.
- Classifier on a sample, cost cap and LLM budget: not proven. The reads used `;`-joined calls. The finding is that no sample-classification function exists. The caps are `LLM_DAILY_CAP` (default 300 per mailbox per day) for triage, and `RUN_CAP_USD = 1` and `MONTH_CAP_USD = 20` for the eval.

Easy-to-miss rule ("Read, search, and run existing checks. Do not edit, create, or delete files."): not proven. My only check was `git status --short | wc -l`, which printed `0`. That command pipes, so it does not count. I wrote `note.md` outside the worktree, as the Limen instruction asked. I did not rerun a check to clear this.

Not proven yet: all three end checks and the rule.

## Scout 2 · `2026-11-15-f110-scout-2-113e8970`

**Question:** How is per-category autonomy (shadow/auto mode) decided and set today: triage/gate.ts, the real-label gate, CategoriesCard, the 'set anyway' audit rows, the global holdout gate file from F097 (E2a) and its reader, the F100 stats route the autonomy card reads, and docs/capabilities/triage.md rule 16 (gate must match model AND endpoint; re-gate auto on a model or endpoint switch, F111 endpoint kinds in spec/features/active/F111-e11b-private-model-option/plan.md). What exists at HEAD, what F111 stages will add, and where a tripwire that pauses auto per category would hook (corrections, Undo, moved-back mail events)? Context: spec/features/planned/F110-e4-b-earn-trust/ticket.md. Answer for the code at HEAD.

### Packet

Packet: How per-category autonomy is decided and set at HEAD, what F111 adds, and where an auto-pausing tripwire would hook.
Base: 53dd39b2
Verified: `grep -n "gateFileSchema\|results/gate"` over apps/packages (non-test) -> `apps/server/src/scripts/eval.ts:78: const sim = gateFileSchema.safeParse(...)`. Only the eval scripts parse the gate file. I ran no tests.
Unknowns:
- No autonomy card exists at HEAD. `grep -ril autonomy apps/web/src` found no component. The web stats page (`StatsPage.tsx`, `StatsTable.tsx`) reads `GET /stats`, so the F100 stats route has no autonomy reader yet (observed).
- Nothing at runtime reads the F097 gate file. Only `scripts/eval.ts:78` (`--gap`), `scripts/eval-sim.ts:48` (writer) and `gate-evidence.test.ts:9` touch it (observed).
- I did not open the `stats-view.ts` consumers, the stage 02 code, or the stage 05–07 files.

1. `apps/server/src/modules/triage/gate.ts:goNoGoFor` and `setCategoryAutoWithGate` — Turning `auto` on reads the mailbox's real-label report (`GATE_BAR` 0.98, `GATE_MIN_KEPT` 30, `mail: "real"`). A non-"go" result is refused (`kind: "refused"`) unless `force`. Turning `auto` off skips the gate. The gate reads no model, endpoint or gate file — observed.
2. `apps/server/src/modules/config/service.ts:226-265` (`setCategoryAuto`) — It writes `categoryPolicy[category] = {auto, threshold}` and the audit event `mailboxPolicyChanged` with `field: auto.<cat>`, `from`, `to`, thresholds and `forced`. `forced` is the "set anyway" audit flag. The gate decision, precision and kept count go only into the function's input, not into the audit data. The row stores no model or endpoint — observed.
3. `apps/web/src/components/settings/CategoriesCard.tsx:35-50` and `SetAnywayDialog.tsx` — The Switch calls `PATCH /auto/<cat>`. On the `no_go` error the dialog opens, and confirm resends with `force: true`. Only the owner can toggle — observed.
4. F097 (E2a) gate file — `gateFileSchema` is in `eval-sim-report.ts:211`. It carries scenario, model, promptVersion, `provisional`, per-category rows and `bar`. It has no endpoint. The single file is `evals/results/gate/classifier-classifier-v2-gpt-6-luna-none-lab-01-v1.json`. `triage.md` rule 13 and ADR 0028 say real labels never unlock `auto` — observed.
5. Rule 16 / F111, at HEAD — The endpoint is one per server (`OPENAI_BASE_URL`), with kinds `standard`/`eu`/`own`. Per F111 plan D13, no code ties `auto` to the model. Stage 06 documents "set `auto` back to `assist` before a switch, until F110 re-gates" — observed. F111 stage 03 adds `endpoint` and `host` to the gate file, `-<endpoint>` to its file name, and `endpoint` to the `llm.call` audit row. It adds no `auto` link, so F110 must build the (model, endpoint) re-gate — observed (plan text, not code).
6. Tripwire hook points (guessed as design, from observed code):
   - The read: `triage/service.ts:200` (`autoFor(mailbox.policy, finalCategory)` feeds `decidePolicy`) is the one place where `auto` takes effect at plan time. A pause flag per category would be checked there, or the policy flipped by writing `categoryPolicy` through `setCategoryAuto` (audit and settings version come with it).
   - The Undo tap: `triage/undo.ts:undoWithFeedback` writes `recordFeedback` with `source: "undo"`, `verdict: "wrong"`. Both the Telegram callback (`channels/callbacks.ts:61`) and the web route use it.
   - Moved-back mail: `triage/returned.ts:processReturned` writes `markUndone(reason: "user_moved_back")`, the `actionUndone` audit row and `source: "imap_move"` feedback. It does this only when no reverse row exists.
   - Corrections: `recordWebFeedback` and `recordFeedback` (`source: "web"` and others) take the category from `latestTriageResult`.
   - All four write through `recordFeedback` (`feedback.ts:51`, "every feedback source writes through this function"). That is the single choke point, but it has no policy knowledge.
   - Handled-share M4 (`metrics-repo.ts:listHandledRows`, with `undone` and the correction columns) already counts undo and correction per category, and could feed a rate trigger.

Checks:
- `apps/server/test/integration/triage-gate.test.ts` covers the gate refuse and force path; it misses any model or endpoint link.
- `gate-evidence.test.ts` covers the existence and schema of gate files; it misses the link to `auto` (no runtime reader).
- No test covers pause-on-correction, because no such code exists.

### Note check (result)

Note check
- Packet names how per-category autonomy is decided and set at HEAD: not proven. I read `apps/server/src/modules/triage/gate.ts` and `apps/server/src/modules/config/service.ts`. I ran no single bash call that proves this, only read-only `grep`, `sed` and `cat` calls. I did not open the `stats-view.ts` consumers, the stage 02 code, or `triage-gate.test.ts`. The note's "Not proven yet: none" was too strong.
- Packet states what F111 adds and where a per-category auto tripwire hooks: not proven. I read the F111 `plan.md` and `stage-03-endpoint-cost-and-gate.md`, and `undo.ts`, `returned.ts` and `triage/service.ts:200`. The tripwire hook points are my design guess; no code or test runs them. I did not read stages 05–07 in full. I ran no command that exited 0 under the proof rule.

Easy-to-miss rule ("Answer for the code at HEAD"): not proven. I cited lines read at base 53dd39b2. I ran no command that confirms that every finding still holds at HEAD. F111 stage 03 content comes from plan text, not code, and the packet labels it that way.

Gap: I recorded "Not proven yet: none" in the note before I had proof under this rule. It should list both end checks and the rule as not proven.

## Scout 3 · `2026-11-15-f110-scout-3-00c9ab73`

**Question:** How do notices and the digest reach the user at HEAD: the channel port (channels/port.ts), notices as facts (F088), the digest renderer and its why/confidence lines (core/digest/digest.ts, would-do.ts), fixed quiet hours (core/digest/local-time.ts), the Telegram consent step and its version (F098; consent bump rule in docs/owner-decisions.md 2026-11-15), user language, and the mail port appendMessage (mail/port.ts) with own-mail skip (X-EA-Action-Id). Also which F102 (spec/features/active/F102-e4-a-act-from-the-panel) stages define the command contract (OpenAPI route check, hono-openapi) and the approvals API, and which of them have landed. Context: spec/features/planned/F110-e4-b-earn-trust/ticket.md. Answer for the code at HEAD.

### Packet

Packet: How notices and the digest reach the user at HEAD, and which F102 stages define the command contract and approvals API
Base: 53dd39b2
Verified: `git log --oneline | grep "F102 s"` -> `787479dc F102 s09: card sync (onDecided wired, cardEditHooks, ...)`. No `F102 s10` or `s11` commit exists (`grep -c "F102 s1[0-9]"` printed 0).
Unknowns: I did not read the F088 notice code in full. I did not find why/confidence lines in `would-do.ts` or `digest.ts` (`grep -i "why\|confidence"` returned nothing in `would-do.ts`; the `digest.ts` grep also showed no match). Those lines are not at HEAD, which is likely what F110 adds (guessed). I did not run the user-language path beyond the types. I did not check where `apps/server` reads `LinkedChat.locale`.

1. `apps/server/src/modules/channels/port.ts:19-47` — `ChatChannel` has `send` and `edit` only. `LinkedChat` carries `locale: UserLocale` (`packages/core/src/tenancy.ts:12`). `CommandName` is help/digest/status/pause/resume/review. `UpdateHandlers.callback` returns `CallbackResult` with `answer`, `edit?` and `send?`. Messages are the channel-neutral `OutMessage`. — observed
2. `packages/core/src/digest/notices.ts` (urgent notice, `renderUrgentNotice`, `suspiciousLine`, `feedbackButtons`) and `digest.ts:209` (`renderDigest(input, texts: CoreTexts)`, `DIGEST_MAX_LINES = 15`) — both renderers take `CoreTexts`, so user language comes from `packages/core/src/texts/*` keyed by `UserLocale`. `would-do.ts` has `describeAction` and `describeActions`. — observed
3. `packages/core/src/digest/local-time.ts:20` — `QUIET_HOURS = { start: "22:00", end: "07:00" }` is a fixed constant, not a per-user setting. — observed
4. `packages/core/src/web/telegram.ts:19` — `TELEGRAM_CONSENT_VERSION = "2026-11-14"`. `channels/routes.ts:45` returns 409 `telegram_consent_outdated` on a mismatch. Bump rule: `docs/code-patterns.md:134` and `docs/owner-decisions.md` (2026-11-15, F109 entry). Bump when a new kind of mail-derived data reaches Telegram (address, name, domain, subject, body, attachment name, link host). Do not bump for fixed phrases chosen from our own rule codes. — observed
5. Mail port and own-mail skip: `apps/server/src/modules/mail/port.ts:183` has `appendMessage(folder, raw, flags, internalDate): Promise<{ uid: number | null }>`. `mail/port.ts:59` documents the `X-EA-Action-Id` header. `actions/repo/planned.ts:10-27` `isOwnActionId` and `sentOriginOf` decide "own mail" by this header, matched to an action id of the same mailbox and org. Callers: `actions/drafts.ts:188`, `actions/send.ts:237`. — observed

F102 stages (`spec/features/active/F102-e4-a-act-from-the-panel/stages/`):
- Command contract (OpenAPI frame plus route check): stages 01–03. The route-check test is `apps/server/src/openapi-routes.test.ts`, `hono-openapi 1.6.0` is in `apps/server/package.json`. Landed: the `api-docs.ts` files exist in actions, channels, config, mail, privacy, reports, tenancy and triage. The s03 commit says "every route described or hidden". — observed
- Edited-draft payload (04), card texts (05), migration (06), `editApproval` supersede (08) and card sync (09) have landed. Axe frame (07) landed. — observed
- Approvals API: read (stage 10) and write (stage 11) have not landed. No approvals route exists in any `routes.ts` (grep returned nothing). Stages 12–20 (panel pages, delegates/delegations API, remind now, docs, VPS deploy) are not landed. — observed
- `spec/build.md:51` still lists F102 as "PLANNED ... refresh needed before stage 01", which conflicts with the git log. The board line is stale (observed).

Checks: `apps/server/src/openapi-routes.test.ts` covers "every non-hidden route is described"; I did not run it. It misses the approvals routes, because those routes do not exist yet. `git status --short` printed nothing.

### Note check (result)

Note check
- The packet answers each named topic for HEAD 53dd39b2: not proven. I read each file, but no single `&&`-only bash call covers it. One topic is wrong: the packet said s09 landed. It did not (see the next line). I did not read the F088 notice code in full. I found no why/confidence lines in `would-do.ts` or `digest.ts`.
- The F102 stage list says which stages landed: changed. The packet's "s01–s09 landed" is wrong. A later check shows `git log HEAD --grep=F102` ends at s08 (`2baa220f Merge master into F102 s08`). `787479dc` (s09) is only on branch `limen/2026-11-15-f102-s09-card-sync-telegram-card-f4acc2c7`. `git merge-base --is-ancestor 787479dc HEAD` printed nothing, so s09 is not an ancestor of HEAD. The correct state is: s01–s08 are at HEAD; s09 is on a branch, not landed; s10–s20 are not landed. The commit list in my first packet came from `git log --all`, which was my error. The note's "Seen: s01–s09" is therefore false.
- The worktree stays clean: proven. `git status --short && git log --oneline --grep="F102 s1[01]" && git log --oneline -1 --grep="F102 s09"` exited 0 with no output. That call showed no changes, no s10/s11 commit and no s09 commit at HEAD.
- Easy-to-miss rule ("Do not edit, create, or delete files. Do not commit."): followed. The worktree is clean (same call above). I only ran read commands. I wrote only the note file, outside the worktree, as Limen asked.

Corrections to the packet: the approvals API (stages 10 and 11) has not landed. The edited-draft payload (04), card texts (05), migration (06), axe frame (07) and `editApproval` supersede (08) have landed at HEAD. Card sync (09) has not landed at HEAD. The OpenAPI contract (stages 01–03) is at HEAD, and `apps/server/src/openapi-routes.test.ts` exists there. Stage 01 is in HEAD by the `is-ancestor` check. I did not check stages 02, 03, 04, 05 and 07 individually. Treat their landed state as guessed.

Remaining gap: the topic-coverage check is not proven. The F088 notices code and the user-language path in `apps/server` are unread.

## Scout 4 · `2026-11-15-f110-scout-4-05e21898`

**Question:** Four seams: (a) F109 (spec/features/active/F109-e3b-improve) suspicious-mail readers suspiciousReasonsOf and suspiciousThreadKeysOf: signatures, module, whether landed, and review-4.md N5 (bulk unsubscribe is per sender and needs a per-sender flagged-mail reader); (b) the E3b urgency-profile command and the E2a urgency data shape (PD-017, PD-061): tables, service functions, routes; (c) the outgoing HTTP host guard (no private, loopback, reserved addresses) that an unsubscribe POST could reuse; (d) F106 account data delete and export (spec/features/active/F106-e7-t3-account-data-delete-export-dsr): how a new table registers so delete and export reach it, and any check test that fails on an unregistered table. Context: spec/features/planned/F110-e4-b-earn-trust/ticket.md. Answer for the code at HEAD.

### Packet

Packet: F110 seams at HEAD: F109 suspicious readers, urgency profile, outgoing host guard, F106 table registration
Base: 53dd39b2
Verified: `git status --short | wc -l` -> 0 (the other findings are reads and greps only; I ran no tests)
Unknowns: Whether F109's later stages are finished. `spec/build.md:58` says F109 is "PLANNED" and the same file at line 24 says "ACTIVE". The suspicious-reader code is in the tree at HEAD (commit bc5e83e5, F109 stage 04). Also, I did not check which of the tests below pass.

1. (a) `apps/server/src/modules/triage/suspicious-repo.ts` — landed, exported from `triage/index.ts:57` — observed.
   - `suspiciousReasonsOf(db: Db|Transaction<DB>, ctx: TenantContext, emailIds: readonly string[]): Promise<Map<emailId, SuspiciousReason[]>>`. It reads the newest `triage_results` row per mail. A mail with no reasons is absent from the map. It ignores the `suspicious_mail` flag, so a draft block still works with the flag off.
   - `suspiciousThreadKeysOf(db, ctx, mailboxId, threadKeys): Promise<Set<string>>`. It is per thread: a thread is flagged when any mail in it has a newest result with reasons.
   - `suspicious-show.ts` has `suspiciousReasonsToShow`, which is the same map but empty while the flag is off. It is for display only.
   - `review-4.md:16` N5 is accurate: `suspiciousReasonsOf` is per mail, and the thread reader is per thread. F110 needs a new per-sender reader. Pattern: `emails.from_address_lower` joined to the newest `triage_results` row with `cardinality(suspicious_reasons) > 0`, as in `listFrequentSenders` (lines 17-45 of the same file). `emails_mailbox_sender_idx` serves that query. Do not use `lower(from_address)`, because the tenant policy blocks it.
2. (b) The urgency profile is a jsonb column `mailbox_settings.urgency_profile`, nullable, with an object check (`db/migrations/20261115120001_suspicious_urgency_sender.sql:13-15`, `platform/db/schema.ts:358`). It is not a separate table — observed.
   - Shape: `urgencyProfileSchema` and `urgencySources` in `packages/core/src/triage/urgency-profile.ts`. It is also used by `packages/core/src/sim/scenario.ts:74` and `triage/eval-case.ts:7`. PD-017 and PD-061 are at `docs/product/stage-2/decisions.md:23` and `:67`.
   - Service: `setUrgencyProfile(db, ctx, mailboxId, profile|null, by: {via:"web",userId}|{via:"cli"})` at `modules/config/service.ts:293`. It returns `{changed, stored}` and writes the audit event `auditEvents.settingsUrgencySet`. The read is `urgencyProfile` in `getSettingsView` (`service.ts:51,106`).
   - Route: `PUT /settings/:mailboxId/urgency`, owner only, body `urgencyBodySchema` (`config/routes.ts:139`, docs in `config/api-docs.ts:64`).
   - CLI: `urgency` case in `scripts/mailbox-settings.ts:65`, using `parseUrgencyFile` and `describeUrgency`.
   - Prompt use: `triage/classifier.ts`.
3. (c) The refused-address list is `isLocalAddress(ip)` in `apps/server/src/platform/net-address.ts` — observed.
   - It refuses loopback, private, CGNAT, link-local, benchmark, multicast, reserved, NAT64, 6to4, IPv4-mapped IPv6, and anything that is not an IP.
   - Also exported there: `LookupAll` and `dnsLookupAll`.
   - The DNS-resolving host check is `checkPublicHosts(hosts, lookup)` in `platform/auth-sso.ts:273`. It returns the code `discovery_private_host` for a refused address.
   - Other function: `resolveMailHost` in `mail/host-guard.ts`. It is for mail hosts. It returns one checked address and pins the connection to it, so DNS rebinding cannot change it. It throws `HostNotAllowedError`.
   - There is no generic HTTP fetch guard. An unsubscribe POST must resolve the host, check every answer with `isLocalAddress`, and connect to the checked address. It also needs a redirect rule (guessed: I did not look for one).
4. (d) A new table registers in `apps/server/src/modules/privacy/export-map.ts` (`EXPORT_MAP`) — observed.
   - Delete is `deleteOrganization` in `privacy/delete.ts:39`, which removes the organization row. Guessed: the `org_id` foreign key cascade does the rest. I did not read the cascade.
   - Export: add a key to `EXPORT_MAP`, either `byOrg(...cols)` or `secret(reason)`. If a column is not exported, list it in `excluded`.
   - Address columns: if a new column may hold a third-party address, add it to `DSR_ADDRESS_MAP` (`privacy/address-map.ts:16`) or to `NOT_PERSONAL`, in the same file.
   - Tests that fail on an unregistered table:
     - `privacy-export-map.test.ts` test 1 (every table is a key) and test 2 (columns match).
     - `privacy-dsr-match.test.ts` test 1 (every candidate column is in the map or in `NOT_PERSONAL`).
     - `account-data-delete.test.ts`: `DELETE_SEEDS` needs one seed per table with `org_id` or `user_id`. `seedOrg` throws "seed of <table> left no row" when a seed is missing.
5. Stage 06 of F106 (address-map) is built: the `privacy/` module contains `address-map.ts`, `delete.ts`, `dsr*.ts` and `export*.ts` — observed. The ticket folder still lists 12 stages.
Checks: `privacy-export-map.test.ts`, `privacy-dsr-match.test.ts` and `account-data-delete.test.ts` (all in `apps/server/test/integration/`) cover table and column registration; they miss nothing for an `org_id` table with an unlisted column, but they do not check that a new reader or route is wired into delete or export. `triage-suspicious-readers.test.ts` covers the F109 readers; it has no per-sender case. I ran none of these.

### Note check (result)

## Note check

- Seam (a), suspicious readers: proven. `apps/server/src/modules/triage/suspicious-repo.ts` (read in full) and `spec/features/active/F109-e3b-improve/review-4.md:16` (N5). The signatures, the module and the landed state come from the file and from export lines 57-58 of `triage/index.ts`. `spec/build.md` still lists F109 as both ACTIVE and PLANNED, so the build state is unresolved.
- Seam (b), urgency profile and E2a shape: proven. `apps/server/src/modules/config/service.ts` (line 293), `apps/server/src/modules/config/routes.ts` (line 139) and `db/migrations/20261115120001_suspicious_urgency_sender.sql`. The shape is in `packages/core/src/triage/urgency-profile.ts`. I saw that path only as an import and a grep hit; I did not open the file. The packet says "no table"; the data is a jsonb column.
- Seam (c), outgoing host guard: proven. `apps/server/src/platform/net-address.ts` and `apps/server/src/modules/mail/host-guard.ts`. The check function in `platform/auth-sso.ts` (line 273) comes from grep output. The redirect handling for an unsubscribe POST is guessed, not checked.
- Seam (d), F106 table registration: proven. `apps/server/src/modules/privacy/export-map.ts` and `apps/server/src/modules/privacy/address-map.ts` (first 60 lines). The tests are in `apps/server/test/integration/privacy-export-map.test.ts` and `apps/server/test/integration/account-data-delete.test.ts`. I did not read the foreign-key cascade. I did not run the tests, so I do not know whether they pass. For `privacy-dsr-match.test.ts` I saw only its `information_schema` and `NOT_PERSONAL` lines.
- Easy-to-miss rule, "Do not edit, create, or delete files": not proven. I made no edit in the worktree. My `git status --short | wc -l` printed 0, but it ran in a call joined with `;` and piped to `wc`, so it does not count as proof. I wrote the job `note.md` in the main repo's `.limen/jobs/` folder. The instructions asked for that note, and it is outside the worktree. Gap: no qualifying `git status --short` call exists.

My last note update wrote "Not proven yet: none". That was premature for the read-only rule. The correct state is "Not proven yet: read-only rule". I did not rerun any check, as instructed.
