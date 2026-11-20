import { describe, expect, test } from "bun:test";

import { digestTimesBodySchema, organizationPatchSchema } from "./organization";

function messageOf(result: { success: boolean; error?: { issues: { message: string }[] } }): string | undefined {
  return result.error?.issues[0]?.message;
}

describe("organizationPatchSchema", () => {
  test("refuses an empty patch", () => {
    expect(messageOf(organizationPatchSchema.safeParse({}))).toBe("empty_patch");
  });

  test("refuses an empty timezone at its path", () => {
    const result = organizationPatchSchema.safeParse({ timezone: "" });
    expect(result.success ? [] : result.error.issues[0]?.path).toEqual(["timezone"]);
  });

  test("gives an i18n message for an empty or too long timezone", () => {
    expect(messageOf(organizationPatchSchema.safeParse({ timezone: "" }))).toBe("timezone_invalid");
    expect(messageOf(organizationPatchSchema.safeParse({ timezone: "a".repeat(65) }))).toBe("timezone_invalid");
  });

  test("accepts a timezone shape", () => {
    expect(organizationPatchSchema.safeParse({ timezone: "Europe/Warsaw" }).success).toBe(true);
  });
});

describe("digestTimesBodySchema", () => {
  test("accepts times and none", () => {
    expect(digestTimesBodySchema.safeParse({ times: ["08:00", "13:30"] }).success).toBe(true);
    expect(digestTimesBodySchema.safeParse({ times: [] }).success).toBe(true);
  });

  test("refuses a bad time", () => {
    expect(messageOf(digestTimesBodySchema.safeParse({ times: ["8:00"] }))).toBe("time_invalid");
  });

  test("refuses seven times", () => {
    const times = ["01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "07:00"];
    expect(messageOf(digestTimesBodySchema.safeParse({ times }))).toBe("times_too_many");
  });

  test("refuses a duplicate", () => {
    const result = digestTimesBodySchema.safeParse({ times: ["08:00", "08:00"] });
    expect(messageOf(result)).toBe("times_duplicate");
    expect(result.success ? [] : result.error.issues[0]?.path).toEqual(["times"]);
  });
});
