# F090 stage 02 — The role client beside the old one

Part of [`../plan.md`](../plan.md). **[risky]**: this code builds every LLM request. Review job before the land.

After this stage `createRoleLlmClient({ table })` exists and the old `createLlmClient(...)` is a thin wrapper over it (D16). No caller changes. Every existing test of `platform/llm` (client, Gemini, OpenAI with its snapshot) and every triage test passes **without any edit**: that is the proof that the classifier request did not change. Stage 3 moves the callers and removes the wrapper.

## Step 1 — `createRoleLlmClient`, the call type and the usage type

**Goal.** One client for all roles: per call it takes the role's row from the table, waits for the role limiter (if the role has an rpm) and the provider limiter, builds the provider's `GenerateFn` once per `(provider, effort)`, applies the role's timeout, and returns data plus a usage with role and prompt version (D3, D12–D15).

**Files.** `apps/server/src/platform/llm/client.ts`, `apps/server/src/platform/llm/errors.ts`, `apps/server/src/platform/llm/index.ts`.

**Interfaces.** Keep `parseOutput`, `createRateLimiter`, `withTimeout`, `GenerateRequest`, `GenerateResult`, `GenerateFn`, the old `LlmUsage` and the old `LlmClient` exactly as they are. Add the imports:

```ts
import type { LlmRole, PromptVersion } from "@ea/core";
import { z } from "zod";

import { createLog } from "../log";

import { isLlmError, LlmBlockedError, LlmConfigError, LlmOutputError, LlmSoftError } from "./errors";
import { type LlmProvider, type LlmProviderId, llmProviders } from "./providers";
import { type LlmRoleSettings, type LlmRoleTable, uniformRoleTable } from "./settings";
```

Add after `withTimeout` (this code passed probe P2):

```ts
/** The usage of one call: it goes into the `llm.call` audit row and `triage_results`. */
export interface LlmCallUsage extends LlmUsage {
  role: LlmRole;
  promptVersion: string;
}

export interface LlmCall<T, R extends LlmRole> {
  role: R;
  /** The prompt registry version that built `system` and `prompt`. */
  promptVersion: PromptVersion<NoInfer<R>>;
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  /** Eval only: another model of the role's provider. */
  model?: string;
}

export interface RoleLlmClient {
  /** The model of the role's row in the role table. */
  modelOf(role: LlmRole): string;
  generate<T, R extends LlmRole>(call: LlmCall<T, R>): Promise<{ data: T; usage: LlmCallUsage }>;
}

type RateLimiter = ReturnType<typeof createRateLimiter>;
type ProviderRegistry = Record<LlmProviderId, Pick<LlmProvider, "createGenerate" | "classifyError">>;

export function createRoleLlmClient(opts: {
  table: LlmRoleTable;
  /** Tests: fake providers. Default: the provider registry. */
  providers?: Partial<ProviderRegistry>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): RoleLlmClient {
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const providerOf = (id: LlmProviderId) => opts.providers?.[id] ?? llmProviders[id];
  // One limiter per provider (its rate limit is shared by all roles) and one per role with its own rpm.
  const providerLimiters = new Map<LlmProviderId, RateLimiter>();
  const roleLimiters = new Map<LlmRole, RateLimiter>();
  // One generate per provider and effort: the OpenAI adapter binds the effort when it is built.
  const generators = new Map<string, GenerateFn>();

  const providerLimiter = (id: LlmProviderId): RateLimiter => {
    let limiter = providerLimiters.get(id);
    if (limiter === undefined) {
      limiter = createRateLimiter({ rpm: opts.table.providers[id].rpm, now, sleep });
      providerLimiters.set(id, limiter);
    }
    return limiter;
  };
  const roleLimiter = (role: LlmRole, rpm: number): RateLimiter => {
    let limiter = roleLimiters.get(role);
    if (limiter === undefined) {
      limiter = createRateLimiter({ rpm, now, sleep });
      roleLimiters.set(role, limiter);
    }
    return limiter;
  };
  const generatorOf = (row: LlmRoleSettings, model: string): GenerateFn => {
    const key = `${row.provider}:${row.reasoningEffort ?? ""}`;
    let generate = generators.get(key);
    if (generate === undefined) {
      const apiKey = opts.table.providers[row.provider].apiKey;
      if (apiKey === undefined) throw new LlmConfigError("missing_key", model);
      generate = providerOf(row.provider).createGenerate({ apiKey, reasoningEffort: row.reasoningEffort });
      generators.set(key, generate);
    }
    return generate;
  };

  return {
    modelOf: (role) => opts.table.roles[role].model,

    async generate(call) {
      const row = opts.table.roles[call.role];
      const model = call.model ?? row.model;
      if (row.rpm !== null) await roleLimiter(call.role, row.rpm).acquire();
      await providerLimiter(row.provider).acquire();
      const started = now();
      try {
        const generate = generatorOf(row, model);
        const result = await withTimeout(
          generate({
            model,
            system: call.system,
            prompt: call.prompt,
            jsonSchema: z.toJSONSchema(call.schema),
            signal: AbortSignal.timeout(row.timeoutMs),
          }),
          row.timeoutMs,
          model
        );
        const data = parseOutput(result, call.schema, model);
        const usage: LlmCallUsage = {
          role: call.role,
          promptVersion: call.promptVersion,
          model,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          latencyMs: now() - started,
        };
        log.debug(
          `ok role=${call.role} model=${model} latencyMs=${usage.latencyMs} tokensIn=${usage.tokensIn} tokensOut=${usage.tokensOut}`
        );
        return { data, usage };
      } catch (error) {
        const llmError = isLlmError(error) ? error : providerOf(row.provider).classifyError(error, model);
        log.debug(`failed role=${call.role} model=${model} code=${llmError.code}`);
        throw llmError;
      }
    },
  };
}
```

In `errors.ts`, add `| "missing_key"` as the last member of `ConfigCode`.

In `index.ts`, export the new names: `createRoleLlmClient` (value) and `LlmCall`, `LlmCallUsage`, `RoleLlmClient` (types).

**Decisions.** D3, D12, D13, D14, D15. The order "limiters, then `started = now()`" is today's order, so `latencyMs` keeps its meaning (no limiter wait inside).

**Test.** Step 3.

**Check.** `bun run typecheck`

**Done when.** Typecheck passes.

**Out of scope.** Callers (stage 3). The `llm.call` row (stage 4).

## Step 2 — The old `createLlmClient` becomes a wrapper

**Goal.** The old API runs on the new code, so all old tests prove the new code (D16).

**Files.** `apps/server/src/platform/llm/client.ts`.

**Interfaces.** Replace the body of the old `createLlmClient` (same signature, same return type `LlmClient`) with:

```ts
/** Deprecated: the classifier-only client over the role client. The next stage of this ticket removes it. */
export function createLlmClient(opts: {
  provider: LlmProviderId;
  apiKey: string;
  classifierModel: string;
  timeoutMs: number;
  rpm: number;
  reasoningEffort?: string | null;
  generate?: GenerateFn;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): LlmClient {
  const table = uniformRoleTable(
    {
      provider: opts.provider,
      model: opts.classifierModel,
      timeoutMs: opts.timeoutMs,
      rpm: null,
      reasoningEffort: opts.reasoningEffort ?? null,
    },
    { apiKeyName: "", apiKey: opts.apiKey, rpm: opts.rpm }
  );
  const fixed = opts.generate;
  const providers =
    fixed === undefined
      ? undefined
      : { [opts.provider]: { createGenerate: () => fixed, classifyError: llmProviders[opts.provider].classifyError } };
  const inner = createRoleLlmClient({ table, providers, now: opts.now, sleep: opts.sleep });
  return {
    classifierModel: opts.classifierModel,
    async classify(req) {
      const { data, usage } = await inner.generate({ ...req, role: "classifier", promptVersion: "classifier-v0" });
      return {
        data,
        usage: { model: usage.model, tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, latencyMs: usage.latencyMs },
      };
    },
  };
}
```

`classifier-v0` exists only inside this wrapper for one stage; `classify` returns the old usage shape, so no caller sees it.

**Decisions.** D3 (the alias for one stage), D16.

**Test.** No edit to any existing test file in this stage. Run them as they are:

```
bun test apps/server/src/platform/llm apps/server/src/modules/triage
```

All pass, including `openai.test.ts` with its snapshot and the `client.test.ts` cases "sends the JSON schema from Zod and uses the request model", "two calls with rpm 60 start 1000 ms apart", "a generate that never ends gives timeout within 1 s", "no error message holds the prompt, the key or the error body" and both log cases.

If one old test fails, stop: the new code changed behaviour. Report the test and the difference; do not edit the test.

**Check.** `bun test apps/server/src/platform/llm apps/server/src/modules/triage` and `git diff --stat -- '*.test.ts'` lists only the new file of step 3.

**Done when.** Every old test passes unchanged.

**Out of scope.** Removing the wrapper (stage 3).

## Step 3 — Unit tests of the role client

**Goal.** Prove acceptance 2 (a second role on another provider uses that provider's `createGenerate`, its own limiter and timeout) and the usage fields.

**Files.** New `apps/server/src/platform/llm/client-roles.test.ts`.

**Interfaces.** Helpers (write them as they are; probe P2):

```ts
const schema = z.object({ category: z.string(), confidence: z.number() });
const okText = '{"category":"a","confidence":1}';

function fakeClock() {
  let t = 0;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
  };
}

interface Built {
  provider: LlmProviderId;
  apiKey: string;
  reasoningEffort: string | null;
}

// Fake providers: each records how it was built and every request it got.
function fakeProviders(answer: (provider: LlmProviderId, req: GenerateRequest) => Promise<string> | string) {
  const built: Built[] = [];
  const requests: { provider: LlmProviderId; req: GenerateRequest }[] = [];
  const make = (provider: LlmProviderId) => ({
    createGenerate: (o: { apiKey: string; reasoningEffort: string | null }): GenerateFn => {
      built.push({ provider, ...o });
      return async (req) => {
        requests.push({ provider, req });
        return { text: await answer(provider, req), tokensIn: 1, tokensOut: 2, blocked: false };
      };
    },
    classifyError: (_error: unknown, model: string) => new LlmSoftError("network", model),
  });
  return { providers: { gemini: make("gemini"), openai: make("openai") }, built, requests };
}

const classifierRow: LlmRoleSettings = {
  provider: "openai",
  model: "gpt-c",
  timeoutMs: 1000,
  rpm: null,
  reasoningEffort: "none",
};

function twoProviderTable(judge: Partial<LlmRoleSettings> = {}): LlmRoleTable {
  const base = uniformRoleTable(classifierRow, { apiKeyName: "OPENAI_API_KEY", apiKey: "o-key", rpm: 60 });
  return {
    roles: {
      ...base.roles,
      judge: { provider: "gemini", model: "gem-j", timeoutMs: 50, rpm: null, reasoningEffort: null, ...judge },
    },
    providers: {
      openai: { apiKeyName: "OPENAI_API_KEY", apiKey: "o-key", rpm: 60 },
      gemini: { apiKeyName: "GEMINI_API_KEY", apiKey: "g-key", rpm: 30 },
    },
  };
}

const classifierCall = {
  role: "classifier",
  promptVersion: "classifier-v2",
  schema,
  system: "S",
  prompt: "P",
} as const;
const judgeCall = { role: "judge", promptVersion: "judge-v1", schema, system: "S", prompt: "P" } as const;
```

**Decisions.** D12–D15.

**Test** (all with `createRoleLlmClient({ table, providers: fake.providers, ...fakeClock() })` unless the case says otherwise):

1. `generate(classifierCall)`: one request; `req.model` = `gpt-c`, `req.system` = `S`, `req.prompt` = `P`, `req.jsonSchema` equals `z.toJSONSchema(schema)`, `req.signal` is an `AbortSignal`; `usage` equals `{ role: "classifier", promptVersion: "classifier-v2", model: "gpt-c", tokensIn: 1, tokensOut: 2, latencyMs: 0 }`; `built` equals `[{ provider: "openai", apiKey: "o-key", reasoningEffort: "none" }]`.
2. `generate(classifierCall)` then `generate(judgeCall)`: requests go `[openai, gpt-c]`, `[gemini, gem-j]`; `built` equals the OpenAI entry then `{ provider: "gemini", apiKey: "g-key", reasoningEffort: null }`; the judge usage has `role: "judge"`; `modelOf("judge")` = `gem-j`, `modelOf("drafter")` = `gpt-c`.
3. Limiters per provider (record `[provider, clock.now()]` in `answer`): classifier, judge, drafter (`{ ...classifierCall, role: "drafter", promptVersion: "drafter-v1" }`), judge → starts `[["openai", 0], ["gemini", 0], ["openai", 1000], ["gemini", 2000]]` (OpenAI 60 rpm, Gemini 30 rpm; the drafter shares the OpenAI limiter).
4. Role rpm: `twoProviderTable({ rpm: 6 })`, two judge calls → starts `[0, 10000]` (the role limit of 6 rpm is slower than Gemini's 30).
5. Role timeout: the Gemini fake never answers (`new Promise(() => undefined)`), real clock (no `now`/`sleep`): the judge call rejects with `LlmSoftError`, `llmErrorCode` = `timeout`, in less than 1000 ms (the judge row has `timeoutMs: 50`; the classifier row has 1000).
6. Efforts: `table.roles.drafter = { ...classifierRow, reasoningEffort: "medium" }`; calls classifier, extractor, drafter → `built.map((b) => b.reasoningEffort)` equals `["none", "medium"]` (one generate per provider and effort).
7. Missing key: `table.providers.gemini.apiKey = undefined`; the judge call rejects with `llmErrorCode` = `missing_key`; `built` is empty.
8. Request model: `generate({ ...classifierCall, model: "gpt-other" })` → `req.model` and `usage.model` = `gpt-other`.
9. Types: `// @ts-expect-error` above `llm.generate({ ...classifierCall, promptVersion: "judge-v1" })` and above `llm.generate({ ...classifierCall, role: "writer" })`, each inside an arrow function that the test does not call; assert both arrows are functions. Typecheck fails if either line compiles (without `NoInfer` the first one compiles; probe P2).
10. Log (spy on `console.log`, `setLogLevel("debug")`, restore `info` in `finally`): `generate({ ...judgeCall, prompt: "MARKER-PROMPT" })` writes a line that contains `role=judge` and `model=gem-j` and contains neither `MARKER` nor `g-key`.

**Check.** `bun test apps/server/src/platform/llm/client-roles.test.ts && bun run typecheck`

**Done when.** The ten cases pass.

**Out of scope.** `createFixedLlmClient` (stage 3).

## Stage done when

- Steps 1–3 are done. Only `client.ts`, `errors.ts`, `index.ts` and the new test file changed.
- The proof of `plan.md` passes: `mkdir -p /tmp/f090-s02 && bun run lint > /tmp/f090-s02/lint.log 2>&1 && bun run typecheck > /tmp/f090-s02/typecheck.log 2>&1 && bun run test:unit > /tmp/f090-s02/unit.log 2>&1 && bun run test:int > /tmp/f090-s02/int.log 2>&1 && echo PROOF_OK`
