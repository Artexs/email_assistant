import { describe, expect, test } from "bun:test";

import { securityEventCodes, securityEventKinds, securityEvents, securityKindOf } from "./security-log";

describe("security log registry", () => {
  test("every value is a known kind and every kind is used once", () => {
    const values = Object.values(securityEvents);
    for (const value of values) expect<readonly string[]>(securityEventKinds).toContain(value);
    expect([...values].sort()).toEqual([...securityEventKinds].sort());
    expect(securityEventCodes).toEqual(Object.keys(securityEvents));
  });

  test("securityKindOf maps registry codes and refuses the rest", () => {
    expect(securityKindOf("web.login")).toBe("sign_in");
    expect(securityKindOf("web.two_factor_locked")).toBe("two_factor_locked");
    expect(securityKindOf("web.two_factor_refused")).toBe("two_factor_refused");
    expect(securityKindOf("org.break_glass_set")).toBe("break_glass_set");
    expect(securityKindOf("org.exported")).toBe("data_exported");
    expect(securityKindOf("org.delete_refused")).toBe("delete_refused");
    expect(securityKindOf("dsr.find")).toBe("dsr_find");
    expect(securityKindOf("dsr.erase")).toBe("dsr_erase");
    // F119: every audit code of company sign-in and of the member commands maps to its own kind.
    expect(securityKindOf("sso.login")).toBe("sso_sign_in");
    expect(securityKindOf("sso.refused")).toBe("sso_refused");
    expect(securityKindOf("sso.provider_set")).toBe("sso_provider_set");
    expect(securityKindOf("sso.provider_removed")).toBe("sso_provider_removed");
    expect(securityKindOf("sso.domain_verified")).toBe("sso_domain_verified");
    expect(securityKindOf("sso.domain_attested")).toBe("sso_domain_attested");
    expect(securityKindOf("sso.required_changed")).toBe("sso_required_changed");
    expect(securityKindOf("sso.unlinked")).toBe("sso_unlinked");
    expect(securityKindOf("org.member_added")).toBe("member_added");
    expect(securityKindOf("web.member_sessions_ended")).toBe("member_sessions_ended");
    expect(securityKindOf("toString")).toBeNull();
    expect(securityKindOf("org.plan_changed")).toBeNull();
  });
});
