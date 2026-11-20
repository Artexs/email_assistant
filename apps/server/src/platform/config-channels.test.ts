import { isLoopbackApiRoot } from "@ea/core";
import { describe, expect, test } from "bun:test";

import {
  authMailSettings,
  ConfigError,
  loadConfig,
  loadTestmailConfig,
  sendTestAddresses,
  testMailRule,
  mailAllowLocal,
  mailAllowLocalFromEnv,
  webTrustedOrigins,
  webTrustedProxies,
} from "./config";
import { fullEnv, configError } from "./config.test-helper";

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
