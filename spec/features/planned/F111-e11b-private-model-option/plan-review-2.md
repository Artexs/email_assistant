# F111 plan review 2 (refresh 1)

Job `2026-11-15-f111-plan-review-2-refresh-463fee8a`, Opus 5.5, thinking high, candidate `1fed167c`. Final message, whole:

FAIL 1fed167cce3202b2b11b087ab81c7876e1fdca2a

The refreshed plan matches the code at HEAD on all named interfaces but one. Stage 02 case 12 cannot pass as written: at HEAD the eval error output does not name the key.

HEAD check: `git rev-parse HEAD` = 1fed167cce3202b2b11b087ab81c7876e1fdca2a, the same as the candidate. The tree was clean.

## Blocking

1. **Stage 02 case 12 contradicts itself. As written, it cannot hold at HEAD (proven by a run).**
   - The case says a bad `OPENAI_BASE_URL` makes `eval --sim` exit 1, and "its error names the key, not the value (`main` prints only its name now)".
   - At HEAD, `runSim` (`scripts/eval-sim.ts`) and `runClassifier` (`scripts/eval.ts`) call `loadConfig()` outside any `try`. The `ConfigError` therefore reaches the `.catch` of `main`, and that catch prints only `failed: ${error.name}`.
   - Reproduction: `env -u DATABASE_URL -u OPENAI_API_KEY -u GEMINI_API_KEY bun run eval --sim lab-01 --part dev` printed `[eval] failed: ConfigError` and exited 1. No key name appears.
   - The stage's Files list names only config, `endpoint.ts` and `cost.ts`. The worker must guess two things:
     - whether the current output already satisfies the case (it does not name the key);
     - which eval function catches `ConfigError`, and what it prints (`error.keys`, or the message "Missing or bad config keys: …").
   - The eval scripts are also F109's area, so this guess falls on shared code.
   - Fix: state the decision. Example: "`runSim` and `runClassifier` catch `ConfigError` from `loadConfig` and print `config error: <keys>`, exit 1". Or reduce the case to "exits 1; the output does not hold the value".
   - The test must also give a valid value to every other config key. Otherwise `ConfigError.keys` lists other keys too, such as `DATABASE_URL`, and the case passes for the wrong reason.
   - The `--suspicious` half of the case holds: the same run with `--suspicious` exited 0 without `DATABASE_URL`, so `runSuspicious` loads no config.

## Unverified

- Nothing ran an eval against a live LLM or Ollama. No spend.
- No unit or integration suite ran. The candidate is a plan-only diff, so no suite can tell its outcomes apart.

## Notes

2. **Stage 05: a prompt switch in the middle of the stage has no rule (plausible).**
   - Stage 05 can run as two jobs, one per model. It also forbids prompt flags, so each run uses the production prompt.
   - If F109 stage 11 ships v3 between model one and model two, model one runs v2 and model two runs v3. The comparison file then mixes prompt versions and baselines.
   - Decide one of two rules: pin the prompt of the first run (`--prompt-version` of that run) for both models, or rerun model one.
   - The same gap exists if v3 ships after stage 05 and before stage 06: the stage 06 guide would publish own-model numbers for a prompt that is no longer in production.

3. **Stage 03, D8 "a resume never mixes endpoints" does not cover `--state` (plausible).**
   - `runClassifier` takes `options.state` before `evalStateFileName`, so an explicit `--state` path skips the endpoint suffix.
   - D8's promise holds only when no `--state` is given. Either say so, or put the endpoint into the state rows and refuse a mismatch on resume.

4. **Stage 03 case 4 stops schema checks of the non-standard gate files (proven by reading the code).**
   - At HEAD, `gate-evidence.test.ts` takes every `classifier-<version>-*.json` file and parses each with `gateFileSchema`.
   - The new rule reads only files without an endpoint suffix. After that change, no CI test parses the `-own.json` and `-eu.json` files from stages 05 and 07.
   - Decide whether those files must still parse in CI and only stop counting as evidence. I recommend that they still parse.

5. **Stage 02: a bad `OPENAI_BASE_URL` also stops `eval --real` (proven by reading the code).**
   - `runReal` calls `loadConfig()` but makes no LLM call. Refresh 1 names `--suspicious` and `--gap` as the commands without an LLM, but not `--real`.
   - This matches the start-check policy of case 10. Write it down so that a worker does not "fix" it.

6. **F109 stage 11 overlap (checked, no conflict found).**
   - F109 names the gate file `classifier-classifier-v3-gpt-6-luna-none-lab-01-v1.json`, without parts. That matches D8's gate name, version without parts.
   - F109 test 2 (`promptParts` = `CLASSIFIER_V3_PARTS`) still holds over own and EU files, because stages 05 and 07 also run the production parts.
   - Both stages edit `gate-evidence.test.ts`. The stage that lands second gets a text conflict, but no logic conflict.

7. **Interfaces checked at HEAD (they match the plan).**
   - The flags `--prompt-version` and `--prompt-parts` exist. Without them, `resolvePrompt` returns `productionClassifierChoice()`.
   - The state name in `runSim` uses `promptLabel(options.prompt)`. The plan's example `classifier-v3_history_urgency_` matches the `[^\w.-]` → `_` rule.
   - `gateFileName` takes `promptVersion` with no parts.
   - `gateFileSchema.promptParts` is optional. `buildGateFile` omits it when `promptParts === null` (non-v3), so stage 05 test 1 "absent for classifier-v2" holds.
   - `runClassifier` exists in `scripts/eval.ts` and uses `prompts.classifier.version`, not `promptLabel`.
   - `evals/results/gate/` holds only the v2 file.
   - Word counts are within limits: plan 1500 words; stages 657, 700, 697, 368, 699, 618, 700. The counts moved from plan.md § Planning progress to `plan-refresh-1.md`, but `.agents/limen/planner.md` § Plan size says to write them in plan.md (minor process note).

## Checks run

- `git rev-parse HEAD` → 1fed167c…, as given.
- `bun install --frozen-lockfile` → 989 packages installed.
- `env -u DATABASE_URL -u OPENAI_API_KEY -u GEMINI_API_KEY bun run eval --sim lab-01 --part dev` → `[eval] failed: ConfigError`, exit 1.
- `env -u DATABASE_URL bun run eval --sim lab-01 --part dev --suspicious` → report printed, exit 0.
- `wc -w` on plan.md and the 7 stage files → counts as above.
- I read the code at HEAD: `eval-args.ts`, `eval-sim.ts`, `eval.ts`, `eval-sim-report.ts`, `modules/triage/eval.ts`, `prompts/index.ts`, `config.ts`, `gate-evidence.test.ts`. I also read F109 stage 11.

## Note check

- HEAD is the candidate 1fed167c: proven. `git rev-parse HEAD` printed 1fed167cce3202b2b11b087ab81c7876e1fdca2a.
- Refresh-1 eval claims checked against code at HEAD: proven. `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-15-f111-plan-review-2-refresh-463fee8a/code-facts.log`.
- Conflicts with F109 stage 11 checked: proven. `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-15-f111-plan-review-2-refresh-463fee8a/f109-facts.log`.
- Final message starts with the verdict and sha, then numbered findings marked blocking or note: proven. This message.
- Easy-to-miss rule ("Missing code detail … is not a finding"): followed. Each finding names a decision, edge case, test or interface:
  - 1: a test that cannot hold;
  - 2: an edge case;
  - 3: an edge case;
  - 4: a test decision;
  - 5: an edge case.
  No finding asks for line numbers or edit text. Note 7 also says the word counts moved out of plan.md; that is a process note, not code detail.
