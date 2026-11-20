import { describe, expect, test } from "bun:test";

import { compareLegalVersions, formatLegalVersion, isCanonicalLegalVersion, parseLegalVersion } from "./legal-version";
import { TERMS_HISTORY, TERMS_VERSION, termsAcceptBodySchema } from "./terms";

// The hyphen entries of the history: the legacy spelling of `.2`. Stored acceptance rows hold these strings, so they stay.
// Frozen: a new entry uses the dot.
const LEGACY_HYPHEN_VERSIONS: readonly string[] = ["2026-11-18-2", "2026-11-19-2"];

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
  test("3. every version parses", () => {
    for (const entry of TERMS_HISTORY) expect(parseLegalVersion(entry.version), entry.version).not.toBeNull();
  });

  test("3. every version is canonical or in the frozen legacy hyphen list", () => {
    for (const { version } of TERMS_HISTORY) {
      if (LEGACY_HYPHEN_VERSIONS.includes(version)) continue;
      const parsed = parseLegalVersion(version);
      expect(
        isCanonicalLegalVersion(version),
        `TERMS_HISTORY entry ${version} is not canonical; write it as ${parsed === null ? "YYYY-MM-DD.N" : formatLegalVersion(parsed)}`
      ).toBe(true);
    }
  });

  test("3. every legacy hyphen version is an entry of TERMS_HISTORY", () => {
    const versions = TERMS_HISTORY.map((entry) => entry.version);
    expect(LEGACY_HYPHEN_VERSIONS.filter((version) => !versions.includes(version))).toEqual([]);
  });

  test("3. only the first entry (the stub era) has no digest; the other digests are unique hex", () => {
    expect(TERMS_HISTORY[0]).toEqual({ version: "2026-11-12", sha256: null });
    const digests = TERMS_HISTORY.slice(1).map((entry) => entry.sha256);
    for (const digest of digests) expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(digests).size).toBe(digests.length);
  });

  test("3. each version is strictly after the one before it", () => {
    const parsed = TERMS_HISTORY.map((entry) => parseLegalVersion(entry.version));
    for (let index = 1; index < parsed.length; index += 1) {
      const before = parsed[index - 1];
      const current = parsed[index];
      if (before === null || before === undefined || current === null || current === undefined)
        throw new Error(`entry ${index} does not parse`);
      expect(compareLegalVersions(before, current), TERMS_HISTORY[index]?.version).toBeLessThan(0);
    }
  });

  test("5. TERMS_VERSION is canonical or in the frozen legacy hyphen list", () => {
    expect(isCanonicalLegalVersion(TERMS_VERSION) || LEGACY_HYPHEN_VERSIONS.includes(TERMS_VERSION)).toBe(true);
  });

  test("4. TERMS_VERSION is the version of the last entry, and it is not the stub-era version", () => {
    expect(TERMS_VERSION).toBe(TERMS_HISTORY.map((entry) => entry.version).pop() ?? "");
    expect(TERMS_VERSION).not.toBe(TERMS_HISTORY[0]?.version ?? "");
  });
});
