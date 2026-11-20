import { randomBytes } from "node:crypto";

import { DEFAULT_SEND_LIMITS, isLoopbackApiRoot } from "@ea/core";
import { describe, expect, test } from "bun:test";

import {
  authMailSettings,
  ConfigError,
  featuresOff,
  featuresOffFromEnv,
  llmRoleTable,
  loadConfig,
  loadTestmailConfig,
  mailSyncCron,
  mailTrustedAuthservIds,
  operatorChatId,
  operatorUserIds,
  pushConfigOf,
  sendLimits,
  sendTestAddresses,
  sloThresholds,
  testMailRule,
  mailAllowLocal,
  mailAllowLocalFromEnv,
  webTrustedOrigins,
  webTrustedProxies,
} from "./config";
import { generateVapidKeyPair } from "./vapid-keys";

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

  test("testMailRule splits, trims, lower-cases and removes duplicates", () => {
    expect(testMailRule(loadConfig({ ...fullEnv, TEST_SENDER_ADDRESSES: " A@b.test, c@d.test ,a@B.test," }))).toEqual({
      senders: ["a@b.test", "c@d.test"],
    });
  });

  test("testMailRule is empty when TEST_SENDER_ADDRESSES is empty or missing", () => {
    expect(testMailRule(loadConfig({ ...fullEnv, TEST_SENDER_ADDRESSES: "" }))).toEqual({ senders: [] });
    expect(testMailRule(loadConfig(fullEnv))).toEqual({ senders: [] });
  });

  test("TEST_SENDER_ADDRESSES refuses an entry that is not an address and names only the key", () => {
    const error = configError({ ...fullEnv, TEST_SENDER_ADDRESSES: "a@b.test, not-an-address" });
    expect(error.keys).toEqual(["TEST_SENDER_ADDRESSES"]);
    expect(error.message).not.toContain("not-an-address");
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

  test("MAIL_ALLOW_LOCAL_HOSTS wins over the old WEB_MAIL_ALLOW_LOCAL and takes only true or false", () => {
    const load = (extra: Record<string, string>) => loadConfig({ ...fullEnv, ...extra });
    expect(mailAllowLocal(load({ MAIL_ALLOW_LOCAL_HOSTS: "true" }))).toBe(true);
    expect(mailAllowLocal(load({ WEB_MAIL_ALLOW_LOCAL: "true" }))).toBe(true);
    expect(mailAllowLocal(load({ MAIL_ALLOW_LOCAL_HOSTS: "", WEB_MAIL_ALLOW_LOCAL: "" }))).toBe(false);
    expect(mailAllowLocal(load({}))).toBe(false);
    expect(mailAllowLocal(load({ MAIL_ALLOW_LOCAL_HOSTS: "false", WEB_MAIL_ALLOW_LOCAL: "true" }))).toBe(false);
    expect(load({ WEB_MAIL_ALLOW_LOCAL: "" }).WEB_MAIL_ALLOW_LOCAL).toBeUndefined();
    expect(configError({ ...fullEnv, MAIL_ALLOW_LOCAL_HOSTS: "yes" }).keys).toEqual(["MAIL_ALLOW_LOCAL_HOSTS"]);
    expect(configError({ ...fullEnv, WEB_MAIL_ALLOW_LOCAL: "yes" }).keys).toEqual(["WEB_MAIL_ALLOW_LOCAL"]);
  });

  test("mailAllowLocalFromEnv follows the same rule and counts an empty string as unset", () => {
    expect(mailAllowLocalFromEnv({ MAIL_ALLOW_LOCAL_HOSTS: "true" })).toBe(true);
    expect(mailAllowLocalFromEnv({ WEB_MAIL_ALLOW_LOCAL: "true" })).toBe(true);
    expect(mailAllowLocalFromEnv({})).toBe(false);
    expect(mailAllowLocalFromEnv({ MAIL_ALLOW_LOCAL_HOSTS: "false", WEB_MAIL_ALLOW_LOCAL: "true" })).toBe(false);
    expect(mailAllowLocalFromEnv({ MAIL_ALLOW_LOCAL_HOSTS: "", WEB_MAIL_ALLOW_LOCAL: "true" })).toBe(true);
    expect(mailAllowLocalFromEnv({ MAIL_ALLOW_LOCAL_HOSTS: "", WEB_MAIL_ALLOW_LOCAL: "" })).toBe(false);
  });
});

describe("auth mail settings", () => {
  const mailEnv = {
    AUTH_SMTP_HOST: "smtp.x.test",
    AUTH_SMTP_USER: "u",
    AUTH_SMTP_PASSWORD: "p",
    AUTH_MAIL_FROM: "noreply@x.test",
  };

  test("none of the keys: the sender is off", () => {
    expect(authMailSettings(loadConfig(fullEnv))).toBeNull();
    expect(authMailSettings(loadConfig({ ...fullEnv, AUTH_SMTP_HOST: "", AUTH_SMTP_PORT: "" }))).toBeNull();
  });

  test("the four keys give settings with port 465 and tls", () => {
    expect(authMailSettings(loadConfig({ ...fullEnv, ...mailEnv }))).toEqual({
      host: "smtp.x.test",
      port: 465,
      security: "tls",
      user: "u",
      password: "p",
      from: "noreply@x.test",
    });
  });

  test("port and security are read", () => {
    const settings = authMailSettings(
      loadConfig({ ...fullEnv, ...mailEnv, AUTH_SMTP_PORT: "587", AUTH_SMTP_SECURITY: "starttls" })
    );
    expect(settings?.port).toBe(587);
    expect(settings?.security).toBe("starttls");
  });

  test("a partial set names every missing key", () => {
    const { keys } = configError({ ...fullEnv, AUTH_SMTP_HOST: "smtp.x.test" });
    expect([...keys].sort()).toEqual(["AUTH_MAIL_FROM", "AUTH_SMTP_PASSWORD", "AUTH_SMTP_USER"]);
  });

  test("a bad security value is refused", () => {
    expect(configError({ ...fullEnv, ...mailEnv, AUTH_SMTP_SECURITY: "ssl" }).keys).toContain("AUTH_SMTP_SECURITY");
  });

  test("a bad from address is refused, with no value in the message", () => {
    const error = configError({ ...fullEnv, ...mailEnv, AUTH_MAIL_FROM: "not-an-address" });
    expect(error.keys).toContain("AUTH_MAIL_FROM");
    expect(error.message).not.toContain("not-an-address");
  });
});

describe("FEATURES_OFF", () => {
  test("unset or empty means no key", () => {
    expect(featuresOff(loadConfig(fullEnv))).toEqual([]);
    expect(featuresOff(loadConfig({ ...fullEnv, FEATURES_OFF: "" }))).toEqual([]);
  });

  test("the list is trimmed and unique, in the env order", () => {
    const config = loadConfig({ ...fullEnv, FEATURES_OFF: " sent_sync , stats_page,sent_sync" });
    expect(featuresOff(config)).toEqual(["sent_sync", "stats_page"]);
  });

  test("an unknown key stops the start and names the key of the setting only", () => {
    const error = configError({ ...fullEnv, FEATURES_OFF: "stats_page,stats_pag" });
    expect(error.keys).toEqual(["FEATURES_OFF"]);
    expect(error.message).not.toContain("stats_pag");
  });

  test("an Object.prototype name is not a flag key", () => {
    expect(configError({ ...fullEnv, FEATURES_OFF: "toString" }).keys).toEqual(["FEATURES_OFF"]);
  });

  test("featuresOffFromEnv reads raw env with the same rules", () => {
    expect(featuresOffFromEnv({})).toEqual([]);
    expect(featuresOffFromEnv({ FEATURES_OFF: "" })).toEqual([]);
    expect(featuresOffFromEnv({ FEATURES_OFF: "sent_sync, sent_sync" })).toEqual(["sent_sync"]);
    try {
      featuresOffFromEnv({ FEATURES_OFF: "nope" });
      throw new Error("did not throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).keys).toEqual(["FEATURES_OFF"]);
    }
  });
});

describe("MAIL_TRUSTED_AUTHSERV_IDS", () => {
  test("unset or empty means no id", () => {
    expect(mailTrustedAuthservIds(loadConfig(fullEnv))).toEqual([]);
    expect(mailTrustedAuthservIds(loadConfig({ ...fullEnv, MAIL_TRUSTED_AUTHSERV_IDS: "" }))).toEqual([]);
  });

  test("the list is trimmed, lower case and unique", () => {
    const config = loadConfig({ ...fullEnv, MAIL_TRUSTED_AUTHSERV_IDS: " MX.Corp.test , evil.test,mx.corp.test" });
    expect(mailTrustedAuthservIds(config)).toEqual(["mx.corp.test", "evil.test"]);
  });
});

describe("OPERATOR_USER_IDS", () => {
  const lower = "0b0f3b3e-6f1c-4d57-9d0e-3f0a8f6f2a11";

  test("unset or empty means no operator", () => {
    expect(operatorUserIds(loadConfig(fullEnv)).size).toBe(0);
    expect(operatorUserIds(loadConfig({ ...fullEnv, OPERATOR_USER_IDS: "" })).size).toBe(0);
  });

  test("the list is trimmed, lower-cased and unique", () => {
    const config = loadConfig({ ...fullEnv, OPERATOR_USER_IDS: `${lower.toUpperCase()}, ${lower}` });
    expect([...operatorUserIds(config)]).toEqual([lower]);
  });

  test("an entry that is not a UUID stops the start and names the key of the setting only", () => {
    const error = configError({ ...fullEnv, OPERATOR_USER_IDS: `${lower},admin` });
    expect(error.keys).toEqual(["OPERATOR_USER_IDS"]);
    expect(error.message).not.toContain("admin");
  });
});

describe("LOG_FORMAT", () => {
  test("defaults to json", () => {
    expect(loadConfig(fullEnv).LOG_FORMAT).toBe("json");
  });

  test("accepts text, and treats an empty value as json", () => {
    expect(loadConfig({ ...fullEnv, LOG_FORMAT: "text" }).LOG_FORMAT).toBe("text");
    expect(loadConfig({ ...fullEnv, LOG_FORMAT: "" }).LOG_FORMAT).toBe("json");
  });

  test("throws ConfigError for another value", () => {
    expect(configError({ ...fullEnv, LOG_FORMAT: "xml" }).keys).toContain("LOG_FORMAT");
  });
});

describe("EA_RELEASE", () => {
  test("defaults to dev, and an empty value is dev", () => {
    expect(loadConfig(fullEnv).EA_RELEASE).toBe("dev");
    expect(loadConfig({ ...fullEnv, EA_RELEASE: "" }).EA_RELEASE).toBe("dev");
  });

  test("accepts a version tag and a 40 character name", () => {
    expect(loadConfig({ ...fullEnv, EA_RELEASE: "v0.1.0" }).EA_RELEASE).toBe("v0.1.0");
    expect(loadConfig({ ...fullEnv, EA_RELEASE: "pre-v0.1.0" }).EA_RELEASE).toBe("pre-v0.1.0");
    expect(loadConfig({ ...fullEnv, EA_RELEASE: "a".repeat(40) }).EA_RELEASE).toBe("a".repeat(40));
  });

  test("a value with a space, or longer than 40 characters, throws ConfigError and names the key", () => {
    expect(configError({ ...fullEnv, EA_RELEASE: "v 1" }).keys).toEqual(["EA_RELEASE"]);
    expect(configError({ ...fullEnv, EA_RELEASE: "a".repeat(41) }).keys).toEqual(["EA_RELEASE"]);
  });
});

describe("send limits", () => {
  const keys = ["SEND_LIMIT_MAILBOX_HOUR", "SEND_LIMIT_MAILBOX_DAY", "SEND_LIMIT_RECIPIENT_DAY"] as const;

  test("no key set gives the PD-044 defaults", () => {
    expect(sendLimits(loadConfig(fullEnv))).toEqual({ mailboxHour: 20, mailboxDay: 100, recipientDay: 5 });
  });

  test("the schema default is the core default (one source)", () => {
    expect(sendLimits(loadConfig(fullEnv))).toEqual(DEFAULT_SEND_LIMITS);
    expect(DEFAULT_SEND_LIMITS).toEqual({ mailboxHour: 20, mailboxDay: 100, recipientDay: 5 });
  });

  test("values are read; an empty string is the default", () => {
    const env = {
      ...fullEnv,
      SEND_LIMIT_MAILBOX_HOUR: "3",
      SEND_LIMIT_MAILBOX_DAY: "40",
      SEND_LIMIT_RECIPIENT_DAY: "2",
    };
    expect(sendLimits(loadConfig(env))).toEqual({ mailboxHour: 3, mailboxDay: 40, recipientDay: 2 });
    const empty = { ...fullEnv, SEND_LIMIT_MAILBOX_HOUR: "", SEND_LIMIT_MAILBOX_DAY: "", SEND_LIMIT_RECIPIENT_DAY: "" };
    expect(sendLimits(loadConfig(empty))).toEqual({ mailboxHour: 20, mailboxDay: 100, recipientDay: 5 });
  });

  test("a bad value stops the start and names the key", () => {
    for (const key of keys) {
      for (const value of ["0", "-1", "1.5", "abc", "10001"]) {
        expect(configError({ ...fullEnv, [key]: value }).keys).toContain(key);
      }
    }
  });
});

describe("mailSyncCron", () => {
  test("no key (or an empty one) syncs every 2 minutes", () => {
    expect(loadConfig(fullEnv).MAIL_SYNC_EVERY_MIN).toBe("2");
    expect(mailSyncCron(loadConfig(fullEnv))).toBe("*/2 * * * *");
    expect(mailSyncCron(loadConfig({ ...fullEnv, MAIL_SYNC_EVERY_MIN: "" }))).toBe("*/2 * * * *");
  });

  test("3 and 5 are allowed", () => {
    expect(mailSyncCron(loadConfig({ ...fullEnv, MAIL_SYNC_EVERY_MIN: "3" }))).toBe("*/3 * * * *");
    expect(mailSyncCron(loadConfig({ ...fullEnv, MAIL_SYNC_EVERY_MIN: "5" }))).toBe("*/5 * * * *");
  });

  test("another value stops the start and names the key", () => {
    for (const value of ["4", "1", "0", "abc"]) {
      expect(configError({ ...fullEnv, MAIL_SYNC_EVERY_MIN: value }).keys).toContain("MAIL_SYNC_EVERY_MIN");
    }
  });
});

describe("mailbox OAuth keys (F117 D7)", () => {
  const web = { ...fullEnv, WEB_BASE_URL: "https://ea.x.test", WEB_AUTH_SECRET: randomBytes(32).toString("hex") };

  test("only MAIL_OAUTH_GOOGLE_CLIENT_ID set: loadConfig fails, names the missing key, not a value", () => {
    const error = configError({ ...web, MAIL_OAUTH_GOOGLE_CLIENT_ID: "id-canary" });
    expect(error.keys).toEqual(["MAIL_OAUTH_GOOGLE_CLIENT_SECRET"]);
    expect(error.message).toContain("MAIL_OAUTH_GOOGLE_CLIENT_SECRET");
    expect(error.message).not.toContain("id-canary");
  });

  test("only the secret set: loadConfig fails, names the client id, not the secret", () => {
    const error = configError({ ...web, MAIL_OAUTH_MICROSOFT_CLIENT_SECRET: "secret-canary" });
    expect(error.keys).toEqual(["MAIL_OAUTH_MICROSOFT_CLIENT_ID"]);
    expect(error.message).not.toContain("secret-canary");
  });

  test("a pair without WEB_BASE_URL fails and names WEB_BASE_URL", () => {
    const error = configError({
      ...fullEnv,
      MAIL_OAUTH_GOOGLE_CLIENT_ID: "id",
      MAIL_OAUTH_GOOGLE_CLIENT_SECRET: "secret-canary",
    });
    expect(error.keys).toEqual(["WEB_BASE_URL"]);
    expect(error.message).not.toContain("secret-canary");
  });

  test("a full pair with WEB_BASE_URL loads; an empty string counts as unset", () => {
    const config = loadConfig({
      ...web,
      MAIL_OAUTH_GOOGLE_CLIENT_ID: "id",
      MAIL_OAUTH_GOOGLE_CLIENT_SECRET: "secret",
      MAIL_OAUTH_MICROSOFT_CLIENT_ID: "",
      MAIL_OAUTH_MICROSOFT_CLIENT_SECRET: "",
    });
    expect(config.MAIL_OAUTH_GOOGLE_CLIENT_ID).toBe("id");
    expect(config.MAIL_OAUTH_MICROSOFT_CLIENT_ID).toBeUndefined();
  });
});

describe("OPERATOR_LOCALE (F114)", () => {
  test("empty gives en; pl is allowed; another value is refused", () => {
    expect(loadConfig(fullEnv).OPERATOR_LOCALE).toBe("en");
    expect(loadConfig({ ...fullEnv, OPERATOR_LOCALE: "" }).OPERATOR_LOCALE).toBe("en");
    expect(loadConfig({ ...fullEnv, OPERATOR_LOCALE: "pl" }).OPERATOR_LOCALE).toBe("pl");
    expect(configError({ ...fullEnv, OPERATOR_LOCALE: "de" }).keys).toEqual(["OPERATOR_LOCALE"]);
  });
});

describe("SLO thresholds (F114)", () => {
  test("1b. the disk and backup keys take values, decimals and an empty value", () => {
    const set = {
      ...fullEnv,
      SLO_DISK_PATH: "/data",
      SLO_DISK_FREE_PCT: "20",
      SLO_DISK_FREE_GB: "0.5",
      SLO_BACKUP_MAX_AGE_H: "48",
      BACKUP_STATUS_FILE: "/run/ea-backup/status.json",
    };
    expect(sloThresholds(loadConfig(set))).toMatchObject({
      diskPath: "/data",
      diskFreePct: 20,
      diskFreeGb: 0.5,
      backupMaxAgeH: 48,
      backupStatusFile: "/run/ea-backup/status.json",
    });
    const empty = { ...set, SLO_DISK_PATH: "", SLO_DISK_FREE_GB: "", BACKUP_STATUS_FILE: "" };
    expect(sloThresholds(loadConfig(empty))).toMatchObject({ diskPath: "/", diskFreeGb: 2, backupStatusFile: null });
  });

  test("1. no key set gives the defaults", () => {
    expect(sloThresholds(loadConfig(fullEnv))).toEqual({
      syncLagMin: 15,
      urgentLatencyMin: 10,
      llmWindowMin: 30,
      llmMinCalls: 5,
      llmFailPct: 20,
      llmClearPct: 10,
      repeatH: 6,
      diskPath: "/",
      diskFreePct: 15,
      diskFreeGb: 2,
      backupMaxAgeH: 26,
      backupStatusFile: null,
    });
    const empty = { ...fullEnv, SLO_SYNC_LAG_MIN: "", SLO_REPEAT_H: "" };
    expect(sloThresholds(loadConfig(empty)).syncLagMin).toBe(15);
    expect(sloThresholds(loadConfig({ ...fullEnv, SLO_SYNC_LAG_MIN: "30", SLO_REPEAT_H: "2" }))).toMatchObject({
      syncLagMin: 30,
      repeatH: 2,
    });
  });

  test("2. a clear percent that is not below the fail percent names both keys", () => {
    const keys = configError({ ...fullEnv, SLO_LLM_FAIL_PCT: "10", SLO_LLM_CLEAR_PCT: "10" }).keys;
    expect(keys).toContain("SLO_LLM_FAIL_PCT");
    expect(keys).toContain("SLO_LLM_CLEAR_PCT");
    expect(configError({ ...fullEnv, SLO_LLM_FAIL_PCT: "5", SLO_LLM_CLEAR_PCT: "30" }).keys).toContain(
      "SLO_LLM_CLEAR_PCT"
    );
    expect(() => loadConfig({ ...fullEnv, SLO_LLM_FAIL_PCT: "11", SLO_LLM_CLEAR_PCT: "10" })).not.toThrow();
  });

  test("3. a value out of range stops the start and names the key", () => {
    const bad: [string, string][] = [
      ["SLO_REPEAT_H", "0"],
      ["SLO_REPEAT_H", "169"],
      ["SLO_SYNC_LAG_MIN", "4"],
      ["SLO_SYNC_LAG_MIN", "1441"],
      ["SLO_URGENT_LATENCY_MIN", "0"],
      ["SLO_URGENT_LATENCY_MIN", "241"],
      ["SLO_LLM_WINDOW_MIN", "4"],
      ["SLO_LLM_MIN_CALLS", "0"],
      ["SLO_LLM_FAIL_PCT", "0"],
      ["SLO_LLM_FAIL_PCT", "101"],
      ["SLO_LLM_CLEAR_PCT", "-1"],
      ["SLO_LLM_CLEAR_PCT", "1.5"],
      ["SLO_DISK_FREE_PCT", "0"],
      ["SLO_DISK_FREE_PCT", "91"],
      ["SLO_DISK_FREE_GB", "0.4"],
      ["SLO_DISK_FREE_GB", "101"],
      ["SLO_BACKUP_MAX_AGE_H", "0"],
      ["SLO_BACKUP_MAX_AGE_H", "721"],
      ["SLO_DISK_PATH", "data"],
      ["BACKUP_STATUS_FILE", "status.json"],
    ];
    for (const [key, value] of bad) {
      expect(configError({ ...fullEnv, [key]: value }).keys).toContain(key);
    }
  });
});

describe("VAPID keys (Web Push, F118)", () => {
  const pair = generateVapidKeyPair();
  const vapidEnv = {
    ...fullEnv,
    VAPID_PUBLIC_KEY: pair.publicKey,
    VAPID_PRIVATE_KEY: pair.privateKey,
    VAPID_SUBJECT: "mailto:ops@example.org",
  };

  test("1. one or two of the three keys set: ConfigError names the missing key, never a value", () => {
    const names = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const;
    for (const missing of names) {
      const partial = Object.fromEntries(Object.entries(vapidEnv).filter(([key]) => key !== missing));
      const error = configError(partial);
      expect({ missing, keys: error.keys }).toEqual({ missing, keys: [missing] });
      expect(error.message).not.toContain(pair.privateKey);
      expect(error.message).not.toContain(pair.publicKey);
    }
    const onlyOne = configError({ ...fullEnv, VAPID_PRIVATE_KEY: pair.privateKey });
    expect(onlyOne.keys.sort()).toEqual(["VAPID_PUBLIC_KEY", "VAPID_SUBJECT"]);
    expect(onlyOne.message).not.toContain(pair.privateKey);
    expect(configError({ ...vapidEnv, VAPID_SUBJECT: "" }).keys).toEqual(["VAPID_SUBJECT"]);
  });

  test("2. none set: pushConfigOf is null (also with empty values); all set: the keys", () => {
    expect(pushConfigOf(loadConfig(fullEnv))).toBeNull();
    expect(
      pushConfigOf(loadConfig({ ...fullEnv, VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "", VAPID_SUBJECT: "" }))
    ).toBeNull();
    expect(pushConfigOf(loadConfig(vapidEnv))).toEqual({
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
      subject: "mailto:ops@example.org",
    });
    expect(pushConfigOf(loadConfig({ ...vapidEnv, VAPID_SUBJECT: "https://example.org/contact" }))?.subject).toBe(
      "https://example.org/contact"
    );
  });

  test("3. a public key that does not match the private key: ConfigError vapid_key_mismatch, no key text", () => {
    const other = generateVapidKeyPair();
    const error = configError({ ...vapidEnv, VAPID_PUBLIC_KEY: other.publicKey });
    expect(error.keys).toEqual(["VAPID_PUBLIC_KEY"]);
    expect(error.codes).toEqual(["vapid_key_mismatch"]);
    expect(error.message).toContain("vapid_key_mismatch");
    for (const secret of [pair.privateKey, pair.publicKey, other.publicKey, other.privateKey])
      expect(error.message).not.toContain(secret);
  });

  test("4. a key of the wrong shape and a subject that is no mailto: or https: URI are refused, with no value in the message", () => {
    const secretLike = "s3cretvaluethatisnotakey";
    for (const [key, value] of [
      ["VAPID_PRIVATE_KEY", secretLike],
      ["VAPID_PRIVATE_KEY", pair.privateKey.slice(0, 40)],
      ["VAPID_PRIVATE_KEY", `${pair.privateKey}=`],
      ["VAPID_PUBLIC_KEY", secretLike],
      ["VAPID_PUBLIC_KEY", pair.publicKey.slice(0, 80)],
      ["VAPID_SUBJECT", "ops@example.org"],
      ["VAPID_SUBJECT", "http://example.org"],
      ["VAPID_SUBJECT", "mailto:not an address"],
    ] as const) {
      const error = configError({ ...vapidEnv, [key]: value });
      expect({ key, value, keys: error.keys.includes(key) }).toEqual({ key, value, keys: true });
      expect(error.message).not.toContain(value);
    }
  });
});
