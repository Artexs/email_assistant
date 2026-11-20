# F141 plan — one LLM provider for every role, model tiers per provider row

> **Status 2026-11-20 — planned.** Plan base: 93b6785b. Seven stages, none built.

## Input

Owner words (2026-11-19): "one LLM_PROVIDER picks the provider for every role, with light/strong model tiers per provider row (openai, gemini, deepseek)". "do not remove any provider; its landed stage 01 (DEFAULT_JUDGE_MODEL, JUDGE_SAME_MODEL) is the judge seam to adapt". "model tiers (`light`, `strong`) per provider, so a switch is the provider name plus its key". "DeepSeek is for development, tests and evals; production stays on OpenAI".

**Product**

- P1. Roles name a tier and an effort level, never a model: classifier `light`/`none`, drafter `light`/`low`, extractor `light`/`none`, judge `strong`/`none`. These equal the committed gate files and the old judge default, so OpenAI production keeps its models: no new gate run. Rejected: an effort per tier (the drafter would lose `low`).
- P2. Tiers: openai `gpt-6-luna` / `gpt-6.1-terra`; gemini `gemini-3.5-flash-lite` / `gemini-3.8-flash`; deepseek `deepseek-flash` / `deepseek-v4-pro`.
- P3. DeepSeek prices: peak rates (an upper bound): flash 0.30 in / 1.20 out, v4-pro 1.32 / 3.96 USD per 1M; cache-hit rates as `cachedInputPerM`. Rejected: off-peak rows (half; a report would under-count).
- P4. Default, owner to confirm (privacy): config refuses `LLM_PROVIDER=deepseek` with `TRIAGE_LLM_SCOPE=all`, except when `LAB_STACK` equals `SIM_STACK_NAME` (`ea-sim`, the live lab: generated mail only). DeepSeek has no sub-processor row, so real mail must not reach it. Rejected: no guard; no lab exception (the lab could never use DeepSeek).
- P5. Default, owner to confirm (production): a removed key with a non-empty value stops config, also when the value equals the new resolved one (one rule); an empty value passes. `.env.example` at the base holds three removed keys with values (`GEMINI_MODEL_CLASSIFIER`, `OPENAI_MODEL_CLASSIFIER`, `OPENAI_REASONING_EFFORT`), so every copied `.env` must lose those lines: C-env (dev) and O1 (VPS). The message names the key, never the value.
- P6. Default, owner to confirm: an own endpoint (`OPENAI_ENDPOINT_KIND=own` or a local host) reads its one model from a new key `OPENAI_OWN_MODEL` (required there); both tiers use it. `OPENAI_MODEL_CLASSIFIER` is removed everywhere. Rejected: keeping the old key for own only (two meanings).

**Design**

- D1. The catalog is pure data in core: `packages/core/src/llm-providers.ts` holds the provider ids, label, tiers, price rows (moved from `triage/cost.ts`) and the effort rule. `LlmProviderId` moves to core. `llmPrices` stays as a derived flat map, so readers do not change. Rejected: prices beside the adapters (core metrics need them).
- D2. The server registry `platform/llm/providers/` holds one row per id (`satisfies Record<LlmProviderId, LlmProvider>`): adapter, error map, env key names, defaults, extra env keys and removed keys. Config derives every provider env key from the rows; `config-llm.ts` names no provider.
- D3. DeepSeek reuses the OpenAI adapter (Responses API with strict `json_schema`: `notes.md` § Verified) with the fixed base URL `https://api.deepseek.com`, endpoint kind `standard`, key `DEEPSEEK_API_KEY`, label `DeepSeek`, `classifyOpenAiError` (402 is a config error, 422 hard, 429 soft). The OpenAI identity (`OPENAI_ORG_ID`, `OPENAI_PROJECT_ID`, `OPENAI_API_KEY`, `OPENAI_CUSTOM_HEADERS`) goes only to an OpenAI host. No `DEEPSEEK_BASE_URL` key.
- D4. DeepSeek takes `reasoning.effort` none/low/high/max (it maps the others); `none` turns thinking off, and no field means `high`. The row sends the role's level as is.
- D5. Per-provider keys come from the row prefix: `<P>_API_KEY`, `<P>_TIMEOUT_MS`, `<P>_RPM`; defaults 30000 ms and 60 / 12 / 60 rpm (openai, gemini, deepseek). `LLM_<ROLE>_TIMEOUT_MS` and `LLM_<ROLE>_RPM` stay (they pick no model).
- D6. Removed keys: `LLM_<ROLE>_PROVIDER`, `LLM_<ROLE>_MODEL`, `LLM_<ROLE>_REASONING` (judge, drafter, extractor), `OPENAI_MODEL_CLASSIFIER`, `GEMINI_MODEL_CLASSIFIER`, `OPENAI_REASONING_EFFORT`. `LLM_ESCALATION_*` stays ignored.
- D7. The judge row is the provider's `strong` tier. `DEFAULT_JUDGE_MODEL` goes. `JUDGE_SAME_MODEL` stays: a flag can pin the judged model to the strong one, and an own endpoint has one model.
- D8. Flags pin one run: `--provider` sets every role; `--model`, `--reasoning-effort` the judged role; `--judge-provider`, `--judge-model` the judge. `llm:check --role all` checks four roles.
- D9. Each `llm.call` row gets `provider` (a JSON key in `audit_log.data`, no migration); an old row reads `null`; `triage:cost` prints it.
- D10. The server needs the active key only when `TRIAGE_LLM_SCOPE` is not `off`; every LLM tool needs it at once; both messages name the key. Rejected: always required (CI, e2e and the drill run without keys).
- D11. The scan test (stage 01, final in 07) reads non-test `.ts` files and fails on a provider id, model id, provider env key, provider list or host literal outside the registry files and a named exception list, each with a reason.

## Facts checked

- DeepSeek prices, models, Responses API, thinking, error codes, concurrency (2500 flash, 500 pro; no RPM limit): `api-docs.deepseek.com` (pricing, thinking_mode, responses_api, rate_limit, error_codes), read 2026-11-19.
- Responses API with strict `json_schema` on both DeepSeek models: `notes.md` § Verified 2026-11-19 (sent no `reasoning`).
- Code at `93b6785b`: `scouts.md`, then read by hand; review 1 checked the decisions against it.

## Not verified

- `reasoning.effort: "none"` on DeepSeek through this adapter: record step R1 (after stage 03). `"low"`: owner step O2.

## Done when

The ticket acceptance (6 items). Item 5 reads "zero outside the registry and a named exception list" (coordinator, after review 1). The final exceptions: `outside-services.ts`, `legal/subprocessors.ts`, the e2e pin, `pilotCost.models`.

## Rules for every stage

- A gap or a deviation is a question in the final message, not a choice.
- Format only the files of the stage. Never print or log a key; an error names a key, never a value.
- The scan test allowlist (stage 01) lists each old site. A stage that removes a site removes its entry; a new site fails the test.
- Update the capability page of a changed behaviour in the same stage.

## Proof

```
mkdir -p /tmp/f141-sNN && bun run lint > /tmp/f141-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f141-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f141-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f141-sNN/int.log 2>&1 && echo PROOF_OK
```

## Owner checkpoints and owner steps

- C-env (coordinator, after the stage-03 land, before the stage-04 spawn; it blocks stage 04): in the main checkout `.env`, delete `OPENAI_ENDPOINT_KIND`, `OPENAI_BASE_URL` and every D6 key with a value (the stopgap lines of `notes.md`); rename the `OPENAI_OWN_API_KEY=` line to `DEEPSEEK_API_KEY=` with `sed`, never print it; set `LLM_PROVIDER=deepseek`. With `TRIAGE_LLM_SCOPE=all` there, keep `LLM_PROVIDER` and ask the owner (P4). Reason: `scripts/limen-prepare.sh` copies this `.env` into every job.
- R1 (coordinator record after the stage-03 land and C-env; blocks nothing): `bun run llm:check` (classifier, effort `none`) on DeepSeek. Record in `outcome.md` whether `reasoning.effort: "none"` is accepted. A refusal is a question to the owner (D4), not a stop of stage 04.
- Checkpoint after stage 04: review of stages 03–04, then the owner says go.
- O1 (owner, before the deploy of the release that carries stage 04): at the old release run `bun run llm:check --role <r>` for the four roles and keep the lines (model, effort); delete the D6 keys from the VPS `.env`; after the deploy run `bun run llm:check --role all` and compare. A changed model or effort is a production change: stop and ask. Known: the drafter moves from `OPENAI_REASONING_EFFORT` to `low` (it is off until F115 turns it on).
- O2 (after stage 05): `bun run llm:check --role all --provider <p>` for openai, gemini and deepseek; record the lines in `outcome.md`.

## Review

Stages 03 and 04: a review job (`claude-opus-5-5`). Others land on the proof.

## Stages

- [01 audit and scan test](stages/stage-01-audit-and-scan-test.md)
- [02 core catalog](stages/stage-02-core-catalog.md)
- [03 DeepSeek row](stages/stage-03-deepseek-row.md) `[risky]`
- [04 role table from tiers](stages/stage-04-role-table-from-tiers.md) `[risky]`
- [05 tools, env files, docs](stages/stage-05-tools-env-docs.md)
- [06 provider in call rows](stages/stage-06-provider-in-call-rows.md)
- [07 scan test final](stages/stage-07-scan-test-final.md)

## How to run (coordinator)

Order: 01 → 02 → 03 → C-env (+ R1) → 04 → 05 → 07; 06 may run next to 04 and 05. Board worker flags, `--prepare 'bash scripts/limen-prepare.sh'`; drop the job DB after the land.

## Planning progress

- Scouts: 4 (`scouts.md`).
- [written] plan.md, stages 01–07, `questions.md` (14 defaults).
- Word counts after the review fixes (`wc -w`): plan 1499; stages 01 627, 02 501, 03 692, 04 697, 05 668, 06 413, 07 467.

## Cold review

Model: `claude-opus-5-5`, because stages 03 and 04 are `[risky]` and touch security, config and LLM spend (`spec/build.md` standing models). FAIL at `49e91a51`: 1 blocking, 10 notes (`plan-review-1.md`). All fixed with the coordinator decisions (2026-11-20); defaults in `questions.md` Q8–Q14.

- B1: ticket item 5 reworded; scan gets list and host patterns (stage 01); exceptions named (stage 07).
- N1: P4 lab exception (stage 03). N2: P5 premise fixed; C-env before stage 04; stage 04 cleans `.env.example`.
- N3: the e2e pin sets the D6 keys and `OPENAI_OWN_MODEL` to `""` (stage 04; stage 05 checks).
- N4: `pilotCost.models` stays, a permanent exception. N5: Q8, F115 in `## Sequenced`. N6: O1 compares `llm:check` lines. N7: record step R1.
- N8: ticket item 2 follows D10. N9: ticket item 4 reworded, not a provider column in `stats:week` (cheaper; the intent was the priced cost).
- N10: stage 03 effort `none`; `runLlmCheck` seam (stage 05); stage 07 exceptions fixed, comment-only matches reworded.

## Log
