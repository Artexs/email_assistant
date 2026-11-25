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

function cardsOf(html: string): string[] {
  return Array.from(html.matchAll(/data-card="([a-z-]+)"/g), (match) => match[1] ?? "");
}

describe("AccountCard cards", () => {
  setLocaleForTest("en");
  const deleteTitle = t("del_title");
  const owner: Me = { ...baseMe, features: ["org_delete", "security_log"] };

  test.each([
    ["an owner with a password, org_delete and security_log", owner, ["account", "security", "delete-organization"]],
    ["a member with a password", { ...baseMe, role: "assistant" } satisfies Me, ["account", "security"]],
    [
      "a member without a password and no security log",
      { ...baseMe, role: "assistant", hasPassword: false, signInMethod: "sso" } satisfies Me,
      ["account"],
    ],
    [
      "an owner whose organization has org_delete off",
      { ...baseMe, features: [] } satisfies Me,
      ["account", "security"],
    ],
    [
      "an owner without a password: the log stays, the two-factor section and the delete card go",
      { ...owner, hasPassword: false, signInMethod: "sso" } satisfies Me,
      ["account", "security"],
    ],
    ["me not loaded", null, ["account"]],
  ])("%s", (_name, me, expected) => {
    expect(cardsOf(render(me))).toEqual(expected);
  });

  test("the delete card has the danger tone and holds the delete button; no other card holds it", () => {
    const html = render(owner);
    const card = html.slice(html.indexOf('data-card="delete-organization"'));
    expect(html).toMatch(/data-tone="danger"[^>]*data-card="delete-organization"/);
    expect(card).toContain('data-action="delete-organization"');
    expect(card).toContain(deleteTitle);
    expect(html.slice(0, html.indexOf('data-card="delete-organization"'))).not.toContain(
      'data-action="delete-organization"'
    );
  });

  test("the two-factor section is in the security card, after the account card", () => {
    const html = render(owner);
    const security = html.indexOf('data-card="security"');
    expect(html.indexOf('data-section="two-factor"')).toBeGreaterThan(security);
    expect(html.indexOf('data-section="sessions"')).toBeLessThan(security);
    expect(html.indexOf('data-section="security-log"')).toBeGreaterThan(html.indexOf('data-section="two-factor"'));
  });

  test("a member without the delete flag sees no delete text", () => {
    const html = render({ ...baseMe, features: [] });
    expect(html).not.toContain(deleteTitle);
    expect(html).not.toContain("delete-organization");
  });
});

describe("AccountCard for a member without a password", () => {
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
