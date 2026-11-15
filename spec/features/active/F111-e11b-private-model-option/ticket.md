---
opened: 2026-11-13
---

# F111 · E11b Private model option

## Outcome

An operator can send the LLM calls to the OpenAI EU endpoint or to an own OpenAI-compatible model server with one setting, and every call is priced by where it ran. Two open models have published holdout numbers and an install guide, so the privacy claims of the product rest on evidence (vision: "EU location before any outside user's mail"). Row 17 of `docs/product/stage-2/05-execution-plan.md` §2.1; the epic is `docs/product/stage-2/epics/E11-contacts-and-context.md`.

## Scope

- `OPENAI_BASE_URL` with a start check and an endpoint kind (`standard`, `eu`, `own`) for the `openai` provider; hosted third-party APIs are refused.
- The endpoint in `llm.call` rows, in the cost readers, and in the gate files of the E2a holdout.
- A spike on a real Ollama server, and a chat-completions path only if the spike fails.
- Holdout runs of two own models on the owner's PC, the install guide, and ADR 0035 accepted.
- The EU check and run after OpenAI answers, or the recorded fallback.

## Out of scope

- A per-organization endpoint (plan P1, Q1).
- The Vertex AI adapter (F076, the fallback ticket).
- Any change to the VPS env or a deploy.
- The security page and the legal sub-processor texts (E10, F107): only the seam.

## Acceptance

- See `plan.md` § Done when (4 checks); each stage file has its own tests and Proof.

## Slices

One worker job per stage, in order: 01 → 02 → 03 → 04 (only if 01 fails) → 05 → 06 → 07. Stage 01 may run next to stage 02. No migration, no `bun.lock` change. Owner stops: before 05 (O2) and before 07 (O1, O3). Owner, 2026-11-15: stage 04 is skipped (stage 01 passed); stage 06 builds now, before 05, without measured results; stage 05 waits for O2, which the owner does later (`notes/owner-later.md`). Detail: `plan.md` § How to run.

## Sequenced

- Plan after: none (planning may run ahead of the build).
- Build after: F097 (E2a Offline lab, in `spec/features/done/`).
- Gate: Owner: OpenAI Europe project request (PD-111); second pass on the answer (PD-110) before the EU stage (stage 07). Owner step O2 (`ollama-rocm` or a rented GPU) before stage 05: later, by the owner (2026-11-15: "I will do it in the future, not right now").

## Notes

Source row: §2.1 # 17. Defaults: `questions.md`. Scout packets: `scouts.md`.
