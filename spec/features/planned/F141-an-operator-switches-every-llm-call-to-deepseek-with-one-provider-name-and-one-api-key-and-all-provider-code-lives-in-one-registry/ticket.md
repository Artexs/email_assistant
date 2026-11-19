---
opened: 2026-11-19
---

# F141 · An operator switches every LLM call to DeepSeek with one provider name and one API key, and all provider code lives in one registry

## Outcome

An operator sets the provider name `deepseek` and its API key, restarts, and every LLM call of the product, the evals and the judge goes to DeepSeek, priced in the call rows and the cost readers. Today one variable (`LLM_PROVIDER`) already picks the provider and one registry holds the provider code; what is missing is the DeepSeek row of that registry (its API shape, errors, prices). DeepSeek is for development, tests and evals; production stays on OpenAI. Roles name a model tier (`light`, `strong`), never a model id: each provider row maps the tiers to its models and prices, so a provider switch changes no other env key (owner, 2026-11-19). A short audit stage first proves that no provider code sits outside the registry. Owner, 2026-11-20.

## Scope

- A read-only audit first: every place that names a provider or a model outside the provider registry, and where provider logic is duplicated; the plan moves it into the registry.
- A DeepSeek row in the registry: its API shape, error mapping, price rows with their read date, reasoning-effort rules and rate limit.
- Model tiers: each provider row maps `light` and `strong` to a model id, a price row and a reasoning-effort rule; each role picks a tier (classifier, drafter and extractor `light`, judge `strong`). An env key may still pin one exact model for one role (evals, a trial).
- Config: the provider key, the base URL, the global and the per-role provider name. The judge rule (the judge model differs from the model under test) keeps working across providers.

## Out of scope

- Removing a provider: the OpenAI, Gemini and DeepSeek rows all stay, the operator picks one by name.
- Automatic fallback between providers, Vertex AI (both dropped), an own model server or the EU endpoint (F140).
- Legal pages, the sub-processor row and a holdout gate for DeepSeek (owner, 2026-11-19: skipped). So the production switch on the VPS is out of scope too: real mail goes to DeepSeek (outside the EU) only after a new ticket adds the gate and the legal entries.

## Acceptance

- With only `LLM_PROVIDER` and that provider's key set, every role runs on that provider's tier models, for `openai`, `gemini` and `deepseek`; no `*_MODEL_*` key is needed.
- The gate file names the resolved model id, not the tier, so a provider switch needs a new gate run.
- `bun run llm:check` with the DeepSeek provider and key passes for every role; with the key missing it fails with a message that names the key, never a value.
- Each call writes one `llm.call` row with provider `deepseek`, the model, the tokens and a priced cost; `triage:cost` and `stats:week` show it.
- The audit report lists every provider-specific code site before, and a test or lint rule proves zero outside the registry after.

## Sequenced

- No ticket gates it: the Gemini removal ticket (F138) was dropped, so the registry keeps its `openai` and `gemini` rows and this adds `deepseek`.

## Notes

- Checked 2026-11-20: no planned or parked ticket covers a second hosted provider. The private model option refuses hosted OpenAI-compatible hosts on purpose (ADR 0035, privacy); this ticket adds DeepSeek as its own registry row with its own key, so that refusal stays for unknown hosts. Facts and seams: `notes.md`.
