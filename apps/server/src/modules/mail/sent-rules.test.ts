import { DAY_MS } from "@ea/core";
import { describe, expect, test } from "bun:test";

import type { MessageMeta } from "./port";
import {
  cleanAddresses,
  firstPerDedupKey,
  parentMessageId,
  sentModeOf,
  sentTextWindowMs,
  toNewSentEmail,
  type SentOrigin,
} from "./sent-rules";
import { baseDedupKey, contentHash } from "./sync-rules";

const NOW = new Date("2026-11-20T10:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

function meta(overrides: Partial<MessageMeta> = {}): MessageMeta {
  return {
    uid: 1,
    size: 100,
    internalDate: ago(1),
    date: ago(1),
    messageId: "<s1@x.test>",
    inReplyTo: null,
    references: [],
    from: "me@x.test",
    to: ["anna@x.test"],
    cc: [],
    subject: "Hello",
    actionId: null,
    ...overrides,
  };
}

function row(m: MessageMeta, origin: SentOrigin = null, textWindowMs = 14 * DAY_MS) {
  return toNewSentEmail(m, { mailboxId: "mb", path: "Sent", uidValidity: 7, now: NOW, textWindowMs, origin });
}

const status = (uidValidity: number) => ({ uidValidity, uidNext: 10, highestUid: 9 });

describe("sentModeOf", () => {
  test("no cursor is initial, the same UIDVALIDITY incremental, another rescan", () => {
    expect(sentModeOf(null, status(7))).toBe("initial");
    expect(sentModeOf({ uidValidity: null }, status(7))).toBe("initial");
    expect(sentModeOf({ uidValidity: 7 }, status(7))).toBe("incremental");
    expect(sentModeOf({ uidValidity: 7 }, status(9))).toBe("rescan");
  });
});

describe("parentMessageId", () => {
  test("In-Reply-To first, else the last References id, else null", () => {
    expect(parentMessageId(meta({ inReplyTo: " <in-1@x.test> " }))).toBe("<in-1@x.test>");
    expect(parentMessageId(meta({ references: ["<r1@x.test>", "<r2@x.test>"] }))).toBe("<r2@x.test>");
    expect(parentMessageId(meta({ inReplyTo: "  ", references: [" ", ""] }))).toBeNull();
    expect(parentMessageId(meta())).toBeNull();
  });
});

describe("cleanAddresses", () => {
  test("trims, lower-cases, drops empty values and repeats, keeps the order", () => {
    expect(cleanAddresses([" Anna@X.test", "anna@x.test", "", "B@x.test"])).toEqual(["anna@x.test", "b@x.test"]);
  });
});

describe("toNewSentEmail", () => {
  test("a user reply keeps parent, references, thread key and the incoming dedup key", () => {
    const m = meta({
      inReplyTo: "<in-1@x.test>",
      references: ["<root@x.test>", "<in-1@x.test>"],
      cc: ["B@x.test", "b@x.test"],
    });
    const out = row(m);
    expect(out).toMatchObject({
      parentMessageId: "<in-1@x.test>",
      referencesIds: ["<root@x.test>", "<in-1@x.test>"],
      threadKey: "<root@x.test>",
      ccAddresses: ["b@x.test"],
      content: "pending",
      origin: "user",
      actionId: null,
      dedupKey: baseDedupKey("<s1@x.test>", contentHash(m)),
    });
  });

  test("maps the address, location and subject fields", () => {
    const m = meta({ from: " Me@X.test ", to: ["A@x.test", "a@x.test"] });
    const out = row(m);
    expect(out).toMatchObject({
      mailboxId: "mb",
      path: "Sent",
      uidValidity: 7,
      uid: 1,
      subject: "Hello",
      fromAddress: "me@x.test",
      toAddresses: ["a@x.test"],
    });
    expect(out?.internalDate.getTime()).toBe(m.internalDate.getTime());
    expect(row(meta({ from: null }))?.fromAddress).toBeNull();
  });

  test("the header window is 30 days from INTERNALDATE, the bound included", () => {
    expect(row(meta({ internalDate: ago(20) }))?.content).toBe("headers_only");
    expect(row(meta({ internalDate: ago(31) }))).toBeNull();
    expect(row(meta({ internalDate: ago(30) }))).not.toBeNull();
    expect(row(meta({ internalDate: new Date(ago(30).getTime() - 1) }))).toBeNull();
  });

  test("the origin decides origin, content and action id", () => {
    const actionId = crypto.randomUUID();
    const system = row(meta({ actionId }), "system");
    expect(system).toMatchObject({ origin: "system", content: "headers_only", actionId });
    const draft = row(meta({ actionId }), "draft");
    expect(draft).toMatchObject({ origin: "user", content: "pending", actionId });
    const none = row(meta({ actionId }), null);
    expect(none).toMatchObject({ origin: "user", actionId: null });
  });

  test("a short text window turns older mail into headers only", () => {
    expect(row(meta({ internalDate: ago(4) }), null, 3 * DAY_MS)?.content).toBe("headers_only");
    expect(row(meta({ internalDate: ago(2) }), null, 3 * DAY_MS)?.content).toBe("pending");
  });

  test("no Date header: sentAt is INTERNALDATE; no Message-ID: a hash key and the key as thread key", () => {
    const internalDate = ago(2);
    const out = row(meta({ date: null, internalDate, messageId: null }));
    expect(out?.sentAt.getTime()).toBe(internalDate.getTime());
    expect(out?.dedupKey.startsWith("hash:")).toBe(true);
    expect(out?.threadKey).toBe(out?.dedupKey);
    const invalid = row(meta({ date: new Date("nope"), internalDate }));
    expect(invalid?.sentAt.getTime()).toBe(internalDate.getTime());
  });

  test("the Date header is sentAt when valid", () => {
    const date = ago(3);
    expect(row(meta({ date, internalDate: ago(1) }))?.sentAt.getTime()).toBe(date.getTime());
  });
});

describe("sentTextWindowMs", () => {
  test("is the smaller of 14 days and the retention", () => {
    expect(sentTextWindowMs(3)).toBe(3 * DAY_MS);
    expect(sentTextWindowMs(30)).toBe(14 * DAY_MS);
  });
});

describe("firstPerDedupKey", () => {
  test("keeps the first row of each key", () => {
    const rows = [
      { dedupKey: "a", n: 1 },
      { dedupKey: "b", n: 2 },
      { dedupKey: "a", n: 3 },
    ];
    expect(firstPerDedupKey(rows)).toEqual([
      { dedupKey: "a", n: 1 },
      { dedupKey: "b", n: 2 },
    ]);
  });
});
