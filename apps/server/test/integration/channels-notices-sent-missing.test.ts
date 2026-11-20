import { randomUUID } from "node:crypto";
import { format } from "node:util";

import { DAY_MS, HOUR_MS, MINUTE_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { type Transaction } from "kysely";

import * as noticeQueue from "../../src/modules/channels/notice-queue";
import { insertSentEmails, type NewSentEmail } from "../../src/modules/mail";
import { insertMailbox, writeSentSwitch } from "../../src/modules/mail/repo";
import { configureFeatures, featureSettings, upsertOrgFeature } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";

import { at, Org, org, rows, run, setStatus, T } from "./channels-notices-helpers";
import { addMember, isolateChannels, linkChat, randomChatId, testCapabilities } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

let errorLines: string[] = [];
let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  errorLines = [];
  logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
  errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errorLines.push(format(...args));
  });
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

describe("sent_missing notices", () => {
  const initialOff = [...featureSettings().off];

  beforeEach(() => {
    configureFeatures({ off: [] });
  });
  afterAll(() => {
    configureFeatures({ off: initialOff });
  });

  interface SentOrg extends Org {
    secondOwnerId: string;
  }

  // Two linked owners and one member (the assistant). The flag and the switch are on; the first pass ended 8 days ago and
  // the last pass 5 minutes ago. The flag is set for this test organization only (never a real one).
  async function sentOrg(
    trx: Transaction<DB>,
    opts: {
      flag?: boolean;
      switchOn?: boolean;
      firstPass?: Date;
      lastPass?: Date | null;
      errorCode?: string | null;
    } = {}
  ): Promise<SentOrg> {
    const o = await org(trx);
    const secondOwnerId = await addMember(trx, o.orgId, "owner");
    await linkChat(trx, o.ctx, secondOwnerId, randomChatId(), at(-HOUR_MS));
    await upsertOrgFeature(trx, o.ctx, {
      flag: "sent_sync",
      enabled: opts.flag ?? true,
      setBy: "test",
      setAt: T,
    });
    await writeSentSwitch(trx, o.ctx, o.mailboxId, { enabled: opts.switchOn ?? true, at: at(-30 * DAY_MS) });
    if (opts.switchOn === false) return { ...o, secondOwnerId };
    await trx
      .updateTable("mailbox_sent_sync")
      .set({
        path: "Sent",
        uidvalidity: "7",
        last_uid: "1",
        first_pass_at: opts.firstPass ?? at(-8 * DAY_MS),
        last_pass_at: opts.lastPass === undefined ? at(-5 * MINUTE_MS) : opts.lastPass,
        last_error_code: opts.errorCode ?? null,
      })
      .where("mailbox_id", "=", o.mailboxId)
      .execute();
    return { ...o, secondOwnerId };
  }

  let counter = 0;
  async function sentMail(trx: Transaction<DB>, o: Org, when: Date, extra: Partial<NewSentEmail> = {}): Promise<void> {
    counter += 1;
    const key = `sm${counter}-${randomUUID()}`;
    await insertSentEmails(trx, o.ctx, [
      {
        mailboxId: o.mailboxId,
        dedupKey: key,
        path: "Sent",
        uidValidity: 7,
        uid: counter,
        messageId: `<${key}@x.test>`,
        parentMessageId: null,
        referencesIds: [],
        threadKey: key,
        fromAddress: "me@corp.test",
        toAddresses: ["to@x.test"],
        ccAddresses: [],
        subject: "Re: X",
        sentAt: when,
        internalDate: when,
        origin: "user",
        actionId: null,
        content: "headers_only",
        ...extra,
      },
    ]);
  }

  const missing = (trx: Transaction<DB>, o: Org) => rows(trx, o.orgId, "sent_missing");

  async function expectCancelled(trx: Transaction<DB>, o: Org): Promise<void> {
    const found = await missing(trx, o);
    expect(found.length).toBeGreaterThan(0);
    for (const row of found) {
      expect(row.status).toBe("failed");
      expect(row.error_code).toBe("outdated");
    }
  }

  test("1: no sent mail: one row per owner, none for the member; key, view and mailbox", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sentOrg(trx);

      await run(trx);

      const found = await missing(trx, o);
      expect(found.map((row) => row.user_id).sort()).toEqual([o.ownerId, o.secondOwnerId].sort());
      const address = (
        await trx.selectFrom("mailboxes").select("address").where("id", "=", o.mailboxId).executeTakeFirstOrThrow()
      ).address;
      for (const row of found) {
        expect(row.dedup_key).toBe(`sent_missing:${o.mailboxId}:${at(-8 * DAY_MS).getTime()}`);
        expect(row.mailbox_id).toBe(o.mailboxId);
        expect(row.status).toBe("pending");
        expect(row.view).toEqual({
          address,
          since: at(-8 * DAY_MS).toISOString(),
          now: T.toISOString(),
          timeZone: "Europe/Warsaw",
        });
        expect(row.text).toContain(address);
      }
    });
  });

  test("2: a second run adds no row", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sentOrg(trx);
      await run(trx);
      await run(trx);
      expect(await missing(trx, o)).toHaveLength(2);
    });
  });

  test("3: the newest user mail starts the quiet period when it is later than the first pass", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sentOrg(trx, { firstPass: at(-20 * DAY_MS) });
      await sentMail(trx, o, at(-9 * DAY_MS));
      await sentMail(trx, o, at(-15 * DAY_MS));

      await run(trx);

      const found = await missing(trx, o);
      expect(found).toHaveLength(2);
      for (const row of found) {
        expect(row.dedup_key).toBe(`sent_missing:${o.mailboxId}:${at(-9 * DAY_MS).getTime()}`);
        expect((row.view as { since: string }).since).toBe(at(-9 * DAY_MS).toISOString());
      }
    });
  });

  test("4: a user mail 6 days ago gives no row; a pending row of the older period is cancelled", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sentOrg(trx, { firstPass: at(-20 * DAY_MS) });
      await sentMail(trx, o, at(-9 * DAY_MS));
      await run(trx);
      expect(await missing(trx, o)).toHaveLength(2);

      await sentMail(trx, o, at(-6 * DAY_MS));
      await run(trx);

      await expectCancelled(trx, o);
      expect((await missing(trx, o)).every((row) => row.status === "failed")).toBe(true);
    });
  });

  test("a new quiet period after a new user mail: a new row; the old pending row is cancelled", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sentOrg(trx, { firstPass: at(-30 * DAY_MS) });
      await run(trx);
      const firstKey = `sent_missing:${o.mailboxId}:${at(-30 * DAY_MS).getTime()}`;
      expect((await missing(trx, o)).map((row) => row.dedup_key)).toEqual([firstKey, firstKey]);

      await sentMail(trx, o, at(-8 * DAY_MS));
      await run(trx);

      const found = await missing(trx, o);
      expect(found).toHaveLength(4);
      const secondKey = `sent_missing:${o.mailboxId}:${at(-8 * DAY_MS).getTime()}`;
      expect(found.filter((row) => row.dedup_key === firstKey).every((row) => row.status === "failed")).toBe(true);
      expect(found.filter((row) => row.dedup_key === secondKey).map((row) => row.status)).toEqual([
        "pending",
        "pending",
      ]);
    });
  });

  test("5: only a system send, a day ago: the user is still quiet", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sentOrg(trx);
      await sentMail(trx, o, at(-DAY_MS), { origin: "system", actionId: randomUUID() });
      await run(trx);
      expect(await missing(trx, o)).toHaveLength(2);
    });
  });

  test("6: a first pass 6 days ago gives no row; the limit is 7 days, not less", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sentOrg(trx, { firstPass: at(-6 * DAY_MS) });
      await run(trx);
      expect(await missing(trx, o)).toHaveLength(0);

      await trx
        .updateTable("mailbox_sent_sync")
        .set({ first_pass_at: new Date(at(-7 * DAY_MS).getTime() + 1) })
        .where("mailbox_id", "=", o.mailboxId)
        .execute();
      await run(trx);
      expect(await missing(trx, o)).toHaveLength(0);

      await trx
        .updateTable("mailbox_sent_sync")
        .set({ first_pass_at: at(-7 * DAY_MS) })
        .where("mailbox_id", "=", o.mailboxId)
        .execute();
      await run(trx);
      expect(await missing(trx, o)).toHaveLength(2);
    });
  });

  describe("7: a condition that ends the notice cancels the pending rows", () => {
    const cases: [string, (trx: Transaction<DB>, o: SentOrg) => Promise<void>][] = [
      [
        "flag off",
        (trx, o) => upsertOrgFeature(trx, o.ctx, { flag: "sent_sync", enabled: false, setBy: "test", setAt: T }),
      ],
      ["mailbox paused", (trx, o) => setStatus(trx, o, "paused")],
      ["mailbox host_blocked", (trx, o) => setStatus(trx, o, "host_blocked", at(-HOUR_MS))],
      ["mailbox auth_error", (trx, o) => setStatus(trx, o, "auth_error", at(-HOUR_MS))],
      ["switch off", (trx, o) => writeSentSwitch(trx, o.ctx, o.mailboxId, { enabled: false, at: at(-HOUR_MS) })],
    ];
    test.each(cases)("%s", async (_name, change) => {
      await withRollback(db, async (trx) => {
        await isolateChannels(trx);
        const o = await sentOrg(trx);
        await run(trx);
        expect((await missing(trx, o)).every((row) => row.status === "pending")).toBe(true);

        await change(trx, o);
        await run(trx);

        await expectCancelled(trx, o);
        expect(await missing(trx, o)).toHaveLength(2);
      });
    });

    test("with the condition from the start: no row at all", async () => {
      await withRollback(db, async (trx) => {
        await isolateChannels(trx);
        const noFlag = await sentOrg(trx, { flag: false });
        const noSwitch = await sentOrg(trx, { switchOn: false });
        const paused = await sentOrg(trx);
        await setStatus(trx, paused, "paused");
        await run(trx);
        for (const o of [noFlag, noSwitch, paused]) expect(await missing(trx, o)).toHaveLength(0);
      });
    });
  });

  test("8: (tenant) each organization gets rows for its own mailbox and owners only", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await sentOrg(trx);
      const b = await sentOrg(trx, { firstPass: at(-12 * DAY_MS) });
      // Organization C is quiet too but its flag is off: the flag of A and B does not reach it.
      const c = await sentOrg(trx, { flag: false });
      // Organization D has a recent mail: the quiet mailbox of A does not make D quiet.
      const d = await sentOrg(trx, { firstPass: at(-20 * DAY_MS) });
      await sentMail(trx, d, at(-2 * DAY_MS));

      await run(trx);

      expect(await missing(trx, c)).toHaveLength(0);
      expect(await missing(trx, d)).toHaveLength(0);
      for (const [o, days] of [
        [a, 8],
        [b, 12],
      ] as const) {
        const found = await missing(trx, o);
        expect(found.map((row) => row.user_id).sort()).toEqual([o.ownerId, o.secondOwnerId].sort());
        for (const row of found) {
          expect(row.mailbox_id).toBe(o.mailboxId);
          expect(row.dedup_key).toBe(`sent_missing:${o.mailboxId}:${at(-days * DAY_MS).getTime()}`);
        }
      }
      const all = await trx
        .selectFrom("outbox")
        .select(["org_id", "mailbox_id"])
        .where("kind", "=", "sent_missing")
        .execute();
      expect(all.filter((row) => row.org_id === a.orgId).every((row) => row.mailbox_id === a.mailboxId)).toBe(true);
      expect(all.filter((row) => row.org_id === b.orgId).every((row) => row.mailbox_id === b.mailboxId)).toBe(true);
      expect(all).toHaveLength(4);
    });
  });

  test("9: an error code or a last pass older than an hour gives no row and cancels pending rows", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sentOrg(trx);
      await run(trx);
      await trx
        .updateTable("mailbox_sent_sync")
        .set({ last_error_code: "folder_missing" })
        .where("mailbox_id", "=", o.mailboxId)
        .execute();
      await run(trx);
      await expectCancelled(trx, o);

      const stale = await sentOrg(trx, { lastPass: at(-2 * HOUR_MS) });
      await run(trx);
      expect(await missing(trx, stale)).toHaveLength(0);
      const edge = await sentOrg(trx, { lastPass: at(-HOUR_MS) });
      await run(trx);
      expect(await missing(trx, edge)).toHaveLength(2);
      const never = await sentOrg(trx, { lastPass: null });
      await run(trx);
      expect(await missing(trx, never)).toHaveLength(0);
    });
  });

  test("9b: a stale pass that writes last_pass_at in a new period gives no row before 7 days of that period", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sentOrg(trx);
      await run(trx);
      expect(await missing(trx, o)).toHaveLength(2);

      // Off, then on: the new period has a first pass 20 minutes ago. An old pass marks its own start time.
      await trx
        .updateTable("mailbox_sent_sync")
        .set({ first_pass_at: at(-20 * MINUTE_MS), last_pass_at: at(-30 * MINUTE_MS) })
        .where("mailbox_id", "=", o.mailboxId)
        .execute();
      await run(trx);
      await expectCancelled(trx, o);
    });
  });

  async function secondMailbox(trx: Transaction<DB>, o: Org, firstPass: Date): Promise<string> {
    const id = randomUUID();
    await insertMailbox(trx, o.ctx, {
      id,
      address: `second-${id}@x.test`,
      imapHost: "imap.x.test",
      imapPort: 993,
      smtpHost: "smtp.x.test",
      smtpPort: 465,
      capabilities: testCapabilities,
      folderMap: {},
    });
    await writeSentSwitch(trx, o.ctx, id, { enabled: true, at: at(-30 * DAY_MS) });
    await trx
      .updateTable("mailbox_sent_sync")
      .set({ path: "Sent", first_pass_at: firstPass, last_pass_at: at(-MINUTE_MS) })
      .where("mailbox_id", "=", id)
      .execute();
    return id;
  }

  test("two mailboxes of one organization: each key and since come from its own health row", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sentOrg(trx);
      const quiet = await secondMailbox(trx, o, at(-9 * DAY_MS));
      const recent = await secondMailbox(trx, o, at(-20 * DAY_MS));
      await sentMail(trx, { ...o, mailboxId: recent }, at(-2 * DAY_MS));

      await run(trx);

      const found = await missing(trx, o);
      expect(found).toHaveLength(4);
      expect(found.some((row) => row.mailbox_id === recent)).toBe(false);
      for (const [mailboxId, days] of [
        [o.mailboxId, 8],
        [quiet, 9],
      ] as const) {
        const own = found.filter((row) => row.mailbox_id === mailboxId);
        expect(own).toHaveLength(2);
        for (const row of own) {
          expect(row.dedup_key).toBe(`sent_missing:${mailboxId}:${at(-days * DAY_MS).getTime()}`);
          expect((row.view as { since: string }).since).toBe(at(-days * DAY_MS).toISOString());
        }
      }
    });
  });

  test("a queue that fails for one mailbox logs one skip warning and the other mailbox still gets its notice", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sentOrg(trx);
      const broken = await secondMailbox(trx, o, at(-9 * DAY_MS));
      const original = noticeQueue.queueNotice;
      const spy = spyOn(noticeQueue, "queueNotice").mockImplementation(async (...args) => {
        if (args[2].mailboxId === broken) throw new Error("test failure");
        return original(...args);
      });
      try {
        await run(trx);
        await run(trx);
      } finally {
        spy.mockRestore();
      }

      const found = await missing(trx, o);
      expect(found.map((row) => row.mailbox_id)).toEqual([o.mailboxId, o.mailboxId]);
      const warns = errorLines.filter((line) => line.includes("notice_skipped kind=sent_missing"));
      expect(warns).toEqual([`[channels] notice_skipped kind=sent_missing item_id=${broken} error=Error`]);
    });
  });
});
