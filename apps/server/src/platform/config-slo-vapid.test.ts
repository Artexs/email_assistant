import { describe, expect, test } from "bun:test";

import { loadConfig, pushConfigOf, sloThresholds } from "./config";
import { fullEnv, configError } from "./config.test-helper";
import { generateVapidKeyPair } from "./vapid-keys";

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
