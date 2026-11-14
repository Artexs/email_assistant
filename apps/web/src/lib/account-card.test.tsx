/// <reference types="bun" />
import type { Me } from "@ea/core/web";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AccountCard } from "../components/settings/AccountCard";
import { MeContext } from "../components/shell/MeProvider";
import { setLocaleForTest, t } from "../i18n";

// The `me` that `/api/me` answers; only `role`, `features` and `organization` matter to the Account card.
const baseMe = {
  user: { id: "0190f5a0-0000-7000-8000-000000000001", email: "a@x.test", displayName: "Ann", locale: null },
  organization: {
    id: "0190f5a0-0000-7000-8000-000000000002",
    name: "Acme Test",
    timezone: "Europe/Warsaw",
    plan: "active",
    trialEndsAt: null,
    maxMailboxes: 2,
  },
  operatorContact: null,
  role: "owner",
  telegram: { available: false, linked: false, botUsername: null },
  onboarding: { mailbox: true, telegram: false, telegramAvailable: false, mode: false, rules: 0, done: false },
  scopes: {
    triage: { kind: "off", reason: "env_off" },
    actions: { kind: "off", reason: "env_off" },
    send: { kind: "off", reason: "env_off" },
  },
  mailboxCount: 1,
  mailboxesInAuthError: 0,
  digestTimes: ["08:00"],
  terms: { accepted: true, current: "2026-11-12" },
  operator: false,
  features: [],
} as unknown as Me;

function render(me: Me | null): string {
  const value = { me, error: null, loading: me === null, reload: () => undefined };
  return renderToStaticMarkup(
    <MeContext.Provider value={value}>
      <AccountCard />
    </MeContext.Provider>
  );
}

describe("AccountCard delete block (F106 stage 04, B1)", () => {
  setLocaleForTest("en");
  const deleteTitle = t("del_title");
  const withFlag = (over: Partial<Me> = {}): Me => ({ ...baseMe, features: ["org_delete"], ...over });

  test("an owner with org_delete sees the delete button inside a bordered block", () => {
    const html = render(withFlag());
    expect(html).toContain(deleteTitle);
    expect(html).toContain('data-action="delete-organization"');
  });

  test("flag off, an assistant, or me not loaded: no delete button and no empty bordered block", () => {
    const flagOff = render({ ...baseMe, features: [] });
    const assistant = render(withFlag({ role: "assistant" }));
    const loading = render(null);
    for (const html of [flagOff, assistant, loading]) {
      expect(html).not.toContain(deleteTitle);
      expect(html).not.toContain("delete-organization");
    }
    // The UI does not change at all: the bordered blocks are the same as without the new block (the card ends with
    // the sessions block, and the security-log block is not there for these three).
    for (const html of [flagOff, assistant, loading]) {
      const blocks = html.match(/<div class="border-t pt-4">/g) ?? [];
      expect(blocks.length).toBe(1);
    }
  });

  test("with org_delete on, there is exactly one bordered block more than with it off", () => {
    const on = render(withFlag()).match(/<div class="border-t pt-4">/g) ?? [];
    const off = render({ ...baseMe, features: [] }).match(/<div class="border-t pt-4">/g) ?? [];
    expect(on.length).toBe(off.length + 1);
  });
});
