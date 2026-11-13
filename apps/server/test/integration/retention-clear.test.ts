import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { clearActionErrors, clearActionPayloads } from "../../src/modules/actions";
import { deleteOldLinkTokens, clearOutboxTexts } from "../../src/modules/channels";
import { clearDelegationTasks, isOpenDelegationDraft } from "../../src/modules/delegation";
import { clearMailBodies, clearMailHeaders } from "../../src/modules/mail";
import { clearTriageTexts } from "../../src/modules/triage";
import type { DB, TenantContext } from "../../src/platform/db";

import {
  createOrgWithMailbox,
  insertAction,
  insertDelegate,
  insertDelegation,
  insertDraftAndSend,
  insertTestEmail,
  insertTriaged,
  suspendOrg,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const now = new Date("2026-11-12T03:00:00Z");
const DAY_MS = 24 * 3_600_000;
const ago = (ms: number): Date => new Date(now.getTime() - ms);
const before30 = ago(30 * DAY_MS);
const before90 = ago(90 * DAY_MS);
const pendingBefore = ago(7 * DAY_MS);
const over30 = ago(30 * DAY_MS + 1000);
const over90 = ago(90 * DAY_MS + 1000);

interface Org {
  ctx: TenantContext;
  mailboxId: string;
}

async function newOrg(trx: Transaction<DB>): Promise<Org> {
  const { orgId, mailboxId } = await createOrgWithMailbox(trx);
  return { ctx: { orgId }, mailboxId };
}

function bodyRow(status: string, createdAt: Date) {
  return { status, created_at: createdAt, body_text: "Body text" };
}

async function bodies(trx: Transaction<DB>, ids: string[]): Promise<(string | null)[]> {
  const rows = await trx.selectFrom("emails").select(["id", "body_text"]).where("id", "in", ids).execute();
  const byId = new Map(rows.map((row) => [row.id, row.body_text]));
  return ids.map((id) => byId.get(id) ?? null);
}

// The same rows in org A (the subject) and org B (must never change).
async function seedBodies(trx: Transaction<DB>, org: Org) {
  return {
    doneOver: await insertTestEmail(trx, org.ctx, org.mailboxId, bodyRow("done", over30)),
    doneAt: await insertTestEmail(trx, org.ctx, org.mailboxId, bodyRow("done", before30)),
    processingOver: await insertTestEmail(trx, org.ctx, org.mailboxId, bodyRow("processing", over30)),
    pendingOver: await insertTestEmail(trx, org.ctx, org.mailboxId, bodyRow("pending", over30)),
    pendingNew: await insertTestEmail(trx, org.ctx, org.mailboxId, bodyRow("pending", ago(3 * DAY_MS))),
  };
}

describe("clearMailBodies", () => {
  test("clears done and old pending mail, keeps processing, at-limit and newer pending mail; org B is untouched", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      const rowsA = await seedBodies(trx, a);
      const rowsB = await seedBodies(trx, b);

      expect(await clearMailBodies(trx, a.ctx, { before: before30, pendingBefore })).toBe(2);

      expect(await bodies(trx, Object.values(rowsA))).toEqual([null, "Body text", "Body text", null, "Body text"]);
      expect(await bodies(trx, Object.values(rowsB))).toEqual(Array(5).fill("Body text"));
      expect(await clearMailBodies(trx, a.ctx, { before: before30, pendingBefore })).toBe(0);

      // A pending mail newer than `pendingBefore` stays even when `before` has passed it.
      expect(await clearMailBodies(trx, a.ctx, { before: ago(1 * DAY_MS), pendingBefore })).toBe(1);
      expect(await bodies(trx, [rowsA.doneAt, rowsA.pendingNew, rowsA.processingOver])).toEqual([
        null,
        "Body text",
        "Body text",
      ]);
    });
  });

  test("clears a stuck processing mail whose lock is older than both periods; keeps a younger lock and a lock without time", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      async function seed(org: Org) {
        const add = (lockedAt: Date | null) =>
          insertTestEmail(trx, org.ctx, org.mailboxId, { ...bodyRow("processing", over30), locked_at: lockedAt });
        return {
          stuck: await add(over30),
          youngerThanBefore: await add(ago(29 * DAY_MS)),
          youngerThanPending: await add(ago(3 * DAY_MS)),
          noLock: await add(null),
        };
      }
      const rowsA = await seed(a);
      const rowsB = await seed(b);

      expect(await clearMailBodies(trx, a.ctx, { before: before30, pendingBefore })).toBe(1);
      expect(await bodies(trx, Object.values(rowsA))).toEqual([null, "Body text", "Body text", "Body text"]);
      expect(await bodies(trx, Object.values(rowsB))).toEqual(Array(4).fill("Body text"));
      // A short retention does not shorten the wait of a lock younger than the pending period: only the 29-day lock goes.
      expect(await clearMailBodies(trx, a.ctx, { before: ago(DAY_MS), pendingBefore })).toBe(1);
      expect(await bodies(trx, [rowsA.youngerThanPending, rowsA.noLock])).toEqual(["Body text", "Body text"]);
      expect(await clearMailBodies(trx, a.ctx, { before: before30, pendingBefore })).toBe(0);
    });
  });

  test("has no filter on the mailbox status or the plan: paused mailbox and suspended organization", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const c = await newOrg(trx);
      await trx.updateTable("mailboxes").set({ status: "paused" }).where("id", "=", a.mailboxId).execute();
      await suspendOrg(trx, c.ctx.orgId);
      const inPaused = await insertTestEmail(trx, a.ctx, a.mailboxId, bodyRow("pending", over30));
      const inSuspended = await insertTestEmail(trx, c.ctx, c.mailboxId, bodyRow("pending", over30));

      expect(await clearMailBodies(trx, a.ctx, { before: before30, pendingBefore })).toBe(1);
      expect(await clearMailBodies(trx, c.ctx, { before: before30, pendingBefore })).toBe(1);
      expect(await bodies(trx, [inPaused, inSuspended])).toEqual([null, null]);
    });
  });

  test("works in batches: batch 2 over 5 rows returns 5", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const ids: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        ids.push(await insertTestEmail(trx, a.ctx, a.mailboxId, bodyRow("done", over30)));
      }
      expect(await clearMailBodies(trx, a.ctx, { before: before30, pendingBefore, batch: 2 })).toBe(5);
      expect(await bodies(trx, ids)).toEqual(Array(5).fill(null));
    });
  });
});

describe("clearMailHeaders", () => {
  function headerRow(createdAt: Date, tag: string) {
    return {
      created_at: createdAt,
      status: "done",
      subject: "Subject",
      from_address: "from@x.test",
      to_addresses: ["to@x.test"],
      cc_addresses: ["cc@x.test"],
      in_reply_to: "<in@x.test>",
      references_header: "<ref@x.test>",
      message_id_header: `<m-${tag}@x.test>`,
      dedup_key: `dedup-${tag}`,
      thread_key: `thread-${tag}`,
      content_hash: `hash-${tag}`,
      received_at: createdAt,
    };
  }

  test("clears the header columns over 90 days, keeps the technical ids and at-limit rows; org B is untouched", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      const over = await insertTestEmail(trx, a.ctx, a.mailboxId, headerRow(over90, "over"));
      const at = await insertTestEmail(trx, a.ctx, a.mailboxId, headerRow(before90, "at"));
      const otherOrg = await insertTestEmail(trx, b.ctx, b.mailboxId, headerRow(over90, "b"));

      expect(await clearMailHeaders(trx, a.ctx, { before: before90 })).toBe(1);

      const read = (id: string) =>
        trx
          .selectFrom("emails")
          .select([
            "subject",
            "from_address",
            "to_addresses",
            "cc_addresses",
            "in_reply_to",
            "references_header",
            "message_id_header",
            "dedup_key",
            "thread_key",
            "content_hash",
            "received_at",
            "status",
          ])
          .where("id", "=", id)
          .executeTakeFirstOrThrow();
      expect(await read(over)).toEqual({
        subject: null,
        from_address: null,
        to_addresses: [],
        cc_addresses: [],
        in_reply_to: null,
        references_header: null,
        message_id_header: "<m-over@x.test>",
        dedup_key: "dedup-over",
        thread_key: "thread-over",
        content_hash: "hash-over",
        received_at: over90,
        status: "done",
      });
      expect(await read(at)).toMatchObject({ subject: "Subject", to_addresses: ["to@x.test"] });
      expect(await read(otherOrg)).toMatchObject({ subject: "Subject", from_address: "from@x.test" });
      expect(await clearMailHeaders(trx, a.ctx, { before: before90 })).toBe(0);
    });
  });
});

describe("clearTriageTexts", () => {
  test("clears reason and fields over 90 days, keeps the rest and at-limit rows; org B is untouched", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      const text = { reason: "Because", fields: { amount: "5" }, category: "info" as const };
      const over = await insertTriaged(trx, a.ctx, a.mailboxId, { ...text, createdAt: over90, reasonCode: "vip" });
      const at = await insertTriaged(trx, a.ctx, a.mailboxId, { ...text, createdAt: before90 });
      const other = await insertTriaged(trx, b.ctx, b.mailboxId, { ...text, createdAt: over90 });

      expect(await clearTriageTexts(trx, a.ctx, { before: before90 })).toBe(1);

      const read = (emailId: string) =>
        trx
          .selectFrom("triage_results")
          .select(["reason", "fields", "category", "confidence", "reason_code"])
          .where("email_id", "=", emailId)
          .executeTakeFirstOrThrow();
      expect(await read(over)).toEqual({
        reason: null,
        fields: {},
        category: "info",
        confidence: 0.9,
        reason_code: "vip",
      });
      expect(await read(at)).toMatchObject({ reason: "Because", fields: { amount: "5" } });
      expect(await read(other)).toMatchObject({ reason: "Because", fields: { amount: "5" } });
      expect(await clearTriageTexts(trx, a.ctx, { before: before90 })).toBe(0);
    });
  });
});

describe("retention_indexes migration", () => {
  test("creates the three indexes", async () => {
    const result = await sql<{ indexname: string }>`
      SELECT indexname FROM pg_indexes
      WHERE indexname IN ('outbox_email_idx', 'outbox_digest_idx', 'emails_org_created_idx')
    `.execute(db);
    expect(result.rows).toHaveLength(3);
  });
});

// Stage 13: actions, delegation, channels.

describe("clearActionPayloads", () => {
  test("clears closed payloads and ready summaries over 90 days; keeps the rest; status and updated_at stay; org B is untouched", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      const payload = { text: "Mail text" };

      async function seed(org: Org) {
        const emailId = await insertTestEmail(trx, org.ctx, org.mailboxId);
        const add = (
          type: "save_summary" | "create_draft" | "send" | "move",
          status: string,
          createdAt: Date,
          rowPayload: Record<string, unknown> = payload
        ) =>
          insertAction(trx, org.ctx, emailId, {
            type,
            status,
            createdAt,
            payload: rowPayload,
            approvedAt: type === "send" && status === "applied" ? createdAt : null,
          });
        return {
          appliedSummary: await add("save_summary", "applied", over90),
          loggedSend: await add("send", "logged", over90),
          expiredDraft: await add("create_draft", "expired", over90),
          readySummary: await add("save_summary", "ready", over90),
          appliedMove: await add("move", "applied", over90, { folder: "ai_info" }),
          appliedSendAt: await add("send", "applied", before90),
          awaitingSend: await add("send", "awaiting_approval", over90),
        };
      }
      const rowsA = await seed(a);
      const rowsB = await seed(b);
      const ids = Object.values(rowsA);
      const snapshot = () =>
        trx
          .selectFrom("actions")
          .select(["id", "payload", "status", "updated_at"])
          .where("id", "in", ids)
          .orderBy("id")
          .execute();
      const beforeRows = await snapshot();

      expect(await clearActionPayloads(trx, a.ctx, { before: before90, keep: isOpenDelegationDraft })).toBe(4);

      const afterRows = await snapshot();
      const byId = new Map(afterRows.map((row) => [row.id, row]));
      for (const key of ["appliedSummary", "loggedSend", "expiredDraft", "readySummary"] as const) {
        expect(byId.get(rowsA[key])?.payload).toEqual({});
      }
      expect(byId.get(rowsA.appliedMove)?.payload).toEqual({ folder: "ai_info" });
      expect(byId.get(rowsA.appliedSendAt)?.payload).toEqual(payload);
      expect(byId.get(rowsA.awaitingSend)?.payload).toEqual(payload);
      expect(afterRows.map((row) => [row.id, row.status, row.updated_at])).toEqual(
        beforeRows.map((row) => [row.id, row.status, row.updated_at])
      );
      const rowsOfB = await trx
        .selectFrom("actions")
        .select("payload")
        .where("id", "in", Object.values(rowsB))
        .execute();
      expect(rowsOfB.filter((row) => Object.keys(row.payload as object).length === 0)).toHaveLength(0);
      expect(await clearActionPayloads(trx, a.ctx, { before: before90, keep: isOpenDelegationDraft })).toBe(0);
    });
  });
});

describe("clearActionPayloads: applying rows and open delegations (F083)", () => {
  async function setUpdatedAt(trx: Transaction<DB>, id: string, at: Date) {
    await trx.updateTable("actions").set({ updated_at: at }).where("id", "=", id).execute();
  }
  const read = async (trx: Transaction<DB>, id: string) =>
    (await trx.selectFrom("actions").select("payload").where("id", "=", id).executeTakeFirstOrThrow()).payload;

  test("clears an applying create_draft or send over 90 days after its last change; keeps a younger one; org B is untouched", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      const payload = { text: "Mail text" };
      async function seed(org: Org) {
        const emailId = await insertTestEmail(trx, org.ctx, org.mailboxId);
        const add = async (type: "create_draft" | "send", updatedAt: Date) => {
          const id = await insertAction(trx, org.ctx, emailId, {
            type,
            status: "applying",
            createdAt: over90,
            lockedAt: over90,
            approvedAt: type === "send" ? over90 : null,
            payload,
          });
          await setUpdatedAt(trx, id, updatedAt);
          return id;
        };
        return {
          draftOver: await add("create_draft", over90),
          sendOver: await add("send", over90),
          sendRecent: await add("send", ago(DAY_MS)),
        };
      }
      const rowsA = await seed(a);
      const rowsB = await seed(b);

      expect(await clearActionPayloads(trx, a.ctx, { before: before90, keep: isOpenDelegationDraft })).toBe(2);
      expect(await read(trx, rowsA.draftOver)).toEqual({});
      expect(await read(trx, rowsA.sendOver)).toEqual({});
      expect(await read(trx, rowsA.sendRecent)).toEqual(payload);
      for (const id of Object.values(rowsB)) expect(await read(trx, id)).toEqual(payload);
      expect(await clearActionPayloads(trx, a.ctx, { before: before90, keep: isOpenDelegationDraft })).toBe(0);
    });
  });

  test("keeps the applied draft payload of an open delegation; clears it when the delegation is closed or has no reminder left", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      async function draftOf(status: string, remindersSent: number): Promise<string> {
        const delegateId = await insertDelegate(trx, a.ctx);
        const { emailId, draftId, sendId } = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
          delegateId,
          createdAt: over90,
          dueDate: "2027-03-01",
          language: "pl",
        });
        await insertDelegation(trx, a.ctx, {
          mailboxId: a.mailboxId,
          emailId,
          delegateId,
          draftActionId: draftId,
          sendActionId: sendId,
          status,
          remindersSent,
        });
        return draftId;
      }
      const sent = await draftOf("sent", 0);
      const overdueOne = await draftOf("overdue", 1);
      const overdueSpent = await draftOf("overdue", 2);
      const done = await draftOf("done", 1);
      const answered = await draftOf("answered", 0);

      await clearActionPayloads(trx, a.ctx, { before: before90, keep: isOpenDelegationDraft });

      expect(await read(trx, sent)).toMatchObject({ due_date: "2027-03-01", language: "pl" });
      expect(await read(trx, overdueOne)).toMatchObject({ due_date: "2027-03-01", language: "pl" });
      for (const id of [overdueSpent, done, answered]) expect(await read(trx, id)).toEqual({});
    });
  });

  test("a keep rule that matches no row clears the applied draft of an open delegation", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const delegateId = await insertDelegate(trx, a.ctx);
      const { emailId, draftId, sendId } = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        delegateId,
        createdAt: over90,
        dueDate: "2027-03-01",
        language: "pl",
      });
      await insertDelegation(trx, a.ctx, {
        mailboxId: a.mailboxId,
        emailId,
        delegateId,
        draftActionId: draftId,
        sendActionId: sendId,
        status: "sent",
        remindersSent: 0,
      });

      expect(await clearActionPayloads(trx, a.ctx, { before: before90, keep: (eb) => eb.lit(false) })).toBe(1);
      expect(await read(trx, draftId)).toEqual({});
    });
  });
});

describe("clearActionErrors", () => {
  test("clears last_error when updated_at is over 90 days; keeps at-limit rows; org B is untouched", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      async function seed(org: Org) {
        const emailId = await insertTestEmail(trx, org.ctx, org.mailboxId);
        const over = await insertAction(trx, org.ctx, emailId, { type: "move", status: "failed" });
        const at = await insertAction(trx, org.ctx, emailId, { type: "move", status: "failed" });
        for (const [id, updatedAt] of [
          [over, over90],
          [at, before90],
        ] as const) {
          await trx
            .updateTable("actions")
            .set({ last_error: "boom", updated_at: updatedAt })
            .where("id", "=", id)
            .execute();
        }
        return { over, at };
      }
      const rowsA = await seed(a);
      const rowsB = await seed(b);
      const read = async (id: string) =>
        (await trx.selectFrom("actions").select("last_error").where("id", "=", id).executeTakeFirstOrThrow())
          .last_error;

      expect(await clearActionErrors(trx, a.ctx, { before: before90 })).toBe(1);
      expect(await read(rowsA.over)).toBeNull();
      expect(await read(rowsA.at)).toBe("boom");
      expect(await read(rowsB.over)).toBe("boom");
      expect(await clearActionErrors(trx, a.ctx, { before: before90 })).toBe(0);
    });
  });
});

describe("clearDelegationTasks", () => {
  async function one(
    trx: Transaction<DB>,
    org: Org,
    status: string,
    updatedAt: Date,
    opts: { remindersSent?: number; dueAt?: Date | null } = {}
  ): Promise<string> {
    const delegateId = await insertDelegate(trx, org.ctx);
    const { emailId, draftId, sendId } = await insertDraftAndSend(trx, org.ctx, org.mailboxId, { delegateId });
    const id = await insertDelegation(trx, org.ctx, {
      mailboxId: org.mailboxId,
      emailId,
      delegateId,
      draftActionId: draftId,
      sendActionId: sendId,
      status,
      taskSummary: "Prepare the offer",
      remindersSent: opts.remindersSent,
      dueAt: opts.dueAt,
    });
    await trx.updateTable("delegations").set({ updated_at: updatedAt }).where("id", "=", id).execute();
    return id;
  }
  const read = async (trx: Transaction<DB>, id: string) =>
    (await trx.selectFrom("delegations").select("task_summary").where("id", "=", id).executeTakeFirstOrThrow())
      .task_summary;

  test("replaces the task text of a closed delegation when updated_at is over 90 days; keeps at-limit rows; org B is untouched", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      const doneOver = await one(trx, a, "done", over90);
      const answeredOver = await one(trx, a, "answered", over90);
      const cancelledOver = await one(trx, a, "cancelled", over90);
      const doneAt = await one(trx, a, "done", before90);
      const otherOrg = await one(trx, b, "done", over90);

      expect(await clearDelegationTasks(trx, a.ctx, { before: before90 })).toBe(3);
      for (const id of [doneOver, answeredOver, cancelledOver]) expect(await read(trx, id)).toBe("[removed]");
      expect(await read(trx, doneAt)).toBe("Prepare the offer");
      expect(await read(trx, otherOrg)).toBe("Prepare the offer");
      expect(await clearDelegationTasks(trx, a.ctx, { before: before90 })).toBe(0);
    });
  });

  test("keeps the task text of an open delegation, also with a due date more than 90 days ahead; clears an overdue one with no reminder left", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const farDue = new Date(now.getTime() + 120 * DAY_MS);
      const drafted = await one(trx, a, "drafted", over90);
      const sentFar = await one(trx, a, "sent", over90, { dueAt: farDue });
      const overdueNone = await one(trx, a, "overdue", over90, { remindersSent: 0 });
      const overdueOne = await one(trx, a, "overdue", over90, { remindersSent: 1 });
      const overdueSpent = await one(trx, a, "overdue", over90, { remindersSent: 2 });

      expect(await clearDelegationTasks(trx, a.ctx, { before: before90 })).toBe(1);
      for (const id of [drafted, sentFar, overdueNone, overdueOne])
        expect(await read(trx, id)).toBe("Prepare the offer");
      expect(await read(trx, overdueSpent)).toBe("[removed]");
    });
  });
});

describe("clearOutboxTexts", () => {
  const buttons = [{ kind: "url", label: "Open", url: "https://x.test/" }];

  test("clears sent and failed texts, expires old pending and sending rows, keeps at-limit rows; org B is untouched", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      async function seed(org: { orgId: string; userId: string; mailboxId: string }) {
        const add = async (status: string, createdAt: Date, extra: Record<string, unknown> = {}) =>
          (
            await trx
              .insertInto("outbox")
              .values({
                org_id: org.orgId,
                user_id: org.userId,
                kind: "sync_ok",
                dedup_key: `key-${randomUUID()}`,
                mailbox_id: org.mailboxId,
                text: "Message text",
                view: JSON.stringify({ subject: "MARKER" }),
                buttons: JSON.stringify(buttons),
                status,
                created_at: createdAt,
                next_attempt_at: createdAt,
                ...extra,
              })
              .returning("id")
              .executeTakeFirstOrThrow()
          ).id;
        return {
          sentOver: await add("sent", over90, { sent_at: over90 }),
          failedOver: await add("failed", over90, { error_code: "blocked" }),
          failedNoText: await add("failed", over90, { error_code: "bad_view", text: null }),
          pendingOver: await add("pending", over90),
          sendingOver: await add("sending", over90, { locked_at: over90 }),
          pendingAt: await add("pending", before90),
        };
      }
      const rowsA = await seed(a);
      const rowsB = await seed(b);
      const read = (id: string) =>
        trx
          .selectFrom("outbox")
          .select(["text", "status", "error_code", "locked_at", "buttons", "view"])
          .where("id", "=", id)
          .executeTakeFirstOrThrow();

      expect(await clearOutboxTexts(trx, { orgId: a.orgId }, { before: before90 })).toBe(5);

      expect(await read(rowsA.sentOver)).toMatchObject({ text: "[removed]", status: "sent", buttons, view: {} });
      expect(await read(rowsA.failedNoText)).toMatchObject({
        text: "[removed]",
        status: "failed",
        error_code: "bad_view",
        view: {},
      });
      expect(await read(rowsA.failedOver)).toMatchObject({
        text: "[removed]",
        status: "failed",
        error_code: "blocked",
      });
      for (const id of [rowsA.pendingOver, rowsA.sendingOver]) {
        expect(await read(id)).toMatchObject({
          text: "[removed]",
          status: "failed",
          error_code: "expired",
          locked_at: null,
          view: {},
        });
      }
      expect(await read(rowsA.pendingAt)).toMatchObject({
        text: "Message text",
        status: "pending",
        view: { subject: "MARKER" },
      });
      for (const id of Object.values(rowsB)) {
        const rowB = await read(id);
        expect(rowB.view).toEqual({ subject: "MARKER" });
        if (id !== rowsB.failedNoText) expect(rowB.text).toBe("Message text");
      }
      const afterFirst = await trx.selectFrom("outbox").selectAll().where("org_id", "=", a.orgId).execute();
      expect(await clearOutboxTexts(trx, { orgId: a.orgId }, { before: before90 })).toBe(0);
      expect(await trx.selectFrom("outbox").selectAll().where("org_id", "=", a.orgId).execute()).toEqual(afterFirst);
    });
  });
});

describe("deleteOldLinkTokens", () => {
  test("deletes tokens used or expired over one day ago; keeps the rest; org B is untouched", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const limit = ago(DAY_MS);
      async function seed(org: { orgId: string; userId: string }) {
        const add = async (expiresAt: Date, usedAt: Date | null) => {
          const hash = `${randomUUID()}${randomUUID()}`.replaceAll("-", "");
          await trx
            .insertInto("chat_link_tokens")
            .values({
              org_id: org.orgId,
              user_id: org.userId,
              token_hash: hash,
              expires_at: expiresAt,
              used_at: usedAt,
            })
            .execute();
          return hash;
        };
        return {
          usedOld: await add(ago(-DAY_MS), ago(2 * DAY_MS)),
          expiredOld: await add(ago(2 * DAY_MS), null),
          future: await add(ago(-DAY_MS), null),
          usedRecent: await add(ago(-DAY_MS), ago(3_600_000)),
        };
      }
      const rowsA = await seed(a);
      const rowsB = await seed(b);
      const exists = async (hash: string) =>
        (await trx.selectFrom("chat_link_tokens").select("token_hash").where("token_hash", "=", hash).execute())
          .length === 1;

      expect(await deleteOldLinkTokens(trx, { orgId: a.orgId }, { before: limit })).toBe(2);
      expect(await exists(rowsA.usedOld)).toBe(false);
      expect(await exists(rowsA.expiredOld)).toBe(false);
      expect(await exists(rowsA.future)).toBe(true);
      expect(await exists(rowsA.usedRecent)).toBe(true);
      for (const hash of Object.values(rowsB)) expect(await exists(hash)).toBe(true);
      expect(await deleteOldLinkTokens(trx, { orgId: a.orgId }, { before: limit })).toBe(0);
    });
  });
});
