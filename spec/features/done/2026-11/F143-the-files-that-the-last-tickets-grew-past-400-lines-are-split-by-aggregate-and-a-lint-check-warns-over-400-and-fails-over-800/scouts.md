# F143 scouts

Four scouts, started 2026-11-20 at plan base 88c37ed3. Each packet is copied whole. A packet is a lead, not a fact.

## Scout 1

Job: `2026-11-20-f143-scout-1-25e5f692`

Question:

> How does a file split by aggregate work in this repo: the F091 scripts (history merge, same-bodies.ts), the rules in docs/code-patterns.md § Size and shape, and what F131 (spec/features/done/*/F131-*) did per stage, what broke, and how its branches were landed (no rebase, git pull --no-rebase)? Give the exact commands a worker runs for one split and how a reviewer checks that bodies moved unchanged. Context: spec/features/planned/F143-the-files-that-the-last-tickets-grew-past-400-lines-are-split-by-aggregate-and-a-lint-check-warns-over-400-and-fails-over-800/ticket.md and spec/quality/2026-11-20-pass-2.md finding 3. Answer for the code at HEAD.

Packet:

Packet: how a split by aggregate works here (F091 scripts, rules, F131 history) and the exact worker and reviewer commands.
Base: 88c37ed3
Verified: `git log --merges --grep='history merge'` -> `400e7c07 Split apps/server/src/modules/actions/repo.ts into apps/server/src/modules/actions/repo/ (history merge; the next commit trims the copies)` (I ran no script; they exist only as text in `tools.md`.)
Unknowns:
- The scripts do not exist as files. `/tmp/f091*` is gone, and the repo has no `history-copies.sh`, `split-repo.ts`, `same-bodies.ts` or `exports-of.ts`. A worker copies them from the fenced blocks in `spec/features/done/2026-11/F091-repo-split/tools.md`. I ran none of them at HEAD (guessed to still work).
- F131 has no per-stage record. Its folder holds only `ticket.md`, and the ticket has no breakage log. I found no recorded breakage in the F131 commit messages. The only failures on record are in F091 (see 3).
- `split-repo.ts` handles only `repo.ts`-style files: top-level functions, consts and types, with no aliased, namespace or side-effect imports. The ticket's `main.ts` and text tables need a different method (guessed). The F131 splits of `mail/sync.ts`, `config.ts` and the i18n texts were also history merges; for non-repo files the commit messages do not say how the trim was made.

1. `docs/code-patterns.md:40` § Size and shape (observed). Rules: a file stays under about 400 lines and holds one aggregate. Split by moves, not rewrites. `repo.ts` becomes `repo/<aggregate>.ts` plus `repo/index.ts`, which re-exports by name every old export and nothing else. Importers keep `./repo`. `repo/shared.ts` holds only topic-less code (`DbOrTrx`). A helper two files need gets an internal export in the file of its topic. Never rebase or squash a split branch; run `git merge master`. After the land, fix a failed push with `git pull --no-rebase && git push`. The reason: a rebase replays the copy commits and conflicts (F091 `plan.md` D22; review N1 reproduced it as `DD …/mail/repo.ts`, `UA …/repo/mailboxes.ts`).

2. Commands for one split (observed; from F091 `stages/stage-01-actions-repo-split.md` items 1–6). Run from the worktree root with a clean tree, and keep scripts in `/tmp/<dir>`, not in the worktree, because lint lints every `.ts` file there.
   ```
   mkdir -p /tmp/fNNN
   # copy the 4 scripts from tools.md into /tmp/fNNN, and write <old>-map.json (file -> top-level names; shared.ts only if needed)
   OLD=apps/server/src/modules/<m>/repo.ts; DIR=apps/server/src/modules/<m>
   git show HEAD:$OLD > /tmp/fNNN/old.ts
   bun /tmp/fNNN/exports-of.ts /tmp/fNNN/old.ts > /tmp/fNNN/exports-old.txt
   git rev-parse HEAD > /tmp/fNNN/base.txt
   mkdir -p /tmp/fNNN/dry && bun /tmp/fNNN/split-repo.ts /tmp/fNNN/old.ts /tmp/fNNN/dry /tmp/fNNN/map.json   # dry run; fix the map on any error
   bash /tmp/fNNN/history-copies.sh $OLD $DIR/repo <names in map order>   # one rename commit per file + one merge; prints "history merge <sha> with N copies"
   bun /tmp/fNNN/split-repo.ts /tmp/fNNN/old.ts $DIR /tmp/fNNN/map.json
   bunx eslint --fix $DIR/repo/*.ts && bunx prettier --write $DIR/repo/*.ts
   git add $DIR/repo && git commit -m "<ticket>: <module> repository split by aggregate (trim the history copies)"
   ```
   The trim commit must follow the history merge at once, because the merge commit does not build (N full copies, no `index.ts`; `git bisect` must skip it). Recovery after a failure before the trim: `git reset --hard "$(cat /tmp/fNNN/base.txt)"` and start again at the dry run. Edit by hand only an import line that `bun run typecheck` names. When F131 split a non-repo file (`send.ts`) it gave `history-copies.sh` the target dir and file names (`a903e077`: 5 copies, then trim).

3. Reviewer check that bodies moved unchanged (observed; F091 stage 01 checks 1–7 and `plan.md` review prompt). Base = first parent of the history merge:
   ```
   M=$(git log --merges --format=%H --grep 'history merge' -1 HEAD); git show $M^1:$OLD > /tmp/rNN/old.ts
   bun /tmp/rNN/same-bodies.ts /tmp/rNN/old.ts $DIR            # prints SAME_BODIES <n>, exit 0; else "X: text changed in f.ts" / "X: in 0 files" / "X: new declaration"
   bun /tmp/rNN/exports-of.ts $DIR/repo/index.ts > new.txt && diff exports-old.txt new.txt && echo EXPORTS_SAME
   for f in $DIR/repo/*.ts; do [ "$(basename $f)" = index.ts ] && continue; git log --format=%h --follow -- "$f" | grep -q "^<first commit of old file>" || echo "NO HISTORY $f"; done   # prints nothing
   test ! -e $OLD && echo GONE; wc -l $DIR/repo/*.ts   # each under 400
   git log --no-merges --name-only --format= HEAD ^master -- apps/server/test apps/server/src/scripts tools <importer paths>   # prints nothing: no test or importer edited
   bun run typecheck && bun run lint && bun run test:unit:ci && bun run test:int:ci
   ```
   `same-bodies.ts` compares text with whitespace and a leading `export ` ignored. The F091 planning job changed one constant in a copy and got `RETENTION_BATCH: text changed in retention.ts`, exit 1 (the doc states this; I did not rerun it). `same-bodies.ts` reads only `<dir>/repo/*.ts`, so it fits `repo/` splits only.

4. F131 per branch (observed; git log `3c6de8c7..45b9302d`). Quality pass 1 findings 4–7 went out as three Limen jobs plus two later jobs. Every split commit says "Move only", and each file got a history merge (`5a743805` mail/sync, `d5f889b5` channels/repo, `54d3d7e6` triage/repo, `c82595df` triage/eval, `63b2a413` eval-suspicious, `08b27067` sim-commands, `38a14bc2` config, `a903e077` send). The jobs landed by `Merge branch 'master' into limen/...-f131-...` (6 merge commits, no rebase). Each split commit also edited the docs that name the old path. `config.ts` was deferred until F118 stage 01 landed, and `send.ts` until F115 stage 09, to avoid conflicts with open edits. After the first land no e2e spec had run; the ticket records the i18n split as exercised by the F118 stage 04 browser run on master (42 specs). `1cd3c069` added `apps/server/src/file-size.test.ts`: a fixed list of 8 glob groups, each capped at 400 lines. It checks only listed groups and needs a new entry for each split ("A new group is added when a split lands"). That fixed list is the gap pass 2 finding 3 names: "F131 split the files that pass 1 named and set no guard". The test was proven by a mutation run (200 lines added to `mail/sync-chunk.ts` fail it).

5. Context for F143 (observed). `spec/quality/2026-11-20-pass-2.md` finding 3 names `delegation/repo.ts` 809 lines (delegates 50–195, delegations from 195) and `audit/repo.ts` 556 (audit log 147–219, LLM rows 224–467) as `repo/` splits, with `main.ts`, `web.ts`, the texts and others as other shapes. The planned ticket is an empty template. `CLAUDE.md` says a branch holding a history merge lands with `git pull --no-rebase && git push`, because the local checkout has `pull.rebase=true` and the post-commit hook pushes `master`.

Checks: `apps/server/src/file-size.test.ts` covers the 8 listed groups at 400 lines; misses every other file, has no warning tier and no 800-line failure, and is not generic. `same-bodies.ts`, `exports-of.ts` and the `--follow` loop cover moves of top-level declarations in a `repo/` folder; none of them is a repo file, so a worker or reviewer runs them by hand. I ran none of them at HEAD.

## Scout 2

Job: `2026-11-20-f143-scout-2-5e0f0686`

Question:

> Which active tickets (spec/features/active/*) and planned tickets with or without stages (spec/features/planned/F142* and F144* to F152*) change any of these files, and in which stage, and is that stage landed: apps/server/src/modules/delegation/repo.ts, modules/audit/repo.ts, apps/server/src/main.ts, apps/server/src/web.ts, modules/privacy/export-map.ts, modules/privacy/address-map.ts, modules/reports/digest.ts, modules/channels/commands.ts, packages/core/src/texts/notices.ts, texts/bot.ts, texts/approvals.ts, packages/core/src/digest/approvals.ts, packages/core/src/notices/views.ts, modules/contacts/activity.ts, contacts/suggest.ts, channels/push/repo.ts, apps/server/src/platform/auth.ts, apps/server/src/scripts/e2e-seed.ts, apps/server/src/scripts/e2e-seed-args.ts, eslint.config.js. Use ticket.md, plan.md and stages text plus git log of open limen/* branches (git branch -a). Output one table: file, ticket, stage, landed yes/no, what it changes. Context: spec/features/planned/F143-the-files-that-the-last-tickets-grew-past-400-lines-are-split-by-aggregate-and-a-lint-check-warns-over-400-and-fails-over-800/ticket.md. Answer for the code at HEAD.

Packet:

Packet: Which active and planned tickets (F142, F144–F152) change the 20 named files, in which stage, and has that stage landed?
Base: 88c37ed3
Verified: `git log master --oneline --grep="F062 stage"` -> `477f939b F062 stage 02: stop copying the INBOX cursor into mailboxes` | `git status --short` printed nothing (worktree clean).
Unknowns:
- The F142 stages exist only on the unmerged branch `limen/2026-11-20-f142-plan-ff581325`. I read them there (`git show`/`git grep`). Their file lists are plan text, not code, and none have landed. Observed.
- F115 stages 14 and 18 have no commit on master. I did not read those stage files, so their file lists are unknown. The F115 hits below come from stages 03 and 09. Observed.
- I did not read the F153 stage files for file names. Grep of the stage-01 branch found no named file there, and no code outside `spec/` differs from master. Observed.
- F125 (active) matched about 4,000 times because its classification lists name test files. I excluded it as listing, not changing, source. Guessed.
- F144 to F150 and F152 do not mention any named file in ticket.md, plan.md or stages. That includes F144 (sender activity) and F145, F147, F149, F150. They mention modules in other words, so they may still touch these files. Observed for the grep, guessed for the touch.

| File | Ticket | Stage | Landed | What it changes |
|---|---|---|---|---|
| `modules/delegation/repo.ts` | F142 | 02 (`stage-02-delegation.md`); 05 (guard check) | no (plan branch only) | Line 337: `lower(g.email)` is replaced by the one address rule. Adds a new read and changes `findOpenDelegationByMessageIds` (signature unchanged). Stage 05 puts `lower(g.email)` back as a scan-test check. |
| `modules/contacts/activity.ts` | F142 | 01 or 02 (guessed) | no | Scouts list `normalizedAddress` SQL uses at lines 138-142 and others. Stage 01 moves `address-sql.ts` to `platform/db/`, so imports change. I did not read the stage body for this file. |
| `modules/contacts/suggest.ts` | F142 | scouts only; stage not confirmed | no | `normalizeSenderAddress` at lines 188 and 287 may move to the core address function. |
| `platform/auth.ts` | F142 | scouts only (lines 220, 281) | no | Login email handling is named as a scan-test site. No stage edit confirmed. |
| `modules/privacy/export-map.ts` | F062 | 02, 05 (04 allows an edit "until stage 05") | 02 yes (`477f939b`); 04 and 05 no | Stage 02 moves `mailboxes.uidvalidity` and `last_uid` to the excluded list. Stage 05 removes those four excluded entries. Stage 01 is also listed as a co-editor. |
| `modules/privacy/export-map.ts` | F115 | 03 | yes (`F115 stage 03` on master) | Adds the new text columns to the export map, such as `reply_requests.instruction` and `mailbox_profiles.display_name`. |
| `modules/privacy/address-map.ts` | F115 | 03 | yes | Adds the same new text columns, with text rules, to the address map. |
| `packages/core/src/texts/approvals.ts` | F115 | review-12 and review-17 mention it; stage 08 or 09 (guessed) | stage 09 yes; 08 yes | Result texts such as `draft_changed` and the missing texts for `answered`, `newer_mail` and others. |
| `packages/core/src/notices/views.ts` | F115 | 09 (`stage-09-answered-sweep.md`) | yes | Stage 08 added `draft_changed` to `SendResultKind` and `views.ts`. Stage 09 needs texts for the other expiry reasons. |
| `packages/core/src/digest/approvals.ts` | F115 | review-12 and review-17 only | n/a | Named in reviews. No stage edit found. |
| `modules/audit/repo.ts`, `texts/bot.ts` | F115 | scouts only | n/a | Named in `scouts.md` as reads. No stage edit found. |
| `apps/server/src/scripts/e2e-seed-args.ts` | F136 | 02 (`stage-02-mail-tag.md`) | yes (`F136 stage 02`) | Mail addresses that reach GreenMail get a per-job tag. |
| `apps/server/src/scripts/e2e-seed.ts` | F136 | 02 | yes | Builds addresses inline, so it changes if stage 02 finds an inline address. |
| `apps/server/src/scripts/e2e-seed-args.ts` | F141 | 04 | yes (via F141 stage 04) | `E2E_LLM_PIN` sets the provider keys to `""`. |
| `apps/server/src/scripts/e2e-seed.ts` | F121 | 07 (demo shots) | yes (`F121 stage 07`) | Carry-over read: the demo setup uses its paths for passwords and terms. Stage 09 and the spike also touch the seed. |
| `apps/server/src/main.ts`, `eslint.config.js`, `modules/channels/commands.ts` | F141 | stage 01 (audit and scan test) | yes (stages 01 to 07 landed) | `audit.md` and `scouts.md` name these. The stage files do not name them. Treat them as reads. |
| `apps/server/src/main.ts` | F108 | none | n/a | `scouts.md` only. |
| `apps/server/src/main.ts` | F124 | 01 | yes (`f54dcf6d`) | The stage text names `main.ts`, but the real change is `botUsernameTimeoutMs` in the telegram runtime. |
| `eslint.config.js` | F142 | 05 (scan test); `plan-review-1` reads lines 37-8x | no | Scan test and zone rules. The plan-review reads the platform zone, and no stage edit is confirmed. |
| `apps/server/src/web.ts`, `modules/reports/digest.ts`, `texts/notices.ts`, `channels/push/repo.ts` | none | none | n/a | No ticket text found for these. |
| `apps/server/src/scripts/e2e-seed.ts` | F151 | ticket.md line 31 | no (planned) | Reads the e2e seed spike. The ticket redoes steps 2, 3 and 5 on a synthetic week. |

Checks: grep over ticket, plan and stage text plus `git log master --grep` covers the named paths and the stage landed state; it misses a file named only by a bare identifier, as F144 may do.

## Scout 3

Job: `2026-11-20-f143-scout-3-b8f57e9b`

Question:

> In this repo's ESLint flat config (eslint.config.js), how can one file set get a warning over 400 lines and an error over 800 lines? Check whether ESLint 9 exposes builtinRules (eslint/use-at-your-own-risk) so max-lines can be registered a second time under a local plugin name, run a probe in a temp folder inside the worktree, and say which file types 'eslint .' lints here (ts, tsx, astro, js, mjs, json?), whether 'bun run lint' exits non-zero on warnings, how many warnings it prints now, how CI runs lint (.github/workflows), and whether lint-staged runs eslint with --max-warnings. Context: spec/features/planned/F143-the-files-that-the-last-tickets-grew-past-400-lines-are-split-by-aggregate-and-a-lint-check-warns-over-400-and-fails-over-800/ticket.md. Answer for the code at HEAD.

Packet:

Packet: How can one file set get a warning over 400 lines and an error over 800 lines in `eslint.config.js`, and what do lint, CI and lint-staged do with warnings today?
Base: 88c37ed3474e45d520ffc61a721a56522e0b4e16
Verified: probe in a temp folder inside the worktree, run with the main checkout's ESLint 9.23.0 -> `801:1  error    File has too many lines (900). Maximum allowed is 800  local/max-lines-error`, and `401:1  warning  File has too many lines (900). Maximum allowed is 400  max-lines` (exit 1)

Unknowns:
- The worktree has no `node_modules`. I ran the probe and `bun run lint` with the main checkout's ESLint (`/home/artek/Documents/repos/email_assistant/node_modules`, same HEAD, 9.23.0). I also ran `bun run lint` there, which only reads files. I put the probe folder in the worktree and removed it afterwards; `git status --short` is empty.
- I did not run lint-staged. I read its config only.

1. Two-level `max-lines` works. ESLint 9.23.0 exports `builtinRules` from `eslint/use-at-your-own-risk`. `builtinRules.has("max-lines")` is true. Register the same rule under a local plugin name and set two severities — observed:
   ```js
   import { builtinRules } from "eslint/use-at-your-own-risk";
   const local = { rules: { "max-lines-error": builtinRules.get("max-lines") } };
   // in a flat-config block:
   plugins: { local },
   rules: { "max-lines": ["warn", 400], "local/max-lines-error": ["error", 800] }
   ```
   A 500-line file gets a warning only. A 900-line file gets both the warning and the error. A 100-line file gets nothing.
2. `eslint .` lints ts (2176), tsx (147), astro (33), mjs (2) and js (1) files — 2359 in all. It lints no json — observed from `eslint . -f json`. The config ignores `**/dist/**`, `apps/web/.astro/**`, `apps/server/src/platform/db/schema.ts`, `.pi/**`, `.omp/**` and everything in `.gitignore` (`eslint.config.js` ignores block). A new block in `eslint.config.js` needs a `files` glob for each type it should cover (`**/*.{ts,tsx,astro,js,mjs}`).
3. `bun run lint` is `eslint .` (`package.json:19`), with no `--max-warnings`. It exits 0 with warnings. The run gave exit 0 and "✖ 11 problems (0 errors, 11 warnings)": 10 `@typescript-eslint/no-unused-vars` and 1 `no-console`. A max-lines warning therefore never fails the lint. Only the error level above 800 does — observed.
4. CI runs `bun run lint` as one step in `.github/workflows/ci.yml:53`, after `bun install --frozen-lockfile`, with no flags. The only lint step in `.github/workflows` is that one — observed.
5. lint-staged (`package.json:134`) runs `eslint --fix` and then `prettier --write` on `*.{ts,tsx,astro}`. It passes no `--max-warnings`, so warnings do not block a commit. The hook is `.husky/pre-commit`: `bunx lint-staged`. Observed.

Checks: `bun run lint` covers all linted files and gives the exit code and the 11 current warnings; it misses any file over 400 lines, because no max-lines rule exists yet. The probe covers the two-severity pattern on synthetic files only. I did not run it against the real config, so I have not seen real files cross either limit.

## Scout 4

Job: `2026-11-20-f143-scout-4-57d0f958`

Question:

> For apps/server/src/main.ts and apps/server/src/web.ts: list the start-up blocks in order (config, features, DB role, SSO check, mail sync, scope targets, operator notices, Telegram, push, jobs, HTTP), which runtime or env switch selects each, what each file exports, who imports those exports (tests, scripts, docs), and which tests cover the start-up order. Also: for packages/core/src/texts/notices.ts, bot.ts, approvals.ts, how textsFor or the text tables are built and how apps/web/src/i18n/texts/ was split by group in F131 (the pattern to copy). Context: spec/features/planned/F143-the-files-that-the-last-tickets-grew-past-400-lines-are-split-by-aggregate-and-a-lint-check-warns-over-400-and-fails-over-800/ticket.md. Answer for the code at HEAD.

Packet:

Packet: start-up block order, exports and importers of `main.ts` and `web.ts`, how the core text tables are built, and the F131 split pattern.
Base: 88c37ed3
Verified: `git status --short | wc -l` -> 0 (read-only held). I read both start-up files and the text files. I did not run the start-up tests.
Unknowns: `main.ts` and `web.ts` have no unit test for the order of the blocks. Only the two integration tests below spawn `main.ts`. Both check log events, not the order of the blocks. I did not run them.

1. `apps/server/src/main.ts` (615 lines, no exports; the entry run by `bun apps/server/src/main.ts`, `package.json` scripts `dev` and `start`) — observed. The blocks run in this order:
   - **Config:** `loadConfigOrExit` (exit 1 on `ConfigError`); log level, format, release; console guard only when `LOG_FORMAT=json`; process guard; `configureMailHosts` from `mailAllowLocal`.
   - **Features:** `featuresOff(config)` from `FEATURES_OFF`, then `configureFeatures`. A warning fires when the old key `WEB_MAIL_ALLOW_LOCAL` is used.
   - **DB role:** `createDb`, then `assertAppRole`. On failure it logs `db_role_check_failed` and exits 1.
   - **SSO check:** `countSsoRequiredWhileKilled` logs `sso_flag_killed_with_sso_required`. A DB error only warns.
   - **Mail sync:** `createSecretBox`, `mailOAuthRuntime`, `createMailSyncJob`; the heartbeat is created; `scheduler.add("mail.sync")` uses `mailSyncCron(config)`; `platform.heartbeat` runs every 5 min. `HEARTBEAT_URL` unset logs `heartbeat_off`.
   - **Scope targets:** runs only when `TRIAGE_LLM_SCOPE`, `ACTIONS_SCOPE` or `SEND_SCOPE` is `all`. It logs `scope_targets`; a DB error only warns.
   - **Operator notices:** `operatorChatId(config)` null means log only, else Telegram through the late-bound `telegram` variable. Jobs `channels.operator` and `ops.slo`. `ops.slo` has five SLO checks and always runs.
   - **Trust re-gate:** `regateAll({run:"start"})` runs before any worker exists. A failure exits 1. Then `trust.regate` is scheduled.
   - **Model-scope jobs:** only when `TRIAGE_LLM_SCOPE` is not `off` (the `triageScope()` result is not null). These are `triage.worker`, `trust.history`, `loops.analyze`, `replies.drafter`, plus the style preview and reply samples.
   - **Always-on jobs:** `trust.tripwire`, `loops.match`, `contacts.refresh`, `replies.sweep`, `actions.committer` (scope from `actionsScope` / `sendScope` / `sendLimits`), `actions.expiry`, `loops.chaser`, `triage.returned`, `platform.retention`, `channels.report_mail`.
   - **Push:** `pushConfigOf(config)` null (no VAPID keys) logs `push_off`; otherwise `channels.push` runs.
   - **Telegram:** `TELEGRAM_BOT_TOKEN` unset logs `telegram_off`. Otherwise `createTelegramRuntime` runs, `channels.notifier` and `channels.digest` are added, and `startPolling` starts. `TELEGRAM_API_ROOT` adds a warning.
   - **HTTP:** `webDeps(...)` (null when the web is off), `createApp`, `Bun.serve({ port: config.PORT })`. Then the shutdown handler (`SIGTERM`/`SIGINT`). `server_listening` is logged last, after the signal handlers.
   - The run state of about 20 jobs is held in top-level `let` variables that `shutdown()` awaits. This is the main growth driver.
2. `apps/server/src/web.ts` (629 lines) — observed. It is the composition root for the web. Exports: `auditWebEvent`, `auditSsoEvent`, `termsAcceptedHandler`, `authMailFailedHandler`, `WebRuntime`, `scopeInfos`, `scopeEnvOf`, `countMailboxes`, `approvalsWaiting`, `onboardingDeps`, `homePathOf`, `statsRouteDeps`, `settingsRouteDeps`, `distPath`, `peerAddress`, `WebExtras`, `apiRouters`, `apiPublicRouters`, `webDeps`. Block order: audit handlers (112-185), scope and count helpers (189-217), onboarding (221-280), stats and settings deps (283-333), static and peer helpers (334-345), `WebExtras` (347), `apiRouters` (369, the route mount list), `apiPublicRouters` (492), `webDeps` (517, null when the web is off). `main.ts` imports only `webDeps`.
3. Importers of `web.ts` exports — observed. `apps/server/src/web.test.ts` imports `distPath`, `peerAddress`, `scopeInfos`. About 30 files in `apps/server/test/integration/` import `auditWebEvent`, `termsAcceptedHandler`, `webDeps`, `apiRouters`, `apiPublicRouters`, `settingsRouteDeps`, `statsRouteDeps`, `onboardingDeps`, `approvalsWaiting`, `countMailboxes` and the types `WebExtras` and `WebRuntime`; examples are `web-two-factor.test.ts`, `web-tenant-scope.test.ts` and `mail-oauth-connect.test.ts`. A split must keep these names exported from `./web` or the tests must change. `main.ts` is imported by nothing. These files read it as text:
   - `apps/server/src/composition.test.ts` (checks the `main.ts` wiring of the history, triage-profile, sender-profile jobs, `isOwnMailOf` and the push sender)
   - `trust-docs.test.ts`, `sender-context-docs.test.ts` and `open-loops-docs.test.ts` (regex `scheduler\.add\("(trust|contacts|loops)\.`)
   - `docs/capabilities/digest-and-notices.md` (table rows `channels.*` pointing at `apps/server/src/main.ts`)
   - `docs/capabilities/web-panel.md` and `deploy/README.md` (they name the log events)
4. Tests of start-up order — observed. `apps/server/test/integration/main-start-log.test.ts` spawns `main.ts` and checks `server_listening` and `triage_scope` JSON lines, exit 0, and exit 1 after a library `console.error` plus an uncaught throw. `main-sso-kill.test.ts` checks that `sso_flag_killed_with_sso_required` is logged once with the kill and not without it. A split must keep the entry file at `apps/server/src/main.ts`. It must keep the job names written as `scheduler.add("<name>"` literals, because the docs tests match them with a regex.
5. Text tables — observed. In `packages/core/src/texts/`, `notices.ts` (599 lines), `bot.ts` (529) and `approvals.ts` (507) each export one const keyed by locale. The names are `noticeTexts`, `botTexts` and `approvalTexts`. Each is `{ en: {...}, pl: {...} } satisfies Record<UserLocale, XTexts>` (`notices.ts:199`, `:385`, `:599`). Each file also holds its interface (`NoticeTexts` at `:33`, `BotTexts` at `:15`, `ApprovalTexts` at `:10`) and Polish plural helpers (`PL_*`). `texts/index.ts:87-122` picks `.en` or `.pl` of each table into `textTables`. `textsFor(locale)` (`index.ts:126`) returns `textTables[locale]`. Only `index.ts` imports the three tables. The F131 pattern (`apps/web/src/i18n/`) is different, because it splits flat key maps: `texts/en-<group>.ts` and `texts/pl-<group>.ts` (10 groups), each exporting `enX` or `plX`. `en.ts` and `pl.ts` (45 and 67 lines) spread them. `texts/groups.test.ts` checks that no key repeats across groups and that each en group has the same keys, in the same order, as its pl group. The core tables are nested, with function values and `en`/`pl` blocks. Nothing in them is a flat spread. A copy needs `notices-en.ts` / `notices-pl.ts` pieces, or sub-objects per area, with `satisfies` kept on the interface. A group test like `groups.test.ts` fits, but with nested keys it must compare the key shape of each en and pl group.

Checks: `apps/server/src/composition.test.ts` and the three `*-docs.test.ts` files cover the `main.ts` wiring text and job-name regexes; they miss the order of the blocks. `main-start-log.test.ts` and `main-sso-kill.test.ts` cover the start log, exit codes and SSO warning; they miss the order of the blocks, Telegram and push on or off, and the `scope_targets` line. `apps/web/src/i18n/texts/groups.test.ts` covers the F131 group rules. `packages/core/src/texts/{bot,index,locale,operator,push,brief}.test.ts` exist; I did not read what they assert about the table shape.
