import { describe, expect, test } from "bun:test";

import { mailboxStatuses, type MailboxView } from "@ea/core/web";

import type { TextKey } from "../i18n";
import { en } from "../i18n/en";
import { pl } from "../i18n/pl";

import { mailboxCardHint, mailboxCardState, mailboxStatusUi, type MailboxCardState } from "./mailbox-status";

const SYNCED = "2026-11-20T08:00:00.000Z";

function view(overrides: Partial<MailboxView>): MailboxView {
  return {
    id: "6f1d0b3c-8a2e-4f7a-9d55-3b1c2a4e5f60",
    address: "anna@example.com",
    status: "active",
    statusChangedAt: SYNCED,
    createdAt: SYNCED,
    lastSyncedAt: SYNCED,
    mode: "shadow",
    movesSupported: true,
    secretKind: "password",
    authMethod: "password",
    oauthProvider: null,
    authReason: null,
    scopes: {
      triage: { state: "on", reason: "all_mailboxes" },
      actions: { state: "on", reason: "by_mode" },
      send: { state: "on", reason: "after_approval" },
    },
    ...overrides,
  };
}

describe("mailboxStatusUi", () => {
  test("has one entry per status of core", () => {
    expect(Object.keys(mailboxStatusUi).sort()).toEqual([...mailboxStatuses].sort());
  });

  test("host_blocked is a destructive badge with an owner hint", () => {
    expect(mailboxStatusUi.host_blocked).toEqual({
      variant: "destructive",
      text: "status_host_blocked",
      hint: "mb_host_blocked_hint",
    });
    expect(en[mailboxStatusUi.host_blocked.text]).toBe("Server not allowed");
    expect(pl[mailboxStatusUi.host_blocked.text]).toBe("Serwer niedozwolony");
  });

  test("auth_error keeps its hint; active and paused have none", () => {
    expect(mailboxStatusUi.auth_error.hint).toBe("mb_auth_error_hint");
    expect(mailboxStatusUi.active.hint).toBeNull();
    expect(mailboxStatusUi.paused.hint).toBeNull();
  });
});

describe("mailboxCardState", () => {
  test.each<[string, Partial<MailboxView>, MailboxCardState]>([
    ["an active mailbox that synced is connected", { status: "active", lastSyncedAt: SYNCED }, "connected"],
    ["an active mailbox that never synced is never_synced", { status: "active", lastSyncedAt: null }, "never_synced"],
    ["a paused mailbox is paused", { status: "paused" }, "paused"],
    ["a refused host is host_refused", { status: "host_blocked" }, "host_refused"],
    ["a failed password login is login_error", { status: "auth_error", authMethod: "password" }, "login_error"],
    [
      "a failed OAuth login is access_revoked",
      { status: "auth_error", authMethod: "oauth", authReason: "oauth_revoked" },
      "access_revoked",
    ],
  ])("%s", (_name, overrides, expected) => {
    expect(mailboxCardState(view(overrides))).toBe(expected);
  });
});

describe("mailboxCardHint", () => {
  test.each<[string, MailboxCardState, MailboxView["authReason"], TextKey | null]>([
    ["connected with reason null reads null", "connected", null, null],
    ["never_synced with reason null reads null", "never_synced", null, null],
    ["paused with reason null reads null", "paused", null, null],
    ["login_error with reason null reads mb_auth_error_hint", "login_error", null, "mb_auth_error_hint"],
    ["host_refused with reason null reads mb_host_blocked_hint", "host_refused", null, "mb_host_blocked_hint"],
    [
      "access_revoked with reason admin_consent_required reads oauth_err_admin",
      "access_revoked",
      "admin_consent_required",
      "oauth_err_admin",
    ],
    [
      "access_revoked with reason protocol_disabled reads oauth_err_protocol",
      "access_revoked",
      "protocol_disabled",
      "oauth_err_protocol",
    ],
    [
      "access_revoked with reason oauth_expired reads mb_access_revoked_hint",
      "access_revoked",
      "oauth_expired",
      "mb_access_revoked_hint",
    ],
    [
      "access_revoked with reason oauth_revoked reads mb_access_revoked_hint",
      "access_revoked",
      "oauth_revoked",
      "mb_access_revoked_hint",
    ],
    ["access_revoked with reason null reads mb_access_revoked_hint", "access_revoked", null, "mb_access_revoked_hint"],
  ])("%s", (_name, state, reason, expected) => {
    expect(mailboxCardHint(state, reason)).toBe(expected);
  });
});
