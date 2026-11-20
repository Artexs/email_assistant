# F141 stage 02 — the provider catalog in core

Needs stage 01: `provider-scan.test.ts` `ALLOWED_SITES` (this stage edits entries).

Part of [`../plan.md`](../plan.md). Decisions: P1, P2, P3, D1.

Pure data and pure functions in `packages/core`. The server keeps its own `LlmProviderId` until stage 03; nothing in the server changes behaviour here.

## Step 1 — `packages/core/src/llm-providers.ts`

- **Goal:** one place for the provider ids, the tiers, the prices and the effort rule.
- **Interface (stages 03–06 use these names):**
  - `llmTiers = ["light", "strong"] as const`, `type LlmTier`.
  - `llmEffortLevels = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const`, `type LlmEffortLevel` (the same values as `openAiReasoningEfforts` in the server today; stage 04 makes the server use this list).
  - `interface LlmProviderCatalogRow { label: string; tiers: Record<LlmTier, { model: string }>; prices: Record<string, LlmPrice[]>; effort: "levels" | "none" }`. `"levels"`: the provider takes the role's level as is; `"none"`: the provider gets no effort (Gemini).
  - `llmProviderCatalog = { openai, gemini, deepseek } satisfies Record<string, LlmProviderCatalogRow>`; `type LlmProviderId = keyof typeof llmProviderCatalog`; `llmProviderIds` as a non-empty tuple.
  - `llmRoleModels: Record<LlmRole, { tier: LlmTier; effort: LlmEffortLevel }>` with P1: classifier light/none, drafter light/low, extractor light/none, judge strong/none.
  - `tierModel(provider: LlmProviderId, tier: LlmTier): string`.
  - `providerEffort(provider: LlmProviderId, level: LlmEffortLevel): string | null`.
- **Rows (P2, P3):** move the four existing price lists from `triage/cost.ts` into the rows (same values, sources and `checked` dates, the EU row of `gpt-6-luna` keeps `unverified`). New deepseek rows:
  - `deepseek-flash`: `inputPerM: 0.3`, `cachedInputPerM: 0.006`, `outputPerM: 1.2`.
  - `deepseek-v4-pro`: `inputPerM: 1.32`, `cachedInputPerM: 0.044`, `outputPerM: 3.96`.
  - Both: `source: "https://api-docs.deepseek.com/quick_start/pricing"`, `checked: "2026-11-19"`, and a comment: peak rate; off-peak is half; no hour rule, so the report shows the upper bound.
- **`triage/cost.ts`:** `llmPrices` becomes the flat map of all row prices (same type, same export). `LlmPrice` stays where it is or moves to the new file; keep one definition.

## Step 2 — allowlist

- Remove the stage-01 allowlist entry of `triage/cost.ts`.
- `pilotCost.models` in `packages/core/src/metrics/cost-model.ts` does not change: it records the models of the four measured pilot weeks. Set its allowlist reason to `"stays: measured record (pilot weeks), not catalog data"`.

## Test

1. Every tier model of every row has a standard price row valid on `2026-11-19`.
2. No model id appears in two rows (the flat map loses nothing: its key count equals the sum of row keys).
3. `costPerMail("deepseek-flash", 1_000_000, 1_000_000, new Date("2026-11-20T00:00:00Z"))` = `1.5`; for `deepseek-v4-pro` = `5.28`.
4. `costPerMail("gpt-6-luna", 1000, 100, at, "eu")` gives the same value as before the move (0.000165).
5. `providerEffort("gemini", "low")` = `null`; `providerEffort("deepseek", "none")` = `"none"`; `providerEffort("openai", "low")` = `"low"`.
6. `llmRoleModels` has a row for every value of `llmRoles`; `tierModel("openai", "strong")` = `"gpt-6.1-terra"`.
7. The existing `cost.test.ts` and m7 tests pass unchanged.

## Check

`bun test packages/core`

## Done when

- Tests 1–7 pass; `packages/core` imports nothing new outside itself.
- The Proof command of `plan.md` prints `PROOF_OK` after the last commit.

## Out of scope

The server registry, config, `LlmProviderId` in the server (stage 03). The subprocessor rows.
