# F093 · CI green: plan

> **Status 2026-11-13 — planned.** Planning in progress (see "Planning progress"). Nothing is built.

Ticket: [ticket.md](ticket.md). Defaults to confirm: [questions.md](questions.md).

## Planning progress

- [written] Collect, facts, probes (2026-11-13; probes in `.probe-f093/` of the planner worktree, not committed).
- [ ] Stage 1 — `stages/stage-01-bun-pin-and-fakes.md`
- [ ] Stage 2 — `stages/stage-02-waits-and-integration.md`
- [ ] Stage 3 — `stages/stage-03-rules-and-numbers.md`
- [ ] Cold review (`plan-review-1.md`)

## Input

The owner's plan input (written 2026-11-13 from the architecture review, `docs/product/stage-2/06-architecture-review.md` §3.1), word for word:

> ## Why now
>
> `gh run list --limit 40` on 2026-11-13: 36 failures, 0 successes, 4 running. The latest failure is the unit job: `[scheduler] throws failed: Error` lines, then the assertion `runs >= 2` after a fixed 2.5 s sleep on a slow runner. The e2e and image jobs pass. With about 250 Stage 2 stages landing through parallel lanes, a red `master` hides every new regression. The S6f plan (`tasks/planned/s6f-hosted-production.md`) owns the fix today; that is weeks away.
>
> ## Facts to check first
>
> - The exact failing tests of the last five runs: `gh run view <id> --log-failed | grep "(fail)"`. The review saw the scheduler test; the S6f file names `runSend > 3` and `holdResponseNext`; `docs/known-alerts.md` has the `mailbox:seed` CLI entry (30 s own timeout).
> - Whether `bun test` on the runner is slower than 2× local (the scheduler test sleeps 2.5 s for two 1 s ticks; a 1.2 s tick drift fails it).
>
> ## Design decisions
>
> - **D1 Condition waits, not longer sleeps.** A test that waits for time-driven code polls its condition every 25 ms up to a bound (5 s), then asserts. Longer sleeps make the suite slow and still fail on a slow runner.
> - **D2 Inject the clock where the code allows it.** `createScheduler` takes croner patterns; the test of "a throwing job does not stop the next tick" needs only two ticks: poll until `runs >= 2`. The outbox sender and the AgentMail fake tests take `now` and `sleep` already in places (`createLlmClient` pattern): use injected timers there instead of real waits.
> - **D3 Quarantine rule.** A test that fails twice in CI without a code change gets `test.skip` with a comment that names the ticket, the same day, in a one-line commit. `master` is green or the next commit fixes it. No automatic retries in CI: a retry hides a real race.
> - **D4 Measure.** Record the unit and integration run times in `spec/build.md` § TRACK after the fix, so a slowdown is visible.
>
> ## Done when
>
> - Three consecutive green CI runs on `master` without a re-run.
> - No fixed `sleep` over 100 ms in the three tests.
> - The quarantine rule is in both rule files; the alert entry is closed.

D1–D4 are the owner's decisions and stay. The facts below show that the cause is not runner speed (see "Differences found at collect"), so D5–D14 add the design for the real cause. Owner decisions on the planner role (2026-11-13, `notes/2026-11-13-limen-planner-role.md`): small questions get a default in `questions.md`; a plan without `needs-adam` builds without a new owner OK.

## Differences found at collect (2026-11-13)

1. **The failures are not timing flakes.** The same five tests fail in every CI run since 2026-11-12 21:17 (two of them since 2026-11-08), each at the 5 s default limit. They fail the same way on this PC under Bun 1.3.14 and pass under Bun 1.4.4 (F2, F4). The cause is a Bun version drift: CI and the server image run 1.3.14; this PC and every Limen worker run 1.4.4.
2. **The scheduler test does not fail.** The `[scheduler] throws failed: Error` lines are the expected stderr of `scheduler.test.ts` (it tests that line). The input's "Why now" read them as the failure (F3). The scheduler tests stay in scope (D1, acceptance: no fixed sleep over 100 ms).
3. **Three STARTTLS tests fail too**, not named in the input (`smtp-starttls.test.ts`, since F049 landed on 2026-11-12) (F2, F6).
4. **The CI integration suite has not run since 2026-11-08.** `test:unit` fails first, so `db:migrate`, `test:int` and `web:build` in the `ci` job are skipped (F1). The integration state on the pinned Bun is unknown (NV1).
5. **The alert entry has the wrong cause.** `docs/known-alerts.md` says the two AgentMail tests are "slow on a CI runner" and proposes a longer timeout. The real cause is a hang (F5). The `mailbox:seed` entry is already `fixed` (F046) and needs no change.

## Facts checked (2026-11-13)

Sources: `gh run list` / `gh run view --log-failed` on this repo; local probes with the official Bun 1.3.14 binary (`github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-linux-x64.zip`) and the PC's Bun 1.4.4; Node 26.13.1; nodemailer 10.3.1 and croner from `node_modules`.

- **F1 CI history.** The last 200 `master` runs: 44 success, 156 failure. Last green: run 42432181028, 2026-11-08T00:58Z. Ten sampled failures from 2026-11-08 to 2026-11-13 and the eight latest all stop at the step `Run bun run test:unit` of job `ci`. Jobs `e2e` and `image` pass. Run 43406087169: `ci` 2m09s (stopped at unit; `Ran 1873 tests across 143 files. [55.83s]`), `e2e` 2m47s, `image` 36s.
- **F2 The failing tests.** In each of the eight latest runs, exactly these five, each at 5000–5207 ms: `runSend > 3: a lost response is repeated with the same key`; `AgentMail fake > holdResponseNext: the client times out, the mail is stored, a repeat returns the stored id`; `STARTTLS against a scripted server with a self-signed certificate >` `verifySmtpLogin upgrades first …`, `openSmtpSender sends after the upgrade`, `an untrusted certificate is refused and no password goes out`. Runs from 2026-11-08 to 2026-11-12 22:33 show only the first two. The AgentMail ones print `^ a beforeEach/afterEach hook timed out for this test.`
- **F3 The scheduler lines.** `scheduler.test.ts` tests 2 and 3 make a job throw on purpose; `[scheduler] throws failed: Error` is the logged label. The four scheduler tests pass under 1.3.14 and 1.4.4.
- **F4 Version drift.** `.github/workflows/ci.yml` sets `bun-version: 1.3.14` in jobs `ci` and `e2e`; `deploy/Dockerfile` line 1 is `FROM oven/bun:1.3.14` (since 2026-11-03). `bun --version` on this PC: 1.4.4 (also in `notes/2026-11-10-web-foundation-build.md`). Local `bun run test:unit`: 1873 pass, 28.9 s. Local `bunx bun@1.3.14 run test:unit`: 1868 pass, the same 5 fail, 54.4 s.
- **F5 Cause A (AgentMail fake).** Under 1.3.14, `server.stop(true)` of `Bun.serve` waits for in-flight handlers. The fake's `stop()` calls `clearTimeout` on the hold timer, so the held handler never resolves and `afterEach(fake.stop)` hangs. Under 1.4.4, `stop(true)` returns at once. Probe: a held handler whose timer is cleared → `stop(true)` still pending after 3 s on 1.3.14, 0 ms on 1.4.4. Fix probed: `stop()` resolves each held wait (and clears its timer) before `server.stop(true)`. With it, `fake.test.ts` 11/11 and `send.test.ts` 21/21 pass on both versions; test 3 takes 202 ms.
- **F6 Cause B (STARTTLS fake server).** Under 1.3.14, a server-side `new TLSSocket(socket, { isServer: true, key, cert })` on an accepted `node:net` socket never finishes the handshake (client: `TLS handshake timed out`). Also with `secureContext: createSecureContext(...)`, with `server: tls.createServer(...)`, and with `socket.pause()` first. The same server under Node: OK. Fix probed: at `STARTTLS`, the fake pauses the plain socket, connects to a local `tls.createServer({ key, cert })` on a second port, pipes both ways, then answers `220`. It works under 1.3.14 and 1.4.4 (server side).
- **F7 Bun 1.3.14 client quirk.** `tls.connect({ socket, host: "127.0.0.1", ca })` (a STARTTLS upgrade to an IP host, no `servername`) checks the certificate against `localhost`: `Hostname/IP does not match certificate's altnames: Host: localhost. is not cert's CN: 127.0.0.1`. Implicit TLS (`tls.connect({ host: "127.0.0.1", ca })`) is correct. Under 1.4.4 both are correct. With a host name the guard sets `servername` (`host-guard.ts` returns `{ host: <address>, servername: <name> }`): a probe with `servername: "mail.probe.test"` passes on 1.3.14, a wrong `servername` is refused on both. So production STARTTLS to a DNS name is correct; STARTTLS to an IP-literal host fails the name check on the image runtime (it fails closed). The test fix: the test certificate's SAN holds `IP:127.0.0.1,DNS:localhost`. With F6's relay and this SAN, `smtp-starttls.test.ts` 9/9 passes on 1.3.14 and 1.4.4 (probe copy of the file, all assertions unchanged).
- **F8 Pinned runner.** `bunx bun@1.3.14 run <script>` runs the script and every child `bun` under 1.3.14 (probe: `bun --version` inside a script prints 1.3.14; `process.execPath` is `~/.cache/.bun/install/cache/.bunx-1000/bun@1.3.14/…`). First download 2.2 s, then cached. It writes no file into the repo (`git status` clean). `bunx bun@1.3.14 test <file>` reproduces the CI failure.
- **F9 `oven-sh/setup-bun@v2`** (`action.yml` at ref `v2`) has the input `bun-version-file` (example values `package.json`, `.bun-version`, `.tool-versions`).
- **F10 Scheduler design probed.** The four scheduler tests rewritten with a gate promise, the debug "skipped" line (`setLogLevel("debug")` + `spyOn(console, "log")`), and a witness scheduler for `stop()`: 4/4 pass, two runs on each version, 7.4–8.0 s per file, no fixed sleep. `platform/log.ts` writes `debug` with `console.log` only when the level is `debug`; `setLogLevel` is global, so the test restores `info`.
- **F11** The `e2e` job runs `db:migrate` and `web:build` on 1.3.14 and passes in every recent run: both work on the pinned Bun.
- **F12** `apps/server/test/integration/telegram-logs.test.ts:99` has a local `waitFor` (50 ms × 100). Shared test code under `apps/server/test/` is imported from `src` tests already (`modules/mail/fake/fake.test.ts` imports `../../../../test/contract/mail-provider`); `apps/server/tsconfig.json` includes `test/**/*`. `bun test` preloads `apps/server/test/preload.ts` (root `bunfig.toml`), which sets `configureMailHosts({ allowLocal: true })`; with it the guard returns `{ host }` without `servername`.
- **F13** `gh run list --json attempt` gives the attempt number of a run: a re-run has `attempt` 2 or more.

## Not verified

- **NV1** `bun run test:int` under Bun 1.3.14 (this job may not run `test:int`; CI has not run it since 2026-11-08). Stage 2 step 3 runs `bun run test:int:ci` and reads the first CI run after stage 1.
- **NV2** That `setup-bun` with `bun-version-file: .bun-version` installs 1.3.14. Stage 1 checks the log of the first CI run after its land (the step prints the version).
- **NV3** Whether F7 also hits IMAP STARTTLS (imapflow) to an IP host. Out of scope; recorded in the note for the Bun upgrade follow-up (Q1).

## Design decisions

D1–D4: the owner's, above. The added decisions:

- **D5 One Bun version, one file.** `.bun-version` holds `1.3.14` (the version CI and the image run today). CI reads it (`bun-version-file: .bun-version` in both `setup-bun` steps). The `image` job checks that `deploy/Dockerfile` line 1 is `FROM oven/bun:<that version>`. Why: the drift hid five broken tests for five days while every worker's local proof was green. Rejected: upgrade to 1.4.4 inside this ticket (a production runtime change needs a deploy and its own checks; Q1, follow-up). Rejected: a Docker `ARG` for the version (the VPS Compose build needs a default anyway, so the version is still written twice).
- **D6 Pinned scripts.** `scripts/ci-bun.sh` runs `bunx bun@<.bun-version> "$@"`. `package.json`: `"test:unit:ci": "bash scripts/ci-bun.sh run test:unit"`, `"test:int:ci": "bash scripts/ci-bun.sh run test:int"`. The check line in the styleguide, `CLAUDE.md` and `docs/code-patterns.md` uses them (stage 3), so every later worker proves on the CI Bun. Why: F8; it costs about 25 s more per unit run. Rejected: a preload warning when versions differ (a line nobody reads, no gate). Rejected: run both versions (doubles the time; the image runs only the pin).
- **D7 Fix the hang, not the limit.** The two AgentMail tests and the three STARTTLS tests hang forever on 1.3.14; a longer per-test timeout (the old alert's fix) cannot help. The fakes change (D8, D9); the test assertions do not.
- **D8 AgentMail fake.** `startFakeAgentMail().stop()` releases every held response (resolve the wait, clear its timer), then calls `server.stop(true)`. A held response that is released after `stop()` goes to a closed connection; nobody reads it. Doc comment of `holdResponseNext` says so. Rejected: `server.stop(false)` (keeps the port open while a test waits; the test "stop closes the port" needs a closed port).
- **D9 STARTTLS fake.** The scripted server keeps its plain phase. At `STARTTLS` it relays the socket to a second local server made with `tls.createServer({ key, cert })` that runs the same command handler with `tls = true` (F6). The test certificate's SAN is `IP:127.0.0.1,DNS:localhost` (F7), with a comment that names the Bun 1.3.14 quirk and says: remove `DNS:localhost` when `.bun-version` moves past 1.3. Every assertion of the four STARTTLS tests stays as it is; they are the proof that no password goes out before TLS. Rejected: give the loopback guard path a `servername` (product change in the host guard; F084 froze its policy).
- **D10 One wait helper.** `apps/server/test/wait-for.ts` exports `waitFor(condition: () => boolean, what: string, opts?: { timeoutMs?: number; everyMs?: number }): Promise<void>`; defaults 5000 and 25 (D1); it throws `Error(\`waitFor: ${what} not true after ${timeoutMs} ms\`)`. New and changed tests use it. The local helper in `telegram-logs.test.ts` stays (no mass edit).
- **D11 Scheduler tests** as probed (F10): a gate promise instead of a sleep inside the job; the "skipped" debug line as the overlap signal; `runs >= 2` for the throwing job; the error line for the label test; a second, running "witness" scheduler with two ticks as proof that time passed for `stop()`. No change in `scheduler.ts`.
- **D12 Integration on the pinned Bun (stage 2 step 3).** The worker runs `bun run test:int:ci` and reads the first CI run after stage 1. For each failing test it finds the cause and acts by this table:

  | Cause | Action |
  | --- | --- |
  | Test code or a test fake (as F5, F6), or a fixed sleep | Fix the test or the fake in this stage (D1, D10). |
  | Bun 1.3.14 behaviour that also reaches product code on the image | Stop. Report the test, the cause, the evidence. No product change. The coordinator applies D3 (quarantine with a ticket). |
  | A real product bug | Stop and report, as above. |
  | Cannot find the cause in 30 minutes | Stop and report, as above. |

  At most three distinct causes are fixed in stage 2; more → stop and report the list, and the coordinator adds a stage 2b with the same rules.
- **D13 The quarantine rule (D3 made exact).** Text for `docs/code-patterns.md` and the styleguide is in stage 3. Who: the coordinator watches CI after each land. "Without a code change" = the test file and the code it tests did not change between the two failing runs. The coordinator creates the ticket (`limen ticket new "<test> passes on the pinned Bun" --lane planned`) and adds `test.skip(…)` with the comment `// Quarantined <date>: fails in CI without a code change. Fix: spec/features/planned/FNNN-slug/` in one commit. No CI retry, no re-run as the fix, no longer timeout as the fix.
- **D14 Numbers and the end.** Stage 3 reads the CI times of the green `master` runs (`gh run view <id> --json jobs`) and writes them into this file's Log and its final message, with the TRACK line text. Workers do not edit `spec/build.md`: TRACK is coordinator prose. The coordinator adds the line at the stage 3 land. The ticket stays open (`--keep-open`) until three runs in a row on `master` are green with `attempt` 1; then `limen ticket done F093`.

Edge cases:

- **Two runs at once:** CI runs per push; the auto-push hook pushes each `master` commit, so runs overlap. A green run counts only when its `headSha` is on `master`; three in a row = the three latest completed runs on `master`.
- **A run in progress** does not count and does not break the row.
- **Restart and repeat:** the fakes are per test; `stop()` twice must not throw (the AgentMail test that stops its own instance also has the `afterEach` stop of the shared one, not the same instance).
- **Clocks:** croner ticks on the wall clock each second; every wait has a 5 s bound and the test limit stays 10 s.
- **Secrets:** the STARTTLS test password `pw-secret-1` and the AgentMail key are test values; no real key, no `.env` read. The STARTTLS assertions that the password never goes out in plain text stay word for word.

## Done when

1. `bun run test:unit:ci` passes: 0 fail, and the five tests of F2 pass (stage 1 log).
2. `bun run test:int:ci` passes, or each failing test is quarantined by D13 with a ticket (stage 2 log and final message).
3. `.bun-version` is the one source: both `setup-bun` steps use `bun-version-file: .bun-version`, no `bun-version:` line is left, and the `image` job checks the Dockerfile tag.
4. `scheduler.test.ts`, `send.test.ts` test 3, `fake.test.ts` `holdResponseNext` and the STARTTLS tests have no fixed sleep over 100 ms (the hold of the fake is not a test sleep: the test does not wait for it).
5. `docs/known-alerts.md`: the AgentMail entry has the true cause and `Status: fixed (<commit>)`; a STARTTLS entry exists with `fixed (<commit>)`.
6. `docs/code-patterns.md` § Tests, `.agents/limen/styleguide.md` and `CLAUDE.md` state the quarantine rule (D13), the condition-wait rule (D1, D10) and the pinned checks (D6).
7. `spec/build.md` § TRACK names the CI run time (coordinator, D14).
8. `gh run list --branch master --workflow CI --limit 3 --json conclusion,attempt,status` shows three `completed` runs with `success` and `attempt` 1.

## Rules for every stage

- **No product code change.** Allowed: `*.test.ts`, test fakes (`modules/testmail/agentmail/fake.ts`), `apps/server/test/`, `scripts/`, `.github/workflows/ci.yml`, `.bun-version`, `package.json` `scripts`, docs, notes, this ticket folder. A fix that needs a change in other product code is a stop-and-report, not a choice.
- **No change to `bun.lock`, no new dependency.** No change to `deploy/Dockerfile`.
- **Never** add `test.skip`, `test.todo`, `test.if`, a CI retry or a longer test timeout as a fix. Only the coordinator quarantines (D13), and then with a ticket path.
- **No fixed sleep over 100 ms** in a test you change; wait for a condition (`waitFor`, D10) or release the fake.
- Keep every security assertion of the STARTTLS tests word for word (what the server `seen`, the `HardError`, `stage: "connect"`).
- Test values only; never read `.env`; never print a key.
- Format only the files of the stage (`bunx prettier --write <files>`); never the whole repo.
- A gap or a deviation is a question in the final message, not a choice.
- Before each commit: `git diff --staged` review (CLAUDE.md).
- While working, run only the tests of the changed files, under the pinned Bun: `bash scripts/ci-bun.sh test <files>` (exists after stage 1 step 1). The full chain runs once, as the Proof.

## Proof

Run after the last commit, as one bash call with nothing after it; read the logs in a separate call. List as proven only what a saved log shows. `test:int` and `test:int:ci` need no lock (each Limen job has its own DB, `CLAUDE.md`).

Stage 1 (unit on the pinned Bun; integration on the local Bun, as before):

```
mkdir -p /tmp/f093-s01 && bun run lint > /tmp/f093-s01/lint.log 2>&1 && bun run typecheck > /tmp/f093-s01/typecheck.log 2>&1 && test "$(bash scripts/ci-bun.sh --version)" = "$(tr -d '[:space:]' < .bun-version)" && bun run test:unit:ci > /tmp/f093-s01/unit-ci.log 2>&1 && bun run test:int > /tmp/f093-s01/int.log 2>&1 && git diff --exit-code "$(git merge-base HEAD master)" -- bun.lock deploy/Dockerfile && echo PROOF_OK
```

Stages 2 and 3 (everything on the pinned Bun):

```
mkdir -p /tmp/f093-sNN && bun run lint > /tmp/f093-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f093-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f093-sNN/unit-ci.log 2>&1 && bun run test:int:ci > /tmp/f093-sNN/int-ci.log 2>&1 && git diff --exit-code "$(git merge-base HEAD master)" -- bun.lock deploy/Dockerfile && echo PROOF_OK
```

## User checkpoints

None. No step touches a real system, the shared DB or production. The owner reads the summary and `questions.md` (auto-build rule).

## User steps

None. No `.env` line, no migration, no deploy.

## Review

The board's reviewer (`claude-sonnet-5-5`, high) reviews before the land:

- **Stage 1:** it changes the security test of STARTTLS (no password before TLS). The reviewer checks that every assertion is unchanged and that the relay cannot let `AUTH` reach the plain handler.
- **Stage 2:** only when the worker changed an integration test or reported a quarantine. Otherwise it lands on the proof.

Stage 3 lands on the proof.

## Stages

- [ ] Stage 1 — [Bun pin, the AgentMail fake and the STARTTLS fake](stages/stage-01-bun-pin-and-fakes.md): `.bun-version`, `scripts/ci-bun.sh`, `:ci` scripts, CI reads the pin; the two fakes stop hanging on 1.3.14; alert entries and a note.
- [ ] Stage 2 — [Condition waits and the integration suite on the pinned Bun](stages/stage-02-waits-and-integration.md): `waitFor`, the scheduler tests, `test:int:ci` green or reported.
- [ ] Stage 3 — [Rules and numbers](stages/stage-03-rules-and-numbers.md): the quarantine, wait and pinned-check rules in the three rule files; CI run times.

No stage is `[risky]`.

## How to run (coordinator)

1. Move the ticket: `git mv spec/features/planned/F093-ci-green spec/features/active/`, commit (the worktrees see only committed files). Update `spec/build.md` NOW/NEXT.
2. Spawn one stage (NN and `<slug>` from the stage list; stage 2 with `--timeout 120m`):

   ```
   limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
     --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
     --prepare 'bash scripts/limen-prepare.sh' --label "CI green sNN · F093" \
     "Implement F093 stage NN. Read spec/features/active/F093-ci-green/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: the Proof command of plan.md for your stage (/tmp/f093-sNN), one bash call with nothing after it, run after the last commit; read the logs in a separate call. In the final message, list as proven only what a saved log shows."
   ```

3. When the job finishes: read its final message and `/tmp/f093-sNN/*.log`. For a stage in "Review", spawn the review job (`limen spawn --review --detached --branch <job branch> --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge --label "review sNN · F093" "Review F093 stage NN against spec/features/active/F093-ci-green/ (ticket.md, plan.md, stages/stage-NN-<slug>.md)."`) and wait. A finding → `limen continue <job-id> "<fix>"`, then review again (at most 2 rounds, then the owner decides).
4. Land: `limen land <job-id> --yes --keep-open`. Drop the job DB from the main checkout: `bun run db:worktree <YYYY-MM-DD>-<hash> --drop`.
5. After the stage 1 land: wait for the CI run of that push. Check NV2 (the `setup-bun` step log shows 1.3.14) and that `test:unit` is green. Note its `test:int` result for stage 2 (the worker reads it too).
6. Stage 2 stop-and-report (D12): create the quarantine ticket(s) by D13, then `limen continue <job-id> "Quarantine <test> with spec/features/planned/FNNN-slug/"`; the review runs.
7. After the stage 3 land: add the TRACK line from its final message to `spec/build.md`. Close the ticket when Done-when 8 holds: `limen ticket done F093`. While it is open, a red run on `master` → read the failing test; a stage-1-to-3 cause → `limen continue` the last job; another cause → D13.
8. Workers often break the one-`&&` proof form. Accept a check when its saved log shows the pass.

## Cold review

Not run yet.

## Log

- 2026-11-13: Planned by a planner job (Opus 5.5). Collect, CI history, probes on Bun 1.3.14 and 1.4.4 (F1–F13); D5–D14; three stage files.
