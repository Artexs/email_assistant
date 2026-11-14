import { describe, expect, test } from "bun:test";

import { relationOf, senderHistorySchema } from "./sender-history";

const base = { isDelegate: false, isVip: false, received: 10, bulkMails: 0, answered: 0, userMailsTo: 0 };

describe("relationOf", () => {
  test("a delegate wins over every other relation", () => {
    expect(relationOf({ ...base, isDelegate: true, isVip: true, bulkMails: 10 })).toBe("delegate");
  });

  test("a VIP sender is vip", () => {
    expect(relationOf({ ...base, isVip: true })).toBe("vip");
  });

  test("bulk means more than half of the mail", () => {
    expect(relationOf({ ...base, bulkMails: 6 })).toBe("bulk");
    expect(relationOf({ ...base, bulkMails: 5 })).not.toBe("bulk");
  });

  test("an answer or a mail to the sender is known; nothing is new", () => {
    expect(relationOf({ ...base, answered: 1 })).toBe("known");
    expect(relationOf({ ...base, userMailsTo: 1 })).toBe("known");
    expect(relationOf(base)).toBe("new");
  });
});

describe("senderHistorySchema", () => {
  const valid = {
    days: 30,
    received: 4,
    byCategory: { info: 3, spam: 1 },
    corrections: {},
    movedBack: 0,
    answered: 1,
    flagged: 0,
    unseen7d: 0,
    userMailsTo: 1,
    lastUserMailDaysAgo: 3,
    delegationsTo: 0,
    bulkSignals: ["list_id"],
    firstSeenDaysAgo: 20,
    lastSeenDaysAgo: 1,
    medianUserReplyHours: null,
    medianTheirReplyHours: 5.5,
    relation: "known",
  };

  test("accepts a valid history and has every field of the sender context list", () => {
    expect(senderHistorySchema.parse(valid)).toEqual(valid);
    expect(Object.keys(senderHistorySchema.shape).sort()).toEqual(
      [
        "days",
        "received",
        "byCategory",
        "corrections",
        "movedBack",
        "answered",
        "flagged",
        "unseen7d",
        "userMailsTo",
        "lastUserMailDaysAgo",
        "delegationsTo",
        "bulkSignals",
        "firstSeenDaysAgo",
        "lastSeenDaysAgo",
        "medianUserReplyHours",
        "medianTheirReplyHours",
        "relation",
      ].sort()
    );
  });

  test("refuses an extra key, so no text field can enter", () => {
    expect(senderHistorySchema.safeParse({ ...valid, note: "text" }).success).toBe(false);
  });
});
