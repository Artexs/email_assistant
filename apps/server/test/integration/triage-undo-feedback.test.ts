import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import type { ActionsScope } from "../../src/modules/actions";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { insertFeedback, recordWebFeedback, undoWithFeedback } from "../../src/modules/triage";
import type { DB } from "../../src/platform/db";
import { HardError } from "../../src/platform/errors";

import {
  createOrgWithMailbox,
  insertAction,
  insertTestEmail,
  insertTriaged,
  insertTriagedWithActions,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T = new Date("2026-11-11T10:00:00Z");
const NOW = new Date(T.getTime() + HOUR);
const MESSAGE_ID = "<a@ea-seed.test>";
const SYNTHETIC: ActionsScope = { kind: "synthetic", testMail: NO_TEST_SENDERS };

async function setup(trx: Transaction<DB>) {
  const a = await createOrgWithMailbox(trx);
  const b = await createOrgWithMailbox(trx);
  return { a, b, ctx: { orgId: a.orgId }, ctxB: { orgId: b.orgId } };
}

type S = Awaited<ReturnType<typeof setup>>;

const opts = (s: S, scope: ActionsScope = SYNTHETIC, now: Date = NOW) => ({ now, userId: s.a.userId, scope });

function mailOf(
  trx: Transaction<DB>,
  s: S,
  category: "info" | "unsure",
  actions: {
    type: "move" | "mark_read" | "flag";
    status: string;
    payload?: Record<string, string>;
    appliedAt?: Date;
  }[],
  messageId: string = MESSAGE_ID
) {
  return insertTriagedWithActions(trx, s.ctx, s.a.mailboxId, {
    category,
    createdAt: T,
    messageId,
    actions: actions.map((action) => ({ appliedAt: action.status === "applied" ? T : null, ...action })),
  });
}

const infoActions = [
  { type: "move" as const, status: "applied", payload: { folder: "ai_info" } },
  { type: "mark_read" as const, status: "applied" },
];

async function feedbackRows(trx: Transaction<DB>, emailId: string) {
  return trx
    .selectFrom("triage_feedback")
    .selectAll()
    .where("email_id", "=", emailId)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .execute();
}

async function reverseRows(trx: Transaction<DB>, orgId: string) {
  return trx
    .selectFrom("actions")
    .selectAll()
    .where("org_id", "=", orgId)
    .where("reverses_action_id", "is not", null)
    .execute();
}

// Rows of one transaction share `now()`: move the rows written so far into the past.
async function ageFeedback(trx: Transaction<DB>, emailId: string): Promise<void> {
  await trx
    .updateTable("triage_feedback")
    .set({ created_at: sql`created_at - interval '1 minute'` })
    .where("email_id", "=", emailId)
    .execute();
}

describe("undoWithFeedback", () => {
  test("(1) an info mail: reverse rows, one wrong feedback row, audit rows; the second call is already", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const mail = await mailOf(trx, s, "info", infoActions);

      expect(await undoWithFeedback(trx, s.ctx, mail.emailId, opts(s))).toEqual({ kind: "started", created: 2 });

      expect(await reverseRows(trx, s.a.orgId)).toHaveLength(2);
      expect(await feedbackRows(trx, mail.emailId)).toMatchObject([
        { verdict: "wrong", true_category: null, source: "undo", user_id: s.a.userId },
      ]);
      const audit = await trx
        .selectFrom("audit_log")
        .selectAll()
        .where("org_id", "=", s.a.orgId)
        .where("event", "=", "action.undo_requested")
        .execute();
      expect(audit).toHaveLength(2);
      for (const row of audit) {
        expect(row.actor).toBe(s.a.userId);
      }

      expect(await undoWithFeedback(trx, s.ctx, mail.emailId, opts(s))).toEqual({ kind: "already" });
      expect(await feedbackRows(trx, mail.emailId)).toHaveLength(1);
    });
  });

  test("(2) an unsure mail: started, no feedback row", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const mail = await mailOf(trx, s, "unsure", [infoActions[0] as (typeof infoActions)[0]]);

      expect(await undoWithFeedback(trx, s.ctx, mail.emailId, opts(s))).toEqual({ kind: "started", created: 1 });

      expect(await feedbackRows(trx, mail.emailId)).toHaveLength(0);
    });
  });

  test("(3) a ✏️ label stays the latest feedback row", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const mail = await mailOf(trx, s, "info", infoActions);
      await insertFeedback(trx, s.ctx, {
        emailId: mail.emailId,
        verdict: "wrong",
        trueCategory: "notification",
        source: "telegram",
        userId: s.a.userId,
      });
      await ageFeedback(trx, mail.emailId);

      expect(await undoWithFeedback(trx, s.ctx, mail.emailId, opts(s))).toEqual({ kind: "started", created: 2 });

      const rows = await feedbackRows(trx, mail.emailId);
      expect(rows[0]).toMatchObject({ true_category: "notification", source: "telegram" });
      expect(rows).toHaveLength(1);
    });
  });

  test("(4) held: scope off and a paused mailbox write nothing", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const mail = await mailOf(trx, s, "info", infoActions);

      expect(await undoWithFeedback(trx, s.ctx, mail.emailId, opts(s, { kind: "off" }))).toEqual({ kind: "held" });
      await trx.updateTable("mailboxes").set({ status: "paused" }).where("id", "=", s.a.mailboxId).execute();
      expect(await undoWithFeedback(trx, s.ctx, mail.emailId, opts(s))).toEqual({ kind: "held" });

      expect(await reverseRows(trx, s.a.orgId)).toHaveLength(0);
      expect(await feedbackRows(trx, mail.emailId)).toHaveLength(0);
    });
  });

  test("(5) too old and nothing", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const old = await mailOf(trx, s, "info", [
        { type: "flag", status: "applied", appliedAt: new Date(NOW.getTime() - 8 * DAY) },
      ]);
      const logged = await mailOf(trx, s, "info", [{ type: "flag", status: "logged" }], "<b@ea-seed.test>");

      expect(await undoWithFeedback(trx, s.ctx, old.emailId, opts(s))).toEqual({ kind: "too_old" });
      expect(await undoWithFeedback(trx, s.ctx, logged.emailId, opts(s))).toEqual({ kind: "nothing" });

      expect(await reverseRows(trx, s.a.orgId)).toHaveLength(0);
      expect(await feedbackRows(trx, old.emailId)).toHaveLength(0);
      expect(await feedbackRows(trx, logged.emailId)).toHaveLength(0);
    });
  });

  test("(6) a mail with actions but no triage result is not_found", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const emailId = await insertTestEmail(trx, s.ctx, s.a.mailboxId, { message_id_header: MESSAGE_ID });
      await insertAction(trx, s.ctx, emailId, { type: "flag", status: "applied", appliedAt: T });

      expect(await undoWithFeedback(trx, s.ctx, emailId, opts(s))).toEqual({ kind: "not_found" });

      expect(await reverseRows(trx, s.a.orgId)).toHaveLength(0);
    });
  });

  test("(7) another organization's mail and an unknown id are not_found; nothing is written", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const theirs = await insertTriagedWithActions(trx, s.ctxB, s.b.mailboxId, {
        category: "info",
        createdAt: T,
        messageId: MESSAGE_ID,
        actions: [{ type: "flag", status: "applied", appliedAt: T }],
      });

      expect(await undoWithFeedback(trx, s.ctx, theirs.emailId, opts(s))).toEqual({ kind: "not_found" });
      expect(await undoWithFeedback(trx, s.ctx, randomUUID(), opts(s))).toEqual({ kind: "not_found" });

      expect(await reverseRows(trx, s.a.orgId)).toHaveLength(0);
      expect(await reverseRows(trx, s.b.orgId)).toHaveLength(0);
      expect(await feedbackRows(trx, theirs.emailId)).toHaveLength(0);
    });
  });
});

describe("recordWebFeedback", () => {
  test("(9) saves, skips the same answer, changes the answer, handles unsure", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const mail = await insertTriaged(trx, s.ctx, s.a.mailboxId, { category: "info", createdAt: T });
      const input = (trueCategory: "info" | "needs_reply") => ({
        emailId: mail,
        trueCategory,
        userId: s.a.userId,
      });

      expect(await recordWebFeedback(trx, s.ctx, input("info"))).toEqual({
        kind: "saved",
        saved: true,
        verdict: "right",
        aiCategory: "info",
      });
      expect(await feedbackRows(trx, mail)).toMatchObject([{ source: "web", user_id: s.a.userId }]);

      expect(await recordWebFeedback(trx, s.ctx, input("info"))).toMatchObject({ kind: "saved", saved: false });
      expect(await feedbackRows(trx, mail)).toHaveLength(1);

      await ageFeedback(trx, mail);
      expect(await recordWebFeedback(trx, s.ctx, input("needs_reply"))).toEqual({
        kind: "saved",
        saved: true,
        verdict: "wrong",
        aiCategory: "info",
      });
      const rows = await feedbackRows(trx, mail);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ true_category: "needs_reply", verdict: "wrong", source: "web" });

      const unsure = await insertTriaged(trx, s.ctx, s.a.mailboxId, { category: "unsure", createdAt: T });
      expect(await recordWebFeedback(trx, s.ctx, { ...input("info"), emailId: unsure })).toEqual({
        kind: "saved",
        saved: true,
        verdict: "wrong",
        aiCategory: "unsure",
      });
    });
  });

  test("(9b) another organization's mail and an unknown id are not_found; a bad category throws", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const theirs = await insertTriaged(trx, s.ctxB, s.b.mailboxId, { category: "info", createdAt: T });
      const mine = await insertTriaged(trx, s.ctx, s.a.mailboxId, { category: "info", createdAt: T });
      const base = { trueCategory: "info" as const, userId: s.a.userId };

      expect(await recordWebFeedback(trx, s.ctx, { ...base, emailId: theirs })).toEqual({ kind: "not_found" });
      expect(await recordWebFeedback(trx, s.ctx, { ...base, emailId: randomUUID() })).toEqual({ kind: "not_found" });
      expect(await feedbackRows(trx, theirs)).toHaveLength(0);

      for (const bad of ["unsure", "delegation"]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const call = recordWebFeedback(trx, s.ctx, { ...base, emailId: mine, trueCategory: bad as any });
        await expect(call).rejects.toBeInstanceOf(HardError);
      }
      expect(await feedbackRows(trx, mine)).toHaveLength(0);
    });
  });
});
