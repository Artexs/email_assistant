import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { listSendLimitHolds, SENT_COPY_PENDING_MAX_AGE_MS } from "../../src/modules/actions";
import { auditEvents, recordAudit } from "../../src/modules/audit";
import { detectNotices } from "../../src/modules/channels";
import { insertSenderRule } from "../../src/modules/config";
import { ensureSyncFolders } from "../../src/modules/mail";
import { insertMailbox, markSynced, type MailboxStatus } from "../../src/modules/mail/repo";
import type { DB, TenantContext } from "../../src/platform/db";

import {
  addMember,
  createOrgWithMailbox,
  insertAction,
  insertDelegate,
  insertDelegation,
  insertDraftAndSend,
  insertTestEmail,
  insertTriaged,
  insertTriagedWithActions,
  isolateChannels,
  linkChat,
  randomChatId,
  resumeOrg,
  suspendOrg,
  testCapabilities,
  renderedOf,
} from "./fixtures";
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
  await trx
    .updateTable("mailboxes")
    .set({ status_changed_at: at(-HOUR) })
    .where("id", "=", created.mailboxId)
    .execute();
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
    .select([
      "id",
      "user_id",
      "kind",
      "dedup_key",
      "text",
      "buttons",
      "view",
      "locale",
      "status",
      "error_code",
      "email_id",
      "mailbox_id",
      "channel",
      "detail",
    ])
    .where("org_id", "=", orgId)
    .orderBy("created_at")
    .orderBy("id");
  if (kind !== undefined) query = query.where("kind", "=", kind);
  // `text` and `buttons` are the registry render of the view (the row stores them after the send).
  return (await query.execute()).map((row) => ({ ...row, ...renderedOf(row) }));
}

describe("urgent notices", () => {
  test("a suspended organization gets no row; the active one does", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await org(trx);
      const b = await org(trx);
      await suspendOrg(trx, b.orgId);
      for (const o of [a, b]) {
        await insertTriaged(trx, o.ctx, o.mailboxId, { category: "urgent", createdAt: at(-10 * MINUTE) });
      }

      await run(trx);

      expect(await rows(trx, a.orgId, "urgent")).toHaveLength(2);
      expect(await rows(trx, b.orgId)).toEqual([]);
    });
  });

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

  test("the notice names a source folder; spam folder mail gets none (D23)", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await ensureSyncFolders(trx, o.ctx, o.mailboxId, [{ key: "junk", path: "Wiadomości-śmieci", role: "junk" }], T);
      const offers = await insertTriagedWithActions(trx, o.ctx, o.mailboxId, {
        category: "urgent",
        createdAt: at(-10 * MINUTE),
        folder: "Oferty",
        sourceFolder: "Oferty",
        uid: 21,
        actions: [],
      });
      const junk = await insertTriagedWithActions(trx, o.ctx, o.mailboxId, {
        category: "urgent",
        createdAt: at(-9 * MINUTE),
        folder: "Wiadomości-śmieci",
        sourceFolder: "Wiadomości-śmieci",
        uid: 22,
        actions: [],
      });

      await run(trx);
      const found = await rows(trx, o.orgId, "urgent");
      expect(found.map((r) => r.email_id)).toEqual([offers.emailId, offers.emailId]);
      for (const row of found) {
        expect(row.text?.split("\n")[0]).toContain("🔴 Urgent mail · 📁 Oferty");
        expect(row.text).toContain("→ stays in Oferty");
      }
      expect(found.some((r) => r.email_id === junk.emailId)).toBe(false);
      const audited = await trx.selectFrom("audit_log").select("id").where("email_id", "=", junk.emailId).execute();
      expect(audited).toHaveLength(0);
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

  test("a mailbox that became active again gets no late notice and no sync_ok until a fresh sync", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await markSynced(trx, o.ctx, o.mailboxId, at(-2 * HOUR));
      await setStatus(trx, o, "active", at(-MINUTE));

      await run(trx);
      expect(await rows(trx, o.orgId, "sync_stale")).toHaveLength(0);
    });

    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await markSynced(trx, o.ctx, o.mailboxId, at(-2 * HOUR));
      await run(trx);
      await trx
        .updateTable("outbox")
        .set({ status: "sent", sent_at: at(-10 * MINUTE) })
        .where("org_id", "=", o.orgId)
        .where("kind", "=", "sync_stale")
        .execute();
      expect(await rows(trx, o.orgId, "sync_stale")).toHaveLength(1);

      await setStatus(trx, o, "active", at(-MINUTE));
      await run(trx);
      expect(await rows(trx, o.orgId, "sync_ok")).toHaveLength(0);

      await markSynced(trx, o.ctx, o.mailboxId, T);
      await run(trx);
      expect(await rows(trx, o.orgId, "sync_ok")).toHaveLength(1);
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

  test("a view that does not render skips its event; the next organization still gets its rows", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await org(trx);
      const b = await org(trx);
      const skipped = await insertTriaged(trx, a.ctx, a.mailboxId, { category: "urgent", createdAt: at(-10 * MINUTE) });
      await insertTriaged(trx, b.ctx, b.mailboxId, { category: "urgent", createdAt: at(-10 * MINUTE) });
      await trx.updateTable("organizations").set({ timezone: "Mars/Base" }).where("id", "=", a.orgId).execute();

      await run(trx);
      expect(await rows(trx, b.orgId, "urgent")).toHaveLength(2);
      expect(await rows(trx, a.orgId)).toHaveLength(0);
      expect(errorLines.filter((line) => line.includes(`notice urgent ${skipped}: skipped:`))).toHaveLength(1);
      expect(errorLines.filter((line) => line.includes(b.orgId))).toHaveLength(0);
    });
  });

  test("an error of one organization is logged by id and the next organization still gets its rows", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await org(trx);
      const b = await org(trx);
      for (const o of [a, b]) {
        await insertTriaged(trx, o.ctx, o.mailboxId, { category: "urgent", createdAt: at(-10 * MINUTE) });
      }
      // An infinite resume time is not a Date: the run of this organization throws before any detector queues a row.
      await trx
        .updateTable("organizations")
        .set({ resumed_at: sql`'infinity'::timestamptz` })
        .where("id", "=", a.orgId)
        .execute();

      await run(trx);
      expect(await rows(trx, b.orgId, "urgent")).toHaveLength(2);
      expect(await rows(trx, a.orgId)).toHaveLength(0);
      expect(errorLines.filter((line) => line.includes(`notices for org ${a.orgId} failed`))).toHaveLength(1);
      expect(errorLines.filter((line) => line.includes(b.orgId))).toHaveLength(0);
    });
  });
});

describe("action_failed notices", () => {
  async function failedMove(
    trx: Transaction<DB>,
    o: Org,
    opts: { statusReason?: string; reverse?: boolean; updatedAt?: Date; subject?: string } = {}
  ): Promise<{ emailId: string; actionId: string }> {
    const emailId = await insertTriaged(trx, o.ctx, o.mailboxId, {
      category: "info",
      createdAt: at(-2 * HOUR),
      subject: opts.subject ?? "Marker subject",
      from: "Ann <ann@firma.test>",
    });
    const original = await insertAction(trx, o.ctx, emailId, {
      type: "move",
      status: opts.reverse === true ? "undone" : "failed",
      payload: { folder: "ai_info" },
    });
    let actionId = original;
    if (opts.reverse === true) {
      actionId = await insertAction(trx, o.ctx, emailId, {
        type: "move",
        status: "failed",
        payload: { folder: "ai_info" },
        reversesActionId: original,
        statusReason: opts.statusReason ?? "hard_error",
        attempts: 3,
      });
    } else {
      await trx
        .updateTable("actions")
        .set({ status_reason: opts.statusReason ?? "hard_error", attempts: 3 })
        .where("id", "=", original)
        .execute();
    }
    if (opts.updatedAt !== undefined) {
      await trx.updateTable("actions").set({ updated_at: opts.updatedAt }).where("id", "=", actionId).execute();
    }
    return { emailId, actionId };
  }

  async function notifiedAt(trx: Transaction<DB>, actionId: string): Promise<Date | null> {
    const row = await trx
      .selectFrom("actions")
      .select("notified_at")
      .where("id", "=", actionId)
      .executeTakeFirstOrThrow();
    return row.notified_at;
  }

  test("a hard-failed move gives the owner one row, marks the action, and a second run adds none", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      const { emailId, actionId } = await failedMove(trx, o, { updatedAt: at(-MINUTE) });

      await run(trx);
      const found = await rows(trx, o.orgId, "action_failed");
      expect(found).toHaveLength(1);
      expect(found[0]?.user_id).toBe(o.ownerId);
      expect(found[0]?.email_id).toBe(emailId);
      expect(found[0]?.dedup_key).toBe(`action_failed:${actionId}`);
      expect(found[0]?.text).toContain("Marker subject");
      expect(found[0]?.text).toContain("Could not move a mail to AI/Info");
      expect(await notifiedAt(trx, actionId)).toEqual(T);

      await run(trx);
      expect(await rows(trx, o.orgId, "action_failed")).toHaveLength(1);
    });
  });

  test("a hard-failed reverse create_draft gives the owner one row with the draft text", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      const emailId = await insertTriaged(trx, o.ctx, o.mailboxId, {
        category: "delegation",
        createdAt: at(-2 * HOUR),
        subject: "Marker subject",
        from: "Ann <ann@firma.test>",
      });
      const original = await insertAction(trx, o.ctx, emailId, {
        type: "create_draft",
        status: "applied",
        payload: { kind: "delegation" },
      });
      const reverse = await insertAction(trx, o.ctx, emailId, {
        type: "create_draft",
        status: "failed",
        payload: { kind: "delegation", folder: "Drafts", uid: 4, reason: "sent" },
        reversesActionId: original,
        statusReason: "hard_error",
        attempts: 3,
      });
      await trx
        .updateTable("actions")
        .set({ updated_at: at(-MINUTE) })
        .where("id", "=", reverse)
        .execute();

      await run(trx);

      const found = await rows(trx, o.orgId, "action_failed");
      expect(found).toHaveLength(1);
      expect(found[0]?.text).toContain("Could not remove the draft for a mail");
      expect(found[0]?.text).toContain("The draft stays in Drafts: delete it by hand.");
      expect(await notifiedAt(trx, reverse)).toEqual(T);
    });
  });

  test("an original mail_not_found gives no row and stays unmarked", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      const { actionId } = await failedMove(trx, o, { statusReason: "mail_not_found", updatedAt: at(-MINUTE) });
      await run(trx);
      expect(await rows(trx, o.orgId, "action_failed")).toHaveLength(0);
      expect(await notifiedAt(trx, actionId)).toBeNull();
    });
  });

  test("a reverse mail_not_found gives a not-found notice", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      const { actionId } = await failedMove(trx, o, {
        reverse: true,
        statusReason: "mail_not_found",
        updatedAt: at(-MINUTE),
      });
      await run(trx);
      const found = await rows(trx, o.orgId, "action_failed");
      expect(found).toHaveLength(1);
      expect(found[0]?.text).toContain("Undo failed: could not move a mail back to INBOX");
      expect(found[0]?.text).toContain("The mail was not found");
      expect(await notifiedAt(trx, actionId)).toEqual(T);
    });
  });

  test("a failed action older than 24 h is marked without a row", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      const { actionId } = await failedMove(trx, o, { updatedAt: at(-30 * HOUR) });
      await run(trx);
      expect(await rows(trx, o.orgId, "action_failed")).toHaveLength(0);
      expect(await notifiedAt(trx, actionId)).toEqual(T);
    });
  });

  test("a hard-failed reverse move gives the Undo text", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await failedMove(trx, o, { reverse: true, updatedAt: at(-MINUTE) });
      await run(trx);
      const found = await rows(trx, o.orgId, "action_failed");
      expect(found).toHaveLength(1);
      expect(found[0]?.text).toContain("Undo failed: could not move a mail back to INBOX");
      expect(found[0]?.text).toContain("Tried 3 times");
    });
  });

  test("a failed reverse move of a mail in another folder names that folder", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      const { emailId } = await failedMove(trx, o, { reverse: true, updatedAt: at(-MINUTE) });
      await trx
        .updateTable("emails")
        .set({ folder: "Oferty", source_folder: "Oferty" })
        .where("id", "=", emailId)
        .execute();
      await run(trx);
      const found = await rows(trx, o.orgId, "action_failed");
      expect(found).toHaveLength(1);
      expect(found[0]?.text).toContain("Undo failed: could not move a mail back to Oferty");
    });
  });

  test("no owner is linked, only an assistant: the action is marked, no row", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const created = await createOrgWithMailbox(trx);
      const ctx = { orgId: created.orgId };
      const assistantId = await addMember(trx, created.orgId);
      await linkChat(trx, ctx, assistantId, randomChatId(), at(-HOUR));
      await markSynced(trx, ctx, created.mailboxId, at(-5 * MINUTE));
      const o: Org = {
        ctx,
        orgId: created.orgId,
        ownerId: created.userId,
        assistantId,
        mailboxId: created.mailboxId,
      };
      const { actionId } = await failedMove(trx, o, { updatedAt: at(-MINUTE) });

      await run(trx);

      expect(await rows(trx, o.orgId, "action_failed")).toHaveLength(0);
      expect(await notifiedAt(trx, actionId)).toEqual(T);
    });
  });

  test("another organization's failed action gives nothing", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await org(trx);
      const b = await org(trx);
      const { actionId } = await failedMove(trx, b, { updatedAt: at(-MINUTE) });
      await run(trx);
      expect(await rows(trx, a.orgId, "action_failed")).toHaveLength(0);
      expect(await rows(trx, b.orgId, "action_failed")).toHaveLength(1);
      expect(await notifiedAt(trx, actionId)).toEqual(T);
    });
  });
});

// S4: approval requests, reminder sets, send results and answered notices (D19–D21, D24).
const APPLIED = { folder: "Drafts", uid: 7 };
const SENDER = "boss@client.test";
const BODY = "Please prepare the offer for the client.";

interface SendOrg extends Org {
  secondOwnerId: string;
}

// Two linked owners and one linked assistant.
async function sendOrg(trx: Transaction<DB>): Promise<SendOrg> {
  const o = await org(trx);
  const secondOwnerId = await addMember(trx, o.orgId, "owner");
  await linkChat(trx, o.ctx, secondOwnerId, randomChatId(), at(-HOUR));
  return { ...o, secondOwnerId };
}

type Pair = NonNullable<Parameters<typeof insertDraftAndSend>[3]>;

async function waiting(trx: Transaction<DB>, o: Org, opts: Pair = {}) {
  const to = opts.to ?? `anna-${randomUUID()}@x.test`;
  const delegateId =
    opts.kind === "clarification"
      ? undefined
      : (opts.delegateId ?? (await insertDelegate(trx, o.ctx, { name: "Anna Nowak", email: to })));
  const pair = await insertDraftAndSend(trx, o.ctx, o.mailboxId, {
    createdAt: at(-30 * MINUTE),
    draftProviderResult: APPLIED,
    subject: "Quarterly offer",
    from: SENDER,
    bodyText: BODY,
    delegateName: "Anna Nowak",
    task: "Prepare the offer",
    to,
    delegateId,
    ...opts,
  });
  return { ...pair, to, delegateId };
}

async function sendState(trx: Transaction<DB>, sendId: string) {
  return trx
    .selectFrom("actions")
    .select(["notified_at", "result_notified_at"])
    .where("id", "=", sendId)
    .executeTakeFirstOrThrow();
}

function buttonData(row: { buttons: unknown }): string[] {
  return (row.buttons as { data: string }[][]).flat().map((button) => button.data);
}

describe("approval requests", () => {
  test("(1)(2) one request per owner, the assistant gets none; a second run adds none", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const p = await waiting(trx, o);

      await run(trx);

      const found = await rows(trx, o.orgId, "approval");
      expect(found.map((r) => r.user_id).sort()).toEqual([o.ownerId, o.secondOwnerId].sort());
      for (const row of found) {
        expect(row.dedup_key).toBe(`approval:${p.sendId}`);
        expect(row.email_id).toBe(p.emailId);
        expect(row.text).toContain(`📤 Send? Delegation to Anna Nowak ${p.to}`);
        expect(row.text).toContain(`From: ${SENDER} · ⚠️ external sender`);
        expect(row.text).toContain("Subject: Fwd: Quarterly offer");
        expect(row.text).toContain("Draft:");
        expect(row.text).toContain("Prepare the offer");
        expect(row.text).toContain("Quoted original:");
        expect(row.text).toContain(BODY);
        expect(row.text).toContain("Do not send the draft from your mail client.");
        expect(buttonData(row)).toEqual([`ap:${p.sendId}`, `ar:${p.sendId}`]);
      }
      expect((await sendState(trx, p.sendId)).notified_at).toEqual(T);

      await run(trx);
      expect(await rows(trx, o.orgId, "approval")).toHaveLength(2);
    });
  });

  test("(3) the external warning: whitelisted, own mailbox and same domain", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      await insertSenderRule(trx, o.ctx, { mailboxId: null, pattern: "friend@client.test", kind: "whitelist" });
      const secondBoxId = randomUUID();
      const secondAddress = `box2-${secondBoxId}@x.test`;
      await insertMailbox(trx, o.ctx, {
        id: secondBoxId,
        address: secondAddress,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: { drafts: "Drafts" },
      });
      const friend = await waiting(trx, o, { from: "friend@client.test" });
      const internal = await waiting(trx, o, { from: secondAddress });
      const domain = await waiting(trx, o, { from: "someone@x.test" });

      await run(trx);

      const text = async (sendId: string) =>
        (await rows(trx, o.orgId, "approval")).find((r) => r.dedup_key === `approval:${sendId}`)?.text ?? "";
      expect(await text(friend.sendId)).not.toContain("external sender");
      expect(await text(internal.sendId)).not.toContain("external sender");
      expect(await text(domain.sendId)).toContain("⚠️ external sender");
    });
  });

  test("(4)(5) a draft that is not applied and a paused mailbox give no request and no mark", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const ready = await waiting(trx, o, { draftStatus: "ready", draftProviderResult: undefined });

      await run(trx);
      expect(await rows(trx, o.orgId, "approval")).toHaveLength(0);
      expect((await sendState(trx, ready.sendId)).notified_at).toBeNull();

      await trx
        .updateTable("actions")
        .set({ status: "applied", applied_at: T })
        .where("id", "=", ready.draftId)
        .execute();
      await setStatus(trx, o, "paused");
      await run(trx);
      expect(await rows(trx, o.orgId, "approval")).toHaveLength(0);
      expect((await sendState(trx, ready.sendId)).notified_at).toBeNull();
    });
  });

  test("(6)(6b) a clarification names the sender; an inactive delegate is marked", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const question = await waiting(trx, o, { kind: "clarification", to: SENDER, task: "Which date?" });
      const inactiveTo = "olek@x.test";
      const inactiveId = await insertDelegate(trx, o.ctx, { name: "Olek", email: inactiveTo, active: false });
      const inactive = await waiting(trx, o, { to: inactiveTo, delegateId: inactiveId, delegateName: "Olek" });

      await run(trx);

      const found = await rows(trx, o.orgId, "approval");
      const textOf = (sendId: string) => found.find((r) => r.dedup_key === `approval:${sendId}`)?.text ?? "";
      expect(textOf(question.sendId)).toContain(`Question to the sender ${SENDER}`);
      expect(textOf(inactive.sendId)).toContain(`Delegation to Olek (inactive) ${inactiveTo}`);
    });
  });

  test("(7)(13) a reminder set: one request per owner with a task line per item", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const setId = randomUUID();
      const items: { to: string; sendId: string }[] = [];
      for (const [i, name] of ["Anna Nowak", "Piotr Kot"].entries()) {
        const to = `r${i}-${randomUUID()}@x.test`;
        const delegateId = await insertDelegate(trx, o.ctx, { name, email: to });
        const original = await waiting(trx, o, {
          to,
          delegateId,
          delegateName: name,
          sendStatus: "applied",
          approved: { userId: o.ownerId, at: at(-3 * HOUR) },
        });
        const delegationId = await insertDelegation(trx, o.ctx, {
          mailboxId: o.mailboxId,
          emailId: original.emailId,
          delegateId,
          draftActionId: original.draftId,
          sendActionId: original.sendId,
          status: "sent",
          dueAt: new Date("2026-11-10T12:00:00Z"),
        });
        const reminder = await waiting(trx, o, {
          to,
          delegateId,
          delegateName: name,
          reminder: i === 0 ? 1 : 2,
          delegationId,
          setId,
          task: `Task of ${name}`,
        });
        items.push({ to, sendId: reminder.sendId });
      }

      await run(trx);

      const found = await rows(trx, o.orgId, "approval_set");
      expect(found.map((r) => r.user_id).sort()).toEqual([o.ownerId, o.secondOwnerId].sort());
      for (const row of found) {
        expect(row.dedup_key).toBe(`approval_set:${setId}`);
        expect(row.text).toContain("📤 Send 2 reminders?");
        expect(row.text).toContain(`Anna Nowak ${items[0]?.to} — Quarterly offer`);
        expect(row.text).toContain("reminder 1 of 2");
        expect(row.text).toContain("reminder 2 of 2");
        expect(row.text).toContain("Task: Task of Anna Nowak");
        expect(row.text).toContain("Task: Task of Piotr Kot");
        expect(buttonData(row)).toEqual([`as:${setId}`, `rs:${setId}`]);
      }
      for (const item of items) expect((await sendState(trx, item.sendId)).notified_at).toEqual(T);
      expect(await rows(trx, o.orgId, "approval")).toHaveLength(0);

      await run(trx);
      expect(await rows(trx, o.orgId, "approval_set")).toHaveLength(2);
    });
  });

  test("(7b) a set with one draft not applied waits whole", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const setId = randomUUID();
      const a = await waiting(trx, o, { reminder: 1, setId });
      const b = await waiting(trx, o, { reminder: 2, setId, draftStatus: "ready", draftProviderResult: undefined });

      await run(trx);

      expect(await rows(trx, o.orgId, "approval_set")).toHaveLength(0);
      expect((await sendState(trx, a.sendId)).notified_at).toBeNull();
      expect((await sendState(trx, b.sendId)).notified_at).toBeNull();
    });
  });

  test("(8) synthetic mail is marked as a test", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      await waiting(trx, o, { messageId: `<seed-${randomUUID()}@ea-seed.test>` });
      await run(trx);
      const found = await rows(trx, o.orgId, "approval");
      expect(found).toHaveLength(2);
      for (const row of found) expect(row.text).toContain("🧪 test");
    });
  });

  test("(9) the outbox row holds the mail id", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const p = await waiting(trx, o);
      await run(trx);
      for (const row of await rows(trx, o.orgId, "approval")) expect(row.email_id).toBe(p.emailId);
    });
  });

  test("(10) only an assistant linked: no request, no mark", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await trx.deleteFrom("chat_links").where("user_id", "=", o.ownerId).execute();
      const p = await waiting(trx, o);
      await run(trx);
      expect(await rows(trx, o.orgId, "approval")).toHaveLength(0);
      expect((await sendState(trx, p.sendId)).notified_at).toBeNull();
    });
  });

  test("(11) tenant: another organization's send is not listed", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await org(trx);
      const b = await org(trx);
      const p = await waiting(trx, b);
      await run(trx);
      expect(await rows(trx, a.orgId, "approval")).toHaveLength(0);
      const found = await rows(trx, b.orgId, "approval");
      expect(found).toHaveLength(1);
      expect(found[0]?.dedup_key).toBe(`approval:${p.sendId}`);
      expect((await sendState(trx, p.sendId)).notified_at).toEqual(T);
    });
  });

  test("(12) a broken row is skipped with one warn line; the others still go out", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const broken = await waiting(trx, o, { createdAt: at(-40 * MINUTE) });
      const good = await waiting(trx, o);
      await sql`update actions set payload = jsonb_set(payload, '{kind}', '"nope"') where id = ${broken.draftId}`.execute(
        trx
      );
      const urgentId = await insertTriaged(trx, o.ctx, o.mailboxId, {
        category: "urgent",
        createdAt: at(-10 * MINUTE),
      });

      await run(trx);
      await run(trx);

      expect((await rows(trx, o.orgId, "approval")).map((r) => r.dedup_key)).toEqual([
        `approval:${good.sendId}`,
        `approval:${good.sendId}`,
      ]);
      expect((await rows(trx, o.orgId, "urgent")).filter((r) => r.email_id === urgentId)).toHaveLength(3);
      expect((await sendState(trx, broken.sendId)).notified_at).toBeNull();
      const warns = errorLines.filter((line) => line.includes(`notice approval ${broken.sendId}: skipped:`));
      expect(warns).toHaveLength(1);
    });
  });
});

async function finishSend(
  trx: Transaction<DB>,
  sendId: string,
  patch: {
    status: string;
    reason?: string;
    providerResult?: Record<string, unknown>;
    attempts?: number;
    appliedAt?: Date;
  }
): Promise<void> {
  await trx
    .updateTable("actions")
    .set({
      status: patch.status,
      status_reason: patch.reason ?? null,
      provider_result: patch.providerResult === undefined ? null : JSON.stringify(patch.providerResult),
      attempts: patch.attempts ?? 0,
      applied_at: patch.appliedAt ?? null,
      approved_at: ["applied", "approved"].includes(patch.status) ? at(-HOUR) : null,
      notified_at: at(-HOUR),
      updated_at: at(-5 * MINUTE),
    })
    .where("id", "=", sendId)
    .execute();
}

async function ended(trx: Transaction<DB>, o: Org, patch: Parameters<typeof finishSend>[2], opts: Pair = {}) {
  const p = await waiting(trx, o, opts);
  await finishSend(trx, p.sendId, patch);
  return p;
}

async function resultText(trx: Transaction<DB>, o: Org, sendId: string): Promise<{ text: string; data: string[] }> {
  const found = (await rows(trx, o.orgId, "send_result")).filter((r) => r.dedup_key === `send_result:${sendId}`);
  expect(found.length).toBeGreaterThan(0);
  return { text: found[0]?.text ?? "", data: found[0] === undefined ? [] : buttonData(found[0]) };
}

describe("send result notices", () => {
  test("(1)(6) sent: one row per owner; the copy outcome; a second run adds none", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const ok = await ended(trx, o, {
        status: "applied",
        appliedAt: at(-20 * MINUTE),
        providerResult: { sent_copy: "appended" },
      });
      const noCopy = await ended(trx, o, {
        status: "applied",
        appliedAt: at(-20 * MINUTE),
        providerResult: { sent_copy: "failed" },
      });

      await run(trx);

      const found = (await rows(trx, o.orgId, "send_result")).filter((r) => r.dedup_key === `send_result:${ok.sendId}`);
      expect(found.map((r) => r.user_id).sort()).toEqual([o.ownerId, o.secondOwnerId].sort());
      for (const row of found) {
        expect(row.email_id).toBe(ok.emailId);
        expect(row.text).toContain(`✅ Sent to Anna Nowak ${ok.to} · Fwd: Quarterly offer`);
        expect(row.text).not.toContain("No copy in Sent");
      }
      expect((await resultText(trx, o, noCopy.sendId)).text).toContain("No copy in Sent");
      expect((await sendState(trx, ok.sendId)).result_notified_at).toEqual(T);

      await run(trx);
      expect(await rows(trx, o.orgId, "send_result")).toHaveLength(4);
    });
  });

  test("(1b) a pending copy waits 10 minutes, then counts as failed", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const young = await ended(trx, o, {
        status: "applied",
        appliedAt: at(-MINUTE),
        providerResult: { sent_copy: "pending" },
      });
      const old = await ended(trx, o, {
        status: "applied",
        appliedAt: new Date(T.getTime() - SENT_COPY_PENDING_MAX_AGE_MS - MINUTE),
        providerResult: { sent_copy: "pending" },
      });

      await run(trx);

      const keys = (await rows(trx, o.orgId, "send_result")).map((r) => r.dedup_key);
      expect(keys).not.toContain(`send_result:${young.sendId}`);
      expect((await sendState(trx, young.sendId)).result_notified_at).toBeNull();
      expect((await resultText(trx, o, old.sendId)).text).toContain("No copy in Sent");
    });
  });

  test("(1c) the draft line follows the reverse row", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const applied = { status: "applied", appliedAt: at(-20 * MINUTE), providerResult: { sent_copy: "appended" } };
      const removed = await ended(trx, o, applied);
      await insertAction(trx, o.ctx, removed.emailId, {
        type: "create_draft",
        status: "ready",
        reversesActionId: removed.draftId,
        payload: { kind: "delegation", folder: "Drafts", uid: 7, reason: "sent" },
      });
      const stays = await ended(trx, o, applied);

      await run(trx);

      expect((await resultText(trx, o, removed.sendId)).text).not.toContain("no UIDPLUS");
      expect((await resultText(trx, o, stays.sendId)).text).toContain("The draft stays in Drafts (no UIDPLUS");
    });
  });

  test("(2) refused by the server: the cancel line only for a delegation", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const patch = {
        status: "failed",
        reason: "smtp_rejected",
        providerResult: { stage: "envelope", response_code: 550 },
      };
      const delegation = await ended(trx, o, patch);
      const question = await ended(trx, o, patch, { kind: "clarification", to: SENDER });

      await run(trx);

      const d = await resultText(trx, o, delegation.sendId);
      expect(d.text).toContain(`❌ Not sent to Anna Nowak ${delegation.to} · Fwd: Quarterly offer`);
      expect(d.text).toContain("refused it (envelope, code 550)");
      expect(d.text).toContain("The delegation was cancelled.");
      expect(d.data).toEqual([]);
      const q = await resultText(trx, o, question.sendId);
      expect(q.text).toContain("refused it (envelope, code 550)");
      expect(q.text).not.toContain("The delegation was cancelled.");
      expect(q.data).toEqual([]);
    });
  });

  test("(3)(3b) outcome unknown: the warning and the send again button; no action_failed notice", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const first = await ended(trx, o, { status: "failed", reason: "outcome_unknown" });
      await trx.updateTable("actions").set({ result_notified_at: T }).where("id", "=", first.sendId).execute();
      const again = await insertAction(trx, o.ctx, first.emailId, {
        type: "send",
        status: "failed",
        statusReason: "outcome_unknown",
        payload: { kind: "delegation", to: [first.to] },
        dependsOnActionId: first.draftId,
        idempotencyKey: `${first.sendId}:again`,
        createdAt: at(-20 * MINUTE),
      });

      await run(trx);

      const found = await rows(trx, o.orgId, "send_result");
      expect(found.filter((r) => r.dedup_key === `send_result:${again}`)).toHaveLength(2);
      const result = await resultText(trx, o, again);
      expect(result.text).toContain("⚠️ Unknown whether the mail to");
      expect(result.data).toEqual([`ag:${again}`, `gw:${again}`]);
      expect(await rows(trx, o.orgId, "action_failed")).toHaveLength(0);
    });
  });

  test("(3c) smtp errors by stage, and a bad payload", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const content = await ended(trx, o, {
        status: "failed",
        reason: "smtp_error",
        attempts: 1,
        providerResult: { stage: "content", response_code: 451 },
      });
      const compose = await ended(trx, o, {
        status: "failed",
        reason: "smtp_error",
        attempts: 3,
        providerResult: { stage: "compose" },
      });
      const tries = await ended(trx, o, {
        status: "failed",
        reason: "smtp_error",
        attempts: 5,
        providerResult: { stage: "connect", code: "ETIMEDOUT" },
      });
      const capped = await ended(trx, o, {
        status: "failed",
        reason: "smtp_error",
        attempts: 0,
        providerResult: { stage: "envelope", response_code: 450, code: "EENVELOPE", cap: "soft_retry" },
      });
      const bad = await ended(trx, o, { status: "failed", reason: "bad_payload", attempts: 1 });

      await run(trx);

      const c = await resultText(trx, o, content.sendId);
      expect(c.text).toContain("refused the content for now (code 451)");
      expect(c.data).toEqual([`ag:${content.sendId}`]);
      const m = await resultText(trx, o, compose.sendId);
      expect(m.text).toContain("The mail could not be built 3 times");
      expect(m.data).toEqual([`ag:${compose.sendId}`]);
      const t = await resultText(trx, o, tries.sendId);
      expect(t.text).toContain("The send failed 5 times (ETIMEDOUT)");
      expect(t.data).toEqual([`ag:${tries.sendId}`]);
      const cap = await resultText(trx, o, capped.sendId);
      expect(cap.text).toContain("The mail server did not accept the mail for 6 hours (450); nothing was sent");
      expect(cap.data).toEqual([`ag:${capped.sendId}`]);
      const b = await resultText(trx, o, bad.sendId);
      expect(b.text).toContain("The stored send data is not valid; nothing was sent");
      expect(b.data).toEqual([]);
    });
  });

  test("(4) expired: the reason lines and the draft line", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const timeout = await ended(trx, o, { status: "expired", reason: "timeout" });
      await insertAction(trx, o.ctx, timeout.emailId, {
        type: "create_draft",
        status: "ready",
        reversesActionId: timeout.draftId,
        payload: { kind: "delegation", folder: "Drafts", uid: 7, reason: "expired" },
      });
      const held = await ended(trx, o, { status: "expired", reason: "held_timeout" });
      const closed = await ended(trx, o, { status: "expired", reason: "delegation_closed" });

      await run(trx);

      const t = (await resultText(trx, o, timeout.sendId)).text;
      expect(t).toContain("⌛ Not sent: the approval expired (48 h) · Fwd: Quarterly offer");
      expect(t).toContain("The draft was removed.");
      const h = (await resultText(trx, o, held.sendId)).text;
      expect(h).toContain("it waited 48 h after your approval and was not sent");
      expect(h).toContain("The draft stays in Drafts.");
      expect((await resultText(trx, o, closed.sendId)).text).toContain("the delegation was closed");
    });
  });

  test("(5) rejected: the name of the rejecting owner", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      await trx.updateTable("users").set({ display_name: "Marta Lis" }).where("id", "=", o.secondOwnerId).execute();
      const p = await ended(trx, o, { status: "rejected" });
      await recordAudit(trx, o.ctx, {
        emailId: p.emailId,
        actionId: p.sendId,
        actor: o.secondOwnerId,
        event: auditEvents.actionRejected,
        data: { via: "telegram" },
      });

      await run(trx);

      expect((await resultText(trx, o, p.sendId)).text).toContain("✖️ Rejected by Marta Lis · Fwd: Quarterly offer");
    });
  });

  test("(8)(9) tenant isolation; no sender address and no body text in a result", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await sendOrg(trx);
      const b = await org(trx);
      const p = await ended(trx, b, { status: "expired", reason: "timeout" });
      const mine = await ended(trx, a, {
        status: "failed",
        reason: "smtp_rejected",
        providerResult: { stage: "envelope", response_code: 550 },
      });

      await run(trx);

      expect(await rows(trx, a.orgId, "send_result")).toHaveLength(2);
      expect((await rows(trx, b.orgId, "send_result")).map((r) => r.dedup_key)).toEqual([`send_result:${p.sendId}`]);
      for (const row of [...(await rows(trx, a.orgId, "send_result")), ...(await rows(trx, b.orgId, "send_result"))]) {
        expect(row.text).not.toContain(SENDER);
        expect(row.text).not.toContain(BODY);
        expect(JSON.stringify(row.view)).not.toContain(SENDER);
        expect(JSON.stringify(row.view)).not.toContain(BODY);
      }
      expect((await resultText(trx, a, mine.sendId)).text).toContain(mine.to);
    });
  });
});

describe("send_held notices", () => {
  const NOW = new Date("2026-11-20T10:00:00Z");
  const LIMIT_ERROR = "send_limit:mailbox_hour";

  async function runAt(trx: Transaction<DB>, now: Date): Promise<void> {
    await detectNotices({ db: trx, now: () => now, startedAt: new Date(now.getTime() - HOUR) });
  }

  // An approved send that waits on a limit (or on `lastError`) until `nextAttemptAt`.
  async function held(trx: Transaction<DB>, o: Org, nextAttemptAt: Date, lastError: string | null = LIMIT_ERROR) {
    const p = await waiting(trx, o, {
      sendStatus: "approved",
      approved: { userId: o.ownerId, at: at(-20 * MINUTE) },
      outgoingMessageId: `<${randomUUID()}@x.test>`,
    });
    await trx
      .updateTable("actions")
      .set({ status: "approved", last_error: lastError, next_attempt_at: nextAttemptAt })
      .where("id", "=", p.sendId)
      .execute();
    return p;
  }

  test("(3)(4) one row for the owner per mailbox and UTC day; the next day gives a second row", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await held(trx, o, new Date(NOW.getTime() + 10 * MINUTE));
      await held(trx, o, new Date(NOW.getTime() + 20 * MINUTE));

      await runAt(trx, NOW);
      const first = await rows(trx, o.orgId, "send_held");
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({
        user_id: o.ownerId,
        mailbox_id: o.mailboxId,
        dedup_key: `send_held:${o.mailboxId}:2026-11-20`,
        status: "pending",
      });
      expect(first[0]?.view).toMatchObject({ mailboxId: o.mailboxId, limit: "mailbox_hour", waiting: 2 });
      expect(new Date((first[0]?.view as { nextAt: string }).nextAt)).toEqual(new Date(NOW.getTime() + 10 * MINUTE));
      expect(first[0]?.text).toContain("2 waiting; the next one goes out at about");

      await runAt(trx, NOW);
      expect(await rows(trx, o.orgId, "send_held")).toHaveLength(1);

      await trx
        .updateTable("actions")
        .set({ next_attempt_at: new Date("2026-11-21T01:00:00Z") })
        .where("last_error", "=", LIMIT_ERROR)
        .where("org_id", "=", o.orgId)
        .execute();
      await runAt(trx, new Date("2026-11-21T00:30:00Z"));
      const keys = (await rows(trx, o.orgId, "send_held")).map((row) => row.dedup_key);
      expect(keys).toEqual([`send_held:${o.mailboxId}:2026-11-20`, `send_held:${o.mailboxId}:2026-11-21`]);
    });
  });

  test("(5) an ended hold and another last_error give no row", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await held(trx, o, new Date(NOW.getTime() - MINUTE));
      await held(trx, o, new Date(NOW.getTime() + 10 * MINUTE), "smtp_421");

      await runAt(trx, NOW);
      expect(await rows(trx, o.orgId, "send_held")).toEqual([]);
    });
  });

  test("(6) the holds of one organization are not listed for another", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await org(trx);
      const b = await org(trx);
      await held(trx, a, new Date(NOW.getTime() + 10 * MINUTE));

      expect(await listSendLimitHolds(trx, b.ctx, NOW)).toEqual([]);
      expect(await listSendLimitHolds(trx, a.ctx, NOW)).toEqual([
        { mailboxId: a.mailboxId, waiting: 1, nextAt: new Date(NOW.getTime() + 10 * MINUTE), lastError: LIMIT_ERROR },
      ]);
    });
  });

  test("the limit text comes from the send that goes out first", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await held(trx, o, new Date(NOW.getTime() + 30 * MINUTE), "send_limit:mailbox_day");
      await held(trx, o, new Date(NOW.getTime() + 10 * MINUTE), "send_limit:recipient_day");

      expect(await listSendLimitHolds(trx, o.ctx, NOW)).toMatchObject([
        { waiting: 2, nextAt: new Date(NOW.getTime() + 10 * MINUTE), lastError: "send_limit:recipient_day" },
      ]);
    });
  });

  test("(8) a pending row becomes outdated when the holds end; a paused mailbox gets no row", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      const p = await held(trx, o, new Date(NOW.getTime() + 10 * MINUTE));
      await runAt(trx, NOW);
      expect((await rows(trx, o.orgId, "send_held")).map((row) => row.status)).toEqual(["pending"]);

      await trx
        .updateTable("actions")
        .set({ next_attempt_at: new Date(NOW.getTime() - MINUTE) })
        .where("id", "=", p.sendId)
        .execute();
      await runAt(trx, NOW);
      expect(await rows(trx, o.orgId, "send_held")).toMatchObject([{ status: "failed", error_code: "outdated" }]);

      const paused = await org(trx);
      await held(trx, paused, new Date(NOW.getTime() + 10 * MINUTE));
      await setStatus(trx, paused, "paused");
      await runAt(trx, NOW);
      expect(await rows(trx, paused.orgId, "send_held")).toEqual([]);
    });
  });
});

describe("delegation answered notices", () => {
  async function answered(trx: Transaction<DB>, o: Org, opts: { withAnswerMail: boolean }) {
    const p = await waiting(trx, o, { sendStatus: "applied", approved: { userId: o.ownerId, at: at(-3 * HOUR) } });
    await trx.updateTable("actions").set({ result_notified_at: T }).where("id", "=", p.sendId).execute();
    const delegationId = await insertDelegation(trx, o.ctx, {
      mailboxId: o.mailboxId,
      emailId: p.emailId,
      delegateId: p.delegateId as string,
      draftActionId: p.draftId,
      sendActionId: p.sendId,
      status: "answered",
      answeredAt: at(-5 * MINUTE),
    });
    if (opts.withAnswerMail) {
      const answerId = await insertTestEmail(trx, o.ctx, o.mailboxId, { received_at: at(-10 * MINUTE) });
      await trx
        .updateTable("delegations")
        .set({ answered_email_id: answerId })
        .where("id", "=", delegationId)
        .execute();
    }
    return { ...p, delegationId };
  }

  test("(7) every member gets one notice; the time is the answer mail's; a second run adds none", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const d = await answered(trx, o, { withAnswerMail: true });

      await run(trx);

      const found = await rows(trx, o.orgId, "delegation_answered");
      expect(found.map((r) => r.user_id).sort()).toEqual([o.ownerId, o.secondOwnerId, o.assistantId].sort());
      for (const row of found) {
        expect(row.dedup_key).toBe(`delegation_answered:${d.delegationId}`);
        expect(row.email_id).toBe(d.emailId);
        expect(row.text).toContain("📩 Anna Nowak answered · Quarterly offer");
        expect(row.text).toContain("Received 10:50.");
        expect(buttonData(row)).toEqual([`dd:${d.delegationId}`]);
      }
      const marked = await trx
        .selectFrom("delegations")
        .select("answered_notified_at")
        .where("id", "=", d.delegationId)
        .executeTakeFirstOrThrow();
      expect(marked.answered_notified_at).toEqual(T);

      await run(trx);
      expect(await rows(trx, o.orgId, "delegation_answered")).toHaveLength(3);
    });
  });

  test("(7b) no answer mail left: still one row per member, with the answer time", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      await answered(trx, o, { withAnswerMail: false });
      await run(trx);
      const found = await rows(trx, o.orgId, "delegation_answered");
      expect(found).toHaveLength(3);
      expect(found[0]?.text).toContain("Received 10:55.");
    });
  });

  test("(8) tenant: another organization's delegation gives nothing", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await org(trx);
      const b = await org(trx);
      await answered(trx, b, { withAnswerMail: false });
      await run(trx);
      expect(await rows(trx, a.orgId, "delegation_answered")).toHaveLength(0);
      expect(await rows(trx, b.orgId, "delegation_answered")).toHaveLength(2);
    });
  });
});

describe("urgent notice with a delegate", () => {
  test("the would-do line names the delegate", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      const p = await waiting(trx, o, { sendStatus: "logged" });
      await trx.updateTable("triage_results").set({ category: "urgent" }).where("email_id", "=", p.emailId).execute();

      await run(trx);

      const found = await rows(trx, o.orgId, "urgent");
      expect(found.length).toBeGreaterThan(0);
      expect(found[0]?.text).toContain("draft a delegation to Anna Nowak");
    });
  });
});

describe("after a resume (D4)", () => {
  const resumedAt = new Date("2026-11-12T08:00:00Z");
  const DAY = 24 * HOUR;

  function later(offsetMs: number): Date {
    return new Date(resumedAt.getTime() + offsetMs);
  }

  // An organization resumed at `resumedAt`; members linked and the mailbox known 10 days before it.
  async function resumedOrg(trx: Transaction<DB>, lastSyncedAt: Date): Promise<Org> {
    const o = await org(trx);
    await resumeOrg(trx, o.orgId, resumedAt);
    await trx
      .updateTable("chat_links")
      .set({ linked_at: later(-10 * DAY) })
      .where("org_id", "=", o.orgId)
      .execute();
    await trx
      .updateTable("mailboxes")
      .set({
        status: "active",
        status_changed_at: later(-10 * DAY),
        created_at: later(-10 * DAY),
        last_synced_at: lastSyncedAt,
      })
      .where("id", "=", o.mailboxId)
      .execute();
    return o;
  }

  async function runAt(trx: Transaction<DB>, now: Date): Promise<void> {
    await detectNotices({ db: trx, now: () => now, startedAt: new Date(now.getTime() - HOUR) });
  }

  test("no sync-late row in the first 30 minutes after the resume; one after, unless the sync is fresh", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const stale = await resumedOrg(trx, later(-3 * DAY));
      const fresh = await resumedOrg(trx, later(2 * MINUTE));

      await runAt(trx, later(5 * MINUTE));
      expect(await rows(trx, stale.orgId, "sync_stale")).toHaveLength(0);

      await runAt(trx, later(31 * MINUTE));
      expect(await rows(trx, stale.orgId, "sync_stale")).toHaveLength(1);
      expect(await rows(trx, fresh.orgId, "sync_stale")).toHaveLength(0);
    });
  });

  test("urgent mail of before the resume gets no notice; mail after it does", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await resumedOrg(trx, later(2 * MINUTE));
      const before = await insertTriaged(trx, o.ctx, o.mailboxId, { category: "urgent", createdAt: later(-2 * HOUR) });
      const after = await insertTriaged(trx, o.ctx, o.mailboxId, { category: "urgent", createdAt: later(MINUTE) });

      await runAt(trx, later(3 * MINUTE));

      const found = await rows(trx, o.orgId, "urgent");
      expect(found.length).toBeGreaterThan(0);
      expect(found.every((row) => row.email_id === after)).toBe(true);
      expect(found.some((row) => row.email_id === before)).toBe(false);
    });
  });
});

describe("stored views and locales", () => {
  async function setLocale(trx: Transaction<DB>, userId: string, locale: string | null) {
    await trx.updateTable("users").set({ locale }).where("id", "=", userId).execute();
  }

  test("every kind stores a view and the locale of its member", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      for (const userId of [o.ownerId, o.secondOwnerId, o.assistantId]) await setLocale(trx, userId, "en");
      await insertTriaged(trx, o.ctx, o.mailboxId, { category: "urgent", createdAt: at(-10 * MINUTE) });
      const failedMail = await insertTriaged(trx, o.ctx, o.mailboxId, { category: "info", createdAt: at(-2 * HOUR) });
      const failed = await insertAction(trx, o.ctx, failedMail, {
        type: "move",
        status: "failed",
        payload: { folder: "ai_info" },
      });
      await trx
        .updateTable("actions")
        .set({ status_reason: "hard_error", attempts: 3, updated_at: at(-MINUTE) })
        .where("id", "=", failed)
        .execute();
      await waiting(trx, o);
      await ended(trx, o, {
        status: "applied",
        appliedAt: at(-20 * MINUTE),
        providerResult: { sent_copy: "appended" },
      });
      await setStatus(trx, o, "auth_error", at(-HOUR));
      await run(trx);
      await setStatus(trx, o, "active", at(-HOUR));
      await markSynced(trx, o.ctx, o.mailboxId, at(-40 * MINUTE));
      await run(trx);

      const found = await rows(trx, o.orgId);
      const kinds = new Set(found.map((row) => row.kind));
      for (const kind of ["urgent", "action_failed", "auth_error", "sync_stale", "approval", "send_result"]) {
        expect(kinds.has(kind)).toBe(true);
      }
      for (const row of found) {
        expect(Object.keys(row.view as object).length).toBeGreaterThan(0);
        expect(row.locale).toBe("en");
      }
    });
  });

  test("a member without a locale gets Polish rows with the same English text", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await setLocale(trx, o.ownerId, "en");
      await setLocale(trx, o.assistantId, null);
      await insertTriaged(trx, o.ctx, o.mailboxId, { category: "urgent", createdAt: at(-10 * MINUTE) });

      await run(trx);

      const found = await rows(trx, o.orgId, "urgent");
      const english = found.find((row) => row.user_id === o.ownerId);
      const polish = found.find((row) => row.user_id === o.assistantId);
      expect(english?.locale).toBe("en");
      expect(polish?.locale).toBe("pl");
      expect(polish?.text).toBe(english?.text);
    });
  });

  test("the urgent view holds the AI reason and plain actions, not a rendered text", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      const p = await waiting(trx, o, { sendStatus: "logged" });
      await trx.updateTable("triage_results").set({ category: "urgent" }).where("email_id", "=", p.emailId).execute();

      await run(trx);

      const view = (await rows(trx, o.orgId, "urgent"))[0]?.view as Record<string, unknown>;
      for (const key of ["ai", "actions", "delegateNames", "stayFolder"]) expect(view).toHaveProperty(key);
      expect(view).not.toHaveProperty("wouldDo");
      expect(view).not.toHaveProperty("aiText");
      const actions = view.actions as Record<string, unknown>[];
      expect(actions.length).toBeGreaterThan(0);
      for (const action of actions) {
        expect(Object.keys(action).sort()).toEqual(["delegateId", "folder", "kind", "reverse", "status", "type"]);
      }
    });
  });
});
