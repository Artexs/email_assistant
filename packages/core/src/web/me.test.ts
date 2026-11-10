import { describe, expect, test } from "bun:test";

import { meSchema, scopeInfoOf } from "./me";

const scope = scopeInfoOf("off");
const me = {
  user: { id: "0190f5a0-0000-7000-8000-000000000001", email: "a@b.com", displayName: "Ann" },
  organization: { id: "0190f5a0-0000-7000-8000-000000000002", name: "Org", timezone: "Europe/Warsaw" },
  role: "owner",
  telegram: null,
  onboarding: null,
  scopes: { triage: scope, actions: scopeInfoOf("synthetic"), send: scopeInfoOf("self") },
  mailboxCount: 1,
  mailboxesInAuthError: 0,
};

describe("scopeInfoOf", () => {
  test("maps each env kind to its UI reason", () => {
    expect(scopeInfoOf("off")).toEqual({ kind: "off", reason: "env_off" });
    expect(scopeInfoOf("synthetic")).toEqual({ kind: "synthetic", reason: "synthetic_only" });
    expect(scopeInfoOf("self")).toEqual({ kind: "self", reason: "test_addresses_only" });
    expect(scopeInfoOf("all")).toEqual({ kind: "all", reason: "test_mailbox_only" });
  });
});

describe("meSchema", () => {
  test("accepts a full object", () => {
    expect(meSchema.safeParse(me).success).toBe(true);
  });

  test("refuses an onboarding object", () => {
    expect(meSchema.safeParse({ ...me, onboarding: {} }).success).toBe(false);
  });
});
