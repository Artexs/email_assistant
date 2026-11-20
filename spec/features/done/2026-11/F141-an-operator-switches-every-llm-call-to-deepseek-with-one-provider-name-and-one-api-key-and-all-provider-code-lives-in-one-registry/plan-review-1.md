# F141 plan review 1

Job `2026-11-19-f141-plan-review-bddc62d0`, model claude-opus-5-5, thinking high. Final message filed whole below.

FAIL 49e91a51cce4063939910d08533e4cdcb06112d6

This is a cold review of the F141 plan: one `LLM_PROVIDER` with light and strong model tiers per provider row, and a DeepSeek row. `git rev-parse HEAD` = `49e91a51cce4063939910d08533e4cdcb06112d6`, which matches the candidate. The diff is spec-only. I read the plan against the code at HEAD.

## Blocking

**B1. The plan cannot meet ticket acceptance item 5 as written, and it changes that item without an owner question. Proven by reading the plan and by a scan run.**
- **What the ticket asks.** `ticket.md:31` asks for "a test or lint rule [that] proves zero outside the registry after".
- **What the plan proves instead.** `plan.md:87` (Done when) proves "no site outside the registry *and its exception list*". `stage-07:20` keeps permanent exceptions that are outside the registry: `outside-services.ts`, `legal/subprocessors.ts`, the e2e pin, and the web texts. The owner rule "no legal change" forces some of these exceptions, so the literal acceptance conflicts with the out-of-scope list. The plan must raise this as a question or as a ticket edit. It must not redefine the acceptance in silence.
- **The scan cannot see every site.** I ran the D11 patterns (`plan.md:72`, `stage-01:24`) over the non-test `.ts` files of the four roots at HEAD (script `/tmp/f141-review/scan.ts`). Result: 12 files match.
  - `apps/server/src/scripts/eval-args.ts` matches only on line 58.
  - The hand-written provider lists `--provider gemini|openai` (line 34) and `--judge-provider gemini|openai` (lines 46 and 57) do not match. The pattern needs quotes.
  - Host literals like `"api.openai.com"` (`endpoint.ts:216`) do not match either.
  - So "zero" is not proven even inside the exception rule.
- **Fix.** Ask the owner to restate acceptance item 5 as "zero outside the registry and a named exception list". Also add a pattern for unquoted provider names in usage text, or record that blind spot as an accepted exception.

## Unverified checks

- I ran none of `lint`, `typecheck`, `test:unit:ci` or `test:int:ci`. The diff changes only files under `spec/`, so these suites would prove nothing about this plan.
- The plausible test breaks in N2 and N3 below are inferred from the code. I did not reproduce them.

## Notes (findings for the planner; none blocks under the acceptance-only rule)

**N1. Proven conflict: the P4 guard and the sim stack.**
- P4 (`plan.md:56`, `stage-03:24`) refuses `LLM_PROVIDER=deepseek` with `TRIAGE_LLM_SCOPE=all`.
- The sim stack needs `TRIAGE_LLM_SCOPE=all` (`deploy/sim.env.example:18`). That stack is the live lab, which holds only generated mail and marks itself with `LAB_STACK=ea-sim` (line 7).
- The result: the live lab can never run on DeepSeek, but the ticket says DeepSeek is "for development, tests and evals" (`ticket.md:9`).
- Stage 05 even adds `DEEPSEEK_API_KEY=` to `sim.env.example` (`stage-05:19`), and that key can never be used there.
- Needed: a decision. For example, allow scope `all` for DeepSeek only when `LAB_STACK=ea-sim`, or record that the lab stays on OpenAI or Gemini. This is a gap: no rule covers the event "DeepSeek on the sim stack". Decide it before stage 03.

**N2. Proven false premise in P5, and the dev `.env` cleanup comes too late. The false premise is proven; the test breaks are plausible.**
- **The false premise.** P5 (`plan.md:57`) says "old `.env.example` copies hold empty lines". At HEAD, `.env.example:6` holds `GEMINI_MODEL_CLASSIFIER=gemini-3.5-flash-lite`, line 14 holds `OPENAI_MODEL_CLASSIFIER=gpt-6-luna`, and line 20 holds `OPENAI_REASONING_EFFORT=none`. All three are non-empty removed keys. So every `.env` copied from the example stops the start after stage 04.
- **The owner's dev `.env`.** It also holds the stopgap lines (`notes.md:26`): `OPENAI_MODEL_CLASSIFIER`, `LLM_JUDGE_PROVIDER` and `LLM_JUDGE_MODEL`, all with values.
- **Why that breaks job checks.** `scripts/limen-prepare.sh:29` copies the main checkout `.env` into every job worktree. Bun loads `.env` (`apps/server/test/preload.ts:14`). The CLI integration tests spawn scripts with `process.env` (`stats-week-cli.test.ts:47`).
- **The plausible result.**
  - The stage-04 job's own `test:int:ci` proof can fail.
  - After stage 04 lands, every later Limen job of any ticket can fail the same way until the owner edits the main `.env`.
- **The timing problem.** O1 schedules the dev `.env` cleanup "before the deploy" (`plan.md:105`), not before the stage-04 job.
- **Fix.**
  - Move the dev part of O1 to after the stage-03 land and before the stage-04 spawn. It cannot come earlier: `LLM_PROVIDER=deepseek` is invalid before stage 03.
  - Also decide whether a removed key whose value equals the new resolved value (`gpt-6-luna`, `none`) passes.

**N3. Proven: the e2e pin rule in stage 05 is wrong.**
- `stage-05:16` and test 7 (`stage-05:38`) say "The e2e seed env holds no key of D6".
- The e2e server env is `process.env` plus `E2E_LLM_PIN` (`apps/web/e2e/env.ts:51-57`, `:81`). Today the pin overrides a developer's `OPENAI_MODEL_CLASSIFIER` and `OPENAI_REASONING_EFFORT` (`e2e-seed-args.ts:496-502`).
- If stage 05 drops these keys from the pin, a developer `.env` built from the old example passes them to the e2e server, and the server refuses to start.
- The pin should set every D6 key to `""` (an empty value passes under P5), and also set `OPENAI_OWN_MODEL: ""`.
- **Interface misfit.** `e2e-gate-fixture.test.ts:17` spreads the pin into a config. That unit test will fail in stage 04 and force the pin edit there, so stage 04 and stage 05 both own this change.

**N4. Proven: stage 02 step 2 rewrites a measured record.**
- `stage-02:30` says to derive the cost-model list from the light tiers.
- That list is `pilotCost.models` (`packages/core/src/metrics/cost-model.ts:46`). It records the models that the four measured pilot weeks used, from `pilot-cost.md`.
- If the list comes from the tiers, `deepseek-flash` joins a measurement that never used it.
- It should stay as is and become a permanent scan exception with the reason "measured record".

**N5. Plausible: P1 conflicts with a standing owner decision about the drafter model.**
- P1 and Q5 fix the drafter in code at light tier with effort low. `LLM_DRAFTER_MODEL` goes.
- An earlier owner decision says the drafter model (product decision PD-072) "is a config value" (`docs/owner-decisions.md:531`). The reply-drafts capability page agrees (`docs/capabilities/reply-drafts.md:73`).
- The reply-drafts feature (F115, active) is running its drafter-v2 quality-gate runs (`spec/build.md:32`). Its stage 18 turns the drafter on for the pilot on the VPS.
- If that gate picks another model or effort, production needs a code change after F141. The undo in Q5 ("an eval flag") covers only eval runs.
- The plan never names F115. This needs an `[important]` question, and the `Sequenced` section should mention it.

**N6. Plausible gap in O1: it checks key values, not the models each role uses.**
- O1 (`plan.md:105`) stops only when a removed key "held a model or effort other than P1".
- A key that is absent also has an effect today. The drafter and extractor rows inherit `OPENAI_REASONING_EFFORT` (`config-llm.ts:224`, `:230`), so a VPS without `LLM_DRAFTER_REASONING` runs the drafter at `none` today. After stage 04 it runs at `low`.
- The production drafter changes in silence once F115 stage 18 turns it on.
- O1 should compare the effective role table before and after the release, for example `llm:check --role all` lines, not only the key values.

**N7. Plausible: an unverified fact sits under the risky stages.**
- D4 and stage 03 test 5 send `reasoning.effort: "none"` to DeepSeek. The owner's verified run sent no `reasoning` field (`plan.md:77`, `:82`).
- The current stopgap uses endpoint kind `own`, and that path strips `reasoning` (`openai.ts:193`). So the owner can check `none` only after stage 03 lands.
- O2 comes after stage 05. If DeepSeek rejects `none`, stages 03–05 build on a wrong D4.
- Put a DeepSeek-only `llm:check` right after stage 03, as a record. A record does not block the next stage.

**N8. Note: rule conflict between ticket acceptance item 2 and D10.**
- `ticket.md:28` says that with the key missing, "config fails".
- D10 (`plan.md:71`) and Q7 keep a server start without the key when the triage scope is `off`.
- That is a change to the acceptance, but Q7 marks it `[minor]`. Either restate the acceptance or raise Q7 to important.

**N9. Note: possible acceptance drift on item 4.**
- `ticket.md:30` says `stats:week` "show[s]" the provider.
- `stage-06:21` says m7 needs no provider: the price follows model and endpoint.
- If item 4 means that `stats:week` prints the provider, nothing builds it. If it means the priced cost, it holds. Clarify the wording.

**N10. Small items.**
- **Between stages 03 and 04.** The deepseek block's `reasoningEffort` is not decided. Test 5 implies `none`. In that window the judge on deepseek still gets the model `DEFAULT_JUDGE_MODEL` (`config-llm.ts:219`). The effect is transient and reaches only the tools.
- **Stage 05 tests 4–5 need a fake-provider seam in `llm:check`.** `llm-check.ts` builds its client inline today. The stage should name the seam as an interface.
- **Wrong expected exception.** `stage-07:20` expects "web legal and i18n texts" as scan exceptions. At HEAD no `.ts` file under `apps/web/src` matches the patterns (the legal texts are `.md`), so that expectation names nothing.
- **Comment-only matches.** `settings.ts:17` and `eval-config.ts:8` match the scan only through comments. Stage 07 should say whether to reword them or list them.

## Checked with no finding

- **Plan size.** `wc -w`: `plan.md` 1344 words; stages 589, 514, 648, 687, 610, 413, 444. All are within the `planner.md` limits. No stage is too big for one job.
- **Stage 02 numbers are correct.** Test 3: 1.5 and 5.28. Test 4: 0.000165 (computed from `cost.ts:38-39`).
- **Error mapping in D3 matches the code.** 402 is in `CONFIG_STATUSES` (`openai.ts:150`). 422 is hard. 429 without quota is soft.
- **The P1 baseline matches the code and the gate files.** The current judge default is `gpt-6.1-terra` (`config-llm.ts:14`). The committed gate file names show classifier none, drafter low, extractor none.
- **The DeepSeek adapter can reuse the OpenAI adapter.** The ESLint SDK rule permits `./openai` imports (`eslint.config`:193). No module outside `config-llm.ts` reads `config.OPENAI_*` or `config.GEMINI_*` (grep), so building the provider keys from the rows breaks no reader.
- **The stage order fits the Needs lines.** The only possible collision is a merge conflict in the allowlist and in `testing.ts` when stage 06 runs next to stages 04 and 05.

## Checks run

- `git rev-parse HEAD` printed `49e91a51cce4063939910d08533e4cdcb06112d6`.
- `bun /tmp/f141-review/scan.ts` (the D11 regexes over the non-test `.ts` files of `apps/server/src`, `packages/core/src`, `apps/web/src` and `tools`) printed 12 files. `config-llm.ts` has 34 matching lines and `eval-args.ts` has 1.
- `wc -w` over the plan files gave the counts above.
- All other evidence comes from reading the files at HEAD. I did not read any `.env`: this worktree has none.

## Note check

- All six finding kinds in task.md checked against the plan, the stages and the code at HEAD: proven. `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-19-f141-plan-review-bddc62d0/review-draft.md` maps each kind to its findings, and "none found" for oversize stages.
- Each decision checked against the code at 49e91a51: proven. Code evidence files: `deploy/sim.env.example`, `.env.example`, `apps/server/src/scripts/e2e-seed-args.ts`, `apps/web/e2e/env.ts`, `packages/core/src/metrics/cost-model.ts`, `apps/server/src/platform/config-llm.ts`, `scripts/limen-prepare.sh`, `docs/owner-decisions.md`.
- HEAD matches the candidate: proven. `git rev-parse HEAD` printed `49e91a51cce4063939910d08533e4cdcb06112d6`.
- Easy-to-miss rule ("missing code detail is not a finding"): followed. Each finding names a decision, rule, test, fact or interface, not only a line number or edit text. Evidence: `review-draft.md` and the findings above. N10's seam item asks for an interface, not for code.
