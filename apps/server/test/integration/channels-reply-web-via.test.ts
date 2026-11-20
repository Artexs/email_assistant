import { HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { noApprovalHooks, noDelegationHooks, type ApprovalDeps } from "../../src/modules/actions";
import { listEndedRequestsVia, redraftReply, requestReply, setReplyRecipients } from "../../src/modules/replies";
import type { DB } from "../../src/platform/db";

import { testDb, withRollback } from "./helpers";
import { addReplyMail, draftedReply, setMailAddresses, type JobBox } from "./reply-job-fixtures";
import { outboxOf, rig } from "./reply-telegram-fixtures";

// A request that the panel makes writes `via: "web"`; the Telegram result detector answers only requests with `via = telegram`
// (a web request gets no card and no line in Telegram). The services are the ones the routes call.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NO_DRAFT = { decision: "no_draft", reason_code: "needs_facts", body: "", gaps: [], language: "pl" };

const approvalDeps = (trx: Transaction<DB>): ApprovalDeps => ({
  db: trx,
  hooks: noDelegationHooks,
  approvalHooks: noApprovalHooks,
  uidplus: async () => true,
});

async function auditVia(trx: Transaction<DB>, box: JobBox) {
  const rows = await trx
    .selectFrom("audit_log")
    .select("data")
    .where("org_id", "=", box.ctx.orgId)
    .where("event", "=", "reply.requested")
    .execute();
  return rows.map((row) => (row.data as { via: string }).via);
}

describe("the channel of a request", () => {
  test("1. a tap and a redraft with via web end with no Telegram line; the same with via telegram gives one line each", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      const web = await draftedReply(trx, r.box, r.clock);
      const asked = await redraftReply({ db: trx, now: () => r.clock.now }, r.box.ctx, {
        userId: r.box.userId,
        via: "web",
        sendId: web.sendId,
        instruction: "a line",
      });
      expect(asked.kind).toBe("queued");
      const tap = await addReplyMail(trx, r.box, { category: "info" });
      expect(
        (
          await requestReply({ db: trx, now: () => r.clock.now }, r.box.ctx, {
            userId: r.box.userId,
            via: "web",
            emailId: tap,
          })
        ).kind
      ).toBe("queued");
      await r.job(NO_DRAFT);
      await r.detect();
      await r.detect();
      expect(await auditVia(trx, r.box)).toEqual(["web", "web"]);
      expect(await outboxOf(trx, r, "reply_result")).toEqual([]);

      // The same two requests through Telegram: each ends with one fixed line.
      const second = await draftedReply(trx, r.box, r.clock);
      await redraftReply({ db: trx, now: () => r.clock.now }, r.box.ctx, {
        userId: r.box.userId,
        via: "telegram",
        sendId: second.sendId,
        instruction: "a line",
      });
      const tapped = await addReplyMail(trx, r.box, { category: "info" });
      await requestReply({ db: trx, now: () => r.clock.now }, r.box.ctx, {
        userId: r.box.userId,
        via: "telegram",
        emailId: tapped,
      });
      await r.job(NO_DRAFT);
      await r.detect();
      expect(await outboxOf(trx, r, "reply_result")).toHaveLength(2);
    });
  });

  test("2. the source of the end list is the audit row: a done web request is not in the list of via telegram, and the other way round", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      const made = await draftedReply(trx, r.box, r.clock);
      await redraftReply({ db: trx, now: () => r.clock.now }, r.box.ctx, {
        userId: r.box.userId,
        via: "web",
        sendId: made.sendId,
        instruction: "a line",
      });
      await r.job();
      const window = { since: new Date(r.clock.now.getTime() - HOUR_MS), limit: 50, maxLifeMs: HOUR_MS };
      expect(await listEndedRequestsVia(trx, r.box.ctx, { via: "telegram", ...window })).toEqual([]);
      expect(await listEndedRequestsVia(trx, r.box.ctx, { via: "web", ...window })).toHaveLength(1);
    });
  });

  test("3. a recipients change by web is no request and writes no reply.requested row", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      const made = await draftedReply(trx, r.box, r.clock);
      await setMailAddresses(trx, made.emailId, { to: ["b@y.test"] });
      const result = await setReplyRecipients(approvalDeps(trx), r.box.ctx, {
        userId: r.box.userId,
        via: "web",
        sendId: made.sendId,
        mode: "all",
        now: r.clock.now,
      });
      expect(result.kind).toBe("edited");
      expect(await auditVia(trx, r.box)).toEqual([]);
      const edited = await trx
        .selectFrom("audit_log")
        .select("data")
        .where("org_id", "=", r.box.ctx.orgId)
        .where("event", "=", "action.edited")
        .execute();
      expect(edited.map((row) => (row.data as { via: string }).via)).toEqual(["web"]);
    });
  });
});
