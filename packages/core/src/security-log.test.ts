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
    expect(securityKindOf("org.break_glass_set")).toBe("break_glass_set");
    expect(securityKindOf("org.exported")).toBe("data_exported");
    expect(securityKindOf("org.delete_refused")).toBe("delete_refused");
    expect(securityKindOf("dsr.find")).toBe("dsr_find");
    expect(securityKindOf("dsr.erase")).toBe("dsr_erase");
    expect(securityKindOf("toString")).toBeNull();
    expect(securityKindOf("org.plan_changed")).toBeNull();
  });
});
