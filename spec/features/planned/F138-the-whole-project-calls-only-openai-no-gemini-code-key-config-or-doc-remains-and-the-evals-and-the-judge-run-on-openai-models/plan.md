# F138 · OpenAI only: plan

> **Status — planned.** Plan base: f21809c4, refreshed 2026-11-19 (first base 6aecc639; [plan-refresh-1.md](plan-refresh-1.md)). 6 stages; stage 01 landed (0d9edf6e, 334de262).

Defaults: [questions.md](questions.md). Scouts: [scouts.md](scouts.md).

## Input

Owner (ticket, 2026-11-19): "use only OpenAI". "Pick an OpenAI model for the judge that is not the model under test, and record why." "Keep the provider registry shape if a later provider is wanted." "F076 and F072 become obsolete or stay parked; the plan decides and says so." Job: "F115 stage 02 (real drafter run) must resume on the new models, so state in the plan how it moves."

### Product decisions

- **P1** Every LLM call (product, evals, judge) goes to OpenAI. No Gemini code, key, setting or current doc remains.
- **P2** The judge is another OpenAI model than the model under test. This replaces "another model family" of PD-026 (owner, ticket).

### Design decisions

- **D1 Registry.** `llmProviders` keeps its shape with one row, `openai`. `LLM_PROVIDER` and the provider flags stay. Rejected: remove the registry (owner 2026-11-06: "allow more providers later").
- **D2 Old env values.** `LLM_PROVIDER=gemini` or `LLM_<ROLE>_PROVIDER=gemini` fails the start with a `ConfigError` that names the key, never the value. Leftover `GEMINI_*` keys are ignored, no warning (C1 removes them).
- **D3 Judge rule (landed, stage 01).** `judgeSetupError` refuses when the judge model equals the model under test: same provider and same model id, whatever the effort (`JUDGE_SAME_MODEL`). Rejected: the same model at another effort. Accepted residual (N10): a dated alias of the model under test passes; it needs its own price row, and ADR 0037 names it.
- **D4 Default judge (landed, stage 01).** When neither `LLM_JUDGE_MODEL` nor `--judge-model` is set, the judge model is `DEFAULT_JUDGE_MODEL = "gpt-6.1-terra"`, effort `none` unless `LLM_JUDGE_REASONING`. Reason: verified price row (2026-11-15), larger than `gpt-6-luna`, called at effort `none` in F109 stage 13. Rejected: `gpt-6-luna` (the model under test); effort `low` (not verified on this model).
- **D5 Judge in the state key (landed, stage 01).** A judged run's state file name holds `-judge-<model>`.
- **D6 Rates on one provider (landed, stage 01).** `--rpm` sets the provider limit; `--judge-rpm` sets only the judge role's limit.
- **D7 Prices and stored data.** The Gemini price rows go. Old Gemini `llm.call` rows count as unpriced (true: free tier). No migration: stored provider and model values are data. A stored Gemini grant parses and does not match.
- **D8 Test names.** Tests use neutral names (`other`, `model-b`), never a vendor name.
- **D9 Legal.** Remove the sub-processor row `gemini` and the privacy sentence "An install can use Google Gemini instead" (en, pl). Append a `TERMS_HISTORY` entry after the newest one (`2026-11-19-2` at the refresh base, F115 stage 17); members accept again at the next sign-in (default, Q1). In stage 02: a test ties each `llmProvider` row to `llmProviderIds`. The entry comment names no vendor (N4). Rows `google-oauth` and `web-push` (Google FCM) stay.
- **D10 Docs.** New ADR 0037 (next free number at `HEAD`): supersedes 0007 and 0013; amends 0012, 0015 and 0035. PD-026, PD-110 and product-brief Q8, Q11 get a dated "Changed by ADR 0037" line. ADR 0035 decision 6: if OpenAI refuses the EU project, the only EU path is an own model endpoint in the EU, not Vertex AI (Q2).
- **D11 F115 drafter runs (overtaken at refresh).** F115 stage 02 ran the drafter holdout and the injection set on the judge `gpt-6.1-terra` itself (9c3888ff; `notes/2026-11-19-f115-s02-prototype-run.md` § Update) and runs the `drafter-v2` gate in its own job. F138 runs no drafter. Stage 06 points to the F115 reports as the ticket's "drafter holdout report and gate file" evidence. Owner-later item 2 (a DeepSeek key) stays void.
- **D12 Other tickets (done by the coordinator).** F076, F072 and F023 are in `dropped/2026-11/` (Q3). F111 is closed; its stage 07 text lives in the parked ticket F140, which already names ADR 0037 and no Vertex fallback. No edit of another ticket is left.
- **D13 Runs.** Every real run uses `--budget-usd 1 --concurrency 2 --rpm 30` (owner rule 2026-11-15; N9: the key and rate are production's); stage 06 spends at most $2.50 (expected under $0.10). Any 429 stops the stage. The classifier holdout runs as a smoke run (`--limit 20`, no gate file, Q4).
- **D14 Judge prompt.** F138 does not change a judge prompt. The default judge prompt is `judge-v2` since F115 (7c2dabaa); stage 06 runs no judge.
- **D15 Provider tests (T3).** Tests of the provider-generic mechanism use a test-only second row `other` through `twoProviderTable()`, exported from `platform/llm/testing.ts` (today a local function of `client-roles.test.ts`); env tests that parse a second provider are deleted (stage 02).
- **D16 Measured record.** `pilotCost.models` in `packages/core/src/metrics/cost-model.ts` and its row in `docs/cost-model.md` keep `gemini-3.5-flash-lite`: the pilot weeks measured it, and a rename would falsify the record (like D7). Allowed hit (stage 05 group 10). Default, Q8.

## Facts checked (refresh, at f21809c4)

- F1 `LLM_PROVIDER` is `z.enum(llmProviderIds).default("openai")`; no SQL migration or settings table holds a provider or model (scout 1).
- F2 Stage 01 landed: `JUDGE_SAME_MODEL`, `DEFAULT_JUDGE_MODEL`, judge in the state name, `--judge-rpm`.
- F3 One rate limiter per provider, one per role with its own rpm (`client.ts`).
- F4 `gpt-6.1-terra` costs $1 / $5 per 1M tokens (`llmPrices`, checked 2026-11-15).
- F7 A legal text change needs a `TERMS_HISTORY` entry (`legal-version.test.ts`).
- F8 `legal-papers.test.ts` 2b: Record B recipients equal the registry ids with personal data. So `records-of-processing.md` loses `gemini` only after the registry row goes (stage 04 needs stage 02).
- F9 `.github/workflows` set no LLM key or provider; `deploy/compose.drill.yaml` is stage 02.
- F10 `--limit` is valid with `--sim` and writes no gate file.
- F11 F115 reports on OpenAI: `evals/results/2026-11-19-sim-lab-01-holdout-gpt-6-luna-drafter-v1-reply-judge-terra.md`, the `-reply-injection-…-judge-terra.md` file, gate `drafter-drafter-v1-gpt-6-luna-low-lab-01-v1.json` (`passed: false`); `drafter-v2` files also exist.

## Not verified

- N1 The OpenAI project limit (ADR 0015 set $3 a month; production shares the key). Owner step O1.
- N2 The eval ledger sum at stage 06 time: F115 spent after the base. Stage 06 reads it.

## Done when

- The ticket grep finds only stage 05 § Allowed hits.
- `bun run llm:check`, `bun run llm:check --role judge` and the classifier holdout smoke run pass with no `GEMINI_*` key read.
- The drafter holdout report and gate file on OpenAI models exist (F115, F11); stage 06 names them.
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

- **O1 (before stage 06, real money):** the owner confirms the OpenAI project limit leaves at least $3 above this month's spend (or the eval key is in its own project, replan decision 8).
- **C1 (coordinator):** delete every `GEMINI_*` line, every `LLM_*PROVIDER=gemini` line and the other `LLM_<ROLE>_*` lines of such a role. Local `.env` before stage 06 (T1); VPS `.env` and `deploy/sim.env` before the deploy that holds stage 02. `sed -i`; check with `grep -c` (counts only). After the deploy, `bun run llm:check` in the new image.
- **C2:** done at refresh (D12).

## Review

Opus review before the land: stages 02 and 06 (`[risky]`: production config, legal and Polish text; real money). Stages 03–05 land on the Proof.

## Stages

- 01 [Judge on OpenAI](stages/stage-01-judge-on-openai.md) `[risky]` — landed
- 02 [Remove the Gemini provider](stages/stage-02-remove-provider.md) `[risky]`
- 03 [Neutral test names and tool text](stages/stage-03-test-names-and-tool-text.md)
- 04 [ADR 0037, decision notes, internal papers](stages/stage-04-adr-and-papers.md)
- 05 [Current docs and the allowed hits](stages/stage-05-current-docs.md)
- 06 [Acceptance checks on OpenAI](stages/stage-06-runs.md) `[risky]`, coordinator run

## How to run (coordinator)

- Each stage's `Needs` line names its real input. 02 (the one `bun.lock` change of the board slot) → {03, 04} → 05 → O1, C1 local → 06.
- Worker `claude-sonnet-5-5`, `--prepare 'bash scripts/limen-prepare.sh'`. Drop the job DB after each land.
- Stage 06 needs the OpenAI key (`limen-prepare.sh` copies `.env`); else the coordinator runs it in the main checkout.

## Planning progress

- Scouts: 3 (`scouts.md`); refresh 1 started none. Words at refresh: see [plan-refresh-1.md](plan-refresh-1.md).

## Cold review

Model `claude-opus-5-5` (stages 01, 02, 06 are `[risky]`). [plan-review-1.md](plan-review-1.md): FAIL at 5175a70f, 2 BLOCKING, 3 TEST GAP, 11 NOTE. All 16 fixed: [plan-review-1-fixes.md](plan-review-1-fixes.md). Refresh 1: `claude-opus-5-5` (stages 02, 06 `[risky]`; stage 06 changed in substance): [plan-review-2.md](plan-review-2.md).

## Log

- 2026-11-19 refresh 1 at f21809c4: D11, D12, D14 updated; D16 added; stage 06 shrunk to checks; Needs lines.
