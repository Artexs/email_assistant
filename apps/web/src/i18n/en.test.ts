import { describe, expect, test } from "bun:test";
import { changePasswordFormSchema, digestTimesBodySchema, organizationPatchSchema, ruleBodySchema } from "@ea/core/web";

import { en, t } from "./en";

function messages(result: { success: boolean; error?: { issues: { message: string }[] } }): string[] {
  expect(result.success).toBe(false);
  return (result.error?.issues ?? []).map((issue) => issue.message);
}

describe("keys for the messages of the core schemas", () => {
  test("every message that the S5c schemas emit is a key", () => {
    const emitted = [
      ...messages(ruleBodySchema.safeParse({ kind: "vip", pattern: "not a pattern" })),
      ...messages(ruleBodySchema.safeParse({ kind: "vip", pattern: "a".repeat(300) })),
      ...messages(organizationPatchSchema.safeParse({})),
      ...messages(organizationPatchSchema.safeParse({ timezone: "" })),
      ...messages(organizationPatchSchema.safeParse({ timezone: "x".repeat(65) })),
      ...messages(organizationPatchSchema.safeParse({ styleText: "a".repeat(501) })),
      ...messages(organizationPatchSchema.safeParse({ styleText: "a\u0001b" })),
      ...messages(digestTimesBodySchema.safeParse({ times: ["8:00"] })),
      ...messages(
        digestTimesBodySchema.safeParse({ times: ["01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "07:00"] })
      ),
      ...messages(digestTimesBodySchema.safeParse({ times: ["08:00", "08:00"] })),
      ...messages(changePasswordFormSchema.safeParse({ current: "", password: "short", repeat: "other" })),
    ];
    expect(emitted.length).toBeGreaterThan(8);
    for (const message of emitted) expect(Object.hasOwn(en, message)).toBe(true);
  });

  test("the keys that the page stages name exist", () => {
    for (const key of [
      "empty_patch",
      "style_too_long",
      "style_bad_char",
      "pattern_invalid",
      "time_invalid",
      "times_too_many",
      "times_duplicate",
      "timezone_invalid",
      "password_required",
      "passwords_differ",
      "set_mailbox_label",
      "rules_delete",
      "acct_changed_others_toast",
    ]) {
      expect(Object.hasOwn(en, key)).toBe(true);
    }
  });

  test("t fills the variables", () => {
    expect(t("rules_delete", { pattern: "firma.pl" })).toBe("Delete the rule firma.pl");
    expect(t("sig_counter", { count: 12 })).toBe("12 / 500");
  });
});
