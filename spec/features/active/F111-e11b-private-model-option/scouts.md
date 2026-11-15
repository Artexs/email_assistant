# F111 scouts

Three Sonnet 5.5 scouts (medium thinking) at base `2e2451be`, 2026-11-15. Each packet is copied whole from the job log. A packet is a lead; the planner checked the facts that decisions use (plan.md § Facts checked).

## Scout 1 · job `2026-11-15-f111-scout-1-3c41a3af`

**Question:**

How does the OpenAI LLM adapter build its client and its requests (Responses API, strict JSON schema, timeouts, retries), where are LLM config keys read (LLM_PROVIDER, OPENAI_API_KEY, model names per role), and where are model prices and per-call cost computed and stored? List every place that a new OPENAI_BASE_URL setting and an EU price uplift (+10%) would need to reach, including logs, error texts, health checks and the LLM roles registry. Context: spec/features/planned/F111-e11b-private-model-option/ticket.md. Answer for the code at HEAD.

**Packet:**

Packet: How the OpenAI adapter builds client and requests, where config, prices and cost live, and where OPENAI_BASE_URL and a +10% EU uplift must reach.
Base: 2e2451be
Verified: `git status --short` in the worktree -> empty output (nothing edited); every location below came from reads and greps, and I ran no tests.
Unknowns: I ran no check, so I did not test that the SDK accepts a custom `baseURL` with the Responses API.
- `/health` (`platform/http.ts:351`) checks only the DB; no LLM health check exists.
- No `OPENAI_*` keys appear in `deploy/` apart from `deploy/README.md:656`.
- Not read: `deploy/` env templates and the `docs/` pages (ADR 0015, `architecture.md:428-429`, `capabilities/triage.md`) that list the OpenAI keys.

1. `apps/server/src/platform/llm/providers/openai.ts:102,151` — The client is `new OpenAI({ apiKey, maxRetries: 0 })` from `openAiClientOptions(apiKey)`, with no `baseURL`. `createOpenAiGenerate` calls `client.responses.create(toResponseParams(...), { signal })`. `toResponseParams` (lines 65-85) sets `text.format = json_schema` with `strict: true` and `store: false`, plus an optional `reasoning.effort`. `toStrictJsonSchema` (53) throws `schema_not_strict` for a loose schema. Retries are off because the pause logic retries. The timeout comes from `AbortSignal.timeout(row.timeoutMs)` plus `withTimeout` in `platform/llm/client.ts:160-170`, not from the SDK. — observed
2. A new `OPENAI_BASE_URL` must reach these places:
   - `platform/config.ts:134-138` — add a Zod key next to the other `OPENAI_*` keys.
   - `platform/config.ts:30-37` — `ProviderBlock` and `providerBlocks.openai` need a base-URL field.
   - `platform/llm/settings.ts:16-23` — `LlmProviderSettings` carries only `apiKeyName`, `apiKey` and `rpm` today.
   - `platform/config.ts:192-197` — `llmRoleTable` copies these three fields into `providers`.
   - `platform/llm/settings.ts:34` — `uniformRoleTable` is the test helper.
   - `platform/llm/client.ts:141-143` — `generatorOf` passes only `{ apiKey, reasoningEffort }` to `createGenerate`.
   - `platform/llm/providers/index.ts:12` — the `LlmProvider.createGenerate` opts type needs the field.
   - `platform/llm/providers/openai.ts:102,146-151` — add it to `openAiClientOptions` and `createOpenAiGenerate`.
   - `.env.example:11-20` — document the key.
   - Existing tests: `apps/server/src/platform/config.test.ts` and `config-roles.test.ts` assert exact provider rows with `toEqual`.
   — observed
3. LLM roles registry: `packages/core/src/llm-roles.ts:3` lists five roles. It holds no provider data. Roles get provider and model from `llmRoleTable` (`platform/config.ts:148-209`), and the classifier row comes from `LLM_PROVIDER`. A base URL set per provider applies to every role on `openai`, since there is one generator per provider and effort (`client.ts:137-146`). A per-role base URL would need a change to the generator cache key at `client.ts:138`. — observed
4. Logs and error texts:
   - `main.ts:147` logs `llm_settings` with only provider and model; add the host there if wanted.
   - `platform/llm/client.ts:180,190` logs `llm_call_ok` and `llm_call_failed` with role, model and code.
   - `openai.ts:158` has a `configHint` text that names `OPENAI_API_KEY` and the OpenAI project; the pause (`modules/triage/pause.ts:17,29`) prints it.
   - `openai.ts:114-144` — `classifyOpenAiError` reads only class, status and code, never `message`, so it does not leak the URL.
   - `scripts/llm-check.ts:54-56` prints role, provider, model and effort.
   - `scripts/llm-check.ts:42-46` prints `${keys.apiKeyName} is missing`.
   — observed
5. Prices and cost: `packages/core/src/triage/cost.ts:14-21` holds `llmPrices`, keyed by model id and dated, with `gpt-6-luna` at 0.1 in / 0.5 out per 1M tokens. `costPerMail` (28-42) computes `(in*inputPerM + out*outputPerM)/1e6` and returns null for an unknown model. The audit log stores no cost. `recordLlmCall` (`modules/audit/repo.ts:184-200`) writes `llm.call` rows with model, tokens in and out, and latency, so cost is computed at read time. The +10% uplift cannot be keyed by model id alone: the price keys and every `costPerMail` caller take only the model, so an EU model needs its own price row or a new parameter. The callers are:
   - `modules/operator/service.ts:41` (llmToday)
   - `packages/core/src/metrics/m7.ts:29`
   - `modules/triage/eval-pool.ts:26`
   - `modules/triage/eval.ts:585`
   - `scripts/eval-sim.ts:175`
   - `scripts/triage-cost.ts:81`
   Price readers that print the source and checked date: `modules/triage/eval-report.ts:218`, `scripts/triage-cost.ts:101` and the "no price for model" refusals at `scripts/eval-sim.ts:96` and `scripts/eval-judge-setup.ts:14`. — observed
6. Model names per role: `OPENAI_MODEL_CLASSIFIER` (default `gpt-6-luna`, `config.ts:135`) is the classifier and the default for other roles. `LLM_<ROLE>_MODEL`, `_PROVIDER`, `_TIMEOUT_MS`, `_RPM` and `_REASONING` come from `roleKeyShape` and `rowOf` (`config.ts:175-189`). The start check for a missing key is at `config.ts:40-70`. — observed

Checks: `config.test.ts` and `config-roles.test.ts` cover the config rows; `openai.test.ts` covers the adapter; `packages/core/src/triage/cost.test.ts` covers `costPerMail`. I ran none, so I cannot say they pass. Nothing covers an LLM health check, because none exists.
bash test -z "$(git status --short)" && git rev-parse --short HEAD
wait
think
Packet: Same packet as above. The note check follows.

Note check
- OpenAI client and request build: proven. I read `apps/server/src/platform/llm/providers/openai.ts` (lines 65-85, 102, 146-153) and `apps/server/src/platform/llm/client.ts` (lines 160-170).
- Config keys, prices and per-call cost: proven. I read `apps/server/src/platform/config.ts`, `packages/core/src/triage/cost.ts` and `apps/server/src/modules/audit/repo.ts`. Cost is computed at read time and not stored.
- Reach list for OPENAI_BASE_URL and the +10% uplift: proven. I read the files in packet items 2-5: `apps/server/src/platform/llm/settings.ts`, `apps/server/src/platform/llm/client.ts`, `apps/server/src/main.ts`, `apps/server/src/modules/triage/pause.ts` and `apps/server/src/platform/http.ts`. `/health` checks only the DB. Gaps: I did not read the `deploy/` env templates or the `docs/` pages that list the OpenAI keys. I could not verify that the SDK accepts a custom `baseURL` with the Responses API.
- Easy-to-miss rule ("Do not edit, create, or delete files"): followed. The command `test -z "$(git status --short)" && git rev-parse --short HEAD` exited 0 and printed `2e2451be`, so the worktree is clean. The note file went to the job folder in the main checkout, outside the worktree.

Not proven yet: none. I ran no tests, and the packet says so.

## Scout 2 · job `2026-11-15-f111-scout-2-b7d18fe5`

**Question:**

How does the E2a offline lab (F097, landed) run a holdout eval for a chosen model or provider: which CLI command, which flags select the model/provider/endpoint, where do result and gate files go (evals/results/ or similar), how does the gate decide go/no-go per category, and what does it cost? Could a holdout run point at an OpenAI-compatible server (another base URL, another model name) without code change? Name the reports F097 produced (stage 21/22) and their paths. Context: spec/features/planned/F111-e11b-private-model-option/ticket.md. Answer for the code at HEAD.

**Packet:**

Packet: How F097's holdout eval runs for a chosen model, where the files go, how the gate decides, the cost, and whether another OpenAI-compatible server works without code change
Base: 2e2451be08f4fd4473e01301be08dcaa5115bab2
Verified: `git status --short | wc -l` -> 0 (worktree clean). I ran no eval. `node_modules` is absent here, so the SDK `OPENAI_BASE_URL` behavior is unverified.
Unknowns:
- The code never sets `baseURL`. `openAiClientOptions` returns only `{ apiKey, maxRetries: 0 }` (`providers/openai.ts:102`). A custom endpoint therefore works only if the OpenAI SDK reads `OPENAI_BASE_URL` from env itself. I believe it does, but I could not check (guessed).
- The adapter calls only `client.responses.create` (`openai.ts:153`). A server without `/v1/responses` with strict `text.format` json_schema fails. ADR 0035 says E11b stage 1 must check this on Ollama. No test has run it (observed that the call exists, guessed that servers fail).
- ADR 0035 says `OPENAI_BASE_URL` "selects the endpoint". `grep` finds no use in code or config, and `config.ts` has no such key (observed). The ADR looks like a plan, not landed code.
- Price table: `eval --sim` stops with "no price for model X: add it to llmPrices" if the model has no row (`eval-sim.ts`, `firstEstimateUsd` null; `packages/core/src/triage/cost.ts:14`). Only `gpt-6-luna`, `gemini-3.5-flash-lite` and `gemini-3.8-flash` have rows. A new model name therefore needs a code change, and an own model needs a $0 row (observed). ADR 0035 point 5 says an own model has cost 0.

1. `apps/server/src/scripts/eval-args.ts:15-29` — Command: `bun run eval --sim lab-01 --part holdout [--provider gemini|openai] [--model <id>] [--reasoning-effort <v>] [--concurrency 8] [--rpm 240] [--budget-usd 1] [--spend-ledger <f>] [--fresh] [--out <report.md>]`. Optional `--judge --judge-provider --judge-model --judge-rpm` is for the draft judge. No endpoint flag exists. Without `--provider` and `--model`, the `.env` defaults apply: `LLM_PROVIDER` (default openai), `OPENAI_MODEL_CLASSIFIER` (default gpt-6-luna), and `OPENAI_API_KEY`. The `--provider` choices are `llmProviderIds` (gemini, openai) — observed.
2. `apps/server/src/scripts/eval-sim.ts:222-239` and `modules/triage/eval-sim-report.ts:20,289-300` — Outputs. `--out` writes the markdown report, for example `evals/results/<date>-sim-lab-01-holdout-<model>-classifier-v2.md`. The gate file goes to `evals/results/gate/<role>-<promptVersion>-<model>-<effort>-<scenario>-v<version>.json`. It is written only for a complete holdout run with no `--limit`, bar 0.98 and min-kept 30. Any other run writes none. The state file lives in `runsDir` and allows resume. The spend ledger is under `XDG_STATE_HOME`/`HOME`, with a run cap and `MONTH_CAP_USD` — observed.
3. `packages/core/src/triage/metrics.ts:99-125` — Gate rule, per category (`barCategories`). The rule sweeps confidence thresholds. A category is "go" at the first threshold with kept ≥ 30 and precision ≥ 0.98. It is "no-go" if kept ≥ 30 but precision stays under the bar. It is "no-go: too few" if no threshold keeps 30. The decision enum is in `eval-sim-report.ts:198`. The report prints the table under `## Go/no-go`. The stage 21 text adds the Wilson 95 % lower bound and ≥ 200 holdout cases per category as the rule for prompt and model changes. I did not check where code enforces that (guessed). `gate-evidence.test.ts` only checks that a gate file exists for the current prompt version, not its numbers — observed from the stage 21 text.
4. Cost, observed in `evals/results/2026-11-15-sim-lab-01-holdout-gpt-6-luna-classifier-v2.md`: 1,413 holdout cases cost $0.2704 against a cap of $1.00, or $0.000191 per mail. That is $1.148 per mailbox per month at 200 mails per day. The price is gpt-6-luna at $0.10 in and $0.50 out per 1M tokens. The stage 21 run was meant to take under 600 s at the defaults.
5. F097 reports (observed in `spec/features/done/2026-11/F097-e2a-offline-lab/stages/`):
   - Stage 21 (`stage-21-first-report-and-gate-rule.md`): `evals/results/2026-11-15-sim-lab-01-holdout-gpt-6-luna-classifier-v2.md` (the file header says date 2026-11-14), `evals/results/2026-11-15-sim-lab-01-dev-gpt-6-luna-classifier-v2-judge.md`, and gate file `evals/results/gate/classifier-classifier-v2-gpt-6-luna-none-lab-01-v1.json`.
   - Stage 22 (`stage-22-gap-report.md`): `evals/results/2026-11-15-sim-vs-real-gap-lab-01.md`. Command: `bun run eval --gap --sim-json <gate file> --real-json <real.json> --out <report>`.
   - Result on gpt-6-luna with classifier-v2: urgent, needs_reply and spam are no-go (spam precision 84.4%). Info and notification are go (threshold 0.50). The gap verdict is "no gap" for notification and spam.
   - Suspicious-mail reports (no LLM) also exist: `...-sim-lab-01-{dev,holdout,week}-suspicious.md`.

Answer to the endpoint question: no flag or config key sets a base URL. A run against another OpenAI-compatible server needs no code change only if the SDK reads `OPENAI_BASE_URL`, which I could not confirm, and only if the server supports `/v1/responses` with strict json_schema. Use `--provider openai --model <name>` with a `llmPrices` row for that name. The row needs a code change unless the name is already priced.

Checks: `eval-sim.test.ts` and `eval-sim-report.test.ts` (`gateFileRefusal`) cover the run and gate-file rules. `gate-evidence.test.ts` covers only that a gate file exists. Nothing covers a non-OpenAI base URL or a Responses-API-less server.
## Note check

- Holdout CLI command and flags for model, provider and endpoint: proven. Evidence is `apps/server/src/scripts/eval-args.ts`, read in this session. No endpoint flag exists.
- Result and gate file locations, per-category gate rule, and cost: proven. Evidence is `apps/server/src/scripts/eval-sim.ts`, `packages/core/src/triage/metrics.ts` and `evals/results/2026-11-15-sim-lab-01-holdout-gpt-6-luna-classifier-v2.md`, all read in this session.
- Base URL and model name without code change, and the stage 21/22 report paths: not proven. The report paths are read from the F097 stage files and `evals/results/`. The code never sets `baseURL`, and `node_modules` is absent, so I could not confirm that the OpenAI SDK reads `OPENAI_BASE_URL`. I also did not test `/v1/responses` support on a non-OpenAI server. A model without a `llmPrices` row needs a code change.
- Easy-to-miss rule, "Do not edit, create, or delete files.": followed. The last `git status --short | wc -l` printed 0, and that command exited 0. My tool calls only read, and the note sits outside the worktree. That check ran in a call that used `;` and `|`, so Limen may count it as not proven. I saved no log file.

Not proven yet: the SDK reading `OPENAI_BASE_URL`, and `/v1/responses` support on a non-OpenAI server.

## Scout 3 · job `2026-11-15-f111-scout-3-ea03f251`

**Question:**

Which docs, capability pages, ADRs, legal/papers drafts and web/security texts state where LLM processing happens (US, EU, no EU location, sub-processors, OpenAI region), and what ADR 0035 (LLM endpoint EU and own model) and ADR 0015 (provider switch) say now? Also: how does the per-org or per-deployment LLM config work today (is the provider global env, per org, or per role), and is there any per-org setting for model or endpoint? Context: spec/features/planned/F111-e11b-private-model-option/ticket.md. Answer for the code at HEAD.

**Packet:**

Packet: Where docs say LLM processing happens, what ADR 0035 and 0015 say, and how LLM config works (global, per org or per role).
Base: 2e2451be
Verified: `grep -rn "OPENAI_BASE_URL" . --exclude-dir=node_modules --exclude-dir=.git -l` -> only 0035, `decisions.md` and three epic files; no code or `.env.example` file. `git status --short` -> empty.
Unknowns:
- Legal texts: the `grep` of `apps/web/src/lib/legal.ts`, `apps/web/src/pages/legal` and `apps/docs/src/content` for openai/sub-processor/llm/EU found nothing. I did not read the legal page content (it may load from a path I did not open), so "no location claim there" is unconfirmed.
- Whether `evals/results` or `notes/` repeat the "no EU location" claim: not checked beyond file-name hits.
- I did not read `tasks/planned/s6e-papers-cost.md` D27 in full.
1. `docs/decisions/0035-llm-endpoint-eu-and-own-model.md` — Status is "proposed", not accepted. It adds `OPENAI_BASE_URL` (default US API) as an operator env for the `openai` provider. It covers the OpenAI EU domain and a buyer-run OpenAI-compatible server such as Ollama. It requires the E2a holdout gate for each new endpoint or model. It has no PII sanitizer. The endpoint is operator config, and the key stays in env. The owner's pilot keeps its US terms until the owner switches. The papers (S6e) would name "OpenAI, EU region" as sub-processor, or none with an own model. Vertex AI EU is the fallback if OpenAI refuses. — observed
2. `docs/decisions/0015-llm-provider-switch.md` — Status is accepted. It sets one global `LLM_PROVIDER` (`gemini|openai`) applied on restart. A 2026-11 amendment adds per-role `LLM_<ROLE>_*` keys for judge, drafter, extractor and escalation. The classifier uses `LLM_PROVIDER`, and the other roles fall back to it. It says OpenAI pilot terms are "no EU location", accepted by the user for their own mail. For customers, Vertex AI EU is the planned path, and an OpenAI EU project is an open option. There is no automatic fallback. — observed
3. Location claims, "no EU location" (pilot): `docs/architecture.md:451-452` (§6.3, OpenAI and Gemini paid tier) and `:524`; `docs/product-brief.md:33` and `:61` (Q11); `docs/roadmap.md:137`; `docs/decisions/0012-llm-data-and-cost.md:23`. Gemini paid-tier terms are at `0013-pilot-mailbox-free-tier.md:46-50`. Supabase EU (old) is at `0006:10`. — observed
4. EU promise and sub-processor plans (drafts, not yet shipped): the frame promise "Mail stays … in the EU" is quoted in ADR 0035 from `docs/product/stage-2/03-product-frame.md` §2. PD-110 is at `docs/product/stage-2/decisions.md:116`. The E11b row is at `05-execution-plan.md:50`. Sub-processor lists in the S6 papers: `tasks/active/s6-pre-sale.md:71` (D27: OpenAI, Telegram, Backblaze, Tailscale), `:123` and `:211` (old plan: Vertex AI EU, a conflicting older list), and `tasks/planned/s6e-papers-cost.md:28-35` (privacy policy names transfers to Telegram and OpenAI). `0030:20` says one typed sub-processor file will feed the site. `0022:26` and `0024:27` say no new sub-processor. — observed
5. Config at HEAD: global env, with an optional env override per role, and nothing per org. `apps/server/src/platform/config.ts:115` has `LLM_PROVIDER` defaulting to `openai`. `:338-375` builds the role table: the classifier row comes from `LLM_PROVIDER`, and each other role reads `LLM_<ROLE>_PROVIDER/MODEL/TIMEOUT_MS/RPM/REASONING`. `platform/llm/settings.ts` has `LlmRoleSettings` (provider, model, timeoutMs, rpm, reasoningEffort) and `LlmProviderSettings` (apiKey, rpm), with no endpoint field. `providers/openai.ts:102` sets `openAiClientOptions = (apiKey) => ({ apiKey, maxRetries: 0 })`, so there is no `baseURL` and the endpoint is the fixed public API. A grep of the `organizations` DDL found no LLM, model, endpoint or provider column. No per-org model or endpoint setting exists. `TRIAGE_LLM_SCOPE` is the only org-related gate: it covers which mail goes to the LLM, not which model. — observed
Checks: The grep above covers the doc and ADR files, but misses the content of legal pages, the docs-site content, and `evals/` and `notes/` hits. The code read covers `config.ts` and `settings.ts` only in part (lines 338-375 and the head of `settings.ts`). No test ran.
bash test -z "$(git status --short)" && git rev-parse --short HEAD
wait
think
The packet above is the answer. The note check is below.

## Note check
- File list of location statements: not proven. My greps ran in calls joined with `;` or piped into `head`, so no command qualifies as proof. Gaps: I did not read the legal page content, the docs-site content or the S6e papers in full, and I did not check `evals/` or `notes/` beyond file-name hits.
- ADR 0035 and ADR 0015 content: not proven. I read both files with `cat docs/decisions/0035* docs/decisions/0015* | head -150`, a call joined with `;` and a pipe, so it does not count as proof. Both files printed fully, so the packet's summary rests on what I read.
- LLM config (global env, per role, nothing per org): not proven. The evidence comes from piped `grep` and `sed` calls joined with `;`. Gap: I read only part of `apps/server/src/platform/config.ts` (lines 338-375) and the head of `settings.ts`. I did not confirm that no per-org column exists beyond one `grep` of the `organizations` DDL.
- Clean worktree: proven. `test -z "$(git status --short)" && git rev-parse --short HEAD` exited 0 and printed `2e2451be`.

Easy-to-miss rule ("Do not edit, create, or delete files"): followed. The clean-worktree command above is the evidence. I wrote only the Limen-mandated `note.md` outside the worktree, under `.limen/jobs/`.

Not proven yet: file list, ADR content, config code.

