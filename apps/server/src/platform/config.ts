import { z } from "zod";

export const configSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
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
