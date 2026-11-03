import { randomBytes } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { ConfigError, loadConfig } from "./config";

const fullEnv = {
  DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/email_assistant",
  CREDENTIALS_KEY: randomBytes(32).toString("base64"),
};

function configError(env: Record<string, string | undefined>): ConfigError {
  try {
    loadConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return error as ConfigError;
  }
  throw new Error("did not throw");
}

describe("loadConfig", () => {
  test("accepts a full env and sets defaults", () => {
    const config = loadConfig(fullEnv);
    expect(config.DATABASE_URL).toBe(fullEnv.DATABASE_URL);
    expect(config.PORT).toBe(8080);
    expect(config.LOG_LEVEL).toBe("info");
    expect(config.CREDENTIALS_KEY).toBe(fullEnv.CREDENTIALS_KEY);
    expect(config.CREDENTIALS_KEY_VERSION).toBe(1);
  });

  test("throws ConfigError when DATABASE_URL is missing", () => {
    try {
      loadConfig({});
      throw new Error("did not throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).keys).toContain("DATABASE_URL");
    }
  });

  test("throws when DATABASE_URL is empty", () => {
    expect(() => loadConfig({ DATABASE_URL: "" })).toThrow(ConfigError);
  });

  test("throws when LOG_LEVEL is bad", () => {
    expect(() => loadConfig({ ...fullEnv, LOG_LEVEL: "loud" })).toThrow(ConfigError);
  });

  test("error message has no value from the input", () => {
    try {
      loadConfig({ ...fullEnv, DATABASE_URL: "postgres://app:s3cret@127.0.0.1:5433/db", PORT: "abc" });
      throw new Error("did not throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = (error as ConfigError).message;
      expect(message).not.toContain("s3cret");
      expect(message).toContain("PORT");
    }
  });

  test("throws ConfigError when CREDENTIALS_KEY is missing", () => {
    expect(configError({ ...fullEnv, CREDENTIALS_KEY: undefined }).keys).toContain("CREDENTIALS_KEY");
  });

  test("throws ConfigError when CREDENTIALS_KEY has 16 bytes, with no key value in the message", () => {
    const shortKey = randomBytes(16).toString("base64");
    const error = configError({ ...fullEnv, CREDENTIALS_KEY: shortKey });
    expect(error.keys).toContain("CREDENTIALS_KEY");
    expect(error.message).not.toContain(shortKey);
  });

  test("throws ConfigError when CREDENTIALS_KEY is not base64", () => {
    const badKey = `${"x".repeat(43)}!`;
    const error = configError({ ...fullEnv, CREDENTIALS_KEY: badKey });
    expect(error.keys).toContain("CREDENTIALS_KEY");
    expect(error.message).not.toContain(badKey);
  });

  test("throws ConfigError when CREDENTIALS_KEY_VERSION is not a positive integer", () => {
    expect(configError({ ...fullEnv, CREDENTIALS_KEY_VERSION: "0" }).keys).toContain("CREDENTIALS_KEY_VERSION");
  });

  test("treats an empty HEARTBEAT_URL as missing", () => {
    expect(loadConfig({ ...fullEnv, HEARTBEAT_URL: "" }).HEARTBEAT_URL).toBeUndefined();
    expect(loadConfig(fullEnv).HEARTBEAT_URL).toBeUndefined();
  });

  test("accepts a HEARTBEAT_URL", () => {
    expect(loadConfig({ ...fullEnv, HEARTBEAT_URL: "https://hc.example/ping/abc" }).HEARTBEAT_URL).toBe(
      "https://hc.example/ping/abc"
    );
  });

  test("throws ConfigError when HEARTBEAT_URL is not a URL, with no value in the message", () => {
    const error = configError({ ...fullEnv, HEARTBEAT_URL: "not a url" });
    expect(error.keys).toContain("HEARTBEAT_URL");
    expect(error.message).not.toContain("not a url");
  });
});
