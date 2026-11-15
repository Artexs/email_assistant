FAIL 9452974ee253ea9368264d88cf68f7580d609388

The plan does not pass the review. Five gaps let a pre-mortem bug through: wrong cost, a false own-model or EU claim, and a gate file for the wrong endpoint. Each fix is one decision or one test in the named stage. HEAD = 9452974ee253ea9368264d88cf68f7580d609388, the candidate. Its parent is 2e2451be, the plan base, so the code at the branch base is the code at HEAD.

## Blocking

**B1 · Stage 02 (D3, D12): a hosted third-party API is classified as `own`. Its cost is then 0 and the docs claim no LLM sub-processor.**
- `plan.md:26` gives the rule: "any other host → `own`". `plan.md:30` (D7) gives "`own` → 0". `plan.md:35` (D12) and `stage-05:50` say "`own` = no LLM sub-processor".
- Hosts such as Azure OpenAI (`*.openai.azure.com`), OpenRouter, Together and Groq are not `*.openai.com`. So D3 makes each of them `own`. These are paid outside processors, so the cost, the sub-processor claim and the guide are wrong for them.
- ADR 0035:18 restricts decision 1 to "an OpenAI-compatible server that the buyer runs". The host alone cannot show that.
- The suffix rule also needs one more answer: a trailing-dot host (`eu.api.openai.com.`) does not match the literal hosts and becomes `own`.
- Stage-02 tests 1–9 have no case for a hosted third-party API.
- Needed decision: either an explicit `OPENAI_ENDPOINT_KIND` (or an allow-list for `own`), or a documented rule "a hosted OpenAI-compatible API is not supported", plus a test.
- Proven by reading the plan text against `packages/core/src/triage/cost.ts:28-42` (the price lookup is by model only).

**B2 · Stage 03 step 2 test 4 ("starts for the same model on `own` (first estimate 0)", `stage-03:46`) conflicts with the eval-pool rule.**
- `apps/server/src/modules/triage/eval-pool.ts:10-12` says the estimate "must be a finite number above zero". Line 25-27: `firstEstimateUsd` returns `null` unless usd > 0, so `eval-sim.ts:94-97` refuses the run. Line 80-85: `runPool` throws "budget needs … a first estimate above zero".
- The plan does not decide how an `own` run passes the budget path: no budget, a nominal estimate, or a skipped cap.
- A Sonnet worker must guess. The easy guess removes the `> 0` guard, and that guard protects paid runs from an uncapped run (money).
- Proven by code read.

**B3 · Stage 03 (D8): a resumed run can mix results across endpoints. The gate file then proves the wrong endpoint.**
- `apps/server/src/modules/triage/eval.ts:162-171`: `evalStateFileName` holds model, effort, prompt version and set. It holds no provider and no endpoint.
- `apps/server/src/scripts/eval-sim.ts:155-178` resumes from that file, and line 228-236 then writes the gate file.
- Example: an EU holdout of `gpt-6-luna` (stage 06 A2) resumes the results of a standard run with the same name, then writes `…-v1-eu.json`. The reverse case also occurs.
- The main checkout already keeps state files: `/home/artek/Documents/repos/email_assistant/evals/.runs/gpt-6-luna-none-classifier-v2-all.jsonl`. `evals/README` (stage 03 step 2) will tell the owner to run against `OPENAI_BASE_URL` in that checkout.
- D8 (`plan.md:31`) says "A gate file proves one (model, endpoint) pair". The plan names no state-file, lock or ledger-label change.
- Needed: the endpoint in the state file name, plus a test.
- Proven by code read. A fresh Limen worktree has no `.runs`, so the planned stage jobs alone do not trigger it.

**B4 · Stage 05 step 3: the install guide makes a false claim.**
- The claim (`stage-05:50`): "a model without a passing gate file unlocks no `auto` category (ADR 0028)". At F111 land, no code enforces this.
- `apps/server/src/modules/triage/gate.ts:71-104`: `auto` is set once, from the per-mailbox real-label gate or with `force`. The setting does not depend on the model and stays after a model or endpoint switch.
- No code reads gate files for unlocks. D8 (`plan.md:31`) leaves the reader to F110.
- F111 needs only E2a (`05-execution-plan.md:50`), so it can land before F110 (row 16).
- An operator who switches `OPENAI_BASE_URL` to a failing own model keeps every `auto` category. ADR 0035:19 and PD-110 promise the opposite.
- Needed decision: either the guide states the current truth plus an operator step ("turn `auto` off before you switch until F110"), or a stage adds a start warning or block.
- Proven by code read.

**B5 · Stage 05 step 3 conflicts with P1 and PD-101: it accepts ADR 0035 "decisions 1–5" (`stage-05:51`) unchanged.**
- ADR 0035:17 makes the EU domain "the default for any organization other than the owner's own pilot".
- ADR 0035:27 says "The frame promise becomes true for every organization except the owner's pilot".
- P1 (`plan.md:16`) gives one endpoint per deployment, US by default. PD-101 (`decisions.md:107`) says EU is "not the default of this install".
- An accepted ADR would then state a false EU claim. PD-101's claims table links to ADRs as proof.
- No stage amends decision 1 or that Consequence. Stage 06 A3 only resolves decision 6.
- Needed: stage 05 rewrites decision 1 and Consequence 1 to the P1 wording, or leaves decision 1 for the PD-110 second pass.

## Unverified
- No test suite ran. This is a plan review of a docs-only diff, so no JavaScript check ran and no install was needed.

## Notes
- **N1 (proven, code read):** the error branch has no `LlmUsage`. `apps/server/src/modules/triage/service.ts:507-520` writes `llm.call` from `deps.llm.modelOf("classifier")`. Stage 03 says the endpoint is "always written" from `LlmUsage.endpoint` (D6, `stage-03:12`). The plan names no interface such as `endpointOf(role)`, so the worker must guess.
- **N2 (proven, code read):** the price-source line in published reports will be wrong. `modules/triage/eval-report.ts:218-224` prints `llmPrices[model]`, so an EU report cites the standard source and an own report prints "none". Stage 03 neither decides nor tests this line, and stage 06 publishes such a report.
- **N3:** `triage:cost` gets only "prints the endpoint" (`stage-03:32`). `scripts/triage-cost.ts:81` prices all rows of a model at one rate, and no test checks that EU rows are priced at the EU rate.
- **N4 (proven):** the evidence test accepts a gate file for any model or endpoint. `packages/core/.../gate-evidence.test.ts` matches only the prefix `classifier-<promptVersion>-`. After stages 05–06, an own or EU file alone satisfies the PD-025 evidence check for the production model and endpoint. Stage 03 test 3 keeps that behavior. Consider matching the configured default model and `standard`.
- **N5 (plausible):** the Ollama context length is not decided. If the default `num_ctx` is below a long prompt, Ollama truncates it silently and the published own-model numbers are wrong. The stage 21 report gives a mean of 1462 tokens in; the maximum is unknown. Stages 01 and 05 neither set `OLLAMA_CONTEXT_LENGTH` nor check `usage.input_tokens` against it.
- **N6 (plausible):** the stage 01 spike model `qwen3:0.6b` (`stage-01:14`) is a thinking model. Its result for the Responses path and `reasoning` may not apply to Bielik or gemma3. Prefer a model without thinking, or state how stage 05 treats an early failure on that path.
- **N7:** the stage 01 decision rule (`stage-01:25`) mixes two questions. If S4 or S5 map to the wrong error class, the rule builds stage 04, and a chat path does not fix error mapping.
- **N8:** the note name has two rules that conflict. `stage-01:9` says "use the date of the run" in the name. The Check (`:33`), the Proof (`:52`) and `stage-04:3` use the fixed name `2026-11-15-…`.
- **N9 (facts without a source):**
  - `us.api.openai.com` → `standard` with no price uplift (`plan.md:26`).
  - "200 mails a day ≈ 600k prompt tokens a day" (`stage-05:50`) is about 2× the measured 1462 tokens per mail.
  - The opsware URL is not given (`stage-03:17`). It exists in `docs/product/stage-2/epics/E11-discovery-notes.md:143`, so point to that line. `checked: "2026-11-15"` gives the wrong date for that read: the discovery notes date the source 2026-10-16.
- **N10:** Q1 (`questions.md:3`) quotes the wrong source. It attributes "EU default for every organization except the owner's pilot" to PD-110, but that text is in `E11-contacts-and-context.md:123` and ADR 0035:17,27.
- **N11:** with D4, an own run still records `reasoningEffort: "none"` in the gate file and in its name. `config.ts:138` sets the default "none", but no reasoning is sent. `reasoning_ignored` (`stage-02:64`) is also always logged, because an effort is always set. Decide: null for `own`, or a documented exception.
- **N12:** stage 05 is large for one job: about 16 GB of model downloads, two runs of about 1,413 cases each (possibly hours each on ROCm), and the guide. Consider one job for the runs and one for the guide.
- **N13:** D2 does not define "loopback": 127.0.0.0/8 or `::ffff:127.0.0.1`? Also, a one-label host can resolve off the host through a DNS search domain while it uses http.
- **N14:** the stage 06 A2 command (`stage-06:24`) leaves out `--provider openai --model gpt-6-luna`, so it depends on the worktree's `.env` defaults. Test 1 expects a fixed file name.
- **N15:** the gate file records no host and no server settings. A match on (model, `own`) lets the result from the owner's PC stand for any server with the same tag, also one with other `num_ctx` or other settings.
- **N16:** the F107 seam has a gap. In F107 D3 (`F107/plan.md:26`), `ActiveWhen` has no endpoint kind, so "own = no LLM sub-processor" (D12) has no interface. The plan maps only the key.
- **N17:** ADR 0035:21 says "the operator owns the choice". D2 restricts http to loopback or a one-label host, and D3 refuses other `*.openai.com` hosts. The acceptance in stage 05 should record D2 and D3 as amendments.
- Size: `wc -w` gives plan 1500, stage files 604, 623, 588, 364, 683 and 656. All are inside the `.agents/limen/planner.md` § Plan size limits.

## Checks run
- `test "$(git rev-parse HEAD)" = 9452974ee253ea9368264d88cf68f7580d609388 && test -z "$(git status --short)" && echo OK` → OK.
- Read: ADR 0035 in full; `docs/product/stage-2/decisions.md` PD-025, PD-101 and PD-110–PD-112 (`decisions.md:31,107,116-118`); the `05-execution-plan.md` rows 16–17; the F107 plan D3.
- Code read: `eval-sim.ts`, `eval-pool.ts`, `eval.ts:162-171`, `eval-sim-report.ts:190-300`, `eval-report.ts:205-225`, `cost.ts`, `audit/repo.ts:184-230`, `metrics-repo.ts`, `triage-cost.ts`, `service.ts:497-540`, `gate.ts`, `openai.ts:115-160`, `config.ts`, `gate-evidence.test.ts`.
- `wc -w` of the plan files. A grep of `evals/sim/lab-01/dev` for the format of case ids: `b-del-0008`, which matches the stage 05 grep. I did not open the holdout.
- No lint, typecheck or test suite ran: the diff holds plan docs only.

## Note check
- HEAD is the candidate: proven. `test "$(git rev-parse HEAD)" = 9452974ee253ea9368264d88cf68f7580d609388 && test -z "$(git status --short)" && echo OK`
- Findings quote file:line, are marked blocking or note, and cover the pre-mortem, gaps, conflicts, worker guesses, unsourced facts and stage size: proven. This final message: B1–B5 and N1–N17, each with file:line.
- Decisions checked against ADR 0035, PD-101, PD-110–PD-112 and the branch-base code: not proven. I read these files in this session (listed under Checks run), but no single &&-joined command or saved log records the reads.
- Easy-to-miss rule ("Missing code detail … is not a finding"; "Do not edit files"): followed. `test "$(git rev-parse HEAD)" = 9452974ee253ea9368264d88cf68f7580d609388 && test -z "$(git status --short)" && echo OK` printed OK, so the worktree is clean. Each finding names a missing decision, test or interface, not code detail.
