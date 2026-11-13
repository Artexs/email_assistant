# F090 stage 01 — Role names and the role table

Part of [`../plan.md`](../plan.md). Normal stage. No caller changes: the old `llmSettings` and the old client stay as they are.

After this stage, `llmRoleTable(config)` returns one row per role and one row per provider, and `loadConfig` reads and checks the 20 role keys. Nothing calls the table yet (stage 2 builds the client on it).

## Step 1 — Role names in core

**Goal.** One list of role names that core, the server and the tests share (D1), and the prompt version type (D14).

**Files.** New `packages/core/src/llm-roles.ts`, new `packages/core/src/llm-roles.test.ts`; `packages/core/src/index.ts` (one line: `export * from "./llm-roles";`, after the last export).

**Interfaces.** Write the file as it is here (probe P1):

```ts
// The LLM roles. Every LLM call names one; the role table in the server config decides its provider and model.
// Rules: docs/code-patterns.md § Side effects ("An LLM call names a role").
export const llmRoles = ["classifier", "judge", "drafter", "extractor", "escalation"] as const;

export type LlmRole = (typeof llmRoles)[number];

/** A prompt version starts with its role: `classifier-v2`. */
export type PromptVersion<R extends LlmRole = LlmRole> = `${R}-v${number}`;

export function isLlmRole(value: string): value is LlmRole {
  return (llmRoles as readonly string[]).includes(value);
}
```

**Decisions.** D1, D14.

**Test** (`llm-roles.test.ts`):

1. `llmRoles` equals `["classifier", "judge", "drafter", "extractor", "escalation"]`.
2. `isLlmRole`: `"judge"` → true; `"writer"`, `"toString"`, `""` → false.
3. Type check: `const ok: PromptVersion<"classifier"> = "classifier-v2"` compiles; `const wrong: PromptVersion<"classifier"> = "judge-v1"` has a `// @ts-expect-error` line above it (typecheck fails if the error goes away). The test body asserts `[ok, wrong]` has length 2 so both constants are used.

**Check.** `bun test packages/core/src/llm-roles.test.ts`

**Done when.** The three cases pass and `bun run typecheck` passes.

**Out of scope.** Any use of the roles in the server (steps 2–3).

## Step 2 — Table types in `platform/llm`

**Goal.** The client (stage 2) and the config share the table types without the client importing the config (D8).

**Files.** New `apps/server/src/platform/llm/settings.ts`; `apps/server/src/platform/llm/index.ts` (two export lines).

**Interfaces.** Write the file as it is here:

```ts
import type { LlmRole } from "@ea/core";

import type { LlmProviderId } from "./providers";

/** One row of the role table: where the calls of one role go. */
export interface LlmRoleSettings {
  provider: LlmProviderId;
  model: string;
  timeoutMs: number;
  /** The role's own calls per minute; null: only the provider limit applies. */
  rpm: number | null;
  /** null: no effort setting is sent (Gemini, or OpenAI without one). */
  reasoningEffort: string | null;
}

export interface LlmProviderSettings {
  /** Env key name, for messages: "GEMINI_API_KEY". */
  apiKeyName: string;
  /** Secret: never print or log it. */
  apiKey: string | undefined;
  /** Calls per minute of all roles on this provider, in this process. */
  rpm: number;
}

export interface LlmRoleTable {
  roles: Record<LlmRole, LlmRoleSettings>;
  providers: Record<LlmProviderId, LlmProviderSettings>;
}

/** Tests and one-provider tools: every role gets the same row; both provider rows are the same. */
export function uniformRoleTable(row: LlmRoleSettings, provider: LlmProviderSettings): LlmRoleTable {
  return {
    roles: { classifier: row, judge: row, drafter: row, extractor: row, escalation: row },
    providers: { gemini: provider, openai: provider },
  };
}
```

Add to `platform/llm/index.ts`:

```ts
export type { LlmProviderSettings, LlmRoleSettings, LlmRoleTable } from "./settings";
export { uniformRoleTable } from "./settings";
```

**Decisions.** D8. The object literal in `uniformRoleTable` lists every role on purpose: a new role in `llmRoles` makes typecheck fail here until it gets a row.

**Test.** Covered by step 3 (types) and stage 2 (uses).

**Check.** `bun run typecheck`

**Done when.** Typecheck passes.

**Out of scope.** The client (stage 2).

## Step 3 — Role keys, start checks and `llmRoleTable` in `platform/config.ts`

**Goal.** `loadConfig` reads `LLM_<ROLE>_PROVIDER`, `_MODEL`, `_TIMEOUT_MS`, `_RPM`, `_REASONING` for the four roles other than the classifier (D2, D9), refuses bad settings at start (D11), and `llmRoleTable(config, overrides?)` resolves the table with the fallback rule (D10).

**Files.** `apps/server/src/platform/config.ts`; new `apps/server/src/platform/config-roles.test.ts`. Do not change `config.test.ts` in this stage.

**Interfaces.** The code below passed probe P1. Keep the names.

Imports at the top of `config.ts`:

```ts
import { type LlmRole, llmRoles } from "@ea/core";
import { z } from "zod";

import { type LlmProviderId, llmProviderIds, type LlmRoleSettings, type LlmRoleTable } from "./llm";
```

After `const emptyAsUndefined = …`:

```ts
// The roles with their own env keys. The classifier keeps the provider keys (LLM_PROVIDER, *_MODEL_CLASSIFIER).
type KeyedRole = Exclude<LlmRole, "classifier">;
const keyedRoles = llmRoles.filter((role): role is KeyedRole => role !== "classifier");

const roleKeyFields = {
  PROVIDER: z.preprocess(emptyAsUndefined, z.enum(llmProviderIds).optional()),
  MODEL: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
  TIMEOUT_MS: z.preprocess(emptyAsUndefined, z.coerce.number().int().positive().optional()),
  RPM: z.preprocess(emptyAsUndefined, z.coerce.number().int().positive().optional()),
  REASONING: z.preprocess(emptyAsUndefined, z.enum(openAiReasoningEfforts).optional()),
};
type RoleKeyField = keyof typeof roleKeyFields;
type RoleKey<R extends KeyedRole = KeyedRole, F extends RoleKeyField = RoleKeyField> = `LLM_${Uppercase<R>}_${F}`;

/** `LLM_JUDGE_MODEL` for ("judge", "MODEL"). */
function roleKey<R extends KeyedRole, F extends RoleKeyField>(role: R, field: F): RoleKey<R, F> {
  return `LLM_${role.toUpperCase()}_${field}` as RoleKey<R, F>;
}

// Optional per-role keys: LLM_<ROLE>_PROVIDER, _MODEL, _TIMEOUT_MS, _RPM, _REASONING. Empty = not set.
const roleKeyShape = Object.fromEntries(
  keyedRoles.flatMap((role) =>
    (Object.keys(roleKeyFields) as RoleKeyField[]).map((field) => [roleKey(role, field), roleKeyFields[field]])
  )
) as { [K in RoleKey]: (typeof roleKeyFields)[K extends `LLM_${string}_${infer F extends RoleKeyField}` ? F : never] };
```

`openAiReasoningEfforts` is declared above `emptyAsUndefined` today; keep that order. Add `...roleKeyShape,` as the last entry of `baseSchema`'s object. Change the comment above `LLM_PROVIDER` to: `// The classifier's provider, and the provider of every role without LLM_<ROLE>_PROVIDER. A restart applies it.`

In `configSchema.superRefine`, after the existing `TRIAGE_LLM_SCOPE` key check:

```ts
  for (const role of keyedRoles) {
    const provider = config[roleKey(role, "PROVIDER")];
    if (provider !== undefined && providerBlocks[provider](config).apiKey === undefined) {
      const keyName = providerBlocks[provider](config).apiKeyName;
      ctx.addIssue({ code: "custom", path: [keyName], message: `needed by ${roleKey(role, "PROVIDER")}` });
    }
    const effective = provider ?? config.LLM_PROVIDER;
    if (
      config[roleKey(role, "REASONING")] !== undefined &&
      providerBlocks[effective](config).reasoningEffort === null
    ) {
      ctx.addIssue({
        code: "custom",
        path: [roleKey(role, "REASONING")],
        message: `${effective} takes no reasoning effort`,
      });
    }
  }
```

After `llmSettings` (leave `llmSettings`, `LlmSettings` and `classifierModel` unchanged; stage 5 removes them):

```ts
/** A tool's change of one role row (eval and llm:check flags). */
export interface LlmRoleOverride {
  provider?: LlmProviderId;
  model?: string;
  reasoningEffort?: string;
}

/**
 * The role table. The classifier row comes from LLM_PROVIDER and that provider's keys. Another role reads its
 * LLM_<ROLE>_* keys; a missing key takes the classifier row's value when the role uses the classifier's provider,
 * else the value of the role's provider keys. An override that changes a role's provider drops that role's env keys.
 */
export function llmRoleTable(config: Config, overrides: Partial<Record<LlmRole, LlmRoleOverride>> = {}): LlmRoleTable {
  const providerRow = (provider: LlmProviderId) => providerBlocks[provider](config);
  const defaults = (provider: LlmProviderId): LlmRoleSettings => {
    const block = providerRow(provider);
    return {
      provider,
      model: block.classifierModel,
      timeoutMs: block.timeoutMs,
      rpm: null,
      reasoningEffort: block.reasoningEffort,
    };
  };
  const apply = (row: LlmRoleSettings, override: LlmRoleOverride | undefined): LlmRoleSettings => {
    if (override === undefined) return row;
    if (override.reasoningEffort !== undefined && providerRow(row.provider).reasoningEffort === null) {
      throw new ConfigError(["reasoningEffort"]);
    }
    return {
      ...row,
      ...(override.model === undefined ? {} : { model: override.model }),
      ...(override.reasoningEffort === undefined ? {} : { reasoningEffort: override.reasoningEffort }),
    };
  };

  const classifierProvider = overrides.classifier?.provider ?? config.LLM_PROVIDER;
  const classifier = apply(defaults(classifierProvider), overrides.classifier);

  const rowOf = (role: KeyedRole): LlmRoleSettings => {
    const override = overrides[role];
    const envKeys = override?.provider === undefined;
    const provider = override?.provider ?? config[roleKey(role, "PROVIDER")] ?? classifier.provider;
    const base = provider === classifier.provider ? classifier : defaults(provider);
    const row: LlmRoleSettings = envKeys
      ? {
          provider,
          model: config[roleKey(role, "MODEL")] ?? base.model,
          timeoutMs: config[roleKey(role, "TIMEOUT_MS")] ?? base.timeoutMs,
          rpm: config[roleKey(role, "RPM")] ?? null,
          reasoningEffort: config[roleKey(role, "REASONING")] ?? base.reasoningEffort,
        }
      : { ...base, rpm: null };
    return apply(row, override);
  };

  const providers = Object.fromEntries(
    llmProviderIds.map((id) => {
      const block = providerRow(id);
      return [id, { apiKeyName: block.apiKeyName, apiKey: block.apiKey, rpm: block.rpm }];
    })
  ) as LlmRoleTable["providers"];

  return {
    roles: {
      classifier,
      judge: rowOf("judge"),
      drafter: rowOf("drafter"),
      extractor: rowOf("extractor"),
      escalation: rowOf("escalation"),
    },
    providers,
  };
}
```

`ConfigError` is declared lower in the file; it is used only at call time, so the order is fine (probe P1).

**Decisions.** D2, D8, D9, D10, D11. `writerModel` is not part of the table (D25).

**Test** (`config-roles.test.ts`; `fullEnv` = `DATABASE_URL` + a random 32-byte base64 `CREDENTIALS_KEY`, copied from `config.test.ts`; `openaiEnv` = `fullEnv` + `LLM_PROVIDER: "openai"`, `OPENAI_API_KEY: "o-key"`; `keysOf(env)` returns the `ConfigError.keys` that `loadConfig(env)` throws, and fails the test when it does not throw):

1. For three envs — `openaiEnv`; `openaiEnv` + `OPENAI_REASONING_EFFORT: "low"`, `OPENAI_TIMEOUT_MS: "20000"`, `OPENAI_RPM: "30"`, `OPENAI_MODEL_CLASSIFIER: "m-1"`; `fullEnv` + `LLM_PROVIDER: "gemini"`, `GEMINI_API_KEY: "g-key"`, `GEMINI_MODEL_CLASSIFIER: "g-1"`, `GEMINI_RPM: "7"` — with `old = llmSettings(config)`: `table.roles.classifier` equals `{ provider: old.provider, model: old.classifierModel, timeoutMs: old.timeoutMs, rpm: null, reasoningEffort: old.reasoningEffort }` and `table.providers[old.provider]` equals `{ apiKeyName: old.apiKeyName, apiKey: old.apiKey, rpm: old.rpm }`. (Acceptance 1: the classifier row is today's setting.)
2. `openaiEnv`, no role keys: every role in `llmRoles` has a row equal to the classifier row.
3. `openaiEnv` + `GEMINI_API_KEY: "g-key"`, `LLM_JUDGE_PROVIDER: "gemini"`, `GEMINI_TIMEOUT_MS: "15000"`: judge = `{ provider: "gemini", model: "gemini-3.5-flash-lite", timeoutMs: 15000, rpm: null, reasoningEffort: null }`; drafter's provider is `openai`.
4. `openaiEnv` + `LLM_DRAFTER_MODEL: "gpt-x"`, `LLM_DRAFTER_TIMEOUT_MS: "60000"`, `LLM_DRAFTER_RPM: "10"`, `LLM_DRAFTER_REASONING: "medium"`: drafter = `{ provider: "openai", model: "gpt-x", timeoutMs: 60000, rpm: 10, reasoningEffort: "medium" }`; classifier model stays `gpt-6-luna`.
5. `openaiEnv` + `LLM_JUDGE_PROVIDER: ""`, `LLM_JUDGE_MODEL: ""`, `LLM_JUDGE_RPM: ""`: judge equals the classifier row.
6. `keysOf(openaiEnv + LLM_JUDGE_PROVIDER: "gemini")` equals `["GEMINI_API_KEY"]` (no Gemini key).
7. `keysOf(openaiEnv + GEMINI_API_KEY: "g", LLM_JUDGE_PROVIDER: "gemini", LLM_JUDGE_REASONING: "low")` equals `["LLM_JUDGE_REASONING"]`; `keysOf(fullEnv + LLM_PROVIDER: "gemini", LLM_EXTRACTOR_REASONING: "low")` equals `["LLM_EXTRACTOR_REASONING"]`.
8. Bad values, each alone on `openaiEnv`: `LLM_JUDGE_PROVIDER: "vertex"` → `["LLM_JUDGE_PROVIDER"]`; `LLM_JUDGE_RPM: "0"` → `["LLM_JUDGE_RPM"]`; `LLM_DRAFTER_TIMEOUT_MS: "x"` → `["LLM_DRAFTER_TIMEOUT_MS"]`; `LLM_DRAFTER_REASONING: "huge"` → `["LLM_DRAFTER_REASONING"]`.
9. Overrides on `openaiEnv` + `GEMINI_API_KEY: "g-key"`, `LLM_JUDGE_MODEL: "gpt-judge"`, with `{ classifier: { provider: "gemini", model: "g-2" }, judge: { provider: "openai" } }`: classifier = `{ provider: "gemini", model: "g-2", timeoutMs: 30000, rpm: null, reasoningEffort: null }`; judge = `{ provider: "openai", model: "gpt-6-luna", timeoutMs: 30000, rpm: null, reasoningEffort: "none" }` (the provider override drops `LLM_JUDGE_MODEL`); drafter's provider is `gemini` (it follows the classifier). `llmRoleTable(config, { classifier: { provider: "gemini", reasoningEffort: "low" } })` throws `ConfigError`.

**Check.** `bun test apps/server/src/platform/config-roles.test.ts apps/server/src/platform/config.test.ts && bun run typecheck && bunx eslint apps/server/src/platform packages/core/src`

**Done when.** The nine cases pass; `config.test.ts` passes unchanged.

**Out of scope.** Any caller of `llmRoleTable` (stage 3). Removing `llmSettings` (stage 5).

## Step 4 — `.env.example`

**Goal.** Every config key is in `.env.example` (styleguide).

**Files.** `.env.example`.

**Interfaces.** After the `OPENAI_REASONING_EFFORT` line, add this block (all values empty):

```
# LLM roles other than the classifier (judge, drafter, extractor, escalation). Each key is optional; empty = the
# classifier's value when the role uses the classifier's provider, else the role provider's own keys.
# LLM_<ROLE>_PROVIDER needs that provider's API key. LLM_<ROLE>_REASONING only for openai. LLM_<ROLE>_RPM empty = no own limit.
LLM_JUDGE_PROVIDER=
LLM_JUDGE_MODEL=
LLM_JUDGE_TIMEOUT_MS=
LLM_JUDGE_RPM=
LLM_JUDGE_REASONING=
```

and the same five lines for `DRAFTER`, `EXTRACTOR`, `ESCALATION`. Change the first comment line of the file to: `# The classifier's LLM provider (gemini | openai), also used by every role without LLM_<ROLE>_PROVIDER. Empty = openai. A restart applies a change.`

**Decisions.** D2, D9.

**Test.** Case 5 of step 3 shows that the empty values load.

**Check.** `grep -c "^LLM_\(JUDGE\|DRAFTER\|EXTRACTOR\|ESCALATION\)_" .env.example` prints `20`.

**Done when.** The grep prints 20.

**Out of scope.** The writer keys `GEMINI_MODEL`, `OPENAI_MODEL` (stage 5).

## Stage done when

- Steps 1–4 are done; no file outside this stage's list changed (`git diff --stat` against the stage base).
- The proof of `plan.md` passes: `mkdir -p /tmp/f090-s01 && bun run lint > /tmp/f090-s01/lint.log 2>&1 && bun run typecheck > /tmp/f090-s01/typecheck.log 2>&1 && bun run test:unit > /tmp/f090-s01/unit.log 2>&1 && bun run test:int > /tmp/f090-s01/int.log 2>&1 && echo PROOF_OK`
