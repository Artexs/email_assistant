# OpenAI API facts (spike, step 0.2)

Date: 2026-11-06. SDK: `openai` 7.53.0. Model: `gpt-6-luna`. Call: Responses API, strict `json_schema`, `store: false`, `reasoning.effort: none`, `maxRetries: 0`.
Spike file: `evals/.runs/spike/openai-spike.ts` (not in git). No key, prompt or answer text is in this note.

**Status: complete (re-run with credits, 2026-11-06).** All cases A–J have real results.

## A — good call with the real triage schema: PASS
- The full schema (with `maxLength`, `pattern` `^\d{4}-\d{2}-\d{2}$`, `minimum`/`maximum`, `enum`, `anyOf` with `{ type: "null" }`) was accepted at the first try.
- Rejected keywords: **none**. `pattern` with `\d` is accepted. D6 needs to remove only `$schema`.
- `output_text` parses as JSON. Latency 2126 ms.

## B — response fields (from case A)
- `status` = `completed`. `output_text` present: yes. `output[]` items: one `message` with content type `output_text`. `incomplete_details` = null.
- `usage` field names: `input_tokens`, `output_tokens`, `total_tokens`, `input_tokens_details.cached_tokens`, `input_tokens_details.cache_write_tokens`, `output_tokens_details.reasoning_tokens`.
- Numbers: input 607, output 50, reasoning 0, total 657.

## C — bad key
- `AuthenticationError`, status 401, code `invalid_api_key`, type `invalid_request_error`, param null.

## D — unknown model `gpt-does-not-exist`
- `NotFoundError`, status 404, code `model_not_found`, type `invalid_request_error`, param null.

## E — bad schema (one property missing from `required`)
- `BadRequestError`, status 400, code `invalid_json_schema`, type `invalid_request_error`, param `text.format.schema`.
- The message names the rule (`required` must list every key in `properties`) and the missing key.
- Test for `http_400_schema`: status 400 and code `invalid_json_schema`.
- With credits, E still returns 400 in 76 ms, before any model run. Schema validation runs first; the passing case A confirms the earlier guess.

## F — bad effort `bogus`
- `BadRequestError`, status 400, code `invalid_value`, type `invalid_request_error`, param `reasoning.effort`.
- Accepted values: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.

## G — incomplete (`max_output_tokens: 16`)
- No error. `status` = `incomplete`, `incomplete_details.reason` = `max_output_tokens`.
- `output_text` is present (cut text, not valid JSON). `output[]`: one `message` / `output_text`. `usage.output_tokens` = 16, input 607.
- The adapter must check `status === "incomplete"` before it parses.

## H — timeout and abort
- Request option `timeout: 1`: `APIConnectionTimeoutError` (no status; cause is a DOMException, code 20).
- `signal: AbortSignal.timeout(1)`: `APIUserAbortError` (no status; cause is a DOMException, code 23).
  Note: a timeout signal gives `APIUserAbortError`, not the timeout class. The adapter must tell the two apart by its own timer or by `signal.aborted`/`signal.reason`.

## I — connection error (`baseURL` to a closed port)
- `APIConnectionError`, no status, `error.cause.code` = `ECONNREFUSED` (cause class `TypeError`).

## J — refusal: no refusal seen
- Prompt asked the model to refuse. With the strict schema the model still returned `status` `completed` and a normal `output_text` message. No `refusal` content item.
- Usage: input 586, output 57. The refusal item shape is not verified; keep the code path for `content.type === "refusal"` as defensive and unit-test it with a fake response.

## insufficient_quota (real shape, seen in the first run while the project had no credits)
- `RateLimitError`, status 429, code `credit_balance_exhausted`, type `insufficient_quota`.
- Use `type === "insufficient_quota"` (or this code) to map to a config error. Plain rate limit 429 stays soft.
