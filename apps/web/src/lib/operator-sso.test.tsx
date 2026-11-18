/// <reference types="bun" />
import type { OperatorOrgDetail } from "@ea/core/web";
import { operatorOrgDetailSchema } from "@ea/core/web";
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { OrgDetail } from "../components/operator/OrgDetail";
import { setLocaleForTest, t, tp } from "../i18n";
import { ssoLines } from "./operator-view";

afterEach(() => setLocaleForTest("en"));

const NOW = new Date("2026-11-20T10:00:00Z");
const at = "2026-11-20T09:00:00.000Z";

const detail: OperatorOrgDetail = {
  orgId: "0190f5a0-0000-7000-8000-000000000002",
  plan: "active",
  trialEndsAt: null,
  resumedAt: null,
  maxMailboxes: 2,
  mailboxes: [],
  lastRuns: { sync: null, triage: null, digest: null, send: null, notice: null },
  failures24h: { sends: 0, outbox: 0 },
  llmToday: { since: at, calls: 0, costUsd: 0, unpricedCalls: 0 },
  flags: [],
  sso: null,
  at,
};

function render(sso: OperatorOrgDetail["sso"]): string {
  return renderToStaticMarkup(<OrgDetail detail={{ ...detail, sso }} now={NOW} onChanged={() => undefined} />);
}

const full = { domain: "x.test", proof: "attested", required: true, linkedMembers: 2, breakGlassReady: false } as const;

describe("operator console SSO block (F119 stage 13)", () => {
  test("the fixture is a valid operator detail (the block shows only what the strict schema allows)", () => {
    expect(operatorOrgDetailSchema.safeParse({ ...detail, mailboxes: [], sso: full }).success).toBe(true);
    expect(operatorOrgDetailSchema.safeParse({ ...detail, sso: { ...full, issuer: "https://idp.test" } }).success).toBe(
      false
    );
  });

  for (const locale of ["en", "pl"] as const) {
    test(`${locale}: no provider shows the title, op_sso_none and the CLI hint`, () => {
      setLocaleForTest(locale);
      const html = render(null);
      expect(html).toContain(t("op_sso_title"));
      expect(html).toContain(t("op_sso_none"));
      expect(html).toContain(t("op_sso_cli"));
      expect(html).not.toContain('data-section="sso"');
    });

    test(`${locale}: a provider shows domain, proof, required, linked members and break-glass`, () => {
      setLocaleForTest(locale);
      const html = render(full);
      expect(html).toContain(t("op_sso_title"));
      expect(html).toContain(`${t("op_sso_domain")}: x.test`);
      expect(html).toContain(t("op_sso_proof_attested"));
      expect(html).toContain(`${t("op_sso_required")}: ${t("op_sso_required_yes")}`);
      expect(html).toContain(tp("op_sso_linked", 2));
      expect(html).toContain(t("op_sso_break_glass_missing"));
      expect(html).toContain(t("op_sso_cli"));
      expect(html).not.toContain(t("op_sso_none"));
      expect(html).not.toContain(t("op_sso_break_glass_ready"));
    });
  }

  test("English reads '2 linked members' and Polish picks one, few and many", () => {
    expect(ssoLines(full)?.linked).toBe("2 linked members");
    expect(ssoLines({ ...full, linkedMembers: 1 })?.linked).toBe("1 linked member");
    setLocaleForTest("pl");
    expect(ssoLines({ ...full, linkedMembers: 1 })?.linked).toBe("1 połączona osoba");
    expect(ssoLines({ ...full, linkedMembers: 3 })?.linked).toBe("3 połączone osoby");
    expect(ssoLines({ ...full, linkedMembers: 5 })?.linked).toBe("5 połączonych osób");
    // 12–14 take the many form, 22–24 the few form.
    expect(ssoLines({ ...full, linkedMembers: 22 })?.linked).toBe("22 połączone osoby");
    expect(ssoLines({ ...full, linkedMembers: 12 })?.linked).toBe("12 połączonych osób");
  });

  test("proof, required and break-glass map to their own texts", () => {
    expect(ssoLines({ ...full, proof: "dns" })?.proof).toBe(t("op_sso_proof_dns"));
    expect(ssoLines({ ...full, proof: null })?.proof).toBe(t("op_sso_proof_none"));
    expect(ssoLines({ ...full, required: false })?.required).toBe(t("op_sso_required_no"));
    expect(ssoLines({ ...full, breakGlassReady: true })?.breakGlass).toBe(t("op_sso_break_glass_ready"));
    expect(ssoLines(null)).toBeNull();
  });

  test("the block prints nothing beyond the schema fields: no issuer, no member id, no secret", () => {
    const html = render({ ...full, issuer: "https://idp.test", clientSecret: "s3cret" } as never);
    expect(html).not.toContain("idp.test");
    expect(html).not.toContain("s3cret");
  });
});
