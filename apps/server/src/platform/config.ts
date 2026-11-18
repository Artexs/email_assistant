import { isIP } from "node:net";

import {
  type FeatureKey,
  isFeatureKey,
  isLoopbackApiRoot,
  type LlmRole,
  llmRoles,
  type SendLimits,
  type SloThresholds,
} from "@ea/core";
import { z } from "zod";

import { type LlmProviderId, llmProviderIds, type LlmRoleSettings, type LlmRoleTable } from "./llm";
import { DEFAULT_OPENAI_BASE_URL, type LlmEndpoint, parseLlmBaseUrl } from "./llm/endpoint";
import { decodeBase64Url, PUBLIC_KEY_BYTES, vapidPublicKeyOf } from "./vapid-keys";

// 32 bytes for AES-256-GCM (platform/crypto)
const isCredentialsKey = (value: string): boolean =>
  /^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, "base64").length === 32;

// Step 0.2 (AI Studio, free tier, 2026-11-04): classifier RPM 15 × 0.8 = 12. The RPD is not known, so the cap stays 300.
const defaultGeminiRpm = 12;
const defaultLlmDailyCap = 300;

// Accepted values of `reasoning.effort` (stage 0 note, case F).
export const openAiReasoningEfforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

const emptyAsUndefined = (v: unknown): unknown => (v === "" ? undefined : v);

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

// A browser origin: http(s) with host and optional port, no path, query, hash or trailing "/".
export function isOrigin(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value;
}

// An IP address, or a CIDR range "ip/n" with n in 0..32 (v4) or 0..128 (v6).
export function isIpOrCidr(value: string): boolean {
  const [ip = "", prefix, ...rest] = value.split("/");
  const family = isIP(ip);
  if (family === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  return /^\d{1,3}$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128);
}

// Comma-separated, trimmed, unique. An empty entry is dropped.
function parseList(value: string | undefined): string[] {
  const items = (value ?? "").split(",").map((item) => item.trim());
  return [...new Set(items.filter((item) => item !== ""))];
}

const addressPattern = /^[^\s@]+@[^\s@]+$/;

// Comma-separated, trimmed, lower-cased, unique. An empty entry is dropped.
function parseAddressList(value: string | undefined): string[] {
  const items = (value ?? "").split(",").map((item) => item.trim().toLowerCase());
  return [...new Set(items.filter((item) => item !== ""))];
}

// The providers of mailbox OAuth (F117). The mail module has the same union (`MailOAuthProvider`): `platform` does not import `modules`.
export const mailOAuthProviderIds = ["microsoft", "google"] as const;
export type MailOAuthProviderId = (typeof mailOAuthProviderIds)[number];

const mailOAuthKeys = {
  microsoft: ["MAIL_OAUTH_MICROSOFT_CLIENT_ID", "MAIL_OAUTH_MICROSOFT_CLIENT_SECRET"],
  google: ["MAIL_OAUTH_GOOGLE_CLIENT_ID", "MAIL_OAUTH_GOOGLE_CLIENT_SECRET"],
} as const;

const baseSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  // json = one JSON object per line (the VPS); text = "[module] event key=value" (dev). ADR 0024.
  LOG_FORMAT: z.preprocess(emptyAsUndefined, z.enum(["json", "text"]).default("json")),
  // The release name: the image build sets it (deploy/Dockerfile ARG EA_RELEASE); every JSON log line carries it. F114 D10.
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
  // Web Push (F118, RFC 8292): the VAPID key pair (raw P-256, base64url) and the contact URI. All three or none. Secret: never print or log.
  VAPID_PUBLIC_KEY: z.preprocess(emptyAsUndefined, z.string().optional()),
  VAPID_PRIVATE_KEY: z.preprocess(emptyAsUndefined, z.string().optional()),
  VAPID_SUBJECT: z.preprocess(emptyAsUndefined, z.string().optional()),
  // Not `z.email()`: the GreenMail test address is `user@localhost`, with no dot in the domain.
  TEST_MAILBOX_ADDRESS: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .string()
      .regex(/^[^\s@]+@[^\s@]+$/)
      .optional()
  ),
  // The classifier's provider, and the provider of every role without LLM_<ROLE>_PROVIDER. A restart applies it.
  LLM_PROVIDER: z.preprocess(emptyAsUndefined, z.enum(llmProviderIds).default("openai")),
  GEMINI_API_KEY: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  // Empty or missing = Telegram off. Secret: never print or log it.
  TELEGRAM_BOT_TOKEN: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .string()
      .regex(/^\d+:[A-Za-z0-9_-]{20,}$/)
      .optional()
  ),
  // Dev only: a local fake Bot API (tools/fake-telegram). Empty = the real Telegram.
  TELEGRAM_API_ROOT: z.preprocess(
    emptyAsUndefined,
    z.string().refine(isLoopbackApiRoot, "must be http(s)://127.0.0.1, ::1 or localhost, with no path").optional()
  ),
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
  // off = no mailbox change; synthetic = only synthetic mail; all = real mail, by the mode and the switches of each mailbox.
  ACTIONS_SCOPE: z.enum(["off", "synthetic", "all"]).default("off"),
  // off = no send; self = only to SEND_TEST_ADDRESSES; all = real recipients, always after an owner's tap.
  SEND_SCOPE: z.enum(["off", "self", "all"]).default("off"),
  // Comma-separated; needed with SEND_SCOPE=self.
  SEND_TEST_ADDRESSES: z.preprocess(emptyAsUndefined, z.string().optional()),
  // Comma-separated sender addresses whose mail counts as test mail (D1 of F097). Empty = none.
  TEST_SENDER_ADDRESSES: z.preprocess(emptyAsUndefined, z.string().optional()),
  // Send limits per mailbox (PD-044); a send over a limit waits. Integers 1 to 10 000; empty = the default.
  SEND_LIMIT_MAILBOX_HOUR: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(1).max(10_000).default(20)),
  SEND_LIMIT_MAILBOX_DAY: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(1).max(10_000).default(100)),
  SEND_LIMIT_RECIPIENT_DAY: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(1).max(10_000).default(5)),
  // Comma list of authserv-ids (hosts) whose `Authentication-Results` header the suspicious-mail rules trust, besides the
  // registrable domain of the mailbox IMAP host (F109 D2). Empty = none.
  MAIL_TRUSTED_AUTHSERV_IDS: z.preprocess(emptyAsUndefined, z.string().optional()),
  // Minutes between two mail syncs (D7 of F100): 2, 3 or 5. Empty = 2.
  MAIL_SYNC_EVERY_MIN: z.preprocess(emptyAsUndefined, z.enum(["2", "3", "5"]).default("2")),
  // Empty = the web is off.
  WEB_BASE_URL: z.preprocess(
    emptyAsUndefined,
    z.string().refine(isOrigin, "must be http(s)://host[:port] with no path, query or hash").optional()
  ),
  // Public contact address shown in the paused banner and the paused Telegram answer. Empty = none.
  OPERATOR_CONTACT: z.preprocess(emptyAsUndefined, z.string().regex(addressPattern).optional()),
  // The operator's own Telegram chat id for operator notices (ids only). Needs TELEGRAM_BOT_TOKEN. Empty = log lines only. Private: never log it.
  OPERATOR_TELEGRAM_CHAT_ID: z.preprocess(
    emptyAsUndefined,
    z
      .string()
      .regex(/^-?\d{1,15}$/)
      .optional()
  ),
  // The language of the operator alert texts (F114): `en` or `pl`. Empty = `en`.
  OPERATOR_LOCALE: z.preprocess(emptyAsUndefined, z.enum(["en", "pl"]).default("en")),
  // F114 service levels of the operator alerts. Empty = the default. Whole numbers, except SLO_DISK_FREE_GB (decimals).
  // Minutes since the last sync before a mailbox counts as late.
  SLO_SYNC_LAG_MIN: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(5).max(1440).default(15)),
  // Minutes (outside quiet hours) that an urgent mail may wait for its notice.
  SLO_URGENT_LATENCY_MIN: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(1).max(240).default(10)),
  // The window of the LLM error rate, the least calls in it, the rate that opens the alert and the rate that closes it.
  SLO_LLM_WINDOW_MIN: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(5).max(240).default(30)),
  SLO_LLM_MIN_CALLS: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(1).max(1000).default(5)),
  SLO_LLM_FAIL_PCT: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(1).max(100).default(20)),
  SLO_LLM_CLEAR_PCT: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(0).max(99).default(10)),
  // Hours between two notices of one open alert.
  SLO_REPEAT_H: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(1).max(168).default(6)),
  // Disk check: the volume to read (the path inside the container), the free percent and the free gigabytes that open the alert.
  SLO_DISK_PATH: z.preprocess(emptyAsUndefined, z.string().startsWith("/", "must be an absolute path").default("/")),
  SLO_DISK_FREE_PCT: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(1).max(90).default(15)),
  SLO_DISK_FREE_GB: z.preprocess(emptyAsUndefined, z.coerce.number().min(0.5).max(100).default(2)),
  // Hours since the last good backup before the alert opens.
  SLO_BACKUP_MAX_AGE_H: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(1).max(720).default(26)),
  // The status file that deploy/backup.sh writes (mounted read-only). Empty = the backup check is off.
  BACKUP_STATUS_FILE: z.preprocess(emptyAsUndefined, z.string().startsWith("/", "must be an absolute path").optional()),
  // The folder of the gate files (`classifier-*.json`) that the server reads at start (F110 D1). Empty = `evals/results/gate` of the image.
  GATE_EVIDENCE_DIR: z.preprocess(emptyAsUndefined, z.string().startsWith("/", "must be an absolute path").optional()),
  // Comma list of flag keys (packages/core/src/features.ts) that read off for every organization. Empty = none.
  FEATURES_OFF: z.preprocess(emptyAsUndefined, z.string().optional()),
  // Comma list of user ids (users.id, UUID) who may use /api/operator/*. Empty = no operator. Never log the ids.
  OPERATOR_USER_IDS: z.preprocess(emptyAsUndefined, z.string().optional()),
  // Secret: never print or log it.
  WEB_AUTH_SECRET: z.preprocess(emptyAsUndefined, z.string().min(32).optional()),
  // Comma list of origins.
  WEB_TRUSTED_ORIGINS: z.preprocess(emptyAsUndefined, z.string().optional()),
  // Comma list of IPs or CIDRs.
  WEB_TRUSTED_PROXIES: z.preprocess(emptyAsUndefined, z.string().optional()),
  // Relative to the process working directory.
  WEB_DIST: z.preprocess(emptyAsUndefined, z.string().default("apps/web/dist")),
  // Old name of MAIL_ALLOW_LOCAL_HOSTS; read only while that key is unset. No default: "unset" must stay visible.
  WEB_MAIL_ALLOW_LOCAL: z.preprocess(emptyAsUndefined, z.enum(["true", "false"]).optional()),
  // true = mail hosts on localhost or a private network are allowed for the connect form, sync and send (dev, e2e).
  MAIL_ALLOW_LOCAL_HOSTS: z.preprocess(emptyAsUndefined, z.enum(["true", "false"]).optional()),
  // Auth mail (S6b): host, user, password and from are set together. None set = the sender is off.
  AUTH_SMTP_HOST: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
  AUTH_SMTP_PORT: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(1).max(65535).default(465)),
  AUTH_SMTP_SECURITY: z.preprocess(emptyAsUndefined, z.enum(["tls", "starttls"]).default("tls")),
  AUTH_SMTP_USER: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
  // Secret: never print or log it.
  AUTH_SMTP_PASSWORD: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
  AUTH_MAIL_FROM: z.preprocess(emptyAsUndefined, z.string().regex(addressPattern).optional()),
  // on = a new password is checked against the Have I Been Pwned list; off = tests only.
  AUTH_PWNED_CHECK: z.preprocess(emptyAsUndefined, z.enum(["on", "off"]).default("on")),
  // Mailbox OAuth apps (F117, D7). Each client id is set with its secret. Secrets: never print or log them.
  MAIL_OAUTH_MICROSOFT_CLIENT_ID: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
  MAIL_OAUTH_MICROSOFT_CLIENT_SECRET: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
  MAIL_OAUTH_GOOGLE_CLIENT_ID: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
  MAIL_OAUTH_GOOGLE_CLIENT_SECRET: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
  ...roleKeyShape,
});

type BaseConfig = z.infer<typeof baseSchema>;

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
function openAiIsOwn(c: BaseConfig): boolean {
  const parsed = parseLlmBaseUrl(c.OPENAI_BASE_URL, c.OPENAI_ENDPOINT_KIND === "own");
  return !("error" in parsed) && parsed.endpoint === "own";
}

/** The endpoint of the openai provider. `configSchema` has checked the value, so an error here is a bug. */
function openAiEndpoint(c: BaseConfig): LlmEndpoint {
  const parsed = parseLlmBaseUrl(c.OPENAI_BASE_URL, c.OPENAI_ENDPOINT_KIND === "own");
  if ("error" in parsed) throw new ConfigError(["OPENAI_BASE_URL"]);
  return parsed;
}

// One block per registry row: the type forces a block for each provider.
const providerBlocks: Record<LlmProviderId, (config: BaseConfig) => ProviderBlock> = {
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

export const configSchema = baseSchema.superRefine((config, ctx) => {
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
  if (config.SEND_SCOPE === "self") {
    const raw = (config.SEND_TEST_ADDRESSES ?? "").split(",").filter((item) => item.trim() !== "");
    if (raw.length === 0 || !raw.every((item) => addressPattern.test(item.trim()))) {
      ctx.addIssue({
        code: "custom",
        path: ["SEND_TEST_ADDRESSES"],
        message: "needed when SEND_SCOPE is self: one or more valid addresses",
      });
    }
  }
  if (
    !(config.TEST_SENDER_ADDRESSES ?? "")
      .split(",")
      .filter((item) => item.trim() !== "")
      .every((item) => addressPattern.test(item.trim()))
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["TEST_SENDER_ADDRESSES"],
      message: "must be a comma list of valid addresses",
    });
  }
  if (config.OPERATOR_TELEGRAM_CHAT_ID !== undefined && config.TELEGRAM_BOT_TOKEN === undefined) {
    ctx.addIssue({ code: "custom", path: ["OPERATOR_TELEGRAM_CHAT_ID"], message: "needs TELEGRAM_BOT_TOKEN" });
  }
  if (config.SLO_LLM_CLEAR_PCT >= config.SLO_LLM_FAIL_PCT) {
    const message = "SLO_LLM_CLEAR_PCT must be lower than SLO_LLM_FAIL_PCT";
    ctx.addIssue({ code: "custom", path: ["SLO_LLM_CLEAR_PCT"], message });
    ctx.addIssue({ code: "custom", path: ["SLO_LLM_FAIL_PCT"], message });
  }
  if (config.WEB_BASE_URL !== undefined && config.WEB_AUTH_SECRET === undefined) {
    ctx.addIssue({ code: "custom", path: ["WEB_AUTH_SECRET"], message: "needed when WEB_BASE_URL is set" });
  }
  const authMailKeys = ["AUTH_SMTP_HOST", "AUTH_SMTP_USER", "AUTH_SMTP_PASSWORD", "AUTH_MAIL_FROM"] as const;
  const authMailSet = authMailKeys.filter((key) => config[key] !== undefined).length;
  if (authMailSet > 0 && authMailSet < authMailKeys.length) {
    for (const key of authMailKeys) {
      if (config[key] === undefined) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "AUTH_SMTP_HOST, AUTH_SMTP_USER, AUTH_SMTP_PASSWORD and AUTH_MAIL_FROM are set together",
        });
      }
    }
  }
  // D7: both keys of a provider or none; a provider that is set needs WEB_BASE_URL (the redirect URI). A message never holds a value.
  for (const provider of mailOAuthProviderIds) {
    const [idKey, secretKey] = mailOAuthKeys[provider];
    const idSet = config[idKey] !== undefined;
    const secretSet = config[secretKey] !== undefined;
    if (idSet !== secretSet) {
      ctx.addIssue({
        code: "custom",
        path: [idSet ? secretKey : idKey],
        message: `${idKey} and ${secretKey} are set together`,
      });
    } else if (idSet && config.WEB_BASE_URL === undefined) {
      ctx.addIssue({ code: "custom", path: ["WEB_BASE_URL"], message: `needed by ${idKey}` });
    }
  }
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
  if (!parseList(config.OPERATOR_USER_IDS).every((id) => z.uuid().safeParse(id).success)) {
    ctx.addIssue({ code: "custom", path: ["OPERATOR_USER_IDS"], message: "each entry must be a user id (UUID)" });
  }
  checkVapid(config, ctx);
});

const vapidKeyNames = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const;
const VAPID_SUBJECT = /^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s/]+(\/\S*)?)$/;

// All three or none. A message names the key or a fixed code, never a value (the keys are secrets).
function checkVapid(config: z.infer<typeof baseSchema>, ctx: z.RefinementCtx): void {
  const missing = vapidKeyNames.filter((key) => config[key] === undefined);
  if (missing.length === vapidKeyNames.length) return;
  for (const key of missing)
    ctx.addIssue({ code: "custom", path: [key], message: "needed when another VAPID_* key is set" });
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = config;
  if (subject !== undefined && !VAPID_SUBJECT.test(subject)) {
    ctx.addIssue({ code: "custom", path: ["VAPID_SUBJECT"], message: "must be a mailto: or https: URI" });
  }
  if (publicKey !== undefined && decodeBase64Url(publicKey)?.length !== PUBLIC_KEY_BYTES) {
    ctx.addIssue({ code: "custom", path: ["VAPID_PUBLIC_KEY"], message: "must be base64url of a 65-byte P-256 point" });
  }
  if (privateKey === undefined) return;
  const derived = vapidPublicKeyOf(privateKey);
  if (derived === null) {
    ctx.addIssue({ code: "custom", path: ["VAPID_PRIVATE_KEY"], message: "must be base64url of a 32-byte P-256 key" });
  } else if (publicKey !== undefined && publicKey !== derived) {
    ctx.addIssue({ code: "custom", path: ["VAPID_PUBLIC_KEY"], message: "vapid_key_mismatch" });
  }
}

export type Config = z.infer<typeof configSchema>;

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

export interface AuthMailSettings {
  host: string;
  port: number;
  security: "tls" | "starttls";
  user: string;
  /** Secret: never print or log it. */
  password: string;
  from: string;
}

// null = the sender is off (none of the four keys set; `configSchema` refuses a half set).
export function authMailSettings(config: Config): AuthMailSettings | null {
  const { AUTH_SMTP_HOST: host, AUTH_SMTP_USER: user, AUTH_SMTP_PASSWORD: password, AUTH_MAIL_FROM: from } = config;
  if (host === undefined || user === undefined || password === undefined || from === undefined) return null;
  return { host, port: config.AUTH_SMTP_PORT, security: config.AUTH_SMTP_SECURITY, user, password, from };
}

export function sendTestAddresses(config: Config): string[] {
  return parseAddressList(config.SEND_TEST_ADDRESSES);
}

// Structural twin of `TestMailRule` in the mail module: `platform` does not import `modules`.
export function testMailRule(config: Config): { senders: string[] } {
  return { senders: parseAddressList(config.TEST_SENDER_ADDRESSES) };
}

/** The send limits (PD-044). */
export function sendLimits(config: Config): SendLimits {
  return {
    mailboxHour: config.SEND_LIMIT_MAILBOX_HOUR,
    mailboxDay: config.SEND_LIMIT_MAILBOX_DAY,
    recipientDay: config.SEND_LIMIT_RECIPIENT_DAY,
  };
}

/** `MAIL_TRUSTED_AUTHSERV_IDS`: lower case, unique, no empty entry. */
export function mailTrustedAuthservIds(config: Config): string[] {
  return parseAddressList(config.MAIL_TRUSTED_AUTHSERV_IDS);
}

/** The OAuth app of a provider, or null while it is not configured: both keys and `WEB_BASE_URL` (the redirect URI). `clientSecret` is a secret: never print or log it. */
export function mailOAuthApp(
  config: Config,
  provider: MailOAuthProviderId
): { clientId: string; clientSecret: string; redirectUri: string } | null {
  const [idKey, secretKey] = mailOAuthKeys[provider];
  const clientId = config[idKey];
  const clientSecret = config[secretKey];
  if (clientId === undefined || clientSecret === undefined || config.WEB_BASE_URL === undefined) return null;
  return { clientId, clientSecret, redirectUri: `${config.WEB_BASE_URL}/api/mailboxes/oauth/${provider}/callback` };
}

export function mailOAuthConfigured(config: Config, provider: MailOAuthProviderId): boolean {
  return mailOAuthApp(config, provider) !== null;
}

/** The cron expression of the `mail.sync` job: every `MAIL_SYNC_EVERY_MIN` minutes. */
export function mailSyncCron(config: Config): string {
  return `*/${config.MAIL_SYNC_EVERY_MIN} * * * *`;
}

/** The thresholds of the service-level checks (F114). */
export function sloThresholds(config: Config): SloThresholds {
  return {
    syncLagMin: config.SLO_SYNC_LAG_MIN,
    urgentLatencyMin: config.SLO_URGENT_LATENCY_MIN,
    llmWindowMin: config.SLO_LLM_WINDOW_MIN,
    llmMinCalls: config.SLO_LLM_MIN_CALLS,
    llmFailPct: config.SLO_LLM_FAIL_PCT,
    llmClearPct: config.SLO_LLM_CLEAR_PCT,
    repeatH: config.SLO_REPEAT_H,
    diskPath: config.SLO_DISK_PATH,
    diskFreePct: config.SLO_DISK_FREE_PCT,
    diskFreeGb: config.SLO_DISK_FREE_GB,
    backupMaxAgeH: config.SLO_BACKUP_MAX_AGE_H,
    backupStatusFile: config.BACKUP_STATUS_FILE ?? null,
  };
}

// The operator's chat id for operator notices; null = log lines only.
export function operatorChatId(config: Config): number | null {
  return config.OPERATOR_TELEGRAM_CHAT_ID === undefined ? null : Number(config.OPERATOR_TELEGRAM_CHAT_ID);
}

/** The VAPID keys for Web Push, or null when none is set (`configSchema` has checked that all three are set, or none). */
export function pushConfigOf(config: Config): { publicKey: string; privateKey: string; subject: string } | null {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = config;
  if (publicKey === undefined || privateKey === undefined || subject === undefined) return null;
  return { publicKey, privateKey, subject };
}

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

/** User ids of the operator (`OPERATOR_USER_IDS`), lower-cased and unique. `configSchema` refuses an entry that is not a UUID. */
export function operatorUserIds(config: Config): ReadonlySet<string> {
  return new Set(parseList(config.OPERATOR_USER_IDS).map((id) => id.toLowerCase()));
}

/** `MAIL_ALLOW_LOCAL_HOSTS` wins; the old `WEB_MAIL_ALLOW_LOCAL` counts only while the new key is unset. */
export function mailAllowLocal(config: Config): boolean {
  return (config.MAIL_ALLOW_LOCAL_HOSTS ?? config.WEB_MAIL_ALLOW_LOCAL) === "true";
}

/** The same rule on raw env, for the probe scripts that do not call `loadConfig`. An empty string counts as unset. */
export function mailAllowLocalFromEnv(env: Record<string, string | undefined>): boolean {
  const pick = (key: string) => (env[key] === undefined || env[key] === "" ? undefined : env[key]);
  return (pick("MAIL_ALLOW_LOCAL_HOSTS") ?? pick("WEB_MAIL_ALLOW_LOCAL")) === "true";
}

// `codes` are fixed reason codes of the config schema (`vapid_key_mismatch`), never a value.
export class ConfigError extends Error {
  constructor(
    readonly keys: string[],
    readonly codes: string[] = []
  ) {
    super(`Missing or bad config keys: ${keys.join(", ")}${codes.length === 0 ? "" : ` (${codes.join(", ")})`}`);
    this.name = "ConfigError";
  }
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
