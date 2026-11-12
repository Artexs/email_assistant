import { describe, expect, test } from "bun:test";

import { TERMS_VERSION, termsAcceptBodySchema } from "./terms";

describe("termsAcceptBodySchema", () => {
  test("accepts the current version", () => {
    expect(termsAcceptBodySchema.safeParse({ version: TERMS_VERSION }).success).toBe(true);
  });

  test("refuses an empty version, a missing version and a long version", () => {
    expect(termsAcceptBodySchema.safeParse({ version: "" }).success).toBe(false);
    expect(termsAcceptBodySchema.safeParse({}).success).toBe(false);
    expect(termsAcceptBodySchema.safeParse({ version: "x".repeat(41) }).success).toBe(false);
  });
});
