import { describe, expect, test } from "bun:test";

import { ConfigError, loadConfig } from "./config";

const fullEnv = { DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/email_assistant" };

describe("loadConfig", () => {
  test("accepts a full env and sets defaults", () => {
    const config = loadConfig(fullEnv);
    expect(config.DATABASE_URL).toBe(fullEnv.DATABASE_URL);
    expect(config.PORT).toBe(8080);
    expect(config.LOG_LEVEL).toBe("info");
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
      loadConfig({ DATABASE_URL: "postgres://app:s3cret@127.0.0.1:5433/db", PORT: "abc" });
      throw new Error("did not throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = (error as ConfigError).message;
      expect(message).not.toContain("s3cret");
      expect(message).toContain("PORT");
    }
  });
});
