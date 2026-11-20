# F141 audit — provider-specific sites before the change

Base: `0411b5de` (master after the plan landed). Search run again at this `HEAD`; the scouts in `scouts.md` were leads.
Registry files (may name providers): `apps/server/src/platform/llm/providers/*` and, from stage 02, `packages/core/src/llm-providers.ts`.
The scan test `apps/server/src/platform/llm/provider-scan.test.ts` holds the baseline list: each file below with a `scan: yes` mark is an `ALLOWED_SITES` entry. Stage numbers are those of `plan.md`.

How the list was made: the five patterns of the scan test (`PROVIDER_PATTERNS`) over non-test `.ts` and `.tsx` files under `apps/server/src`, `packages/core/src`, `apps/web/src` and `tools/`, then `rg -i 'openai|gemini|deepseek'` over the same files for names that the patterns miss, then a read of each hit. The raw patterns hit 85 lines in 13 files: 2 registry files (`providers/gemini.ts`, `providers/openai.ts`), 1 fixture file (`packages/core/src/metrics/fixtures.ts`, which the scan skips like every `fixtures` file) and 10 files in `ALLOWED_SITES`.

## Table 1 — code sites (non-test `.ts`)

`scan: yes` = a pattern of the scan test matches the file (it is in `ALLOWED_SITES`). `scan: no` = the scan misses it; the row says why and which stage handles it.

| Path | Symbol | What it names | scan | Stage / stays |
| --- | --- | --- | --- | --- |
| `apps/server/src/platform/config-llm.ts` | `DEFAULT_JUDGE_MODEL` (l.14) | judge model id `gpt-6.1-terra` | yes | 04 removes it (judge = `strong` tier) |
| same | `llmShape`: `LLM_PROVIDER` default `"openai"`; `GEMINI_API_KEY`, `GEMINI_MODEL_CLASSIFIER` (default `gemini-3.5-flash-lite`), `GEMINI_TIMEOUT_MS`, `GEMINI_RPM` (`defaultGeminiRpm` 12); `OPENAI_API_KEY`, `OPENAI_OWN_API_KEY`, `OPENAI_MODEL_CLASSIFIER` (default `gpt-6-luna`), `OPENAI_TIMEOUT_MS`, `OPENAI_RPM` 60, `OPENAI_REASONING_EFFORT`, `OPENAI_BASE_URL`, `OPENAI_ENDPOINT_KIND` (l.48-65) | provider env keys, default models, default timeouts and rates, repeated registry data | yes | 03 adds the deepseek block from the row prefix; 04 removes the model and effort keys (D6); 07 moves the endpoint keys into the openai row |
| same | `openAiIsOwn`, `openAiEndpoint`, `OWN_DUMMY_API_KEY` (l.88-100) | branch on endpoint kind `own`; `OPENAI_ENDPOINT_KIND`, `OPENAI_BASE_URL` | yes | 07 (moves into the openai row) |
| same | `providerBlocks: Record<LlmProviderId, …>` (l.105-125) | per-provider key name, key, model, timeout, rate, effort, endpoint | yes | 03 (derived from rows), 07 |
| same | `checkLlm` (l.131-146), `roleKeyShape`, `llmRoleTable` (l.210-236) | `OPENAI_BASE_URL` check, missing key per role provider, `LLM_<ROLE>_PROVIDER/_MODEL/_REASONING` | yes | 04 (tiers, removed keys), 07 |
| `apps/server/src/platform/llm/endpoint.ts` | `DEFAULT_OPENAI_BASE_URL`, `STANDARD_HOST`, `EU_HOST`, `isOpenAiHost`, `parseLlmBaseUrl` messages (l.3-69) | OpenAI hosts `api.openai.com`, `eu.api.openai.com`; `OPENAI_ENDPOINT_KIND`; the endpoint kind `own` | yes | 07 moves the file into `providers/` (OpenAI host logic); rules unchanged |
| `apps/server/src/platform/llm/settings.ts` | doc comment (l.17) | key name `GEMINI_API_KEY` | yes | 07 (comment reworded) |
| same | `uniformRoleTable` (l.38) | `providers: { gemini: provider, openai: provider }` | no: unquoted object keys | 03 (a new id breaks the type; build the table from `llmProviderIds`) |
| `apps/server/src/platform/outside-services.ts` | outside-key map (l.10-14) | `GEMINI_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_OWN_API_KEY` | yes | stays: a hand list by design, each outside key is a decision (03 adds `DEEPSEEK_API_KEY` as exempt) |
| `apps/server/src/scripts/e2e-seed-args.ts` | `E2E_LLM_PIN` (l.497-501) | `LLM_PROVIDER`, `OPENAI_MODEL_CLASSIFIER=gpt-6-luna`, `OPENAI_REASONING_EFFORT`, `OPENAI_BASE_URL`, `OPENAI_ENDPOINT_KIND` | yes | stays: the e2e pin sets the removed keys to empty text (04 rewrites it) |
| `apps/server/src/scripts/eval-args.ts` | usage texts (l.37, 49, 60, 61) | `gemini\|openai` lists, "default judge gpt-6.1-terra" | yes | 05 (usage lists `llmProviderIds`, names no model) |
| same | `provider`, `judge-provider` enums (l.65, 105) | `llmProviderIds` | no: generic | stays: reads the registry |
| `apps/server/src/scripts/eval-args.ts`, `modules/loops/extractor-eval-run.ts` (l.56), `platform/config.ts` (l.11), `config-llm.ts` | `openAiReasoningEfforts` | OpenAI effort list as the effort type for every provider | no: identifier | 04 removes it (callers use `llmEffortLevels` from core) |
| `apps/server/src/scripts/eval-config.ts` | comment (l.8) | `OPENAI_BASE_URL` | yes | 07 (comment reworded) |
| `apps/server/src/scripts/llm-check-args.ts` | usage, parse | `llmProviderIds` | no: generic | stays: reads the registry |
| `packages/core/src/triage/cost.ts` | `PRICING_URL`, `OPENAI_PRICING_URL`, `llmPrices` keys `gemini-3.8-flash`, `gemini-3.5-flash-lite`, `gpt-6-luna` (with an unverified EU row), `gpt-6.1-terra` (l.23-48) | model ids, price rows, price source URLs, read dates | yes | 02 moves them into `llm-providers.ts`; `llmPrices` becomes the derived flat map |
| same | `LlmEndpointKind`, `priceRowFor`, `costPerMail` (l.5, 57-99) | endpoint kind `standard`, `eu`, `own` | no: no provider word | stays: the own endpoint is out of scope |
| `packages/core/src/metrics/cost-model.ts` | `pilotCost.models` (l.46) | `["gemini-3.5-flash-lite", "gpt-6-luna"]` | yes | stays: `pilotCost.models` is the measured record of the pilot weeks |
| `packages/core/src/metrics/fixtures.ts` | fixture row (l.101) | `gpt-6-luna` | skipped: fixture file | stays: test data |
| `packages/core/src/legal/subprocessors.ts` | rows `id: "openai"`, `"gemini"`, `activeWhen.provider` (l.37-72) | sub-processors, privacy URLs | yes | stays: the owner wants no legal change |
| `packages/core/src/web/terms.ts` | version comment (l.20) | "row openai" | no: the lower-case word in a comment is no quoted id | stays: legal version record |
| `apps/server/src/modules/triage/evidence.ts` | `effortOf` (l.37-42) | branch on `endpoint === "own"`; comment "OpenAI adapter" | no | stays: the own endpoint is out of scope (the private model endpoint ticket, F140) |
| `apps/server/src/scripts/triage-cost-report.ts` (l.70), `modules/triage/eval-report.ts` (l.18), `scripts/eval-sim.ts` (l.113), `scripts/eval-drafter.ts` (l.175), `modules/loops/extractor-eval-run.ts` (l.119) | `endpoint === "own"` | branch on the own endpoint: cost 0, no price check | no | stays: the own endpoint is out of scope |
| `apps/server/src/modules/triage/eval-sim-report.ts` (l.225), `modules/replies/drafter-eval-report.ts` (l.245), `modules/loops/extractor-report.ts` (l.83), `packages/core/src/trust/key.ts` (l.4, 47) | `z.enum(["standard", "eu", "own"])` | endpoint kinds in report schemas and the evidence key | no | stays: the own endpoint is out of scope |
| `apps/server/src/modules/loops/analyze.ts` (l.231), `modules/triage/eval-results.ts` (l.73, 113), `platform/llm/client.ts` (l.127) | comments | the word "Gemini" or "OpenAI" in prose | no: capital letter | 07 (reworded where the text goes stale); not data |
| `apps/server/src/platform/llm/testing.ts` | `opts.provider ?? "gemini"` (l.23) | default provider of the test client | skipped: `testing.ts` | 03 (use the first id of `llmProviderIds`) |
| `eslint.config.js` (l.187-300) | `geminiImports`, `openaiImports`, file lists `providers/gemini*.ts`, `providers/openai*.ts` | SDK import limits per adapter file | not scanned (root file) | 03 (the deepseek row reuses the `openai` SDK file; check the lists) |
| `apps/server/src/platform/llm/providers/*` | adapters, `llmProviders` | the registry | registry | stays: the registry |

Not a site: `apps/server/src/main.ts`, `scripts/job-run.ts`, `modules/channels/commands.ts` (they pass `row.provider` and the model on), `scripts/eval-judge-setup.ts` (compares provider and model generically), `scripts/lab.ts`, `scripts/sim*.ts`. They name no provider.

## Table 2 — non-code places that name a provider key or model

| Place | What it names | Stage |
| --- | --- | --- |
| `.env.example` (24 lines) | `LLM_PROVIDER`, `GEMINI_*` (key, model, timeout, rate), `OPENAI_*` (key, model, timeout, rate, effort, base URL, endpoint kind, own key), the `LLM_<ROLE>_*` block (15 keys) | 04 removes the model and effort keys (three hold values at the base: `GEMINI_MODEL_CLASSIFIER`, `OPENAI_MODEL_CLASSIFIER`, `OPENAI_REASONING_EFFORT`); 05 adds `DEEPSEEK_*` |
| `deploy/sim.env.example` (l.33-37) | `LLM_PROVIDER`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, and a comment that says the server refuses to start without `OPENAI_API_KEY` | 05 |
| `deploy/compose.drill.yaml` (l.34-36) | `GEMINI_API_KEY: ""`, `OPENAI_API_KEY: ""`, `OPENAI_OWN_API_KEY: ""` (forced empty; no LLM key reaches the drill) | 05 adds `DEEPSEEK_API_KEY: ""`; its test `deploy/test/compose-drill.test.ts` (l.158-160) lists the same keys and needs the new one |
| `deploy/README.md` (6 lines: l.30 `OPENAI_BASE_URL`, l.784, l.877 `LLM_DRAFTER_*`, l.958-960 OpenAI console, l.1127-1128 `sed` copy of `OPENAI_`, `GEMINI_`, `LLM_PROVIDER` into the sim env) | env keys, per-role keys, key copy lines | 05 (drafter section, sim copy lines, release note of removed keys) |
| `deploy/compose.yaml`, `compose.dev.yaml`, `compose.sim.yaml`, `.github/workflows/*`, `package.json` (script `gemini:test`, l.57) | the compose files and CI name no LLM key; `package.json` has the script `gemini:test` (`--provider gemini`) | 05 (`gemini:test` stays or becomes a per-provider script; decide there) |
| `evals/README.md` (13 lines: l.57-59 flags, l.89-98 "Quota (Gemini)" and OpenAI cost, l.113 judge default `gpt-6.1-terra`, l.131 `OPENAI_BASE_URL`, l.145 default judge, l.160-161 result names) | flags, per-provider keys, default judge model | 05 |
| `docs/capabilities/triage.md` (14 lines, rules 6, 14, 15, 16: l.59, 66-79) | `--judge-provider`, endpoint keys, `OPENAI_REASONING_EFFORT`, `LLM_<ROLE>_REASONING` | 05 (rules 6, 14, 15); the endpoint rule 16 stays (own endpoint) |
| `docs/capabilities/open-loops.md` (l.80), `trust.md` (l.12, 48), `reply-drafts.md` (l.73) | "schema checked on OpenAI only", provider in the evidence key, drafter `gpt-6-luna` effort `low` | stays: records of a measured fact, no key or model setting. Check in 05 and 07 |
| `docs/own-model.md` (17 lines) | `OPENAI_BASE_URL`, `OPENAI_ENDPOINT_KIND`, `OPENAI_MODEL_CLASSIFIER`, `OPENAI_OWN_API_KEY` | 04 (`OPENAI_OWN_MODEL` replaces `OPENAI_MODEL_CLASSIFIER`, P6) |
| `docs/code-patterns.md` (l.179, 248, 275), `docs/architecture.md` (21 lines), `docs/modules.md` (l.105), `docs/cost-model.md` (l.17) | the LLM key rules, the two-provider switch, the pilot models | 07 (`code-patterns.md`); the others are records and stay |

## Test files and fixtures (counted, not listed)

Searched in `apps`, `packages`, `tools` and `deploy` (`*.ts`, `*.tsx`): 92 test, fixture and helper files name a provider word (`openai`, `gemini`, `deepseek`, `gpt-`, `OPENAI_`, `GEMINI_`), and 68 of them name `gpt-6-luna`, `gemini-<digit>` or `gpt-6.1`. The scan skips them. Gate JSON files, `.ai/`, `tasks/` and `spec/` are out of scope.

## What the scan test does not catch (known holes)

- Unquoted object keys (`{ gemini: provider }`), the word "Gemini" or "OpenAI" in prose, and identifiers such as `openAiReasoningEfforts` or `isOpenAiHost`. The five patterns of the plan do not match them; they are listed above and moved by stages 03, 04 and 07.
- The endpoint kind `own` has no provider word, so the scan ignores it. The own endpoint is out of scope (the private model endpoint ticket, F140).
- `.md` files (web legal texts), root files such as `eslint.config.js`, `package.json` and `deploy/`.

## After (stage 07)

The scan test (`apps/server/src/platform/llm/provider-scan.test.ts`) passes with four permanent exceptions and no `old site` entry. `config-llm.ts`, `endpoint.ts` (now `platform/llm/providers/endpoint.ts`, a registry file), `settings.ts` and `eval-config.ts` have no match: the openai row owns its endpoint keys (`providers/openai-env.ts`), and the two comment matches name the registry.

| Exception | Reason |
| --- | --- |
| `packages/core/src/legal/subprocessors.ts` | The legal rows name the sub-processors; the owner wants no legal change. |
| `apps/server/src/platform/outside-services.ts` | A hand list by design: each outside key is a decision. |
| `apps/server/src/scripts/e2e-seed-args.ts` | The e2e pin sets every removed key and `OPENAI_OWN_MODEL` to empty text. |
| `packages/core/src/metrics/cost-model.ts` | `pilotCost.models` is a measured record, not catalog data. |

New check: `apps/server/src/platform/llm/providers/registry.test.ts` (each id of `llmProviderIds` has its three keys in the config shape and a server row).

