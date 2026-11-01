# 0007 — LLM through Vercel AI SDK with Zod structured output
- Status: proposed — under review 2026-11-02 (`docs/roadmap.md` §5 recommends the OpenAI SDK with a configurable baseURL for MVP)
- Date: 2026-11-01

## Context
Triage needs structured output (category, confidence, reason, fields). The current `ILLMProvider` returns a plain string.
The provider is still open (OpenAI in docs, `gpt-5-nano` in code, OpenRouter key in `.env.example`). The budget is small.

## Decision
- Use the Vercel AI SDK (`ai` package) with provider packages. Provider and model come from config.
- Two model roles: `classifier` (cheap, fast) and `writer` (drafts, summaries).
- Zod schemas from `packages/core` define every LLM output.
- Every call is traced in Langfuse with a prompt version. `triage_results` stores model + prompt version.
- `evals/` holds labeled cases (synthetic or anonymized, never real mail in git). A prompt change must pass the eval.
- Use provider settings for zero retention / no training.

## Consequences
- Changing provider is config, not code.
- Accuracy is measured, not guessed.
- One more dependency (AI SDK) and one external service (Langfuse cloud or self-hosted).
