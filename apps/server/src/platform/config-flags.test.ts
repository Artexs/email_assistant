import { randomBytes } from "node:crypto";

import { DEFAULT_SEND_LIMITS } from "@ea/core";
import { describe, expect, test } from "bun:test";

import {
  ConfigError,
  featuresOff,
  featuresOffFromEnv,
  loadConfig,
  mailSyncCron,
  mailTrustedAuthservIds,
  operatorUserIds,
  sendLimits,
} from "./config";
import { fullEnv, configError } from "./config.test-helper";

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
