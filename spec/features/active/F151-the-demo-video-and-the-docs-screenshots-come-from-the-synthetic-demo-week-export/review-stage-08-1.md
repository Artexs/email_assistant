FAIL 21a482040c845c2fe6a3876d16c0976cec0a6520

The reviewed commit is `21a482040` (HEAD matches the candidate). It merges master into the stage 08 commit `7728d3b8a`. The verdict logic is correct, and so is the order of the demo-source path. One "Done when" bullet of the stage is broken, and the worker's own log proves it.

## Blocking

**B1. A failed run does not end with the verdict when it runs through `bun run`. Proven.**
- The stage says: "The verdict is the last line of the combined log (`> log 2>&1`)". Its Proof expects `tail -n1 refused.log` to print `[demo-record] not for upload: run_failed`. "Done when" asks that "Both Proof logs end with the verdict lines above".
- The worker's log `/tmp/f151-s08/refused.log` ends like this:
  ```
  [demo-record] seed_missing
  [demo-record] not for upload: run_failed
  error: script "demo:record" exited with code 1
  ```
- So `tail -n1` prints bun's wrapper line, not the verdict.
- Cause: `bun run` (1.4.4) adds `error: script "<name>" exited with code 1` after any script that exits non-zero. I reproduced it in `/tmp/rv-bunsilent` with a one-line script. `bun run --silent` drops that wrapper line.
- `record.ts` itself does write the verdict last. The extra line comes from the `package.json` entry `"demo:record": "bun apps/web/e2e/demo/record.ts"` when someone calls it through `bun run`.
- The worker reported this check as "proven". The log does not support that.
- Exit 0 runs are not affected: `e2e.log` ends with `[demo-record] not for upload: e2e_source`. A future candidate run (exit 0) also ends with its verdict.
- Upload safety is intact: a failed run never shows "upload candidate".
- Fix options. Pick one:
  1. Change the Proof and the docs to `bun --silent run demo:record …`, or call `bun apps/web/e2e/demo/record.ts` directly.
  2. Change the stage text and live-lab rule 24.10 to "the last `[demo-record]` line". Rule 24.10 now says "Every run ends with one verdict line … also a refusal or a crash".

## Unverified

**Demo-source path on a real seed. Unverified, as the task expected.**
- No export exists, and stage 06 has not landed, so a demo-source run still ends `run_failed`.
- I checked by reading that the code follows Step 1 of the stage (`record.ts:114-147`):
  1. `demo_seed_day <n> exported_at <iso>` prints right after `prepareDemoRun`. It reads `seed.day` and `seed.exportedAt` from the parsed seed, not from the file name (`prepare.ts:62-63`).
  2. `recordSteps` runs.
  3. `closeReplay` runs and sets `misses` and `gateProvisional`.
  4. `checkModels` runs with `expectedHits = plan.history.length + 7`. It prints `demo_llm_checked hits=<n>` or calls `fail("demo_llm_unchecked")`.
- The demo server env (`server-env.ts:20-31`) sets `TRIAGE_LLM_SCOPE=synthetic` and `OPENAI_BASE_URL=http://127.0.0.1:<port>/v1`. With that scope, `startTriage` logs `llm_settings` with endpoint and host (`start/triage.ts:44-46,86`).
- **The one check that would prove this wrong:** after stage 06, run `flock /tmp/email-assistant-shared-tests.lock bun --silent run demo:record --seed <day≥1 export> > d.log 2>&1`. Then check two things:
  - `grep -a llm_settings d.log` should show `"endpoint":"own","host":"127.0.0.1"`.
  - `grep demo_llm_checked d.log` should find the line.
- If the first grep finds nothing, modelCheck fails on every run. The run then says `llm_unchecked` and never "upload candidate". That fails safe, but it would block every upload.

## Verified by reading

- **Verdict on every exit path. Proven by reading.** `main().catch(fail).then(print verdict; exit(code))` (`record.ts:236-242`) covers all of these:
  - the refusals in parse, preflight, `web_build_missing`, `shotSource` and `prepareDemoRun`;
  - a failed migrate, record, cues, ffmpeg, ffprobe or video limit;
  - a replay miss or an unused replay;
  - `demo_llm_unchecked`;
  - the `demo_record_error` catch.
- The exit code passes through unchanged. No other `process.exit` exists in the imported demo modules (grep).
- The defaults in `facts` are values of a run that is not perfect (`misses: 1`, `notLive: ["unreached"]`, `gateProvisional: true`, `llmChecked: false`, `seedDay: null`).
- **`run_failed` on any exit 1. Proven by reading.** `firstReason` checks `exitCode !== 0` first. The reasons after it follow the stage order exactly. A null `seedDay` gives `trial_seed`.
- **Playwright forwards the server's `llm_settings` line. Proven by reading Playwright 1.65.0 and the worker's e2e log.**
  - `e2eWebServers` sets `stdout: "pipe"` (`apps/web/e2e/servers.ts`).
  - In `playwright@1.65.0/lib/runner/index.js:979-986`, a piped webServer stdout goes to `reporter.onStdOut` with a `[WebServer] ` prefix.
  - `LineReporter._dumpToStdio` (`:4871-4893`) writes it to stdout even with no test attached, unless `quiet` is set. `demo.config.ts` does not set it.
  - Server info logs go to `console.log`, which is stdout.
  - `/tmp/f151-s08/e2e.log:115-119` shows server start lines from the same `startTriage` block, forwarded as `[WebServer] {"…","event":"triage_scope",…}` (scope `off` on e2e, so no `llm_settings` line there).
  - `settingsOf` takes the JSON from the first `{`, so the prefix does no harm. A text-format line also parses through the regex.
  - That log was made before the commit, at the worker's tree. Forwarding does not depend on the candidate.
- **Docs.** The `docs/release-checklist.md` line is replaced as the stage asks. Rule 24.10 in `live-lab.md` gives the verdict, the reasons and the order of the last lines. B1 also applies to its "every run ends with one verdict line".

## Notes

- **N1. Plausible, not blocking.** `runLogged` keeps stdout and stderr chunks in one array, in arrival order, and then splits on `\n`.
  - If a long server line reaches the reporter in two pipe reads, `prefixOutputLines` adds a newline and a `[WebServer] ` prefix inside the JSON.
  - `JSON.parse` then fails, and the run fails closed with `demo_llm_unchecked`. This is a possible flake, not an unsafe pass.
- **N2. Plausible.** `forward` ignores the return value of `sink.write`. With `| tee` instead of a file redirect, `process.exit` could cut output that is still buffered. The proof uses `>`, so this did not happen there.
- **N3.** The tests have more rows than the stage asks for: `uploadVerdict` has 12 rows (stage: 11), and `modelCheck` has 6 (stage: 4). The extras are "no seed day", "a text line with a prefix" and "another endpoint kind". Each is its own behaviour, so none is a near copy. The worker reported the break check (drop the `exitCode` rule) as failing two rows. I did not rerun it.
- **N4.** `modelCheck` sees only the classifier's `llm_settings` line, because the server logs one role. The other roles rely on `assertLoopbackLlm` in `demo.config.ts`. This is acceptable, but the docs phrase "every `llm_settings` line" covers one role only.

## Checks I ran

- `git rev-parse HEAD`: `21a482040c845c2fe6a3876d16c0976cec0a6520`. It matches the candidate.
- I read the diff `7728d3b8a^1..7728d3b8a`, all of `record.ts`, `verdict.ts`, `verdict.test.ts`, `prepare.ts`, `server-env.ts`, `servers.ts`, `demo.config.ts`, `start/triage.ts`, `platform/log.ts` and `log-fields.ts` (`endpoint` and `host` are allowed fields), and Playwright 1.65.0 from the bun cache (`lib/runner/index.js`).
- I read the worker's logs in `/tmp/f151-s08/`:
  - `refused.log`: its last line is bun's wrapper error (B1).
  - `e2e.log`: its last line is `[demo-record] not for upload: e2e_source`; `grep -c 'demo_source e2e: not for upload'` printed 0.
  - `check.log`: its last line is `check:job PASS master=e8ceb98101 tip=21a482040c full=0`.
- I ran a `bun run` wrapper repro in `/tmp/rv-bunsilent` (bun 1.4.4). Without `--silent`, bun adds `error: script "f" exited with code 1` after the script output. With `--silent`, the line is gone. That call joined commands with `;`, so it is shown, not tool-proven.
- Not run, as the task asked: no test suite, lint, typecheck or `bun test` file. No `bun install` (no JavaScript check needed it).

## Note check

- Verdict last on every exit path, exit code unchanged: broken. The code is correct in `apps/web/e2e/demo/record.ts` (lines 236-242). But `/tmp/f151-s08/refused.log` ends with bun's `error: script "demo:record" exited with code 1` after the verdict (B1).
- `run_failed` first and the stage order of reasons; test rows present: proven. Evidence: `apps/web/e2e/lib/demo/verdict.ts` (`firstReason`) and `apps/web/e2e/lib/demo/verdict.test.ts` (12 + 6 rows, a superset of the 11 + 4 the stage asks). I did not run the tests myself. The worker's pass is in `/tmp/f151-s08/check.log`.
- modelCheck reads real forwarded server output: proven by reading. Evidence: `apps/web/e2e/servers.ts` (`stdout: "pipe"`), `~/.bun/install/cache/playwright@1.65.0@@@1/lib/runner/index.js` (lines 979-986 and 4871-4893), and `/tmp/f151-s08/e2e.log` (lines 115-119 show forwarded server start lines). No `llm_settings` line from a real demo-source run exists.
- Demo-source path order matches stage Step 1: proven by reading `apps/web/e2e/demo/record.ts` (lines 114-147) and `apps/web/e2e/lib/demo/server-env.ts`. A demo-source run on a real seed is not proven: it needs stage 06 and an export.
- Easy-to-miss rule "Run no suite": followed. I ran no suite, lint, typecheck or test file. The only command I ran besides reads was the bun wrapper repro in `/tmp/rv-bunsilent`.
- Reminder "tests run once per job, no `test:unit`/`test:int`/`test:e2e`": followed. None ran.
- Reminder "`check:job` last for jobs that commit product code": not applicable. This review job made no commits.
- Reminder "a review job runs no test suite, lint or typecheck": followed.
- Reminder "never delete `node_modules/.cache/`": followed. Nothing was deleted.
