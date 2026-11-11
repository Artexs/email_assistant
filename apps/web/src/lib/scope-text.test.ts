import { describe, expect, test } from "bun:test";

import type { MailboxView } from "@ea/core/web";

import { badgeKey, reasonKeys } from "./scope-text";

type Scopes = MailboxView["scopes"];

const allOn: Scopes = {
  triage: { state: "on", reason: "test_mailbox_only" },
  actions: { state: "on", reason: "test_mailbox_only" },
  send: { state: "on", reason: "test_mailbox_only" },
};

describe("reasonKeys", () => {
  test("all on gives no reason", () => {
    expect(reasonKeys(allOn)).toEqual([]);
  });

  test("triage and actions other_mailbox give one line", () => {
    const scopes: Scopes = {
      triage: { state: "off", reason: "other_mailbox" },
      actions: { state: "off", reason: "other_mailbox" },
      send: { state: "on", reason: "test_mailbox_only" },
    };
    expect(reasonKeys(scopes)).toEqual(["reason_other_mailbox"]);
  });

  test("three env_off give three keys in order", () => {
    const off = { state: "off", reason: "env_off" } as const;
    expect(reasonKeys({ triage: off, actions: off, send: off })).toEqual([
      "reason_triage_env_off",
      "reason_actions_env_off",
      "reason_send_env_off",
    ]);
  });

  test("send self gives its badge and reason", () => {
    const scopes: Scopes = { ...allOn, send: { state: "self", reason: "test_addresses_only" } };
    expect(badgeKey("send", "self")).toBe("badge_send_self");
    expect(reasonKeys(scopes)).toEqual(["reason_test_addresses_only"]);
  });
});

describe("badgeKey", () => {
  test("a state the server never sends falls back to off", () => {
    expect(badgeKey("triage", "self")).toBe("badge_triage_off");
    expect(badgeKey("send", "synthetic")).toBe("badge_send_off");
  });
});
