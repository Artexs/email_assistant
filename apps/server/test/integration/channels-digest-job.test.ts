import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { scheduleDigests } from "../../src/modules/channels";
import { markSynced } from "../../src/modules/mail/repo";
import { markDigestSent } from "../../src/modules/reports";
import { setDigestTimes } from "../../src/modules/tenancy";
import type { DB, TenantContext } from "../../src/platform/db";

import { addMember, createOrgWithMailbox, insertTriaged, isolateChannels, linkChat, randomChatId } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

// L = the link time; the organization is in Europe/Warsaw (UTC+1 in November).
const L = new Date("2026-11-05T20:00:00Z");
const HOUR = 3_600_000;

let errorLines: string[] = [];
let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  errorLines = [];
  logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
  errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errorLines.push(args.join(" "));
  });
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

interface Org {
  ctx: TenantContext;
  orgId: string;
  ownerId: string;
  mailboxId: string;
}

// The owner is linked at L and has the digest times 08:00 and 16:00.
async function org(trx: Transaction<DB>, times: string[] = ["08:00", "16:00"]): Promise<Org> {
  const created = await createOrgWithMailbox(trx);
  const ctx = { orgId: created.orgId };
  await linkChat(trx, ctx, created.userId, randomChatId(), L);
  await setDigestTimes(trx, ctx, created.userId, times);
  return { ctx, orgId: created.orgId, ownerId: created.userId, mailboxId: created.mailboxId };
}

async function run(trx: Transaction<DB>, iso: string): Promise<void> {
  await scheduleDigests({ db: trx, now: () => new Date(iso) });
}

async function digests(trx: Transaction<DB>, orgId: string, userId?: string) {
  let query = trx
    .selectFrom("digests")
    .select(["id", "user_id", "slot_key", "period_start", "period_end", "sent_at"])
    .where("org_id", "=", orgId)
    .orderBy("slot_key");
  if (userId !== undefined) query = query.where("user_id", "=", userId);
  return query.execute();
}

async function outbox(trx: Transaction<DB>, orgId: string, userId?: string) {
  let query = trx
    .selectFrom("outbox")
    .select(["id", "user_id", "kind", "dedup_key", "text", "digest_id", "status"])
    .where("org_id", "=", orgId)
    .orderBy("dedup_key");
  if (userId !== undefined) query = query.where("user_id", "=", userId);
  return query.execute();
}

describe("scheduleDigests", () => {
  test("nothing is due before the slot", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await run(trx, "2026-11-06T06:59:00Z");
      expect(await digests(trx, o.orgId)).toHaveLength(0);
      expect(await outbox(trx, o.orgId)).toHaveLength(0);
    });
  });

  test("one digest row and one outbox row per slot; a repeat adds none", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await run(trx, "2026-11-06T07:00:00Z");

      const found = await digests(trx, o.orgId);
      expect(found).toHaveLength(1);
      expect(found[0]?.slot_key).toBe("2026-11-06T08:00");
      expect(found[0]?.period_start.toISOString()).toBe(new Date(L.getTime() - 24 * HOUR).toISOString());
      expect(found[0]?.period_end.toISOString()).toBe("2026-11-06T07:00:00.000Z");
      const sent = await outbox(trx, o.orgId);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.kind).toBe("digest");
      expect(sent[0]?.dedup_key).toBe("digest:2026-11-06T08:00");
      expect(sent[0]?.digest_id).toBe(found[0]?.id ?? "");
      expect(sent[0]?.text.startsWith("📬 Digest 08:00 · Fri 6 Nov")).toBe(true);

      await run(trx, "2026-11-06T07:01:00Z");
      expect(await digests(trx, o.orgId)).toHaveLength(1);
      expect(await outbox(trx, o.orgId)).toHaveLength(1);
    });
  });

  test("a sent digest sets the start of the next one", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await run(trx, "2026-11-06T07:00:00Z");
      const first = (await digests(trx, o.orgId))[0];
      if (first === undefined) throw new Error("no first digest");
      await markDigestSent(trx, o.ctx, first.id, new Date("2026-11-06T07:00:05Z"));
      await trx
        .updateTable("outbox")
        .set({ status: "sent", sent_at: new Date("2026-11-06T07:00:05Z"), external_message_id: 1 })
        .where("digest_id", "=", first.id)
        .execute();

      await run(trx, "2026-11-06T15:00:00Z");
      const found = await digests(trx, o.orgId);
      expect(found.map((row) => row.slot_key)).toEqual(["2026-11-06T08:00", "2026-11-06T16:00"]);
      expect(found[1]?.period_start.toISOString()).toBe(first.period_end.toISOString());
    });
  });

  test("a digest that was not sent does not move the start", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await run(trx, "2026-11-06T07:00:00Z");
      await trx
        .updateTable("outbox")
        .set({ status: "failed", error_code: "blocked" })
        .where("org_id", "=", o.orgId)
        .execute();

      await run(trx, "2026-11-06T15:00:00Z");
      const found = await digests(trx, o.orgId);
      expect(found).toHaveLength(2);
      expect(found[1]?.period_start.toISOString()).toBe(new Date(L.getTime() - 24 * HOUR).toISOString());
    });
  });

  test("a member without digest times gets no digest", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await setDigestTimes(trx, o.ctx, o.ownerId, []);
      await run(trx, "2026-11-06T07:00:00Z");
      expect(await digests(trx, o.orgId)).toHaveLength(0);
    });
  });

  test("the first run of the day within 6 hours gives a late digest", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await run(trx, "2026-11-06T12:00:00Z");
      const found = await digests(trx, o.orgId);
      expect(found.map((row) => row.slot_key)).toEqual(["2026-11-06T08:00"]);
      const text = (await outbox(trx, o.orgId))[0]?.text ?? "";
      expect(text.split("\n")[0]?.endsWith("(late)")).toBe(true);
    });
  });

  test("a slot more than 6 hours back is skipped", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await run(trx, "2026-11-06T14:30:00Z");
      expect(await digests(trx, o.orgId)).toHaveLength(0);
    });
  });

  test("a slot before the link gives no digest", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await trx
        .updateTable("chat_links")
        .set({ linked_at: new Date("2026-11-06T07:30:00Z") })
        .where("user_id", "=", o.ownerId)
        .execute();
      await run(trx, "2026-11-06T07:40:00Z");
      expect(await digests(trx, o.orgId)).toHaveLength(0);
    });
  });

  test("each member has own digest times", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      const assistantId = await addMember(trx, o.orgId);
      await linkChat(trx, o.ctx, assistantId, randomChatId(), L);
      await setDigestTimes(trx, o.ctx, assistantId, ["09:00"]);

      await run(trx, "2026-11-06T07:00:00Z");
      expect(await digests(trx, o.orgId, o.ownerId)).toHaveLength(1);
      expect(await digests(trx, o.orgId, assistantId)).toHaveLength(0);

      await run(trx, "2026-11-06T08:00:00Z");
      expect(await digests(trx, o.orgId, o.ownerId)).toHaveLength(1);
      const assistant = await digests(trx, o.orgId, assistantId);
      expect(assistant.map((row) => row.slot_key)).toEqual(["2026-11-06T09:00"]);
      expect(await outbox(trx, o.orgId, assistantId)).toHaveLength(1);
    });
  });

  test("the digest of one organization never holds mail of another", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await org(trx);
      const b = await org(trx, []);
      await insertTriaged(trx, b.ctx, b.mailboxId, {
        category: "info",
        createdAt: new Date("2026-11-06T05:00:00Z"),
        subject: "MARKER-SUBJECT-B",
      });

      await run(trx, "2026-11-06T07:00:00Z");
      const sent = await outbox(trx, a.orgId);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.text).not.toContain("MARKER-SUBJECT-B");
    });
  });

  test("an organization that fails does not stop the next one", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await org(trx);
      const b = await org(trx);
      await trx.updateTable("organizations").set({ timezone: "Mars/Base" }).where("id", "=", b.orgId).execute();

      await run(trx, "2026-11-06T07:00:00Z");
      expect(await digests(trx, a.orgId)).toHaveLength(1);
      expect(await outbox(trx, a.orgId)).toHaveLength(1);
      expect(await digests(trx, b.orgId)).toHaveLength(0);
      const lines = errorLines.filter((line) => line.includes(b.orgId));
      expect(lines).toHaveLength(1);
      expect(errorLines.filter((line) => line.includes(a.orgId))).toHaveLength(0);
    });
  });

  test("an urgent result is in the text, with the last sync", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await markSynced(trx, o.ctx, o.mailboxId, new Date("2026-11-06T06:55:00Z"));
      await insertTriaged(trx, o.ctx, o.mailboxId, {
        category: "urgent",
        createdAt: new Date("2026-11-06T05:00:00Z"),
        subject: "MARKER-URGENT",
      });

      await run(trx, "2026-11-06T07:00:00Z");
      const text = (await outbox(trx, o.orgId))[0]?.text ?? "";
      expect(text).toContain("MARKER-URGENT");
      expect(text).toContain("Last sync");
    });
  });
});
