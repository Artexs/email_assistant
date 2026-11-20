# F129 scouts

Four scouts (claude-sonnet-5-5, thinking medium) at base 535e6f76. A packet is a lead, not a fact; plan.md § Facts checked holds what the planner read itself.

## Scout 1 · `2026-11-20-f129-scout-1-3555c238`

Question:

> Inventory: for every package.json script (root and apps/server, tools/*) that runs a file in apps/server/src/scripts/ or tools/fake-telegram/src/cli.ts, give a table: command name, entry file, subcommand, args parsing (parseArgs strict? separate *-args.ts with test?), exit codes used and their meaning, whether it uses createCliOutput, process.exit, process.stdout.write, whether it imports config/DB at module top level (would --help need env?), and a proposed risk class (read|dev|write|danger|cost|outside per notes/2026-11-15-cli-standard.md 4.6). Also list the non-entry helper files in apps/server/src/scripts/ and who imports them.

Packet: Inventory of every root `package.json` script that runs a file in `apps/server/src/scripts/` or `tools/fake-telegram/src/cli.ts`: args parsing, exit codes, output, config at import, risk class, plus the helper files.
Base: 535e6f76
Verified: `env -i bun src/scripts/org-delete.ts --help` -> `usage: bun run org:delete --org-id <uuid> --confirm <organization name> [--lock-timeout-ms <ms>]` (exit 2) | I ran `--help` on 45 entries under `env -i`. None has a real `--help`; it is an unknown flag, so strict `parseArgs` fails and the script prints usage.
Unknowns:
- Risk class is my proposal from the script names and imports. I did not read every script body for external side effects. Marked `?` in the table.
- I did not run `--help` on 13 entries because they ignore args or write files: `module-graph`, `push-keys`, `sim-compose-check`, `lab-env-check`, `credentials-check`, `ops-alert-test`, `telegram-check`, `e2e-seed`, `release-prepare`, `db-worktree`, `check-migrations`, `job-run`, plus `api-spec` (which I ran and exited 2). I read their args handling from source only.
- Whether the strict `parseArgs` check covers the entries that have no args file is guessed. The source says `strict: true` appears in the entry itself.
- The inventory covers root `package.json` only (observed). `apps/server/package.json` and `tools/*/package.json` have only `typecheck`.

1. Cross-script facts (observed):
   - **Exit codes:** `0` is ok. `1` is the generic failure and also the usage error in most scripts.
   - **Exit 2 means usage or refusal only in:**
     - `api-spec`, `check-migrations`, `db-worktree`: 0 clean, 1 drift/findings/failure, 2 usage.
     - `release-prepare`: 0 done, 1 failure, 2 refused.
     - `org-delete`, `org-dsr`, `org-export`: 2 on bad args.
     - `delegates`: 2 on refused address or field.
     - `mailbox-settings`: 2 when auto is refused without go/no-go.
     - `testmail-remote`, `testmail-target`: 2 on "nothing sent yet".
     - `fake-tg`: 0 ok, 1 failed or timeout, 2 usage, 3 server unreachable.
   - **`createCliOutput`:** every entry uses it (`co=2` hits) except `org-break-glass`, `org-delete`, `org-dsr`, `org-export`, `web-two-factor-reset`, `testmail-remote`, `sim`, and the four `mailbox-cli` entries. The first seven print through `process.stdout.write` or `process.stderr.write`. The `mailbox-cli` four print through `platform/log`.
   - **`process.exit`:** every entry ends with one `process.exit(await main())` or `process.exit(code)`, except `fake-tg` (`process.exit` inside `import.meta.main`). `push-keys` and `sim-compose-check` exit 1 on failure with no explicit 0.
   - **Config/DB at import:** no entry calls `loadConfig()` or `createDb()` at module top level. They call it inside `main`, after the args parse in most scripts. The exceptions are `org-member`, `org-sso` and the four `mailbox-cli` entries (`mailbox-audit`, `mailbox-backfill`, `mailbox-seed`, `mailbox-signals`): they load config first. Under `env -i` they fail with `Missing or bad config keys: DATABASE_URL…` (exit 1). `e2e-seed.ts:128` reads `process.env` at top level for a GreenMail host default.
   - **Help:** no script supports `--help`. `fake-tg` has a `USAGE` block but rejects `--help` (exit 2).

2. Table (cmd → entry; `args` file: A = `*-args.ts` + test, a = `*-args.ts` without test, none = parse inline; all `strict:true`):

| Command | Entry / subcommand | Args | Risk |
|---|---|---|---|
| `graph:modules` | module-graph | none, no parseArgs | dev |
| `fake-tg` | tools/fake-telegram cli.ts: serve/send/press/read/wait | inline strict, `UsageError` | dev |
| `rules:add` / `rules:list` | rules add/list | inline strict | write / read |
| `delegates:add/list/disable/enable` | delegates | A | write / read |
| `delegations:list/done` | delegations | A | read / write |
| `release:prepare` | release-prepare | a | write (repo files?) |
| `ops:alerts` | ops-alerts | A | read |
| `ops:alert-test` | ops-alert-test | none | outside? |
| `credentials:check` | credentials-check | none | read |
| `job:run` | job-run | A | dev |
| `triage:cost` | triage-cost | inline | read |
| `triage:label` | triage-label | inline | cost |
| `eval` | eval | A | cost |
| `sim` | sim (sub-commands in sim-commands.ts) | A | cost |
| `lab` | lab: seed/start/stop/serve/reset/score/status/demo-* | A | dev |
| `testmail:setup/validate/blind/send/status` | testmail | inline | outside (send), dev (rest) |
| `testmail:target` | testmail-target: deliver/compare | inline | outside |
| `testmail:remote` | testmail-remote: deliver/compare | inline | outside |
| `llm:check`, `gemini:test` | llm-check | A | cost |
| `org:create` | org-create | inline | write |
| `org:flag` | org-flag | A | write |
| `org:member` | org-member add | A | write |
| `org:break-glass` | org-break-glass | A | danger |
| `org:invite` | org-invite | A | write (sends mail?) |
| `org:delete` | org-delete (`--confirm` already) | A | danger |
| `org:export` | org-export | A | danger? |
| `org:dsr` | org-dsr | A | danger |
| `org:plan` | org-plan | A | write |
| `org:status` | org-status | inline | read |
| `org:sso` | org-sso set/show/verify/… | A | write |
| `web:invite` | web-invite | inline | write |
| `web:two-factor-reset` | web-two-factor-reset | A | danger |
| `e2e:seed` | e2e-seed (no parseArgs, env only) | A (e2e-seed-args) | dev |
| `push:keys` | push-keys (no args) | none | read |
| `telegram:check` | telegram-check (no args) | none | outside |
| `telegram:link` / `unlink` | telegram-link/unlink | inline | write |
| `digest:times` | digest-times | inline | write |
| `mailbox:connect` / `password` | mailbox-connect / password | inline | write |
| `mailbox:check` | mailbox-check | inline | read (IMAP) |
| `mailbox:probe-move` / `probe-send` | mailbox-probe-* | inline | outside |
| `mailbox:seed` | mailbox-seed (via mailbox-cli) | A | dev |
| `mailbox:rescan` | mailbox-rescan | inline | write |
| `mailbox:audit` | mailbox-audit (via mailbox-cli) | inline | read |
| `mailbox:signals` | mailbox-signals (via mailbox-cli) | a | read |
| `mailbox:backfill` | mailbox-backfill (via mailbox-cli) | inline | write |
| `mailbox:settings` | mailbox-settings show/mode/auto/… | A | write |
| `mailbox:profile` | mailbox-profile | A | write |
| `stats:week` | stats-week | A | read |
| `trust:history-check` | trust-history-check | inline | read |
| `reply:check-copy` | reply-check-copy | A | read |
| `sim:check` | sim-compose-check | none | read |
| `lab:env-check` | lab-env-check | none | read |
| `db:worktree` | db-worktree | A | dev |
| `api:spec` | api-spec (`--check`) | none, strict | write |
| `db:check-migrations` | check-migrations | a | read |

   Mixed use of exit 1 for usage versus exit 2 across scripts is the main gap against a single standard (observed).

3. Helpers in `apps/server/src/scripts/` (not entries; importer, non-test):
   - `*-args.ts` (including `check-migrations-args`, `db-worktree-args` also imported by `apps/server/test/worker-db.ts`): imported by their own entry. `check-migrations-rules` also by `check-migrations-args`; `ops-alerts-args` also by `ops-alert-test`; `lab-args` also by `lab-run`.
   - `e2e-job-env-args`: `e2e-job-env`, `apps/docs/e2e/serve.ts`, `apps/docs/e2e/site.ts`, `apps/web/e2e/env.ts`.
   - `e2e-seed-args` (very widely used): the `e2e-*-rows` files, `e2e-seed`, `e2e-activity`, `e2e-suggestions`, `demo-org-setup`, and `apps/web/e2e/*`.
   - `mailbox-cli`: `mailbox-audit`, `mailbox-backfill`, `mailbox-seed`, `mailbox-signals`.
   - `invite-delivery`: `org-invite`, `web-invite`. `pick-member`: `digest-times`, `telegram-link`, `web-invite`.
   - `eval-*`: `eval`, `eval-sim`, `eval-drafter` etc. `eval-suspicious` is also imported by `modules/triage/index.ts`.
   - `sim-*`: `sim-commands` (from `sim.ts`) imports the `sim-*` modules.
   - Single-owner helpers: `api-spec-build`, `credentials-check-lines`, `module-graph-build`, `ops-alerts-lines`, `org-status-lines`, `release-prepare-lib`, `triage-cost-report`, `mailbox-backfill-gate`, `lab-run`, `sim-compose-rules`.
   - Standalone entries with no `package.json` script: `e2e-job-env.ts` (no importers, has `usage:`), `e2e-activity.ts`, `e2e-suggestions.ts`, `demo-org-setup.ts` (no importers; one test). These also use `createCliOutput`.

Checks: `bun src/scripts/<name>.ts --help` under `env -i` covers whether usage prints without env; it misses the 13 scripts listed in Unknowns and the risk class. `apps/server/src/scripts/*-args.test.ts` cover the args parsing of the scripts that have an args file; they miss exit codes and output.

## Scout 2 · `2026-11-20-f129-scout-2-f45f991f`

Question:

> Callers of exit codes and usage text: list every place outside apps/server/src/scripts that runs a repo CLI tool and reads its exit code or output: .github/workflows/*.yml, scripts/*.sh (limen-prepare.sh, land-check.sh, coord-scan.sh, others), deploy/*, apps/web/e2e and apps/docs/e2e Playwright setup, apps/server/test/integration/*-cli.test.ts and other tests that spawn scripts (what exit codes and text each asserts), evals/sim/README.md, runbooks in docs/ and docs/capabilities/. Give file, command, what it depends on (exit code value, stdout text). Also: how does capability-map.test.ts check script names, and the eslint config for apps/server/src/scripts (rules on process.exit, console, stdout).

Packet: Which callers outside apps/server/src/scripts read a repo CLI's exit code or output, how capability-map.test.ts checks script names, and the eslint rules for scripts.
Base: 535e6f76
Verified: `git status --short` -> empty output (worktree clean). I read each file below at HEAD. I ran no CLI tool and no test.
Unknowns: I only sampled the 26 `*-cli*` and `*-check` integration tests plus `deploy/test/*`, so the list for those is not exhaustive. I did not read `apps/web/e2e/tests/*.spec.ts` (activity, notify, push-devices, suggestions, telegram-detail, two-factor, mailbox-oauth, docs-links match the script-name grep). I did not read `deploy/release*.sh` / `rollback.sh` for CLI calls; they call no `bun run` tool in my grep. The docs/ exit-code mentions are only a cut-off sample (first 60 hits).

1. `.github/workflows/ci.yml:143,151-159` (the sim-compose and sim-image steps) — `bun run sim:check` must exit 0. `bun run lab:env-check` must exit 0 on `deploy/sim.env.example`. With a real-form `TELEGRAM_BOT_TOKEN` it must exit non-zero, with stdout exactly `[lab-env-check] telegram_token_not_fake` (stdout, not stderr). Other steps only need exit 0: `lint`, `typecheck`, `db:check-migrations`, `db:migrate`, `docs:stale`, `docs:stale --strict` (docs-deploy.yml:109), and `docs:shots`. `docs-deploy.yml:55` pipes `git tag` into `deploy-gate.ts`, which is not under scripts/. — observed
2. `scripts/limen-prepare.sh:44,83-89,102` — `bun run db:worktree <name>` must exit 0, else the script fails with "(exit $status)". It greps stdout for the line `[db-worktree] created `, and for exactly two lines `^(DATABASE_URL|MIGRATOR_DATABASE_URL)=`. `bun apps/server/src/scripts/e2e-job-env.ts --job-name` must exit 0. Its stdout is filtered for `E2E_PORT|E2E_TELEGRAM_PORT|DOCS_TEST_PORT|E2E_MAIL_TAG`. Rollback runs `db:worktree <name> --drop` and only checks the exit code. `scripts/land-check.sh:77-83` and `coord-scan.sh:66` read the exit code of `plan-drift.sh` (0 clean, 1 needs refresh, 2 bad input; any other code prints "unknown base"). Neither runs a TS CLI. `scripts/ci-bun.sh` only wraps bunx. — observed
3. `deploy/restore.sh:254-272` — runs `credentials:check` and parses stdout with a sed regex for exactly one line `[credentials-check] credentials ok=<n> failed=<m>`, with or without the prefix. Zero or two result lines, or `failed>0`, exits 1. It ignores the exit code of `credentials:check` itself (only a `$(...)` assignment). The line text comes from `credentials-check-lines.ts`. `deploy/test/restore.test.ts:36-39` builds the same line from `credentialsLine`. `deploy/compose.sim.yaml:76,103,133` runs `bun run lab:env-check && exec ...`, so a non-zero exit stops the container. `deploy/README.md` runbooks call org:*, job:run and others but read no code or text, except lines 396 (`org:sso` prints `txt _ea-sso...`, `verified`, `error not_found_in_dns`) and 470 (`auto --value on` exits 2 on a no-go). — observed
4. Playwright setup: `apps/web/e2e/global-setup.ts:8` and `helpers.ts:131` use `execFileSync("bun", [e2e-seed.ts | e2e-activity.ts ...])`, which throws on a non-zero exit. `docs-shots/global-setup.ts:24` does the same with `demo-org-setup.ts`. `servers.ts:21` runs `bun run db:migrate && bun apps/server/src/main.ts`. `apps/docs/e2e/serve.ts` imports `e2e-job-env-args`. Tests that assert code or text:
   - `credentials-check.test.ts`: exit 0 with empty stderr. Failure exits 1 with stdout empty and stderr `/^\[credentials-check\] failed: \w+( \w+)?\n$/`. An argument gives exit 1 and `usage: bun run credentials:check` on stderr. The restore stub also expects exit 1.
   - `cli-streams-other.test.ts`: `db:worktree` with no argument, a missing env key, or a bad name gives exit 2 with `usage: bun run db:worktree` on stderr. The base DB, a non-loopback server and a wrong password give exit 1 on stderr. Every line is `[name] text` on a fixed stream.
   - `db-worktree-drop.test.ts`: exit 0 with `[db-worktree] dropped <name>` / `no database <name>` on stdout. Exit 1 with `database X exists but ` on stderr.
   - `e2e-job-env-cli.test.ts`: exit 1 with `no free e2e port block` on stderr and empty stdout. A bad argument gives exit 2. stdout has no secrets.
   - `e2e-seed`, `e2e-activity`, `demo-org-setup`: exit 1 with `refusing: ...` on stderr (`DATABASE_URL is not an e2e database`, `bad_args`).
   - `job-run-cli.test.ts`: `[job-run] <job>: ran once ...` on stdout, a warning on stderr, exit 1 when a mailbox fails.
   - `deploy/test/backup.test.ts`: `backup.sh` exits 0, non-zero, or 75 (lock held). — observed
5. Docs and evals: `evals/sim/README.md` depends on stdout of `sim`. The text `ok` from `check` (lines 55, 89, 145, 161) and the lines `case <id> <code>`, `spread`, `disagree ...`, `stale <id>` are read by agents. `sim plan` without `--force` on a sent part with texts exits 1. `docs/capabilities/live-lab.md:11,13,28,61,87-88` lists `lab` exit 1 codes (`telegram_link_timeout`, `confirm_needed`, `org_mismatch`) and `lab-env-check.test.ts`. `sync.md:22` has `mailbox:check` exit 2 for a refused host. `tenancy-and-plans.md:49` has `org:member` `error not_member`, exit 1. `docs/known-alerts.md:334,641,758,963` name exit codes 1, 1, 2 and 2. — observed
6. `apps/server/src/capability-map.test.ts:29-30,84-85,164-166` — `scriptNames()` takes every match of `/bun run ([a-z0-9][a-z0-9:_-]*)/g` in `docs/capabilities/*.md` and the README. Each name must be a key of root `package.json` `scripts`. It checks the key only, not the target file, exit codes or usage text. `bun run --filter x` and `bun run lint` match by name. A tool absent from package.json fails the test. — observed
7. `eslint.config.js:257-259` — for `apps/server/src/**/*.ts` except `*.test.ts` (this includes `scripts/`), `no-console` is `error` and `no-restricted-syntax` holds only the log-event selectors. Nothing in the config mentions `process.exit` or `process.stdout`, so both are unrestricted. `eslint.config.js:88-94` blocks any import of `platform/cli.ts` from modules, platform and `apps/server/src/*.ts`; scripts may import it. `process.exit` appears in 104 lines of `apps/server/src/scripts/*.ts` (non-test), and `platform/cli.ts` has no `exit`. A script prints only through `createCliOutput`, which holds `print` (stdout) and `fail` (stderr). — observed

Checks: `apps/server/src/capability-map.test.ts` covers that each `bun run <name>` in capability docs exists in package.json; it misses usage text, exit codes and any `bun apps/...` call. The `*-cli*.test.ts` integration tests and `deploy/test/restore.test.ts` pin exit codes and exact lines per tool. Nothing checks them across all tools, and no check covers `scripts/*.sh` or `docs/known-alerts.md` exit-code claims.

## Scout 3 · `2026-11-20-f129-scout-3-4b39b6e4`

Question:

> Overlap candidates: (a) does gemini:test still exist in package.json and where is it documented; (b) mailbox:probe-move and mailbox:probe-send vs mailbox:check --probe: code, inputs, who uses them (docs, tests); (c) the testmail module and testmail:* commands (testmail:send, :target, :remote, others): what each does, who calls them (docs, notes, CI, scripts), last commits, and what only it does that sim/mailbox:seed/GreenMail do not; (d) triage:cost: what it computes in the script, compared with packages/core/src/metrics/ and stats:week; (e) org:invite vs web:invite. Give file:line evidence.

Packet: F129 inventory — overlap candidates (a)–(e) at HEAD
Base: 535e6f76
Verified: `git status --porcelain` -> (empty output); `rg -n "gemini:test"` -> `package.json:57: "gemini:test": "bun apps/server/src/scripts/llm-check.ts --provider gemini"`
Unknowns:
- I did not find who calls `testmail:*` in CI. `rg testmail|agentmail` over `.github` and `scripts/*.sh` gave no hit (only `scripts/test-audit/README.md`, a mutant note). Use is manual.
- `testmail:send`, `:setup`, `:blind` and `:validate` need a live AgentMail key. I did not run them.
- A stale name: `docs/known-alerts.md:1105` says `gemini-check.ts`; the real file is `llm-check.ts`.
- F138 (remove Gemini) is in `spec/features/dropped/2026-11/`. The ticket and `notes/2026-11-20-replan-parallel.md:36` still assume F138 stage 02 removes `gemini:test`. It does not at HEAD.

1. (a) `gemini:test` still exists, `package.json:57`. It is an alias of `llm:check --provider gemini`. Documented in `README.md:51`, `docs/roadmap.md:135`, `docs/architecture.md:691`, `docs/known-alerts.md:1105`, `notes/2026-11-15-cli-standard.md:168` (removal plan). Since F138 is dropped, F129 inventory must decide removal itself and edit those docs. — observed
2. (b) The three probes share one code family in `modules/mail/imap/`: `probe.ts` serves `mailbox:check --probe`, `probe-move.ts` and `probe-send.ts` serve the other two.
   - Inputs differ. `mailbox-check.ts:44-49` takes `--org-id --mailbox-id [--probe]`. It loads a stored mailbox with its DB credentials, uses `inspectMailbox`, and exits 2 for a refused host. `mailbox-probe-move.ts:13-20` takes raw `--host --port --address` and a password on stdin. `mailbox-probe-send.ts:18-24` adds `--smtp-host --smtp-port --to`. Both refuse unless `TEST_MAILBOX_ADDRESS` equals `--address`. They use no DB.
   - `--probe` tests only `SEARCH HEADER` and the Sent autosave (`docs/capabilities/sync.md:22`). The move probe checks folder and MOVE facts. The send probe checks draft, SMTP, Sent and INBOX. These are different facts.
   - Users: docs (`docs/modules.md:135,136,473,480`, `docs/capabilities/actions-and-undo.md:67`, `drafts-and-send.md:121,245`, `docs/code-patterns.md:235`, `docs/roadmap.md:125-126`). Tests: `apps/server/test/integration/imap-probe-move.test.ts` and `imap-probe-send.test.ts`, which cover the library functions, not the scripts. No CI or script caller.
   - `mailbox-probe-send.ts` last changed 2026-11-18 (comment edit). `notes/2026-11-12-smtp-starttls.md:9`: it has no `--smtp-security` and uses `tls`. Merge plan in `notes/2026-11-15-cli-standard.md:169`. — observed
3. (c) The `testmail` module (`apps/server/src/modules/testmail/`, 16 files, 1639 lines, last commit 73cfa893 2026-11-18, a comment-only change) builds mail for a real mailbox from AgentMail (external test-mail service).
   - `testmail:setup|validate|blind|send|status` (`scripts/testmail.ts:44-49`) works with batches in `evals/testmail/`. It sends batch mail by AgentMail to `TEST_MAILBOX_ADDRESS` with a daily cap, a lock and a send log.
   - `testmail:target` (`scripts/testmail-target.ts:21-22`) has `deliver` and `compare`. It runs on the server and uses `deliverTestMail` and `buildRealReport`.
   - `testmail:remote` (`scripts/testmail-remote.ts:44-45`) bundles `testmail-target` from a clean `origin/master` worktree, copies it to the VPS by ssh and runs it in a container. It last changed 2026-11-08.
   - Callers: docs and notes only (`notes/2026-11-07-agentmail-test-mail.md`, `notes/2026-11-09-sort-folders-live-test-with-testmail.md:21`, `docs/product/stage-2/02-inventory-and-roadmap.md:126`, `docs/code-patterns.md:25,235`, `deploy/README.md:31`). Tests: `apps/server/test/integration/testmail-remote.test.ts`, `mail-deliver.test.ts`, and the unit tests in the module.
   - Only testmail does these: real-world delivery from outside the network through a real provider, the blind labelling flow, and the VPS run. mailbox:seed (APPENDs fixtures by IMAP) and GreenMail do not send real internet mail. I did not read the sim code, so I cannot say what it covers. — observed
4. (d) `triage:cost` (`scripts/triage-cost.ts:13-77`) reads LLM usage rows from `listUsageSince`. It prints tokens, latency and cost for each model and endpoint over `--days` (`triage-cost-report.ts`, using `costPerMail` and `monthlyCost`). Its input is one mailbox with real or synthetic mail. M7 (`packages/core/src/metrics/m7.ts`) is a per-mailbox monthly cost with hosting and backup, and it is part of `stats:week`. They share `costPerMail` and `llmPrices` from `triage/cost.ts`, but they do not share the report code. M7 has no per-call token or latency figures; `triage:cost` has no hosting figure. They overlap only on the price function. Docs cite `triage:cost` in `docs/capabilities/triage.md:66,122` and `docs/decisions/0035-llm-endpoint-eu-and-own-model.md:22`. Last commit 8107dd19 2026-11-18. — observed
5. (e) `org:invite` and `web:invite` are different, and both call `deliverInvite` (`scripts/invite-delivery.ts`). `org-invite.ts:33-50` creates an organization and its owner (`createOrganizationWithOwner`, trial plan), then delivers a link. `web-invite.ts:58-77` makes a new setup link for an existing member (`--org-id [--user-id] [--print]`). Both need `WEB_BASE_URL` and `WEB_AUTH_SECRET`. Used in `deploy/README.md:306,313`, `docs/capabilities/tenancy-and-plans.md:35`, the UI texts (`apps/web/src/i18n/texts/en-auth.ts:49`) and `known-alerts.md:473,497`. Keep both; `notes/2026-11-15-cli-standard.md:172` says the same. — observed

Checks: `rg`/`git log` evidence above covers callers and last commits; it misses runtime behaviour. I ran no script and no test.

## Scout 4 · `2026-11-20-f129-scout-4-f16bb083`

Question:

> Runtime context: (a) the server Docker image (deploy/ or apps/server/Dockerfile): which files and package.json scripts exist in it, are dev deps present, can bun run <script> work there, and how deploy docs run CLI tools ($C run --rm cli); (b) apps/server/src/platform/cli.ts current API (createCliOutput, describeError?) and its tests; (c) what active tickets F136 (Playwright parallel, e2e ports and limen-prepare.sh), F141 (LLM provider registry, llm:check, eval), F124, F125 change in apps/server/src/scripts, tools/fake-telegram, package.json or *-cli.test.ts files (read their plan.md and stages, and git log for landed stages); list each overlap with the file.

Packet: Runtime context for F129: server image, `platform/cli.ts` API, overlaps with F136, F141, F124 and F125
Base: 535e6f76
Verified: `cat apps/server/src/platform/cli.ts` -> `export function createCliOutput(name: string): CliRawOutput {`
Unknowns:
- I did not build the image. Which root scripts fail inside it is inferred from the COPY lines (guessed).
- I did not read F136 stage 05 and 06 or F141 stage 06 and 07 in full, only the lines that name files. Their file lists may be incomplete (guessed).
- I did not run the CLI tests.

1. `deploy/Dockerfile` — The image copies root `package.json`, `bun.lock`, `apps/server`, `apps/web`, `packages/core`, `db`, `evals/cases`, `evals/results/gate`, `tsconfig.base.json` and `CHANGELOG.md`. It also copies only the `package.json` of `apps/docs` and `tools/fake-telegram`. It runs `bun install --frozen-lockfile --filter "!@ea/docs"`, so dev deps stay (comment: "Dev dependencies stay: dbmate and kysely-codegen"). It runs as `USER bun` with `bun:1.4.4`. So `bun run <script>` works for every root script that points into `apps/server/src/scripts`. Scripts that need absent paths fail: `fake-tg` (no `tools/fake-telegram/src`), `docs:*` and `scripts/*.sh` (no root `scripts/` dir), and `lint`. `.dockerignore` excludes `docs`, `notes`, `tasks`, `.ai`. A generated tool list that reads `docs/` or `spec/` cannot run inside the image — observed (Dockerfile); script failures guessed.
2. `deploy/compose.yaml:73` — The `cli` service extends `server`, uses profile `cli`, `restart: "no"`, `LOG_FORMAT: text` and the `local` log driver. Deploy docs run tools as `$C run --rm cli bun run <script> …` (`deploy/README.md:42,162,199`). Secrets are piped with `-T`. `docs/decisions/0024-structured-logs-and-operator-alerts.md:21` says CLI output stays out of the log store, and `deploy/check-logging.sh` fails on a doc line that runs a one-off command in `server` — observed.
3. `apps/server/src/platform/cli.ts` — `createCliOutput(name)` returns `print` (stdout, `[name] text`), `fail` (stderr, `[name] text`) and `raw` (stdout, no prefix). There is no exit-code, usage, `--help` or JSON helper. `describeError` is not in `cli.ts`; it is in `platform/errors.ts:18` and returns the error name plus a string or number `code`, never the message. `createCliOutput` has 188 files in `apps/server/src/scripts` to serve. `fake-telegram` has its own `src/cli.ts` and does not use `createCliOutput` (grep found no `createCliOutput` or `console.` in it) — observed. Tests: `platform/cli.test.ts` spies on `console.log` and `console.error` and checks prefix and `raw`, and that the log level and format change nothing — observed. Eleven or more `*-cli.test.ts` files in `apps/server/test/integration/` spawn scripts (for example `org-cli`, `job-run-cli`, `e2e-job-env-cli`) — observed.
4. Overlaps (per file, from stage text and `git log`):
   - `package.json` and its `scripts`: F124 landed `--parallel=4` in `test:unit` and `test:int` (observed at HEAD). F141 stage 05 landed `llm:check` and `gemini:test` flag changes (`ed83cc77`, `879a1bc3`). F136 stage 05 and 06 add no root script as far as I read. F125 stage 02 reads `test:unit` and `test:int` paths from `package.json` (`suitePaths`).
   - `apps/server/src/scripts`: F136 landed `e2e-job-env.ts`, `e2e-job-env-args.ts`, `e2e-seed-args.ts`, `db-worktree.ts`, `db-worktree-args.ts` (stages 01–04, `58c03e0c`). F141 touched `llm-check.ts`, `llm-check-args.ts`, `eval.ts`, `eval-args.ts`, `eval-sim.ts`, `eval-drafter.ts`, `eval-judge-setup.ts` (stage 05). F141 stage 06 and 07 plan no script changes, only the LLM client, readers and scan test. F125 stage 06 may move or delete `*-cli.test.ts` cases and fix `e2e-seed.test.ts:90`. F124 touches no script, only tests and waits.
   - `*-cli.test.ts`: F125 stage 06 names `testmail-cli.test.ts` (13 s) and the 45 int files that spawn a script, as candidates for MOVE-TO-UNIT or DELETE-DUP, keeping one wiring case per CLI. `e2e-job-env-cli.test.ts` came from F136 stage 03.
   - `tools/fake-telegram`: F124 only references its tests in the `test:unit` and `test:int` paths. F125 stage 04 reviews its tests. F141 stage 06 touches the Telegram fake in `tools/` to add `providerOf`. No ticket changes `tools/fake-telegram/src/cli.ts`.
   - `scripts/limen-prepare.sh` is not in F129 scope, but F136 stage 04 landed it and F136 stage 06 documents it. F124 and F125 reference it. F129 should not move it.
   All are guessed from plan text except the landed items, which are observed in `git log`.
Checks: `apps/server/src/platform/cli.test.ts` covers the three output methods and level independence; it misses exit codes, usage errors and the image. No existing check proves that `bun run <script>` works inside the built image (`deploy/check-logging.sh` checks only drivers and doc lines).
