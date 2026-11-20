import { type FeatureKey, isFeatureKey } from "@ea/core";
import { z } from "zod";

import { checkLlm, llmShape } from "./config-llm";
import { checkAuthMail, checkMailOAuth, checkSend, mailShape } from "./config-mail";
import { checkOperatorChat, checkOperatorUserIds, checkSlo, opsShape } from "./config-ops";
import { checkVapid, pushShape } from "./config-push";
import { addressPattern, ConfigError, emptyAsUndefined, isIpOrCidr, isOrigin, parseList } from "./config-shared";

// The parts of this file moved to the `config-*.ts` files; every name that this file exported is still exported here.
export {
  isRemovedEnvKey,
  type LlmRoleOverride,
  llmRoleTable,
  type LlmRunFlags,
  runFlagError,
  runFlagExitCode,
  runOverrides,
} from "./config-llm";
export {
  type AuthMailSettings,
  authMailSettings,
  mailAllowLocal,
  mailAllowLocalFromEnv,
  mailOAuthApp,
  mailOAuthConfigured,
  type MailOAuthProviderId,
  mailOAuthProviderIds,
  mailSyncCron,
  mailTrustedAuthservIds,
  sendLimits,
  sendTestAddresses,
  testMailRule,
} from "./config-mail";
export { operatorChatId, operatorUserIds, sloThresholds } from "./config-ops";
export { pushConfigOf } from "./config-push";
export { ConfigError, isIpOrCidr, isOrigin } from "./config-shared";

// 32 bytes for AES-256-GCM (platform/crypto)
const isCredentialsKey = (value: string): boolean =>
  /^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, "base64").length === 32;

// The env keys of the process, the web and the feature switches. The other keys are in the `config-*.ts` parts.
const coreShape = {
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  // json = one JSON object per line (the VPS); text = "[module] event key=value" (dev). ADR 0024.
  LOG_FORMAT: z.preprocess(emptyAsUndefined, z.enum(["json", "text"]).default("json")),
  // The release name: the image build sets it (deploy/Dockerfile ARG EA_RELEASE); every JSON log line carries it.
  EA_RELEASE: z.preprocess(
    emptyAsUndefined,
    z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,40}$/)
      .default("dev")
  ),
  CREDENTIALS_KEY: z.string().refine(isCredentialsKey, "must be base64 of 32 bytes"),
  CREDENTIALS_KEY_VERSION: z.coerce.number().int().positive().default(1),
  HEARTBEAT_URL: z.preprocess((v) => (v === "" ? undefined : v), z.string().url().optional()),
  // off = no mailbox change; synthetic = only synthetic mail; all = real mail, by the mode and the switches of each mailbox.
  ACTIONS_SCOPE: z.enum(["off", "synthetic", "all"]).default("off"),
  // Empty = the web is off.
  WEB_BASE_URL: z.preprocess(
    emptyAsUndefined,
    z.string().refine(isOrigin, "must be http(s)://host[:port] with no path, query or hash").optional()
  ),
  // The folder of the gate files (`classifier-*.json`) that the server reads at start. Empty = `evals/results/gate` of the image.
  GATE_EVIDENCE_DIR: z.preprocess(emptyAsUndefined, z.string().startsWith("/", "must be an absolute path").optional()),
  // Comma list of flag keys (packages/core/src/features.ts) that read off for every organization. Empty = none.
  FEATURES_OFF: z.preprocess(emptyAsUndefined, z.string().optional()),
  // Secret: never print or log it.
  WEB_AUTH_SECRET: z.preprocess(emptyAsUndefined, z.string().min(32).optional()),
  // Comma list of origins.
  WEB_TRUSTED_ORIGINS: z.preprocess(emptyAsUndefined, z.string().optional()),
  // Comma list of IPs or CIDRs.
  WEB_TRUSTED_PROXIES: z.preprocess(emptyAsUndefined, z.string().optional()),
  // Relative to the process working directory.
  WEB_DIST: z.preprocess(emptyAsUndefined, z.string().default("apps/web/dist")),
};

const baseSchema = z.object({ ...coreShape, ...llmShape, ...mailShape, ...opsShape, ...pushShape });

// The order of the checks is the order of the issues (and of `ConfigError.keys`).
export const configSchema = baseSchema.superRefine((config, ctx) => {
  checkLlm(config, ctx);
  checkSend(config, ctx);
  checkOperatorChat(config, ctx);
  checkSlo(config, ctx);
  if (config.WEB_BASE_URL !== undefined && config.WEB_AUTH_SECRET === undefined) {
    ctx.addIssue({ code: "custom", path: ["WEB_AUTH_SECRET"], message: "needed when WEB_BASE_URL is set" });
  }
  checkAuthMail(config, ctx);
  checkMailOAuth(config, ctx);
  if (!parseList(config.WEB_TRUSTED_ORIGINS).every(isOrigin)) {
    ctx.addIssue({
      code: "custom",
      path: ["WEB_TRUSTED_ORIGINS"],
      message: "each entry must be http(s)://host[:port]",
    });
  }
  if (!parseList(config.WEB_TRUSTED_PROXIES).every(isIpOrCidr)) {
    ctx.addIssue({ code: "custom", path: ["WEB_TRUSTED_PROXIES"], message: "each entry must be an IP or a CIDR" });
  }
  if (!parseList(config.FEATURES_OFF).every(isFeatureKey)) {
    ctx.addIssue({
      code: "custom",
      path: ["FEATURES_OFF"],
      message: "each entry must be a flag key of packages/core/src/features.ts",
    });
  }
  checkOperatorUserIds(config, ctx);
  checkVapid(config, ctx);
});

export type Config = z.infer<typeof configSchema>;

export function webTrustedOrigins(config: Config): string[] {
  return parseList(config.WEB_TRUSTED_ORIGINS);
}

export function webTrustedProxies(config: Config): string[] {
  return parseList(config.WEB_TRUSTED_PROXIES);
}

/** Flag keys that read off for every organization (`FEATURES_OFF`). `configSchema` refuses an unknown key. */
export function featuresOff(config: Config): FeatureKey[] {
  return parseList(config.FEATURES_OFF).filter(isFeatureKey);
}

/** The same parse on raw env, for code that did not get the config object. An empty string counts as unset. An unknown key throws. */
export function featuresOffFromEnv(env: Record<string, string | undefined>): FeatureKey[] {
  const items = parseList(env.FEATURES_OFF);
  if (!items.every(isFeatureKey)) throw new ConfigError(["FEATURES_OFF"]);
  return items;
}

// A reason code is a lower-case word with underscores: only our own custom issues have this shape.
const REASON_CODE = /^[a-z]+(_[a-z]+)+$/;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    const codes = [...new Set(result.error.issues.map((issue) => issue.message).filter((m) => REASON_CODE.test(m)))];
    throw new ConfigError(keys, codes);
  }
  return result.data;
}

// Test tool only (bun run testmail:*). The server never needs these keys, so `loadConfig` does not read them.
export const testmailConfigSchema = z.object({
  // Secret: never print or log it.
  AGENTMAIL_API_KEY: z.preprocess(emptyAsUndefined, z.string().min(10)),
  AGENTMAIL_BASE_URL: z.preprocess(emptyAsUndefined, z.string().url().default("https://api.agentmail.to/v0")),
  TEST_MAILBOX_ADDRESS: z.preprocess(emptyAsUndefined, z.string().regex(addressPattern).optional()),
});

export type TestmailConfig = z.infer<typeof testmailConfigSchema>;

export function loadTestmailConfig(env: Record<string, string | undefined> = process.env): TestmailConfig {
  const result = testmailConfigSchema.safeParse(env);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new ConfigError(keys);
  }
  return result.data;
}
