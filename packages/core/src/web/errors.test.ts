import { describe, expect, test } from "bun:test";

import { apiErrorCodes, apiErrorSchema } from "./errors";

describe("apiErrorSchema", () => {
  test("accepts an error code alone", () => {
    expect(apiErrorSchema.parse({ error: "owner_only" })).toEqual({ error: "owner_only" });
  });

  test("accepts details", () => {
    const body = { error: "validation", details: [{ path: "email", code: "invalid_format", message: "bad" }] };
    expect(apiErrorSchema.parse(body)).toEqual(body);
  });

  test("refuses an empty object", () => {
    expect(apiErrorSchema.safeParse({}).success).toBe(false);
  });

  test("lists too_large", () => {
    expect(apiErrorCodes).toContain("too_large");
  });

  test("lists the S5b codes", () => {
    expect(apiErrorCodes).toContain("host_not_allowed");
    expect(apiErrorCodes).toContain("telegram_unreachable");
  });

  test("lists rule_limit after rule_exists", () => {
    expect(apiErrorCodes).toContain("rule_limit");
    expect(apiErrorCodes.indexOf("rule_limit")).toBe(apiErrorCodes.indexOf("rule_exists") + 1);
  });
});
