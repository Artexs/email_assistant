import { type LlmRole, llmRoleModels, llmRoles, providerEffort, SIM_STACK_NAME, tierModel } from "@ea/core";
import { z } from "zod";

import { ConfigError, emptyAsUndefined } from "./config-shared";
import {
  type LlmProviderId,
  defaultLlmProviderId,
  llmProviderIds,
  llmProviders,
  type LlmProviderSettings,
  type LlmRowSettings,
  type LlmRoleSettings,
  type LlmRoleTable,
} from "./llm";

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
  ...keyedRoles.flatMap((role) => removedRoleFields.map((field) => `LLM_${role.toUpperCase()}_${field}`)),
];

/** True for a key of `removedEnvKeys`: the start log marks it so the operator knows to delete the line. */
export function isRemovedEnvKey(key: string): boolean {
  return removedEnvKeys.includes(key);
}

// The removed keys stay in the schema as optional strings so Zod does not drop them: `checkRemovedKeys` refuses a
// non-empty value. An empty value passes.
const removedKeyShape = Object.fromEntries(removedEnvKeys.map((key) => [key, z.string().optional()])) as Record<
  string,
  z.ZodOptional<z.ZodString>
>;

const apiKeyField = () => z.preprocess(emptyAsUndefined, z.string().optional());
const positiveIntField = (fallback: number) => z.coerce.number().int().positive().default(fallback);

type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;
type RowEnvShape = UnionToIntersection<(typeof llmProviders)[LlmProviderId]["envShape"]>;

// The extra keys of every registry row (an endpoint, an own server): the rows own their names and their rules.
const rowEnvShape = Object.assign({}, ...llmProviderIds.map((id) => llmProviders[id].envShape)) as RowEnvShape;

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
  LLM_PROVIDER: z.preprocess(emptyAsUndefined, z.enum(llmProviderIds).default(defaultLlmProviderId)),
  // `<P>_API_KEY`, `<P>_TIMEOUT_MS` and `<P>_RPM` of every registry row (secret: never print or log a key).
  ...providerEnvShape,
  // The extra keys of the rows (an own endpoint and its model, the base URL): see `envShape` of a row.
  ...rowEnvShape,
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

/** The settings of one row; null when its endpoint value is bad (`check` of the row reports it). */
function rowSettings(config: LlmConfig, id: LlmProviderId): LlmRowSettings | null {
  try {
    return llmProviders[id].settings(config);
  } catch (error) {
    if (error instanceof ConfigError) return null;
    throw error;
  }
}

const REMOVED_KEY_MESSAGE = "removed: every role uses the tiers of LLM_PROVIDER; delete this line";

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
  // Always checked, also with TRIAGE_LLM_SCOPE=off: each row checks its own keys.
  for (const id of llmProviderIds) llmProviders[id].check(config, ctx);
  checkRealMail(config, ctx);
  // A bad endpoint value is reported by the row check; the key rule then has nothing to read.
  const block = rowSettings(config, config.LLM_PROVIDER);
  if (block !== null && config.TRIAGE_LLM_SCOPE !== "off" && block.apiKey === undefined) {
    ctx.addIssue({ code: "custom", path: [block.apiKeyName], message: "needed when TRIAGE_LLM_SCOPE is not off" });
  }
}

/** A tool's change of one role row (eval and llm:check flags). */
export interface LlmRoleOverride {
  provider?: LlmProviderId;
  model?: string;
  reasoningEffort?: string;
}

/** The provider, model and effort flags of one eval or check run. */
export interface LlmRunFlags {
  provider?: LlmProviderId;
  model?: string;
  reasoningEffort?: string;
  judgeProvider?: LlmProviderId;
  judgeModel?: string;
}

/**
 * The role overrides of one run (the eval and `llm:check` flags). `--provider` moves every role, the judge too;
 * `--judge-provider` then moves only the judge. `--model` and `--reasoning-effort` pin the judged role; `--judge-model`
 * pins the judge. Without a flag a role keeps the tier of its provider.
 */
export function runOverrides(judged: LlmRole, flags: LlmRunFlags): Record<LlmRole, LlmRoleOverride> {
  const roles = Object.fromEntries(llmRoles.map((role) => [role, { provider: flags.provider }])) as Record<
    LlmRole,
    LlmRoleOverride
  >;
  roles[judged] = { ...roles[judged], model: flags.model, reasoningEffort: flags.reasoningEffort };
  if (judged !== "judge") {
    roles.judge = { provider: flags.judgeProvider ?? flags.provider, model: flags.judgeModel };
  }
  return roles;
}

/** The operator text of a `ConfigError` that `llmRoleTable` throws for a run flag. Names a flag or a key, never a value. */
export function runFlagError(error: ConfigError): string {
  if (error.keys.includes("reasoningEffort")) return "--reasoning-effort is not accepted by this provider";
  const ownModelKey = llmProviderIds
    .map((id) => llmProviders[id].ownModelKey)
    .find((key) => error.keys.includes(key ?? ""));
  if (ownModelKey) return `${ownModelKey} is missing: an own endpoint needs its model`;
  return `config error: ${error.keys.join(", ")}`;
}

/**
 * The role table. Every role runs on LLM_PROVIDER, or on the provider a tool override names. The model is the override
 * model, else the one model of an own endpoint (`ownModelKey` of the row), else the provider's model for the role's tier. The
 * effort is the override effort, else the role's level as the provider takes it (an own endpoint gets none).
 * `LLM_<ROLE>_TIMEOUT_MS` and `LLM_<ROLE>_RPM` apply to the role wherever it runs.
 */
export function llmRoleTable(
  config: LlmConfig,
  overrides: Partial<Record<LlmRole, LlmRoleOverride>> = {}
): LlmRoleTable {
  const providerRow = (provider: LlmProviderId) => llmProviders[provider].settings(config);
  // The one model of an own endpoint. A missing key is a config error, also for a tool override that moves a role there.
  const ownModel = (provider: LlmProviderId, settings: LlmRowSettings): string => {
    if (settings.ownModel === null) throw new ConfigError([llmProviders[provider].ownModelKey ?? "ownModel"]);
    return settings.ownModel;
  };
  const rowOf = (role: LlmRole): LlmRoleSettings => {
    const override = overrides[role];
    const provider = override?.provider ?? config.LLM_PROVIDER;
    const { tier, effort } = llmRoleModels[role];
    if (override?.reasoningEffort !== undefined && providerEffort(provider, "none") === null) {
      throw new ConfigError(["reasoningEffort"]);
    }
    const settings = providerRow(provider);
    const own = settings.endpoint === "own";
    // An own server gets no `reasoning` field, whatever an override says.
    const reasoningEffort = own ? null : (override?.reasoningEffort ?? providerEffort(provider, effort));
    const keyed = role === "classifier" ? undefined : role;
    const roleTimeout = keyed === undefined ? undefined : config[roleKey(keyed, "TIMEOUT_MS")];
    const roleRpm = keyed === undefined ? undefined : config[roleKey(keyed, "RPM")];
    return {
      provider,
      model: override?.model ?? (own ? ownModel(provider, settings) : tierModel(provider, tier)),
      timeoutMs: roleTimeout ?? settings.timeoutMs,
      rpm: roleRpm ?? null,
      reasoningEffort,
    };
  };

  const providers = Object.fromEntries(
    llmProviderIds.map((id) => {
      const { apiKeyName, apiKey, rpm, baseUrl, endpoint } = providerRow(id);
      return [id, { apiKeyName, apiKey, rpm, baseUrl, endpoint } satisfies LlmProviderSettings];
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
