---
opened: 2026-11-06
landed: 2026-11-12
---

# F026 · LLM provider switch: Gemini and OpenAI

## Outcome

The server uses Gemini or OpenAI for the LLM calls. One config value selects the provider; a restart applies it. A third provider later needs one adapter file, one config block, price rows and one eval run. Nothing else changes.

## Notes

Moved from `tasks/done/llm-provider-switch.md` on 2026-11-12. The full old task (plan, decisions, log): [plan.md](plan.md).
