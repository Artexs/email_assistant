import { describe, expect, test } from "bun:test";

import { securityEvents } from "@ea/core";

import { auditEvents } from "./repo";

describe("security event registry", () => {
  test("every registry code is a value of auditEvents", () => {
    const codes: readonly string[] = Object.values(auditEvents);
    for (const code of Object.keys(securityEvents)) expect(codes).toContain(code);
  });
});
