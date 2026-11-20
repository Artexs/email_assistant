# F136 scouts

Three scouts (claude-sonnet-5-5, medium), started 2026-11-19 at plan base b3ad2e07. Each packet below is copied whole from the job log. A packet is a lead, not a fact.

## Scout 1 · job `2026-11-19-f136-scout-1-0f05bd12`

**Question.**

> How do ports, the GreenMail address, the Telegram fake and the e2e database reach the panel Playwright run (apps/web/e2e/env.ts, playwright.config.ts, global setup, webServer commands, apps/server/src/scripts/e2e-seed.ts and e2e-seed-args.ts)? List every place that reads E2E_PORT, E2E_TELEGRAM_PORT, GREENMAIL, E2E_DATABASE_URL, and every spec that reads or writes a GreenMail mailbox or SMTP, with the addresses it uses, and whether two runs at once on one GreenMail could see each other's mail. Context: spec/features/planned/F136-every-limen-job-runs-the-playwright-suites-in-parallel-with-no-shared-lock/ticket.md and notes.md. Answer for the code at HEAD.

**Packet.**

Packet: How ports, the GreenMail address, the Telegram fake and the e2e DB reach the panel Playwright run, who reads them, and whether two runs on one GreenMail collide.
Base: b3ad2e07
Verified: `grep -rnE "E2E_PORT|E2E_TELEGRAM_PORT|GREENMAIL|E2E_DATABASE_URL" …` plus reads of `env.ts`, `servers.ts`, `playwright.config.ts`, `e2e-seed.ts` -> `apps/web/e2e/env.ts:15:export const E2E_PORT = 8081;`
Unknowns: Whether the e2e server polls or IMAP-syncs the seeded mailboxes. I did not read the poller. The comment at `e2e-seed.ts:130` says "never polled by a spec". Whether GreenMail auto-creates the `anna@example.com` recipient with auth disabled: guessed from the compose flags, not run. `apps/web/e2e/docs-shots/shots.spec.ts` was grepped for connect/greenmail/3025 and has none. I did not read it in full.

1. **Ports, hardcoded in one file.** `apps/web/e2e/env.ts:15-26` defines `E2E_PORT=8081`, `E2E_TELEGRAM_PORT=8092` and `GREENMAIL={host: TEST_IMAP_HOST ?? "127.0.0.1", imapPort:3143, smtpPort:3025}`. No env var overrides the ports. `E2E_PORT` becomes the server `PORT` (`env.ts:71`). `E2E_TELEGRAM_URL` becomes `TELEGRAM_API_ROOT` (`env.ts:~100`). — observed
2. **Readers of each name.**
   - `E2E_PORT`/`E2E_BASE_URL`: `env.ts`, `servers.ts:23` (health URL), `playwright.config.ts:21` and `docs-shots.config.ts:24` (baseURL), `helpers.ts:85`, and about 20 specs as origin/baseURL. The specs are account, account-delete, activity, approvals, auth, delegates, notify, plan, push-devices, reply-style, settings, telegram-detail, two-factor, urgencyzz-review, plus `docs-shots/shots.spec.ts`.
   - `E2E_TELEGRAM_PORT`: `servers.ts:10` (the `fake-telegram serve --port` command) and `env.ts`. `apps/docs/scripts/shot-run.test.ts:35` asserts that string in `servers.ts`.
   - `E2E_TELEGRAM_URL`: `servers.ts:12`, `onboarding.spec.ts:60`, `telegram-detail.spec.ts:125,267`.
   - `GREENMAIL`: only `helpers.ts:118-121` (`connectGreenMail`).
   - `TEST_IMAP_HOST`: `env.ts:26` and `e2e-seed.ts:126`. `e2e-seed.ts:147-150` hardcodes ports 3143 and 3025 and does not use `GREENMAIL`.
   - `e2e-activity-rows.ts:319-322` writes 127.0.0.1:3143/3025 as data only.
   - `E2E_DATABASE_URL`/`E2E_MIGRATOR_DATABASE_URL`: only `env.ts:61-62` (`e2eEnv()`, checked by `seedTargetOk`). It becomes `DATABASE_URL`/`MIGRATOR_DATABASE_URL` for `db:migrate`, the server (`servers.ts:19-26`, `env` passed), the seed (`global-setup.ts`) and specs that call `e2eEnv()` (activity, notify, plan, push-devices, telegram-detail, two-factor, `helpers.ts`). Outside e2e: `.env.example:157`, `ci.yml:94`, `docs-deploy.yml:85`, and `test/integration/e2e-seed.test.ts:87`.
   — observed
3. **Fixed locks on ports.** Both webServers use `reuseExistingServer: false` (`servers.ts`). A second run fails on 8081 or 8092. The CLAUDE.md `flock` is the only guard. `workers: 1` and the seed's `wipe()` (by fixed org names, `e2e-seed.ts:~190`) also make a shared DB unsafe. — observed
4. **GreenMail use: only 5 specs and the seed.**
   - Specs: `activity`, `mailboxes`, `onboarding` and `settings` call `connectGreenMail`. It logs in as `e2e-<project>@e2e.test` (`helpers.ts:79`), project = `mobile` or `desktop`, password `e2e-mailbox-password`, on 3143/3025. `account-delete` and `delegates` use `mailboxAddress` only. I did not check whether they connect it. `onboarding` also calls `connectGreenMail`. `approvals.spec.ts:476` (the "edit and approve" test) sends through the server committer (SMTP 3025). It reads no mailbox directly.
   - Seed mailboxes on 127.0.0.1:3143/3025 via `seedAssistMailbox`: `e2e-{approvals,delegates,delegations,open-loops,trust,review,newsletters,suggestions,loops,reply-panel}-<project>@e2e.test`. Also `e2e-urgency-…` (seeded/empty), report and reply-style (box/oauth) variants. `del-phone@x.test` and `del-desktop@x.test` are inserted directly at `e2e-seed.ts:371`.
   - Send target: `anna@example.com` (`E2E_SEND_TEST_ADDRESS`, `SEND_SCOPE=self`).
   No spec uses `imapflow`, `nodemailer` or a GreenMail API. — observed (addresses and callers); guessed (what each non-`connectGreenMail` spec does with its mailbox)
5. **Two runs on one GreenMail would collide.** Addresses are fixed per project, not per run. GreenMail runs with `-Dgreenmail.auth.disabled` (`compose.dev.yaml:25`, `ci.yml:87`), so any login hits the same user store. Two runs share `e2e-mobile@e2e.test`, `e2e-approvals-mobile@e2e.test` and `anna@example.com`. A draft in `Drafts` or a sent mail from one run lands in the other's INBOX or `Drafts`. The approvals test waits for a committer-made copy in the mailbox, so a second run could satisfy or break it. DB, ports and seed collide first, so GreenMail is the second blocker. — guessed (from the fixed addresses and flags, not run)

Checks: `apps/docs/scripts/shot-run.test.ts` covers the shared servers, `workers:1` and the literal `--port ${E2E_TELEGRAM_PORT}` command in `servers.ts`; it misses any port or address that varies per run. No existing test covers two concurrent runs.
Packet: unchanged from my previous message. The note check follows.

## Note check
- Every reader of E2E_PORT, E2E_TELEGRAM_PORT, GREENMAIL, E2E_DATABASE_URL: not proven. I ran the grep in a call that used `;` and `|`, so it does not count. I saved no log for it. The reader lists in the packet come from that grep and from file reads.
- Every spec that uses GreenMail IMAP/SMTP, with addresses: proven for the `connectGreenMail` and `seedAssistMailbox` callers. Evidence: `/tmp/f136-scout-greps.log`, from a call with only `&&` that exited 0. Not proven for what `account-delete` and `delegates` do with `mailboxAddress`, because I did not read those specs.
- Two runs on one GreenMail see each other's mail: not proven. I did not run two runs. The claim rests on the fixed addresses in `apps/web/e2e/helpers.ts:79` and `e2e-seed-args.ts`, on the auth-disabled flag in `deploy/compose.dev.yaml`, and on the packet's guess that GreenMail auto-creates users.
- Easy-to-miss rule, "Do not edit, create, or delete files": followed. The `test -z "$(git status --short)" && grep … > /tmp/f136-scout-greps.log && wc -l …` call exited 0, so the worktree was clean at that point. The only file written is the log under `/tmp`, outside the worktree. The note itself lives in the job folder outside the worktree.

The previous note said "Not proven yet: none". That was too strong, and the lines above correct it.
[limen 2026-11-19T22:08:43.054Z] done: pi exited 0

## Scout 2 · job `2026-11-19-f136-scout-2-afb38688`

**Question.**

> How does the docs browser check (bun run docs:test, apps/docs/e2e/site.ts and its Playwright config) choose and serve its port 8093, and how do the CI workflows (.github/workflows) run test:e2e and docs:test (env, ports, services, DB)? Also: which package.json scripts start these suites and do they accept env overrides now? Context: spec/features/planned/F136-every-limen-job-runs-the-playwright-suites-in-parallel-with-no-shared-lock/ticket.md and notes.md. Answer for the code at HEAD.

**Packet.**

Packet: How docs:test and test:e2e pick and serve their ports, how CI runs them, and whether the scripts take env overrides
Base: b3ad2e07
Verified: `git status --short` -> no output (worktree clean). I ran no suite. All findings are file reads.
Unknowns: none for the question. I did not read `apps/web/e2e/servers.ts` in full, and I did not read `docs-deploy.yml` beyond lines 55–130.
1. docs:test port — observed. `apps/docs/e2e/site.ts:7` sets `DOCS_TEST_PORT = 8093` as a constant, with no env read. `DOCS_TEST_HOST` is `127.0.0.1`.
   - `DOCS_LOCAL_ORIGIN` is built from the host and port at `site.ts:11`.
   - `serve.ts:68` calls `Bun.serve({hostname, port: DOCS_TEST_PORT})`.
   - `playwright.config.ts` has a `webServer` that runs `bun apps/docs/e2e/serve.ts`. It waits on `${DOCS_LOCAL_ORIGIN}${DOCS_BASE}/`.
   - It sets `reuseExistingServer: false`, so a busy port fails the run. It also sets `workers: 1`.
   - It reads `apps/docs/dist` (or `EA_DOCS_DIST_DIR`), so `docs:build` must run first.
2. docs:test env overrides — observed. The port cannot change.
   - `DOCS_TEST_URL` skips the local server and opens a published site instead.
   - `EA_DOCS_DIST_DIR` changes the build folder.
   - `CHROMIUM_PATH` sets the browser.
   - `DOCS_TEST_URL` is not a port override.
3. test:e2e ports and env — observed. `apps/web/e2e/env.ts:15` sets `E2E_PORT = 8081` and `env.ts:21` sets `E2E_TELEGRAM_PORT = 8092`. Both are constants.
   - `env.ts:71` passes `PORT: ${E2E_PORT}` to the server.
   - `servers.ts:10` starts the fake Telegram with `--port ${E2E_TELEGRAM_PORT}`.
   - `playwright.config.ts` sets `baseURL` from the constant and `workers: 1`.
   - Env reads exist only for the DB: `E2E_DATABASE_URL` and `E2E_MIGRATOR_DATABASE_URL` (`env.ts:61–62`). `TEST_IMAP_HOST` is also read, and `CHROMIUM_PATH` is read in `servers.ts:35`.
   - So the DB is overridable by env and the ports are not.
4. Scripts — observed. `package.json:27` has `docs:test` = `bunx playwright test -c apps/docs/e2e/playwright.config.ts`. Line 30 has `test:e2e` = `bunx playwright test -c apps/web/e2e/playwright.config.ts`.
   - Neither script passes a port flag or env, and neither runs `ci-bun.sh`.
   - `apps/web/e2e/docs-shots.config.ts` also uses `e2eWebServers`, so it shares the 8081 and 8092 ports. The script `docs:shots` starts it.
5. CI — observed.
   - **`ci.yml` job `e2e` (line 68):** services are Postgres 17 and GreenMail 2.1.15, as job service containers.
     - Env is `TEST_IMAP_PORT=3143`, `TEST_IMAPS_PORT=3993`, `TEST_SMTP_PORT=3025`.
     - The DB is `email_assistant_e2e` on `localhost:5432`, via `E2E_DATABASE_URL`, `E2E_MIGRATOR_DATABASE_URL`, `DATABASE_URL` and `MIGRATOR_DATABASE_URL`.
     - Steps: roles and DB create with psql, `bunx playwright install --with-deps chromium`, then `bun run test:e2e` (line 118).
   - **`ci.yml` job `docs` (line 163):** it has no services, no DB and no env. Steps: `docs:build`, `docs:stale`, playwright install, `docs:test` (line 192). Each CI job runs on its own runner, so the fixed ports never collide there.
   - **`docs-deploy.yml`:** the shots job (line 55) copies the services and env of the `e2e` job. It makes the screenshots and runs `docs:test` (line 123). A separate job runs every `ci.yml` job first.
Checks: none run. The tests named by `apps/docs/scripts/shot-run.test.ts` touch `e2eWebServers`; I did not run them. They miss any port env override, which does not exist yet.

## Scout 3 · job `2026-11-19-f136-scout-3-1ac5ae68`

**Question.**

> What does scripts/limen-prepare.sh do now (DB creation, env files written, names derived from the job), and how do stage proofs of open plans make their e2e DB by hand (grep spec/features/active and planned for _e2e and email-assistant-shared-tests.lock)? List every file and stage file that contains the text email-assistant-shared-tests.lock, and the open (not done) stages of F121 with their Proof lines. Also list the e2e test files that F125 stages plan to cut or merge. Context: spec/features/planned/F136-every-limen-job-runs-the-playwright-suites-in-parallel-with-no-shared-lock/ticket.md and notes.md. Answer for the code at HEAD.

**Packet.**

Packet: What limen-prepare.sh does, where the shared lock text appears, F121 open stages and Proof lines, F125 e2e cuts
Base: b3ad2e07
Verified: `git status --short` (worktree) -> empty output; `grep -rln "email-assistant-shared-tests.lock" .` -> 36 files, listed below
Unknowns:
- F125 names no e2e file to cut or merge. Its stage 06 plans a static review of `apps/web/e2e` ("12 files, about 41 cases"). The rule is `DELETE-DUP` when an e2e case only repeats an int or unit check, and the output goes to `audit/review-int-e2e.md` § e2e. The review has not run. At HEAD, `apps/web/e2e/tests` holds 37 `*.spec.ts` files, not 12.
- "Open stages" of F121: no stage landed. The only F121 commit is the refresh/move to active (`b3ad2e07`). I treat all 12 stages as open.
- I wrote the job note outside the worktree, as the harness asked. `git status` in the worktree stays clean.

1. `scripts/limen-prepare.sh` — runs only in a job worktree and refuses the main checkout.
   - **DB name:** from `LIMEN_JOB_ID`, lowercased, `<date>-<hash>`. Example: `2026-11-19-f136-scout-3-1ac5ae68` becomes `2026-11-19-1ac5ae68`. It must match `^[a-z0-9][a-z0-9_-]*$` and be ≤ 40 characters.
   - **Env:** copies `$root/.env` to `./.env` without `DATABASE_URL` and `MIGRATOR_DATABASE_URL`. It uses a temporary `.env.base-db` (removed on exit) to call `bun run db:worktree "$name"`. It appends the two printed URLs to `./.env` and checks that there are exactly 2.
   - **Other steps:** runs `bun install --frozen-lockfile`. It prints `limen-prepare: own DB ready (db:worktree name: $name)`.
   - **Not done:** it does not set `E2E_DATABASE_URL` or `E2E_MIGRATOR_DATABASE_URL`, no Playwright ports, no mail addresses. It does not drop the DB (`bun run db:worktree <name> --drop` by hand). — observed
2. Hand-made e2e DBs in open plans (grep `_e2e` in `spec/features/active` and `planned`): only two stage files, plus the F136 notes.
   - `active/F115-e6a-reply-drafts/stages/stage-11-style-card.md:29`: "Own e2e DB first (as F102 web stages do, name `f115_s11_e2e`). Never `web:dev`."
   - `active/F115-e6a-reply-drafts/stages/stage-15-panel-reply.md:38`: name `f115_s15_e2e`.
   - `planned/F136-…/notes.md:6` says `seedTargetOk` (`apps/server/src/scripts/e2e-seed-args.ts`) accepts any name ending in `_e2e`, and that the F102 `plan.md` § Proof names its DBs `f102_sNN_e2e`. — observed
3. Files containing `email-assistant-shared-tests.lock` (36).
   - **Root and code:** `CLAUDE.md`, `.agents/limen/styleguide.md`, `docs/code-patterns.md`, `spec/build.md`, `apps/docs/scripts/shot-run.test.ts`, `apps/web/e2e/docs-shots.config.ts`.
   - **Notes:** `notes/2026-11-15-f112-s06-browser-check.md`, `notes/2026-11-19-board-audit.md`, `notes/2026-11-19-f118-s12-settings-cards.md`, `notes/2026-11-20-replan-parallel.md`.
   - **Active and planned, F121:** `plan.md`, `scouts.md`, `stages/stage-02`, `03`, `04`, `05`, `07`, `10`, `11`, `12` (all under `spec/features/active/F121-e10b-public-pages-and-demo/`).
   - **Active and planned, other:** `active/F115-e6a-reply-drafts/stages/stage-11-style-card.md`, `stage-15-panel-reply.md`; `active/F124-…/plan.md`; `planned/F136-…/ticket.md`.
   - **Done (in `spec/features/done/2026-11/`):** `F071-limen-transition/sdlc-review-2026-11-13.md`, `F082-s6b-public-login/plan.md`, `F092-rls-safety-net/plan.md` and `stages/stage-03-web-scope.md`, `F093-ci-green/stages/stage-03-rules-and-numbers.md`, `F098-…/plan.md`, `F101-panel-to-astro-7/plan.md`, `F102-e4-a-act-from-the-panel/plan.md`, `F105-…/plan.md` and `stages/stage-12-e2e.md`, `F106-…/stages/stage-11-e2e.md`, `F107-e7-t4-papers-and-cost/plan.md`, `F110-e4-b-earn-trust/plan.md`, `F112-e10a-docs-site/stages/stage-06-browser-check.md`, `stage-11-shot-run.md`, `stage-15-panel-ui.md`, `F118-…/stages/stage-04-pwa-shell.md`. — observed
4. F121 Proof lines. The shared Proof is in `plan.md:60-66`, in all 12 stages. The `NN` in the log path is the stage number:
   `mkdir -p /tmp/f121-sNN && bun run lint > …/lint.log 2>&1 && bun run typecheck > …/typecheck.log 2>&1 && bun run test:unit:ci > …/unit.log 2>&1 && bun run docs:build > …/docs.log 2>&1 && echo PROOF_OK`
   - Each stage ends "Proof prints `PROOF_OK`" (01 to 12).
   - Stages 07, 10, 11 and 12 add a Playwright link under the lock:
     - 07: `flock /tmp/email-assistant-shared-tests.lock bun run docs:shots > /tmp/f121-s07/shots.log 2>&1`
     - 10: `flock … bun run demo:record --out tmp/demo > /tmp/f121-s10/record.log 2>&1`
     - 11: `flock … bun run docs:test > /tmp/f121-s11/site.log 2>&1`
     - 12: `flock … bun run docs:test > /tmp/f121-s12/site.log 2>&1`
   - Stage 02 (and 03) mention "Playwright (`docs:test`): lock rule until F136 lands". `plan.md:57` says "F136's last stage edits the open stage files." — observed
5. F125 stages (01–07, `planned/F125-…/stages/`) plan no named e2e file cut. See Unknowns. Stage 01 classifies e2e rows as `kind: e2e` (`apps/web/e2e/`). Stage 06 step 2 reviews them statically and does not run `test:e2e`. Stage 07 writes the report and rule. — observed

Checks: the grep and file reads cover the lists above. They miss any lock text outside the worktree and any stage state kept only in the board. I did not run any test suite.
