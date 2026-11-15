# F111 stage 04 — Chat-completions path for an own server (only if stage 01 failed)

Part of [`../plan.md`](../plan.md). Build this stage only when `notes/2026-11-15-ollama-responses-path.md` says "Stage 04: build". When it says "Stage 04: skip", the coordinator marks this stage skipped in `plan.md` § Log and spawns stage 05.

## Step 1 — API style setting

**Goal.** An own server that rejects the Responses request gets the same strict schema through `/v1/chat/completions` (D9).

**Files.** `apps/server/src/platform/config.ts`, `platform/llm/providers/openai.ts`, `.env.example`, `docs/capabilities/triage.md`.

**Interfaces.**
- Config key `OPENAI_API_STYLE`: `responses` (default) or `chat`. The start fails when `chat` is set and the endpoint kind is not `own` (OpenAI's own endpoints stay on the tested Responses path).
- `LlmProviderSettings.apiStyle: "responses" | "chat"`; it reaches `createGenerate` like `baseUrl`.
- `toChatParams(req, endpoint)`: `messages` = system then user; `response_format: { type: "json_schema", json_schema: { name: "result", strict: true, schema: toStrictJsonSchema(...) } }`; no `reasoning_effort` for `own`; `store` not sent.
- `toChatResult(response)`: text from `choices[0].message.content`; `refusal` set → `blocked: true`; `finish_reason` `content_filter` → `blocked: true`; `length` → text `undefined`, not blocked; tokens from `usage.prompt_tokens` and `usage.completion_tokens` (missing → 0).

**Decisions.** D4, D9. Errors: the same `classifyOpenAiError` (the SDK error classes are the same).

**Test** (`openai.test.ts`, fake server on port 0):
1. `OPENAI_API_STYLE=chat` with `https://eu.api.openai.com/v1` → start error naming `OPENAI_API_STYLE`.
2. `chat` + `http://127.0.0.1:11434/v1` → the call goes to `/v1/chat/completions` with `response_format.json_schema.strict` `true`.
3. `toChatResult` of `{ choices: [{ message: { content: "{\"a\":1}" }, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 3 } }` → `{ text: "{\"a\":1}", tokensIn: 7, tokensOut: 3, blocked: false }`.
4. `refusal: "no"` → `blocked: true`; `finish_reason: "length"` → `text: undefined`, `blocked: false`.
5. A 404 from the fake → `LlmConfigError` `http_404`.

**Done when.** Cases 1–5 pass.

## Step 2 — Re-run the stage 01 probe on the chat path

**Goal.** Prove the new path on the real Ollama, as in stage 01 (same server setup, same model, same rules for the PID).

**Test.** S1 through the adapter with `chat`: 3 of 3 parse with the Zod schema, token counts present. Append the result to the stage 01 note.

**Done when.** The note says "chat path: pass" with the counts.

## Proof

The Proof of `plan.md` with `NN` = `04`.
