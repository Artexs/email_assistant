# F138 · OpenAI only: plan

> **Status 2026-11-19 — planned.** Plan base: 6aecc639. 6 stages; nothing built.

Defaults for the owner: [questions.md](questions.md). Scout packets: [scouts.md](scouts.md).

## Input

Owner (ticket, 2026-11-19): "use only OpenAI". "Pick an OpenAI model for the judge that is not the model under test, and record why." "Keep the provider registry shape if a later provider is wanted." "F076 and F072 become obsolete or stay parked; the plan decides and says so." Job: "F115 stage 02 (real drafter run) must resume on the new models, so state in the plan how it moves."

### Product decisions

- **P1** Every LLM call (product, evals, judge) goes to OpenAI. No Gemini code, key, setting or current doc remains.
- **P2** The judge is another OpenAI model than the model under test. This replaces "another model family" of PD-026 (owner, ticket).

### Design decisions

- **D1 Registry.** `llmProviders` keeps its shape with one row, `openai`. `LLM_PROVIDER` stays (only `openai`, default `openai`). The flags `--provider`, `--judge-provider` and `llm:check --provider` stay; their usage text comes from `llmProviderIds`. Rejected: remove the registry (owner 2026-11-06: "allow more providers later").
- **D2 Old env values.** `LLM_PROVIDER=gemini` or `LLM_<ROLE>_PROVIDER=gemini` fails the start with a `ConfigError` that names the key, never the value. Leftover `GEMINI_*` keys are not read and give no warning. Coordinator step C1 removes them. Rejected: a start warning (noise once C1 ran).
- **D3 Judge rule.** `judgeSetupError` refuses when the judge model equals the model under test: same provider and same model id, whatever the effort. The message is `JUDGE_SAME_MODEL` = "judge model must differ from the model under test (ADR 0037)". The two `JUDGE_SAME_PROVIDER*` constants go. Rejected: the same model at another effort (a model grades its own text too kindly).
- **D4 Default judge.** With no `LLM_JUDGE_*` key, the judge row is the classifier's provider, model `DEFAULT_JUDGE_MODEL = "gpt-6.1-terra"`, effort `none`, role rpm null. Reason: it has a verified price row (2026-11-15), it is a larger model than `gpt-6-luna`, and the adapter called it at effort `none` in F109 stage 13. Rejected: `gpt-6-luna` (the model under test); effort `low` (not verified on this model).
- **D5 Judge in the state key.** The state file name of a judged run holds the judge model (suffix `-judge-<model>`), for sim and drafter runs. A resume never mixes the grades of two judges, so the Gemini partial state of F115 is never reused. Rejected: `--fresh` by hand (easy to forget).
- **D6 Rates on one provider.** `--rpm` sets the provider limit, which all roles of the run share. `--judge-rpm` sets only the judge role's own limit. Rejected: today's rule (`--judge-rpm` sets the judge provider's rate), which would also slow the drafter now.
- **D7 Prices and stored data.** The Gemini price rows go. Old `llm.call` rows with a Gemini model count as unpriced (`unpricedCalls`); that is true, they ran on the free tier. No migration: provider and model values in `triage_results`, `llm.call` and stored grants are data. `evidenceKeySchema.provider` stays `z.string()`, so a stored Gemini grant parses and does not match.
- **D8 Test names.** A test that needs "another provider or model" uses neutral names (`other`, `model-b`), never a vendor name.
- **D9 Legal.** Remove the sub-processor row `gemini` and the privacy sentence "An install can use Google Gemini instead" (en, pl). Add a `TERMS_HISTORY` entry; members accept again at the next sign-in (default, owner to confirm, Q1). The rows `google-oauth` and the push services (Google FCM) stay: they are not LLM providers. Rejected: wait for the legal batch of F115 stage 17 (the acceptance needs the pages now).
- **D10 Docs.** New ADR 0037 (next free number at `HEAD`): supersedes 0007 and 0013; amends 0012, 0015 and 0035. Dated owner decisions (PD-026, PD-110, product-brief Q8 and Q11) get one line "Changed by ADR 0037 (2026-11-19)"; their text stays. ADR 0035 decision 6 changes: if OpenAI refuses the EU project, the only EU path is an own model endpoint in the EU (F111), not Vertex AI (Q2).
- **D11 F115 stage 02 move.** The coordinator lands the F115 stage 02 branch (`limen/2026-11-19-f115-s02-real-drafter-run-opus-r-e0509e39`, after its Opus review) first: harness, injection set, dev report, notes. Its step 3 (holdout and injection runs) moves to F138 stage 06 with the judge `gpt-6.1-terra`; nothing else of the commands changes. The Gemini partial state and the partial injection report of 2026-11-19 stay as history. F115 G1 reads the stage 06 reports. Owner-later item 2 (a DeepSeek key) is void.
- **D12 Other tickets.** F076 (Vertex AI EU), F072 (provider fallback) and F023 (Gemini billing alert) are obsolete: drop them (Q3). F072 needs a second provider; a later provider gets a new ticket.
- **D13 Runs.** Every real run uses `--budget-usd 1` (owner rule 2026-11-15); stage 06 spends at most $2.50 in total. An `http_429_quota` answer stops the stage: the eval key is the production project. The classifier holdout of the acceptance runs as a smoke run (`--limit 20`, report in `/tmp`): its number cannot change (same model and prompt), so no new gate file (Q4).
- **D14 Judge text.** The judge prompt stays `judge-v1`. The English-case `language_matches` artifact of the F115 notes stays a G1 input.

## Facts checked (2026-11-19, at 6aecc639)

- F1 `LLM_PROVIDER` is `z.enum(llmProviderIds).default("openai")`; no SQL migration or settings table holds a provider or model (scout 1, read).
- F2 `judgeSetupError` refuses a judge on the drafter's or classifier's provider (`eval-judge-setup.ts`, also on the F115 branch).
- F3 The client has one rate limiter per provider and one per role with its own rpm (`client.ts`).
- F4 `gpt-6.1-terra` costs $1 / $5 per 1M tokens (`llmPrices`, checked 2026-11-15); F109 stage 13 called it at effort `none`.
- F5 Eval ledger: $2.77 spent in November of the $20 month cap (`eval-spend.jsonl`).
- F6 The judge role serves evals only; no product path calls it.
- F7 A legal text change fails `legal-version.test.ts` until `TERMS_HISTORY` gets an entry (`terms.ts`).
- F8 No judge-agreement number exists at `HEAD`. PD-083's owner check of 20 drafts is F115 stage 18; it now checks the new judge.

## Not verified

- N1 The OpenAI project limit (ADR 0015 set $3 a month; production shares the key). Owner step O1.
- N2 The judge cost: estimate $0.002 per call, about 360 calls. Stage 06 reads the real cost after the dev run.
- N3 `--limit` with `--sim` for classifier runs. Stage 06 checks the usage text first.

## Done when

- The acceptance grep finds only the allowed hits of stage 05 § Allowed hits.
- `bun run llm:check`, `bun run llm:check --role judge` and the classifier holdout smoke run pass with no `GEMINI_*` key read.
- Drafter holdout report, injection report and gate file on `gpt-6-luna` + judge `gpt-6.1-terra` are committed.
- ADR 0037 names the judge model and the reason; privacy pages and the registry name no Gemini.
- The Proof passes at every stage.

## Rules for every stage

- A gap or a deviation is a question in the final message, not a choice.
- Format only the files of the stage. Never run the repo-wide formatter.
- Never print, log or commit a key or `.env`. Config errors name the key, never the value.
- Old result files in `evals/results/` and dated ADR text are history: never edit them.
- Tests run per changed module while you work; the full chain runs once, as the Proof.

## Proof

```
mkdir -p /tmp/f138-sNN && bun run lint > /tmp/f138-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f138-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f138-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f138-sNN/int.log 2>&1 && echo PROOF_OK
```

## Owner checkpoints and steps

- **O1 (before stage 06, real money):** the owner confirms that the OpenAI project limit leaves at least $3 above this month's spend, or raises it. A hit limit pauses triage on the VPS until the month ends.
- **C1 (coordinator, before the first deploy that holds stage 02):** delete `GEMINI_*` lines and any `LLM_*PROVIDER=gemini` line from the local `.env`, the VPS `.env` and `deploy/sim.env` with `sed -i`; check with `grep -c` (counts only). Then `bun run llm:check` on the VPS.
- **C2 (coordinator, when the plan lands):** the edits outside this folder of the final message.
- Checkpoint after stage 02: Opus review, then 03–05.

## Review

Opus review before the land: stages 01, 02, 04 and 06 (`[risky]`: LLM evals, production config, legal text and Polish text, real money). Stages 03 and 05 land on the Proof.

## Stages

- 01 [Judge on OpenAI](stages/stage-01-judge-on-openai.md) `[risky]`
- 02 [Remove the Gemini provider](stages/stage-02-remove-provider.md) `[risky]`
- 03 [Neutral test names and tool text](stages/stage-03-test-names-and-tool-text.md)
- 04 [Legal pages and registry](stages/stage-04-legal.md) `[risky]`
- 05 [ADR 0037 and current docs](stages/stage-05-adr-and-docs.md)
- 06 [Runs on OpenAI](stages/stage-06-runs.md) `[risky]`

## How to run (coordinator)

- Land the F115 stage 02 branch first (D11). Move this ticket to `active/`; run `scripts/plan-drift.sh` first.
- Worker `claude-sonnet-5-5`, `--prepare 'bash scripts/limen-prepare.sh'`. 01 → 02 → {03, 04, 05 in parallel} → O1 → 06. Drop the job DB after each land.
- Stage 06 needs the OpenAI key in the job env (`limen-prepare.sh` copies `.env`). Without it, the coordinator runs step 2 in the main checkout.

## Planning progress

- Scouts: 3 (`scouts.md`).

## Cold review

## Log
