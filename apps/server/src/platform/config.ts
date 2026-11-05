import { z } from "zod";

// 32 bytes for AES-256-GCM (platform/crypto)
const isCredentialsKey = (value: string): boolean =>
  /^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, "base64").length === 32;

// Step 0.2 (AI Studio, free tier, 2026-11-04): classifier RPM 15 × 0.8 = 12. The RPD is not known, so the cap stays 300.
const defaultGeminiRpm = 12;
const defaultLlmDailyCap = 300;

export const configSchema = z
  .object({
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
    GEMINI_API_KEY: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
    // Writer role (S4) and fallback.
    GEMINI_MODEL: z.string().default("gemini-3.8-flash"),
    GEMINI_MODEL_CLASSIFIER: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().default("gemini-3.5-flash-lite")
    ),
    GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
    GEMINI_RPM: z.coerce.number().int().positive().default(defaultGeminiRpm),
    // LLM call attempts per mailbox per America/Los_Angeles day.
    LLM_DAILY_CAP: z.coerce.number().int().positive().default(defaultLlmDailyCap),
    // off = no triage worker; synthetic = only synthetic mail; all = also real mail, only of TEST_MAILBOX_ADDRESS (ADR 0013).
    TRIAGE_LLM_SCOPE: z.enum(["off", "synthetic", "all"]).default("off"),
  })
  .superRefine((config, ctx) => {
    if (config.TRIAGE_LLM_SCOPE !== "off" && config.GEMINI_API_KEY === undefined) {
      ctx.addIssue({ code: "custom", path: ["GEMINI_API_KEY"], message: "needed when TRIAGE_LLM_SCOPE is not off" });
    }
    if (config.TRIAGE_LLM_SCOPE === "all" && config.TEST_MAILBOX_ADDRESS === undefined) {
      ctx.addIssue({ code: "custom", path: ["TEST_MAILBOX_ADDRESS"], message: "needed when TRIAGE_LLM_SCOPE is all" });
    }
  });

export type Config = z.infer<typeof configSchema>;

export function classifierModel(config: Config): string {
  return config.GEMINI_MODEL_CLASSIFIER;
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
