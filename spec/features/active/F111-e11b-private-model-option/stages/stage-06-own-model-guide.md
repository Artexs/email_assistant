# F111 stage 06 — Own-model install guide and ADR 0035 accepted

Part of [`../plan.md`](../plan.md). Review before the land (published claims). Docs only. Needs stage 05 (`evals/results/<date>-own-model-runs.md` and the two reports).

## Step 1 — The guide

**Goal.** An operator can run the product on an own model and knows the cost in quality and hardware, and every sentence is true at `HEAD` (ADR 0035 Consequences; D13).

**Files.** `docs/own-model.md` (new, English).

**Content, in this order.**
1. What an own endpoint changes: mail text goes only to the operator's server (D3); no LLM sub-processor (D14); cost 0 in the product's reports, hosting is the operator's (D7, D12).
2. What is not supported: a hosted OpenAI-compatible API (D3); plain http except loopback or a container on the same host (D2; a one-label name must be a container, not a LAN host found through a DNS search domain).
3. Hardware: the home VPS cannot host a model; the measured GPU, memory and seconds per mail from the stage 05 record; mail volume as `200 × <mean tokensIn of the stage 21 report>` prompt tokens a day (not the discovery estimate).
4. Setup with Ollama: the env lines `OPENAI_BASE_URL`, `OPENAI_ENDPOINT_KIND=own` (only for a remote https server), `OPENAI_API_KEY` placeholder, `OPENAI_TIMEOUT_MS`, `OPENAI_API_STYLE` if stage 04 was built; `OLLAMA_CONTEXT_LENGTH=8192` and why (a cut prompt gives false answers).
5. The `auto` rule as it is at `HEAD` (D13): `auto` per category comes from the mailbox's real-label gate and does not follow a model or endpoint switch. Operator step: before a switch, set every `auto` category back to `assist`; turn `auto` on again only for categories that pass the gate on the new model. Name F110 as the ticket that will re-gate by itself. If F110 has landed at `HEAD` and re-gates, describe that instead and say so in the final message.
6. Results: per model and category go or no-go, precision, recall, next to the `gpt-6-luna` standard baseline of the same prompt label, which the guide names (if production moved since stage 05, the guide says the numbers are for the older prompt); links to the reports, the gate files and the run record.

**Decisions.** D2, D3, D7, D12, D13, D14.

**Test.**
1. Every number in the results table equals the number in its gate file (check each by hand; list the pairs in the final message).
2. Every link resolves (`test -f` per path).
3. No sentence says that a failing model "unlocks no auto" unless F110 enforces it at `HEAD`.

**Done when.** Cases 1–3 hold.

## Step 2 — ADR 0035 and the pages

**Goal.** The ADR matches the decisions taken here (D15; review B5, N17).

**Files.** `docs/decisions/0035-llm-endpoint-eu-and-own-model.md`, `docs/capabilities/triage.md`, `docs/architecture.md` §6.3.

**Rules.**
- ADR status: "accepted <date> for decisions 1–5; decision 6 waits for the OpenAI answer (stage 07)".
- Decision 1 rewritten to P1 and PD-101: one endpoint per deployment; the US API is the default of this install; the EU domain is an option for an install that needs it.
- Consequence 1 rewritten: the frame promise is true only for an install set to the EU domain or an own server; this install runs the US API for the owner's pilot.
- A dated amendment lists D2 (http rule) and D3 (endpoint kinds, hosted APIs refused, `OPENAI_ENDPOINT_KIND`), and the own-model results with links.
- `triage.md`: a link to the guide. Architecture §6.3: "own model: no LLM sub-processor; EU endpoint: option, not verified yet".

**Test.**
1. No page under `docs/` says that this install processes mail in the EU (`grep -rn` for "in the EU" and "EU region" in `docs/decisions/0035*`, `docs/architecture.md`, `docs/capabilities/`, `docs/own-model.md`; each hit is read and is true).

**Done when.** Case 1 holds; the final message lists the hits and why each is true.

## Proof

```
mkdir -p /tmp/f111-s06 && bun run lint > /tmp/f111-s06/lint.log 2>&1 && test -f docs/own-model.md && echo PROOF_OK
```
