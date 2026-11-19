# F138 · OpenAI only: plan

> **Status 2026-11-19 — planned.** Plan base: 6aecc639. 6 stages; nothing built.

Defaults: [questions.md](questions.md). Scouts: [scouts.md](scouts.md).

## Input

Owner (ticket, 2026-11-19): "use only OpenAI". "Pick an OpenAI model for the judge that is not the model under test, and record why." "Keep the provider registry shape if a later provider is wanted." "F076 and F072 become obsolete or stay parked; the plan decides and says so." Job: "F115 stage 02 (real drafter run) must resume on the new models, so state in the plan how it moves."

### Product decisions

- **P1** Every LLM call (product, evals, judge) goes to OpenAI. No Gemini code, key, setting or current doc remains.
- **P2** The judge is another OpenAI model than the model under test. This replaces "another model family" of PD-026 (owner, ticket).

### Design decisions

- **D1 Registry.** `llmProviders` keeps its shape with one row, `openai`. `LLM_PROVIDER` and the provider flags stay. Rejected: remove the registry (owner 2026-11-06: "allow more providers later").
- **D2 Old env values.** `LLM_PROVIDER=gemini` or `LLM_<ROLE>_PROVIDER=gemini` fails the start with a `ConfigError` that names the key, never the value. Leftover `GEMINI_*` keys are ignored, no warning (C1 removes them).
- **D3 Judge rule.** `judgeSetupError` refuses when the judge model equals the model under test: same provider and same model id, whatever the effort. Message: `JUDGE_SAME_MODEL`. Rejected: the same model at another effort (self-grading). Accepted residual (N10): exact ids, so a dated alias of the model under test passes; it needs its own price row, and ADR 0037 names it.
- **D4 Default judge.** The only trigger is the model: when neither `LLM_JUDGE_MODEL` nor `--judge-model` is set, the judge model is `DEFAULT_JUDGE_MODEL = "gpt-6.1-terra"`, whatever other judge key or flag is set (N3). Effort `none` unless `LLM_JUDGE_REASONING`. Reason: verified price row (2026-11-15), larger than `gpt-6-luna`, called at effort `none` in F109 stage 13. Rejected: `gpt-6-luna` (the model under test); effort `low` (not verified on this model).
- **D5 Judge in the state key.** A judged run's state file name holds `-judge-<model>`, so a resume never mixes two judges' grades (the Gemini partial state is never reused). Rejected: `--fresh` by hand.
- **D6 Rates on one provider.** `--rpm` sets the provider limit, which all roles of the run share. `--judge-rpm` sets only the judge role's own limit. Rejected: today's rule (it would slow the drafter too).
- **D7 Prices and stored data.** The Gemini price rows go. Old Gemini `llm.call` rows count as unpriced (true: free tier). No migration: stored provider and model values are data. A stored Gemini grant parses and does not match.
- **D8 Test names.** Tests use neutral names (`other`, `model-b`), never a vendor name.
- **D9 Legal.** Remove the sub-processor row `gemini` and the privacy sentence "An install can use Google Gemini instead" (en, pl). Add a `TERMS_HISTORY` entry; members accept again at the next sign-in (default, owner to confirm, Q1). This is in stage 02: a test ties each `llmProvider` row to `llmProviderIds`. The entry comment names no vendor (N4). Rows `google-oauth` and push (Google FCM) stay. Rejected: wait for the legal batch of F115 stage 17.
- **D10 Docs.** New ADR 0037 (next free number at `HEAD`): supersedes 0007 and 0013; amends 0012, 0015 and 0035. PD-026, PD-110 and product-brief Q8, Q11 get a dated "Changed by ADR 0037" line. ADR 0035 decision 6 changes: if OpenAI refuses the EU project, the only EU path is an own model endpoint in the EU (F111), not Vertex AI (Q2).
- **D11 F115 stage 02 move.** The coordinator lands the F115 stage 02 branch (`limen/2026-11-19-f115-s02-real-drafter-run-opus-r-e0509e39`, after its Opus review) first. Its step 3 (holdout and injection runs) moves to F138 stage 06 with the judge `gpt-6.1-terra`; nothing else of the commands changes. The Gemini partial state and report stay as history. F115 G1 reads the stage 06 reports. Owner-later item 2 (a DeepSeek key) is void.
- **D12 Other tickets.** F076 (Vertex AI EU), F072 (provider fallback) and F023 (Gemini billing alert) are obsolete: drop them (Q3). A later provider gets a new ticket. F111 needs a refresh: its stage 07 refusal branch unparks F076, and stages 02–03 name Gemini.
- **D13 Runs.** Every real run uses `--budget-usd 1 --concurrency 2 --rpm 30` (owner rule 2026-11-15; N9: the key and rate are production's); stage 06 spends at most $2.50. Any 429 stops the stage. Exit 1 on a failed bar is a result: record it and go on (N1). The classifier holdout runs as a smoke run (`--limit 20`, no gate file, Q4).
- **D15 Provider tests (T3).** Tests of the provider-generic mechanism move to a test-only second row `other` (`twoProviderTable()` in `platform/llm/testing.ts`); env tests that parse a second provider are deleted (stage 02).
- **D14** The judge prompt stays `judge-v1`.

## Facts checked (2026-11-19, at 6aecc639)

- F1 `LLM_PROVIDER` is `z.enum(llmProviderIds).default("openai")`; no SQL migration or settings table holds a provider or model (scout 1, read).
- F2 `judgeSetupError` refuses a judge on the provider under test (also on the F115 branch).
- F3 One rate limiter per provider, one per role with its own rpm (`client.ts`).
- F4 `gpt-6.1-terra` costs $1 / $5 per 1M tokens (`llmPrices`, checked 2026-11-15); F109 stage 13 called it at effort `none`.
- F5 Eval ledger: $2.77 spent in November of the $20 month cap (`eval-spend.jsonl`).
- F7 A legal text change needs a `TERMS_HISTORY` entry (`legal-version.test.ts`).
- F10 `--limit` is valid with `--sim` and writes no gate file (plan review 1).
- F8 No judge-agreement number exists at `HEAD`. PD-083's owner check of 20 drafts is F115 stage 18; it now checks the new judge.
- F9 `.github/workflows` set no LLM key or provider; `deploy/compose.drill.yaml` is stage 02.

## Not verified

- N1 The OpenAI project limit (ADR 0015 set $3 a month; production shares the key). Owner step O1.
- N2 Judge cost: about $0.002 per call, 360 calls; stage 06 measures it on dev.

## Done when

- The ticket grep finds only stage 05 § Allowed hits.
- `bun run llm:check`, `bun run llm:check --role judge` and the classifier holdout smoke run pass with no `GEMINI_*` key read.
- Drafter holdout report, injection report and gate file on `gpt-6-luna` + judge `gpt-6.1-terra` are committed.
- ADR 0037 names the judge model and why; privacy pages and the registry name no Gemini.

## Rules for every stage

- A gap or a deviation is a question in the final message, not a choice.
- Format only the files of the stage. Never run the repo-wide formatter.
- Never print, log or commit a key or `.env`. Config errors name the key, never the value.
- Old `evals/results/` files and dated ADR text are history: never edit them.

## Proof

```
mkdir -p /tmp/f138-sNN && bun run lint > /tmp/f138-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f138-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f138-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f138-sNN/int.log 2>&1 && echo PROOF_OK
```

## Owner checkpoints and steps

- **O1 (before stage 06, real money):** the owner confirms the OpenAI project limit leaves at least $3 above this month's spend. A hit limit pauses triage on the VPS.
- **C1 (coordinator):** delete every `GEMINI_*` line, every `LLM_*PROVIDER=gemini` line and the other `LLM_<ROLE>_*` lines of such a role (a `_MODEL` without `_PROVIDER` fails the start, N2). Local `.env` before stage 06 (T1); VPS `.env` and `deploy/sim.env` before the deploy that holds stage 02. `sed -i`; check with `grep -c` (counts only). After the deploy, `bun run llm:check` in the new image.
- **C2 (coordinator, when the plan lands):** the edits outside this folder of the final message, including F111 stage 07 (Vertex fallback), F115 stage 17 (the claim row of the removed registry row) and F115 stage 02 (judge on Gemini, PD-026 rule) (N8).

## Review

Opus review before the land: stages 01, 02 and 06 (`[risky]`: LLM evals; production config, legal and Polish text; real money). Stages 03–05 land on the Proof.

## Stages

- 01 [Judge on OpenAI](stages/stage-01-judge-on-openai.md) `[risky]`
- 02 [Remove the Gemini provider](stages/stage-02-remove-provider.md) `[risky]`
- 03 [Neutral test names and tool text](stages/stage-03-test-names-and-tool-text.md)
- 04 [ADR 0037, decision notes, internal papers](stages/stage-04-adr-and-papers.md)
- 05 [Current docs and the allowed hits](stages/stage-05-current-docs.md)
- 06 [Runs on OpenAI](stages/stage-06-runs.md) `[risky]`

## How to run (coordinator)

- Land the F115 stage 02 branch first (D11). Move this ticket to `active/`; run `scripts/plan-drift.sh` first.
- Worker `claude-sonnet-5-5`, `--prepare 'bash scripts/limen-prepare.sh'`. 01 → 02 → {03, 04 in parallel} → 05 → O1, C1 local → 06 (B2). Drop the job DB after each land.
- Stage 06 needs the OpenAI key (`limen-prepare.sh` copies `.env`); else the coordinator runs its step 2 in the main checkout.

## Planning progress

- Scouts: 3 (`scouts.md`). [written] ticket, plan, stages 01–06, questions. Words: plan ≤ 1500; stages ≤ 700.

## Cold review

Model `claude-opus-5-5` (stages 01, 02, 06 are `[risky]`). [plan-review-1.md](plan-review-1.md): FAIL at 5175a70f, 2 BLOCKING, 3 TEST GAP, 11 NOTE. All 16 fixed; the map is in [plan-review-1-fixes.md](plan-review-1-fixes.md).

## Log
