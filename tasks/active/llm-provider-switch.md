> **Status 2026-11-06 — in progress.** Plan approved by the user (all recommendations). Plan committed. Left: stages 0–8 (stage 0.1 budget part is the user's; stage 8 waits for S1b stage 40; Q6 recommendation accepted).

# LLM provider switch: Gemini and OpenAI

Scope: user request 2026-11-06 ("keep both LLM providers and change them; more will come later; for now two, then the default one").
Overview note: `notes/2026-11-06-llm-provider-openai.md`. ADRs touched: 0007, 0012, 0013.
Needs: nothing for stages 0–7 (Mac only). Stage 8 (VPS) waits for the user decision Q5 (S1b shadow run, `tasks/planned/s1b-shadow-run.md`).

## Goal

The server uses Gemini or OpenAI for the LLM calls. One config value selects the provider; a restart applies it.
A third provider later needs one adapter file, one config block, price rows and one eval run. Nothing else changes.

## Done when

- `LLM_PROVIDER=gemini` (or unset): the server, the eval and all tests behave as before this task (same Gemini calls, same logs, same eval state file names).
- `LLM_PROVIDER=openai`: the triage worker classifies mail through the OpenAI Responses API with strict structured output and `store: false`.
- The server refuses to start when the selected provider has no API key and `TRIAGE_LLM_SCOPE` is not `off`. The other provider needs no key.
- Only `platform/llm/providers/gemini.ts` imports `@google/genai`. Only `platform/llm/providers/openai.ts` imports `openai`. ESLint enforces it.
- OpenAI errors map to the same codes as Gemini errors: soft (429 rate, 5xx, timeout, network), config (bad key, no money, no access, unknown model, bad schema), hard, blocked, bad output.
- No log line, error message or DB row holds a key, a prompt, an answer or an error body (same rule as now).
- `bun run llm:check --provider openai` and `--provider gemini` send the real triage schema and print model, latency and tokens.
- `bun run eval --provider openai --model <id>` runs the 92 cases. The results file for each tried OpenAI model is in `evals/results/`.
- The user picked the default provider and model from the eval results. The code default and `.env.example` show the pick.
- ADR 0014 records the decision. The docs name both providers and the data terms of each.

## What the eval is (for the user)

`bun run eval` is the quality test of the classifier. It sends 92 made-up mails with a known right category through the real LLM.
80 cases are normal mail (`evals/cases/synthetic.json`); 12 cases try to trick the model (`evals/cases/injection.json`).
The report gives precision and recall per category, a go/no-go per category (precision ≥ 98%), the injection and whitelist results,
tokens, latency and the cost per mail. ADR 0012 rule: use the cheapest model that passes. So a new provider or model needs one eval run first.
`bun run eval --real` is different: it compares your labels (`triage_feedback`) with the stored results of real mail. It makes no LLM call.

## Facts checked on 2026-11-06

Sources: https://developers.openai.com/api/docs/pricing, https://developers.openai.com/api/docs/guides/structured-outputs,
https://developers.openai.com/api/docs/guides/your-data, https://developers.openai.com/api/docs/models/gpt-6-luna, OpenAI EU residency post (2025-02-05).

| Model | Input $/1M | Output $/1M | Note |
| --- | --- | --- | --- |
| `gemini-3.5-flash-lite` (now) | 0.30 | 2.50 | Provisional classifier (architecture §6.3) |
| `gpt-6-luna` | 0.10 | 0.50 | Cheapest GPT-6 model; `reasoning.effort` none … max, default medium |
| `gpt-5-nano` | 0.05 | 0.40 | Older generation, cheaper |
| `gpt-6.1-terra` | 1.00 | 5.00 | Stronger model, for the comparison (like `gemini-3.8-flash`) |

- Estimate at 700 tokens in and 90 out per mail (stage 34 average): `gpt-6-luna` ≈ $0.00012 per mail, `gemini-3.5-flash-lite` ≈ $0.00043.
  At 200 mails per day that is about $0.7 against $2.6 per mailbox per month. Reasoning tokens count as output and add cost.
- Strict structured output: every object property must be in `required`; `additionalProperties` must be `false`; optional = nullable.
  Supported: `pattern`, `format`, `minimum`, `maximum`, `anyOf`, `enum`. An unsupported keyword gives an error on every call.
  `maxLength` is not on the supported list [not verified by a call]. Our triage schema uses `.max(300)` and `.max(600)` on strings.
- Data: API data does not train models (default). Abuse logs keep prompts and answers up to 30 days.
  The Responses API also stores responses unless `store: false`. Zero data retention and EU data residency need OpenAI approval and a new project.
- Rate limits are per organization, project and model (third-party pages: thousands of RPM on the first paid tier [not verified]).
  A 429 with `insufficient_quota` means no money or a spent limit: retry does not help.
- npm `openai` is at 7.53.0 (2026-11-06). The SDK retries 2 times by default; we turn that off (`maxRetries: 0`), because our pause logic retries.

## What changes (map)

| Place | Now | After |
| --- | --- | --- |
| `apps/server/src/platform/llm.ts` | Gemini SDK, client, errors in one file | Folder `platform/llm/`: `index.ts`, `client.ts`, `errors.ts`, `providers/{index,gemini,openai}.ts` |
| `platform/config.ts` | `GEMINI_*` keys, key check, `classifierModel()` | + `LLM_PROVIDER`, `OPENAI_*` keys, key check per provider, `llmSettings()` |
| `main.ts`, `scripts/eval.ts` | build a Gemini client | build the client of `llmSettings()`; log names the provider |
| `modules/triage/pause.ts` | message names `GEMINI_*` and Google | message from the provider (`configHint`) |
| `scripts/gemini-check.ts` | greeting check, Gemini only | `scripts/llm-check.ts --provider`; sends the triage schema; `gemini:test` stays as an alias |
| `packages/core/src/triage/cost.ts` | Gemini prices | + OpenAI prices |
| `modules/triage/eval-report.ts` | "Blocked by Google" | "Blocked by the provider"; header shows provider and reasoning effort |
| `eval --real` | all results mixed | `--model` filter and a count per model (results change model after a switch) |
| `channels` `/status` | scope only | + provider and classifier model |
| `eslint.config.js` | grammy rule only | + rules for `@google/genai` and `openai` |
| Docs | Gemini only | ADR 0014; architecture §6.3, §9; modules, code-patterns, roadmap §5, README, product brief, known-alerts |

No DB migration: `triage_results.model` and the `llm.call` audit rows already store the model id, and the ids of the two providers differ.
No change to the prompt `classifier-v1`, the daily cap (`LLM_DAILY_CAP`, Pacific quota day), the pause backoff or the retry rules.

## Proposed decisions (the user can change them)

- **D1 One global switch.** `LLM_PROVIDER` in `.env`, values `gemini` | `openai`; a restart applies it. Both roles (`classifier`, S4 `writer`) use it. See Q1.
- **D2 Keys per provider stay separate.** Keep all `GEMINI_*` keys as they are (no edit of the VPS `.env`). Add `OPENAI_API_KEY`,
  `OPENAI_MODEL` (writer, S4), `OPENAI_MODEL_CLASSIFIER`, `OPENAI_TIMEOUT_MS` (30000), `OPENAI_RPM` (60), `OPENAI_REASONING_EFFORT` (`none`).
- **D3 Provider registry.** `providers/index.ts` holds one row per provider: id, `createGenerate`, `classifyError`, `configHint`.
  `LLM_PROVIDER` takes its values from the registry. A third provider = a new row.
- **D4 The provider adapter normalizes the result:** `{ text, tokensIn, tokensOut, blocked }`. Gemini adds thinking tokens to the output;
  OpenAI output tokens already hold reasoning tokens (no double count). The shared client keeps the Zod check, the timeout and the limiter.
- **D5 OpenAI call shape:** Responses API, `instructions` = system text, `input` = prompt, `text.format` = strict JSON schema,
  `reasoning.effort` from config, `store: false`, `maxRetries: 0`, abort signal and timeout per call. No tools, no web search.
- **D6 Strict schema adapter:** made once per schema from `z.toJSONSchema`. It removes `$schema` and the keywords that stage 0 shows as rejected.
  It throws at build time when an object breaks the strict rules. Zod still checks every answer (a too long `reason` = `bad_output`).
- **D7 OpenAI error map:** timeout/abort → `timeout`; connection error → `network`; 429 `insufficient_quota` → config `http_429_quota`;
  other 429 and 5xx → soft; 401, 403, 404 → config; 400 schema error → config `http_400_schema` (every mail would fail); other 400 → hard.
  Refusal or `incomplete` with `content_filter` → `llm_blocked`; other `incomplete` → `bad_output`. Stage 0 confirms the real error shapes.
- **D8 Default stays `gemini` in code until the eval.** After stage 6 the user picks the default; the code default and `.env.example` follow. See Q2.
- **D9 Eval state file names do not change for Gemini** (open stage 36 runs can resume). For OpenAI the name adds the reasoning effort.
- **D10 No automatic fallback** from one provider to the other in this task (follow-up idea in `tasks/planned/`).

## User answers (2026-11-06)

User words: "use your proposed values. i think this doesnt require strong model so its ok to keep the simple model for it."

- **Q1:** one global `LLM_PROVIDER` (D1). A provider per role waits for S4.
- **Q2:** the default stays `gemini` until the stage 6 eval; then the user picks (D8).
- **Q3:** only the simple model: `gpt-6-luna`. No `gpt-6.1-terra` and no `gpt-5-nano` run. `cost.ts` gets only the `gpt-6-luna` price.
- **Q4:** `gpt-6-luna` with `none` and with `low`; the results decide.
- **Q5:** stages 0–7 on the Mac now. Stage 8 (VPS) only after S1b stage 40. Order: this task before the S3 build (see "Coordination").
- **Q8:** stage 9 only if the user says yes to Q6a at stage 8. Default: no stage 9.
- **Still open:** Q6 (data terms; ask before stage 7 writes the privacy text and before stage 8) and Q7 (budget value; the user sets it in step 0.1; proposal $10 per month).

## Coordination with other work (checked 2026-11-06 19:50Z)

- `git status`: master = origin/master (`ea4a4be`). No stash, one worktree.
- Files of other agents, not of this task. Never stage them: `notes/2026-11-03-project-tour.md` (modified), `docs/diagrams/`,
  `notes/2026-11-04-subagent-usage.md`. Stage files with explicit paths only, never `git add -A`.
- Other pi sessions are open in this repo (S1b shadow run, S3 plan review, S4 plan handoff). They were idle at the check.
  Before each commit: `git fetch`, `git log HEAD..origin/master`. Rebase on a new remote commit only when nothing is pushed yet; never force-push.
- **S3 build** changes the same files (`main.ts`, `config.ts`, `/status` in channels, `package.json`). Do not build S3 and this task at the same time.
- **S1b shadow run** writes `docs/architecture.md` §6.3, `evals/results/` and its task file. Stage 7 edits §6.3 last and keeps the S1b lines.
- **S4 plan** (writer role) must use `llmSettings().writerModel` and the provider switch. Tell the S4 planning session about this task.
- **S2** (stages 21–23 left) touches docs and the VPS. Stage 8 of this task does not run in the same session as S2 stage 23.

## Open questions (user) — the questions as asked on 2026-11-06

- **Q1 Switch level.** One global `LLM_PROVIDER` for all calls (D1, recommended)? Or a provider per role (classifier and S4 writer apart)?
  A provider per mailbox or per organization (in the DB) is bigger work. Recommended: global now, per role when S4 needs it.
- **Q2 Default provider.** Keep `gemini` as the default until the eval (D8, recommended), then you pick? Or make `openai` the default now?
- **Q3 Models to test.** Recommended: `gpt-6-luna` (classifier candidate) on all 92 cases; `gpt-6.1-terra` on the 18-case subset as the strong
  comparison. Add `gpt-5-nano` (cheaper, older)? Other models you want?
- **Q4 Reasoning effort.** Recommended: run `gpt-6-luna` with `none` and with `low`, then pick by the results. ADR 0012 says "lowest setting".
- **Q5 Timing and the VPS.** The S1b shadow run uses Gemini on your real mail now. Recommended: build stages 0–7 on the Mac now,
  switch the VPS (stage 8) only after S1b stage 40, so the go/no-go table has one model. Or switch the VPS earlier (for example because of the 503s)?
  Also: which order with S2 (stages 21–23 left) and S3 (plan waits for your approval)?
- **Q6 Data terms.** (a) Pilot: do you accept the OpenAI paid API terms for your own mail (no training, abuse logs up to 30 days, no EU location)?
  (b) Customers (S6): keep "Vertex AI EU" as the only path, or also allow "OpenAI EU project with zero data retention" (needs OpenAI approval)?
- **Q7 OpenAI project.** Recommended: a new project only for this app, a key for that project only, and a monthly budget with an alert.
  Which budget? (Eval runs cost cents; the pilot is below $1 per month with `gpt-6-luna`.)
- **Q8 Real-mail comparison (optional stage 9).** Do you want a command that classifies your labeled real pilot mails again with another model
  (VPS, stdout only, no DB write)? It gives a fair real-mail comparison, but it sends your real mail to OpenAI. Recommended: only if Q6a is yes.

## Plan

Stages for the plan → build → review loop (`tasks/README.md` § "How to run a slice"). The planner adds step detail
(Files, Interfaces, Test, Check, Done when, Out of scope) after the user approves the stages. Commit format: `llm: provider switch stage N — <what>`.
Checks for every code stage: `bun run typecheck`, `bun run lint`, `bun run test:unit`; stages that touch the DB layer also `bun run test:int`.

### Stage 0 — OpenAI setup and API spike [risky: security, LLM]

- [x] **0.1 (user) OpenAI project, project key, budget (Q7)**
  - Plan text: Create the OpenAI project, the project key and the budget (Q7). Put `OPENAI_API_KEY=` in the Mac `.env`.
    The agent never reads or prints the key. Check: `grep -c '^OPENAI_API_KEY=.' .env` → `1`.
  - Goal: the Mac has a project key with a monthly budget and an alert.
  - Files: `.env` (Mac only, never staged).
  - Decisions: a new OpenAI project only for this app; a key for that project only; a monthly budget with an e-mail alert (value: Q7, proposal $10 per month).
    The key part is done (log 2026-11-06). The budget part waits for the user.
  - Check: `grep -c '^OPENAI_API_KEY=.' .env` → `1`. The user confirms in chat that the budget is set (value only, no key).
  - Done when: both checks are true. The main session writes the budget value in the log.
  - Out of scope: the agent never runs `cat .env`, `grep OPENAI_API_KEY .env` without `-c`, or any command that prints the key.

- [x] **0.2 `openai` dependency and API spike**
  - Plan text: Add `openai` (exact version) to `apps/server/package.json`. A throwaway spike script (outside git) calls `gpt-6-luna` with the real
    triage schema: strict mode, `store: false`, effort `none`. Record: schema accepted or the rejected keywords; the error shape (class, status,
    `code`, `type`) of a bad key, an unknown model, a bad schema, and a refusal if one can be made with test text; the usage fields.
    Write the facts to `notes/2026-11-0X-openai-api-facts.md` (no key, no body text). These facts fix D6 and D7.
  - Goal: the facts that stages 2 and 3 need come from real calls, not from memory.
  - Files:
    - change `apps/server/package.json` and the root `bun.lock`: run `cd apps/server && bun add --exact openai@7.53.0`.
      The dependency line must be `"openai": "7.53.0"` (no `^`). Check that `bun.lock` changes only for `openai` and its own dependencies.
    - create `evals/.runs/spike/openai-spike.ts` (the folder `evals/.runs/` is in `.gitignore`: the file never goes into git).
      From there Bun finds `openai` and `@ea/core` in the root `node_modules`. Import the prompt with a relative path:
      `../../../apps/server/src/modules/triage/prompts/classifier-v1`.
    - create `notes/<run date>-openai-api-facts.md` (for example `notes/2026-11-06-openai-api-facts.md`).
  - Interfaces: none in `apps/`. The spike uses `new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 })` and
    `client.responses.create(params, { signal })`. Run it from the repo root: `bun evals/.runs/spike/openai-spike.ts` (Bun reads `.env` from the current folder).
  - Decisions:
    - Call shape (D5): Responses API; `instructions` = `buildSystemPrompt(classifierCategories)`; `input` = one made-up mail text
      (addresses on `example.com`, no real mail); `text.format` = `{ type: "json_schema", name: "result", strict: true, schema }`;
      `reasoning: { effort: "none" }`; `store: false`. No tools, no web search, no temperature, no other settings.
    - Schema = `z.toJSONSchema(buildTriageAnalysisSchema(classifierCategories))` without the root `$schema` key.
      Checked on 2026-11-06 with a local `bun -e`: this output already has `additionalProperties: false` and a full `required` list on both objects.
      It holds `maxLength` (300, 600), `pattern` (`^\d{4}-\d{2}-\d{2}$`), `minimum`/`maximum`, `enum` and `anyOf` with `{ type: "null" }`.
    - The spike prints only: case name, error class name (`error.constructor.name`), `status`, `code`, `type`, `param`, response `status`,
      `incomplete_details.reason`, output item types, usage field names and numbers, latency.
      It prints `error.message` only in cases E and F below (these messages hold no key and no prompt). It never prints the key, the prompt or the answer text.
    - Cases (about 10 calls, below $0.01):
      - A good call with the real schema. On a 400, read the rejected keyword in the message, remove it from a copy of the schema, and call again.
        Repeat until the call passes. Record the list of removed keywords (D6). Record if `pattern` with `\d` is accepted.
      - B from the good call: `status`, `output_text` present (yes/no), the `output[]` item types, the usage field names
        (`input_tokens`, `output_tokens`, `output_tokens_details.reasoning_tokens` [not verified]) and their numbers, the latency.
      - C bad key: a separate client with `apiKey: "sk-invalid-spike"`. Record class, `status`, `code`, `type`. Do not print the message.
      - D unknown model `gpt-does-not-exist`: class, `status`, `code`, `type`, `param`.
      - E bad schema: a copy of the schema where one property is not in `required`. Record class, `status`, `code`, `type`, `param` and the message.
        The `code`/`param` pair is the test for `http_400_schema` in step 3.1.
      - F bad effort: `reasoning: { effort: "bogus" }`. Record the list of accepted effort values from the message (for `OPENAI_REASONING_EFFORT` in step 2.1).
      - G incomplete: the good call with `max_output_tokens: 16`. Record `status` and `incomplete_details.reason`.
      - H timeout and abort: one call with the request option `timeout: 1`, one call with `signal: AbortSignal.timeout(1)`. Record the class names.
      - I connection error: a client with `baseURL: "http://127.0.0.1:9/v1"`. Record the class name and `error.cause?.code`.
      - J refusal: one call with a short test text that asks the model to refuse. Record the refusal item shape, or "no refusal seen".
        Do not write harmful text to make a refusal.
    - The facts for `insufficient_quota` (429) cannot be made with a call. Write them from the docs as `[not verified]`.
    - Note format: one section per case, the recorded fields only, the date and the SDK version. No key, no prompt, no answer text,
      no error message text, except the rejected keyword names (A, E) and the effort values (F).
  - Test: none (spike). The spike is not in git.
  - Check: `bun run typecheck`, `bun run lint`, `bun run test:unit` (no code change, the new dependency must not break them);
    `git status --short` shows no file under `evals/.runs/`; `grep -n '"openai"' apps/server/package.json` → `"openai": "7.53.0"`;
    `grep -c 'sk-' notes/<run date>-openai-api-facts.md` → `0`.
  - Done when: the note holds cases A–J (or "not seen"); the task log names the rejected keywords and the error shapes in one line each.
  - Out of scope: no code in `apps/` or `packages/`; no change of D6 or D7 in the task file (the main session updates them from the note);
    the spike file is not committed.

### Stage 1 — Provider seam, Gemini only, no behaviour change

- [x] **1.1 Move `platform/llm.ts` to the folder `platform/llm/`**
  - Plan text: Move `platform/llm.ts` to `platform/llm/` (`index.ts`, `client.ts`, `errors.ts`, `providers/gemini.ts`, `providers/index.ts`).
    Callers keep the import path `platform/llm`. The Gemini adapter returns the normalized result (D4). Move the tests with the code;
    every current test keeps its meaning. Check: `bun run test:unit`, then `bun run gemini:test` (live, one call).
  - Goal: the shared client and the Gemini adapter are apart; the behaviour, the logs and the error codes stay the same.
  - Files:
    - `git mv apps/server/src/platform/llm.ts apps/server/src/platform/llm/client.ts`, then split it.
    - `git mv apps/server/src/platform/llm.test.ts apps/server/src/platform/llm/client.test.ts`, then split it.
    - create `apps/server/src/platform/llm/index.ts`, `errors.ts`, `providers/index.ts`, `providers/gemini.ts`, `providers/gemini.test.ts`.
    - change the callers of `createLlmClient` (they must pass `provider`): `apps/server/src/main.ts`, `apps/server/src/scripts/eval.ts`,
      `apps/server/src/scripts/gemini-check.ts`, `apps/server/test/integration/triage-logs.test.ts`.
    - No other caller changes: `../platform/llm` and `../../src/platform/llm` resolve to `llm/index.ts` (`moduleResolution: Bundler`, Bun).
  - Interfaces:
    - `llm/errors.ts`: the classes `LlmSoftError`, `LlmConfigError`, `LlmBlockedError`, `LlmHardError`, `LlmOutputError`, the types `SoftCode`,
      `ConfigCode`, `type LlmError`, `isLlmError(error)`, `llmErrorCode(error)`, the private `errorMessage(code, model)`. Also move the shared
      helpers `isRecord(value)` and `isNetworkError(error)` with `NETWORK_CODES` here (the OpenAI adapter uses them in stage 3). Same code as now.
    - `llm/client.ts`:
      ```ts
      export interface GenerateRequest { model: string; system: string; prompt: string; jsonSchema: unknown; signal: AbortSignal } // unchanged
      // D4: the normalized result of every provider.
      export interface GenerateResult { text: string | undefined; tokensIn: number; tokensOut: number; blocked: boolean }
      export type GenerateFn = (req: GenerateRequest) => Promise<GenerateResult>;
      export interface LlmUsage { model: string; tokensIn: number; tokensOut: number; latencyMs: number } // unchanged
      export interface LlmClient { readonly classifierModel: string; classify<T>(...): Promise<{ data: T; usage: LlmUsage }> } // unchanged
      export function createRateLimiter(...) // unchanged
      export function createLlmClient(opts: {
        provider: LlmProviderId;
        apiKey: string;
        classifierModel: string;
        timeoutMs: number;
        rpm: number;
        reasoningEffort?: string | null; // default null; Gemini ignores it
        generate?: GenerateFn;
        now?: () => number;
        sleep?: (ms: number) => Promise<void>;
      }): LlmClient
      ```
      `createLlmClient` takes `const provider = llmProviders[opts.provider]`. `generate = opts.generate ?? provider.createGenerate({ apiKey, reasoningEffort })`.
      On an error it calls `provider.classifyError(error, model)` (today: `classifyLlmError`). It keeps the limiter, `withTimeout`,
      `AbortSignal.timeout(opts.timeoutMs)`, `z.toJSONSchema(req.schema)`, the Zod check and the two debug log lines exactly as now.
      `parseOutput(result, schema, model)`: `result.blocked` → `LlmBlockedError`; empty trimmed text → `LlmOutputError`; bad JSON or a Zod failure → `LlmOutputError`.
      `usage.tokensIn = result.tokensIn`, `usage.tokensOut = result.tokensOut` (the adapter already adds the thinking tokens).
    - `llm/providers/index.ts`:
      ```ts
      export interface LlmProvider {
        readonly label: string;      // name in log texts: "Gemini"
        readonly configHint: string; // text of the config-error log line (used from stage 2)
        createGenerate(opts: { apiKey: string; reasoningEffort: string | null }): GenerateFn;
        classifyError(error: unknown, model: string): LlmSoftError | LlmConfigError | LlmHardError;
      }
      export const llmProviders = { gemini: geminiProvider } satisfies Record<string, LlmProvider>;
      export type LlmProviderId = keyof typeof llmProviders;
      export const llmProviderIds = Object.keys(llmProviders) as [LlmProviderId, ...LlmProviderId[]];
      ```
      Use `import type` for the types from `../client` to keep the import graph free of runtime cycles.
    - `llm/providers/gemini.ts`: the only file that imports `@google/genai`.
      `export const geminiProvider: LlmProvider` with `label: "Gemini"` and
      `configHint: "check GEMINI_API_KEY, GEMINI_MODEL_CLASSIFIER and the Google project (billing, region)"` (the exact text of `pause.ts` now).
      `export function toGenerateParams(req: GenerateRequest): GenerateContentParameters` (moved, unchanged).
      `export function toGeminiResult(response: GeminiResponse): GenerateResult`, where `GeminiResponse` is a local structural type
      `{ text?: string; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
      promptFeedback?: { blockReason?: string }; candidates?: { finishReason?: string }[] }`. Rules (the same as `parseOutput` now):
      `tokensIn = promptTokenCount ?? 0`; `tokensOut = (candidatesTokenCount ?? 0) + (thoughtsTokenCount ?? 0)`;
      `blocked = blockReason !== undefined || (text.trim() === "" && finishReason ∈ {SAFETY, BLOCKLIST, PROHIBITED_CONTENT, SPII})`.
      `export function classifyGeminiError(error, model)` = the current `classifyLlmError` with `code400` (moved, unchanged).
      If the SDK response type does not fit `GeminiResponse` (enum types), map the fields in `createGenerate` before the call of `toGeminiResult`.
    - `llm/index.ts` re-exports: `createLlmClient`, `createRateLimiter`, the types `LlmClient`, `LlmUsage`, `GenerateFn`, `GenerateRequest`,
      `GenerateResult`, all five error classes, `llmErrorCode`, `llmProviders`, `llmProviderIds`, `type LlmProvider`, `type LlmProviderId`.
      It does not re-export `classifyGeminiError` or `toGenerateParams` (tests import them from `providers/gemini`).
  - Decisions:
    - D4: the adapter normalizes the result to `{ text, tokensIn, tokensOut, blocked }`; Gemini adds the thinking tokens to the output.
      The shared client keeps the Zod check, the timeout and the limiter.
    - D3: one registry row per provider. A third provider = a new row (and in stage 2, a config block).
    - No behaviour change: same calls, same error codes, same log lines, same error messages (`LLM error <code> (<model>)`).
    - Every caller passes `provider: "gemini"` in this stage (main, eval script, gemini-check, triage-logs test, the client tests).
    - Error messages hold only the code and the model: never the prompt, the answer, the error body or the key.
  - Test (move first, then change the code):
    - `llm/client.test.ts` keeps the groups "classify output", "classify errors" (the cases that go through the client: timeout guard, no-leak test,
      `llmErrorCode`), "rate limit and model", "logs". Fake `generate` functions return the normalized `GenerateResult`.
      Add: `blocked: true` with empty text → `llm_blocked`; `blocked: false` with empty text → `bad_output`; `tokensOut` passes through unchanged.
    - `llm/providers/gemini.test.ts` takes the Gemini-only tests: "toGenerateParams", all status cases of "classify errors"
      (429/5xx soft, 401–404 config, 400 key, 400 precondition, plain 400, non-JSON 400, 418, abort/timeout names, network code on the cause,
      unknown, keeps the model) through `classifyGeminiError`, and new `toGeminiResult` cases: thinking tokens add to the output;
      `blockReason: "SAFETY"` with no text → blocked; `finishReason: "PROHIBITED_CONTENT"` with no text → blocked;
      `finishReason: "SAFETY"` with text → not blocked; no usage → 0 tokens.
    - Every old test name has a new place with the same meaning. Write the map old name → new file in the task log line of the stage.
  - Check: `bun run typecheck`, `bun run lint`, `bun run test:unit`, `bun run db:up && bun run test:int` (the log test changes),
    `bun run gemini:test` (live, one call: prints model, latency, tokens).
    Test count: `git show HEAD:apps/server/src/platform/llm.test.ts | grep -c 'test("'` ≤ the sum of `grep -c 'test("'` in the two new test files.
  - Done when: all checks pass; `grep -rn '@google/genai' apps/server/src` shows only `platform/llm/providers/gemini.ts` (and `bun.lock`/`package.json` outside `src`).
  - Out of scope: no config change, no OpenAI code, no change of a log text, no change of `pause.ts`, no ESLint change.

- [x] **1.2 ESLint: only the adapter files import the LLM SDKs**
  - Plan text: ESLint `no-restricted-imports` for `@google/genai` and `openai` outside their adapter files. Check: a test import in another file fails lint.
  - Goal: a new import of `@google/genai` or `openai` outside its adapter fails `bun run lint`.
  - Files: `eslint.config.js`.
  - Interfaces: three pattern constants and one helper in `eslint.config.js`:
    ```js
    const grammyImports = { group: ["grammy", "grammy/*"], message: "Only apps/server/src/modules/channels/telegram/ imports grammy (D17, ADR 0005)." };
    const geminiImports = { group: ["@google/genai", "@google/genai/*"], message: "Only apps/server/src/platform/llm/providers/gemini.ts imports @google/genai (ADR 0014)." };
    const openaiImports = { group: ["openai", "openai/*"], message: "Only apps/server/src/platform/llm/providers/openai.ts imports openai (ADR 0014)." };
    const restrictImports = (patterns) => ({ "no-restricted-imports": ["error", { patterns }] });
    ```
  - Decisions:
    - In flat config a later block that sets the same rule replaces its options for the matched files. The rule options do not merge.
      So each file group gets one block with all the patterns that apply to it:
      1. `files: ["apps/server/src/**/*.ts", "packages/**/*.ts"]`, `ignores`: `apps/server/src/modules/channels/telegram/**`,
         `apps/server/src/platform/llm/providers/gemini*.ts`, `apps/server/src/platform/llm/providers/openai*.ts` → all three patterns.
      2. `files: ["apps/server/src/modules/channels/telegram/**/*.ts"]` → gemini and openai patterns.
      3. `files: ["apps/server/src/platform/llm/providers/gemini.ts", "apps/server/src/platform/llm/providers/gemini.test.ts"]` → grammy and openai patterns.
      4. `files: ["apps/server/src/platform/llm/providers/openai.ts", "apps/server/src/platform/llm/providers/openai.test.ts"]` → grammy and gemini patterns.
      The adapter test files may import their own SDK (stage 3 tests build real SDK error objects).
    - The existing grammy rule keeps its message and its scope.
    - The messages name ADR 0014 (stage 7 writes it).
  - Test: no unit test. Manual check below.
  - Check: `bun run lint` passes. Then the negative check (delete the file at the end):
    `printf 'import "openai";\nimport "@google/genai";\n' > apps/server/src/platform/lint-probe.ts && bunx eslint apps/server/src/platform/lint-probe.ts; rm apps/server/src/platform/lint-probe.ts`
    → 2 `no-restricted-imports` errors. Also `printf 'import "openai";\n' > apps/server/src/modules/channels/telegram/lint-probe.ts && bunx eslint apps/server/src/modules/channels/telegram/lint-probe.ts; rm apps/server/src/modules/channels/telegram/lint-probe.ts` → 1 error.
    `git status --short` shows no `lint-probe.ts`.
  - Done when: the lint passes on the repo, and the probes give the errors above.
  - Out of scope: no rule for `apps/server/test/**` (the current grammy rule does not cover it either); no other lint change.

### Stage 2 — Config and wiring

- [x] **2.1 Config: `LLM_PROVIDER`, `OPENAI_*` keys, key check per provider, `llmSettings()`**
  - Plan text: `config.ts`: `LLM_PROVIDER` (values from the registry, default `gemini`), the `OPENAI_*` keys (D2), the key check for the selected
    provider only, `llmSettings(config)` (provider, key, classifier model, writer model, timeout, rpm, effort). Tests in `config.test.ts`.
  - Goal: one config value selects the provider; the settings of the selected provider come from one function.
  - Files: `apps/server/src/platform/config.ts`, `apps/server/src/platform/config.test.ts`.
  - Interfaces:
    ```ts
    import { llmProviderIds, type LlmProviderId } from "./llm";
    // From the stage 0 note (case F). Placeholder until then: ["none", "low", "medium", "high", "max"] [not verified].
    export const openAiReasoningEfforts = [/* values from the note */] as const;
    export interface LlmSettings {
      provider: LlmProviderId;
      apiKeyName: string;              // env key name, for messages: "GEMINI_API_KEY"
      apiKey: string | undefined;
      classifierModel: string;
      writerModel: string;             // S4 writer role
      timeoutMs: number;
      rpm: number;
      reasoningEffort: string | null;  // null: the provider has no effort setting
    }
    export function llmSettings(config: Config, provider: LlmProviderId = config.LLM_PROVIDER): LlmSettings;
    export function classifierModel(config: Config): string; // stays; returns llmSettings(config).classifierModel
    ```
    Split the schema: `const baseSchema = z.object({ ... })`, `type BaseConfig = z.infer<typeof baseSchema>`,
    `export const configSchema = baseSchema.superRefine(...)`. One config block per provider:
    `const providerBlocks: { [P in LlmProviderId]: (config: BaseConfig) => Omit<LlmSettings, "provider"> } = { gemini: (c) => ({ apiKeyName: "GEMINI_API_KEY", apiKey: c.GEMINI_API_KEY, classifierModel: c.GEMINI_MODEL_CLASSIFIER, writerModel: c.GEMINI_MODEL, timeoutMs: c.GEMINI_TIMEOUT_MS, rpm: c.GEMINI_RPM, reasoningEffort: null }) }`.
    The type forces a block for each registry row. Stage 3 adds the `openai` block.
  - Decisions:
    - D1: `LLM_PROVIDER` is one global switch for both roles (classifier, S4 writer). A restart applies it.
      Schema: `z.preprocess((v) => (v === "" ? undefined : v), z.enum(llmProviderIds).default("gemini"))`. In this stage the registry has only `gemini`;
      `openai` becomes a valid value in stage 3 with its registry row.
    - D2: all `GEMINI_*` keys stay as they are (no edit of the VPS `.env`). New keys, empty = default (same preprocess as the Gemini keys):
      `OPENAI_API_KEY` (optional, secret: never print or log it), `OPENAI_MODEL` (writer, S4; default: question 3 below, recommendation `gpt-6.1-terra`),
      `OPENAI_MODEL_CLASSIFIER` (default `gpt-6-luna`), `OPENAI_TIMEOUT_MS` (30000), `OPENAI_RPM` (60),
      `OPENAI_REASONING_EFFORT` (`z.enum(openAiReasoningEfforts).default("none")`).
    - D8: the code default stays `gemini` until the stage 6 pick.
    - Key check: when `TRIAGE_LLM_SCOPE` is not `off`, the key of the selected provider must be set. The other provider needs no key.
      In `superRefine`: `const block = providerBlocks[config.LLM_PROVIDER](config); if (config.TRIAGE_LLM_SCOPE !== "off" && block.apiKey === undefined)`
      add the issue with `path: [block.apiKeyName]` and the message `needed when TRIAGE_LLM_SCOPE is not off`. For `gemini` this gives the same
      key list as now (`GEMINI_API_KEY`), so the current tests keep their meaning.
    - `ConfigError` messages hold only key names, never values (as now).
  - Test (first, in `config.test.ts`):
    - unset and empty `LLM_PROVIDER` → `gemini`; `LLM_PROVIDER=foo` → `ConfigError` with keys `["LLM_PROVIDER"]` and no `foo` in the message.
    - the OpenAI defaults with only the S1a keys (model, classifier model, 30000, 60, `none`); an empty `OPENAI_API_KEY` is missing;
      `OPENAI_RPM=0` and `OPENAI_REASONING_EFFORT=bogus` → `ConfigError` with the key name.
    - `TRIAGE_LLM_SCOPE=synthetic` with a `GEMINI_API_KEY` and no `OPENAI_API_KEY` → accepted (the other provider needs no key).
    - `llmSettings(config)` with the defaults → `{ provider: "gemini", apiKeyName: "GEMINI_API_KEY", classifierModel: "gemini-3.5-flash-lite", writerModel: "gemini-3.8-flash", timeoutMs: 30000, rpm: 12, reasoningEffort: null }` and the key.
    - The current tests stay and pass unchanged (`classifierModel` tests included).
  - Check: `bun run typecheck`, `bun run lint`, `bun run test:unit`.
  - Done when: the new tests and all old config tests pass.
  - Out of scope: no change of the callers (step 2.2); no `openai` registry row or config block (stage 3).

- [x] **2.2 Wiring: `main.ts`, eval script, pause text, `.env.example`**
  - Plan text: `main.ts` and `scripts/eval.ts` use `llmSettings`. Start log: `llm provider=<id> classifier=<model>` (no key). The `scope=all` warning
    names the provider. `pause.ts` uses the `configHint` of the provider. `.env.example`: an OpenAI block, `LLM_PROVIDER`.
    Check: the log test (`apps/server/test/integration/triage-logs.test.ts`) and a local start with `LLM_PROVIDER` unset.
  - Goal: the server and the eval build the client of the selected provider; with `LLM_PROVIDER` unset the logs stay as before plus one start line.
  - Files: `apps/server/src/main.ts`, `apps/server/src/scripts/eval.ts`, `apps/server/src/modules/triage/pause.ts`,
    `apps/server/src/modules/triage/pause.test.ts`, `.env.example`.
  - Interfaces:
    - `createLlmPause(opts: { baseMs?: number; maxMs?: number; configHint?: string } = {})`. Default hint:
      `"check the LLM API key, the classifier model and the provider project"`. The config log line becomes
      `` `LLM config error ${code}: ${configHint}; triage paused for ${minutes} min, until ${until.toISOString()}` ``.
      With the Gemini hint the line is the same text as now.
    - `main.ts`: `const llm = llmSettings(config)` (name it `settings` if `llm` is taken), `const provider = llmProviders[settings.provider]`.
      `triageScope(config, provider.label)`: the `all` warning becomes
      `` `triage sends the real mail of the TEST_MAILBOX_ADDRESS mailbox to ${label} (TRIAGE_LLM_SCOPE=all)` `` (same text for Gemini).
      Inside `if (scope !== null)`: first `log.info(`llm provider=${settings.provider} classifier=${settings.classifierModel}`)`, then
      `createLlmClient({ provider: settings.provider, apiKey: settings.apiKey ?? "", classifierModel: settings.classifierModel, timeoutMs: settings.timeoutMs, rpm: settings.rpm, reasoningEffort: settings.reasoningEffort })`
      and `createLlmPause({ configHint: provider.configHint })`.
    - `scripts/eval.ts`: `const settings = llmSettings(config)`. A missing key → `log.error(`${settings.apiKeyName} is missing`)` and exit 1
      (same text for Gemini). The client gets the same options as in `main.ts`. The `--provider` flag comes in stage 5.
  - Decisions:
    - No key, prompt, answer or error body in a log line.
    - The scope `off` path stays: the line `triage worker is off (TRIAGE_LLM_SCOPE=off)` and no `llm provider=` line.
    - `.env.example`: before the Gemini block add
      `# LLM provider for all LLM calls: gemini | openai. Empty = gemini. A restart applies a change. Only the selected provider needs a key.` and `LLM_PROVIDER=`.
      After the Gemini block add an OpenAI block with comments in the same style:
      `OPENAI_API_KEY=` (project key of an OpenAI project only for this app, with a monthly budget; empty = no OpenAI),
      `OPENAI_MODEL=` (writer model, S4; empty = the code default), `OPENAI_MODEL_CLASSIFIER=gpt-6-luna`, `OPENAI_TIMEOUT_MS=30000`,
      `OPENAI_RPM=60`, `OPENAI_REASONING_EFFORT=none` (lowest setting, ADR 0012). In the `TRIAGE_LLM_SCOPE` comment change
      "goes to Gemini" to "goes to the LLM provider (LLM_PROVIDER)"; keep the rest of the comment.
      The value `openai` becomes valid in stage 3; nothing deploys between the two stages.
  - Test (first): `pause.test.ts`: a config trip with `configHint: "HINT"` logs a line that holds `LLM config error http_401: HINT;`;
    a config trip without a hint holds the default text; the soft line does not change. Spy on `console.error`: `platform/log.ts` writes
    `warn` and `error` lines with `console.error`, `debug` and `info` lines with `console.log`.
  - Check: `bun run typecheck`, `bun run lint`, `bun run test:unit`, `bun run db:up && bun run test:int` (the log test must pass unchanged).
    Local start, with no LLM calls and no Telegram polling:
    `(TRIAGE_LLM_SCOPE=synthetic LLM_PROVIDER= LLM_DAILY_CAP=1 TELEGRAM_BOT_TOKEN= PORT=18080 bun run start > /tmp/ea-start.log 2>&1 & pid=$!; sleep 8; kill $pid); grep -E 'llm provider|triage' /tmp/ea-start.log`
    → a line `llm provider=gemini classifier=<GEMINI_MODEL_CLASSIFIER of .env>`. `grep -c 'AIza\|sk-' /tmp/ea-start.log` → `0`.
    Bun does not replace an env value that the shell sets with a value from `.env` [not verified]: if the log shows another scope, say so in the report.
  - Done when: all checks pass and the start log shows the line above.
  - Out of scope: no `--provider` flag in the eval (stage 5); no change of `gemini-check.ts` other than step 1.1; no `/status` change (stage 4).

### Stage 3 — OpenAI adapter [risky: LLM, security]

> User decision 2026-11-06 (question 5): split. Stage 3 = part A (pure functions and tests). Stage 3b = part B (error map, `createOpenAiGenerate`, registry row, config block). Each part gets its own review and its own commit (`stage 3`, `stage 3b`). Step 3.1 lists the parts in build order.

- [ ] **3.1 `providers/openai.ts`: call, strict schema, result, error map, registry row, config block**
  - Plan text: `providers/openai.ts`: the call (D5), the strict schema adapter (D6), the result normalization and the error map (D7), registry row.
    Unit tests with a fake SDK client: request shape (`store: false`, strict, effort, no extra settings), schema snapshot for each allowed-category
    set, refusal, `incomplete`, token counts, every error class, the 30 s guard, and "no error message holds the prompt, the key or the body".
  - Goal: `LLM_PROVIDER=openai` gives a working `GenerateFn` with the same error codes as Gemini.
  - Read first: `notes/<stage 0 date>-openai-api-facts.md`. Its facts win over the `[not verified]` items here. If a fact there disagrees with D6 or D7,
    stop and report it (the main session asks the user).
  - Build order (two parts; tests first in each part):
    - Part A: `toStrictJsonSchema`, `toResponseParams`, `toOpenAiResult` (pure functions) and their tests.
    - Part B: `classifyOpenAiError`, `createOpenAiGenerate`, `openaiProvider`, the registry row, the config block, and their tests.
  - Files:
    - create `apps/server/src/platform/llm/providers/openai.ts` (the only file in `src` that imports `openai`, except its test).
    - create `apps/server/src/platform/llm/providers/openai.test.ts` and its snapshot file `providers/__snapshots__/openai.test.ts.snap` (Bun creates it).
    - change `apps/server/src/platform/llm/errors.ts` (new codes), `apps/server/src/platform/llm/providers/index.ts` (row `openai: openaiProvider`),
      `apps/server/src/platform/config.ts` and `config.test.ts` (the `openai` block).
  - Interfaces (`providers/openai.ts`):
    ```ts
    import OpenAI from "openai";
    export const openAiClientOptions = (apiKey: string) => ({ apiKey, maxRetries: 0 });
    export function toStrictJsonSchema(jsonSchema: unknown, model: string): Record<string, unknown>;
    export function toResponseParams(req: GenerateRequest, reasoningEffort: string | null): <SDK type of responses.create params, non-streaming>;
    export function toOpenAiResult(response: OpenAiResponseLike): GenerateResult;
    export function classifyOpenAiError(error: unknown, model: string): LlmSoftError | LlmConfigError | LlmHardError;
    export function createOpenAiGenerate(opts: { apiKey: string; reasoningEffort: string | null; client?: OpenAiLike }): GenerateFn;
    export const openaiProvider: LlmProvider = {
      label: "OpenAI",
      configHint: "check OPENAI_API_KEY, OPENAI_MODEL_CLASSIFIER and the OpenAI project (billing, budget, model access)",
      createGenerate: (opts) => createOpenAiGenerate(opts),
      classifyError: classifyOpenAiError,
    };
    ```
    `OpenAiLike = { responses: { create(params, options: { signal: AbortSignal }): Promise<OpenAiResponseLike> } }` (the fake SDK client in the tests).
    `OpenAiResponseLike` = the fields that `toOpenAiResult` reads: `status`, `incomplete_details?.reason`, `output_text`,
    `output[]` (`type`, `content[]` with `type`), `usage?.input_tokens`, `usage?.output_tokens`.
    `errors.ts`: `ConfigCode` gets `"http_429_quota" | "http_400_schema" | "schema_not_strict"`; `SoftCode` gets `"http_5xx"`.
  - Decisions:
    - D5 call shape: `client.responses.create(toResponseParams(req, effort), { signal: req.signal })`, with
      `{ model, instructions: req.system, input: req.prompt, text: { format: { type: "json_schema", name: "result", strict: true, schema } }, store: false }`
      plus `reasoning: { effort }` only when the effort is not `null`. No tools, no web search, no temperature, no `max_output_tokens`, no other keys.
      The client is `new OpenAI(openAiClientOptions(apiKey))`: `maxRetries: 0`, because our pause logic retries. Build it once per `createOpenAiGenerate`.
      The shared client keeps the 30 s guard (`withTimeout`) and the abort signal.
    - D6 strict schema: `toStrictJsonSchema` makes a deep copy, removes the root `$schema`, and removes the keywords that the stage 0 note lists as
      rejected (constant `REJECTED_KEYWORDS`; for example `maxLength` if case A rejected it) at every level. It walks `properties`, `items`, `anyOf`
      and `$defs`. For each object node (`type: "object"` or `properties` present) it checks `additionalProperties === false` and that `required`
      holds every key of `properties`. A failure throws `new LlmConfigError("schema_not_strict", model)` (every mail would fail, so the pause trips).
      It does not add missing parts: `z.toJSONSchema` already gives them for our schema (checked 2026-11-06).
      Cache: a `Map<string, Record<string, unknown>>` keyed by `JSON.stringify(jsonSchema)`; clear it when it has 64 entries. Failures are not cached.
      Zod still checks every answer in the shared client: a too long `reason` is `bad_output`.
    - D4 result: a `refusal` content item in any `output` message → `{ text: undefined, blocked: true }`.
      `status === "incomplete"` with `incomplete_details.reason === "content_filter"` → `blocked: true`; any other `incomplete` →
      `{ text: undefined, blocked: false }` (the shared client gives `bad_output`). Else `text = output_text`.
      `tokensIn = usage?.input_tokens ?? 0`, `tokensOut = usage?.output_tokens ?? 0`. The output tokens already hold the reasoning tokens:
      never add `output_tokens_details.reasoning_tokens`.
    - D7 error map, in this order (use the SDK classes of the stage 0 note; the names here are `[not verified]`):
      1. not an object → hard `unknown`.
      2. `OpenAI.APIUserAbortError`, `OpenAI.APIConnectionTimeoutError`, or `name` `AbortError`/`TimeoutError` → soft `timeout`
         (check the timeout class before its parent `APIConnectionError`).
      3. `OpenAI.APIConnectionError` → soft `network`.
      4. a numeric `status`: 429 with `code === "insufficient_quota"` → config `http_429_quota` (no money or a spent limit: retry does not help);
         other 429 → soft `http_429`; 500, 502, 503, 504 → soft `http_<status>`; other 5xx → soft `http_5xx`;
         401, 402, 403, 404 → config `http_<status>`; 400 with the schema `code`/`param` of stage 0 case E → config `http_400_schema`;
         other 400 → hard `http_400`; other statuses → hard `http_<status>`.
      5. no status: `isNetworkError(error)` (from `errors.ts`) → soft `network`; else hard `unknown`.
      Read only `status`, `code`, `type`, `param` and the class. Never read, log or store `message` or the body.
    - Registry row `openai: openaiProvider` in `providers/index.ts`. With it, `LLM_PROVIDER=openai` is valid.
    - Config block in `config.ts`: `openai: (c) => ({ apiKeyName: "OPENAI_API_KEY", apiKey: c.OPENAI_API_KEY, classifierModel: c.OPENAI_MODEL_CLASSIFIER, writerModel: c.OPENAI_MODEL, timeoutMs: c.OPENAI_TIMEOUT_MS, rpm: c.OPENAI_RPM, reasoningEffort: c.OPENAI_REASONING_EFFORT })`.
    - D10: no fallback to the other provider.
  - Test (first; fake SDK client, no network):
    - request shape: the params have exactly the keys `model`, `instructions`, `input`, `text`, `reasoning`, `store`; `store === false`;
      `text.format` = `{ type: "json_schema", name: "result", strict: true, schema }`; `reasoning.effort === "none"`; the request options hold the signal.
      With effort `null` there is no `reasoning` key. `openAiClientOptions("k")` → `{ apiKey: "k", maxRetries: 0 }`.
    - schema: `toMatchSnapshot()` of `toStrictJsonSchema(z.toJSONSchema(buildTriageAnalysisSchema(classifierCategories)), "m")`;
      for every non-empty subset of `classifierCategories` (31 sets): no throw, no `$schema`, no rejected keyword, every object strict.
      A schema with an `.optional()` property → `LlmConfigError` `schema_not_strict`. Two calls with the same schema use the cache (same object back).
    - result: normal answer → text and tokens; `output_tokens: 90` with `reasoning_tokens: 40` → `tokensOut` 90 (no double count);
      refusal → `blocked: true`; `incomplete` + `content_filter` → blocked; `incomplete` + `max_output_tokens` → not blocked, no text.
      Through `createLlmClient({ provider: "openai", generate: createOpenAiGenerate({ ..., client: fake }) })`: refusal → `llm_blocked`,
      other `incomplete` → `bad_output`, a `reason` of 301 characters → `bad_output`.
    - errors: one case per rule of D7 with real SDK error objects (build them with the SDK, for example `OpenAI.APIError.generate(...)`,
      or the constructors of the installed version [not verified]): 429 `insufficient_quota`, 429 rate, 500/502/503/504, 520, 401/403/404,
      400 schema, other 400, 418, connection error, connection timeout, user abort, plain `Error`, a string. The code keeps the model.
    - 30 s guard: a fake `create` that never ends, client `timeoutMs: 50` → `timeout` within 1 s.
    - no leak: errors whose message and body hold `MARKER-BODY`, a prompt `MARKER-PROMPT`, a key `MARKER-KEY`: the thrown error message,
      `String(error)` and all spied log lines hold none of the markers.
    - config (`config.test.ts`): `LLM_PROVIDER=openai` + `TRIAGE_LLM_SCOPE=synthetic` without `OPENAI_API_KEY` → `ConfigError` keys `["OPENAI_API_KEY"]`;
      with `OPENAI_API_KEY` and no `GEMINI_API_KEY` → accepted; `llmSettings` for `openai` → the OpenAI values and `reasoningEffort: "none"`;
      `llmSettings(config, "openai")` with `LLM_PROVIDER` unset works too.
  - Check: `bun run typecheck`, `bun run lint`, `bun run test:unit`. Then `grep -rn 'from "openai"' apps/server/src` → only `providers/openai.ts` and `providers/openai.test.ts`.
  - Done when: all tests pass; the error map matches D7 and the stage 0 note.
  - Out of scope: no live call (stage 4 has the live check); no change of `main.ts`, the eval or the texts; no fallback; no change of the prompt.

### Stage 4 — Check script, prices, texts

- [ ] **4.1 `scripts/llm-check.ts --provider <id>`**
  - Plan text: `scripts/llm-check.ts --provider <id>` (default `LLM_PROVIDER`): one greeting call, then one call with the triage schema.
    Root scripts: `llm:check`; `gemini:test` = `llm:check --provider gemini`. Check: both providers live on the Mac.
  - Goal: one command checks the key, the model and the real triage schema of a provider.
  - Files: create `apps/server/src/scripts/llm-check.ts`; `git rm apps/server/src/scripts/gemini-check.ts`; root `package.json` scripts.
  - Interfaces:
    - `parseArgs` with `--provider` (string, optional, strict). The value must be in `llmProviderIds`, else print the usage and exit 1.
    - `const config = loadConfig(); const settings = llmSettings(config, provider ?? config.LLM_PROVIDER)`. A missing key →
      `log.error(`${settings.apiKeyName} is missing`)`, exit 1. Client: the same options as in `main.ts`.
    - Call 1: `llm.classify({ schema: z.object({ greeting: z.string() }), system: "Answer with a JSON object.", prompt: "Say hello in the field greeting." })`.
    - Call 2: `classifyEmail(llm, { email: SAMPLE_EMAIL, sender: { whitelisted: false, vip: false, noreply: false }, allowed: classifierCategories })`
      (import `classifyEmail` from `../modules/triage`, `classifierCategories` from `@ea/core`). `SAMPLE_EMAIL` is a made-up `ClassifierEmail`
      constant in the script: addresses on `example.com`, a short meeting request, no thread, no real data.
    - Output: one line per call:
      `provider=<id> model=<m> effort=<e or -> check=<greeting|triage> latencyMs=<n> tokensIn=<n> tokensOut=<n>`; the triage line adds `category=<enum>`.
      On an error: `log.error(`check failed: ${describeError(error)}`)`, exit 1.
    - Root `package.json`: `"llm:check": "bun apps/server/src/scripts/llm-check.ts"`,
      `"gemini:test": "bun apps/server/src/scripts/llm-check.ts --provider gemini"`.
  - Decisions:
    - The check uses the classifier model of the provider (the old `gemini-check.ts` used `GEMINI_MODEL`, the writer model).
    - The script prints no key, no prompt and no answer text (only the category enum).
    - `loadConfig()` needs the full `.env` (also `DATABASE_URL`, `CREDENTIALS_KEY`); the Mac and the VPS have it.
  - Test: no unit test (a thin script over tested code). The live check is the test.
  - Check: `bun run typecheck`, `bun run lint`, `bun run test:unit`; live on the Mac: `bun run llm:check --provider gemini`,
    `bun run llm:check --provider openai`, `bun run gemini:test`. Each prints two lines with model, latency and tokens.
  - Done when: the three live commands exit 0.
  - Out of scope: no change of the README (stage 7); no DB access.

- [ ] **4.2 Price, eval report texts, `/status`**
  - Plan text: `cost.ts`: the `gpt-6-luna` price (Q3), with source and date. `eval-report.ts`: "Blocked by the provider", header with provider
    and effort. `/status` in Telegram: provider and classifier model. Tests updated.
  - Goal: cost, the report and `/status` name the provider and the model.
  - Files: `packages/core/src/triage/cost.ts`, `packages/core/src/triage/cost.test.ts`; `apps/server/src/modules/triage/eval.ts`,
    `eval.test.ts`, `eval-report.ts`, `eval-report.test.ts`; `apps/server/src/scripts/eval.ts`;
    `apps/server/src/modules/channels/commands.ts`, `apps/server/src/modules/channels/telegram/runtime.ts`, `apps/server/src/main.ts`;
    `apps/server/test/integration/channels-commands.test.ts`, `apps/server/test/integration/telegram-logs.test.ts`.
  - Interfaces:
    - `cost.ts`: `const OPENAI_PRICING_URL = "https://developers.openai.com/api/docs/pricing";` and the row
      `"gpt-6-luna": [{ inputPerM: 0.1, outputPerM: 0.5, source: OPENAI_PRICING_URL, checked: "2026-11-06" }]`.
      Change the comment to: paid prices per 1M tokens in USD; the Gemini pilot runs on the free tier; OpenAI has no free tier.
    - `runEval(deps, input)`: `input` gets `provider: LlmProviderId` and `reasoningEffort?: string | null` (default `null`).
      `CasesEvalReport` gets `provider: LlmProviderId; reasoningEffort: string | null`.
    - `eval-report.ts` header for `cases`: after `- model: …` add `- provider: <id>`, and `- reasoning effort: <value>` only when it is not `null`.
      The blocked line: `Blocked by the provider (llm_blocked): …` (the rest of the line stays).
    - `scripts/eval.ts` passes `provider: settings.provider, reasoningEffort: settings.reasoningEffort` to `runEval`.
    - `CommandDeps` gets `llm: { provider: string; classifierModel: string }`. `statusMessage` pushes `LLM: ${provider} · ${classifierModel}`
      right after the `Triage:` line. `createTelegramRuntime` deps get the same `llm` field and pass it to `createUpdateHandlers`.
      `main.ts` passes `{ provider: settings.provider, classifierModel: settings.classifierModel }`.
  - Decisions:
    - Q3: only the `gpt-6-luna` price; no `gpt-6.1-terra`, no `gpt-5-nano` rows.
    - The `/status` line shows the configured provider and model also when the scope is `off` (it shows the config, not activity).
    - The text `Triage: off\n` stays followed by a newline (a test checks it).
  - Test (first): `cost.test.ts`: `costPerMail("gpt-6-luna", 700, 90, new Date("2026-11-06T00:00:00Z"))` ≈ `0.000115`;
    `eval-report.test.ts`: the blocked line text, the provider line, the effort line present with `low` and absent with `null`;
    `eval.test.ts`: the report keeps `provider` and `reasoningEffort` from the input; `channels-commands.test.ts`: the `depsAt` helper sets
    `llm: { provider: "gemini", classifierModel: "gemini-3.5-flash-lite" }` and the status text holds `LLM: gemini · gemini-3.5-flash-lite`;
    `telegram-logs.test.ts`: add the `llm` field.
  - Check: `bun run typecheck`, `bun run lint`, `bun run test:unit`, `bun run db:up && bun run test:int`.
  - Done when: all checks pass.
  - Out of scope: no eval flags (stage 5); no change of `triage:cost` other than what the price row gives.

### Stage 5 — Eval for more than one provider

- [ ] **5.1 `bun run eval --provider <id> [--model] [--reasoning-effort]`**
  - Plan text: `bun run eval --provider <id> [--model] [--reasoning-effort]`. Defaults from `llmSettings`. State file name per D9. README in `evals/` updated
    (the "Quota" part is Gemini only; OpenAI has no free daily quota).
  - Goal: one command runs the 92 cases on any provider, model and effort, and resumes per run.
  - Files: `apps/server/src/scripts/eval.ts`, `apps/server/src/modules/triage/eval.ts`, `eval.test.ts`, `apps/server/src/modules/triage/index.ts`
    (export the new function), `evals/README.md`.
  - Interfaces:
    - `export function evalStateFileName(opts: { model: string; reasoningEffort: string | null; promptVersion: string; set: string; perCategory?: number }): string`
      in `modules/triage/eval.ts`:
      `` `${model.replace(/[^\w.-]/g, "_")}${effort === null ? "" : `-${effort}`}-${promptVersion}-${set}${perCategory === undefined ? "" : `-pc${perCategory}`}.jsonl` ``.
      The script joins it with `runsDir`; `--state` still wins.
    - New options: `provider: z.enum(llmProviderIds).optional()`, `"reasoning-effort": z.enum(openAiReasoningEfforts).optional()`
      (import both from platform). Add both to `parseArgs` and to `casesOnly`.
      `const settings = llmSettings(config, options.provider ?? config.LLM_PROVIDER)`; `model = options.model ?? settings.classifierModel`;
      `effort = options["reasoning-effort"] ?? settings.reasoningEffort`. `--reasoning-effort` with a provider whose `settings.reasoningEffort` is `null`
      → print the usage and exit 1. The client and `runEval` get `provider`, `model`, `effort`.
    - One start line: `log.info(`provider=${settings.provider} model=${model} effort=${effort ?? "-"}`)`.
    - Usage text: add `[--provider gemini|openai] [--reasoning-effort <value>]` to the case-run line.
  - Decisions:
    - D9: the state file names of Gemini do not change (open stage 36 runs can resume). For OpenAI the name adds the effort.
    - The defaults come from `llmSettings`, so `bun run eval` with no flags behaves as now under `LLM_PROVIDER` unset.
    - `evals/README.md`: describe `--provider` and `--reasoning-effort` in "Flags"; the default of `--model` is the classifier model of the provider;
      the state file name gets `[-<effort>]`. Rename "### Quota" to "### Quota (Gemini)" and add one line under it:
      OpenAI has no free daily quota; the project budget and the rate limit apply; a 92-case run with `gpt-6-luna` costs about $0.01.
  - Test (first): `eval.test.ts`: `evalStateFileName` gives `gemini-3.5-flash-lite-classifier-v1-all.jsonl` for Gemini (same as now; use the real
    `PROMPT_VERSION`), `gpt-6-luna-none-classifier-v1-all.jsonl` for OpenAI, the `-pc3` suffix, and `_` for unsafe characters in the model id.
  - Check: `bun run typecheck`, `bun run lint`, `bun run test:unit`; `bun run eval --provider gemini --reasoning-effort none` → usage, exit 1;
    `bun run eval --set injection --limit 1 --provider openai --model gpt-6-luna` → one case, a report, the state file `evals/.runs/gpt-6-luna-none-classifier-v1-injection.jsonl` (one live call).
  - Done when: the checks pass and the state file name is as above.
  - Out of scope: no `--real` change (step 5.2); no full eval run (stage 6).

- [ ] **5.2 `eval --real --model <id>`: filter and count per model**
  - Plan text: `eval --real --model <id>`: filter by model; the report shows the count of rows per model. Integration test with two models.
  - Goal: after a switch, the real-label report can show one model only and always shows how many rows each model has.
  - Files: `apps/server/src/scripts/eval.ts`, `apps/server/src/modules/triage/eval-real.ts`, `apps/server/src/modules/triage/eval.ts`
    (type `RealEvalReport`), `eval-report.ts`, `eval-report.test.ts`, `apps/server/test/integration/triage-eval-real.test.ts`.
  - Interfaces:
    - `buildRealReport(rows, opts: { bar; minKept; mail; now; model?: string })`.
    - `RealEvalReport` gets `modelFilter: string | null` and `modelCounts: Record<string, number>`.
      `modelCounts` counts all rows before the filter; the key is `row.model ?? "none"`.
      With `model` set, the report uses only the rows with `row.model === model`; `labeled` is the count after the filter.
    - Header for `real`: `- model filter: <id>` (only when set), and `- rows per model: <id> <n>, <id> <n>, none <n>` (ids sorted, `none` last).
    - `scripts/eval.ts`: remove `"model"` from `casesOnly` (it is valid for both runs); pass `model: options.model` to `buildRealReport`;
      title `Eval report: ${mail} labels${options.model === undefined ? "" : `, model ${options.model}`}`.
  - Decisions:
    - Rows without a model (rule results, triage errors, blocked calls) belong to no model. Under `--model` they drop out, and their count shows as
      `none` in "rows per model" (question 4 below; detail per the recommendation).
    - Without `--model` the report is the same as now, plus the "rows per model" line.
    - No LLM call, no API key (as now).
  - Test (first): `triage-eval-real.test.ts`: one mailbox with labeled results of two models (for example `gemini-3.5-flash-lite` and `gpt-6-luna`)
    and one rule row: no filter → all rows, counts for both models and `none`; `model: "gpt-6-luna"` → only its rows, the same counts.
    Use the helpers and fixtures that the file already has. `eval-report.test.ts`: the two header lines.
  - Check: `bun run typecheck`, `bun run lint`, `bun run test:unit`, `bun run db:up && bun run test:int`.
  - Done when: all checks pass.
  - Out of scope: no reclassify (stage 9); no DB schema change.

### Stage 6 — Eval runs on OpenAI (Mac, synthetic cases only) [risky: LLM evals]

- [ ] **6.1 Two full eval runs of `gpt-6-luna`**
  - Plan text: `bun run eval --set all --provider openai --model gpt-6-luna --reasoning-effort none --out evals/results/<date>-gpt-6-luna-none.md`,
    then the same with `low` (Q3: no other OpenAI model).
  - Goal: the results of `gpt-6-luna` with `none` and `low` on all 92 cases are in `evals/results/`.
  - Files: `evals/results/<date>-gpt-6-luna-none.md`, `evals/results/<date>-gpt-6-luna-low.md` (date = the run day, UTC).
  - Decisions:
    - Q3: only `gpt-6-luna`. Q4: `none` and `low`; the results decide.
    - Synthetic and injection cases only (`evals/cases/`), no real mail.
    - Exit codes: 0 = pass, 1 = a check failed (still a valid result: keep the file), 2 = not complete (run the same command again; the state file resumes).
    - Cost: about $0.01 per run (estimate in "Facts checked").
  - Steps:
    1. `bun run llm:check --provider openai` → exit 0.
    2. `bun run eval --set all --provider openai --model gpt-6-luna --reasoning-effort none --out evals/results/<date>-gpt-6-luna-none.md`
    3. `bun run eval --set all --provider openai --model gpt-6-luna --reasoning-effort low --out evals/results/<date>-gpt-6-luna-low.md`
  - Test: none (an eval run).
  - Check: `grep -c '' evals/results/<date>-gpt-6-luna-*.md` (files exist); each report header shows `92 of 92 cases done`, `provider: openai`
    and its effort. `git status --short` shows no file under `evals/.runs/`.
  - Done when: both reports are complete (92 of 92) and in `evals/results/`.
  - Out of scope: no prompt change; no other model; no change of the code default.

- [ ] **6.2 Comparison, the user pick, the code default**
  - Plan text: A comparison table with `gemini-3.5-flash-lite` (stage 34): precision, recall, go/no-go, injection, whitelist, errors, p50/p95, cost per mail.
    Apply the ADR 0012 rule. **The user picks the default provider and model.** Then set the code default and `.env.example` (D8).
  - Goal: the user picks the default from facts; the code default follows the pick.
  - Files: this task file (new section `## Eval results (stage 6)`); after the pick, if it changes the default:
    `apps/server/src/platform/config.ts`, `config.test.ts`, `.env.example`.
  - Decisions:
    - Source for Gemini: `evals/results/2026-11-05-gemini-3.5-flash-lite.md` (stage 34, same 92 cases, same prompt `classifier-v1`).
    - Table: one column per run (Gemini, luna `none`, luna `low`); rows: precision and recall per category, go/no-go per category
      (precision ≥ 98% with the minimum support), injection passed/total, whitelist passed/total, error count and codes, latency p50/p95,
      average tokens in/out, cost per mail, cost per month at 200 mails per day.
    - ADR 0012 rule: use the cheapest model that passes. Write which runs pass and which is the cheapest of them.
      If no run passes every category, write it plainly and give the per-category picture (the Gemini run has no category at the bar either; architecture §6.3).
    - The main session asks the user to pick provider, model and effort. The implementer never picks.
    - D8 after the pick: if the pick is OpenAI, set `LLM_PROVIDER` default to `"openai"`, `OPENAI_MODEL_CLASSIFIER` and
      `OPENAI_REASONING_EFFORT` defaults to the pick, `.env.example` `LLM_PROVIDER=openai` and the comment "Empty = openai"; update the default tests.
      If the pick is Gemini, change no code; write the pick in the log.
  - Test: if the default changes, the config default tests change first (unset `LLM_PROVIDER` → the pick).
  - Check: `bun run typecheck`, `bun run lint`, `bun run test:unit` (only when code changes).
  - Done when: the table is in the task file, the user pick is in the log with the user words, and the code default matches the pick.
  - Out of scope: no VPS change; no doc change other than `.env.example` (stage 7).

### Stage 7 — Docs and ADR

- [ ] **7.1 ADR 0014 and the docs**
  - Plan text: ADR 0014 "LLM providers: Gemini and OpenAI behind one switch". Status lines of ADR 0007, 0012, 0013 say "amended by 0014".
    Data rules per provider (Q6). Architecture §6.3 and §9, the diagram line; `docs/modules.md`; `docs/code-patterns.md`; roadmap §5 and the
    external services row; `README.md`; product brief privacy row (only with the user answer Q6).
  - Goal: the docs describe what was built and the data terms of each provider.
  - Needs: the user answer to Q6 (question 1 below) before the data rules, the privacy row and §7. Without it, write the rest and leave those parts.
  - Files and content:
    - create `docs/decisions/0014-llm-provider-switch.md` (template of `docs/decisions/README.md`). Status: accepted (user, <date of the stage 6 pick>).
      Amends: 0007, 0012, 0013. Context: Gemini 503s and slow eval runs (`notes/2026-11-05-gemini-free-tier-triage.md`), the user request of 2026-11-06.
      Decision: D1–D10 in short form; the registry and the adapter files; the ESLint rule; the strict schema and `store: false`; the error codes
      (`http_429_quota`, `http_400_schema`, `schema_not_strict`); the stage 6 table summary and the user pick; the data rules per provider from Q6.
      Consequences: a new provider = one adapter file, one registry row, one config block, price rows, one eval run; results change model after a switch
      (`eval --real --model`); no automatic fallback (follow-up file).
    - `docs/decisions/0007-llm-gemini.md`, `0012-llm-data-and-cost.md`, `0013-pilot-mailbox-free-tier.md`: append to the status line
      `; amended by 0014 (second provider OpenAI behind LLM_PROVIDER, <date>)`. Change nothing else in them.
    - `docs/decisions/README.md`: add the 0014 row; the status cells of 0007, 0012, 0013 add "and 0014" / "amended by 0014".
    - `docs/architecture.md`: §6.3 (edit it last in this step; first `git fetch` and `git log HEAD..origin/master -- docs/architecture.md`;
      keep the S1b stage 36/40 lines) — providers in `platform/llm/providers/`, the `LLM_PROVIDER` and `OPENAI_*` keys, the classifier model of each
      provider and the default pick; the diagram node on line ~34 (`Google Gemini API<br/>Vertex AI EU before customers`) names both providers;
      §7 data table row (only with Q6); the outbound list (line ~518) says "the LLM API"; §9 adds `bun run llm:check --provider <id>` and the eval per provider;
      the history table rows (lines ~550–551): `platform/llm/` and `scripts/llm-check.ts`.
    - `docs/modules.md` (`llm` row, line ~130): `@google/genai` (Gemini), `openai` (OpenAI), Zod; the provider registry.
    - `docs/code-patterns.md`: in "Real platform paths" add `platform/llm/`; replace "Only `platform/llm.ts` imports `@google/genai`" with
      "Only `platform/llm/providers/gemini.ts` imports `@google/genai`; only `platform/llm/providers/openai.ts` imports `openai` (ESLint enforces it)".
    - `docs/roadmap.md` §5 (title and text name both providers and ADR 0014) and the external services row (find it with `grep -n -i "external" docs/roadmap.md`).
    - `README.md`: "AI: Gemini." → "AI: Gemini or OpenAI (`LLM_PROVIDER`)."; the scripts table gets `bun run llm:check --provider <id>`; `gemini:test` stays as an alias.
    - `docs/product-brief.md`: the privacy row (line ~33) and the rows Q8 and Q11 — only with the Q6 answer, in the user's terms.
  - Decisions: the docs hold the state after stage 6; no plan steps or status in `docs/` (`tasks/README.md` table).
  - Test: none (docs).
  - Check: `grep -rn 'platform/llm\.ts' docs README.md` → only history lines that say "replaced"; `grep -c '0014' docs/decisions/0007-llm-gemini.md docs/decisions/0012-llm-data-and-cost.md docs/decisions/0013-pilot-mailbox-free-tier.md docs/decisions/README.md` → 1 or more in each;
    `bun run lint` (Prettier on Markdown runs only in lint-staged: run `bunx prettier --check <changed .md files>`).
  - Done when: the checks pass and the Q6 parts are written or listed as waiting in the task log.
  - Out of scope: no code change; no edit of the S1b lines in §6.3 except the provider names.

- [ ] **7.2 Known alerts and follow-up tasks**
  - Plan text: `docs/known-alerts.md`: the new config-error text, `http_429_quota`, `http_400_schema`. Planned tasks: an OpenAI budget alert next to
    `gemini-billing-budget-alert.md`; `s6-pre-sale.md` names the EU option of Q6b; follow-up file for the automatic fallback (D10).
  - Goal: a later agent finds each new alert text with its cause and fix; the follow-up work has files.
  - Files: `docs/known-alerts.md`; create `tasks/planned/openai-budget-alert.md`, `tasks/planned/llm-provider-fallback.md`; change `tasks/planned/s6-pre-sale.md`.
  - Decisions:
    - `known-alerts.md` keeps its format (alert text, source, cause, fix, status). The Gemini entry (line ~45) stays. Add:
      1. `LLM config error <code>: check OPENAI_API_KEY, OPENAI_MODEL_CLASSIFIER and the OpenAI project (billing, budget, model access); triage paused for <n> min, until <time>`
         — cause and fix per code (`http_401` bad key, `http_403` no access or region, `http_404` unknown model).
      2. code `http_429_quota`: no money on the OpenAI account or the project budget is spent; retry does not help; fix: add credit or raise the budget,
         then wait for the pause to end or restart the server.
      3. code `http_400_schema`: OpenAI rejects the strict schema; every mail would fail; fix: run `bun run llm:check --provider openai`, check the
         strict schema adapter and the rejected keywords (stage 0 note).
      4. code `schema_not_strict`: our own check found a schema object that breaks the strict rules (a code change); fix: make every property
         required and nullable, `additionalProperties: false`.
    - `openai-budget-alert.md`: template of `tasks/README.md`; goal: a budget alert for the OpenAI project and a check in `/status` or the digest when
      `http_429_quota` happens; read `tasks/planned/gemini-billing-budget-alert.md` for the shape.
    - `llm-provider-fallback.md` (D10): goal: on soft errors of one provider, use the other; open points: pause per provider, daily cap per provider,
      mixed models in `triage_results`, the eval of both.
    - `s6-pre-sale.md`: add one line under its LLM part with the Q6b answer (Vertex AI EU only, or also an OpenAI EU project with zero data retention,
      which needs OpenAI approval). Without the Q6b answer, add the option as an open question.
  - Test: none (docs).
  - Check: `grep -n 'http_429_quota\|http_400_schema\|schema_not_strict' docs/known-alerts.md` → 3 or more hits; `ls tasks/planned/openai-budget-alert.md tasks/planned/llm-provider-fallback.md`.
  - Done when: the checks pass.
  - Out of scope: no code change.

### Stage 8 — VPS switch (time per Q5) [risky: real mail to a new processor]

> Blocked until: S1b stage 40 is done (Q5), the user answered Q6a with yes, and no S2 stage 23 session runs. Check these before 8.1.

- [ ] **8.1 Deploy with the provider unchanged**
  - Plan text: Deploy with `LLM_PROVIDER` unset. Check the start log: `llm provider=gemini`. Nothing else changes.
  - Goal: the new code runs on the VPS with Gemini, the same as before.
  - Files: none in git. VPS: `~/email_assistant` (SSH alias `home_vm`, `notes/2026-11-03-pilot-vps.md`, runbook `deploy/README.md` § "Update").
  - Decisions:
    - If stage 6 changed the code default to `openai`, the user first adds `LLM_PROVIDER=gemini` to the VPS `.env` (else the server needs
      `OPENAI_API_KEY` with `TRIAGE_LLM_SCOPE=all` and refuses to start). Check without secrets: `grep -n '^LLM_PROVIDER' .env`.
    - A deploy restarts the server; the S1b shadow run must be over (stage 40) or the user agrees to the restart.
  - Steps (on the VPS, `C="docker compose -f deploy/compose.yaml --env-file .env"`):
    1. `git pull` (master = origin/master).
    2. `$C up -d --wait db`, then `$C run --build --rm server bun run db:migrate` (the runbook step; this task has no migration, so it applies nothing).
    3. `$C up -d --build --wait`.
    4. `$C logs --since 5m server | grep -E 'llm provider|triage|config error'`.
  - Check: the log shows `llm provider=gemini classifier=gemini-3.5-flash-lite` and no `config error`; `/status` in Telegram shows `LLM: gemini · gemini-3.5-flash-lite`.
  - Done when: both checks are true; the log line goes into the task log.
  - Out of scope: no `.env` edit by the agent; no OpenAI call on the VPS.

- [ ] **8.2 (user) Switch the VPS to OpenAI, check after 24 h**
  - Plan text: (user) Add `OPENAI_API_KEY` and `LLM_PROVIDER=openai` to the VPS `.env`. Check without secrets: `grep -c '^OPENAI_API_KEY=.' .env`,
    `grep -n '^LLM_PROVIDER' .env`. Restart. `llm:check` on the VPS. After 24 h: `llm.call` rows per code, `triage:cost --days 1`.
    Rollback: `LLM_PROVIDER=gemini`, restart.
  - Goal: the pilot mail goes through OpenAI, and the first day shows no new error pattern.
  - Decisions:
    - Q6a must be yes before this step: real mail goes to a new processor.
    - The user edits the `.env` (the agent never sees the key). The VPS key is a separate project key or the same project key, per Q7.
    - Rollback: set `LLM_PROVIDER=gemini` in the VPS `.env`, then `$C up -d server`.
  - Steps:
    1. User: edit `.env`. Agent: `grep -c '^OPENAI_API_KEY=.' .env` → `1`; `grep -n '^LLM_PROVIDER' .env` → `LLM_PROVIDER=openai`.
    2. `$C up -d server`; `$C logs --since 5m server | grep -E 'llm provider|config error'` → `llm provider=openai classifier=<pick>`.
    3. `$C run --rm -T server bun run llm:check --provider openai` → exit 0 (the runbook runs `db:migrate` the same way, so the image has the scripts).
    4. After 24 h: `$C exec -T db psql -U postgres -d email_assistant -c "select reason_code, count(*) from audit_log where event = 'llm.call' and created_at > now() - interval '24 hours' group by 1 order by 2 desc"`
       and `$C run --rm -T server bun run triage:cost --days 1`. Write the counts and the cost in the task log (numbers only).
  - Check: the four steps give the expected output; no `http_429_quota`, `http_400_schema` or `schema_not_strict` rows.
  - Done when: the 24 h numbers are in the log and the user says the switch stays (or the rollback is done and logged).
  - Out of scope: no stage 9 work; no Gemini key removal.

### Stage 9 — Optional: real-mail comparison (only with Q8 yes) [risky: real mail]

- [ ] 9.1 `bun run eval --real --reclassify --model <id>`: classifies the labeled real mails again, writes nothing to the DB, prints to stdout only.

## Questions for the user

Added by the planner on 2026-11-06. Questions 1 and 2 are the open Q6 and Q7. Questions 3–5 came up in the step detail.

1. **Q6 Data terms** (needed before step 7.1 writes the data rules and the privacy rows, and before stage 8).
   (a) Pilot: do you accept the OpenAI paid API terms for your own mail (no training, abuse logs up to 30 days, no EU location, `store: false`)?
   Options: yes / no. Recommendation: yes for the pilot, the same kind of choice as ADR 0012 for Gemini. If no, stage 8 does not run.
   (b) Customers (S6): keep "Vertex AI EU" as the only path, or also allow "OpenAI EU project with zero data retention" (needs OpenAI approval)?
   Options: Vertex only / both. Recommendation: both as options in `s6-pre-sale.md`, with the pick at S6 (the approval takes time and can fail).
2. **Q7 OpenAI budget** (step 0.1). Which monthly budget for the project? Recommendation: $10 per month with an e-mail alert at 80%.
   The eval runs cost about $0.01 each; the pilot with `gpt-6-luna` costs below $1 per month.
3. **Default of `OPENAI_MODEL` (S4 writer role).** No code uses it before S4. Options: (a) `gpt-6.1-terra` (the stronger model, like
   `gemini-3.8-flash` for Gemini); (b) `gpt-6-luna`; (c) no default, S4 sets it. Recommendation: (a); S4 runs its own eval before use.
   Step 2.1 uses (a) unless you answer otherwise.
4. **`eval --real --model <id>` and rows without a model.** Rule results, triage errors and blocked calls store no model id. Options:
   (a) drop them under `--model` and show their count as `none` in "rows per model"; (b) keep them in every filtered report.
   Recommendation: (a): a filtered report then shows only that model's answers; the count keeps the dropped rows visible. Step 5.2 uses (a).
5. **Size of stage 3.** Stage 3 is one `[risky]` step of about 450 changed lines (adapter about 170, tests about 250, config about 30), above the
   300-line guide. Proposed split: stage 3 = part A (strict schema, request shape, result normalization; pure functions and their tests);
   a new stage 3b = part B (error map, `createOpenAiGenerate`, registry row, config block). Options: split / keep one stage.
   Recommendation: split; each part gets its own review. Step 3.1 already lists parts A and B in build order, so the split needs no new detail.

## Not verified

- OpenAI SDK 7.53.0 class names: `APIError` (with `status`, `code`, `type`, `param`), `APIConnectionError`, `APIConnectionTimeoutError`,
  `APIUserAbortError`, and a way to build them in tests (`APIError.generate`). Stage 0 cases C–I record the real names.
- Response fields: `output_text`, `output[].content[].type === "refusal"`, `status: "incomplete"` with `incomplete_details.reason`
  (`content_filter`, `max_output_tokens`), `usage.input_tokens`, `usage.output_tokens`, `usage.output_tokens_details.reasoning_tokens`. Stage 0 cases A, B, G, J.
- The 400 `code`/`param` of a rejected strict schema (stage 0 case E) and the list of rejected keywords (`maxLength`, maybe others; case A).
- The accepted `reasoning.effort` values of `gpt-6-luna` (placeholder `none`, `low`, `medium`, `high`, `max`; case F).
- `429` with `code: "insufficient_quota"` for no money or a spent budget (from the docs; a call cannot make it).
- Bun keeps an env value that the shell sets when `.env` has the same key (used in the step 2.2 start check).
- `toMatchSnapshot()` in `bun test` writes `__snapshots__/<file>.snap` next to the test (step 3.1).
- The SDK `GenerateContentResponse` type of `@google/genai` fits the structural `GeminiResponse` type (step 1.1 has a fallback).

## Out of scope

- Automatic fallback between providers (D10). A provider per mailbox or per organization. Vertex AI (stays in S6).
- A change of the prompt `classifier-v1` (a prompt change needs a new version and an eval).
- The S4 `write` call (the writer role gets its model key now, its code comes in S4).

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); ADR 0014 accepted; 0007, 0012, 0013 amended.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-06: Stage 3 (part A of step 3.1) done, reviewer PASS: `providers/openai.ts` with `toStrictJsonSchema`, `toResponseParams`, `toOpenAiResult` + 17 tests + snapshot; `ConfigCode` + `schema_not_strict`. Step 3.1 box stays open until stage 3b. Checks: typecheck, lint, test:unit 579 pass. Reviewer minors for 3b: `strictNode` shares non-walked arrays by reference (use `structuredClone`); add a test for a loose object inside `anyOf`/`items`; effort cast is safe because config limits `OPENAI_REASONING_EFFORT`.
- 2026-11-06: Stage 2 done, reviewer PASS. `LLM_PROVIDER` (default gemini), `OPENAI_*` keys (`OPENAI_MODEL` default `gpt-6.1-terra`), `llmSettings()`, key check per provider, start log `llm provider=<id> classifier=<model>`, `configHint` in the pause. Checks: typecheck, lint, test:unit 562 pass, test:int 348 pass; local start log shows `llm provider=gemini classifier=gemini-3.5-flash-lite`, key grep count 0 (that start also sent one pending synthetic mail to Gemini).
- 2026-11-06: Stage 1 done, reviewer PASS. `platform/llm.ts` → `platform/llm/{index,client,errors}.ts` + `providers/{index,gemini}.ts`; tests: `llm.test.ts` → `client.test.ts` (classify output, classify errors, rate limit and model, logs) and `providers/gemini.test.ts` (toGenerateParams, 401–404/400/418 config, timeout/abort names, network codes, toGeminiResult). 28 old test lines → 37 new. ESLint: one block per file group. Checks: typecheck, lint, test:unit 555 pass, test:int 348 pass. Live `gemini:test` NOT verified: 4 attempts gave `http_429`/`http_503`/`timeout` (Gemini side; the soft-error path works). Re-run it in stage 4 (`llm:check`).
- 2026-11-06: Stage 0 done, reviewer PASS. Budget: $3 per month (user; lower than the $10 proposal; the plan needs under $0.10). Spike facts in `notes/2026-11-06-openai-api-facts.md`: D6 removes only the root `$schema` (`maxLength`, `pattern`, `anyOf` null accepted); strict schema 400 = `invalid_json_schema`, param `text.format.schema`; no credit = 429 `credit_balance_exhausted`, type `insufficient_quota` (seen live); effort values `none, minimal, low, medium, high, xhigh, max`; `AbortSignal.timeout` gives `APIUserAbortError`, request `timeout` gives `APIConnectionTimeoutError`; `incomplete` still carries `output_text`; no refusal seen; usage `output_tokens_details.reasoning_tokens`.
- 2026-11-06: User approved the plan with all recommendations: Q6a yes, Q6b both options in `s6-pre-sale.md`, Q7 $10 per month with alert at 80%, `OPENAI_MODEL` default `gpt-6.1-terra`, `eval --real --model` drops rows without a model and shows their count as `none`, stage 3 split into 3 and 3b.
- 2026-11-06: Planner added the step detail for stages 0–8 (stage 9 stays optional). Five questions under "Questions for the user" (Q6, Q7, `OPENAI_MODEL` default, `eval --real --model` rows, stage 3 size).
- 2026-11-06: The user put `OPENAI_API_KEY` in the Mac `.env` (count check → 1).
- 2026-11-06: User answers: proposed values accepted, only `gpt-6-luna` (Q3). Q6 and Q7 open. Repo state checked (section "Coordination").
- 2026-11-06: Plan draft (main session). Code map from a grep of `apps/`, `packages/`, `evals/`, `docs/`. OpenAI facts from the official docs (sources above). Waits for the user answers Q1–Q8.
