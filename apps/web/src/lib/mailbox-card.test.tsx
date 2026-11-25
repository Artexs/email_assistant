/// <reference types="bun" />
import type { MailboxView } from "@ea/core/web";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { MailboxCard } from "../components/mailboxes/MailboxCard";
import { en } from "../i18n/en";

const SYNCED = "2026-11-20T08:00:00.000Z";

const base: MailboxView = {
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
};

const oauthRevoked: MailboxView = {
  ...base,
  status: "auth_error",
  authMethod: "oauth",
  oauthProvider: "google",
  authReason: "oauth_revoked",
};

const render = (mailbox: MailboxView, isOwner: boolean) =>
  renderToStaticMarkup(
    <MailboxCard
      mailbox={mailbox}
      isOwner={isOwner}
      timeZone="Europe/Warsaw"
      now={new Date("2026-11-20T09:00:00.000Z")}
      onChanged={() => undefined}
    />
  );

const buttonNames = (html: string) =>
  [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((match) => match[1]?.replace(/<[^>]*>/g, "") ?? "");

describe("MailboxCard", () => {
  test("an OAuth card with a failed login offers Reconnect and no password change", () => {
    const html = render(oauthRevoked, true);
    expect(html).toContain('data-state="access_revoked"');
    expect(buttonNames(html)).toEqual([en.mb_reconnect, en.mb_more]);
    expect(html).toContain(en.mb_access_revoked_hint);
    expect(html).toContain(en.mb_provider_google);
  });

  test("a password card with a failed login offers Change password and no Reconnect", () => {
    const html = render({ ...base, status: "auth_error" }, true);
    expect(html).toContain('data-state="login_error"');
    expect(buttonNames(html)).toEqual([en.mb_change_password, en.mb_more]);
  });

  test("an OAuth card with no provider has no Reconnect", () => {
    const html = render({ ...oauthRevoked, oauthProvider: null }, true);
    expect(buttonNames(html)).toEqual([en.mb_more]);
  });

  test("a refused host has only More", () => {
    const html = render({ ...base, status: "host_blocked" }, true);
    expect(html).toContain('data-state="host_refused"');
    expect(buttonNames(html)).toEqual([en.mb_more]);
  });

  test.each([
    ["connected", base, en.mb_pause],
    ["never_synced", { ...base, lastSyncedAt: null }, en.mb_pause],
    ["paused", { ...base, status: "paused" as const }, en.mb_resume],
  ])("a %s card offers %s", (state, mailbox, label) => {
    const html = render(mailbox, true);
    expect(html).toContain(`data-state="${state}"`);
    expect(buttonNames(html)).toEqual([label, en.mb_more]);
  });

  test("a member sees the state but no button and no hint", () => {
    const html = render(oauthRevoked, false);
    expect(html).toContain('data-state="access_revoked"');
    expect(buttonNames(html)).toEqual([]);
    expect(html).not.toContain(en.mb_access_revoked_hint);
  });

  test("the address breaks before the at sign and stays whole in the title", () => {
    const html = render(base, true);
    expect(html).toContain('title="anna@example.com"');
    expect(html).toContain("anna<wbr/>@example.com");
  });
});
