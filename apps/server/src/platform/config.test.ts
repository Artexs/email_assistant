import { randomBytes } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { classifierModel, ConfigError, loadConfig } from "./config";

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

  test("treats an empty TEST_MAILBOX_ADDRESS as missing and rejects a bad one", () => {
    expect(loadConfig({ ...fullEnv, TEST_MAILBOX_ADDRESS: "" }).TEST_MAILBOX_ADDRESS).toBeUndefined();
    expect(loadConfig(fullEnv).TEST_MAILBOX_ADDRESS).toBeUndefined();
    expect(loadConfig({ ...fullEnv, TEST_MAILBOX_ADDRESS: "test@interia.pl" }).TEST_MAILBOX_ADDRESS).toBe(
      "test@interia.pl"
    );
    expect(configError({ ...fullEnv, TEST_MAILBOX_ADDRESS: "nope" }).keys).toContain("TEST_MAILBOX_ADDRESS");
  });

  test("sets the LLM defaults with only the S1a keys", () => {
    const config = loadConfig(fullEnv);
    expect(config.GEMINI_API_KEY).toBeUndefined();
    expect(config.GEMINI_MODEL).toBe("gemini-3.8-flash");
    expect(config.GEMINI_MODEL_CLASSIFIER).toBe("gemini-3.5-flash-lite");
    expect(classifierModel(config)).toBe("gemini-3.5-flash-lite");
    expect(config.GEMINI_TIMEOUT_MS).toBe(30000);
    expect(config.GEMINI_RPM).toBe(12);
    expect(config.LLM_DAILY_CAP).toBe(300);
    expect(config.TRIAGE_LLM_SCOPE).toBe("off");
  });

  test("treats an empty GEMINI_API_KEY as missing", () => {
    expect(loadConfig({ ...fullEnv, GEMINI_API_KEY: "" }).GEMINI_API_KEY).toBeUndefined();
  });

  test("throws ConfigError when TRIAGE_LLM_SCOPE=synthetic has no GEMINI_API_KEY", () => {
    expect(configError({ ...fullEnv, TRIAGE_LLM_SCOPE: "synthetic" }).keys).toContain("GEMINI_API_KEY");
    expect(configError({ ...fullEnv, TRIAGE_LLM_SCOPE: "synthetic", GEMINI_API_KEY: "" }).keys).toContain(
      "GEMINI_API_KEY"
    );
  });

  test("accepts TRIAGE_LLM_SCOPE=synthetic with a GEMINI_API_KEY", () => {
    const config = loadConfig({ ...fullEnv, TRIAGE_LLM_SCOPE: "synthetic", GEMINI_API_KEY: "test-key" });
    expect(config.TRIAGE_LLM_SCOPE).toBe("synthetic");
    expect(config.GEMINI_API_KEY).toBe("test-key");
  });

  test("throws ConfigError when TRIAGE_LLM_SCOPE=all has no TEST_MAILBOX_ADDRESS", () => {
    const error = configError({ ...fullEnv, TRIAGE_LLM_SCOPE: "all", GEMINI_API_KEY: "test-key" });
    expect(error.keys).toContain("TEST_MAILBOX_ADDRESS");
    expect(error.keys).not.toContain("GEMINI_API_KEY");
    expect(error.message).not.toContain("test-key");
  });

  test("throws ConfigError with both keys when TRIAGE_LLM_SCOPE=all has neither", () => {
    const error = configError({ ...fullEnv, TRIAGE_LLM_SCOPE: "all" });
    expect(error.keys).toContain("GEMINI_API_KEY");
    expect(error.keys).toContain("TEST_MAILBOX_ADDRESS");
  });

  test("accepts TRIAGE_LLM_SCOPE=all with a GEMINI_API_KEY and a TEST_MAILBOX_ADDRESS", () => {
    const config = loadConfig({
      ...fullEnv,
      TRIAGE_LLM_SCOPE: "all",
      GEMINI_API_KEY: "test-key",
      TEST_MAILBOX_ADDRESS: "test@interia.pl",
    });
    expect(config.TRIAGE_LLM_SCOPE).toBe("all");
  });

  test("throws ConfigError when TRIAGE_LLM_SCOPE is bad", () => {
    expect(configError({ ...fullEnv, TRIAGE_LLM_SCOPE: "real" }).keys).toContain("TRIAGE_LLM_SCOPE");
  });

  test("treats an empty GEMINI_MODEL_CLASSIFIER as the default", () => {
    expect(loadConfig({ ...fullEnv, GEMINI_MODEL_CLASSIFIER: "" }).GEMINI_MODEL_CLASSIFIER).toBe(
      "gemini-3.5-flash-lite"
    );
  });

  test("classifierModel returns the set GEMINI_MODEL_CLASSIFIER", () => {
    const config = loadConfig({ ...fullEnv, GEMINI_MODEL_CLASSIFIER: "gemini-3.1-flash-lite" });
    expect(classifierModel(config)).toBe("gemini-3.1-flash-lite");
  });

  test("reads the LLM numbers and rejects bad ones", () => {
    const config = loadConfig({ ...fullEnv, GEMINI_TIMEOUT_MS: "5000", GEMINI_RPM: "3", LLM_DAILY_CAP: "50" });
    expect(config.GEMINI_TIMEOUT_MS).toBe(5000);
    expect(config.GEMINI_RPM).toBe(3);
    expect(config.LLM_DAILY_CAP).toBe(50);
    expect(configError({ ...fullEnv, GEMINI_RPM: "0" }).keys).toContain("GEMINI_RPM");
    expect(configError({ ...fullEnv, LLM_DAILY_CAP: "0" }).keys).toContain("LLM_DAILY_CAP");
    expect(configError({ ...fullEnv, GEMINI_TIMEOUT_MS: "1.5" }).keys).toContain("GEMINI_TIMEOUT_MS");
  });
});
