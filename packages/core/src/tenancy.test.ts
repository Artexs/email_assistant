import { describe, expect, test } from "bun:test";

import { membershipRoleSchema, userLocaleSchema } from "./tenancy";

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

describe("userLocaleSchema", () => {
  test("accepts pl and en, rejects other values", () => {
    expect(userLocaleSchema.safeParse("pl").success).toBe(true);
    expect(userLocaleSchema.safeParse("en").success).toBe(true);
    expect(userLocaleSchema.safeParse("de").success).toBe(false);
  });
});
