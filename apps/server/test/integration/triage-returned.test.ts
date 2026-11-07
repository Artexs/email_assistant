import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { undo } from "../../src/modules/actions";
import { createReturnedJob, processReturned, recordFeedback } from "../../src/modules/triage";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertAction, insertTriagedWithActions, pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const HOUR = 3_600_000;
const NOW = new Date();
const RECEIVED = new Date(NOW.getTime() - 3 * HOUR);
const APPLIED = new Date(NOW.getTime() - HOUR);

interface Tenant {
  ctx: TenantContext;
  userId: string;
  mailboxId: string;
  address: string;
}

async function tenant(trx: Transaction<DB>): Promise<Tenant> {
  const address = `box-${crypto.randomUUID()}@x.test`;
  const box = await createOrgWithMailbox(trx, { address });
  return { ctx: { orgId: box.orgId }, userId: box.userId, mailboxId: box.mailboxId, address };
}

// A mail that the system moved to AI/Info; `returned_at` is set.
async function returnedMail(
  trx: Transaction<DB>,
  t: Tenant,
  opts: {
    category?: "info" | "unsure";
    actions?: { type: "move" | "flag"; status: string; payload?: Record<string, string> }[];
    returned?: boolean;
  } = {}
): Promise<{ emailId: string; actionIds: string[] }> {
  const actions = opts.actions ?? [{ type: "move", status: "applied", payload: { target: "AI/Info" } }];
  const mail = await insertTriagedWithActions(trx, t.ctx, t.mailboxId, {
    category: opts.category ?? "info",
    createdAt: RECEIVED,
    receivedAt: RECEIVED,
    from: "sender@x.test",
    messageId: `<ret-${crypto.randomUUID()}@x.test>`,
    folder: "INBOX",
    actions: actions.map((action) => ({
      ...action,
      appliedAt: action.status === "applied" || action.status === "undone" ? APPLIED : null,
    })),
  });
  if (opts.returned !== false) await flag(trx, mail.emailId);
  return mail;
}

async function flag(trx: Transaction<DB>, emailId: string): Promise<void> {
  await trx.updateTable("emails").set({ returned_at: NOW }).where("id", "=", emailId).execute();
}

async function feedbackRows(trx: Transaction<DB>, emailId: string) {
  return trx
    .selectFrom("triage_feedback")
    .selectAll()
    .where("email_id", "=", emailId)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
}

async function actionState(trx: Transaction<DB>, id: string) {
  return trx.selectFrom("actions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

async function returnedAt(trx: Transaction<DB>, emailId: string): Promise<Date | null> {
  const row = await trx.selectFrom("emails").select("returned_at").where("id", "=", emailId).executeTakeFirstOrThrow();
  return row.returned_at;
}

async function audit(trx: Transaction<DB>, emailId: string, event: string) {
  return trx.selectFrom("audit_log").selectAll().where("email_id", "=", emailId).where("event", "=", event).execute();
}

async function reverseFor(trx: Transaction<DB>, t: Tenant, emailId: string, originalId: string, status: string) {
  return insertAction(trx, t.ctx, emailId, {
    type: "move",
    status,
    payload: { target: "INBOX" },
    reversesActionId: originalId,
    idempotencyKey: `${originalId}:undo`,
  });
}

describe("processReturned", () => {
  test("a user move back gives one imap_move feedback row and marks the move undone", async () => {
    await withRollback(db, async (trx) => {
      const t = await tenant(trx);
      const mail = await returnedMail(trx, t);

      expect(await processReturned(trx, t.ctx, mail.emailId, NOW)).toEqual({ feedback: true, undone: true });

      const rows = await feedbackRows(trx, mail.emailId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ verdict: "wrong", source: "imap_move", true_category: null, user_id: null });
      expect(await actionState(trx, mail.actionIds[0] as string)).toMatchObject({
        status: "undone",
        status_reason: "user_moved_back",
      });
      expect(await returnedAt(trx, mail.emailId)).toBeNull();
      const undone = await audit(trx, mail.emailId, "action.undone");
      expect(undone).toHaveLength(1);
      expect(undone[0]?.action_id).toBe(mail.actionIds[0] as string);
      const returned = await audit(trx, mail.emailId, "email.returned");
      expect(returned).toHaveLength(1);
      expect(returned[0]?.data).toMatchObject({ mailbox_id: t.mailboxId, feedback: true });
    });
  });

  test("a second return finds the move undone: no second feedback row", async () => {
    await withRollback(db, async (trx) => {
      const t = await tenant(trx);
      const mail = await returnedMail(trx, t);
      await processReturned(trx, t.ctx, mail.emailId, NOW);
      await flag(trx, mail.emailId);

      expect(await processReturned(trx, t.ctx, mail.emailId, NOW)).toEqual({ feedback: false, undone: false });

      expect(await feedbackRows(trx, mail.emailId)).toHaveLength(1);
      expect(await returnedAt(trx, mail.emailId)).toBeNull();
    });
  });

  test("after an Undo (reverse applied) no feedback row is written and the flag is cleared", async () => {
    await withRollback(db, async (trx) => {
      const t = await tenant(trx);
      const mail = await returnedMail(trx, t, { actions: [{ type: "move", status: "undone" }] });
      await reverseFor(trx, t, mail.emailId, mail.actionIds[0] as string, "applied");

      expect(await processReturned(trx, t.ctx, mail.emailId, NOW)).toEqual({ feedback: false, undone: false });

      expect(await feedbackRows(trx, mail.emailId)).toHaveLength(0);
      expect(await returnedAt(trx, mail.emailId)).toBeNull();
      const returned = await audit(trx, mail.emailId, "email.returned");
      expect(returned[0]?.data).toMatchObject({ feedback: false, move_action_id: mail.actionIds[0] as string });
    });
  });

  test("a reverse in ready (Undo under way): no feedback, the move stays applied", async () => {
    await withRollback(db, async (trx) => {
      const t = await tenant(trx);
      const mail = await returnedMail(trx, t);
      await reverseFor(trx, t, mail.emailId, mail.actionIds[0] as string, "ready");

      expect(await processReturned(trx, t.ctx, mail.emailId, NOW)).toEqual({ feedback: false, undone: false });

      expect(await feedbackRows(trx, mail.emailId)).toHaveLength(0);
      expect((await actionState(trx, mail.actionIds[0] as string)).status).toBe("applied");
      expect(await returnedAt(trx, mail.emailId)).toBeNull();
    });
  });

  test("a failed reverse: the user moved the mail by hand; the move is undone, no feedback row", async () => {
    await withRollback(db, async (trx) => {
      const t = await tenant(trx);
      const mail = await returnedMail(trx, t);
      await reverseFor(trx, t, mail.emailId, mail.actionIds[0] as string, "failed");

      expect(await processReturned(trx, t.ctx, mail.emailId, NOW)).toEqual({ feedback: false, undone: true });

      expect(await actionState(trx, mail.actionIds[0] as string)).toMatchObject({
        status: "undone",
        status_reason: "user_moved_back",
      });
      expect(await feedbackRows(trx, mail.emailId)).toHaveLength(0);
      expect(await returnedAt(trx, mail.emailId)).toBeNull();
    });
  });

  test("a ✏️ label with a true category stays the latest row: the move is undone, no new row", async () => {
    await withRollback(db, async (trx) => {
      const t = await tenant(trx);
      const mail = await returnedMail(trx, t);
      await recordFeedback(trx, t.ctx, { emailId: mail.emailId, trueCategory: "needs_reply", source: "telegram" });

      expect(await processReturned(trx, t.ctx, mail.emailId, NOW)).toEqual({ feedback: false, undone: true });

      const rows = await feedbackRows(trx, mail.emailId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.true_category).toBe("needs_reply");
      expect((await actionState(trx, mail.actionIds[0] as string)).status).toBe("undone");
      const returned = await audit(trx, mail.emailId, "email.returned");
      expect(returned[0]?.data).toMatchObject({ feedback: false });
    });
  });

  test("category unsure: the move is undone, no feedback row", async () => {
    await withRollback(db, async (trx) => {
      const t = await tenant(trx);
      const mail = await returnedMail(trx, t, {
        category: "unsure",
        actions: [{ type: "move", status: "applied", payload: { target: "AI/Manual" } }],
      });

      expect(await processReturned(trx, t.ctx, mail.emailId, NOW)).toEqual({ feedback: false, undone: true });

      expect(await feedbackRows(trx, mail.emailId)).toHaveLength(0);
      expect((await actionState(trx, mail.actionIds[0] as string)).status).toBe("undone");
      expect(await returnedAt(trx, mail.emailId)).toBeNull();
    });
  });

  test("a mail with only a flag action: no feedback, the flag is cleared", async () => {
    await withRollback(db, async (trx) => {
      const t = await tenant(trx);
      const mail = await returnedMail(trx, t, { actions: [{ type: "flag", status: "applied" }] });

      expect(await processReturned(trx, t.ctx, mail.emailId, NOW)).toEqual({ feedback: false, undone: false });

      expect(await feedbackRows(trx, mail.emailId)).toHaveLength(0);
      expect((await actionState(trx, mail.actionIds[0] as string)).status).toBe("applied");
      expect(await returnedAt(trx, mail.emailId)).toBeNull();
      const returned = await audit(trx, mail.emailId, "email.returned");
      expect(returned[0]?.data).toMatchObject({ feedback: false, move_action_id: null });
    });
  });

  test("recordFeedback in a transaction: the row is visible in the same transaction", async () => {
    await withRollback(db, async (trx) => {
      const t = await tenant(trx);
      const mail = await returnedMail(trx, t, { returned: false });

      const saved = await recordFeedback(trx, t.ctx, { emailId: mail.emailId, verdict: "wrong", source: "cli" });

      expect(saved.saved).toBe(true);
      expect((await feedbackRows(trx, mail.emailId)).map((row) => row.id)).toEqual([saved.id]);
    });
  });
});

describe("createReturnedJob", () => {
  test("processes three returned rows of one mailbox in one run; org B is untouched", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const a = await tenant(trx);
      const b = await tenant(trx);
      const mailsA = [await returnedMail(trx, a), await returnedMail(trx, a), await returnedMail(trx, a)];
      const mailB = await returnedMail(trx, b);
      // Org B's mailbox is paused: the run walks active mailboxes only.
      await trx.updateTable("mailboxes").set({ status: "paused" }).where("id", "=", b.mailboxId).execute();

      await createReturnedJob({ db: trx, now: () => NOW }).run();

      for (const mail of mailsA) {
        expect(await returnedAt(trx, mail.emailId)).toBeNull();
        expect(await feedbackRows(trx, mail.emailId)).toHaveLength(1);
      }
      expect(await returnedAt(trx, mailB.emailId)).not.toBeNull();
      expect(await feedbackRows(trx, mailB.emailId)).toHaveLength(0);
      expect((await actionState(trx, mailB.actionIds[0] as string)).status).toBe("applied");
    });
  });

  test("org A's run does not touch org B's returned mail (active mailbox, other org)", async () => {
    await withRollback(db, async (trx) => {
      const a = await tenant(trx);
      const b = await tenant(trx);
      const mailB = await returnedMail(trx, b);

      await processReturned(trx, a.ctx, mailB.emailId, NOW);

      expect(await returnedAt(trx, mailB.emailId)).not.toBeNull();
      expect(await feedbackRows(trx, mailB.emailId)).toHaveLength(0);
    });
  });
});

describe("processReturned and Undo on two connections (M8)", () => {
  test("an Undo that commits first leaves the move applied and no imap_move row", async () => {
    const { t, mail } = await db.transaction().execute(async (trx) => {
      const own = await tenant(trx);
      return { t: own, mail: await returnedMail(trx, own) };
    });
    const { userId } = t;
    try {
      let pending: Promise<{ feedback: boolean; undone: boolean }> | undefined;
      await db.transaction().execute(async (trx1) => {
        const result = await undo(trx1, t.ctx, mail.emailId, {
          now: NOW,
          userId,
          scope: { kind: "all", mailboxAddress: t.address },
        });
        expect(result).toEqual({ kind: "started", created: 1 });
        // The second connection waits on the row lock of the original move.
        pending = processReturned(db, t.ctx, mail.emailId, NOW);
        await new Promise((resolve) => setTimeout(resolve, 200));
        // The Telegram callback writes this row.
        await recordFeedback(trx1, t.ctx, { emailId: mail.emailId, verdict: "wrong", source: "undo", userId });
      });

      expect(await pending).toEqual({ feedback: false, undone: false });

      const rows = await db.selectFrom("triage_feedback").selectAll().where("email_id", "=", mail.emailId).execute();
      expect(rows.map((row) => row.source)).toEqual(["undo"]);
      const move = await db
        .selectFrom("actions")
        .select("status")
        .where("id", "=", mail.actionIds[0] as string)
        .executeTakeFirstOrThrow();
      expect(move.status).toBe("applied");
      const email = await db
        .selectFrom("emails")
        .select("returned_at")
        .where("id", "=", mail.emailId)
        .executeTakeFirstOrThrow();
      expect(email.returned_at).toBeNull();
    } finally {
      await db.deleteFrom("organizations").where("id", "=", t.ctx.orgId).execute();
      await db.deleteFrom("users").where("id", "=", t.userId).execute();
    }
  });
});
