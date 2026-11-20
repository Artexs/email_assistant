import { randomBytes } from "node:crypto";

import { expect } from "bun:test";

import { ConfigError, loadConfig } from "./config";

export const fullEnv = {
  DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/email_assistant",
  CREDENTIALS_KEY: randomBytes(32).toString("base64"),
};

export const geminiEnv = { ...fullEnv, LLM_PROVIDER: "gemini" };

export function configError(env: Record<string, string | undefined>): ConfigError {
  try {
    loadConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return error as ConfigError;
  }
  throw new Error("did not throw");
}
