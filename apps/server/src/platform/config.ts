import { z } from "zod";

import { type LlmProviderId, llmProviderIds } from "./llm";

// 32 bytes for AES-256-GCM (platform/crypto)
const isCredentialsKey = (value: string): boolean =>
  /^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, "base64").length === 32;

// Step 0.2 (AI Studio, free tier, 2026-11-04): classifier RPM 15 × 0.8 = 12. The RPD is not known, so the cap stays 300.
const defaultGeminiRpm = 12;
const defaultLlmDailyCap = 300;

// Accepted values of `reasoning.effort` (stage 0 note, case F).
export const openAiReasoningEfforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

const emptyAsUndefined = (v: unknown): unknown => (v === "" ? undefined : v);

// Dev only: a loopback root never reaches a real or remote server. `origin` drops userinfo, path, query and hash.
// A trailing "/" is refused too: grammY throws on an apiRoot that ends with "/".
export function isLoopbackApiRoot(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    url.origin === value
  );
}

const addressPattern = /^[^\s@]+@[^\s@]+$/;

// Comma-separated, trimmed, lower-cased, unique. An empty entry is dropped.
function parseAddressList(value: string | undefined): string[] {
  const items = (value ?? "").split(",").map((item) => item.trim().toLowerCase());
  return [...new Set(items.filter((item) => item !== ""))];
}

const baseSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  CREDENTIALS_KEY: z.string().refine(isCredentialsKey, "must be base64 of 32 bytes"),
  CREDENTIALS_KEY_VERSION: z.coerce.number().int().positive().default(1),
  HEARTBEAT_URL: z.preprocess((v) => (v === "" ? undefined : v), z.string().url().optional()),
  // Not `z.email()`: the GreenMail test address is `user@localhost`, with no dot in the domain.
  TEST_MAILBOX_ADDRESS: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .string()
      .regex(/^[^\s@]+@[^\s@]+$/)
      .optional()
  ),
  // One switch for both LLM roles (classifier, S4 writer). A restart applies it.
  LLM_PROVIDER: z.preprocess(emptyAsUndefined, z.enum(llmProviderIds).default("gemini")),
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
  // Writer role (S4) and fallback.
  GEMINI_MODEL: z.preprocess((v) => (v === "" ? undefined : v), z.string().default("gemini-3.8-flash")),
  GEMINI_MODEL_CLASSIFIER: z.preprocess((v) => (v === "" ? undefined : v), z.string().default("gemini-3.5-flash-lite")),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  GEMINI_RPM: z.coerce.number().int().positive().default(defaultGeminiRpm),
  // Secret: never print or log it.
  OPENAI_API_KEY: z.preprocess(emptyAsUndefined, z.string().optional()),
  // Writer role (S4).
  OPENAI_MODEL: z.preprocess(emptyAsUndefined, z.string().default("gpt-6.1-terra")),
  OPENAI_MODEL_CLASSIFIER: z.preprocess(emptyAsUndefined, z.string().default("gpt-6-luna")),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  OPENAI_RPM: z.coerce.number().int().positive().default(60),
  OPENAI_REASONING_EFFORT: z.preprocess(emptyAsUndefined, z.enum(openAiReasoningEfforts).default("none")),
  // LLM call attempts per mailbox per America/Los_Angeles day.
  LLM_DAILY_CAP: z.coerce.number().int().positive().default(defaultLlmDailyCap),
  // off = no triage worker; synthetic = only synthetic mail; all = also real mail, only of TEST_MAILBOX_ADDRESS (ADR 0013).
  TRIAGE_LLM_SCOPE: z.enum(["off", "synthetic", "all"]).default("off"),
  // off = the committer changes nothing in any mailbox; synthetic = only synthetic mail; all = also real mail, only of TEST_MAILBOX_ADDRESS.
  ACTIONS_SCOPE: z.enum(["off", "synthetic", "all"]).default("off"),
  // off = no send goes out; self = only to SEND_TEST_ADDRESSES; all = real delegates, only for the TEST_MAILBOX_ADDRESS mailbox.
  SEND_SCOPE: z.enum(["off", "self", "all"]).default("off"),
  // Comma-separated; needed with SEND_SCOPE=self.
  SEND_TEST_ADDRESSES: z.preprocess(emptyAsUndefined, z.string().optional()),
});

type BaseConfig = z.infer<typeof baseSchema>;

export interface LlmSettings {
  provider: LlmProviderId;
  /** Env key name, for messages: "GEMINI_API_KEY". */
  apiKeyName: string;
  apiKey: string | undefined;
  classifierModel: string;
  /** S4 writer role. */
  writerModel: string;
  timeoutMs: number;
  rpm: number;
  /** null: the provider has no effort setting. */
  reasoningEffort: string | null;
}

// One block per registry row: the type forces a block for each provider.
const providerBlocks: Record<LlmProviderId, (config: BaseConfig) => Omit<LlmSettings, "provider">> = {
  gemini: (c) => ({
    apiKeyName: "GEMINI_API_KEY",
    apiKey: c.GEMINI_API_KEY,
    classifierModel: c.GEMINI_MODEL_CLASSIFIER,
    writerModel: c.GEMINI_MODEL,
    timeoutMs: c.GEMINI_TIMEOUT_MS,
    rpm: c.GEMINI_RPM,
    reasoningEffort: null,
  }),
  openai: (c) => ({
    apiKeyName: "OPENAI_API_KEY",
    apiKey: c.OPENAI_API_KEY,
    classifierModel: c.OPENAI_MODEL_CLASSIFIER,
    writerModel: c.OPENAI_MODEL,
    timeoutMs: c.OPENAI_TIMEOUT_MS,
    rpm: c.OPENAI_RPM,
    reasoningEffort: c.OPENAI_REASONING_EFFORT,
  }),
};

export const configSchema = baseSchema.superRefine((config, ctx) => {
  const block = providerBlocks[config.LLM_PROVIDER](config);
  if (config.TRIAGE_LLM_SCOPE !== "off" && block.apiKey === undefined) {
    ctx.addIssue({ code: "custom", path: [block.apiKeyName], message: "needed when TRIAGE_LLM_SCOPE is not off" });
  }
  if (config.TRIAGE_LLM_SCOPE === "all" && config.TEST_MAILBOX_ADDRESS === undefined) {
    ctx.addIssue({ code: "custom", path: ["TEST_MAILBOX_ADDRESS"], message: "needed when TRIAGE_LLM_SCOPE is all" });
  }
  if (config.ACTIONS_SCOPE === "all" && config.TEST_MAILBOX_ADDRESS === undefined) {
    ctx.addIssue({ code: "custom", path: ["TEST_MAILBOX_ADDRESS"], message: "needed when ACTIONS_SCOPE is all" });
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
  if (config.SEND_SCOPE === "all" && config.TEST_MAILBOX_ADDRESS === undefined) {
    ctx.addIssue({ code: "custom", path: ["TEST_MAILBOX_ADDRESS"], message: "needed when SEND_SCOPE is all" });
  }
});

export type Config = z.infer<typeof configSchema>;

export function llmSettings(config: Config, provider: LlmProviderId = config.LLM_PROVIDER): LlmSettings {
  return { provider, ...providerBlocks[provider](config) };
}

export function sendTestAddresses(config: Config): string[] {
  return parseAddressList(config.SEND_TEST_ADDRESSES);
}

export function classifierModel(config: Config): string {
  return llmSettings(config).classifierModel;
}

export class ConfigError extends Error {
  constructor(readonly keys: string[]) {
    super(`Missing or bad config keys: ${keys.join(", ")}`);
    this.name = "ConfigError";
  }
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new ConfigError(keys);
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
