# F090 stage 05 — Tools and cleanup

Part of [`../plan.md`](../plan.md). Normal stage. Edits `platform/config.ts` and `.env.example`: the coordinator checks the § Sequenced gate before the spawn.

After this stage `bun run llm:check --role <role>` checks any role on its own provider and model, both eval reports name the role, and the old `llmSettings`, `LlmSettings`, `classifierModel(config)` and the unused writer keys are gone. Then the coordinator stops at checkpoint 1.

## Step 1 — `llm:check --role`

**Goal.** One command proves a role's key, provider and model (D6, D23).

**Files.** New `apps/server/src/scripts/llm-check-args.ts` and `llm-check-args.test.ts`; `apps/server/src/scripts/llm-check.ts`.

**Interfaces.** `llm-check-args.ts` (the `*-args.ts` pattern of `org-plan-args.ts`):

```ts
export const usage = `usage: bun run llm:check [--role ${llmRoles.join("|")}] [--provider ${llmProviderIds.join("|")}] [--delegates]`;

export interface LlmCheckArgs {
  role: LlmRole;
  provider: LlmProviderId | undefined;
  delegates: boolean;
}

// null on any bad argument. --delegates belongs to the classifier's triage check only.
export function parseLlmCheckArgs(argv: string[]): LlmCheckArgs | null;

export const greetingSchema = z.object({ greeting: z.string() });

// A check prompt, not a registry prompt: version `<role>-v0`; llm:check writes no DB row.
export function greetingCall<R extends LlmRole>(role: R): LlmCall<{ greeting: string }, R> {
  return {
    role,
    promptVersion: `${role}-v0`,
    schema: greetingSchema,
    system: "Answer with a JSON object.",
    prompt: "Say hello in the field greeting.",
  };
}
```

`parseLlmCheckArgs` uses `parseArgs` with `strict: true`, `allowPositionals: false`; `--role` defaults to `classifier` and must pass `isLlmRole`; `--provider` must be in `llmProviderIds`; `--delegates` with a role other than `classifier` returns null.

`llm-check.ts`: `const args = parseLlmCheckArgs(process.argv.slice(2))`; on null log `usage` and exit 1. Build `llmRoleTable(config, { [args.role]: { provider: args.provider } })` (an `undefined` provider means no change); `row = table.roles[args.role]`, `keys = table.providers[row.provider]`; when `keys.apiKey === undefined` log `${keys.apiKeyName} is missing` and exit 1. `createLlmClient({ table })`. Every check line starts with `role=${used.role}` and keeps `provider=`, `model=`, `effort=`, `check=`, `latencyMs=`, `tokensIn=`, `tokensOut=`. The greeting check runs for every role with `greetingCall(args.role)`; the triage check and `--delegates` run only for `classifier`, as today. Remove the stage 3 literal `classifier-v0`.

**Decisions.** D8, D23.

**Test** (`llm-check-args.test.ts`):

1. `parseLlmCheckArgs([])` → `{ role: "classifier", provider: undefined, delegates: false }`.
2. `["--role", "judge", "--provider", "gemini"]` → `{ role: "judge", provider: "gemini", delegates: false }`.
3. `["--delegates"]` → `{ role: "classifier", provider: undefined, delegates: true }`.
4. Null for: `["--role", "writer"]`, `["--provider", "vertex"]`, `["--role", "judge", "--delegates"]`, `["extra"]`, `["--unknown"]`.
5. `greetingCall("judge")` sent through `createLlmClient` with the `fakeProviders` and `twoProviderTable` helpers of stage 2 (copy them; the judge row is Gemini `gem-j`): the Gemini fake gets one request with `model: "gem-j"` and `jsonSchema` equal to `z.toJSONSchema(greetingSchema)`; the usage has `role: "judge"`, `promptVersion: "judge-v0"`. (Acceptance 4: the role's schema goes to its provider.)

**Check.** `bun test apps/server/src/scripts/llm-check-args.test.ts && bun run typecheck`

**Done when.** The five cases pass. No real provider call in any test.

**Out of scope.** A sample check per role prompt (each epic adds its own, D23).

## Step 2 — Eval reports name the role

**Goal.** Both eval reports record the role; the cases report already records the prompt version (D6, D24).

**Files.** `apps/server/src/modules/triage/eval.ts`, `eval-real.ts`, `eval-report.ts`, `eval-report.test.ts`, `eval.test.ts` (only if a fixture needs the field).

**Interfaces.** `EvalReportBase` gains `role: LlmRole` with the comment `// The role whose prompt and model this report measures.` `runEval` and `buildRealReport` set `role: "classifier"` (the only role with an eval set). In `eval-report.ts` `header()`, both kinds print `- role: ${report.role}` as the line right after `- date: …`. No `--role` flag in `scripts/eval.ts`. The state file name does not change.

**Decisions.** D24.

**Test** (`eval-report.test.ts`): the `casesReport()` and `realReport()` fixtures get `role: "classifier"`; one new case: the rendered cases report contains `- role: classifier` and `- prompt version: classifier-v2` (fixture value), and the rendered real report contains `- role: classifier`. Existing cases stay unchanged.

**Check.** `bun test apps/server/src/modules/triage`

**Done when.** The new case and all triage tests pass.

**Out of scope.** Role sets for the eval (E2a).

## Step 3 — The old settings and the writer keys go

**Goal.** One way to read LLM settings: `llmRoleTable` (D16, D25).

**Files.** `apps/server/src/platform/config.ts`, `config.test.ts`, `config-roles.test.ts`, `apps/server/src/scripts/job-run.ts`, `.env.example`.

**Interfaces.**

- `config.ts`: delete `export interface LlmSettings`, `export function llmSettings`, `export function classifierModel`. `providerBlocks` stays private with its own type `ProviderBlock = { apiKeyName: string; apiKey: string | undefined; classifierModel: string; timeoutMs: number; rpm: number; reasoningEffort: string | null }` (no `writerModel`). Delete the schema keys `GEMINI_MODEL` and `OPENAI_MODEL` and their comments.
- `job-run.ts`: the Telegram runtime's display value becomes `const row = llmRoleTable(config).roles.classifier;` and `llm: { provider: row.provider, classifierModel: row.model }`.
- `config.test.ts`: the two `llmSettings returns …` cases become `llmRoleTable` cases with the same values (Gemini: classifier row `{ provider: "gemini", model: "gemini-3.5-flash-lite", timeoutMs: 30000, rpm: null, reasoningEffort: null }` and `providers.gemini` `{ apiKeyName: "GEMINI_API_KEY", apiKey: "test-key", rpm: 12 }`; OpenAI: `{ provider: "openai", model: "gpt-6-luna", timeoutMs: 30000, rpm: null, reasoningEffort: "none" }` and `{ apiKeyName: "OPENAI_API_KEY", apiKey: "o-key", rpm: 60 }`; the second OpenAI form `llmSettings(config, "openai")` becomes `llmRoleTable(config, { classifier: { provider: "openai" } })`). `classifierModel(config)` (lines 138, 211) becomes `llmRoleTable(config).roles.classifier.model`. The asserts on `GEMINI_MODEL` and `OPENAI_MODEL` (lines 136, 205–206, 264–266) go; replace them with one case: `loadConfig({ ...fullEnv, GEMINI_MODEL: "x", OPENAI_MODEL: "y" })` loads (an old `.env` still starts).
- `config-roles.test.ts` case 1 compares with literal values instead of `llmSettings` (for the three envs of stage 1: `{ provider: "openai", model: "gpt-6-luna", timeoutMs: 30000, rpm: null, reasoningEffort: "none" }` with provider row rpm 60; `{ provider: "openai", model: "m-1", timeoutMs: 20000, rpm: null, reasoningEffort: "low" }` with rpm 30; `{ provider: "gemini", model: "g-1", timeoutMs: 30000, rpm: null, reasoningEffort: null }` with `{ apiKeyName: "GEMINI_API_KEY", apiKey: "g-key", rpm: 7 }`).
- `.env.example`: delete `GEMINI_MODEL=…` and `OPENAI_MODEL=` with their comment lines.

**Decisions.** D16, D25.

**Test.** As listed. `grep -rn "llmSettings\|LlmSettings\|writerModel\|GEMINI_MODEL\b\|OPENAI_MODEL\b" apps --include=*.ts` and `grep -n "^GEMINI_MODEL=\|^OPENAI_MODEL=" .env.example` print nothing (the `*_MODEL_CLASSIFIER` keys stay).

**Check.** `bun test apps/server/src/platform && bun run typecheck`

**Done when.** The grep prints nothing and the platform tests pass.

**Out of scope.** Docs that name the writer keys (stage 6).

## Stage done when

- Steps 1–3 are done; only the files of this stage changed.
- The proof of `plan.md` passes: `mkdir -p /tmp/f090-s05 && bun run lint > /tmp/f090-s05/lint.log 2>&1 && bun run typecheck > /tmp/f090-s05/typecheck.log 2>&1 && bun run test:unit > /tmp/f090-s05/unit.log 2>&1 && bun run test:int > /tmp/f090-s05/int.log 2>&1 && echo PROOF_OK`
- The final message reminds the coordinator of checkpoint 1 (owner steps U1, U2 in `plan.md`).
