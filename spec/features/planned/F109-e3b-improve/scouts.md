# F109 scout packets

Four Sonnet scouts (thinking medium), started 2026-11-15 at base b9261659. Each packet is copied whole from the job log.

## Scout 1 · job `2026-11-15-f109-scout-1-cc8a6db4`

**Question:**

How does the E2a offline lab (F097, landed) run a classifier experiment: how is a new prompt version (for example classifier-v3) added, registered and selected in production; how do the dev set and the holdout run (commands, cost caps, gate file under evals/results/gate, the judge); which fields of a sim corpus case reach the prompt today (sender context, folder, attachments, urgency profile, prior history counts); and what a stronger model (gpt-6.1-terra) needs to run as a second classifier role (LLM roles F090)? Context: spec/features/planned/F109-e3b-improve/ticket.md. Answer for the code at HEAD.

**Packet:**

Packet: How the E2a lab runs a classifier experiment, and what gpt-6.1-terra needs as a second classifier role
Base: b9261659
Verified: `git status --short` -> empty output (worktree clean). I read code only and ran no eval, because an eval needs an LLM key and spends money.
Unknowns: whether `escalation` is the right role name for terra (guessed). `rolesWithoutPrompt` names it as E3b's role, but I found no code that calls it. I did not check the E3b discovery notes beyond the price lines.

1. **Add, register and select a prompt version.**
   - Add `apps/server/src/modules/triage/prompts/classifier-v3.ts`. It must export `PROMPT_VERSION = "classifier-v3"`, `buildSystemPrompt(allowed)` and `buildUserPrompt(email, sender, delegates, nonce)`. Observed: `classifier-v2.ts:6` says a text change needs a new file and a new version.
   - Register it in `prompts/index.ts`: import it and point `prompts.classifier.version`, `buildSystem` and `buildUser` at v3.
   - There is no env switch. The single `prompts` object is the production selection. `classifyEmail` (`classifier.ts:43-65`) reads `prompts.classifier.*` for the call and for the `promptVersion` that it returns. The eval state file name also includes the version (`eval.ts:171`). Observed.
   - `gate-evidence.test.ts` fails in CI until a gate file `evals/results/gate/classifier-classifier-v3-*.json` exists. It checks only that the file exists and parses, not the numbers. Observed.
   - `ClassifierDelegate` and `EXCERPT_CHARS` are imported from `classifier-v2` in `classifier.ts:8`, `eval.ts:56` and `index.ts:77`. A v3 file that replaces v2 needs those imports moved. Observed.
2. **Dev set, holdout and judge.**
   - Dev: `bun run eval --sim lab-01 --part dev [--provider … --model … --reasoning-effort …] [--judge]`. Holdout: `--part holdout`. It needs a frozen `manifest.json` and prints no case ids. Observed: `eval-args.ts:15-25`, `evals/README.md` § Sim corpora.
   - Never open `holdout/` for prompt work (`evals/sim/README.md` §2). Observed.
   - Cost caps. `--budget-usd` defaults to 1 per run (`RUN_CAP_USD`, `eval-ledger.ts:16`). The month cap is $20 (`MONTH_CAP_USD`, `eval-ledger.ts:15`), counted in the ledger at `$XDG_STATE_HOME/email-assistant/eval-spend.jsonl`. Observed.
   - A run refuses to start when the model has no price in `llmPrices` (`eval-sim.ts:96`). Today `llmPrices` in `packages/core/src/triage/cost.ts:16-21` holds `gemini-3.8-flash`, `gemini-3.5-flash-lite` and `gpt-6-luna` only. Observed.
   - Gate file: after a holdout run, the gate command writes `evals/results/gate/<role>-<promptVersion>-<model>-<effort>-<corpus>-v<version>.json` (`eval-sim.ts:237`). The existing file is `classifier-classifier-v2-gpt-6-luna-none-lab-01-v1.json`. It has `audit: "pending"` and `provisional: true`. Per-category `decision` is `no-go` for `urgent` (Wilson lower 0.928) and `needs_reply` (0.855), and `go` for `info`. Observed.
   - The gate needs at least 200 holdout cases per category and a Wilson 95 % lower bound of precision of at least 0.98 (`evals/README.md` § Gate). Commit the report and the gate file before the merge. Observed.
   - The judge grades only the planned delegation and clarification drafts, with the `judge` role and `judge-v1`. The judge provider must differ from the classifier provider (`eval-judge-setup.ts:4,10`). Observed. It is a drafter gate and is not needed for a classifier-only change (guessed).
3. **Which sim case fields reach the prompt.**
   - The path is `toEvalCase` (`packages/core/src/sim/to-eval-case.ts`), then `toClassifierInput` and `toClassifierDelegates` (`eval.ts:174-196`), then `buildUserPrompt`. Observed.
   - Reach the prompt:
     - From, To and Cc (bare addresses), subject, receivedAt, and the body (up to 8000 characters).
     - Up to 3 thread mails, each with from, subject, date and a 500-character excerpt.
     - The delegates: id, name and tags.
     - Sender context: only `whitelisted`, `vip` and `noreply`. In sim, VIP comes from `scenario.urgency.vip` as `senderRules` (`to-eval-case.ts:109`) and `applyHardRules` turns it into these flags (`eval.ts:408`).
   - Do not reach the prompt:
     - `sim.senderHistory` (prior history counts), `sim.urgencyProfile`, `sim.attachments`, `sim.headers`, `sim.urgencySource` and `sim.hardCases`.
     - There is no folder field in `evalCaseSchema` (`eval-case.ts`).
   - These fields live in the case under `sim`. I found them used only for report grouping (`eval-sim-report.ts:53-58`) and for the judge (`eval-judge.ts:85`, `planted`). The eval classifier input type has no slot for them. A v3 that uses them needs a wider `ClassifierEmail` or `SenderContext` in `classifier.ts:10-24`, plus a mapping in `toClassifierInput`. Observed.
4. **Terra as a second classifier role (F090).**
   - `llmRoles` is `classifier|judge|drafter|extractor|escalation` (`packages/core/src/llm-roles.ts:3`). The `escalation` role already exists and has an env row, `LLM_ESCALATION_PROVIDER/MODEL/TIMEOUT_MS/RPM/REASONING` (`config.ts:21-45,399`). So no new role is needed for config. Observed.
   - `prompts` has no `escalation` entry yet. `rolesWithoutPrompt.escalation = "E3b"` (`prompts/index.ts:33-36`). The version type is `escalation-v<n>` (`PromptVersion<R>`). A new file `escalation-v1.ts` plus an entry in `prompts` is needed. Observed.
   - `gpt-6.1-terra` has no entry in `llmPrices` (`cost.ts:16-21`). The sim run refuses it and the budget cannot charge it. Add `{ inputPerM: 1.0, outputPerM: 5.0, source: OPENAI_PRICING_URL, checked: "2026-11-13" }`. The figures are from `E03-discovery-notes.md:123`; they are not checked against the pricing page. Observed for the gap, guessed for the price.
   - For an eval, `llm.generate({ role, model })` already accepts `model` as an override for the role's provider (`client.ts:92,154`). `--model gpt-6.1-terra` on the classifier run works once priced. A second role in the same run (terra plus luna) has no eval path today. `eval-sim.ts` runs one classifier model, and `--judge` is the only second row. Observed.

Checks: `gate-evidence.test.ts` covers that a gate file exists for the current prompt version; it misses the numbers. `eval-sim-gate.test.ts` and `eval-judge-setup.test.ts` cover the gate file and the judge setup. They exist, and I did not run them. No check covers the lab's use of fields that the prompt ignores.

## Scout 2 · job `2026-11-15-f109-scout-2-4521f533`

**Question:**

What does E3a (F100, landed) capture from mail headers and IMAP flags: which tables and columns hold From display name, Reply-To, Return-Path, Authentication-Results, List-Unsubscribe, attachment list (name, type, size), link hosts (with link text?), IMAP flags; where the parsing runs (mail/imap mapper, simpleParser); which retention clears them; whether GreenMail/sim corpus cases set these headers; and which capability pages describe them? Context: spec/features/planned/F109-e3b-improve/ticket.md. Answer for the code at HEAD.

**Packet:**

Packet: What E3a (F100) captures from mail headers and IMAP flags, where it parses them, what clears them, which corpus cases set them, and which docs describe them
Base: b9261659
Verified: `git status --short | wc -l` -> 0 (worktree clean). The capture facts come from reads and greps. I ran no test.
Unknowns:
- I did not check whether the sim `attachments` name lists (40 arrays under `evals/sim`) turn into real MIME parts when the corpus is sent. Only name strings exist in the JSON.
- I did not check how sim JSON `headers` reach a GreenMail message. `SeedMessage.headers` (`mail/seed.ts:12`) is the likely path. This is guessed.
- I did not find where `email_flags` is written inside `mail/sync.ts`. I only saw that `repo/flags.ts` is the writer file.
1. `db/migrations/20261114120001_measure_capture.sql` — table `email_headers` (one row per mail). Columns: `from_name`, `reply_to text[]` (max 5), `return_path`, `auth_results`, `list_unsubscribe`, `list_id`, `auto_submitted`, `precedence`, `has_calendar`, `attachments jsonb`, `attachment_count`, `links jsonb`, `link_count`, `parts_known`, `captured_at`, `texts_cleared_at`. Table `email_flags`: `seen`, `answered`, `flagged`, `first_seen_at`, `first_answered_at`, `first_flagged_at`, `checked_at`, `answered_check*`. Both tables have RLS. — observed
2. `apps/server/src/modules/mail/imap/capture.ts` — `captureFromParsed` runs on one `simpleParser` call (`contentFromSource`). `contentFromHeaderBlock` handles mail over the size limit: header block only, `partsKnown=false`, no attachments or links. Each attachment is `{name,type,size,inline}`. Each link is `{host,textHost}`. `textHost` is the host shown in the link text, or null. HTML links come from a regex on `<a href>`. Plain-text mail gives only the host, with `textHost` null. Limits are in `CAPTURE_LIMITS` (`mail/port.ts:61`): 20 attachments, 50 links, 200-character from name. `Reply-To` is lower-cased and de-duplicated. `Return-Path` keeps only the address. `Auth-Results`, `List-Unsubscribe` and `List-Id` are raw text, cut to 1000, 1000 and 300 characters. A capture error keeps the body text. — observed
3. Flags: `imap/mapper.ts:65-75` (`toFlagsOfMessage`) returns the sorted IMAP flag list. `mail/repo/flags.ts` writes `email_flags` through the sync flag refresh. Storage: `repo/headers.ts` (`insertEmailHeaders`, in the `emails` insert transaction). The `mail/sync.ts` line for the flag write is not located. — observed for the mapper and `headers.ts`; guessed for the `sync.ts` link
4. Retention: `clearCapturedHeaders` (`repo/headers.ts:87`) sets `texts_cleared_at=now()`. Per `docs/capabilities/retention.md:17` it nulls `from_name`, `return_path`, `auth_results`, `list_unsubscribe` and `list_id`. It sets `reply_to` to `'{}'` and `attachments` and `links` to `[]`. It follows `organizations.data_retention_days`. Counts and codes stay: `attachment_count`, `link_count`, `auto_submitted`, `precedence`, `has_calendar`. `email_flags` has no clear rule in `retention.ts`. `clearMailHeaders` (`repo/retention.ts`) clears only `emails` columns, not `email_headers`. — observed (retention.md read; I did not run the job)
5. Corpus: `evals/sim` JSON sets `List-Unsubscribe` (527 hits), `List-Id` (512) and `Auto-Submitted` (20). No sim or case file sets `Return-Path`, `Authentication-Results`, `Precedence` or a `Reply-To` header. The 4 `Reply-To:` hits are inside body text. Sim attachments are name-only lists. Only `mail-sync-capture.test.ts:106` seeds `Reply-To` and `List-Unsubscribe`, with the `SeedMessage.headers` option. `imap-sync-greenmail.test.ts` has no capture or flag assertions (grep found none). Capability pages: `docs/capabilities/sync.md` rule 18 and its data section (`:84-85`), `retention.md:17,53`, `measurement.md:49-50` (says "No metric reads `email_headers` yet", and the M1 metric does not read `email_flags`), `docs/architecture.md:285,286,499`. — observed
Checks: `apps/server/test/integration/mail-sync-capture.test.ts`, `mail-headers-repo.test.ts`, `retention-clear.test.ts`, `measure-schema.test.ts` and `imap/capture.test.ts` exist for these paths. I did not run them. They cover capture and storage, and I did not check them for the real-corpus path. Corpus-based capture of `Return-Path`, `Authentication-Results`, `Precedence` and `Reply-To` headers is not covered by any sim case.

## Scout 3 · job `2026-11-15-f109-scout-3-67bc3273`

**Question:**

In the triage pipeline at HEAD: where do the hard rules (whitelist, VIP, blocklist) run before the LLM, how SenderContext and reason_code are built and stored, how the urgent notice and the digest row are rendered (notices as facts, F088), where delegation drafts and plan calls start (to block them for a flagged mail), how the LLM pause (triage/pause.ts) works and what notice it sends, and how per-organization feature flags (F087) are read in server code? Context: spec/features/planned/F109-e3b-improve/ticket.md. Answer for the code at HEAD.

**Packet:**

Packet: F109 — where hard rules, SenderContext, reason_code, notices, delegation, LLM pause and feature flags live at HEAD
Base: b9261659
Verified: `git status --short` -> empty output (worktree clean). I ran no triage test.
Unknowns: The LLM pause sends no Telegram notice, which I observed by grep only. I found no `llm_pause` or `llmPause` use in `channels/notices/*`, only in `commands.ts` and `reports`. A grep miss could hide a path I did not look at.

1. `packages/core/src/triage/rules.ts:81` `applyHardRules`, via `matchSender`:
   - A blocklist hit without a whitelist or VIP hit returns `{kind:"spam", reasonCode:"blocklist"}`. A VIP also counts as whitelisted.
   - Otherwise it returns `{kind:"classify", allowed, vip, whitelisted, noreply}`. A whitelisted sender loses the `spam` category.
   - `apps/server/src/modules/triage/service.ts:~437` (`triageOne`) calls it after the age rules and before the daily cap. A spam result goes straight to `saveTriage` with `model: null` and no LLM call. — observed
2. SenderContext and reason_code:
   - `triage/classifier.ts:20` defines `SenderContext` as `{whitelisted, vip, noreply}`. `service.ts:502` builds it from `rules` and passes it to `classifyEmail`. It is a prompt input only and is not stored. — observed
   - The stored values are `decision.vip` and `decision.reasonCode`. `saveTriage` (`service.ts:183`) writes them through `insertTriageResult` (`service.ts:~212`, `triage/repo.ts`) to `triage_results`.
   - The reason code comes from the model (`analysis.reason_code`). The service sets `blocklist` and `llm_blocked` itself. The audit row `email.triaged` gets `auditReasonCode`, which becomes `below_threshold` under the threshold.
   - There is no column for a "flagged" mail, and no field to hold a flag besides `fields` (jsonb) and `reason_code`. — observed
3. Delegation drafts and plan calls start in two places:
   - `service.ts:~523` calls `delegationInputOf(analysis, mailbox.delegates, from)` (`packages/core/src/triage/planners.ts:68`). It returns null unless the model category is `delegation`.
   - `saveTriage` then calls `planActions(finalCategory, summary, decision.delegation, {fromJunk})` (`planners.ts:135`). The `delegation` case runs `planDelegation`, which returns `create_draft` and `send`.
   - `createDelegationRow` (`service.ts:146`) creates the `delegations` row.
   - To block these for a flagged mail, set `delegation: null` in the decision, or gate in `planActions`/`planDelegation`. Also change `finalCategory`, because `createDelegationRow` returns early only when the category is not `delegation`. — observed (the blocking point is a guess)
4. Notices as facts:
   - Urgent: `channels/notices/urgent.ts:90` queues a view with `ai:{reasonCode, reason}` and its actions. The renderer is `packages/core/src/notices/renderers.ts:42`, which calls `renderUrgentNotice` (`packages/core/src/digest/notices.ts:22`). It prints a `💬` line from `aiTextFor` and a `→ wouldDo` line from `describeActions`.
   - Digest row: `apps/server/src/modules/reports/digest.ts:~108` builds `aiText: aiTextFor(...)` and `wouldDo: describeActions(...)` per item. `reports/activity.ts:~119` does the same.
   - `packages/core/src/digest/ai-text.ts:15` maps `triage_error`, `llm_blocked` and `blocklist` to fixed texts. All other cases print the model's `reason` or `summary`. A new reason code needs a branch there and a text in `CoreTexts`. — observed
5. LLM pause and flags:
   - `triage/pause.ts` `createLlmPause` is in-process memory only. `trip(kind, code, now)` doubles from 5 min to a 60 min cap. `isPaused` and `reset` complete the interface.
   - `service.ts:317` `handleClassifyError` trips on `SoftError` or `LlmConfigError`. It releases the mail without a count, and `triage/jobs.ts:61,69,158,197` stop all mailboxes.
   - The pause sends no notice. It writes a log line and the `llm.call` audit row with the error code. `audit/llm-pause.ts` `latestLlmPause` reads those rows (soft ≤10 min, config ≤2 h). `reports/llm-pause.ts` returns the pause only while the flag `llm_pause_line` is on. It shows as a footer line in the digest (`digest/digest.ts:158`) and in `/status` (`channels/commands.ts:117`).
   - Flags: `isFeatureOn(db, ctx, flag)` (`modules/tenancy/features.ts:25`) checks `FEATURES_OFF`, then the org row, then the registry default (`packages/core/src/features.ts`). Server code imports it from `../tenancy`, as `actions/routes.ts:7` does. `featureStates` lists all flags. — observed

Checks: `triage/pause.test.ts` and `triage/classifier.test.ts` exist and probably cover the pause and classifier. I did not run them and did not check for a rules or notice test. I did not run any test against the flag path.

## Scout 4 · job `2026-11-15-f109-scout-4-725fb342`

**Question:**

Where does an urgency profile exist today (E2a scenario profile shape: VIP people, topics, deadlines with dates), where could per-mailbox urgency context be stored (mailbox_settings JSON or a table, settings commands in packages/core/src/web/settings.ts, OpenAPI commands ADR 0023), how the CLI exposes settings commands, and which queries could give counts-only sender history (past labels per sender from triage_results, corrections from triage_feedback) and the mail folder (emails.folder) for the prompt? Context: spec/features/planned/F109-e3b-improve/ticket.md. Answer for the code at HEAD.

**Packet:**

Packet: Where the urgency profile lives, where per-mailbox urgency context can be stored, how the CLI exposes settings commands, and which queries give counts-only sender history and `emails.folder`.
Base: b9261659
Verified: `git status --short` -> empty output (worktree clean). Nothing I ran executes the paths below; all findings come from reading the code.
Unknowns: Whether `docs/product/stage-2/epics/E04-control-surface.md` decision 8 (ADR 0023) is accepted. The ADR header says "proposed". I did not find a migration for `mailbox_settings`. I did not look for one beyond one grep.

1. `packages/core/src/triage/urgency-profile.ts` — the shape exists as a Zod schema, `urgencyProfileSchema`: `topics[{label, keywords[≤10]}]` and `deadlines[{label, due: ISO date}]`, max 20 items each. VIP people are not in it; they are `sender_rules` of kind `vip`. The file also has `urgencySources = text|vip|context`. Used only by the sim and eval code (`core/src/sim/*`, `triage/eval-case.ts`), and `scenario.urgency` in `apps/server/src/scripts/sim-commands.ts:265`. No product storage and no classifier use. — observed
2. Classifier input today: `apps/server/src/modules/triage/classifier.ts:20` `SenderContext {whitelisted, vip, noreply}` and the call at `triage/service.ts:500-506` (`email`, `sender`, `allowed`, `delegates`). The prompts are in `triage/prompts/classifier-v1.ts` and `classifier-v2.ts`. A profile and history argument would be added to this call. — observed
3. Storage options: `mailbox_settings` (`platform/db/schema.ts:333`) has `category_policy` (Json), `mode`, `tool_switches` (Json), `updated_at`, `mailbox_id`, `org_id`. A new Json column, for example `urgency_profile`, fits next to `category_policy`, and `updated_at` already serves as the version (`config/repo.ts` `getMailboxSettings`). The row-lock helpers `lockMailboxSettings` and `updateMailboxSettings` exist. `updateMailboxSettings` takes `patch {mode, toolSwitches, categoryPolicy}`, so it needs a new field. Service setters are in `config/service.ts` (`setMode:181`, `setToolSwitch:261`). A separate table would not add much. — observed (recommendation guessed)
4. Web and API: `packages/core/src/web/settings.ts` holds the schemas (`settingsViewSchema`, `modeBodySchema`, `switchBodySchema`, and others). Routes are in `apps/server/src/modules/config/routes.ts`: `GET /settings/:mailboxId`, plus `PATCH .../mode`, `.../switches/:name`, `.../auto/:category`, `.../sync-folders/:key` (owner only). A urgency command would add a view field, a body schema and a PATCH route. ADR 0023 (proposed) wants an input and output schema in `core/src/web/*` and a service function with `via`. It also wants a test that fails when an `/api` route has no schema. — observed
5. CLI: `bun run mailbox:settings <show|mode|auto|switch|sync-folder|expire-ready> --org-id --mailbox-id …`. The parser is `apps/server/src/scripts/mailbox-settings-args.ts` (a `SettingsCommand` union, plus `usage`). The runner is `scripts/mailbox-settings.ts` (a `case` per kind, exit 2 on a gate refusal). A new kind needs one union member, one parse branch, one `case`, and a usage line. VIP people are managed with `rules:add` and `rules:list` (`rules.ts`). — observed
6. Sender-history queries (none exists yet; guessed design on observed columns):
   - Past labels: join `triage_results` (`category`, `email_id`, `org_id`, `created_at`, `vip`) to `emails` (`from_address`, `mailbox_id`, `org_id`). Group by `category`, filter by sender and mailbox, and return `count(*)` only.
   - Corrections: `triage_feedback` (`email_id`, `verdict`, `true_category`, `source`, `created_at`, `org_id`). The same join gives counts by `true_category` where the verdict is "wrong". Joins on `triage_feedback` already exist in `triage/metrics-repo.ts:48,94` and `actions/repo/metrics.ts:54`; `triage/answered-check.ts:29` has an EXISTS pattern.
   - Folder: `emails.folder` (default string) and `emails.source_folder`. `triage/repo.ts:542` already selects `e.folder` with `from_address` and `subject`. The email row for the prompt could carry it from there.
   - Gaps: `triage/repo.ts` (about lines 429-542) shows how the pipeline loads emails. Queries must exclude the current email and run under `TenantContext` org scoping like the others. — observed (columns, patterns); guessed (the new queries)

Checks: `apps/server/test/integration/config-settings.test.ts` covers the settings service; `packages/core/src/triage/urgency-profile.test.ts` covers the schema. Neither covers per-mailbox storage or sender history, since neither exists. `apps/server/src/scripts/mailbox-settings-args.test.ts` was not opened, so I am not claiming it covers the new CLI kind.
