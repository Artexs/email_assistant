import { describe, expect, test } from "bun:test";

import { describeMailProviderContract } from "../../../../test/contract/mail-provider";
import { SoftError } from "../../../platform/errors";
import { INBOX } from "../port";
import type { SeedMessage } from "../seed";

import { createFakeMailProvider } from "./index";

function mail(n: number): SeedMessage {
  return {
    messageId: `<fake-${n}@example.test>`,
    from: "boss@example.test",
    to: ["me@example.test"],
    subject: `Fake ${n}`,
    date: new Date("2026-11-03T10:00:00Z"),
    text: `Body ${n}`,
  };
}

describeMailProviderContract("fake", async () => {
  const provider = createFakeMailProvider();
  return {
    provider,
    seed: async (folder, msg) => {
      provider.deliver(folder, msg);
    },
    cleanup: () => Promise.resolve(),
  };
});

describe("fake provider", () => {
  test("userMove gives a new uid in the target folder and removes the source", async () => {
    const fake = createFakeMailProvider();
    const uid = fake.deliver(INBOX, mail(1));
    const newUid = fake.userMove(INBOX, uid, "Archive");
    expect(newUid).toBe(1);
    expect(await fake.fetchByUids([uid])).toHaveLength(0);
    expect(await fake.findByMessageId("Archive", "<fake-1@example.test>")).toBe(newUid);
  });

  test("resetUidValidity renumbers INBOX from 1 in the old order", async () => {
    const fake = createFakeMailProvider({ uidValidity: 5 });
    fake.deliver(INBOX, mail(1));
    const second = fake.deliver(INBOX, mail(2));
    const third = fake.deliver(INBOX, mail(3));
    fake.remove(INBOX, second);
    expect(third).toBe(3);
    fake.resetUidValidity(9);
    expect(await fake.inboxStatus()).toEqual({ uidValidity: 9, uidNext: 3 });
    const metas = await fake.fetchAbove(0);
    expect(metas.map((m) => [m.uid, m.messageId])).toEqual([
      [1, "<fake-1@example.test>"],
      [2, "<fake-3@example.test>"],
    ]);
  });

  test("failOn throws once, then the call works", async () => {
    const fake = createFakeMailProvider();
    fake.failOn("inboxStatus", new SoftError("lost connection"));
    await expect(fake.inboxStatus()).rejects.toBeInstanceOf(SoftError);
    expect((await fake.inboxStatus()).uidNext).toBe(1);
    expect(fake.calls).toEqual(["inboxStatus", "inboxStatus"]);
  });

  test("star quirk on returns the highest uid at or below the cursor; off returns nothing", async () => {
    const on = createFakeMailProvider();
    on.deliver(INBOX, mail(1));
    const top = on.deliver(INBOX, mail(2));
    expect((await on.fetchAbove(top)).map((m) => m.uid)).toEqual([top]);

    const off = createFakeMailProvider({ starQuirk: false });
    off.deliver(INBOX, mail(1));
    const offTop = off.deliver(INBOX, mail(2));
    expect(await off.fetchAbove(offTop)).toEqual([]);
  });

  test("close sets closed", async () => {
    const fake = createFakeMailProvider();
    await fake.close();
    expect(fake.closed).toBe(true);
  });

  test("fetchBodyText gives null when the size is over bodyLimitBytes", async () => {
    const fake = createFakeMailProvider({ bodyLimitBytes: 10 });
    const uid = fake.deliver(INBOX, mail(1), { size: 11 });
    expect(await fake.fetchBodyText(uid)).toBeNull();
  });
});
