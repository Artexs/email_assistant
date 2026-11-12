import { describe, expect, test } from "bun:test";

import {
  connectMailboxBodySchema,
  mailboxScopeBadges,
  mailboxViewSchema,
  sameAddress,
  type ScopeEnv,
} from "./mailboxes";
import { telegramLinkSchema } from "./telegram";

const plainBody = { address: "a@gmail.com", password: "p w", secretKind: "app_password" };
const presetBody = { ...plainBody, preset: "gmail" };

function issuesOf(body: unknown): { path: string; message: string }[] {
  const result = connectMailboxBodySchema.safeParse(body);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

describe("connectMailboxBodySchema", () => {
  test("accepts a preset body and keeps the password as it is", () => {
    const result = connectMailboxBodySchema.safeParse(presetBody);
    expect(result.success).toBe(true);
    expect(result.data?.password).toBe("p w");
  });

  test("refuses a server field with a preset", () => {
    expect(issuesOf({ ...presetBody, imapHost: "imap.x.pl" })).toEqual([
      { path: "imapHost", message: "not_with_preset" },
    ]);
  });

  test("requires all four server fields without a preset", () => {
    expect(issuesOf({ ...plainBody, imapHost: "h", imapPort: 993 })).toEqual([
      { path: "smtpHost", message: "required" },
      { path: "smtpPort", message: "required" },
    ]);
  });

  test("refuses a bad port, host, address and preset", () => {
    const custom = { ...plainBody, imapHost: "h", imapPort: 993, smtpHost: "h", smtpPort: 465 };
    expect(connectMailboxBodySchema.safeParse(custom).success).toBe(true);
    expect(connectMailboxBodySchema.safeParse({ ...custom, imapPort: 70000 }).success).toBe(false);
    expect(connectMailboxBodySchema.safeParse({ ...custom, imapHost: "bad host" }).success).toBe(false);
    expect(connectMailboxBodySchema.safeParse({ ...presetBody, address: "not-an-address" }).success).toBe(false);
    expect(connectMailboxBodySchema.safeParse({ ...presetBody, preset: "yahoo" }).success).toBe(false);
  });
});

describe("mailboxScopeBadges", () => {
  test("all gives the reasons of the scope", () => {
    expect(mailboxScopeBadges({ triage: "all", actions: "all", send: "all" })).toEqual({
      triage: { state: "on", reason: "all_mailboxes" },
      actions: { state: "on", reason: "by_mode" },
      send: { state: "on", reason: "after_approval" },
    });
  });

  test("off, synthetic and self keep their reasons", () => {
    expect(mailboxScopeBadges({ triage: "off", actions: "synthetic", send: "self" })).toEqual({
      triage: { state: "off", reason: "env_off" },
      actions: { state: "synthetic", reason: "synthetic_only" },
      send: { state: "self", reason: "test_addresses_only" },
    });
  });

  test("everything off", () => {
    const off = { state: "off", reason: "env_off" } as const;
    expect(mailboxScopeBadges({ triage: "off", actions: "off", send: "off" })).toEqual({
      triage: off,
      actions: off,
      send: off,
    });
  });
});

describe("mailboxViewSchema", () => {
  const badge = { state: "off", reason: "env_off" };
  const view = {
    id: "0b0f6f0e-6f0e-4f0e-8f0e-0f0e6f0e6f0e",
    address: "a@x.pl",
    status: "active",
    statusChangedAt: "2026-11-11T10:00:00.000Z",
    createdAt: "2026-11-11T10:00:00.000Z",
    lastSyncedAt: null,
    mode: null,
    movesSupported: true,
    secretKind: "password",
    scopes: { triage: badge, actions: badge, send: badge },
  };

  test("parses a view without sync time and mode", () => {
    expect(mailboxViewSchema.safeParse(view).success).toBe(true);
  });

  test("refuses an unknown status", () => {
    expect(mailboxViewSchema.safeParse({ ...view, status: "deleted" }).success).toBe(false);
  });
});

describe("sameAddress", () => {
  test("compares trimmed and lower-cased", () => {
    expect(sameAddress(" A@x.PL ", "a@x.pl")).toBe(true);
    expect(sameAddress("a@x.pl", "b@x.pl")).toBe(false);
  });
});

describe("telegramLinkSchema", () => {
  test("refuses a bad url", () => {
    expect(telegramLinkSchema.safeParse({ url: "not a url", expiresAt: "2026-11-11T10:00:00.000Z" }).success).toBe(
      false
    );
  });
});
