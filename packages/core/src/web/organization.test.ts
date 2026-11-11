import { describe, expect, test } from "bun:test";

import { digestTimesBodySchema, organizationPatchSchema, styleTextSchema } from "./organization";

function messageOf(result: { success: boolean; error?: { issues: { message: string }[] } }): string | undefined {
  return result.error?.issues[0]?.message;
}

describe("styleTextSchema", () => {
  test("normalizes line breaks and trims", () => {
    expect(styleTextSchema.parse("Anna\r\nCEO  ")).toBe("Anna\nCEO");
  });

  test("turns blank text into null", () => {
    expect(styleTextSchema.parse("   ")).toBeNull();
  });

  test("refuses 501 and 2001 characters", () => {
    expect(messageOf(styleTextSchema.safeParse("a".repeat(501)))).toBe("style_too_long");
    expect(messageOf(styleTextSchema.safeParse("a".repeat(2001)))).toBe("style_too_long");
  });

  test("refuses a control character but allows a tab", () => {
    expect(messageOf(styleTextSchema.safeParse("a\u0007b"))).toBe("style_bad_char");
    expect(styleTextSchema.safeParse("a\tb").success).toBe(true);
  });
});

describe("organizationPatchSchema", () => {
  test("refuses an empty patch", () => {
    expect(messageOf(organizationPatchSchema.safeParse({}))).toBe("empty_patch");
  });

  test("accepts a null style text", () => {
    expect(organizationPatchSchema.parse({ styleText: null })).toEqual({ styleText: null });
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
