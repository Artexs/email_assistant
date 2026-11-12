---
opened: 2026-11-12
---

# F076 · The LLM calls run on Vertex AI in an EU region

## Outcome

The classifier and the writer call Gemini on Vertex AI in an EU region with caching off, and the accuracy is not worse than the current model. Needed only before outside customers use the service.

## Scope

- A `vertex` provider beside `openai` and `gemini` in `platform/llm/providers/`, an eval gate against the current model, prices for `triage:cost`.

## Out of scope

- Hosting changes; customer papers.

## Acceptance

- The eval passes the gate of the old plan (D16 of `tasks/active/s6-pre-sale.md`).

## Notes

Dropped from S6 on 2026-11-12 (user: local production, "It's okay to use my current LLM provider"). The full old segment plan: [plan.md](plan.md). Facts V1–V3 and decisions D15–D17: `tasks/active/s6-pre-sale.md`.
