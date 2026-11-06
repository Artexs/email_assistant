import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { detectNotices } from "../../src/modules/channels";
import { markSynced, type MailboxStatus } from "../../src/modules/mail/repo";
import type { DB, TenantContext } from "../../src/platform/db";

import { addMember, createOrgWithMailbox, insertTriaged, isolateChannels, linkChat, randomChatId } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const T = new Date("2026-11-06T10:00:00Z");
const MINUTE = 60_000;
const HOUR = 3_600_000;

function at(offsetMs: number): Date {
  return new Date(T.getTime() + offsetMs);
}

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
  assistantId: string;
  mailboxId: string;
}

// Owner and assistant linked at T - 1 h; the mailbox is active and synced at T - 5 min.
async function org(trx: Transaction<DB>): Promise<Org> {
  const created = await createOrgWithMailbox(trx);
  const ctx = { orgId: created.orgId };
  const assistantId = await addMember(trx, created.orgId);
  await linkChat(trx, ctx, created.userId, randomChatId(), at(-HOUR));
  await linkChat(trx, ctx, assistantId, randomChatId(), at(-HOUR));
  await markSynced(trx, ctx, created.mailboxId, at(-5 * MINUTE));
  return { ctx, orgId: created.orgId, ownerId: created.userId, assistantId, mailboxId: created.mailboxId };
}

async function run(trx: Transaction<DB>, startedAt = at(-HOUR)): Promise<void> {
  await detectNotices({ db: trx, now: () => T, startedAt });
}

async function setStatus(trx: Transaction<DB>, o: Org, status: MailboxStatus, changedAt?: Date): Promise<void> {
  await trx
    .updateTable("mailboxes")
    .set({ status, ...(changedAt === undefined ? {} : { status_changed_at: changedAt }) })
    .where("id", "=", o.mailboxId)
    .execute();
}

async function rows(trx: Transaction<DB>, orgId: string, kind?: string) {
  let query = trx
    .selectFrom("outbox")
    .select(["id", "user_id", "kind", "dedup_key", "text", "buttons", "status", "error_code", "email_id", "mailbox_id"])
    .where("org_id", "=", orgId)
    .orderBy("created_at")
    .orderBy("id");
  if (kind !== undefined) query = query.where("kind", "=", kind);
  return query.execute();
}

describe("urgent notices", () => {
  test("every linked member gets one row per urgent mail; a repeat adds none", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      const emailId = await insertTriaged(trx, o.ctx, o.mailboxId, { category: "urgent", createdAt: at(-10 * MINUTE) });
      await trx
        .insertInto("actions")
        .values({
          org_id: o.orgId,
          email_id: emailId,
          type: "flag",
          status: "logged",
          payload: JSON.stringify({}),
          idempotency_key: `k-${emailId}`,
        })
        .execute();

      await run(trx);
      const found = await rows(trx, o.orgId, "urgent");
      expect(found).toHaveLength(2);
      expect(found.map((r) => r.user_id).sort()).toEqual([o.ownerId, o.assistantId].sort());
      for (const row of found) {
        expect(row.dedup_key).toBe(`urgent:${emailId}`);
        expect(row.email_id).toBe(emailId);
        expect(row.text).toContain("🔴 Urgent mail");
        expect(row.text).toContain("→ would flag");
        expect(JSON.stringify(row.buttons)).toContain(`fr:u:${emailId}`);
        expect(JSON.stringify(row.buttons)).toContain(`fe:${emailId}`);
      }

      await run(trx);
      expect(await rows(trx, o.orgId, "urgent")).toHaveLength(2);
    });
  });

  test("a member linked after the mail does not get it", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await trx
        .updateTable("chat_links")
        .set({ linked_at: at(-5 * MINUTE) })
        .where("user_id", "=", o.assistantId)
        .execute();
      await insertTriaged(trx, o.ctx, o.mailboxId, { category: "urgent", createdAt: at(-10 * MINUTE) });

      await run(trx);
      const found = await rows(trx, o.orgId, "urgent");
      expect(found.map((r) => r.user_id)).toEqual([o.ownerId]);
    });
  });

  test("old urgent mail and other categories give no row", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await trx
        .updateTable("chat_links")
        .set({ linked_at: at(-48 * HOUR) })
        .where("org_id", "=", o.orgId)
        .execute();
      await insertTriaged(trx, o.ctx, o.mailboxId, { category: "urgent", createdAt: at(-25 * HOUR) });
      await insertTriaged(trx, o.ctx, o.mailboxId, { category: "info", createdAt: at(-10 * MINUTE) });

      await run(trx);
      expect(await rows(trx, o.orgId)).toHaveLength(0);
    });
  });

  test("a paused mailbox gives no urgent row", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await insertTriaged(trx, o.ctx, o.mailboxId, { category: "urgent", createdAt: at(-10 * MINUTE) });
      await setStatus(trx, o, "paused");

      await run(trx);
      expect(await rows(trx, o.orgId, "urgent")).toHaveLength(0);
    });
  });
});

describe("auth_error notices", () => {
  test("one row for the owner per episode; a new episode makes the old pending row outdated", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      const s = at(-20 * MINUTE);
      await setStatus(trx, o, "auth_error", s);

      await run(trx);
      await run(trx);
      let found = await rows(trx, o.orgId, "auth_error");
      expect(found).toHaveLength(1);
      expect(found[0]?.user_id).toBe(o.ownerId);
      expect(found[0]?.dedup_key).toBe(`auth_error:${o.mailboxId}:${s.getTime()}`);
      expect(found[0]?.status).toBe("pending");

      const s2 = at(-2 * MINUTE);
      await setStatus(trx, o, "active");
      await setStatus(trx, o, "auth_error", s2);
      await run(trx);
      found = await rows(trx, o.orgId, "auth_error");
      expect(found).toHaveLength(2);
      const first = found.find((r) => r.dedup_key === `auth_error:${o.mailboxId}:${s.getTime()}`);
      const second = found.find((r) => r.dedup_key === `auth_error:${o.mailboxId}:${s2.getTime()}`);
      expect(first?.status).toBe("failed");
      expect(first?.error_code).toBe("outdated");
      expect(second?.status).toBe("pending");
    });
  });

  test("a pending row becomes outdated when the mailbox is active again", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await setStatus(trx, o, "auth_error", at(-20 * MINUTE));
      await run(trx);
      await setStatus(trx, o, "active");

      await run(trx);
      const found = await rows(trx, o.orgId, "auth_error");
      expect(found).toHaveLength(1);
      expect(found[0]?.status).toBe("failed");
      expect(found[0]?.error_code).toBe("outdated");
    });
  });
});

describe("sync notices", () => {
  test("a late sync gives a notice only after the grace time since the start", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      const last = at(-40 * MINUTE);
      await markSynced(trx, o.ctx, o.mailboxId, last);

      await run(trx, at(-5 * MINUTE));
      expect(await rows(trx, o.orgId, "sync_stale")).toHaveLength(0);

      await run(trx, at(-15 * MINUTE));
      await run(trx, at(-15 * MINUTE));
      const found = await rows(trx, o.orgId, "sync_stale");
      expect(found).toHaveLength(1);
      expect(found[0]?.user_id).toBe(o.ownerId);
      expect(found[0]?.dedup_key).toBe(`sync_stale:${o.mailboxId}:${last.getTime()}`);
    });
  });

  test("a mailbox that never synced uses its creation time", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await trx
        .updateTable("mailboxes")
        .set({ last_synced_at: null, created_at: at(-2 * HOUR) })
        .where("id", "=", o.mailboxId)
        .execute();

      await run(trx);
      const found = await rows(trx, o.orgId, "sync_stale");
      expect(found).toHaveLength(1);
      expect(found[0]?.dedup_key).toBe(`sync_stale:${o.mailboxId}:never`);
      expect(found[0]?.text).toContain("Last good sync: never.");
    });
  });

  test("a sent late notice gets one sync_ok when the sync is fresh; a pending one becomes outdated", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      const last = at(-40 * MINUTE);
      await markSynced(trx, o.ctx, o.mailboxId, last);
      await run(trx);
      await trx
        .updateTable("outbox")
        .set({ status: "sent", sent_at: at(-10 * MINUTE) })
        .where("org_id", "=", o.orgId)
        .where("kind", "=", "sync_stale")
        .execute();

      await markSynced(trx, o.ctx, o.mailboxId, at(-MINUTE));
      await run(trx);
      await run(trx);
      const ok = await rows(trx, o.orgId, "sync_ok");
      expect(ok).toHaveLength(1);
      expect(ok[0]?.user_id).toBe(o.ownerId);
      expect(ok[0]?.dedup_key).toBe(`sync_ok:${o.mailboxId}:${last.getTime()}`);
    });

    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await markSynced(trx, o.ctx, o.mailboxId, at(-40 * MINUTE));
      await run(trx);
      await markSynced(trx, o.ctx, o.mailboxId, at(-MINUTE));
      await run(trx);
      const stale = await rows(trx, o.orgId, "sync_stale");
      expect(stale).toHaveLength(1);
      expect(stale[0]?.status).toBe("failed");
      expect(stale[0]?.error_code).toBe("outdated");
      expect(await rows(trx, o.orgId, "sync_ok")).toHaveLength(0);
    });
  });

  test("a paused or auth_error mailbox gets no late notice", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await markSynced(trx, o.ctx, o.mailboxId, at(-2 * HOUR));
      await setStatus(trx, o, "paused");
      await run(trx);
      expect(await rows(trx, o.orgId, "sync_stale")).toHaveLength(0);

      await setStatus(trx, o, "auth_error");
      await run(trx);
      expect(await rows(trx, o.orgId, "sync_stale")).toHaveLength(0);
    });
  });
});

describe("organizations", () => {
  test("rows stay inside their organization", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await org(trx);
      const b = await org(trx);
      const emailB = await insertTriaged(trx, b.ctx, b.mailboxId, { category: "urgent", createdAt: at(-10 * MINUTE) });

      await run(trx);
      const forB = await rows(trx, b.orgId, "urgent");
      expect(forB.map((r) => r.user_id).sort()).toEqual([b.ownerId, b.assistantId].sort());
      expect(forB.every((r) => r.email_id === emailB)).toBe(true);
      const forA = await rows(trx, a.orgId);
      expect(forA.some((r) => r.email_id === emailB)).toBe(false);
      expect(forA).toHaveLength(0);
    });
  });

  test("an error in one organization does not stop the next", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await org(trx);
      const b = await org(trx);
      await insertTriaged(trx, a.ctx, a.mailboxId, { category: "urgent", createdAt: at(-10 * MINUTE) });
      await insertTriaged(trx, b.ctx, b.mailboxId, { category: "urgent", createdAt: at(-10 * MINUTE) });
      await trx.updateTable("organizations").set({ timezone: "Mars/Base" }).where("id", "=", a.orgId).execute();

      await run(trx);
      expect(await rows(trx, b.orgId, "urgent")).toHaveLength(2);
      expect(await rows(trx, a.orgId)).toHaveLength(0);
      const failed = errorLines.filter((line) => line.includes(a.orgId));
      expect(failed).toHaveLength(1);
      expect(errorLines.filter((line) => line.includes(b.orgId))).toHaveLength(0);
    });
  });
});
