---
opened: 2026-11-19
landed: 2026-11-20
---

# F141 · One variable picks the LLM provider for the whole application: OpenAI, Gemini or DeepSeek, with one API key

## Outcome

An operator sets `LLM_PROVIDER` (`openai`, `gemini` or `deepseek`) and that provider's API key, restarts, and every LLM call of the product, the evals and the judge goes to that provider, priced in the call rows and the cost readers. No other env key is needed. Roles name a model tier (`light`, `strong`), never a model id; each provider row maps the tiers to its models and prices. A new provider is one registry row. This replaces the dropped OpenAI-only ticket (F138): no provider is removed. DeepSeek is for development, tests and evals; production stays on OpenAI (owner, 2026-11-19).

## Scope

- A read-only audit first: every place that names a provider or a model outside the provider registry, and every duplicated piece of provider logic.
- Model tiers in each provider row: `light` and `strong` map to a model id, a price row and a reasoning-effort rule. Classifier, drafter and extractor use `light`; the judge uses `strong`, so the judge model always differs from the model under test.
- One provider for all roles: the per-role provider and model env keys (`LLM_<ROLE>_PROVIDER`, `LLM_<ROLE>_MODEL`, `*_MODEL_CLASSIFIER`) go; eval and `llm:check` flags may still pin one exact model for one run.
- A `deepseek` registry row: base URL, key, error mapping, price rows with their read date, rate limit. The DeepSeek API accepts the Responses API with `json_schema` (verified, `notes.md`).
- The `gemini` row gets its tiers and stays selectable.

## Out of scope

- The own model endpoint (`OPENAI_ENDPOINT_KIND=own`, private model, F140): it keeps its own rules.
- Automatic fallback between providers.
- Legal pages, the sub-processor row and a holdout gate for DeepSeek (owner, 2026-11-19: skipped). So the production switch to DeepSeek is out of scope too.

## Acceptance

- With only `LLM_PROVIDER` and that provider's key set, `bun run llm:check` passes for every role, for `openai`, `gemini` and `deepseek`.
- With the key missing and a triage scope on, config fails with a message that names the key, never a value; with the triage scope `off` the server starts, and every LLM tool fails at once with the same message.
- A removed per-role key in `.env` fails config with a message that names it, so an old `.env` cannot silently change models.
- Each call writes one `llm.call` row with the provider, the resolved model, the tokens and a priced cost; `triage:cost` shows the provider, the model and the cost; `stats:week` shows the priced cost, which follows the model and the endpoint.
- The audit report lists every provider-specific code site before, and a test proves zero sites outside the registry and a named exception list after (each exception with its reason).
- The gate file names the resolved model id, not the tier.

## Notes

- Production `.env` on the VPS changes in the release that carries this: the plan lists the keys to remove there and on the dev machine (the DeepSeek stopgap lines of `notes.md`).
- Facts and seams: `notes.md`.

## Sequenced

- Plan after: none.
- Build after: none. F115 (reply drafts, active) is a neighbour, not a gate: its drafter gate may pick another drafter model or effort (`questions.md` Q8). Gate: none (this ticket is not in `docs/product/stage-2/07-foundation-plan.md` or `05-execution-plan.md` § 2). The deploy of the release that carries stage 04 waits for owner step O1 (`plan.md`).
