PASS 7c88ac3c2037f70be2c1a81f1c726416cdbc3eff

Commit reviewed: 7c88ac3c2037f70be2c1a81f1c726416cdbc3eff. It merges master into the branch; the stage 04 work is 1377e28f. `git rev-parse HEAD` matches the given candidate. Outside the F151 files, the merge brings in only one unrelated line (`apps/server/src/start/operator.ts`). Inside the files this stage touches, master changed nothing.

No blocking findings. Every point the task asked me to check holds.

- **The guard runs on the final env and cannot be skipped (proven).** On the demo source, `demo.config.ts` sets the one `env` that goes to `e2eWebServers` from `demoEnv()`. `demoEnv()` calls `assertLoopbackLlm` on the result of `demoServerEnv(e2eEnv(), …)`. No other path builds that env. Without the plan, port or gate variables, the config throws `demo_replay_missing`.
  - The server builds its model table the same way as the guard: `start/triage.ts` calls `llmRoleTable(loadConfig(process.env))` with no overrides. That is the only server path that creates a model client.
  - The guard checks the scope, the provider of each role, the own endpoint and a loopback host.
  - Proof: three `bunx playwright test -c apps/web/e2e/demo/demo.config.ts --list` runs under the shared-tests flock (`env -i`, fake DB URLs, temp plan, seed and gate files in `/tmp/f151rev`).
    - Demo source with `LLM_PROVIDER=gemini` and `OPENAI_API_KEY` set as a stand-in for a developer `.env`: it lists 1 test. The config loads under Node with the server config imports, and the guard passes on the final env.
    - Demo source without `CREDENTIALS_KEY`: `Error: demo_llm_not_loopback: config CREDENTIALS_KEY`. The guard runs when the config loads and refuses to start.
    - e2e source: it lists 1 test with no `DEMO_*` variables. The demo branch does not run.
- **`demoServerEnv` sets all eight keys (proven).** `bun test apps/web/e2e/lib/demo/server-env.test.ts`: 13 pass, 0 fail. This covers stage tests 1–4: the eight keys, the guard cases, the gate-copy match and no match at host 127.0.0.2, and the timeout of 1,616,000 ms.
- **The e2e source path is unchanged (proven by reading and by the e2e `--list` run).**
  - `record.ts` returns `recordSteps(...)` straight away when `demo === null`. The body of `recordSteps` is the old tail of `main`, word for word.
  - The config keeps `e2eEnv()` and the 10-minute timeout.
  - On the e2e source, no replay server starts and no plan file is written.
- **A miss or zero hits fails the run (read).** `closeReplay` returns 1 with `demo_replay_miss <n>` when misses > 0, and 1 with `demo_replay_unused` when hits = 0 after a recording that passed. If the recording failed, its own exit code of 1 wins. A failed run never exits 0.
- **The replay server stops on a throw (read).** The try/catch around `recordSteps` calls `demo.replay.stop()` and then throws again. On the normal path, `closeReplay` stops it.
- **No bare codes (proven).** A grep of the added lines for `F###` and letter-plus-digit codes found none. `bun test apps/server/src/bare-codes.test.ts`: 27 pass.

Unverified:
- The stage break check (remove the provider check from `assertLoopbackLlm`) was not run. By reading: the env-level `deepseek` case in test 2 still throws without the provider check, because it fails at `endpoint`. So the case the stage names would not catch the break. The worker added a table-level test (`uniformRoleTable` with a deepseek row on an own loopback endpoint, expecting `classifier provider`). That test would catch the break.
- A real end-to-end run was not done. There is no export yet.

Notes:
1. Spec drift, minor (read). The stage asks for exit 1 `demo_replay_unused` whenever hits = 0. The candidate prints it only after a passed recording. A failed recording still exits 1, so nothing can wrongly pass.
2. Plausible. A throw after Playwright skips the `demo_replay hits=… misses=…` and `demo_gate …` lines, although the stage says to print them also on failure. Two examples: `cues.json` is missing after a passing spec, or `statSync` fails. The exit code is still 1. Fix: print the stats in a `finally`.
3. Proven by the `--list` run above. Any unrelated config error in the developer env shows up as `demo_llm_not_loopback: config <KEY>`. It refuses to start, which is safe, but it sends the operator to the wrong cause. Consider a separate code such as `demo_config_invalid <keys>`.
4. Plausible, in stage 01 code (`tools/llm-replay/src/server.ts`). A request to any path other than `POST …/responses` gets a 404 and counts as neither a hit nor a miss. The OpenAI adapter calls only `responses.create`, so the risk is low today. If an adapter ever calls another path, the zero-miss check would not see it.
5. What could fail at the first real run, by reading:
   - **Misses from mail outside the export.** The replay table holds only the demo week's classifier answers. Two sources of extra classifier calls exist: the trust history sample (`trust.history`, which classifies a sample of history mail) and old mail in the shared dev mail server's demo mailbox. Each such call is a miss and fails the run. A miss is a 500, which can also trigger the model pause, so waits may run into `DEMO_WAIT_LIMITS_MS`. This belongs to the stage 05 setup.
   - **Drafter and extractor calls.** On the `synthetic` scope, the server also schedules `loops.analyze` (extractor role) and `replies.drafter` (drafter role). They run only when an organization has the `open_loops` or `reply_drafts` flag on. If the demo organization from the export has either flag on, those calls reach the replay, miss, and fail the run. The demo global setup turns on only `trust_ladder`, `approvals_page` and `delegation_pages`.
   - **The setup scripts use the plain e2e env.** In `demo/global-setup.ts`, the scripts `demo-org-setup.ts` and `org-flag.ts` run with `e2eEnv()`, not the demo env. `TRIAGE_LLM_SCOPE=off` there, so the model jobs of `job-run.ts` refuse to run and no model call can happen. A later stage that starts a CLI job with the scope turned on would bypass `assertLoopbackLlm`. Stages 05 and 06 should use the demo env for any such child.
   - **The config loads twice.** Playwright loads the config once in the runner and once in the worker. Both read `demo-plan.json` and assert again. The files stay in place until Playwright exits, so this should be safe.

Checks I ran, with real results:
- `git rev-parse HEAD` → `7c88ac3c2037f70be2c1a81f1c726416cdbc3eff` (one clean call, plus an earlier joined call).
- `bun install --frozen-lockfile` → 991 packages installed.
- `bun test apps/web/e2e/lib/demo/server-env.test.ts` → 13 pass, 0 fail. The call was joined with `cd` and piped to `tail`.
- `bun test apps/server/src/bare-codes.test.ts` → 27 pass, 0 fail. The call was piped to `tail`.
- `bunx playwright test -c apps/web/e2e/demo/demo.config.ts --list`, three env variants under `flock /tmp/email-assistant-shared-tests.lock` → as described above. These runs only list tests; no servers started.
- I ran no test suite, lint or typecheck, as the review rule says.

Note check
- HEAD is the candidate: proven. `git rev-parse HEAD` → 7c88ac3c2037f70be2c1a81f1c726416cdbc3eff.
- The guard runs on the final env before the servers start, with no skip path; `demoServerEnv` sets the eight keys: not proven by the note's rule. I read `apps/web/e2e/demo/demo.config.ts` (lines 35–54) and `apps/web/e2e/lib/demo/server-env.ts`. The test run and the `--list` runs were piped or joined calls, so they are not counted as proof here. I will not run them again, because that would repeat a run-once check.
- The e2e path is unchanged; a miss or zero hits exits 1; the replay server stops on a throw: not proven by the note's rule. I read `apps/web/e2e/demo/record.ts` (lines 79–111). The e2e `--list` run was a piped call.
- No bare codes; first-run risks named: not proven by the note's rule. I read the grep of the added lines and the `bare-codes.test.ts` run, both piped calls. The first-run risks are listed in note 5 above.
- Easy-to-miss rule "Run no suite beyond one test file to prove a doubt": followed. I ran only two single-file `bun test` runs and three `--list` config loads, and no suite. I have no saved log to prove it.
- Reminder, tests once per job and no `test:unit`, `test:int` or `test:e2e`: followed. None ran.
- Reminder, `check:job` as the last step: not applicable. This is a review job and it made no commits.
- Reminder, a review runs no suite, lint or typecheck: followed. I ran two single test files to prove specific doubts.
- Reminder, do not delete the lint and typecheck cache: followed. I deleted nothing under `node_modules/.cache/`.
