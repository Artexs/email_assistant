# s1b-shadow-triage — Stage 10

Part of [`../s1b-shadow-triage.md`](../s1b-shadow-triage.md). Read that file's "Input" and "Rules for every step" first.

## Stage 10 — LLM client [risky]

- [x] **10.1 `platform/llm.ts`: simple structured call, timeout, rate limiter, error classes with codes**
  - Goal: one wrapper for Gemini that returns Zod-checked data and turns each failure into a typed error with a machine code.
  - Files: create `apps/server/src/platform/llm.ts`, `apps/server/src/platform/llm.test.ts`.
  - Interfaces:
    - `interface LlmUsage { model: string; tokensIn: number; tokensOut: number; latencyMs: number }`.
    - `interface LlmClient { readonly classifierModel: string; classify<T>(req: { schema: z.ZodType<T>; system: string; prompt: string; model?: string }): Promise<{ data: T; usage: LlmUsage }> }`.
    - `interface GenerateRequest { model: string; system: string; prompt: string; jsonSchema: unknown; signal: AbortSignal }`.
    - `interface GenerateResult { text: string | undefined; promptTokens?: number; outputTokens?: number; thoughtsTokens?: number; blockReason?: string; finishReason?: string }`.
    - `type GenerateFn = (req: GenerateRequest) => Promise<GenerateResult>`.
    - `toGenerateParams(req: GenerateRequest): GenerateContentParameters` (type from `@google/genai`; exported for the test). It returns exactly `{ model: req.model, contents: req.prompt, config: { systemInstruction: req.system, responseMimeType: "application/json", responseJsonSchema: req.jsonSchema, abortSignal: req.signal } }`.
    - `createLlmClient(opts: { apiKey: string; classifierModel: string; timeoutMs: number; rpm: number; generate?: GenerateFn; now?: () => number; sleep?: (ms: number) => Promise<void> }): LlmClient`.
    - `createRateLimiter(opts: { rpm: number; now: () => number; sleep: (ms: number) => Promise<void> }): { acquire(): Promise<void> }`.
    - Error classes, each with `readonly code: string` and `readonly model: string`:
      - `class LlmSoftError extends SoftError`: codes `http_429`, `http_500`, `http_502`, `http_503`, `http_504`, `timeout`.
      - `class LlmConfigError extends HardError`: codes `http_401`, `http_402`, `http_403`, `http_404`, `http_400_key`, `http_400_precondition`.
      - `class LlmBlockedError extends HardError`: code `llm_blocked` (user answer Q28).
      - `class LlmHardError extends HardError`: code `http_<status>` for every other HTTP status (also a plain `http_400`), and `unknown`.
      - `class LlmOutputError extends HardError`: code `bad_output`.
    - `llmErrorCode(error: unknown): string` — the `code` of an LLM error class, else `"unknown"`.
    - `classifyLlmError(error: unknown, model: string): LlmSoftError | LlmConfigError | LlmHardError` (exported for the test): the mapping under "Decisions".
  - Decisions:
    - Only this file imports `@google/genai` (code-patterns). The default `generate` calls `ai.models.generateContent(toGenerateParams(req))`.
    - Simple calls (user 2026-11-04: "just make a call to the LLM and don't complicate it with additional parameters like temperature"): the request holds only the model, the system instruction, the prompt, the JSON response type and schema (structured output), and the abort signal. No `temperature` (review finding 2: Gemini 3.6 and later ignore it and will return 400 later; earlier Gemini 3 models keep the default). No `thinkingConfig`, no `thinkingLevel`, no `thinkingBudget` (review finding 1: `gemini-3.8-flash` rejects `MINIMAL` with a 400). No other generation setting. Each model uses its default thinking: `gemini-3.5-flash-lite` "minimal", `gemini-3.8-flash` "medium" (https://ai.google.dev/gemini-api/docs/thinking, read 2026-11-04). So the same case can get a different answer on two runs: eval results can change between runs. The report names the date and the model; compare two runs as numbers with some noise, not as exact values.
    - Map the response: `text` = `response.text`; `promptTokens` = `usageMetadata.promptTokenCount`; `outputTokens` = `usageMetadata.candidatesTokenCount`; `thoughtsTokens` = `usageMetadata.thoughtsTokenCount`; `blockReason` = `response.promptFeedback?.blockReason`; `finishReason` = `response.candidates?.[0]?.finishReason`. These names are in the installed SDK 2.32.0 (`node_modules/@google/genai/dist/genai.d.ts`: `GenerateContentResponse.promptFeedback`, `GenerateContentResponsePromptFeedback.blockReason` with enum `BlockedReason`, `Candidate.finishReason` with enum `FinishReason`; checked 2026-11-04).
    - Safety block (user answer Q28): check this before the JSON parse. `blockReason` has any value, or the text is empty or undefined and `finishReason` is one of `SAFETY`, `BLOCKLIST`, `PROHIBITED_CONTENT`, `SPII` → throw `LlmBlockedError` (`llm_blocked`). Every other empty answer (for example `finishReason` `MAX_TOKENS`, `RECITATION`, `OTHER`, `STOP`) → `LlmOutputError` (`bad_output`).
    - JSON schema from Zod: `z.toJSONSchema(schema)` (Zod 4) [not verified that Gemini accepts every keyword it makes; the eval run in stage 34 shows it]. The answer is parsed with `JSON.parse` and checked with `schema.safeParse` again (ADR 0007).
    - `classify` with no `model` uses `classifierModel`. `classifierModel` is also a readable property, so the worker can name the model in the `llm.call` row of a failed call.
    - Timeout: `AbortSignal.timeout(timeoutMs)` passed to the SDK, and a `Promise.race` guard with the same time (the SDK may not stop on the signal) → `LlmSoftError` code `timeout`.
    - Error mapping in `classifyLlmError` (review findings 3 and 16). Read the HTTP status from a numeric `status` property of the error object (`typeof (error as { status?: unknown }).status === "number"`), never with `instanceof ApiError` (a fake error in a test is a plain object; the SDK class can load twice). Rules in this order:
      1. The error `name` is `AbortError` or `TimeoutError` (from `AbortSignal.timeout`), or the `Promise.race` guard fired → `LlmSoftError` `timeout`.
      2. `status` 429, 500, 502, 503 or 504 → `LlmSoftError` `http_<status>`.
      3. `status` 401, 402, 403 or 404 → `LlmConfigError` `http_<status>` (a bad key, no payment, no access or an unknown model: retrying the mail does not help, main-session decision 2026-11-04).
      4. `status` 400: the SDK puts the JSON error body into `error.message` (`throwErrorIfNotOK` in `node_modules/@google/genai/dist/node/index.mjs`: `message = JSON.stringify(errorBody)`, checked 2026-11-04). Parse it with `JSON.parse` inside a `try` (a parse failure = no details). When an entry of `body.error.details` has `reason === "API_KEY_INVALID"` → `LlmConfigError` `http_400_key`. Else when `body.error.status === "FAILED_PRECONDITION"` → `LlmConfigError` `http_400_precondition` (for example: the free tier is not open in this region, or the call needs billing). Else → `LlmHardError` `http_400`. Read the body only in this code: never log it, never store it, never put any part of it into an error message.
      5. Any other numeric `status` → `LlmHardError` `http_<status>`.
      6. Every other error (also a network failure: the SDK does not document its class or fields [not verified]) → `LlmHardError` `unknown` (review finding 16; "Questions for the user" 1 asks about network errors).
      - Empty text without a block, bad JSON or a Zod failure → `LlmOutputError` `bad_output`.
      - Error messages: \`LLM error ${code} (${model})\` only. Never the prompt, the answer, the error body or the key (ADR 0012: soft errors do not count toward the 3 tries; the caller decides).
    - Rate limiter: call starts are at least `60000 / rpm` ms apart, in this process.
    - `tokensOut` = output tokens + thinking tokens (thinking is billed as output, ADR 0012). `latencyMs` = wall time of the call.
    - Logs (review finding 17): one `debug` line per successful call with model, latency and tokens; one `debug` line with model and code per error. No `warn` or `error` line in this file: the pause (step 21.1) writes the one `warn` (or `error`) line per pause. Never the prompt, the answer, the error body or the key.
    - The `write` role (drafts) comes in S4: do not build it.
  - Test (`llm.test.ts`, fake `generate`, fake clock; errors are plain objects or `Error`s with a numeric `status`, no SDK class):
    - `toGenerateParams`: `Object.keys(params.config).sort()` equals `["abortSignal", "responseJsonSchema", "responseMimeType", "systemInstruction"]` (no `temperature`, no `thinkingConfig`); `contents` = the prompt; `model` = the request model.
    - Good JSON → data + usage (`tokensOut` = `outputTokens` + `thoughtsTokens`); Zod failure → `LlmOutputError` `bad_output`; empty text with `finishReason` `STOP` → `bad_output`; empty text with `finishReason` `MAX_TOKENS` → `bad_output`.
    - `blockReason: "SAFETY"` and no text → `LlmBlockedError` `llm_blocked` (`instanceof HardError`, not `instanceof SoftError`); `finishReason: "PROHIBITED_CONTENT"` and no text → `llm_blocked`.
    - Status 429 and 503 → `LlmSoftError` (`instanceof SoftError`) `http_429`, `http_503`; 401, 402, 403, 404 → `LlmConfigError` (`instanceof HardError`) `http_401`, `http_402`, `http_403`, `http_404`; 400 with `message` = `JSON.stringify({ error: { code: 400, message: "MARKER-BODY", status: "INVALID_ARGUMENT", details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID" }] } })` → `LlmConfigError` `http_400_key`; 400 with `body.error.status` `FAILED_PRECONDITION` → `LlmConfigError` `http_400_precondition`; 400 with `INVALID_ARGUMENT` and no `details` → `LlmHardError` `http_400`; 400 whose `message` is not JSON → `LlmHardError` `http_400`; 418 → `LlmHardError` `http_418`.
    - An `Error` with `name` `TimeoutError` → `timeout`; with `name` `AbortError` → `timeout`; a `generate` that never ends with `timeoutMs: 50` → `LlmSoftError` `timeout` within 1 s; `new TypeError("fetch failed")` → `LlmHardError` `unknown`; `llmErrorCode(new Error("x"))` = `unknown`.
    - Two calls with `rpm: 60` wait 1000 ms between starts; no error message contains a marker from the prompt, the key or the 400 body (`MARKER-BODY`); `client.classifierModel` equals the option.
    - Logs: `setLogLevel("debug")` at the start of the log test and `setLogLevel("info")` in its `finally` (as `log.test.ts` does); spy on `console.log` and `console.error`; a 503 writes one `debug` line (through `console.log`) with the code, and no `console.error` line.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`
  - Done when: the tests pass. No live API call in tests.
  - Out of scope: the prompt text, the worker, the pause (stage 21), Vertex AI.
