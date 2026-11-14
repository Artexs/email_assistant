import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { auditEvents } from "../../src/modules/audit";
import { switchMailboxStatus } from "../../src/modules/mail";
import { setMailboxStatus } from "../../src/modules/mail/repo";
import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const T0 = new Date("2026-11-11T10:00:00.000Z");
const T1 = new Date("2026-11-11T10:05:00.000Z");
const T2 = new Date("2026-11-11T10:10:00.000Z");

const mailboxRow = (trx: Transaction<DB>, id: string) =>
  trx.selectFrom("mailboxes").select(["status", "status_changed_at"]).where("id", "=", id).executeTakeFirstOrThrow();
const auditRows = (trx: Transaction<DB>, orgId: string, event: string) =>
  trx
    .selectFrom("audit_log")
    .select(["actor", "data"])
    .where("org_id", "=", orgId)
    .where("event", "=", event)
    .execute();

describe("switchMailboxStatus", () => {
  test("pause an active mailbox, then pause again", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId, userId: a.userId };
      const first = await switchMailboxStatus(trx, ctx, a.mailboxId, {
        to: "paused",
        actor: a.userId,
        via: "web",
        now: T1,
      });
      expect(first.kind).toBe("changed");
      if (first.kind === "changed") expect(first.mailbox.status).toBe("paused");
      const row = await mailboxRow(trx, a.mailboxId);
      expect(row.status).toBe("paused");
      expect(row.status_changed_at).toEqual(T1);
      const events = await auditRows(trx, a.orgId, auditEvents.mailboxPaused);
      expect(events).toHaveLength(1);
      expect(events[0]?.actor).toBe(a.userId);
      expect(events[0]?.data).toEqual({ mailbox_id: a.mailboxId, via: "web" });

      const again = await switchMailboxStatus(trx, ctx, a.mailboxId, {
        to: "paused",
        actor: a.userId,
        via: "web",
        now: T2,
      });
      expect(again.kind).toBe("already");
      expect(await auditRows(trx, a.orgId, auditEvents.mailboxPaused)).toHaveLength(1);
      expect((await mailboxRow(trx, a.mailboxId)).status_changed_at).toEqual(T1);
    });
  });

  test("resume, then resume again", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId, userId: a.userId };
      await switchMailboxStatus(trx, ctx, a.mailboxId, { to: "paused", actor: a.userId, via: "web", now: T0 });
      const resumed = await switchMailboxStatus(trx, ctx, a.mailboxId, {
        to: "active",
        actor: a.userId,
        via: "telegram",
        now: T1,
      });
      expect(resumed.kind).toBe("changed");
      expect((await mailboxRow(trx, a.mailboxId)).status).toBe("active");
      const events = await auditRows(trx, a.orgId, auditEvents.mailboxResumed);
      expect(events).toHaveLength(1);
      expect(events[0]?.data).toEqual({ mailbox_id: a.mailboxId, via: "telegram" });

      const again = await switchMailboxStatus(trx, ctx, a.mailboxId, {
        to: "active",
        actor: a.userId,
        via: "web",
        now: T2,
      });
      expect(again.kind).toBe("already");
      expect(await auditRows(trx, a.orgId, auditEvents.mailboxResumed)).toHaveLength(1);
    });
  });

  test("an auth_error mailbox stays as it is", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId, userId: a.userId };
      await setMailboxStatus(trx, ctx, a.mailboxId, "auth_error", T0);
      for (const to of ["paused", "active"] as const) {
        const result = await switchMailboxStatus(trx, ctx, a.mailboxId, { to, actor: a.userId, via: "web", now: T1 });
        expect(result).toEqual({ kind: "auth_error" });
      }
      const row = await mailboxRow(trx, a.mailboxId);
      expect(row.status).toBe("auth_error");
      expect(row.status_changed_at).toEqual(T0);
      expect(await auditRows(trx, a.orgId, auditEvents.mailboxPaused)).toEqual([]);
      expect(await auditRows(trx, a.orgId, auditEvents.mailboxResumed)).toEqual([]);
    });
  });

  test("a host_blocked mailbox stays as it is", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId, userId: a.userId };
      await setMailboxStatus(trx, ctx, a.mailboxId, "host_blocked", T0);
      for (const to of ["paused", "active"] as const) {
        const result = await switchMailboxStatus(trx, ctx, a.mailboxId, { to, actor: a.userId, via: "web", now: T1 });
        expect(result).toEqual({ kind: "host_blocked" });
      }
      const row = await mailboxRow(trx, a.mailboxId);
      expect(row.status).toBe("host_blocked");
      expect(row.status_changed_at).toEqual(T0);
      expect(await auditRows(trx, a.orgId, auditEvents.mailboxPaused)).toEqual([]);
      expect(await auditRows(trx, a.orgId, auditEvents.mailboxResumed)).toEqual([]);
    });
  });

  test("a mailbox of another organization or an unknown id is not found", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId, userId: a.userId };
      const before = await mailboxRow(trx, b.mailboxId);
      const other = await switchMailboxStatus(trx, ctx, b.mailboxId, {
        to: "paused",
        actor: a.userId,
        via: "web",
        now: T1,
      });
      expect(other).toEqual({ kind: "not_found" });
      expect(await mailboxRow(trx, b.mailboxId)).toEqual(before);
      const unknown = await switchMailboxStatus(trx, ctx, randomUUID(), {
        to: "paused",
        actor: a.userId,
        via: "web",
        now: T1,
      });
      expect(unknown).toEqual({ kind: "not_found" });
      expect(await auditRows(trx, b.orgId, auditEvents.mailboxPaused)).toEqual([]);
    });
  });
});
