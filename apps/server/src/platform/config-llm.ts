import { type LlmRole, llmRoleModels, llmRoles, providerEffort, SIM_STACK_NAME, tierModel } from "@ea/core";
import { z } from "zod";

import { ConfigError, emptyAsUndefined } from "./config-shared";
import { type LlmProviderId, llmProviderIds, llmProviders, type LlmRoleSettings, type LlmRoleTable } from "./llm";
import { DEFAULT_OPENAI_BASE_URL, type LlmEndpoint, parseLlmBaseUrl } from "./llm/endpoint";
import { DEEPSEEK_BASE_URL } from "./llm/providers/deepseek";

// The RPD of the Gemini free tier is not known, so the cap stays 300.
const defaultLlmDailyCap = 300;

// The roles with their own env keys. The classifier keeps the provider keys (LLM_PROVIDER, <P>_TIMEOUT_MS).
type KeyedRole = Exclude<LlmRole, "classifier">;
const keyedRoles = llmRoles.filter((role): role is KeyedRole => role !== "classifier");

// The per-role keys that stay: they pick no model. Empty = not set.
const roleKeyFields = {
  TIMEOUT_MS: z.preprocess(emptyAsUndefined, z.coerce.number().int().positive().optional()),
  RPM: z.preprocess(emptyAsUndefined, z.coerce.number().int().positive().optional()),
};
type RoleKeyField = keyof typeof roleKeyFields;
type RoleKey<R extends KeyedRole = KeyedRole, F extends RoleKeyField = RoleKeyField> = `LLM_${Uppercase<R>}_${F}`;

/** `LLM_JUDGE_RPM` for ("judge", "RPM"). */
function roleKey<R extends KeyedRole, F extends RoleKeyField>(role: R, field: F): RoleKey<R, F> {
  return `LLM_${role.toUpperCase()}_${field}` as RoleKey<R, F>;
}

// Optional per-role keys: LLM_<ROLE>_TIMEOUT_MS and LLM_<ROLE>_RPM.
const roleKeyShape = Object.fromEntries(
  keyedRoles.flatMap((role) =>
    (Object.keys(roleKeyFields) as RoleKeyField[]).map((field) => [roleKey(role, field), roleKeyFields[field]])
  )
) as { [K in RoleKey]: (typeof roleKeyFields)[K extends `LLM_${string}_${infer F extends RoleKeyField}` ? F : never] };

// The keys that older releases read for a role's provider, model or effort. The tiers of LLM_PROVIDER decide now.
const removedRoleFields = ["PROVIDER", "MODEL", "REASONING"] as const;
export const removedEnvKeys: readonly string[] = [
  ...llmProviderIds.flatMap((id) => llmProviders[id].removedEnvKeys),
  ...keyedRoles.flatMap((role) =>
    removedRoleFields.map((field) => `LLM_${role.toUpperCase()}_${field}`)
  ),
];

// The removed keys stay in the schema as optional strings so Zod does not drop them: `checkRemovedKeys` refuses a
// non-empty value. An empty value passes.
const removedKeyShape = Object.fromEntries(removedEnvKeys.map((key) => [key, z.string().optional()])) as Record<
  string,
  z.ZodOptional<z.ZodString>
>;

const apiKeyField = () => z.preprocess(emptyAsUndefined, z.string().optional());
const positiveIntField = (fallback: number) => z.coerce.number().int().positive().default(fallback);

type Prefix<P extends LlmProviderId> = (typeof llmProviders)[P]["envPrefix"];
type ProviderEnvShape = {
  [P in LlmProviderId as `${Prefix<P>}_API_KEY`]: ReturnType<typeof apiKeyField>;
} & {
  [P in LlmProviderId as `${Prefix<P>}_TIMEOUT_MS` | `${Prefix<P>}_RPM`]: ReturnType<typeof positiveIntField>;
};

// The key, timeout and rate of every registry row: the names come from the row prefix, the defaults from the row.
const providerEnvShape = Object.fromEntries(
  llmProviderIds.flatMap((id) => {
    const { envPrefix, defaults } = llmProviders[id];
    return [
      [`${envPrefix}_API_KEY`, apiKeyField()],
      [`${envPrefix}_TIMEOUT_MS`, positiveIntField(defaults.timeoutMs)],
      [`${envPrefix}_RPM`, positiveIntField(defaults.rpm)],
    ];
  })
) as ProviderEnvShape;

// The env keys of the LLM providers and roles, and the triage scope. `config.ts` spreads them into the schema.
export const llmShape = {
  // The provider of every role: its tiers pick the models. A restart applies it.
  LLM_PROVIDER: z.preprocess(emptyAsUndefined, z.enum(llmProviderIds).default("openai")),
  // `<P>_API_KEY`, `<P>_TIMEOUT_MS` and `<P>_RPM` of every registry row (secret: never print or log a key).
  ...providerEnvShape,
  // The key an own server gets, when it needs one. Secret: never print or log it. Empty = the fixed dummy key.
  // An own endpoint never gets OPENAI_API_KEY: that key belongs to OpenAI.
  OPENAI_OWN_API_KEY: z.preprocess(emptyAsUndefined, z.string().optional()),
  // The one model of an own endpoint: every role on openai uses it. Read only when the endpoint is own. Empty = not set.
  OPENAI_OWN_MODEL: z.preprocess(emptyAsUndefined, z.string().optional()),
  // The endpoint of the openai provider; platform/llm/endpoint checks it. Empty = the default.
  OPENAI_BASE_URL: z.preprocess(emptyAsUndefined, z.string().default(DEFAULT_OPENAI_BASE_URL)),
  // "own" = the URL is a server the operator runs (any host over https). The only value.
  OPENAI_ENDPOINT_KIND: z.preprocess(emptyAsUndefined, z.literal("own").optional()),
  // The name of this stack. Only the live lab (`SIM_STACK_NAME`, generated mail only) may send mail to a provider
  // without a sub-processor row. Empty = not set.
  LAB_STACK: z.preprocess(emptyAsUndefined, z.string().optional()),
  // LLM call attempts per mailbox per America/Los_Angeles day.
  LLM_DAILY_CAP: z.coerce.number().int().positive().default(defaultLlmDailyCap),
  // off = no triage worker; synthetic = only synthetic mail; all = real mail of every active mailbox of an organization that is not suspended.
  TRIAGE_LLM_SCOPE: z.enum(["off", "synthetic", "all"]).default("off"),
  ...roleKeyShape,
  // Removed keys (`removedEnvKeys`): optional strings, refused when not empty.
  ...removedKeyShape,
};

type LlmConfig = z.infer<z.ZodObject<typeof llmShape>>;

interface ProviderBlock {
  /** Env key name, for messages: "GEMINI_API_KEY". */
  apiKeyName: string;
  apiKey: string | undefined;
  timeoutMs: number;
  rpm: number;
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

/** The key, timeout and rate of one row, read through its prefix. */
function rowEnv(c: LlmConfig, id: LlmProviderId) {
  const prefix = llmProviders[id].envPrefix;
  return {
    apiKeyName: `${prefix}_API_KEY`,
    apiKey: c[`${prefix}_API_KEY`],
    timeoutMs: c[`${prefix}_TIMEOUT_MS`],
    rpm: c[`${prefix}_RPM`],
  };
}

// One block per registry row: the type forces a block for each provider.
const providerBlocks: Record<LlmProviderId, (config: LlmConfig) => ProviderBlock> = {
  gemini: (c) => ({ ...rowEnv(c, "gemini"), endpoint: () => null }),
  // An own endpoint never gets the OpenAI key: the row holds the own key or the dummy, so the start needs no
  // OPENAI_API_KEY and the key can reach no other host.
  openai: (c) => ({
    ...rowEnv(c, "openai"),
    apiKeyName: openAiIsOwn(c) ? "OPENAI_OWN_API_KEY" : "OPENAI_API_KEY",
    apiKey: openAiIsOwn(c) ? (c.OPENAI_OWN_API_KEY ?? OWN_DUMMY_API_KEY) : c.OPENAI_API_KEY,
    endpoint: () => openAiEndpoint(c),
  }),
  // The host is fixed and the key is its own: no OpenAI value reaches it.
  deepseek: (c) => ({
    ...rowEnv(c, "deepseek"),
    endpoint: () => ({ url: DEEPSEEK_BASE_URL, host: new URL(DEEPSEEK_BASE_URL).hostname, endpoint: "standard" }),
  }),
};

const REMOVED_KEY_MESSAGE = "removed: every role uses the tiers of LLM_PROVIDER (F141); delete this line";

// An old `.env` must not change a model by accident: a removed key with a value stops config, also when the value
// equals the new one. The message names the key and never holds the value.
function checkRemovedKeys(config: LlmConfig, ctx: z.RefinementCtx): void {
  const values: Record<string, unknown> = config;
  for (const key of removedEnvKeys) {
    const value = values[key];
    if (typeof value === "string" && value !== "") {
      ctx.addIssue({ code: "custom", path: [key], message: REMOVED_KEY_MESSAGE });
    }
  }
}

// Real mail goes only to a provider with a sub-processor row. A provider without one (`realMail: false`) may get
// `TRIAGE_LLM_SCOPE=all` only on the live lab stack, which holds generated mail. The message names the key, never a value.
function checkRealMail(config: LlmConfig, ctx: z.RefinementCtx): void {
  if (config.TRIAGE_LLM_SCOPE !== "all" || config.LAB_STACK === SIM_STACK_NAME) return;
  if (llmProviders[config.LLM_PROVIDER].realMail) return;
  ctx.addIssue({
    code: "custom",
    path: ["LLM_PROVIDER"],
    message: `${config.LLM_PROVIDER} is for dev, tests and evals: no sub-processor row, so TRIAGE_LLM_SCOPE=all is refused outside the sim stack`,
  });
}

// The LLM checks of `configSchema`.
export function checkLlm(config: LlmConfig, ctx: z.RefinementCtx): void {
  checkRemovedKeys(config, ctx);
  // Always checked, also with TRIAGE_LLM_SCOPE=off: the message names the key and never holds the value.
  const endpoint = parseLlmBaseUrl(config.OPENAI_BASE_URL, config.OPENAI_ENDPOINT_KIND === "own");
  if ("error" in endpoint) {
    ctx.addIssue({ code: "custom", path: ["OPENAI_BASE_URL"], message: endpoint.error });
  }
  if (config.LLM_PROVIDER === "openai" && openAiIsOwn(config) && config.OPENAI_OWN_MODEL === undefined) {
    ctx.addIssue({ code: "custom", path: ["OPENAI_OWN_MODEL"], message: "needed for an own endpoint" });
  }
  checkRealMail(config, ctx);
  const block = providerBlocks[config.LLM_PROVIDER](config);
  if (config.TRIAGE_LLM_SCOPE !== "off" && block.apiKey === undefined) {
    ctx.addIssue({ code: "custom", path: [block.apiKeyName], message: "needed when TRIAGE_LLM_SCOPE is not off" });
  }
}

/** A tool's change of one role row (eval and llm:check flags). */
export interface LlmRoleOverride {
  provider?: LlmProviderId;
  model?: string;
  reasoningEffort?: string;
}

/**
 * The role table. Every role runs on LLM_PROVIDER, or on the provider a tool override names. The model is the override
 * model, else the one model of an own endpoint (`OPENAI_OWN_MODEL`), else the provider's model for the role's tier. The
 * effort is the override effort, else the role's level as the provider takes it (an own endpoint gets none).
 * `LLM_<ROLE>_TIMEOUT_MS` and `LLM_<ROLE>_RPM` apply to the role wherever it runs.
 */
export function llmRoleTable(
  config: LlmConfig,
  overrides: Partial<Record<LlmRole, LlmRoleOverride>> = {}
): LlmRoleTable {
  const providerRow = (provider: LlmProviderId) => providerBlocks[provider](config);
  const isOwn = (provider: LlmProviderId) => providerRow(provider).endpoint()?.endpoint === "own";
  // The one model of an own endpoint. A missing key is a config error, also for a tool override that moves a role there.
  const ownModel = (): string => {
    if (config.OPENAI_OWN_MODEL === undefined) throw new ConfigError(["OPENAI_OWN_MODEL"]);
    return config.OPENAI_OWN_MODEL;
  };
  const rowOf = (role: LlmRole): LlmRoleSettings => {
    const override = overrides[role];
    const provider = override?.provider ?? config.LLM_PROVIDER;
    const { tier, effort } = llmRoleModels[role];
    if (override?.reasoningEffort !== undefined && providerEffort(provider, "none") === null) {
      throw new ConfigError(["reasoningEffort"]);
    }
    const own = isOwn(provider);
    // An own server gets no `reasoning` field, whatever an override says.
    const reasoningEffort = own ? null : (override?.reasoningEffort ?? providerEffort(provider, effort));
    const keyed = role === "classifier" ? undefined : role;
    const roleTimeout = keyed === undefined ? undefined : config[roleKey(keyed, "TIMEOUT_MS")];
    const roleRpm = keyed === undefined ? undefined : config[roleKey(keyed, "RPM")];
    return {
      provider,
      model: override?.model ?? (own ? ownModel() : tierModel(provider, tier)),
      timeoutMs: roleTimeout ?? providerRow(provider).timeoutMs,
      rpm: roleRpm ?? null,
      reasoningEffort,
    };
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
      classifier: rowOf("classifier"),
      judge: rowOf("judge"),
      drafter: rowOf("drafter"),
      extractor: rowOf("extractor"),
    },
    providers,
  };
}
