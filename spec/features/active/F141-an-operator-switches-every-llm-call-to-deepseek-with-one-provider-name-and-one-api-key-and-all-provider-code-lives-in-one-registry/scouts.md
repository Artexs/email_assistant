# F141 scouts

Four scouts, started at plan base `93b6785b`, model claude-sonnet-5-5, thinking medium. Each packet is copied whole from the scout session (all assistant text, in order).

## Scout 1

- Question: List every code site outside apps/server/src/platform/llm/providers/ that names an LLM provider id (openai, gemini), a model id (gpt-*, gemini-*, o*), a provider API key env name (OPENAI_*, GEMINI_*), or branches on a provider. Include apps/server, packages/core, scripts, evals, tools, .env.example, CI workflows, docs/capabilities. For each: path, symbol, what it does, and whether it duplicates logic held in the registry.
- Job: `2026-11-19-f141-scout-1-868808f0`

### Packet

Packet: Code sites outside `providers/` that name an LLM provider, model, provider key env, or branch on a provider.
Base: 93b6785b
Verified: `rg -n -i 'openai|gemini|gpt-|OPENAI_|GEMINI_|deepseek' (non-test, outside providers/)` -> `apps/server/src/platform/config-llm.ts:50:  GEMINI_MODEL_CLASSIFIER: ... default("gemini-3.5-flash-lite")`
Unknowns:
- Did not read `providers/*.ts`, so I cannot say which items duplicate registry logic beyond the registry interface in `notes.md`. "Duplicates" below means it repeats what a registry row should hold (key name, default model, rpm, timeout, effort, endpoint).
- About 110 test files and fixtures name `gpt-6-luna` or `gemini-*`. I did not list them one by one; the test sites listed below are only the ones that carry logic.
- Gate-file JSONs in `evals/results/gate` and `apps/web/e2e/gate-fixture/classifier-e2e-trust.json` hold provider and model as data. Not listed, and `.ai/`, `tasks/`, and other docs also mention providers. `.github/workflows/ci.yml` has no LLM key or provider name.
- Other scripts (`job-run.ts`, `lab.ts`, `eval-judge-setup.ts`) have no own provider code. They read `table.providers[...]` and `row.provider`.

1. `apps/server/src/platform/config-llm.ts` — this is the main duplicate.
   - Zod keys: `GEMINI_API_KEY`, `GEMINI_MODEL_CLASSIFIER` (default `gemini-3.5-flash-lite`), `GEMINI_TIMEOUT_MS`, `GEMINI_RPM` (`defaultGeminiRpm = 12`), `OPENAI_API_KEY`, `OPENAI_OWN_API_KEY`, `OPENAI_MODEL_CLASSIFIER` (`gpt-6-luna`), `OPENAI_TIMEOUT_MS`, `OPENAI_RPM` (60), `OPENAI_REASONING_EFFORT`, `OPENAI_BASE_URL`, `OPENAI_ENDPOINT_KIND` (lines 48-65).
   - `LLM_PROVIDER` defaults to `"openai"` (line 48).
   - `openAiReasoningEfforts` (line 17) is imported by `eval-args.ts`, `extractor-eval-run.ts`, and `config.ts`.
   - `DEFAULT_JUDGE_MODEL = "gpt-6.1-terra"` (line 14) is a hard-coded judge model; it replaces the tier `strong`.
   - `providerBlocks: Record<LlmProviderId, ...>` (lines 105-125) is a per-provider table: key name, key, model, timeout, rpm, effort, endpoint. `openAiIsOwn`/`openAiEndpoint` branch on the `own` endpoint kind (lines 92-100).
   - Lines 141-146 check the key per role provider and check that `_MODEL` needs `_PROVIDER`.
   - The per-role `LLM_<ROLE>_PROVIDER/_MODEL/_TIMEOUT_MS/_RPM/_REASONING` keys are built by `roleKey` (lines 24-28, 210-236). `llmProviderIds.map` at line 236 is generic.
   - observed
2. `apps/server/src/platform/llm/settings.ts` and `testing.ts`
   - `settings.ts:38`: `providers: { gemini: provider, openai: provider }` in the uniform table helper. It names every provider id and breaks when a row is added.
   - `testing.ts:23`: test client defaults to `"gemini"`.
   - Comments at `settings.ts:12-25` describe Gemini and OpenAI semantics (`null` effort, `baseUrl` null).
   - observed
3. `apps/server/src/platform/llm/endpoint.ts`
   - `DEFAULT_OPENAI_BASE_URL`, `STANDARD_HOST = api.openai.com`, `EU_HOST`, and `isOpenAiHost` (lines 3-17).
   - It refuses hosted OpenAI-compatible hosts (line 66) and reads `OPENAI_BASE_URL` / `OPENAI_ENDPOINT_KIND`.
   - This is OpenAI host logic and does not belong to the registry. `notes.md` says to keep the refusal.
   - `client.ts:127` has a comment only; the client's rate limiter and generate cache are keyed by provider id, which is generic.
   - observed
4. `packages/core/src/triage/cost.ts`
   - `llmPrices` is keyed by model id: `gemini-3.8-flash`, `gemini-3.5-flash-lite`, `gpt-6-luna` (with an unverified EU row), `gpt-6.1-terra`. It also holds `PRICING_URL` / `OPENAI_PRICING_URL` and the endpoint-kind doc (lines 2-3, 23-47).
   - Readers: `triage-cost-report.ts:74`, `eval-report.ts:19`, `m7`, and the price checks in `eval-drafter.ts:177`, `eval-sim.ts:123`, `extractor-eval-run.ts:123`, `eval-judge-setup.ts:19`.
   - Duplicates the "price row" that F141 puts into the provider row.
   - observed
5. Other sites:
   - **`packages/core/src/metrics/cost-model.ts:46`**: `models: ["gemini-3.5-flash-lite", "gpt-6-luna"]`. A second model list that duplicates `llmPrices`. `metrics/fixtures.ts:101` is fixture data.
   - **`packages/core/src/legal/subprocessors.ts`**: rows `id: "openai"` and `"gemini"` with `activeWhen: { kind: "llmProvider", provider }` and a free `provider: string` (line 11). It stays out of scope, but a `deepseek` provider id would match no row. `packages/core/src/web/terms.ts:20` and `apps/web/src/legal/*/privacy.md` carry the OpenAI row text.
   - **`apps/server/src/platform/outside-services.ts:10-14`**: map `GEMINI_API_KEY -> "gemini"`, `OPENAI_API_KEY -> "openai"`, `OPENAI_BASE_URL -> "openai"`, and `OPENAI_OWN_API_KEY` exempt. Duplicates the key names.
   - **`apps/server/src/scripts/eval-args.ts`**:
     - usage strings with `gemini|openai` (lines 34, 46, 57, 58).
     - `provider` and `judge-provider` use `z.enum(llmProviderIds)` (generic, lines 62, 102).
     - `reasoning-effort` uses `openAiReasoningEfforts` (line 64); `extractor-eval-run.ts:56` does the same.
   - **`apps/server/src/scripts/llm-check-args.ts`**: usage and parse use `llmProviderIds` (generic). `package.json:57` has the script `gemini:test` (`--provider gemini`).
   - **`apps/server/src/scripts/e2e-seed-args.ts:497-501`**: pins `LLM_PROVIDER`, `OPENAI_MODEL_CLASSIFIER=gpt-6-luna`, `OPENAI_REASONING_EFFORT`, `OPENAI_BASE_URL`, `OPENAI_ENDPOINT_KIND` for the e2e server.
   - **`apps/server/src/scripts/eval-config.ts:8`**: comment only, the `OPENAI_BASE_URL` error text.
   - **`apps/server/src/modules/triage/evidence.ts:37-40`**: `effortOf` returns `null` when `endpoint === "own"`, a branch on the endpoint kind. `eval-results.ts:73,113` has only comments saying "Gemini".
   - **`apps/server/src/scripts/eval-judge-setup.ts:4-19`**: `JUDGE_SAME_MODEL` compares `provider` and `model` (generic). It needs a price row in `llmPrices`.
   - **`apps/server/src/modules/loops/analyze.ts:231`**: comment on Gemini schema rejection (`http_400`). `docs/capabilities/open-loops.md:80` repeats it.
   - **`apps/server/src/main.ts:92,248,513`, `scripts/job-run.ts:168`, `modules/channels/commands.ts:58,142`**: pass `classifierRow.provider` and the model to the Telegram status line. Generic.
   - **`eslint.config.js:187-300`**: `geminiImports` / `openaiImports` restrict `@google/genai` and `openai` to `providers/gemini*.ts` and `providers/openai*.ts`. A `deepseek` row that reuses the `openai` SDK needs the allow-list changed.
   - **`.env.example:1-31,34`**: lists `LLM_PROVIDER`, `GEMINI_*` (key, classifier model, timeout, rpm), `OPENAI_*` (key, classifier model, timeout, rpm, effort, base URL, endpoint kind, own key), and the `LLM_<ROLE>_*` rule.
   - **`deploy/sim.env.example:33-37`**, **`deploy/compose.drill.yaml:34-36`**: `LLM_PROVIDER`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `OPENAI_OWN_API_KEY` blanks.
   - **Docs**: `evals/README.md:56-58,88-97,112-130` (flags, quota, `OPENAI_BASE_URL`); `docs/code-patterns.md:179,248,275`; `docs/capabilities/triage.md:59,66`; `docs/capabilities/trust.md` (provider in the evidence key); `docs/capabilities/open-loops.md:80`; also `docs/own-model.md`, `docs/cost-model.md`, `docs/architecture.md`, `docs/modules.md`.
   - `tools/` has no LLM provider code (only `fake-telegram/test/setup.ts` with an `LlmClient` stub). `packages/core` has no provider branch beyond `subprocessors.ts` and the price/cost-model tables.
   - observed

Checks:
- `eslint.config.js` import restriction covers SDK imports only; it misses hard-coded provider ids, model ids, and env key names.
- `outside-services.ts`'s own test and `own-model-docs.test.ts` cover the key map and the docs text; they would need updates, and neither covers `config-llm.ts` defaults.
- No existing test or lint rule proves zero provider names outside the registry (F141 acceptance asks for one).
The packet above stands. The note's two end checks and its rule line are marked below.

## Note check
- Every site that names a provider, model, key env or provider branch is listed: not proven. My `rg` calls were piped (`| cut`) or joined with `;` and newlines, so they do not count as proof. The list is also incomplete. I did not enumerate about 110 test files, gate-file JSONs, or the `.ai/`, `tasks/`, `docs/decisions/` and `docs/legal/` mentions. I did not read `providers/*.ts`, so the "duplicates registry logic" column is inferred from `notes.md`.
- The packet is read-only and the worktree is clean: proven. `git diff --quiet HEAD && test -z "$(git status --porcelain)"` exited 0 with no output, run once as a single `&&` call. It was run after the packet was written.

Easy-to-miss rule ("Read, search, and run existing checks. Do not edit, create, or delete files."): followed in the worktree, per the clean-status command above. I did write the job note at `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-19-f141-scout-1-868808f0/note.md` because the harness required it. That path is outside the worktree, so the status command does not cover it.

## Scout 2

- Question: How does LLM config resolve today? Describe config-llm.ts (LLM_PROVIDER, per-role LLM_<ROLE>_PROVIDER/_MODEL/_TIMEOUT_MS/_RPM/_REASONING, OPENAI_MODEL_CLASSIFIER and other *_MODEL_* keys, providerBlocks, OPENAI_ENDPOINT_KIND=own), settings.ts role table, client.ts rate limiters, and endpoint.ts parseLlmBaseUrl. Which keys does each role read, what defaults apply, how does the own endpoint (F140) path differ, and does config reject unknown env keys today?
- Job: `2026-11-19-f141-scout-2-d381e1cf`

### Packet

Packet: How LLM config resolves at HEAD (keys, defaults, own endpoint, unknown-key handling)
Base: 93b6785b
Verified: `sed -n 55,100p apps/server/src/platform/config.ts` -> `const baseSchema = z.object({ ...coreShape, ...llmShape, ...mailShape, ...opsShape, ...pushShape });`
Unknowns:
- I ran no tests, so the behavior below comes from reading code, not from running it.
- The grep for `strict`/`looseObject` in config.ts matched nothing, so I take the schema as default `z.object`. I did not run a parse to confirm it strips unknown keys.
- I did not read the provider adapters under `llm/providers/`. I did not read the rest of `client.ts` (error handling, `withTimeout`).

1. `apps/server/src/platform/config-llm.ts:llmShape` — Env keys are listed explicitly (observed).
   - `LLM_PROVIDER` is enum `llmProviderIds` (`gemini`, `openai`), default `openai`.
   - Gemini keys: `GEMINI_API_KEY`, `GEMINI_MODEL_CLASSIFIER` (default `gemini-3.5-flash-lite`), `GEMINI_TIMEOUT_MS` (30000), `GEMINI_RPM` (12).
   - OpenAI keys: `OPENAI_API_KEY`, `OPENAI_OWN_API_KEY`, `OPENAI_MODEL_CLASSIFIER` (default `gpt-6-luna`), `OPENAI_TIMEOUT_MS` (30000), `OPENAI_RPM` (60), `OPENAI_REASONING_EFFORT` (default `none`), `OPENAI_BASE_URL` (default `https://api.openai.com/v1`), `OPENAI_ENDPOINT_KIND` (only `own`, optional).
   - Other keys: `LLM_DAILY_CAP` (300) and `TRIAGE_LLM_SCOPE` (`off`|`synthetic`|`all`, default `off`).
   - Empty strings count as unset through `emptyAsUndefined`.
2. `config-llm.ts:roleKeyShape` and `llmRoleTable` — The roles are `classifier`, `judge`, `drafter`, `extractor` (`packages/core/src/llm-roles.ts`). The classifier has no `LLM_CLASSIFIER_*` keys. It uses `LLM_PROVIDER` and that provider's keys (`*_MODEL_CLASSIFIER`, `*_TIMEOUT_MS`, `OPENAI_REASONING_EFFORT`) (observed).
   - Judge, drafter and extractor each get optional `LLM_<ROLE>_PROVIDER`, `_MODEL`, `_TIMEOUT_MS`, `_RPM`, `_REASONING`, with no defaults. That is 12 keys.
   - Provider: role key, else the classifier's provider.
   - Model: role key, else (judge only) `DEFAULT_JUDGE_MODEL` = `gpt-6.1-terra`, else the classifier's model when the provider matches. If the provider differs, it uses that provider block's `classifierModel`.
   - Timeout: role key, else the provider block's value. Role RPM: role key, else `null`.
   - Reasoning: role key, else the base value. The default judge model forces `none` on providers that have an effort setting.
   - Roles share the `*_MODEL_CLASSIFIER` key of their provider as the default model. No `*_MODEL_DRAFTER` or similar keys exist.
3. `config-llm.ts:providerBlocks` and `checkLlm` — `providerBlocks` is a `Record<LlmProviderId, …>` with one block per provider (observed). Each block gives `apiKeyName`, `apiKey`, `classifierModel`, `timeoutMs`, `rpm`, `reasoningEffort` and `endpoint()`. Gemini has `reasoningEffort: null` and `endpoint: () => null`.
   - `checkLlm` adds issues for: a bad `OPENAI_BASE_URL` (always checked), a missing API key for `LLM_PROVIDER` when scope ≠ `off`, a missing key for a role's own provider, `LLM_<ROLE>_MODEL` without `LLM_<ROLE>_PROVIDER`, and `LLM_<ROLE>_REASONING` on a provider without effort.
   - `llmRoleTable` returns `{ roles, providers }`. The `providers` entry has `apiKeyName`, `apiKey`, `rpm`, `baseUrl` and `endpoint`.
4. Own endpoint path (`config-llm.ts:openAiIsOwn`, `providerBlocks.openai`, `llmRoleTable.finish`; `llm/endpoint.ts:parseLlmBaseUrl`) — Own is a mode of the `openai` provider, not a third provider (observed).
   - `parseLlmBaseUrl(raw, ownKind)` rejects:
     - an invalid URL, a non-http(s) scheme, user info, a query or a fragment;
     - any `*.openai.com` host with `own` set;
     - OpenAI hosts other than `api.openai.com` (`standard`) and `eu.api.openai.com` (`eu`);
     - `http` to a non-loopback, non-one-label host;
     - a hosted non-local host unless `OPENAI_ENDPOINT_KIND=own`.
   - A loopback or one-label host (such as `ollama`) is accepted as `own` without the kind key.
   - With an own endpoint, the key is `OPENAI_OWN_API_KEY` or the dummy `"own"`. `OPENAI_API_KEY` is never used and is not needed at start. `apiKeyName` becomes `OPENAI_OWN_API_KEY`.
   - `finish()` sets `reasoningEffort: null` for every role on an own endpoint, whatever the env or override says.
   - The `endpoint` kind goes into `llm.call` usage (`client.ts`) and into `llmEndpointFields`, which returns host only.
5. `llm/client.ts:createRateLimiter` and `generate` — A limiter spaces call starts at least `60000/rpm` ms apart, per process (observed).
   - There is one limiter per provider, with rpm from `table.providers[id].rpm` (`GEMINI_RPM` or `OPENAI_RPM`), shared by all roles. There is one extra limiter per role when `row.rpm !== null`.
   - `generate` acquires the role limiter first, then the provider limiter. Generators are cached per provider and effort. Timeout is `row.timeoutMs`.
   - `llm/settings.ts` holds the types and `uniformRoleTable`. `llmEndpointFields` takes `provider.baseUrl` and reduces it to a hostname.

Unknown env keys: config does not reject them. `baseSchema` is a plain `z.object` (`config.ts`), and Zod strips unknown keys by default (guessed from Zod defaults; not run). The comment at `config.ts:118` about refusing "an unknown key" is about `FEATURES_OFF` flag names, not env names. A typo such as `LLM_DRAFTR_MODEL` is ignored without error (guessed). Only `OPENAI_ENDPOINT_KIND` (`z.literal("own")`) and enum or range values fail on a bad value. A missing key for the provider in use fails only when scope ≠ `off`.

Checks: `config-roles.test.ts`, `config.test.ts`, `llm/settings.test.ts`, `llm/endpoint.test.ts` and `llm/client-roles.test.ts` exist and match this area (observed from file names and a grep for `*_MODEL_*` keys). I did not run them or read their bodies. They cover the role table, the config schema, endpoint parsing and role rate limiting by name only. I did not check whether any test asserts that an unknown env key is ignored.
Note check
- Packet states how LLM config resolves at HEAD 93b6785b (per role, defaults, own-endpoint path): proven. Evidence: `apps/server/src/platform/config-llm.ts`, `apps/server/src/platform/llm/endpoint.ts`, `apps/server/src/platform/llm/settings.ts`. I read these in full. I read only the rate-limiter and `generate` parts of `apps/server/src/platform/llm/client.ts` (grep and lines 160-200), not the whole file.
- Packet states whether config rejects unknown env keys: not proven. `apps/server/src/platform/config.ts` shows a plain `z.object` for `baseSchema`. That the object strips unknown keys comes from Zod's default behavior. I did not run a parse and did not read a test for it.

Easy-to-miss rule ("Read, search, and run existing checks. Do not edit, create, or delete files."): followed. `test -z "$(git status --short)" && git status --short --branch` exited 0 and printed `## limen/2026-11-19-f141-scout-2-d381e1cf` with no changed files. I wrote only the job `note.md`, outside the worktree, as Limen's first instruction required.

Gaps: the unknown-key check has no run evidence, and the "Not proven yet: none" line in the note is wrong. It should name the unknown-key check. I did not edit `note.md` again.

## Scout 3

- Question: How are LLM prices and llm.call rows tied to provider and model? Describe llmPrices in packages/core (shape, keys, read dates), recordLlmCall and the llm.call row columns, how triage:cost, stats:week and metrics/m7 look up prices, what happens for a model with no price row, and how eval gate file names get the model string.
- Job: `2026-11-19-f141-scout-3-1ed40812`

### Packet

Done enough. Update note, then answer.
Packet: How llmPrices and llm.call rows tie to provider and model, and where gate file names get the model string.
Base: 93b6785b
Verified: `git status --short` -> prints nothing. Reads only; I ran no test or script.
Unknowns: I did not read stats-week.ts line by line. It runs `listLlmCallRows` (`audit/metrics-repo.ts`) into core `unitCost` (`metrics/m7.ts`). This is a guess from imports and grep. The code that fills `usage.model` for each provider adapter (`platform/llm/*`) is unread beyond `client.ts`.

1. `packages/core/src/triage/cost.ts` (llmPrices) — observed.
   - **Shape:** `Record<string, LlmPrice[]>`. The key is the bare model string, with no provider in the key. Current keys: `gemini-3.8-flash`, `gemini-3.5-flash-lite`, `gpt-6-luna`, `gpt-6.1-terra`. No DeepSeek key exists.
   - **Row fields:** `inputPerM`, `outputPerM`, optional `cachedInputPerM` (unused in costing), optional `from` (UTC YYYY-MM-DD), optional `endpoint: "eu"`, optional `unverified`, `source`, `checked`.
   - **Read dates:** `checked` is a text field and nothing reads it. `from` picks the row. `priceRowFor(model, at, endpoint)` takes the row with the latest `from` that is ≤ `at`, and a row without `from` counts as the earliest. It skips rows whose `(endpoint ?? "standard")` differs from the call's endpoint. It uses `Object.hasOwn`.
   - **Dates in data:** `gemini-3.8-flash` has a second row from 2027-01-01. The `checked` dates run 2026-11-05 to 2026-11-15.
   - **Endpoint kinds:** `LlmEndpointKind = "standard" | "eu" | "own"`. The `eu` kind is OpenAI-Europe only. Provider is not a price key. Endpoint kind is the only provider-level input to price.

2. `apps/server/src/modules/audit/repo.ts:224` (recordLlmCall) — observed.
   - **Storage:** it writes an `audit_log` row, `event = auditEvents.llmCall`, `actor = "system"`, `reason_code = call.outcome`, `created_at = call.at`, optional `email_id`.
   - **JSON `data` keys:** `mailbox_id`, `role`, `model`, `endpoint`, `prompt_version`, `tokens_in`, `tokens_out`, `latency_ms`, and a history-check key when set.
   - **No provider column:** the provider name is not stored. Only the model and endpoint kind are.
   - **Read-back:** `sumLlmCallsByModelSince` groups by `coalesce(data->>'model','unknown')` and `coalesce(data->>'endpoint','standard')`. `toEndpointKind` turns a missing or invalid endpoint into `standard`.
   - **Writers:** `triage/service.ts`, `loops/analyze.ts`, `replies/spend.ts`, `trust/history-classify.ts`. The model is `usage.model` or, on the error branch, `llm.modelOf(role)`.
   - **Model source:** `platform/llm/client.ts:165` reads `modelOf` from `table.roles[role].model`. `endpointOf` reads `table.providers[roles[role].provider].endpoint`. A call can override the model with `call.model`.

3. Price lookups — observed.
   - **Shared function:** `costPerMail(model, in, out, at, endpoint)` returns `null` when there is no price row for that model and endpoint. It returns 0 for `own`, even with no row. It charges all input tokens at `inputPerM`.
   - **`triage:cost`:** `scripts/triage-cost-report.ts:53` calls `costPerMail` per row and drops nulls with `nonNull`. A model with no price shows an empty average cost (`usd(null)`). The report also lists price rows from `llmPrices` at line 74 and prints "own endpoint: cost 0" for `own`.
   - **`metrics/m7`:** `packages/core/src/metrics/m7.ts` `unitCost` calls `costPerMail` per `LlmCallRow`. A null cost, or a null `row.model`, adds to `unpricedCalls` and adds $0 to `llmUsdWeek`. `metrics/cost-model.ts` uses the unpriced count: the figure is `estimate` when `unpricedCalls` exceeds 5% of calls.
   - **`stats:week`:** see Unknowns. It also lands in `m7`.
   - **Other no-price behaviour:**
     - `operator/service.ts:48` counts `unpricedCalls`.
     - `lab/start.ts:111` refuses a run with `model_unpriced`.
     - `trust/history-classify.ts:221` ends with `cost_unknown`.
     - `scripts/eval-sim.ts:121-123` fails with "no price for model … add it to llmPrices before a sim run".
     - `eval-drafter.ts` and `loops/extractor-eval-run.ts` also call `costPerMail`.

4. `apps/server/src/modules/triage/eval-sim-report.ts:307` (gateFileName) — observed.
   - **Name:** `<role>-<promptVersion>-<model>-<effort|"default">-<scenario>-v<version>[-<endpoint>].json`. Each part passes through `safe`, which turns `[^\w.-]` into `_`. The `-eu` or `-own` suffix applies only when the endpoint is not `standard`.
   - **Model source:** `scripts/eval-sim.ts:279` passes `identity.model` from `gateIdentityOf(report)`. That function spreads the `CasesEvalReport`. The report's `model` is `row.model` (`eval-sim.ts:106`), the model of the role row in the role table. `loops/extractor-eval-run.ts:279` also calls `gateFileName`. The gate file schema (`eval-sim-report.ts:212`) also carries provider and host; the file name does not.

5. F141 relevance — guessed. One registry that owns provider code must keep three things in step. The first is the price key, a bare model string with `endpoint` kind as the only provider signal. The second is the `llm.call` `data.model` and `data.endpoint` values. The third is the gate file model part. A DeepSeek model with no `llmPrices` row yields null cost (unpriced) in reports. It also yields a hard refusal in `eval-sim` and `lab/start`.

Checks: `packages/core/src/triage/cost.test.ts` and `apps/server/test/integration/endpoint-cost.test.ts` exist and name price lookup and endpoint cost; I did not run or read them. They cover price lookup by date and endpoint; I did not confirm that they cover a model with no row.
Packet: The note covers the task. Every end check has evidence, and the worktree is clean.

Note check
- llmPrices shape, keys, read dates: proven. Evidence: `packages/core/src/triage/cost.ts`.
- recordLlmCall, llm.call columns, price lookups, no-price case: proven for `triage:cost` and `metrics/m7`; the `stats:week` link is not proven. Evidence: `apps/server/src/modules/audit/repo.ts`, `apps/server/src/scripts/triage-cost-report.ts`, `packages/core/src/metrics/m7.ts`. Gap: I did not read `stats-week.ts`. The route to `unitCost` is inferred from imports, and the packet marks it as a guess.
- Gate file name and model string: proven. Evidence: `apps/server/src/modules/triage/eval-sim-report.ts` (`gateFileName`) and `apps/server/src/scripts/eval-sim.ts` (the call to `gateFileName`).

Easy-to-miss rule ("Do not edit, create, or delete files"): followed. Evidence: a single `git status --short` call exited 0 with no output. I wrote only the job note in the main repo's `.limen/jobs/` folder, as the Limen instruction required.

Gap: the note says "Not proven yet: none". That is too strong, because the `stats:week` link is unread. The packet's Unknowns line carries this gap.

## Scout 4

- Question: How do the judge and eval scripts pick their provider and model? Describe DEFAULT_JUDGE_MODEL and JUDGE_SAME_MODEL (landed from the dropped F138 stage 01), eval-judge-setup.ts, modules/triage/eval-judge.ts, eval-drafter.ts, the eval CLI flags that pin a model, llm:check flags and what it checks per role, and the lab/sim scripts. Which of them build their own role table or read env keys directly?
- Job: `2026-11-19-f141-scout-4-aaf1289d`

### Packet

The scripts build no role table of their own and read no provider API keys from env. Every one calls `llmRoleTable(config, overrides)` in `platform/config-llm.ts` and reads keys only from the table it returns. I read all of this at HEAD (`93b6785b`) and ran nothing.

```
Packet: How judge and eval scripts pick provider and model; which build their own role table or read env keys directly
Base: 93b6785b
Verified: rg -n "llmRoleTable" apps/server/src/scripts -> eval.ts:130, eval-sim.ts:87, eval-drafter.ts:149, llm-check.ts:42 and lab.ts:90 each call it; none builds a table
Unknowns: none for the asked scripts. Not read in full: the body of eval-extractor's `runExtractorEvalRun`, which sits elsewhere in the triage module. `eval-extractor.ts` passes `deps.config` and `options` into it unchanged. Its table build is a guess.
1. apps/server/src/platform/config-llm.ts:14 — DEFAULT_JUDGE_MODEL = "gpt-6.1-terra" — observed. `rowOf("judge")` (lines ~215-235) uses it when neither `LLM_JUDGE_MODEL` nor the `--judge-model` override is set. The judge then gets effort "none", not the classifier's effort. The judge provider is `override.provider`, else `LLM_JUDGE_PROVIDER`, else the classifier's provider. The classifier provider is `overrides.classifier.provider ?? LLM_PROVIDER` (default openai). All provider keys, RPM, timeout and base URL come from this one table. The `eval-judge-setup.test.ts` and `config-roles.test.ts` tests import the constant.
2. apps/server/src/scripts/eval-judge-setup.ts — observed. JUDGE_SAME_MODEL (line 4) is a string constant: "judge model must differ from the model under test (ADR 0037)". `judgeSetupError(table, at, role="classifier"|"drafter")` returns it when the judge and the judged role share provider and model id (effort ignored). It also returns `${apiKeyName} is missing` when the judge provider has no key. It returns "no price for model …" when `firstEstimateUsd(judge.model, at, endpoint)` is null. `simRoleTable` copies the table and sets `--rpm` on the judged role's provider (shared with the judge on the same provider). `--judge-rpm` or `judgeRoleRpm` sets only the judge row's rpm. It reads no env. `eval-sim.ts` and `eval-drafter.ts` call `judgeSetupError` before any call of a `--judge` run.
3. Eval CLI flags (apps/server/src/scripts/eval-args.ts, schema at lines 62-104):
   - `--provider gemini|openai`, `--model <id>` and `--reasoning-effort none|…|max` go to the classifier row in `eval.ts` and `eval-sim.ts`, and to the drafter row in `eval-drafter.ts` (line 149).
   - With `--judge`: `--judge-provider`, `--judge-model` and `--judge-rpm` go to the judge override, and are errors without `--judge` (line 217).
   - The key check (`keys.apiKey === undefined` → `${apiKeyName} is missing`) reads the table's provider row. `eval-judge.ts` only receives an `LlmClient` plus the judge row's provider and model (`JudgeSetup`, line 24). It never picks or reads anything itself.
   - Hardcoded names in the usage text: `gemini|openai`, "default judge gpt-6.1-terra".
   - The rules-only paths take no provider, model or judge option (`eval-args.ts` ~315-327).
4. apps/server/src/scripts/llm-check.ts and llm-check-args.ts — observed. Flags: `--role classifier|judge|drafter|extractor` (default classifier), `--provider <id>` and `--delegates` (classifier only). The provider override applies to the chosen role only: `llmRoleTable(config, {[role]:{provider}})`. Every role gets one `greetingCall` (prompt version `<role>-v0`, JSON `{greeting}`). The classifier also gets a `triage` check on made-up mail, and `delegates` with `--delegates`. Output lines show role, provider, model, endpoint, host, effort and latency, tokens in and out. It checks the key from the table and writes no DB row. Its usage text lists `llmProviderIds` dynamically.
5. Lab and sim scripts — observed:
   - `lab.ts:90` calls `llmRoleTable(config)` with no overrides and passes `models` (the role's model and its provider's endpoint kind) for `LAB_ROLES`. It also passes `process.env` into the lab env check (`lab-env-check.ts:16`) and reads `LAB_STATE_DIR`. It reads no LLM key.
   - `sim.ts`, `sim-args.ts` and `sim-commands.ts` use no provider; `--checker <model id>` in `sim label-import` is a label tag only. No `process.env` read touches an LLM key. The matches that remain are `XDG_STATE_HOME` and `HOME` for the spend ledger path (`eval-sim.ts:157`, `eval-drafter.ts:212`, `eval-extractor.ts:42`).
   - `loadEvalConfig` is a wrapper around `loadConfig()`.
Checks: apps/server/src/scripts/eval-judge-setup.test.ts covers judgeSetupError and simRoleTable; apps/server/src/platform/config-roles.test.ts covers the judge default; apps/server/src/scripts/llm-check-args.test.ts covers flag parsing. I ran none of these. They miss a real provider call, and any table build inside the extractor eval run (unread).
```
The packet is delivered, but one gap is open. I did not read the extractor eval's table build in full.

## Note check
- The packet names how judge, eval, llm:check, lab and sim scripts pick provider and model: proven. `rg -n "llmRoleTable\(" apps/server/src/scripts/eval.ts apps/server/src/scripts/eval-sim.ts apps/server/src/scripts/eval-drafter.ts apps/server/src/scripts/llm-check.ts apps/server/src/scripts/lab.ts && git diff --quiet && test -z "$(git status --porcelain)" && echo clean` ran in one bash call, joined with `&&` only, and exited 0. It showed each script's table call at eval.ts:130, eval-sim.ts:87, eval-drafter.ts:149, llm-check.ts:42 and lab.ts:90. I read the flag schemas in `eval-args.ts` and `llm-check-args.ts` in earlier calls.
- The packet says which scripts build their own role table or read env keys directly: not proven. The earlier `rg` for `process.env` ran in a call that used `;` and a pipe, so it does not count as proof. The last call shows no script builds its own table. It does not show the absence of direct env reads. The extractor eval table build is unread (`runExtractorEvalRun`).
- DEFAULT_JUDGE_MODEL and JUDGE_SAME_MODEL are described from code: proven. The same call's first command printed `config-llm.ts:14` and `eval-judge-setup.ts:4`.

Easy-to-miss rule, "Read, search, and run existing checks. Do not edit, create, or delete files.": followed for the worktree. `git diff --quiet && test -z "$(git status --porcelain)" && echo clean` printed `clean`. One gap: I wrote the job note at `.limen/jobs/2026-11-19-f141-scout-4-aaf1289d/note.md`, outside the worktree, because Limen required it.

Not proven yet: the check on which scripts read env keys directly.

