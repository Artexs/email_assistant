# F141 stage 05 — eval and check flags, env files, operator docs

Needs stage 04: `llmRoleTable` on tiers, `JUDGE_SAME_MODEL`, the removed-key list.

Part of [`../plan.md`](../plan.md). Decisions: D7, D8, D10, P1.

## Step 1 — flags pin one run (D8)

- **Eval tools** (`eval`, `eval --sim`, the drafter eval, the extractor eval; flag parse in `eval-args.ts` and the extractor run):
  - `--provider <id>` sets the provider of every role of the run, the judge too. `--judge-provider <id>` then moves only the judge.
  - `--model` and `--reasoning-effort` pin the judged role (classifier, drafter or extractor). `--judge-model` pins the judge.
  - The usage text lists `llmProviderIds` and says "default judge: the strong tier of the provider"; it names no model.
  - `simRoleTable`: role rate keys now always apply (stage 04), so drop the `judgeRoleRpm` path if nothing else needs it.
- **`llm:check` seam (interface for tests 4–5):** move the body into `runLlmCheck(deps: { config: Config; args: LlmCheckArgs; providers?: Partial<ProviderRegistry>; out: CliOutput }): Promise<number>` (the exit code); the script entry only parses and calls it. `providers` is passed to `createLlmClient`.
- **`llm:check`:** `--provider <id>` sets every role; `--role all` checks the four roles in one run (a greeting call each, plus the classifier triage call; `--delegates` stays classifier only). A missing key stops before any call, with `"<KEY> is missing"`. The default role stays `classifier`. Output: one line per role with role, provider, model, endpoint, host, effort, latency, tokens (no key, no text).
- **Gate files** keep their name rule: the model part is the resolved model id. A test pins it (case 6).

## Step 2 — env files and seeds

- `deploy/sim.env.example`: comment names the three providers and their keys; `DEEPSEEK_API_KEY=` line; DeepSeek with scope `all` is allowed here only because `LAB_STACK=ea-sim` (P4).
- The e2e pin (stage 04 owns it): check only that it sets every D6 key and `OPENAI_OWN_MODEL` to `""`.
- `deploy/compose.drill.yaml`: add `DEEPSEEK_API_KEY: ""` next to the other empty keys.
- `deploy/README.md`: the drafter section names the `light` tier and effort `low` instead of `LLM_DRAFTER_*`; the sim env copy lines also copy `DEEPSEEK_`; a release note for the release that carries stage 04: the keys of D6 to delete before the deploy (owner step O1), and the check "a removed key with a value stops the start".
- `evals/README.md`: flags of step 1; `--provider deepseek` example; the price rows are peak rates.

## Step 3 — capability pages

- `docs/capabilities/triage.md` rules 6, 14 and 15: one `LLM_PROVIDER`, the tier table (P1, P2), the flag meaning, `llm:check --role all`. Fix the stale judge text ("refuses when its provider is the classifier's provider": the rule is same provider and same model).
- `docs/capabilities/live-lab.md`, `measurement.md`: only if they name a per-role model key.

## Test

1. `--provider deepseek` (sim run, `--judge`): classifier `deepseek-flash`, judge `deepseek-v4-pro`; `judgeSetupError` is null (both priced).
2. `--provider deepseek --judge --judge-provider openai`: judge `gpt-6.1-terra` on openai; the openai key is needed and checked.
3. `--model gpt-6.1-terra --judge` with `LLM_PROVIDER=openai`: the run refuses with `JUDGE_SAME_MODEL` before any call.
4. `llm:check --role all --provider gemini` with a fake provider: four role lines, each `provider=gemini`, judge model `gemini-3.8-flash`; exit 0.
5. `llm:check --role all --provider deepseek` without `DEEPSEEK_API_KEY`: exit non-zero, output holds `DEEPSEEK_API_KEY is missing`, the fake provider got no call.
6. `gateFileName` of a classifier report with provider deepseek, model `deepseek-flash`, effort `none`, prompt `classifier-v2`, corpus `lab-01`, version 1: `classifier-classifier-v2-deepseek-flash-none-lab-01-v1.json`.
7. The e2e pin sets each D6 key and `OPENAI_OWN_MODEL` to `""` (no other value).
8. `--reasoning-effort low` with `--provider gemini`: a usage error that names the flag.

## Check

`bun test apps/server/src/scripts apps/server/src/modules/triage apps/server/src/modules/loops`

## Done when

- Tests 1–8 pass. No usage text, doc page or env example names a removed key, except the release note that lists them for deletion.
- The stage-01 allowlist lost the entries of the sites this stage removed.
- The Proof command of `plan.md` prints `PROOF_OK` after the last commit.

## Out of scope

The real-provider runs (owner step O2). The `provider` field of call rows (stage 06).
