import { randomBytes } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { ConfigError, llmRoleTable, loadConfig, operatorChatId } from "./config";
import { fullEnv, geminiEnv, configError } from "./config.test-helper";

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

  test("accepts a comma-separated list in TEST_MAILBOX_ADDRESS and rejects a broken one", () => {
    expect(loadConfig({ ...fullEnv, TEST_MAILBOX_ADDRESS: "a@x.test, b@x.test" }).TEST_MAILBOX_ADDRESS).toBe(
      "a@x.test, b@x.test"
    );
    for (const bad of ["a@x.test,", ",a@x.test", "a@x.test,nope", "a@x.test b@x.test"]) {
      expect(configError({ ...fullEnv, TEST_MAILBOX_ADDRESS: bad }).keys).toContain("TEST_MAILBOX_ADDRESS");
    }
  });

  test("parses OPERATOR_CONTACT, treats empty as unset and rejects a non-address", () => {
    expect(loadConfig({ ...fullEnv, OPERATOR_CONTACT: "ops@example.test" }).OPERATOR_CONTACT).toBe("ops@example.test");
    expect(loadConfig({ ...fullEnv, OPERATOR_CONTACT: "" }).OPERATOR_CONTACT).toBeUndefined();
    expect(loadConfig(fullEnv).OPERATOR_CONTACT).toBeUndefined();
    expect(configError({ ...fullEnv, OPERATOR_CONTACT: "not-an-address" }).keys).toContain("OPERATOR_CONTACT");
  });

  test("sets the LLM defaults with only the S1a keys", () => {
    const config = loadConfig(geminiEnv);
    expect(config.GEMINI_API_KEY).toBeUndefined();
    expect(llmRoleTable(config).roles.classifier.model).toBe("gemini-3.5-flash-lite");
    expect(config.GEMINI_TIMEOUT_MS).toBe(30000);
    expect(config.GEMINI_RPM).toBe(12);
    expect(config.LLM_DAILY_CAP).toBe(300);
    expect(config.LLM_JUNK_DAILY_CAP).toBe(100);
    expect(config.TRIAGE_LLM_SCOPE).toBe("off");
  });

  test("treats an empty GEMINI_API_KEY as missing", () => {
    expect(loadConfig({ ...fullEnv, GEMINI_API_KEY: "" }).GEMINI_API_KEY).toBeUndefined();
  });

  test("throws ConfigError when TRIAGE_LLM_SCOPE=synthetic has no GEMINI_API_KEY", () => {
    expect(configError({ ...geminiEnv, TRIAGE_LLM_SCOPE: "synthetic" }).keys).toContain("GEMINI_API_KEY");
    expect(configError({ ...geminiEnv, TRIAGE_LLM_SCOPE: "synthetic", GEMINI_API_KEY: "" }).keys).toContain(
      "GEMINI_API_KEY"
    );
  });

  test("accepts TRIAGE_LLM_SCOPE=synthetic with a GEMINI_API_KEY", () => {
    const config = loadConfig({ ...geminiEnv, TRIAGE_LLM_SCOPE: "synthetic", GEMINI_API_KEY: "test-key" });
    expect(config.TRIAGE_LLM_SCOPE).toBe("synthetic");
    expect(config.GEMINI_API_KEY).toBe("test-key");
  });

  test("defaults ACTIONS_SCOPE to off and accepts the other two values", () => {
    expect(loadConfig(fullEnv).ACTIONS_SCOPE).toBe("off");
    expect(loadConfig({ ...fullEnv, ACTIONS_SCOPE: "synthetic" }).ACTIONS_SCOPE).toBe("synthetic");
  });

  test("all scopes start without TEST_MAILBOX_ADDRESS", () => {
    const config = loadConfig({
      ...geminiEnv,
      TRIAGE_LLM_SCOPE: "all",
      ACTIONS_SCOPE: "all",
      SEND_SCOPE: "all",
      GEMINI_API_KEY: "test-key",
    });
    expect(config.TRIAGE_LLM_SCOPE).toBe("all");
    expect(config.ACTIONS_SCOPE).toBe("all");
    expect(config.SEND_SCOPE).toBe("all");
    expect(config.TEST_MAILBOX_ADDRESS).toBeUndefined();
  });

  test("throws ConfigError when ACTIONS_SCOPE has a bad value", () => {
    expect(configError({ ...fullEnv, ACTIONS_SCOPE: "maybe" }).keys).toContain("ACTIONS_SCOPE");
  });

  test("throws ConfigError for the provider key when TRIAGE_LLM_SCOPE=all has none", () => {
    const error = configError({ ...geminiEnv, TRIAGE_LLM_SCOPE: "all" });
    expect(error.keys).toEqual(["GEMINI_API_KEY"]);
  });

  test("accepts TRIAGE_LLM_SCOPE=all with a GEMINI_API_KEY", () => {
    const config = loadConfig({ ...geminiEnv, TRIAGE_LLM_SCOPE: "all", GEMINI_API_KEY: "test-key" });
    expect(config.TRIAGE_LLM_SCOPE).toBe("all");
  });

  test("throws ConfigError when TRIAGE_LLM_SCOPE is bad", () => {
    expect(configError({ ...fullEnv, TRIAGE_LLM_SCOPE: "real" }).keys).toContain("TRIAGE_LLM_SCOPE");
  });

  test("an empty GEMINI_MODEL_CLASSIFIER loads and the tier model applies", () => {
    expect(llmRoleTable(loadConfig({ ...geminiEnv, GEMINI_MODEL_CLASSIFIER: "" })).roles.classifier.model).toBe(
      "gemini-3.5-flash-lite"
    );
  });

  test("an old .env with the removed writer keys still loads", () => {
    expect(() => loadConfig({ ...fullEnv, GEMINI_MODEL: "x", OPENAI_MODEL: "y" })).not.toThrow();
  });

  test("a set GEMINI_MODEL_CLASSIFIER is refused: the tier decides the model", () => {
    const error = configError({ ...geminiEnv, GEMINI_MODEL_CLASSIFIER: "gemini-3.1-flash-lite" });
    expect(error.keys).toEqual(["GEMINI_MODEL_CLASSIFIER"]);
    expect(error.message).not.toContain("gemini-3.1-flash-lite");
  });

  test("AUTH_PWNED_CHECK defaults to on, accepts off and refuses other values", () => {
    expect(loadConfig(fullEnv).AUTH_PWNED_CHECK).toBe("on");
    expect(loadConfig({ ...fullEnv, AUTH_PWNED_CHECK: "" }).AUTH_PWNED_CHECK).toBe("on");
    expect(loadConfig({ ...fullEnv, AUTH_PWNED_CHECK: "off" }).AUTH_PWNED_CHECK).toBe("off");
    expect(configError({ ...fullEnv, AUTH_PWNED_CHECK: "maybe" }).keys).toEqual(["AUTH_PWNED_CHECK"]);
  });

  test("accepts a TELEGRAM_BOT_TOKEN and treats an empty one as missing", () => {
    const token = "123456:ABCdefGhIJKlmNoPQRstuVWxyZ_-12345";
    expect(loadConfig({ ...fullEnv, TELEGRAM_BOT_TOKEN: token }).TELEGRAM_BOT_TOKEN).toBe(token);
    expect(loadConfig({ ...fullEnv, TELEGRAM_BOT_TOKEN: "" }).TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(loadConfig(fullEnv).TELEGRAM_BOT_TOKEN).toBeUndefined();
  });

  test("throws ConfigError when TELEGRAM_BOT_TOKEN is bad, with no value in the message", () => {
    const error = configError({ ...fullEnv, TELEGRAM_BOT_TOKEN: "abc" });
    expect(error.keys).toEqual(["TELEGRAM_BOT_TOKEN"]);
    expect(error.message).not.toContain("abc");
  });

  test("OPERATOR_TELEGRAM_CHAT_ID needs TELEGRAM_BOT_TOKEN and a number", () => {
    const token = "123456:ABCdefGhIJKlmNoPQRstuVWxyZ_-12345";
    expect(configError({ ...fullEnv, OPERATOR_TELEGRAM_CHAT_ID: "42" }).keys).toEqual(["OPERATOR_TELEGRAM_CHAT_ID"]);
    const config = loadConfig({ ...fullEnv, TELEGRAM_BOT_TOKEN: token, OPERATOR_TELEGRAM_CHAT_ID: "-1001234" });
    expect(operatorChatId(config)).toBe(-1001234);
    expect(configError({ ...fullEnv, TELEGRAM_BOT_TOKEN: token, OPERATOR_TELEGRAM_CHAT_ID: "abc" }).keys).toEqual([
      "OPERATOR_TELEGRAM_CHAT_ID",
    ]);
    expect(operatorChatId(loadConfig({ ...fullEnv, OPERATOR_TELEGRAM_CHAT_ID: "" }))).toBeNull();
  });

  test("reads the LLM numbers and rejects bad ones", () => {
    const config = loadConfig({
      ...fullEnv,
      GEMINI_TIMEOUT_MS: "5000",
      GEMINI_RPM: "3",
      LLM_DAILY_CAP: "50",
      LLM_JUNK_DAILY_CAP: "20",
    });
    expect(config.GEMINI_TIMEOUT_MS).toBe(5000);
    expect(config.GEMINI_RPM).toBe(3);
    expect(config.LLM_DAILY_CAP).toBe(50);
    expect(config.LLM_JUNK_DAILY_CAP).toBe(20);
    expect(configError({ ...fullEnv, GEMINI_RPM: "0" }).keys).toContain("GEMINI_RPM");
    expect(configError({ ...fullEnv, LLM_DAILY_CAP: "0" }).keys).toContain("LLM_DAILY_CAP");
    expect(configError({ ...fullEnv, LLM_JUNK_DAILY_CAP: "0" }).keys).toContain("LLM_JUNK_DAILY_CAP");
    expect(configError({ ...fullEnv, GEMINI_TIMEOUT_MS: "1.5" }).keys).toContain("GEMINI_TIMEOUT_MS");
  });

  test("sets LLM_PROVIDER to openai when unset or empty, and rejects an unknown one", () => {
    expect(loadConfig(fullEnv).LLM_PROVIDER).toBe("openai");
    expect(loadConfig({ ...fullEnv, LLM_PROVIDER: "" }).LLM_PROVIDER).toBe("openai");
    const error = configError({ ...fullEnv, LLM_PROVIDER: "foo" });
    expect(error.keys).toEqual(["LLM_PROVIDER"]);
    expect(error.message).not.toContain("foo");
  });

  test("sets the OpenAI defaults with only the S1a keys", () => {
    const config = loadConfig({ ...fullEnv, OPENAI_API_KEY: "" });
    expect(config.OPENAI_API_KEY).toBeUndefined();
    expect(llmRoleTable(config).roles.classifier).toMatchObject({ model: "gpt-6-luna", reasoningEffort: "none" });
    expect(config.OPENAI_TIMEOUT_MS).toBe(30000);
    expect(config.OPENAI_RPM).toBe(60);
  });

  test("rejects a bad OPENAI_RPM, and a set OPENAI_REASONING_EFFORT, with no value in the message", () => {
    expect(configError({ ...fullEnv, OPENAI_RPM: "0" }).keys).toContain("OPENAI_RPM");
    const error = configError({ ...fullEnv, OPENAI_REASONING_EFFORT: "bogus" });
    expect(error.keys).toContain("OPENAI_REASONING_EFFORT");
    expect(error.message).not.toContain("bogus");
  });

  test("accepts TRIAGE_LLM_SCOPE=synthetic with a GEMINI_API_KEY and no OPENAI_API_KEY", () => {
    expect(() =>
      loadConfig({ ...geminiEnv, TRIAGE_LLM_SCOPE: "synthetic", GEMINI_API_KEY: "test-key", OPENAI_API_KEY: "" })
    ).not.toThrow();
  });

  test("llmRoleTable returns the Gemini settings when LLM_PROVIDER=gemini", () => {
    const table = llmRoleTable(loadConfig({ ...geminiEnv, GEMINI_API_KEY: "test-key" }));
    expect(table.roles.classifier).toEqual({
      provider: "gemini",
      model: "gemini-3.5-flash-lite",
      timeoutMs: 30000,
      rpm: null,
      reasoningEffort: null,
    });
    expect(table.providers.gemini).toEqual({
      apiKeyName: "GEMINI_API_KEY",
      apiKey: "test-key",
      rpm: 12,
      baseUrl: null,
      endpoint: "standard",
    });
  });

  test("LLM_PROVIDER=openai needs OPENAI_API_KEY when the scope is not off", () => {
    const env = { ...fullEnv, LLM_PROVIDER: "openai", TRIAGE_LLM_SCOPE: "synthetic", GEMINI_API_KEY: "g-key" };
    expect(configError({ ...env, OPENAI_API_KEY: "" }).keys).toEqual(["OPENAI_API_KEY"]);
    expect(() => loadConfig({ ...env, GEMINI_API_KEY: "", OPENAI_API_KEY: "o-key" })).not.toThrow();
  });

  test("llmRoleTable returns the OpenAI settings", () => {
    const env = { ...fullEnv, OPENAI_API_KEY: "o-key" };
    const classifier = {
      provider: "openai" as const,
      model: "gpt-6-luna",
      timeoutMs: 30000,
      rpm: null,
      reasoningEffort: "none",
    };
    const provider = {
      apiKeyName: "OPENAI_API_KEY",
      apiKey: "o-key",
      rpm: 60,
      baseUrl: "https://api.openai.com/v1",
      endpoint: "standard" as const,
    };
    const table = llmRoleTable(loadConfig({ ...env, LLM_PROVIDER: "openai" }));
    expect(table.roles.classifier).toEqual(classifier);
    expect(table.providers.openai).toEqual(provider);
    const forced = llmRoleTable(loadConfig(env), { classifier: { provider: "openai" } });
    expect(forced.roles.classifier).toEqual(classifier);
    expect(forced.providers.openai).toEqual(provider);
  });
});
