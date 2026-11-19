---
opened: 2026-11-19
---

# F140 · The own-model holdout numbers and the EU endpoint check of the private model option run when the owner asks

## Outcome

The own-model guide holds measured holdout numbers of two open models (Bielik 11B and Gemma 3 12B), so the privacy story of the product rests on evidence, and the OpenAI EU endpoint is verified or its fallback is recorded. These are the two stages that the private model option (F111, closed) left open when the owner stopped that path for now.

## Scope

- The two own models served from the owner's PC (LM Studio) and run through the existing holdout gate; the guide and ADR 0035 get the numbers.
- The EU endpoint check after OpenAI answers the Europe project request, or the recorded fallback: an own model in the EU, not Vertex AI (ADR 0037).
- Seams, the stopped spike and the open questions: `notes.md` in this folder.

## Out of scope

- Everything the private model option landed: the endpoint setting, its cost rows and gate fields, the guide text.
- A hosted third-party API such as DeepSeek (F141).

## Acceptance

- `docs/own-model.md` shows the holdout numbers of both models with the date and the gate result.
- ADR 0035 names the measured numbers and the EU result or the fallback.
- The EU endpoint answers the production model with the EU project key, or the fallback note says why not.

## Sequenced

- Plan after: the OpenAI-only ticket (F138) stage 04 landed (its ADR names the EU fallback).
- Build after: owner step: "run the own model" or the EU project answer.
- Gate: owner. Parked until the owner names this ticket.
