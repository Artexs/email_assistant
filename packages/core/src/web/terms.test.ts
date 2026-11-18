import { describe, expect, test } from "bun:test";

import { TERMS_HISTORY, TERMS_VERSION, termsAcceptBodySchema } from "./terms";

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

describe("TERMS_HISTORY", () => {
  test("3. versions are unique and each has the form YYYY-MM-DD or YYYY-MM-DD-N", () => {
    const versions = TERMS_HISTORY.map((entry) => entry.version);
    expect(new Set(versions).size).toBe(versions.length);
    for (const version of versions) expect(version).toMatch(/^\d{4}-\d{2}-\d{2}(-\d+)?$/);
  });

  test("3. only the first entry (the stub era) has no digest; the other digests are unique hex", () => {
    expect(TERMS_HISTORY[0]).toEqual({ version: "2026-11-12", sha256: null });
    const digests = TERMS_HISTORY.slice(1).map((entry) => entry.sha256);
    for (const digest of digests) expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(digests).size).toBe(digests.length);
  });

  test("3. versions grow: each is after the one before it", () => {
    const versions = TERMS_HISTORY.map((entry) => entry.version);
    expect([...versions].sort()).toEqual(versions);
  });

  test("4. TERMS_VERSION is the version of the last entry, and it is not the stub-era version", () => {
    expect(TERMS_VERSION).toBe(TERMS_HISTORY.map((entry) => entry.version).pop() ?? "");
    expect(TERMS_VERSION).not.toBe(TERMS_HISTORY[0]?.version ?? "");
  });
});
