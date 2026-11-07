import { describe, expect, test } from "bun:test";

import { createFakeMailProvider } from "./fake";
import { locateKeyOf, locateMessage, LOCATE_CHUNK, type LocateKey } from "./locate";
import type { MessageMeta } from "./port";
import type { SeedMessage } from "./seed";
import { contentHash } from "./sync-rules";

const FOLDER = "AI/Spam";
const RECEIVED = new Date("2026-11-03T10:05:00Z");

function mail(n: number): SeedMessage {
  return {
    messageId: `<loc-${n}@example.test>`,
    from: "boss@example.test",
    to: ["me@example.test"],
    subject: `Loc ${n}`,
    date: new Date("2026-11-03T10:00:00Z"),
    text: `Body ${n}`,
  };
}

function metaOf(n: number, size = 1000): MessageMeta {
  return {
    uid: 1,
    size,
    internalDate: RECEIVED,
    date: mail(n).date ?? null,
    messageId: mail(n).messageId ?? null,
    inReplyTo: null,
    references: [],
    from: mail(n).from,
    to: [],
    cc: [],
    subject: null,
    actionId: null,
  };
}

function keyOf(n: number, hintUid: number | null = null): LocateKey {
  return {
    messageId: `<loc-${n}@example.test>`,
    contentHash: contentHash(metaOf(n)),
    from: "boss@example.test",
    receivedAt: RECEIVED,
    hintUid,
  };
}

const opts = { internalDate: RECEIVED, size: 1000 };

function callsOf(fake: { calls: string[] }, method: string): number {
  return fake.calls.filter((call) => call === method).length;
}

describe("locateMessage", () => {
  test("hint hit: one fetchMetaIn, no search", async () => {
    const fake = createFakeMailProvider();
    const uid = fake.deliver(FOLDER, mail(1), opts);
    const found = await locateMessage(fake, FOLDER, keyOf(1, uid));
    expect(found?.uid).toBe(uid);
    expect(fake.calls).toEqual(["fetchMetaIn"]);
  });

  test("a hint in excludeUids is not fetched; the search runs", async () => {
    const fake = createFakeMailProvider();
    const first = fake.deliver(FOLDER, mail(1), opts);
    const second = fake.deliver(FOLDER, mail(1), opts);
    const found = await locateMessage(fake, FOLDER, keyOf(1, first), { excludeUids: new Set([first]) });
    expect(found?.uid).toBe(second);
    expect(fake.calls).toEqual(["searchSinceIn", "fetchByUidsIn"]);
  });

  test("two identical copies, the first excluded: the second is returned", async () => {
    const fake = createFakeMailProvider();
    const first = fake.deliver(FOLDER, mail(1), opts);
    const second = fake.deliver(FOLDER, mail(1), opts);
    const found = await locateMessage(fake, FOLDER, keyOf(1), { excludeUids: new Set([first]) });
    expect(found?.uid).toBe(second);
  });

  test("the only copy has \\Deleted: null", async () => {
    const fake = createFakeMailProvider();
    const uid = fake.deliver(FOLDER, mail(1), opts);
    await fake.setFlags(FOLDER, uid, { add: ["\\Deleted"] });
    expect(await locateMessage(fake, FOLDER, keyOf(1, uid))).toBeNull();
  });

  test("hint miss (another mail holds the UID): the search finds the mail by identity", async () => {
    const fake = createFakeMailProvider({ keepUidOnCopy: true });
    const other = fake.deliver(FOLDER, mail(2), opts);
    const wanted = fake.deliver(FOLDER, mail(1), opts);
    const found = await locateMessage(fake, FOLDER, keyOf(1, other));
    expect(found?.uid).toBe(wanted);
    expect(fake.calls).toEqual(["fetchMetaIn", "searchSinceIn", "fetchByUidsIn"]);
  });

  test("mail not in the folder: null, and no fetchByUidsIn when the search is empty", async () => {
    const fake = createFakeMailProvider();
    fake.ensureFolder(FOLDER);
    fake.calls.length = 0;
    expect(await locateMessage(fake, FOLDER, keyOf(1, 7))).toBeNull();
    expect(fake.calls).toEqual(["fetchMetaIn", "searchSinceIn"]);
  });

  test("the search window starts one day before receivedAt", async () => {
    const fake = createFakeMailProvider();
    // INTERNALDATE a few hours before receivedAt, on the previous day.
    const uid = fake.deliver(FOLDER, mail(1), { ...opts, internalDate: new Date("2026-11-02T23:00:00Z") });
    const key = { ...keyOf(1), receivedAt: new Date("2026-11-03T01:00:00Z") };
    // strict mode compares the hash, which uses the Date header, so the mail still counts.
    expect((await locateMessage(fake, FOLDER, key))?.uid).toBe(uid);
  });

  test("250 mails, the wanted one last: three fetchByUidsIn calls of at most 100", async () => {
    expect(LOCATE_CHUNK).toBe(100);
    const fake = createFakeMailProvider();
    for (let n = 1000; n < 1249; n += 1) fake.deliver(FOLDER, mail(n), opts);
    const wanted = fake.deliver(FOLDER, mail(1), opts);
    const found = await locateMessage(fake, FOLDER, keyOf(1));
    expect(found?.uid).toBe(wanted);
    expect(callsOf(fake, "fetchByUidsIn")).toBe(3);
  });

  test("folder missing: null", async () => {
    const fake = createFakeMailProvider();
    expect(await locateMessage(fake, "No/Such", keyOf(1, 1))).toBeNull();
  });
});

describe("locateKeyOf", () => {
  test("maps the row columns", () => {
    const key = locateKeyOf(
      { message_id_header: "<a@x.test>", content_hash: "h", from_address: "a@x.test", received_at: RECEIVED },
      4
    );
    expect(key).toEqual({
      messageId: "<a@x.test>",
      contentHash: "h",
      from: "a@x.test",
      receivedAt: RECEIVED,
      hintUid: 4,
    });
  });
});
