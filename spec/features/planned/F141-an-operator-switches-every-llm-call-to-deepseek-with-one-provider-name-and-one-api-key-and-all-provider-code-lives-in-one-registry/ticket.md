---
opened: 2026-11-19
---

# F141 · An operator switches every LLM call to DeepSeek with one provider name and one API key, and all provider code lives in one registry

## Outcome

An operator sets the provider name `deepseek` and its API key, restarts, and every LLM call of the product, the evals and the judge goes to DeepSeek, priced in the call rows and the cost readers. Today one variable (`LLM_PROVIDER`) already picks the provider and one registry holds the provider code; what is missing is the DeepSeek row of that registry (its API shape, errors, prices) and its legal line. A short audit stage first proves that no provider code sits outside the registry. Owner, 2026-11-20.

## Scope

- A read-only audit first: every place that names a provider or a model outside the provider registry, and where provider logic is duplicated; the plan moves it into the registry.
- A DeepSeek row in the registry: its API shape, error mapping, price rows with their read date, reasoning-effort rules and rate limit.
- Config: the provider key, the base URL, the global and the per-role provider name. The judge rule (the judge model differs from the model under test) keeps working across providers.
- Legal: a sub-processor row, the privacy text and a terms entry for DeepSeek. The vision asks for EU location before any outside user's mail; DeepSeek processes outside the EU, so the switch is a documented pilot choice, never a default.
- The holdout gate (classifier and drafter) on DeepSeek before any automatic category runs on it; a failing model unlocks no `auto`.

## Out of scope

- Removing the OpenAI provider: both rows stay, the operator picks one by name.
- Automatic fallback between providers, Vertex AI (both dropped), an own model server or the EU endpoint (F140).
- The production switch on the VPS: an owner step after the gate, done as a release.

## Acceptance

- `bun run llm:check` with the DeepSeek provider and key passes for every role; with the key missing it fails with a message that names the key, never a value.
- Each call writes one `llm.call` row with provider `deepseek`, the model, the tokens and a priced cost; `triage:cost` and `stats:week` show it.
- The audit report lists every provider-specific code site before, and a test or lint rule proves zero outside the registry after.
- Holdout reports and gate files for the classifier and the drafter on DeepSeek are in `evals/results/`, judged by another model.
- The privacy pages and the sub-processor registry name DeepSeek with its location; the terms version has a new entry.

## Sequenced

- Plan after: the OpenAI-only ticket (F138) has stages and its stage 02 landed (the registry then has one row; this adds the second).
- Build after: F138 in `done/` (its stages remove Gemini in the same registry, config and legal files).
- Gate: the holdout gate before any production switch; owner step for the switch. Real LLM spend about $1–2 for the two holdout runs.

## Notes

- Checked 2026-11-20: no planned or parked ticket covers a second hosted provider. The private model option refuses hosted OpenAI-compatible hosts on purpose (ADR 0035, privacy); this ticket adds DeepSeek as its own registry row with its own key, so that refusal stays for unknown hosts. Facts and seams: `notes.md`.
