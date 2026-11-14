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
    expect(securityKindOf("toString")).toBeNull();
    expect(securityKindOf("org.plan_changed")).toBeNull();
  });
});
