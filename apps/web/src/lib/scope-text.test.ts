import { describe, expect, test } from "bun:test";

import type { MailboxView } from "@ea/core/web";

import { badgeKey, reasonKeys } from "./scope-text";

type Scopes = MailboxView["scopes"];

const allOn: Scopes = {
  triage: { state: "on", reason: "all_mailboxes" },
  actions: { state: "on", reason: "by_mode" },
  send: { state: "on", reason: "after_approval" },
};

describe("reasonKeys", () => {
  test("all on gives the by-mode and after-approval lines", () => {
    expect(reasonKeys(allOn)).toEqual(["reason_by_mode", "reason_after_approval"]);
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
    expect(reasonKeys(scopes)).toEqual(["reason_by_mode", "reason_test_addresses_only"]);
  });
});

describe("badgeKey", () => {
  test("a state the server never sends falls back to off", () => {
    expect(badgeKey("triage", "self")).toBe("badge_triage_off");
    expect(badgeKey("send", "synthetic")).toBe("badge_send_off");
  });
});
