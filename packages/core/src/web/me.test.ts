import { describe, expect, test } from "bun:test";

import { meSchema, scopeInfoOf } from "./me";

const scope = scopeInfoOf("triage", "off");
const me = {
  user: { id: "0190f5a0-0000-7000-8000-000000000001", email: "a@b.com", displayName: "Ann" },
  organization: { id: "0190f5a0-0000-7000-8000-000000000002", name: "Org", timezone: "Europe/Warsaw" },
  role: "owner",
  telegram: { available: true, linked: false, botUsername: "ea_bot" },
  onboarding: { mailbox: true, telegram: false, telegramAvailable: true, mode: false, rules: 0, done: false },
  scopes: { triage: scope, actions: scopeInfoOf("actions", "synthetic"), send: scopeInfoOf("send", "self") },
  mailboxCount: 1,
  mailboxesInAuthError: 0,
  digestTimes: ["08:00"],
};

describe("scopeInfoOf", () => {
  test("maps each env kind to its UI reason", () => {
    expect(scopeInfoOf("triage", "off")).toEqual({ kind: "off", reason: "env_off" });
    expect(scopeInfoOf("triage", "synthetic")).toEqual({ kind: "synthetic", reason: "synthetic_only" });
    expect(scopeInfoOf("send", "self")).toEqual({ kind: "self", reason: "test_addresses_only" });
    expect(scopeInfoOf("triage", "all")).toEqual({ kind: "all", reason: "all_mailboxes" });
    expect(scopeInfoOf("actions", "all")).toEqual({ kind: "all", reason: "by_mode" });
    expect(scopeInfoOf("send", "all")).toEqual({ kind: "all", reason: "after_approval" });
  });
});

describe("meSchema", () => {
  test("accepts a full object", () => {
    expect(meSchema.safeParse(me).success).toBe(true);
  });

  test("refuses an object without digestTimes", () => {
    expect(meSchema.safeParse({ ...me, digestTimes: undefined }).success).toBe(false);
  });

  test("refuses the old null fields", () => {
    expect(meSchema.safeParse({ ...me, telegram: null }).success).toBe(false);
    expect(meSchema.safeParse({ ...me, onboarding: null }).success).toBe(false);
  });

  test("refuses an incomplete onboarding object", () => {
    expect(meSchema.safeParse({ ...me, onboarding: {} }).success).toBe(false);
  });
});
