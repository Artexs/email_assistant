# F141 plan — one LLM provider for every role, model tiers per provider row

> **Status 2026-11-19 — planned.** Plan base: 93b6785b. Seven stages, none built.

## Input

Owner words (ticket, notes, task, 2026-11-19): "one LLM_PROVIDER picks the provider for every role, with light/strong model tiers per provider row (openai, gemini, deepseek)". "do not remove any provider; its landed stage 01 (DEFAULT_JUDGE_MODEL, JUDGE_SAME_MODEL) is the judge seam to adapt". "model tiers (`light`, `strong`) per provider, so a switch is the provider name plus its key". "DeepSeek is for development, tests and evals; production stays on OpenAI". Legal pages, a sub-processor row and a DeepSeek holdout gate: skipped.

**Product**

- P1. Roles name a tier and an effort level, never a model: classifier `light`/`none`, drafter `light`/`low`, extractor `light`/`none`, judge `strong`/`none`. These equal the committed gate files (`gpt-6-luna` none, low, none) and the old judge default (`gpt-6.1-terra`, none), so production on OpenAI keeps its models: no new holdout gate run. Rejected: an effort per tier only (drafter would lose `low` and need a new gate).
- P2. Tiers: openai `gpt-6-luna` / `gpt-6.1-terra`; gemini `gemini-3.5-flash-lite` / `gemini-3.8-flash`; deepseek `deepseek-flash` / `deepseek-v4-pro`.
- P3. DeepSeek prices: the peak rates (upper bound, the same rule as "every input token at `inputPerM`"): flash 0.30 in / 1.20 out, v4-pro 1.32 / 3.96, USD per 1M; cache-hit rates as `cachedInputPerM`. Off-peak is half; no hour-based pricing. Rejected: off-peak rows (a report would under-count).
- P4. Default, owner to confirm (privacy): config refuses `LLM_PROVIDER=deepseek` with `TRIAGE_LLM_SCOPE=all`. DeepSeek has no sub-processor row, so real mail must not reach it. Rejected: no guard (a copied dev `.env` sends real mail to an unlisted processor).
- P5. Default, owner to confirm (user-visible, operator): a removed key with a non-empty value stops config; an empty value is ignored (old `.env.example` copies hold empty lines). The message names the key, never the value.
- P6. Default, owner to confirm: an own endpoint (`OPENAI_ENDPOINT_KIND=own` or a local host) reads its one model from a new key `OPENAI_OWN_MODEL` (required there); both tiers use it. `OPENAI_MODEL_CLASSIFIER` is removed everywhere. Rejected: keeping `OPENAI_MODEL_CLASSIFIER` for own only (one key, two meanings).

**Design**

- D1. The catalog is pure data in core: `packages/core/src/llm-providers.ts` holds the provider ids, label, tiers, price rows (moved from `triage/cost.ts`) and the effort rule. `LlmProviderId` moves to core. `llmPrices` stays as a derived flat map, so readers do not change. Rejected: prices beside the adapters (core metrics need them, core imports no server code).
- D2. The server registry `platform/llm/providers/` holds one row per id (`satisfies Record<LlmProviderId, LlmProvider>`): adapter, error map, env key names, defaults, extra env keys and removed keys. Config derives every provider env key from the rows; `config-llm.ts` names no provider.
- D3. DeepSeek reuses the OpenAI adapter (Responses API, strict `json_schema`, verified by the owner, `notes.md`) with the fixed base URL `https://api.deepseek.com`, endpoint kind `standard`, key `DEEPSEEK_API_KEY`, label `DeepSeek`, `classifyOpenAiError` (402 is a config error, 422 hard, 429 soft). It never sends `OPENAI_ORG_ID`, `OPENAI_PROJECT_ID`, `OPENAI_API_KEY` or `OPENAI_CUSTOM_HEADERS` lines: the OpenAI identity goes only to an OpenAI host. No `DEEPSEEK_BASE_URL` key.
- D4. DeepSeek effort: the Responses API takes `reasoning.effort` none/low/high/max and maps the others; `none` turns thinking off. The row sends the role's level as is. Thinking is on by default, so a row that sent no effort would think at `high`.
- D5. Provider tuning keys stay per provider and come from the row prefix: `<P>_API_KEY`, `<P>_TIMEOUT_MS`, `<P>_RPM` (so `DEEPSEEK_TIMEOUT_MS`, `DEEPSEEK_RPM` exist). Defaults: openai 30000 / 60, gemini 30000 / 12, deepseek 30000 / 60. Role keys `LLM_<ROLE>_TIMEOUT_MS` and `LLM_<ROLE>_RPM` stay (they pick no model).
- D6. Removed keys: `LLM_<ROLE>_PROVIDER`, `LLM_<ROLE>_MODEL`, `LLM_<ROLE>_REASONING` (judge, drafter, extractor), `OPENAI_MODEL_CLASSIFIER`, `GEMINI_MODEL_CLASSIFIER`, `OPENAI_REASONING_EFFORT`. `LLM_ESCALATION_*` stays ignored (`docs/capabilities/triage.md` rule 19).
- D7. The judge row is the provider's `strong` tier. `DEFAULT_JUDGE_MODEL` goes. `JUDGE_SAME_MODEL` and `judgeSetupError` stay: a flag can still pin the judged model to the strong model, and on an own endpoint both tiers are one model.
- D8. Flags pin one run: `--provider` sets the provider of every role of that run; `--model` and `--reasoning-effort` pin the judged role; `--judge-provider`, `--judge-model` pin the judge. `llm:check --role all` checks the four roles in one run.
- D9. Each `llm.call` row gets `provider` (JSON key in `audit_log.data`, no migration). `LlmUsage` and `LlmClient` carry it. An old row without it reads `null`. `triage:cost` prints the provider per line.
- D10. The key check keeps its rule: the server needs the active provider key when `TRIAGE_LLM_SCOPE` is not `off`; every LLM tool (`llm:check`, `eval`, `lab`) needs it at once. Both messages name the key. Rejected: always required (CI, e2e and the drill run with empty keys and scope `off`).
- D11. The scan test (stage 01, final in 07) reads the non-test `.ts` files of `apps/server/src`, `packages/core/src`, `apps/web/src` and `tools/` and fails on a provider id literal, a model id pattern (`gpt-`, `gemini-`, `deepseek-`) or a provider env prefix outside the registry files and a named list of exceptions, each with a reason.

## Facts checked

- DeepSeek pricing, models, Responses API, thinking toggle, error codes, concurrency limits (2500 flash, 500 pro; no RPM limit): read on `api-docs.deepseek.com` (`quick_start/pricing`, `guides/thinking_mode`, `guides/responses_api`, `quick_start/rate_limit`, `quick_start/error_codes`), 2026-11-19.
- Responses API with strict `json_schema` on both DeepSeek models: owner run, `notes.md` § Verified 2026-11-19 (no `reasoning` field was sent).
- Code at `93b6785b`: scout packets in `scouts.md`; checked by hand: config-llm, settings, client, endpoint, openai adapter, cost, outside-services, gate files.

## Not verified

- `reasoning.effort: "none"` and `"low"` on DeepSeek through this adapter: owner step O2.
- The VPS `.env` values of the removed keys: owner step O1.

## Done when

The ticket acceptance (6 items), plus: the scan test in stage 07 finds no site outside the registry and its exception list.

## Rules for every stage

- A gap or a deviation from a decision is a question in the final message, not a choice.
- Format only the files of the stage. Never print or log a key; an error names a key, never a value.
- The scan test allowlist (stage 01) lists each old site. A stage that removes a site removes its entry; a new site fails the test.
- Update the capability page of a changed behaviour in the same stage (`triage.md`, `reply-drafts.md`, `open-loops.md`, `measurement.md`, `docs/own-model.md`).

## Proof

```
mkdir -p /tmp/f141-sNN && bun run lint > /tmp/f141-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f141-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f141-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f141-sNN/int.log 2>&1 && echo PROOF_OK
```

## Owner checkpoints and owner steps

- Checkpoint after stage 04: review of stages 03–04, then the owner says go.
- O1 (before the deploy of the release that carries stage 04): remove the removed keys (D6) from the VPS `.env`. If one held a model or effort other than P1, stop: that release changes production. Dev `.env`: drop the stopgap lines (`OPENAI_ENDPOINT_KIND`, `OPENAI_BASE_URL`, `OPENAI_OWN_API_KEY`, `OPENAI_MODEL_CLASSIFIER`, `LLM_JUDGE_PROVIDER`, `LLM_JUDGE_MODEL`); set `LLM_PROVIDER=deepseek` and `DEEPSEEK_API_KEY`.
- O2 (after stage 05): `bun run llm:check --role all --provider <p>` for openai, gemini and deepseek; record the lines in `outcome.md`.

## Review

Stages 03 and 04 get a review job (`claude-opus-5-5`: security, LLM spend, config). Others land on the proof.

## Stages

- [01 audit and scan test](stages/stage-01-audit-and-scan-test.md)
- [02 core catalog](stages/stage-02-core-catalog.md)
- [03 DeepSeek row](stages/stage-03-deepseek-row.md) `[risky]`
- [04 role table from tiers](stages/stage-04-role-table-from-tiers.md) `[risky]`
- [05 tools, env files, docs](stages/stage-05-tools-env-docs.md)
- [06 provider in call rows](stages/stage-06-provider-in-call-rows.md)
- [07 scan test final](stages/stage-07-scan-test-final.md)

## How to run (coordinator)

Order: 01 → 02 → 03 → 04 → 05 → 07; 06 may run next to 04 and 05. Spawn each with the board worker flags and `--prepare 'bash scripts/limen-prepare.sh'`; drop the job DB after the land.

## Planning progress

- Scouts: 4 (`scouts.md`).
- [written] plan.md, stages 01–07, `questions.md` (7 defaults).
- Word counts before the review (`wc -w`): plan 1304; stages 01 589, 02 514, 03 648, 04 ~690, 05 610, 06 413, 07 444.

## Cold review

Model: `claude-opus-5-5`, because stages 03 and 04 are `[risky]` and touch security, config and LLM spend (`spec/build.md` standing models). Result: pending.

## Log
