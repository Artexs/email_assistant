import { describe, expect, test } from "bun:test";

import { membershipRoleSchema } from "./tenancy";

describe("membershipRoleSchema", () => {
  test("accepts owner and assistant", () => {
    expect(membershipRoleSchema.parse("owner")).toBe("owner");
    expect(membershipRoleSchema.parse("assistant")).toBe("assistant");
  });

  test("rejects other values", () => {
    expect(() => membershipRoleSchema.parse("admin")).toThrow();
    expect(() => membershipRoleSchema.parse("")).toThrow();
  });
});
