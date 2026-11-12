> **Status 2026-11-12 — planned.** Idea from `llm-provider-switch` (decision D10, ADR 0015). Not started.

# Automatic fallback between LLM providers

## Goal

On soft errors of one provider, the classifier uses the other provider, so triage does not pause.

## Open points

- The LLM pause per provider, not global.
- The daily cap (`LLM_DAILY_CAP`) and the rate limit per provider.
- `triage_results.model` mixes models; the eval of both providers must pass the bar.
- Data terms: the second provider also gets real mail (ADR 0015 data rules, user decision needed).

## Done when

To be set when the user wants it.
