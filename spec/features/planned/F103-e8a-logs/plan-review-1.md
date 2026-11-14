FAIL 9480681f57d506bb793851f710ddf730596f6c4e

The F103 plan is not ready to build. I found 7 major and 11 minor findings. Five majors are proven: one privacy gap, one acceptance check that can never fail, and three stages whose tests cannot pass as written. HEAD matches the candidate commit. The worktree is clean (`git status --short` printed nothing).

## Pre-mortem: which stage lets the bug through

- **Mail or DB text in the log store:** stages 11, 12 and 14 (M1).
- **Acceptance "CLI output is not in the store" looks proven but is not:** stage 15 (M2).
- **Red CI on `master`:** stages 13 and 14 (M6).
- **Stages that cannot finish as written:** 06 (M4), 13 and 14 (M3), 02 (M5).
- **Stage too big for one job:** 12, and stage 07 is borderline (M7).

## Major findings

**M1. Text from outside our logger reaches the store. No rule covers it. (proven gap)**
- `docs/known-alerts.md:311-317` documents `# SERVER_ERROR: <message and stack>`. It comes from `better-call` through `console.error`, "can hold database text", and "`onAuthError` cannot suppress it".
- `apps/server/src/main.ts` has no `uncaughtException` or `unhandledRejection` handler (grep found none). Bun then prints the error message and stack to stderr.
- `no-console` is only `"warn"` (`eslint.config.js:95`), and warnings do not fail `bun run lint` (F089 P4). So a new `console.log(subject)` in a module passes the lint.
- vlagent ships every byte of the `server` stdout and stderr (plan.md:67, :69). The canary (stage-12:56-73) never plants such a line.
- Fix:
  - In stage 11, set `no-console` to `error` in `apps/server/src`. Today there are 0 warnings, and `log.ts:134` already has its disable comment.
  - Add a process-level guard in `main.ts`: an `uncaughtException`/`unhandledRejection` handler that writes an event with `...errorFields` and exits.
  - In JSON mode, wrap the `console.*` calls of other code so they write a text-free event (`log.ts` keeps the original functions).
  - Add one canary case: `console.error("# SERVER_ERROR: CANARY-…")` must leave no planted text.

**M2. The stage 15 CLI check can never fail. (proven)**
- Stage-15:20 runs `org:status` and expects `"[org-status]"` to be absent from the store.
- But `org-status.ts:51` prints the organization lines with `process.stdout.write`, without the prefix. Its other lines (`:34`, `:44`, `:48`, `:54`, `:64`) are usage text or error text.
- So the query returns 0 even if CLI output does reach the store. Acceptance bullet 4 (ticket.md:30) stays unproven.
- The DB check (stage-15:21, `"database system"`) can also fail to detect a leak. Its start lines come before vlagent starts in step 6, and nobody has checked whether vlagent reads a file from its start (not verified).
- Fix: plant a unique marker after the store is up and search for it. Examples: `$C run --rm cli bun -e 'console.log("f103-cli-<uuid>")'`, and `$C exec db psql -c "select 'f103-db-<uuid>'::int"`, which writes an ERROR line to the `db` log.

**M3. The Compose checks in stages 13 and 14 fail as written. (proven: reproduced with Compose 5.6.1 on the stage YAML in `/tmp/f103-review/deploy`)**
- **Stage-14:69, test 2:** with the flags of stage-14:68 (`--no-env-resolution --no-interpolate`), `config` ignores profiles. `config --no-interpolate --services` printed `db server cli victorialogs vlagent` without `--profile`.
- **Stage-14:68, `mem_limit`:** the value renders as the string `"256m"`. With interpolation it is the string `"268435456"`. It is never the number 268435456.
- **Without `--no-interpolate`:** `config` needs `POSTGRES_PASSWORD`, `MIGRATOR_PASSWORD` and `APP_PASSWORD` (compose.yaml:17-20, 41-42). The test must set dummy values.
- **Stage-13:53, step 1 check:** `.services.cli.environment.LOG_FORMAT` fails with jq "Cannot index array with string". With `--no-env-resolution`, the extended service's environment renders as an array (`["DATABASE_URL=…","LOG_FORMAT=text"]`), while `server` renders as a map.

**M4. Stage 06 tests 2, 3 and 4 depend on behaviour that does not exist. (proven)**
- **Tests 2 and 3:** the linked `/help` path writes no log line. `commands.ts:274` skips the suspend check for `help`, and `bot.ts:99-113` logs only on a failure. So test 2 cannot see two `run_id` values, and test 3 has no line after the `await`.
- **Test 4:** `bot.handleUpdate` never calls `bot.catch`. In grammY 1.46.0 (`node_modules/grammy/out/bot.js:236-244`), it throws `BotError` again. Only the private `handleUpdates` (`bot.js:191-206`, `bot.d.ts:198`) calls `errorHandler`. So no `update_failed` line appears.
- Fix:
  - Use the fake handlers of `telegram-router.test.ts:60-81`: a handler that awaits and then rejects gives `command_failed` after the DB `await` of the link guard; a suspended org with `/status` gives `command_refused_suspended`.
  - For test 4, use `await bot.handleUpdate(u).catch((e) => bot.errorHandler(e))` with a throw outside the handler's own try, for example the `result.send` reply.

**M5. In stage 02, D4 conflicts with D23 and with the code. (proven)**
- Stage-02:64 says none of the 13 scripts may print `error.message`.
- But `telegram-link.ts:37-38` and `web-invite.ts:39-40` (both in that list) print `HardError.message`, which is the script's own text, through `describeFailure`.
- D23 and stage-02:61, :68 require the same printed text byte for byte. The worker must break one of the two rules.
- Fix: D4 should allow the message of a script's own `HardError`.

**M6. The proof for stages 13 and 14 has no typecheck. (plausible CI break)**
- plan.md:159 runs check-logging, lint and `test:unit:ci` only.
- Both stages write `apps/server/src/deploy-logging.test.ts`. That file is in the tsconfig (`apps/server/tsconfig.json` includes `src/**/*`), and CI runs `bun run typecheck` (`.github/workflows/ci.yml`).
- Bun runs tests without a type check. JSON from `spawnSync` under `noUncheckedIndexedAccess` is a likely place for a type error.
- Only stage 11 step 7 checks CI after the land.
- Fix: add `bun run typecheck` to that proof.

**M7. Stage 12 is too big for one job. (plausible)**
- The stage file says about 350 changed lines (stage-12:5). The table says ~300 (plan.md:203), and D22 sets the limit at about 300.
- The stage rewrites five marker tests (1053 lines today) to the JSON form, and adds a helper, a helper test and a six-step canary. The canary copies setup from `actions-end-to-end` (204 lines), `triage-logs` (129), `actions-send-logs` (266) and `telegram-logs` (245).
- Split it: 12a for the helper and the marker tests, 12b for the canary.
- D22's own ratio (25 calls in about 280 lines) puts stage 07 (40 calls) near 450 lines and stages 05 and 09 (36 calls each, plus new code) near 400 lines, against estimates of ~280–300.

## Minor findings

- **m1. Wrong stage counts in the plan table. (proven)** plan.md:193 says "11 scripts (60 calls)" and :195 says "17 scripts (81 calls)". The stage files and the lint at HEAD say 13/55 (stage-02:51, 55), 10/70 and 13/86 (stage-04:7, 11): 36 files, 211 calls. The plan.md:85 totals match the lint (395 calls in 71 files).
- **m2. Line numbers are off by one in many table rows. (proven)** The lint gives the first line of each call, and these rows cite a later line:
  - `composition.ts:32→33`, `committer.ts:301→302`, `expiry.ts:187→188`, `send.ts:122→123`
  - `sender.ts:180→181`, `polling.ts:90→91`, `mail/jobs.ts:42→43, :77→78`
  - `sync.ts:208→209, 406→407, 412→413, 500→501, 605→606`, `tools.ts:274→275`
  - `triage/jobs.ts:136→137`, `pause.ts:30→31`, `triage/service.ts:274→275`, `retention.ts:98→99`, `web.ts:311→312`

  D16 says to match by text, so the effect is small.
- **m3. Event codes conflict with D5 and with existing codes. (proven)** Stage-10:23 creates `web_terms_record_failed`, but `platform/auth.ts:320` already writes `terms_record_failed` for the same failure. `known-alerts.md:47-51` says "search for both", and D5 (plan.md:60) says lines with the same meaning share a code. Also, stage-10:15-20 uses six per-state codes (`actions_scope_off` … `send_scope_all`), while `main.ts:47-54` uses one code, `triage_scope`, with a `scope` field.
- **m4. The D17 grep checks miss headings the stages own. (proven)**
  - Stage-05:103 misses `known-alerts.md:598` (`notices for org`) and :646 (`telegram token rejected`).
  - Stage-08:67 misses :31, :143, :151, :159, :502 and :510.
  - Stage-09:71 misses :55, :71, :385, :393 and :486.
  - The stage-10:59 list leaves out :175, :183 and :199 (`web is off`, `web is on`, `WEB_BASE_URL is http://`).
- **m5. `deploy/README.md` quotes old log texts that no stage updates. (proven)** README:102 (`another process polls this bot token`, stage 06), :394 (`retention org <id>: …`, stage 10) and :478 (`sync <mailbox id> rescan:`, stage 08). D17 covers `known-alerts.md` only.
- **m6. The DNS diagnosis is lost. (proven)** `host-guard.ts:58, 60, 65` put the system code only in the `SoftError` message. After stage 08, `sync_soft_error` carries only `error=SoftError`. The fix at `known-alerts.md:31-37` depends on that difference. Give these errors a `code`, or write down the loss.
- **m7. Old `run … server` commands can still leak. (proven)**
  - D19(c) does not cover the VPS stage files of other tickets: F099 `stage-15-vps-deploy.md:25, 28, 40` run `$C run --rm server …`, and after F103 that output goes into the store.
  - Stage 15 does not check `crontab -l` for the `run … server` form (README:470).
  - stage-15:16 uses `docker ps` without `-a`, so it misses stopped containers whose `json-file` logs the vlagent glob reads.
- **m8. Stage 13 has two different dependencies. (proven)** plan.md:208 says "Stage 13 needs no other stage"; stage-13:3 says "Needs stage 01 landed".
- **m9. Wrong count of `error.message` calls in `mail/jobs.ts`. (proven)** plan.md:86 says "mail/jobs.ts 1 (two calls…)". Stage-08:9 says three reads. In fact four log calls print the message text: `jobs.ts:54`, `:77-79`, `:83` and `:85`.
- **m10. The doc check of `check-logging.sh` is never shown to fail. (plausible)** Stage-13:78 tests a copy of the pattern, not the script. The pattern also misses `run -e KEY=val server`. Let the script read its document list from an env variable, so the test can run it on a temporary file.
- **m11. The `.message` selector misses some forms. (plausible)** It does not catch `(e as Error).message`, `e?.message` or `String(e.message)`. The runtime code rule still drops text with spaces, but a one-token message passes.
- **Note (not counted):** the change to `compose.dev.yaml` recreates the shared dev `db` and `greenmail` containers on the next `up` (CLAUDE.md, shared runtime).

## Checks I ran

| Check | Result |
|---|---|
| `git rev-parse HEAD` | `9480681f…`, matches the candidate |
| `bun install --frozen-lockfile` | exit 0 |
| `bunx eslint apps/server/src -f json` | 395 `no-restricted-syntax` messages in 71 files; per-folder counts match plan.md:85; `no-console` warnings: 0 |
| `bash deploy/check-logging.sh` | `logging ok: db greenmail server` |
| `bun test apps/server/src/platform/log-lint.test.ts apps/server/src/platform/log.test.ts` | 77 pass, 0 fail |
| `docker compose config` on the stage 13 and 14 YAML in `/tmp/f103-review/deploy` | reproduced M3 |
| Reads of grammY 1.46.0 `out/bot.js` and `bot.d.ts` | M4 |
| Source reads cited above | all other findings |

Not run: no `test:unit:ci`, `test:int:ci` or `typecheck`, because this review changes no code. Nothing was checked on the VPS.

## Note check

- HEAD is the candidate commit: proven. `git rev-parse HEAD && git status --short && test -s /tmp/f103-review/lint.json && test -s /tmp/f103-review/deploy/compose.yaml && echo OK` printed `9480681f57d506bb793851f710ddf730596f6c4e` and OK.
- Each finding cites file:line, checked at this commit: proven. Evidence: `/tmp/f103-review/lint.json` (lint at HEAD) and `/tmp/f103-review/deploy/compose.yaml` (Compose repro). The other citations come from reads in this session.
- Pre-mortem names a stage per bug class: proven. See the "Pre-mortem" section of `/tmp/f103-review/final.md`.
- Final message starts with `FAIL <sha>` and ends with the verdict and counts: proven. See `/tmp/f103-review/final.md`. `head -1 /tmp/f103-review/final.md && grep -c "Verdict: FAIL. Major: 7" /tmp/f103-review/final.md && git status --short` printed the FAIL line and 1.
- Easy-to-miss rule "Review; do not rewrite the candidate": followed. Two `&&` commands printed an empty `git status --short`; the last one ran right before this message.

Verdict: FAIL. Major: 7 (5 proven, 2 plausible). Minor: 11.
