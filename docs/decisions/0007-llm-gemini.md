# 0007 — LLM: Google Gemini through the official `@google/genai` SDK
- Status: accepted (user decision 2026-11-02); amended by 0012 (data rules per stage, cost and failure limits); amended by 0013 (pilot mailbox on the free tier, 2026-11-04)
- Date: 2026-11-02

## Context
Triage needs structured output (category, confidence, reason, fields). The usage is small: two calls
(`classify` → JSON, `write` → summary / draft text). Earlier options were the Vercel AI SDK and the OpenAI SDK.
The user chose Google Gemini, free tier for development.

## Decision
- Provider: Google Gemini API. SDK: `@google/genai` (installed in `backend/`, version 2.32.0 on 2026-11-02).
- Key in env `GEMINI_API_KEY` (from https://aistudio.google.com/apikey). Never committed, logged or hardcoded.
- Model ID in config `GEMINI_MODEL`, not in code. Development model: `gemini-3.8-flash`
  (newest Flash, "New Stable", checked on https://ai.google.dev/gemini-api/docs/models on 2026-11-02).
- One wrapper file `platform/llm.ts` with `classify(schema, prompt, email)` and `write(prompt, input)`.
  Nothing else imports the SDK. Structured output: JSON response with a JSON schema made from the Zod schema; the result is checked with Zod again.
- Two model roles in config (`classifier`, `writer`); both use `GEMINI_MODEL` until a reason appears to split them.
- No Langfuse at the start. `triage_results` stores model, prompt version, tokens and latency.
- S4 does not use the writer role: drafts are templates filled from the classifier output (`classifier-v2`: delegate id, task, due date, question). The model keys for the writer role stay for Phase 2 (style learning, free-text drafts).
- `evals/` holds labeled cases (synthetic or anonymized, never real mail in git).

## Data rules (from https://ai.google.dev/gemini-api/terms, given by the user)
- Free tier: OK for development. In the EU, UK and Switzerland Google does not use free-tier data to train its models.
  In other regions it does, so use only test data there.
- **Before real users or real emails go through the app, the user must turn on Cloud Billing (paid tier).**
  First point: slice S1 run on the user's real Gmail. Use test or synthetic mail until billing is on.

## Consequences
- One vendor SDK, no extra abstraction layer. A provider change touches only `platform/llm.ts`.
- Free-tier rate limits apply in development.
- Supersedes the earlier draft of this ADR (Vercel AI SDK / OpenAI SDK options, 2026-11-01).
