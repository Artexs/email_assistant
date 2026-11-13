# 0035 — LLM calls can go to an EU endpoint or to the buyer's own model; no PII sanitizer

- Status: proposed (E11 discovery, 2026-11-13; `docs/product/stage-2/epics/E11-contacts-and-context.md` § Discovery). Amends ADR 0012 (endpoint per stage) and ADR 0015 (provider switch). Second pass after OpenAI answers the EU approval request.
- Date: 2026-11-13

## Context

The product frame promises "Mail stays on the user's server and in the EU" (`docs/product/stage-2/03-product-frame.md` §2). The pilot runs on OpenAI with "no EU location" (architecture §6.3). The S6 plan once chose Vertex AI EU (F076) and then dropped it for the local pilot. EU buyers ask three questions: who holds a copy, is it used for training, where is it processed (`04-review-result.md` §3).

The E11 page proposed a PII sanitizer before the LLM or a local model. Open tools find 73–89% of names and addresses on held-out text, and inflection breaks the restore of names (arXiv 2610.34012, 2026-10). Polish declines names. Pseudonymised text stays personal data.

OpenAI offers European data residency: a project with region Europe, processed in the EEA with zero data retention (OpenAI, 2025-02-05). Outside the US it needs approval for Modified Abuse Monitoring or ZDR and costs 10% more for models from 2026-03-05 (secondary sources, 2026-10). Ollama serves an OpenAI-compatible `/v1/responses` with JSON-schema output (v0.13.3+).

## Decision

1. **`OPENAI_BASE_URL`** (default: the public US API) selects the endpoint of the `openai` provider. One setting serves two cases:
   - the OpenAI EU regional domain of a Europe project (the default for any organization other than the owner's own pilot, once approved);
   - an OpenAI-compatible server that the buyer runs (for example Ollama with an open model).
2. **The model gate applies to both.** A new endpoint or model passes the E2a holdout gate before use (PD-024, PD-025); the report goes to `evals/results/`. A model that fails unlocks no `auto` category (ADR 0028); shadow and drafts still work.
3. **No PII sanitizer.** The product does not claim anonymisation. Privacy comes from where the call runs and under which terms.
4. **The endpoint is operator config, not user input.** The mail host guard (private address ranges) does not apply to it; the operator owns the choice. The key stays in env only.
5. Price rows: the EU domain gets its own rows (+10%); an own model has cost 0 in `triage:cost` and its hosting share is the buyer's.
6. If OpenAI refuses the EU approval, Vertex AI in an EU region (F076, a third adapter) is the fallback; this ADR then gets a dated amendment.

## Consequences

- The frame promise becomes true for every organization except the owner's pilot, which keeps the accepted terms of ADR 0013 and 0015 until the owner switches.
- The papers (S6e) name "OpenAI, EU region" as the sub-processor; with an own model, no LLM sub-processor.
- The home VPS (4 GB RAM) cannot host a model; the install guide states the hardware need of an own model.
- Stage 1 of E11b checks whether Ollama's Responses path accepts the adapter's strict `text.format`; if not, the adapter gets a chat-completions path with `response_format`.
