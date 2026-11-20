# 0035 — LLM calls can go to an EU endpoint or to the buyer's own model; no PII sanitizer

- Status: accepted 2026-11-19 for decisions 1–5; decision 6 waits for the OpenAI answer (E11 discovery, 2026-11-13; `docs/product/stage-2/epics/E11-contacts-and-context.md` § Discovery). Amends ADR 0012 (endpoint per stage) and ADR 0015 (provider switch). Second pass after OpenAI answers the EU approval request.
- Date: 2026-11-13

## Context

The product frame promises "Mail stays on the user's server and in the EU" (`docs/product/stage-2/03-product-frame.md` §2). The pilot runs on OpenAI with "no EU location" (architecture §6.3). The S6 plan once chose Vertex AI EU (F076) and then dropped it for the local pilot. EU buyers ask three questions: who holds a copy, is it used for training, where is it processed (`04-review-result.md` §3).

The E11 page proposed a PII sanitizer before the LLM or a local model. Open tools find 73–89% of names and addresses on held-out text, and inflection breaks the restore of names (arXiv 2610.34012, 2026-10). Polish declines names. Pseudonymised text stays personal data.

OpenAI offers European data residency: a project with region Europe, processed in the EEA with zero data retention (OpenAI, 2025-02-05). Outside the US it needs approval for Modified Abuse Monitoring or ZDR and costs 10% more for models from 2026-03-05 (secondary sources, 2026-10). Ollama serves an OpenAI-compatible `/v1/responses` with JSON-schema output (v0.13.3+).

## Decision

1. **`OPENAI_BASE_URL`** (default: the public US API) selects the endpoint of the `openai` provider. There is one endpoint per deployment (plan P1 of F111, PD-101). The US API is the default of this install. One setting serves two options:
   - the OpenAI EU regional domain of a Europe project, for an install that needs it (an option, not the default; not verified yet, decision 6);
   - an OpenAI-compatible server that the buyer runs (for example Ollama with an open model).
2. **The model gate applies to both.** A new endpoint or model passes the E2a holdout gate before use (PD-024, PD-025); the report goes to `evals/results/`. A model with no passing gate file for its key (model, prompt, endpoint, host) keeps no `auto` category after a switch: the re-gate pauses it (ADR 0028, `docs/capabilities/trust.md` rule 9). The evidence gate, behind the flag `trust_ladder`, turns `auto` on only with such a file; with the flag off the real-label gate decides. Shadow and drafts still work.
3. **No PII sanitizer.** The product does not claim anonymisation. Privacy comes from where the call runs and under which terms.
4. **The endpoint is operator config, not user input.** The mail host guard (private address ranges) does not apply to it; the operator owns the choice. The key stays in env only.
5. Price rows: the EU domain gets its own rows (+10%); an own model has cost 0 in `triage:cost` and its hosting share is the buyer's.
6. If OpenAI refuses the EU approval, Vertex AI in an EU region (F076, a third adapter) is the fallback; this ADR then gets a dated amendment.

## Consequences

- The frame promise "in the EU" is true only for an install that is set to the EU domain (once decision 6 verifies it) or to an own server that stands in the EU. This install runs the US API for the owner's pilot, under the accepted terms of ADR 0013 and 0015. No page may claim EU processing for this install.
- With an own model, no outside LLM service gets mail text. The sub-processor registry has no condition for the endpoint yet (`packages/core/src/legal/subprocessors.ts` shows OpenAI whenever `LLM_PROVIDER` is `openai`); that change needs a `TERMS_VERSION` bump and the owner.
- The home VPS (4 GB RAM) cannot host a model; the install guide `docs/own-model.md` states the hardware need of an own model.
- The spike of E11b stage 1 passed: Ollama's Responses path accepts the request of the adapter (`notes/2026-11-15-ollama-responses-path.md`), so the adapter has no chat-completions path.

## Amendment 2026-11-19 (F111 stages 02, 03 and 06)

- **Decision 4 gets a start check (D2).** The endpoint stays operator config, but `OPENAI_BASE_URL` is checked at every start. It must be `https`, or `http` only to loopback (`127.0.0.0/8`, `::1`, `localhost`) or a one-label host (a container on the same machine). No user name, password, query or fragment. A bad value stops the start; the error names the key, never the value. Code: `apps/server/src/platform/llm/providers/endpoint.ts`.
- **Endpoint kinds (D3).** `standard` (`api.openai.com`), `eu` (`eu.api.openai.com`) and `own`. Another `*.openai.com` host is refused. A loopback or one-label host is `own`. Another host is `own` only with `OPENAI_ENDPOINT_KIND=own`, over https. A hosted OpenAI-compatible API (Azure OpenAI, OpenRouter) is refused: its cost and its sub-processor are unknown. An own server never gets `OPENAI_API_KEY`; it gets `OPENAI_OWN_API_KEY` or a fixed text.
- **Decision 5 is built.** `own` costs 0, `eu` has its own price rows (the row of `gpt-6-luna` is unverified until decision 6 is settled), and every `llm.call` row and gate file carries its endpoint (`docs/capabilities/triage.md` rule 16).
- **Own-model results: not measured yet.** The holdout runs of the two candidate models wait for owner step O2 (F111 stage 05). The guide `docs/own-model.md` says so and holds no number.
