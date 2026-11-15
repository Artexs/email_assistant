# Stage 04: skip

# Ollama Responses path with the OpenAI adapter request (F111 stage 01 spike)

Run: 2026-11-15, own `ollama serve` (PID 3328669, port 11500, `OLLAMA_CONTEXT_LENGTH=8192`, CPU only), then stopped by that PID (`ps -p` shows nothing). Server and client version: Ollama 0.40.7. Model: `gemma3:1b` (806 MB; no thinking mode; review N6). No real OpenAI call, no key.

Request: the real `toResponseParams` output of the adapter (`apps/server/src/platform/llm/providers/openai.ts`), sent with the real `openai` SDK client (`baseURL: http://127.0.0.1:11500/v1`, `apiKey: "ollama"`, `maxRetries: 0`). Prompt: `prompts.classifier` (`classifier-v2`) system and user text; schema: `z.toJSONSchema(buildTriageAnalysisSchema(classifierCategories, ["d1"]))`; one synthetic mail (budget approval request). Config default of `OPENAI_REASONING_EFFORT` is `none`, so S1 is also what production sends today. The probe script was in `.tmp-f111-s01/` and is deleted.

## Result table

| Case | Request | HTTP | `classifyOpenAiError` | Zod parse | tokens in / out | wall |
|---|---|---|---|---|---|---|
| S1 try 1 | current params (`reasoning: {effort:"none"}`) | 200 | none | yes | 868 / 174 | 8.9 s (first load) |
| S1 try 2 | same | 200 | none | yes | 868 / 162 | 4.4 s |
| S1 try 3 | same | 200 | none | yes | 868 / 174 | 7.0 s |
| S1 try 4 (extra) | same | 200 | none | yes | 868 / 171 | 6.0 s |
| S2 try 1 | no `reasoning` field | 200 | none | yes | 868 / 163 | 4.7 s |
| S2 try 2 | same | 200 | none | yes | 868 / 155 | 4.0 s |
| S2 try 3 | same | 200 | none | yes | 868 / 175 | 4.3 s |
| S3 | `reasoning: {effort:"none"}` kept | 200 | none | yes | 868 / 179 | 4.5 s |
| S4 | model `no-such-model` | 404 (`not_found_error`) | `LlmConfigError` `http_404` | n/a | n/a | 7 ms |
| S5 | server stopped | none (`APIConnectionError`) | `LlmSoftError` `network` | n/a | n/a | 5 ms |

Pass counts: S1 3 of 3 (4 of 4 with the extra try), S2 3 of 3. Token counts are present and non-zero in every 200 answer.

## Fields

- `strict: true`: accepted. The answer echoes `text.format.strict: true`. Output always matched the schema. A separate check with a two-value enum answered inside the enum, with `strict: true` and with `strict: false`; so this test cannot tell if the server treats the flag differently. Output follows the schema either way.
- `instructions`: accepted and applied. A 14-token prompt became 300 input tokens when `instructions` was added (separate check).
- `store: false`: accepted, echoed as `store: false`.
- `reasoning`: with the field the answer echoes `{effort:"none"}`; without it, `null`. No error in either case.
- S3 does not fail where S2 passes: D4 (drop the `reasoning` field for own endpoints) is safe on Ollama 0.40.7 with this model, but not needed here. Caveat: `gemma3:1b` has no thinking mode; a thinking model may differ (not tested; review N6).
- S1 `usage.input_tokens` is 868 against context length 8192 (about 11%). Output is 155 to 179 tokens. Stage 05 must still check its longest holdout case (mail body up to 8000 characters is about 2000 tokens plus the system prompt).

## Gaps for stage 02

- None. S4 maps to a config error (`http_404`) and S5 to a soft error (`network`), as the decision rule expects.

## Decision (plan D9, path only)

S2 returned text that parses with the Zod schema, with token counts, 3 of 3 tries. The Responses path passes. Stage 04 is skipped (first line of this note).

Limit of this evidence: one 1B model, one short synthetic mail, English text only, CPU. The 1B model's category answers are not judged here (only parse and fields). Stage 05 runs the real models on the holdout.
