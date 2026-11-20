# F141 stage 06 — the provider in every `llm.call` row and in the cost readers

Needs stage 03: `LlmProviderId` with `deepseek` and the deepseek price rows (stage 02). May run next to 04 and 05: it changes the LLM client and the audit readers, not the config.

Part of [`../plan.md`](../plan.md). Decisions: D9, P3.

## Step 1 — the client reports its provider

- **Interface:** `LlmUsage` gets `provider: LlmProviderId`. `LlmClient` gets `providerOf(role): LlmProviderId` (the error branch has no usage and reads it, like `endpointOf`).
- Fakes and test clients (`platform/llm/testing.ts`, the Telegram fake in `tools/`) implement it.

## Step 2 — the row and its writers

- `recordLlmCall` writes `provider` into `audit_log.data` next to `model` and `endpoint`. No migration: `data` is JSON.
- Every writer passes it, on the ok branch from `usage.provider` and on the error branch from `llm.providerOf(role)`: triage, the open-loops analysis, the reply drafter spend, the trust history check. Grep for other writers.
- An old row without the key reads `provider: null`.

## Step 3 — readers

- The grouped read for `triage:cost` groups by provider, model and endpoint; each line prints the provider (`-` for `null`).
- m7 (`stats:week`, the weekly report, the operator view) needs no provider: the price follows model and endpoint. Its test gets a deepseek row so the priced cost is proven.
- `docs/capabilities/triage.md` (audit events line) and `measurement.md`: the row holds the provider.

## Test

1. A client with a fake `deepseek` provider: `usage.provider` = `"deepseek"`, `providerOf("judge")` = `"deepseek"`.
2. Integration: a triage run with the fake deepseek client writes one `llm.call` row with `provider: "deepseek"`, `model: "deepseek-flash"`, `endpoint: "standard"`, the token counts of the fake.
3. Integration: a fake that throws a soft error writes one row with `provider` from `providerOf` and the error outcome.
4. m7 `unitCost` with one row `deepseek-flash`, 1,000,000 tokens in and out, `standard`, at 2026-11-20: `llmUsdWeek` 1.5, `unpricedCalls` 0.
5. `triage:cost` output for one deepseek row and one old row without `provider`: two lines, `deepseek` and `-`; the deepseek line has a cost.
6. The tenant-filter test of the grouped read still holds (another org's row is not counted).

## Check

`bun test packages/core apps/server/src/platform/llm` and the integration files of the changed writers with `bun run test:int:ci`.

## Done when

- Tests 1–6 pass.
- The Proof command of `plan.md` prints `PROOF_OK` after the last commit.

## Out of scope

A provider column in `triage_results` or any migration. The trust evidence key (it already holds the provider).
