/// <reference types="bun" />
import type { Me } from "@ea/core/web";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AccountCard } from "../components/settings/AccountCard";
import { MeContext } from "../components/shell/MeProvider";
import { setLocaleForTest, t } from "../i18n";

// The `me` that `/api/me` answers; only `role`, `features` and `organization` matter to the Account card.
const baseMe: Me = {
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
  onboarding: {
    mailbox: true,
    telegram: false,
    telegramAvailable: false,
    mode: false,
    rules: 0,
    trust: false,
    channel: false,
    report: false,
    done: false,
  },
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
  signInMethod: "password",
  hasPassword: true,
  approvalsWaiting: 0,
};

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
    for (const html of [flagOff, assistant]) {
      const blocks = html.match(/<div class="border-t pt-4">/g) ?? [];
      expect(blocks.length).toBe(1);
    }
    // F119 stage 13: while `me` is not loaded no password control shows, so the two-factor block is not there either.
    expect(loading.match(/<div class="border-t pt-4">/g) ?? []).toHaveLength(0);
  });

  test("with org_delete on, there is exactly one bordered block more than with it off", () => {
    const on = render(withFlag()).match(/<div class="border-t pt-4">/g) ?? [];
    const off = render({ ...baseMe, features: [] }).match(/<div class="border-t pt-4">/g) ?? [];
    expect(on.length).toBe(off.length + 1);
  });
});

describe("AccountCard for a member without a password (F119 stage 13, D14)", () => {
  const passwordOnlyMarks = [
    'id="acct-current"', // the change-password form
    'id="acct-new"',
    'name="current-password"',
    'data-section="two-factor"', // the two-factor section
    'data-action="delete-organization"', // the delete button
  ];
  const sso = (over: Partial<Me> = {}): Me => ({
    ...baseMe,
    features: ["org_delete", "security_log"],
    signInMethod: "sso",
    hasPassword: false,
    ...over,
  });

  for (const locale of ["en", "pl"] as const) {
    test(`${locale}: hasPassword false hides password, two-factor and delete, and shows the hint`, () => {
      setLocaleForTest(locale);
      const html = render(sso());
      for (const mark of passwordOnlyMarks) expect(html).not.toContain(mark);
      expect(html).not.toContain(t("acct_change"));
      expect(html).not.toContain(t("del_title"));
      expect(html).toContain(t("acct_sso_only"));
      // Language, sessions and "sign out everywhere" stay, and so does the owner's security log.
      expect(html).toContain('id="acct-language"');
      expect(html).toContain('data-section="sessions"');
      expect(html).toContain(t("acct_sign_out_all"));
      expect(html).toContain('data-section="security-log"');
      expect(html).toContain(t("acct_sso_session"));
      setLocaleForTest("en");
    });

    test(`${locale}: hasPassword true with an SSO session keeps every section and adds the session note`, () => {
      setLocaleForTest(locale);
      const html = render(sso({ hasPassword: true }));
      expect(html).toContain('id="acct-current"');
      expect(html).toContain('id="acct-new"');
      expect(html).toContain(t("acct_change"));
      expect(html).toContain('data-action="delete-organization"');
      expect(html).toContain('data-section="two-factor"');
      expect(html).not.toContain(t("acct_sso_only"));
      expect(html).toContain(t("acct_sso_session"));
      // The note sits inside the sessions block.
      const sessions = html.slice(html.indexOf('data-section="sessions"'));
      expect(sessions.indexOf(t("acct_sso_session"))).toBeGreaterThan(0);
      setLocaleForTest("en");
    });
  }

  test("a password session shows neither the hint nor the session note", () => {
    const html = render({ ...baseMe, features: ["org_delete"] });
    expect(html).not.toContain(t("acct_sso_only"));
    expect(html).not.toContain(t("acct_sso_session"));
    expect(html).toContain('id="acct-current"');
  });

  test("while me is not loaded no password control, hint or note shows", () => {
    const html = render(null);
    for (const mark of passwordOnlyMarks) expect(html).not.toContain(mark);
    expect(html).not.toContain(t("acct_sso_only"));
    expect(html).not.toContain(t("acct_sso_session"));
  });
});
