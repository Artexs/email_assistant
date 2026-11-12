import { randomBytes } from "node:crypto";

import { describe, expect, test } from "bun:test";

import {
  classifierModel,
  ConfigError,
  isLoopbackApiRoot,
  llmSettings,
  loadConfig,
  loadTestmailConfig,
  operatorChatId,
  sendTestAddresses,
  webMailAllowLocal,
  webTrustedOrigins,
  webTrustedProxies,
} from "./config";

const fullEnv = {
  DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/email_assistant",
  CREDENTIALS_KEY: randomBytes(32).toString("base64"),
};

const geminiEnv = { ...fullEnv, LLM_PROVIDER: "gemini" };

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

  test("parses OPERATOR_CONTACT, treats empty as unset and rejects a non-address", () => {
    expect(loadConfig({ ...fullEnv, OPERATOR_CONTACT: "ops@example.test" }).OPERATOR_CONTACT).toBe("ops@example.test");
    expect(loadConfig({ ...fullEnv, OPERATOR_CONTACT: "" }).OPERATOR_CONTACT).toBeUndefined();
    expect(loadConfig(fullEnv).OPERATOR_CONTACT).toBeUndefined();
    expect(configError({ ...fullEnv, OPERATOR_CONTACT: "not-an-address" }).keys).toContain("OPERATOR_CONTACT");
  });

  test("sets the LLM defaults with only the S1a keys", () => {
    const config = loadConfig(geminiEnv);
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

  test("treats an empty GEMINI_MODEL_CLASSIFIER as the default", () => {
    expect(loadConfig({ ...fullEnv, GEMINI_MODEL_CLASSIFIER: "" }).GEMINI_MODEL_CLASSIFIER).toBe(
      "gemini-3.5-flash-lite"
    );
  });

  test("treats an empty GEMINI_MODEL as the default", () => {
    expect(loadConfig({ ...fullEnv, GEMINI_MODEL: "" }).GEMINI_MODEL).toBe("gemini-3.8-flash");
  });

  test("classifierModel returns the set GEMINI_MODEL_CLASSIFIER", () => {
    const config = loadConfig({ ...geminiEnv, GEMINI_MODEL_CLASSIFIER: "gemini-3.1-flash-lite" });
    expect(classifierModel(config)).toBe("gemini-3.1-flash-lite");
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
    const config = loadConfig({ ...fullEnv, GEMINI_TIMEOUT_MS: "5000", GEMINI_RPM: "3", LLM_DAILY_CAP: "50" });
    expect(config.GEMINI_TIMEOUT_MS).toBe(5000);
    expect(config.GEMINI_RPM).toBe(3);
    expect(config.LLM_DAILY_CAP).toBe(50);
    expect(configError({ ...fullEnv, GEMINI_RPM: "0" }).keys).toContain("GEMINI_RPM");
    expect(configError({ ...fullEnv, LLM_DAILY_CAP: "0" }).keys).toContain("LLM_DAILY_CAP");
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
    const config = loadConfig({ ...fullEnv, OPENAI_API_KEY: "", OPENAI_MODEL: "" });
    expect(config.OPENAI_API_KEY).toBeUndefined();
    expect(config.OPENAI_MODEL).toBe("gpt-6.1-terra");
    expect(config.OPENAI_MODEL_CLASSIFIER).toBe("gpt-6-luna");
    expect(config.OPENAI_TIMEOUT_MS).toBe(30000);
    expect(config.OPENAI_RPM).toBe(60);
    expect(config.OPENAI_REASONING_EFFORT).toBe("none");
  });

  test("rejects a bad OPENAI_RPM and a bad OPENAI_REASONING_EFFORT, with no value in the message", () => {
    expect(configError({ ...fullEnv, OPENAI_RPM: "0" }).keys).toContain("OPENAI_RPM");
    const error = configError({ ...fullEnv, OPENAI_REASONING_EFFORT: "bogus" });
    expect(error.keys).toContain("OPENAI_REASONING_EFFORT");
    expect(error.message).not.toContain("bogus");
    expect(loadConfig({ ...fullEnv, OPENAI_REASONING_EFFORT: "xhigh" }).OPENAI_REASONING_EFFORT).toBe("xhigh");
  });

  test("accepts TRIAGE_LLM_SCOPE=synthetic with a GEMINI_API_KEY and no OPENAI_API_KEY", () => {
    expect(() =>
      loadConfig({ ...geminiEnv, TRIAGE_LLM_SCOPE: "synthetic", GEMINI_API_KEY: "test-key", OPENAI_API_KEY: "" })
    ).not.toThrow();
  });

  test("llmSettings returns the Gemini settings when LLM_PROVIDER=gemini", () => {
    const config = loadConfig({ ...geminiEnv, GEMINI_API_KEY: "test-key" });
    expect(llmSettings(config)).toEqual({
      provider: "gemini",
      apiKeyName: "GEMINI_API_KEY",
      apiKey: "test-key",
      classifierModel: "gemini-3.5-flash-lite",
      writerModel: "gemini-3.8-flash",
      timeoutMs: 30000,
      rpm: 12,
      reasoningEffort: null,
    });
  });

  test("LLM_PROVIDER=openai needs OPENAI_API_KEY when the scope is not off", () => {
    const env = { ...fullEnv, LLM_PROVIDER: "openai", TRIAGE_LLM_SCOPE: "synthetic", GEMINI_API_KEY: "g-key" };
    expect(configError({ ...env, OPENAI_API_KEY: "" }).keys).toEqual(["OPENAI_API_KEY"]);
    expect(() => loadConfig({ ...env, GEMINI_API_KEY: "", OPENAI_API_KEY: "o-key" })).not.toThrow();
  });

  test("llmSettings returns the OpenAI settings", () => {
    const env = { ...fullEnv, OPENAI_API_KEY: "o-key" };
    const expected = {
      provider: "openai" as const,
      apiKeyName: "OPENAI_API_KEY",
      apiKey: "o-key",
      classifierModel: "gpt-6-luna",
      writerModel: "gpt-6.1-terra",
      timeoutMs: 30000,
      rpm: 60,
      reasoningEffort: "none",
    };
    expect(llmSettings(loadConfig({ ...env, LLM_PROVIDER: "openai" }))).toEqual(expected);
    expect(llmSettings(loadConfig(env), "openai")).toEqual(expected);
  });
});

describe("TELEGRAM_API_ROOT", () => {
  test.each(["http://127.0.0.1:8090", "http://localhost:8090", "http://[::1]:8090", "https://127.0.0.1"])(
    "accepts %s",
    (value) => {
      expect(isLoopbackApiRoot(value)).toBe(true);
      expect(loadConfig({ ...fullEnv, TELEGRAM_API_ROOT: value }).TELEGRAM_API_ROOT).toBe(value);
    }
  );

  test("empty or missing is undefined", () => {
    expect(loadConfig({ ...fullEnv, TELEGRAM_API_ROOT: "" }).TELEGRAM_API_ROOT).toBeUndefined();
    expect(loadConfig(fullEnv).TELEGRAM_API_ROOT).toBeUndefined();
  });

  test.each([
    "https://api.telegram.org",
    "http://10.0.0.5:8090",
    "http://127.0.0.1.example.test",
    "http://localhost.example.test",
    "http://127.0.0.1@evil.test",
    "http://user:pw@127.0.0.1:8090",
    "http://127.0.0.1:8090/",
    "http://127.0.0.1:8090/bot",
    "http://127.0.0.1:8090?",
    "http://127.0.0.1:8090#",
    "ftp://127.0.0.1",
    "127.0.0.1:8090",
    "http://0.0.0.0:8090",
  ])("rejects %s, with no value in the message", (value) => {
    expect(isLoopbackApiRoot(value)).toBe(false);
    const error = configError({ ...fullEnv, TELEGRAM_API_ROOT: value });
    expect(error.keys).toEqual(["TELEGRAM_API_ROOT"]);
    expect(error.message).not.toContain(value);
  });
});

describe("SEND_SCOPE", () => {
  test("defaults to off and needs no address list", () => {
    const config = loadConfig(fullEnv);
    expect(config.SEND_SCOPE).toBe("off");
    expect(sendTestAddresses(config)).toEqual([]);
  });

  test("rejects a value that is not off, self or all", () => {
    expect(configError({ ...fullEnv, SEND_SCOPE: "yes" }).keys).toEqual(["SEND_SCOPE"]);
  });

  test("self needs at least one address in SEND_TEST_ADDRESSES", () => {
    expect(configError({ ...fullEnv, SEND_SCOPE: "self" }).keys).toEqual(["SEND_TEST_ADDRESSES"]);
    expect(configError({ ...fullEnv, SEND_SCOPE: "self", SEND_TEST_ADDRESSES: " , " }).keys).toEqual([
      "SEND_TEST_ADDRESSES",
    ]);
    expect(configError({ ...fullEnv, SEND_SCOPE: "self", SEND_TEST_ADDRESSES: "a@x.test, nope" }).keys).toEqual([
      "SEND_TEST_ADDRESSES",
    ]);
  });

  test("sendTestAddresses splits, trims, lower-cases and removes duplicates", () => {
    const config = loadConfig({
      ...fullEnv,
      SEND_SCOPE: "self",
      SEND_TEST_ADDRESSES: "A@x.test, b@x.test,a@X.test",
    });
    expect(sendTestAddresses(config)).toEqual(["a@x.test", "b@x.test"]);
  });

  test("all needs no other key", () => {
    expect(loadConfig({ ...fullEnv, SEND_SCOPE: "all" }).SEND_SCOPE).toBe("all");
  });

  test("an empty SEND_TEST_ADDRESSES counts as missing", () => {
    expect(loadConfig({ ...fullEnv, SEND_TEST_ADDRESSES: "" }).SEND_TEST_ADDRESSES).toBeUndefined();
  });
});

describe("loadTestmailConfig", () => {
  test("throws ConfigError with the key name when AGENTMAIL_API_KEY is missing", () => {
    try {
      loadTestmailConfig({});
      throw new Error("did not throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).keys).toContain("AGENTMAIL_API_KEY");
    }
  });

  test("with the key only, the base URL has its default", () => {
    const config = loadTestmailConfig({ AGENTMAIL_API_KEY: "k-test-1234567890", AGENTMAIL_BASE_URL: "" });
    expect(config.AGENTMAIL_BASE_URL).toBe("https://api.agentmail.to/v0");
    expect(config.TEST_MAILBOX_ADDRESS).toBeUndefined();
  });

  test("loadConfig works without the AgentMail keys", () => {
    expect(() => loadConfig(fullEnv)).not.toThrow();
  });
});

describe("web keys", () => {
  const secret32 = "x".repeat(32);

  test("empty web keys are undefined and WEB_DIST has its default", () => {
    const config = loadConfig({
      ...fullEnv,
      WEB_BASE_URL: "",
      WEB_AUTH_SECRET: "",
      WEB_TRUSTED_ORIGINS: "",
      WEB_TRUSTED_PROXIES: "",
      WEB_DIST: "",
    });
    expect(config.WEB_BASE_URL).toBeUndefined();
    expect(config.WEB_AUTH_SECRET).toBeUndefined();
    expect(config.WEB_TRUSTED_ORIGINS).toBeUndefined();
    expect(config.WEB_TRUSTED_PROXIES).toBeUndefined();
    expect(config.WEB_DIST).toBe("apps/web/dist");
    expect(webTrustedOrigins(config)).toEqual([]);
    expect(webTrustedProxies(config)).toEqual([]);
  });

  test("WEB_BASE_URL needs WEB_AUTH_SECRET of 32 characters", () => {
    const base = { ...fullEnv, WEB_BASE_URL: "https://ea.example.ts.net" };
    expect(configError(base).keys).toEqual(["WEB_AUTH_SECRET"]);
    expect(configError({ ...base, WEB_AUTH_SECRET: "x".repeat(31) }).keys).toEqual(["WEB_AUTH_SECRET"]);
    expect(loadConfig({ ...base, WEB_AUTH_SECRET: secret32 }).WEB_BASE_URL).toBe("https://ea.example.ts.net");
  });

  test("WEB_BASE_URL is an origin", () => {
    expect(configError({ ...fullEnv, WEB_BASE_URL: "https://x.test/panel", WEB_AUTH_SECRET: secret32 }).keys).toEqual([
      "WEB_BASE_URL",
    ]);
    expect(() =>
      loadConfig({ ...fullEnv, WEB_BASE_URL: "http://localhost:4321", WEB_AUTH_SECRET: secret32 })
    ).not.toThrow();
  });

  test("WEB_TRUSTED_ORIGINS is a trimmed list of origins", () => {
    const config = loadConfig({ ...fullEnv, WEB_TRUSTED_ORIGINS: "http://127.0.0.1:8080, http://localhost:8080" });
    expect(webTrustedOrigins(config)).toEqual(["http://127.0.0.1:8080", "http://localhost:8080"]);
    expect(configError({ ...fullEnv, WEB_TRUSTED_ORIGINS: "http://x.test/" }).keys).toEqual(["WEB_TRUSTED_ORIGINS"]);
  });

  test("WEB_TRUSTED_PROXIES is a list of IPs or CIDRs", () => {
    const config = loadConfig({ ...fullEnv, WEB_TRUSTED_PROXIES: "172.18.0.1, 10.0.0.0/8, fd00::/8" });
    expect(webTrustedProxies(config)).toEqual(["172.18.0.1", "10.0.0.0/8", "fd00::/8"]);
    expect(configError({ ...fullEnv, WEB_TRUSTED_PROXIES: "172.18.0.1/33" }).keys).toEqual(["WEB_TRUSTED_PROXIES"]);
    expect(configError({ ...fullEnv, WEB_TRUSTED_PROXIES: "gateway" }).keys).toEqual(["WEB_TRUSTED_PROXIES"]);
  });

  test("WEB_MAIL_ALLOW_LOCAL is false by default and takes only true or false", () => {
    const empty = loadConfig({ ...fullEnv, WEB_MAIL_ALLOW_LOCAL: "" });
    expect(empty.WEB_MAIL_ALLOW_LOCAL).toBe("false");
    expect(webMailAllowLocal(empty)).toBe(false);
    expect(webMailAllowLocal(loadConfig({ ...fullEnv, WEB_MAIL_ALLOW_LOCAL: "true" }))).toBe(true);
    expect(configError({ ...fullEnv, WEB_MAIL_ALLOW_LOCAL: "yes" }).keys).toEqual(["WEB_MAIL_ALLOW_LOCAL"]);
  });
});
