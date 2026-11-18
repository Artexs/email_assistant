import { type LlmRole, llmRoles } from "@ea/core";
import { z } from "zod";

import { ConfigError, emptyAsUndefined } from "./config-shared";
import { type LlmProviderId, llmProviderIds, type LlmRoleSettings, type LlmRoleTable } from "./llm";
import { DEFAULT_OPENAI_BASE_URL, type LlmEndpoint, parseLlmBaseUrl } from "./llm/endpoint";

// Step 0.2 (AI Studio, free tier, 2026-11-04): classifier RPM 15 × 0.8 = 12. The RPD is not known, so the cap stays 300.
const defaultGeminiRpm = 12;
const defaultLlmDailyCap = 300;

// Accepted values of `reasoning.effort` (stage 0 note, case F).
export const openAiReasoningEfforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

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

// The env keys of the LLM providers and roles, and the triage scope. `config.ts` spreads them into the schema.
export const llmShape = {
  // The classifier's provider, and the provider of every role without LLM_<ROLE>_PROVIDER. A restart applies it.
  LLM_PROVIDER: z.preprocess(emptyAsUndefined, z.enum(llmProviderIds).default("openai")),
  GEMINI_API_KEY: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  GEMINI_MODEL_CLASSIFIER: z.preprocess((v) => (v === "" ? undefined : v), z.string().default("gemini-3.5-flash-lite")),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  GEMINI_RPM: z.coerce.number().int().positive().default(defaultGeminiRpm),
  // Secret: never print or log it.
  OPENAI_API_KEY: z.preprocess(emptyAsUndefined, z.string().optional()),
  // The key an own server gets, when it needs one. Secret: never print or log it. Empty = the fixed dummy key.
  // An own endpoint never gets OPENAI_API_KEY: that key belongs to OpenAI.
  OPENAI_OWN_API_KEY: z.preprocess(emptyAsUndefined, z.string().optional()),
  OPENAI_MODEL_CLASSIFIER: z.preprocess(emptyAsUndefined, z.string().default("gpt-6-luna")),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  OPENAI_RPM: z.coerce.number().int().positive().default(60),
  OPENAI_REASONING_EFFORT: z.preprocess(emptyAsUndefined, z.enum(openAiReasoningEfforts).default("none")),
  // The endpoint of the openai provider; platform/llm/endpoint checks it. Empty = the default.
  OPENAI_BASE_URL: z.preprocess(emptyAsUndefined, z.string().default(DEFAULT_OPENAI_BASE_URL)),
  // "own" = the URL is a server the operator runs (any host over https). The only value.
  OPENAI_ENDPOINT_KIND: z.preprocess(emptyAsUndefined, z.literal("own").optional()),
  // LLM call attempts per mailbox per America/Los_Angeles day.
  LLM_DAILY_CAP: z.coerce.number().int().positive().default(defaultLlmDailyCap),
  // off = no triage worker; synthetic = only synthetic mail; all = real mail of every active mailbox of an organization that is not suspended (S6a).
  TRIAGE_LLM_SCOPE: z.enum(["off", "synthetic", "all"]).default("off"),
  ...roleKeyShape,
};

type LlmConfig = z.infer<z.ZodObject<typeof llmShape>>;

interface ProviderBlock {
  /** Env key name, for messages: "GEMINI_API_KEY". */
  apiKeyName: string;
  apiKey: string | undefined;
  classifierModel: string;
  timeoutMs: number;
  rpm: number;
  /** null: the provider has no effort setting. */
  reasoningEffort: string | null;
  /** null: the provider has one fixed endpoint (Gemini). A function: it throws for an unchecked bad value. */
  endpoint: () => LlmEndpoint | null;
}

/** The key an own server gets when `OPENAI_OWN_API_KEY` is not set. The SDK needs some key; Ollama ignores it. */
const OWN_DUMMY_API_KEY = "own";

/** True for an own endpoint. A bad value is no endpoint: `configSchema` reports it. */
function openAiIsOwn(c: LlmConfig): boolean {
  const parsed = parseLlmBaseUrl(c.OPENAI_BASE_URL, c.OPENAI_ENDPOINT_KIND === "own");
  return !("error" in parsed) && parsed.endpoint === "own";
}

/** The endpoint of the openai provider. `configSchema` has checked the value, so an error here is a bug. */
function openAiEndpoint(c: LlmConfig): LlmEndpoint {
  const parsed = parseLlmBaseUrl(c.OPENAI_BASE_URL, c.OPENAI_ENDPOINT_KIND === "own");
  if ("error" in parsed) throw new ConfigError(["OPENAI_BASE_URL"]);
  return parsed;
}

// One block per registry row: the type forces a block for each provider.
const providerBlocks: Record<LlmProviderId, (config: LlmConfig) => ProviderBlock> = {
  gemini: (c) => ({
    apiKeyName: "GEMINI_API_KEY",
    apiKey: c.GEMINI_API_KEY,
    classifierModel: c.GEMINI_MODEL_CLASSIFIER,
    timeoutMs: c.GEMINI_TIMEOUT_MS,
    rpm: c.GEMINI_RPM,
    reasoningEffort: null,
    endpoint: () => null,
  }),
  // An own endpoint never gets the OpenAI key: the row holds the own key or the dummy, so the start needs no
  // OPENAI_API_KEY and the key can reach no other host.
  openai: (c) => ({
    apiKeyName: openAiIsOwn(c) ? "OPENAI_OWN_API_KEY" : "OPENAI_API_KEY",
    apiKey: openAiIsOwn(c) ? (c.OPENAI_OWN_API_KEY ?? OWN_DUMMY_API_KEY) : c.OPENAI_API_KEY,
    classifierModel: c.OPENAI_MODEL_CLASSIFIER,
    timeoutMs: c.OPENAI_TIMEOUT_MS,
    rpm: c.OPENAI_RPM,
    reasoningEffort: c.OPENAI_REASONING_EFFORT,
    endpoint: () => openAiEndpoint(c),
  }),
};

// The LLM checks of `configSchema`.
export function checkLlm(config: LlmConfig, ctx: z.RefinementCtx): void {
  // Always checked, also with TRIAGE_LLM_SCOPE=off: the message names the key and never holds the value.
  const endpoint = parseLlmBaseUrl(config.OPENAI_BASE_URL, config.OPENAI_ENDPOINT_KIND === "own");
  if ("error" in endpoint) {
    ctx.addIssue({ code: "custom", path: ["OPENAI_BASE_URL"], message: endpoint.error });
  }
  const block = providerBlocks[config.LLM_PROVIDER](config);
  if (config.TRIAGE_LLM_SCOPE !== "off" && block.apiKey === undefined) {
    ctx.addIssue({ code: "custom", path: [block.apiKeyName], message: "needed when TRIAGE_LLM_SCOPE is not off" });
  }
  for (const role of keyedRoles) {
    const provider = config[roleKey(role, "PROVIDER")];
    if (provider !== undefined && providerBlocks[provider](config).apiKey === undefined) {
      const keyName = providerBlocks[provider](config).apiKeyName;
      ctx.addIssue({ code: "custom", path: [keyName], message: `needed by ${roleKey(role, "PROVIDER")}` });
    }
    // A model id belongs to one provider: without its provider it would follow a later LLM_PROVIDER switch.
    if (config[roleKey(role, "MODEL")] !== undefined && provider === undefined) {
      ctx.addIssue({
        code: "custom",
        path: [roleKey(role, "PROVIDER")],
        message: `needed by ${roleKey(role, "MODEL")}`,
      });
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
}

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
export function llmRoleTable(
  config: LlmConfig,
  overrides: Partial<Record<LlmRole, LlmRoleOverride>> = {}
): LlmRoleTable {
  const providerRow = (provider: LlmProviderId) => providerBlocks[provider](config);
  // D4: an own server gets no `reasoning` field, whatever an env key or an override says.
  const noEffort = (provider: LlmProviderId) => providerRow(provider).endpoint()?.endpoint === "own";
  const finish = (row: LlmRoleSettings): LlmRoleSettings =>
    noEffort(row.provider) ? { ...row, reasoningEffort: null } : row;
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
  const classifier = finish(apply(defaults(classifierProvider), overrides.classifier));

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
    return finish(apply(row, override));
  };

  const providers = Object.fromEntries(
    llmProviderIds.map((id) => {
      const block = providerRow(id);
      const endpoint = block.endpoint();
      return [
        id,
        {
          apiKeyName: block.apiKeyName,
          apiKey: block.apiKey,
          rpm: block.rpm,
          baseUrl: endpoint?.url ?? null,
          endpoint: endpoint?.endpoint ?? "standard",
        },
      ];
    })
  ) as LlmRoleTable["providers"];

  return {
    roles: {
      classifier,
      judge: rowOf("judge"),
      drafter: rowOf("drafter"),
      extractor: rowOf("extractor"),
    },
    providers,
  };
}
