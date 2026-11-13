> **Status 2026-11-12 — planned.** Left: everything. From `llm-provider-switch` stage 7.2 (ADR 0015).

# OpenAI budget alert

Scope: ADR 0015. The user set a $3 per month budget for the OpenAI project (`spec/features/done/2026-11/F026-llm-provider-switch/plan.md` stage 0). Read `spec/features/planned/F023-gemini-billing-budget-alert/plan.md` for the shape.

## Goal

The user gets a warning before the OpenAI project budget runs out. The app tells the user when `http_429_quota` pauses triage.

## Done when

- The OpenAI project has a budget alert (the user sets it in the OpenAI dashboard; an agent lists the steps).
- `/status` or the digest names the quota pause (`http_429_quota`), not only "LLM paused".
- `docs/known-alerts.md` entry for `http_429_quota` points to this fix.
