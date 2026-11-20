import { describe, expect, test } from "bun:test";
import {
  changePasswordFormSchema,
  digestTimesBodySchema,
  MAX_DIGEST_TIMES,
  notifyPatchSchema,
  organizationPatchSchema,
  ruleBodySchema,
} from "@ea/core/web";

import { en } from "./en";
import { t } from "./index";

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
      ...messages(digestTimesBodySchema.safeParse({ times: ["8:00"] })),
      ...messages(
        digestTimesBodySchema.safeParse({ times: ["01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "07:00"] })
      ),
      ...messages(digestTimesBodySchema.safeParse({ times: ["08:00", "08:00"] })),
      // The two messages that the quiet hours form can show.
      ...messages(notifyPatchSchema.safeParse({ quietStart: "25:00", quietEnd: "06:00" })),
      ...messages(notifyPatchSchema.safeParse({ quietStart: "23:00" })),
      ...messages(notifyPatchSchema.safeParse({ quietStart: "05:00", quietEnd: "00:00" })),
      ...messages(changePasswordFormSchema.safeParse({ current: "", password: "short", repeat: "other" })),
    ];
    expect(emitted.length).toBeGreaterThan(8);
    for (const message of emitted) expect(Object.hasOwn(en, message)).toBe(true);
  });

  test("the keys that the page stages name exist", () => {
    for (const key of [
      "empty_patch",
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
    expect(t("sig_counter", { count: 12, max: 1000 })).toBe("12 / 1000");
    expect(t("digest_help", { timezone: "UTC", max: MAX_DIGEST_TIMES })).toContain(`Up to ${MAX_DIGEST_TIMES} times`);
  });

  // The core schema emits this one as a key without variables, so its text names the limit directly.
  test("the text of the limit message carries the core constant", () => {
    expect(t("times_too_many")).toContain(String(MAX_DIGEST_TIMES));
  });
});
