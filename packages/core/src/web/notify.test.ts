import { describe, expect, test } from "bun:test";

import { notifyPatchSchema } from "./notify";

const id = "5f1f1f1f-1f1f-4f1f-8f1f-1f1f1f1f1f1f";

function message(body: unknown): string | undefined {
  const result = notifyPatchSchema.safeParse(body);
  return result.success ? undefined : result.error.issues[0]?.message;
}

describe("notifyPatchSchema", () => {
  test("quiet hours: both times, or both null to reset", () => {
    expect(notifyPatchSchema.safeParse({ quietStart: "23:00", quietEnd: "06:00" }).success).toBe(true);
    expect(notifyPatchSchema.safeParse({ quietStart: null, quietEnd: null }).success).toBe(true);
  });

  test("a time past 24 h or a bad shape is time_invalid", () => {
    expect(message({ quietStart: "25:00", quietEnd: "06:00" })).toBe("time_invalid");
    expect(message({ quietStart: "23:00", quietEnd: "6:00" })).toBe("time_invalid");
  });

  test("only one of the two quiet keys is refused, also a time with a null", () => {
    expect(message({ quietStart: "23:00" })).toBe("quiet_pair");
    expect(message({ quietEnd: "06:00" })).toBe("quiet_pair");
    expect(message({ quietStart: "23:00", quietEnd: null })).toBe("quiet_pair");
  });

  test("channel: telegram, mail with or without a mailbox, both, or null to reset", () => {
    for (const body of [
      { reportChannel: "telegram" },
      { reportChannel: "mail" },
      { reportChannel: "both", reportMailboxId: id },
      { reportChannel: "mail", reportMailboxId: null },
      { reportChannel: null },
    ]) {
      expect(notifyPatchSchema.safeParse(body).success).toBe(true);
    }
    expect(notifyPatchSchema.safeParse({ reportChannel: "sms" }).success).toBe(false);
    expect(notifyPatchSchema.safeParse({ reportChannel: "mail", reportMailboxId: "x" }).success).toBe(false);
    expect(message({ reportMailboxId: id })).toBe("channel_required");
  });

  test("an empty body, both groups, a user id and an unknown key are refused", () => {
    expect(message({})).toBe("notify_one_group");
    expect(message({ quietStart: "23:00", quietEnd: "06:00", reportChannel: "mail" })).toBe("notify_one_group");
    expect(notifyPatchSchema.safeParse({ reportChannel: "mail", userId: id }).success).toBe(false);
  });
});
