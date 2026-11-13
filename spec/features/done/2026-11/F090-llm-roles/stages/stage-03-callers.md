# F090 stage 03 — Every caller on `generate`; the old client goes

Part of [`../plan.md`](../plan.md). **[risky]**: this stage moves the production triage path to the new client. Review job before the land.

After this stage there is one client: `createLlmClient({ table })` returns `LlmClient { modelOf, generate }`; `classify`, `classifierModel` and the wrapper are gone (D3, D16). The classifier prompt, model and request do not change. About 350 changed lines; most are the same small change in test fakes (probe P3).

Test rule of this stage (D17): test names, inputs and assertions stay. Only the fake LLM clients, their usage fixtures and the client construction in tests change. If an assertion must change to pass, stop and report it as a question.

## Step 1 — Rename, remove the wrapper, add the test helper

**Goal.** The final names of D16, and one helper for tests that need a client with one fixed `GenerateFn` (D18).

**Files.** `apps/server/src/platform/llm/client.ts`, `index.ts`, new `testing.ts`, `client.test.ts`, `client-roles.test.ts`, `providers/openai.test.ts`.

**Interfaces.**

- In `client.ts`: delete the old `LlmUsage` and old `LlmClient` interfaces and the wrapper `createLlmClient`. Rename `LlmCallUsage` → `LlmUsage` (one interface with `role`, `promptVersion`, `model`, `tokensIn`, `tokensOut`, `latencyMs`), `RoleLlmClient` → `LlmClient`, `createRoleLlmClient` → `createLlmClient`. The import of `uniformRoleTable` goes (`import type { LlmRoleSettings, LlmRoleTable } from "./settings";`).
- `index.ts` exports: `GenerateFn`, `GenerateRequest`, `GenerateResult`, `LlmCall`, `LlmClient`, `LlmUsage` (types) and `createLlmClient`, `createRateLimiter` (values); the rest as before.
- `client-roles.test.ts`: replace `createRoleLlmClient` with `createLlmClient` (no other change).
- New `testing.ts`:

```ts
import { createLlmClient, type GenerateFn, type LlmClient } from "./client";
import { type LlmProviderId, llmProviders } from "./providers";
import { uniformRoleTable } from "./settings";

/**
 * Tests only: a client whose every role calls `generate` on one provider row. The provider's own error rules apply.
 * Production code builds the client from `llmRoleTable(config)`.
 */
export function createFixedLlmClient(
  generate: GenerateFn,
  opts: {
    provider?: LlmProviderId;
    model: string;
    /** The key the provider row holds; a log test passes its marker here. */
    apiKey?: string;
    timeoutMs?: number;
    rpm?: number;
    reasoningEffort?: string | null;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  }
): LlmClient {
  const provider = opts.provider ?? "gemini";
  return createLlmClient({
    table: uniformRoleTable(
      {
        provider,
        model: opts.model,
        timeoutMs: opts.timeoutMs ?? 1000,
        rpm: null,
        reasoningEffort: opts.reasoningEffort ?? null,
      },
      { apiKeyName: "TEST_API_KEY", apiKey: opts.apiKey ?? "MARKER-KEY", rpm: opts.rpm ?? 60_000 }
    ),
    providers: { [provider]: { createGenerate: () => generate, classifyError: llmProviders[provider].classifyError } },
    now: opts.now,
    sleep: opts.sleep,
  });
}
```

Do not export `testing.ts` from `index.ts`; tests import it by path.

- `client.test.ts` port (probe P3: 79 changed lines):
  - import `createRateLimiter`, `GenerateFn`, `GenerateResult` from `./client` and `createFixedLlmClient` from `./testing`;
  - `request` becomes `{ role: "classifier", promptVersion: "classifier-v2", schema, system: "system text", prompt: "prompt MARKER-PROMPT" } as const`;
  - the `client()` helper returns `createFixedLlmClient(generate, { model: MODEL, timeoutMs: extra.timeoutMs ?? 1000, rpm: extra.rpm ?? 60_000, now: clock.now, sleep: clock.sleep })`;
  - the rate-limit case builds `createFixedLlmClient(<its generate>, { model: MODEL, rpm: 60, now: clock.now, sleep: clock.sleep })`;
  - every `.classify(` becomes `.generate(`;
  - the expected usage of "good JSON gives data and usage" adds `role: "classifier", promptVersion: "classifier-v2"`;
  - "classifierModel equals the option" becomes "modelOf gives the row's model": `expect(client(answer({ text: "{}" })).modelOf("classifier")).toBe(MODEL)`;
  - describe names "classify output" / "classify errors" become "generate output" / "generate errors".
- `providers/openai.test.ts` port (44 changed lines): import `createFixedLlmClient` from `../testing` instead of `createLlmClient` (keep the import order the linter wants: `../errors` before `../testing`); "through the shared client" builds `createFixedLlmClient(async () => toOpenAiResult(response), { model: MODEL, rpm: 6000 })` and calls `generate({ role: "classifier", promptVersion: "classifier-v2", schema: buildTriageAnalysisSchema(classifierCategories), system: "s", prompt: "p" })`; "OpenAI through the shared client" builds `createFixedLlmClient(createOpenAiGenerate({ apiKey: "MARKER-KEY", reasoningEffort: "none", client: fakeClient(create) }), { provider: "openai", model: MODEL, timeoutMs, rpm: 6000, reasoningEffort: "none" })`, `input` gains `role: "classifier", promptVersion: "classifier-v2"` (`as const`), and `llm.classify(input)` becomes `llm.generate(input)`. The snapshot file does not change.

**Decisions.** D3, D16, D17, D18.

**Test.** The ported cases keep their assertions. Proof: `bun test apps/server/src/platform/llm` passes; `git diff -- apps/server/src/platform/llm/providers/__snapshots__` is empty.

**Check.** `bun test apps/server/src/platform/llm && bun run typecheck` (typecheck fails until steps 2–4 are done; run it at the end of the stage).

**Done when.** The `platform/llm` tests pass with the snapshot unchanged.

**Out of scope.** `llm:check --role` (stage 5).

## Step 2 — Triage on `generate`

**Goal.** The classifier calls `generate` with role `classifier` and its prompt version; the triage service reads the model by role.

**Files.** `apps/server/src/modules/triage/classifier.ts`, `service.ts`, `eval.ts`.

**Interfaces.**

- `classifier.ts`: `llm.classify({` becomes `llm.generate({ role: "classifier", promptVersion: PROMPT_VERSION,` with the same `schema`, `system`, `prompt`, `model: input.model`. `input.model ?? llm.classifierModel` becomes `input.model ?? llm.modelOf("classifier")`. `PROMPT_VERSION` stays imported from `./prompts/classifier-v2` (stage 4 adds the registry). The return value `{ analysis, usage, promptVersion }` keeps its shape; `usage` now also carries role and version.
- `service.ts`: `model: deps.llm.classifierModel` (the error row) becomes `model: deps.llm.modelOf("classifier")`. Nothing else in this stage.
- `eval.ts`: add `export type CaseUsage = Pick<LlmUsage, "model" | "tokensIn" | "tokensOut" | "latencyMs">;` with the comment `// The usage of one eval case. State files of earlier runs have no role or prompt version.` `CaseResult.usage` becomes `CaseUsage | null`; `const usages: LlmUsage[]` becomes `CaseUsage[]`; where `runCase` sets `usage: classified.kind === "ok" ? classified.result.usage : null`, copy only the four fields (`{ model, tokensIn, tokensOut, latencyMs }`), so the state file lines keep their shape. Export `CaseUsage` from `triage/index.ts` next to `CaseResult`.

**Decisions.** D14, D24 (state files load).

**Test.** `classifier.test.ts` and `eval.test.ts` (step 4 adapts their fakes) pass with unchanged assertions, including "passes the model to the LLM client".

**Check.** `bun test apps/server/src/modules/triage`

**Done when.** The triage unit tests pass.

**Out of scope.** The `llm.call` data, the registry (stage 4).

## Step 3 — Entry points build the table

**Goal.** `main.ts` and the two LLM scripts build the client from `llmRoleTable` (D8). Behaviour and output stay.

**Files.** `apps/server/src/main.ts`, `apps/server/src/scripts/eval.ts`, `apps/server/src/scripts/llm-check.ts`.

**Interfaces.**

- `main.ts` (lines 127–139 and 218 today): replace `const settings = llmSettings(config)` with

  ```ts
  const llmTable = llmRoleTable(config);
  const classifierRow = llmTable.roles.classifier;
  const provider = llmProviders[classifierRow.provider];
  ```

  The log line stays `llm provider=${classifierRow.provider} classifier=${classifierRow.model}`. The client is `createLlmClient({ table: llmTable })`. The Telegram runtime gets `llm: { provider: classifierRow.provider, classifierModel: classifierRow.model }`. Remove the `llmSettings` import from `main.ts`.
- `scripts/eval.ts` (case run, lines 152–172 today): build `llmRoleTable(config, { classifier: { provider: options.provider, model: options.model, reasoningEffort: options["reasoning-effort"] } })` inside `try`; a `ConfigError` from it (effort on Gemini) logs `usage` and returns 1, as the old check did. Then `const row = table.roles.classifier; const keys = table.providers[row.provider];` — when `keys.apiKey === undefined` log `${keys.apiKeyName} is missing` and return 1. `model = row.model`, `effort = row.reasoningEffort`; the info line keeps `provider=${row.provider} model=${model} effort=${effort ?? "-"}`. The client is `createLlmClient({ table })`. Everything after it (state file name, `runEval` input) uses the same `model`, `provider` and `effort` values as before.
- `scripts/llm-check.ts`: build `llmRoleTable(config, { classifier: { provider: args.provider } })`; the same missing-key message from `table.providers[row.provider]`; `createLlmClient({ table })`; the greeting call becomes `llm.generate({ role: "classifier", promptVersion: "classifier-v0", schema: …, system: …, prompt: … })` (a check prompt; stage 5 adds `--role`). The log line keeps its fields, with `provider=${row.provider}` and `effort=${row.reasoningEffort ?? "-"}`. `--provider` and `--delegates` work as before.
- `scripts/job-run.ts` keeps `llmSettings` for its display line in this stage (stage 5 moves it).

**Decisions.** D8, D16.

**Test.** No script test exists yet (stage 5 adds one). The owner smoke runs at checkpoint 1.

**Check.** `bun run typecheck`. Do not run the scripts against a real provider (owner step U1 does it at checkpoint 1).

**Done when.** Typecheck passes for these files.

**Out of scope.** `--role` (stage 5). Removing `llmSettings` (stage 5).

## Step 4 — Test fakes take the new shape

**Goal.** Every test that fakes or builds the LLM client compiles and passes with unchanged assertions (D17).

**Files** (a repo-wide grep for `classifierModel`, `.classify(`, `LlmClient`, `createLlmClient`, `LlmUsage` outside `node_modules`, 2026-11-13; cold review B1): `apps/server/src/modules/triage/classifier.test.ts`, `eval.test.ts`, `eval-report.test.ts`; `apps/server/test/integration/actions-send.test.ts`, `scope-two-orgs.test.ts`, `triage-job.test.ts`, `triage-logs.test.ts`, `triage-service.test.ts`; `tools/fake-telegram/test/setup.ts` (`urgentLlm()`, lines 123–133; `bun run test:int` runs `tools/fake-telegram/test`). `tsc` does not report `actions-send.test.ts` (it casts `as unknown as LlmClient`, line 945), so a clean typecheck alone does not prove this file: change it by hand and run it.

**Interfaces.** The same change in each fake:

- `classifierModel: "<model>"` → `modelOf: () => "<model>"`.
- `async classify(req) { … }` → `async generate(req) { … }` (keep the body; the recorded fields stay).
- A usage object written inline in a fake's return (`{ model, tokensIn, tokensOut, latencyMs }`) gets `role: req.role, promptVersion: req.promptVersion` in front.
- A shared usage constant (`classifier.test.ts:10` and `eval.test.ts:14`, typed `LlmUsage`; `eval-report.test.ts:255`, untyped) is test data: add `role: "classifier", promptVersion: "classifier-v2"` to the constant itself and keep returning the constant unchanged. Do not spread it with the call's fields: `classifier.test.ts:185` asserts `expect(result.usage).toEqual(usage)`, and `classifyEmail` passes the usage through, so the constant must equal what the fake returns (cold review B2; the reviewer saw this case fail with the spread form).
- A generic fake method (`async classify<T>(req: { schema: z.ZodType<T>; … })` in `classifier.test.ts`, `eval.test.ts`; `async classify<T>()` in `eval-report.test.ts`) becomes `async generate<T, R extends LlmRole>(req: LlmCall<T, R>)` (import `LlmCall` from `platform/llm`, `LlmRole` from `@ea/core`). In `classifier.test.ts` the recorded `Recorded` type keeps `schema`, `system`, `prompt`, `model?`; `calls.push(req)` still works.
- Wrappers that replace the method (`triage-job.test.ts:307–314`, `:955–960`): `llm.classify.bind(llm)` → `llm.generate.bind(llm)`, `llm.classify = …` → `llm.generate = …`, `as LlmClient["classify"]` → `as LlmClient["generate"]`.
- `triage-logs.test.ts:92`: `createLlmClient({ provider: "gemini", apiKey: MARKERS.key, classifierModel: "fake-model", timeoutMs: 1000, rpm: 1000, generate, sleep })` → `createFixedLlmClient(generate, { model: "fake-model", apiKey: MARKERS.key, timeoutMs: 1000, rpm: 1000, sleep: async () => undefined })` from `../../src/platform/llm/testing`. The key marker stays in the client, so the case "no log line holds … a key" keeps its meaning.
- `triage-service.test.ts`: also the `decision()` fixture's `usage` (line 80) gets `role: "classifier", promptVersion: "classifier-v1"` (test data, not an assertion).
- `tools/fake-telegram/test/setup.ts` `urgentLlm()`: the same change as the other fakes (`modelOf`, `generate`, inline usage with `role: req.role, promptVersion: req.promptVersion`). `tools/fake-telegram/test/e2e.test.ts:47` passes the Telegram display value `llm: { provider, classifierModel }` and does not change.

The `toEqual` on the `llm.call` data at `triage-service.test.ts:331` stays as it is in this stage: the service writes no `role` yet (stage 4).

**Decisions.** D17.

**Test.** All listed files pass with unchanged assertions.

**Check.** `bun test apps/server/src/modules/triage && bun test apps/server/test/integration/triage-service.test.ts apps/server/test/integration/triage-job.test.ts apps/server/test/integration/triage-logs.test.ts apps/server/test/integration/scope-two-orgs.test.ts apps/server/test/integration/actions-send.test.ts && bun test tools/fake-telegram/test`, then `grep -rn "classifierModel\|\.classify(\|createRoleLlmClient\|RoleLlmClient\|LlmCallUsage" apps tools --include=*.ts` prints only the Telegram display field `classifierModel` in `channels/commands.ts`, `channels/telegram/runtime.ts`, `main.ts`, `scripts/job-run.ts` and their tests (also `tools/fake-telegram/test/e2e.test.ts`) (`llm: { provider, classifierModel }`, a display value, not the client).

**Done when.** The grep shows no client use of `classify` or `classifierModel`, and the listed tests pass.

**Out of scope.** Renaming the Telegram display field `classifierModel` (it names what `/status` shows).

## Stage done when

- Steps 1–4 are done; `git diff --stat` shows only the files of this stage.
- `git diff <stage base> -- '*.test.ts' tools/fake-telegram/test` changes no `expect(` line except in `client.test.ts` (usage gains `role`, `promptVersion`; `modelOf`); none in `openai.test.ts`, the triage tests or `tools/fake-telegram/test`.
- The proof of `plan.md` passes: `mkdir -p /tmp/f090-s03 && bun run lint > /tmp/f090-s03/lint.log 2>&1 && bun run typecheck > /tmp/f090-s03/typecheck.log 2>&1 && bun run test:unit > /tmp/f090-s03/unit.log 2>&1 && bun run test:int > /tmp/f090-s03/int.log 2>&1 && echo PROOF_OK`
