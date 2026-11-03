import { z } from "zod";

// 32 bytes for AES-256-GCM (platform/crypto)
const isCredentialsKey = (value: string): boolean =>
  /^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, "base64").length === 32;

export const configSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  CREDENTIALS_KEY: z.string().refine(isCredentialsKey, "must be base64 of 32 bytes"),
  CREDENTIALS_KEY_VERSION: z.coerce.number().int().positive().default(1),
});

export type Config = z.infer<typeof configSchema>;

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
