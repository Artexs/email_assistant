---
opened: 2026-11-12
---

# F072 · Automatic fallback between LLM providers

## Outcome

On soft errors of one provider, the classifier uses the other provider, so triage does not pause.

## Notes

Moved from `tasks/planned/llm-provider-fallback.md` on 2026-11-12. The full old task (plan, decisions, log): [plan.md](plan.md).

## Dropped 2026-11-19

Obsolete: F138 removes Gemini and Vertex AI. No second LLM provider remains. The EU path, if OpenAI refuses the EU project, is an own model endpoint in the EU (F111).
