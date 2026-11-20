import { randomUUID } from "node:crypto";
import { format } from "node:util";

import { HOUR_MS, MINUTE_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { type Transaction } from "kysely";

import { listSendLimitHolds } from "../../src/modules/actions";
import { detectNotices } from "../../src/modules/channels";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import type { DB } from "../../src/platform/db";

import { at, buttonData, Org, org, rows, run, sendOrg, setStatus, T, waiting } from "./channels-notices-helpers";
import { insertDelegation, insertTestEmail, isolateChannels } from "./fixtures";
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

describe("send_held notices", () => {
  const NOW = new Date("2026-11-20T10:00:00Z");
  const LIMIT_ERROR = "send_limit:mailbox_hour";

  async function runAt(trx: Transaction<DB>, now: Date): Promise<void> {
    await detectNotices({
      db: trx,
      now: () => now,
      startedAt: new Date(now.getTime() - HOUR_MS),
      testMail: NO_TEST_SENDERS,
    });
  }

  // An approved send that waits on a limit (or on `lastError`) until `nextAttemptAt`.
  async function held(trx: Transaction<DB>, o: Org, nextAttemptAt: Date, lastError: string | null = LIMIT_ERROR) {
    const p = await waiting(trx, o, {
      sendStatus: "approved",
      approved: { userId: o.ownerId, at: at(-20 * MINUTE_MS) },
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
      await held(trx, o, new Date(NOW.getTime() + 10 * MINUTE_MS));
      await held(trx, o, new Date(NOW.getTime() + 20 * MINUTE_MS));

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
      expect(new Date((first[0]?.view as { nextAt: string }).nextAt)).toEqual(new Date(NOW.getTime() + 10 * MINUTE_MS));
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
      await held(trx, o, new Date(NOW.getTime() - MINUTE_MS));
      await held(trx, o, new Date(NOW.getTime() + 10 * MINUTE_MS), "smtp_421");

      await runAt(trx, NOW);
      expect(await rows(trx, o.orgId, "send_held")).toEqual([]);
    });
  });

  test("a hold with an unknown limit text skips with one warn line per run, no text in it", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await held(trx, o, new Date(NOW.getTime() + 10 * MINUTE_MS), "send_limit:123456:MARKER-LIMIT");

      await runAt(trx, NOW);
      expect(await rows(trx, o.orgId, "send_held")).toEqual([]);
      const lines = errorLines.filter((line) => line.includes(`item_id=${o.mailboxId}`));
      expect(lines).toEqual([
        `[channels] notice_skipped kind=send_held item_id=${o.mailboxId} reason=unknown_send_limit`,
      ]);
      expect(errorLines.join("\n")).not.toContain("MARKER-LIMIT");
    });
  });

  test("(6) the holds of one organization are not listed for another", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await org(trx);
      const b = await org(trx);
      await held(trx, a, new Date(NOW.getTime() + 10 * MINUTE_MS));

      expect(await listSendLimitHolds(trx, b.ctx, NOW)).toEqual([]);
      expect(await listSendLimitHolds(trx, a.ctx, NOW)).toEqual([
        {
          mailboxId: a.mailboxId,
          waiting: 1,
          nextAt: new Date(NOW.getTime() + 10 * MINUTE_MS),
          lastError: LIMIT_ERROR,
        },
      ]);
    });
  });

  test("the limit text comes from the send that goes out first", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await held(trx, o, new Date(NOW.getTime() + 30 * MINUTE_MS), "send_limit:mailbox_day");
      await held(trx, o, new Date(NOW.getTime() + 10 * MINUTE_MS), "send_limit:recipient_day");

      expect(await listSendLimitHolds(trx, o.ctx, NOW)).toMatchObject([
        { waiting: 2, nextAt: new Date(NOW.getTime() + 10 * MINUTE_MS), lastError: "send_limit:recipient_day" },
      ]);
    });
  });

  test("(8) a pending row becomes outdated when the holds end; a paused mailbox gets no row", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      const p = await held(trx, o, new Date(NOW.getTime() + 10 * MINUTE_MS));
      await runAt(trx, NOW);
      expect((await rows(trx, o.orgId, "send_held")).map((row) => row.status)).toEqual(["pending"]);

      await trx
        .updateTable("actions")
        .set({ next_attempt_at: new Date(NOW.getTime() - MINUTE_MS) })
        .where("id", "=", p.sendId)
        .execute();
      await runAt(trx, NOW);
      expect(await rows(trx, o.orgId, "send_held")).toMatchObject([{ status: "failed", error_code: "outdated" }]);

      const paused = await org(trx);
      await held(trx, paused, new Date(NOW.getTime() + 10 * MINUTE_MS));
      await setStatus(trx, paused, "paused");
      await runAt(trx, NOW);
      expect(await rows(trx, paused.orgId, "send_held")).toEqual([]);
    });
  });
});

describe("delegation answered notices", () => {
  async function answered(trx: Transaction<DB>, o: Org, opts: { withAnswerMail: boolean }) {
    const p = await waiting(trx, o, { sendStatus: "applied", approved: { userId: o.ownerId, at: at(-3 * HOUR_MS) } });
    await trx.updateTable("actions").set({ result_notified_at: T }).where("id", "=", p.sendId).execute();
    const delegationId = await insertDelegation(trx, o.ctx, {
      mailboxId: o.mailboxId,
      emailId: p.emailId,
      delegateId: p.delegateId as string,
      draftActionId: p.draftId,
      sendActionId: p.sendId,
      status: "answered",
      answeredAt: at(-5 * MINUTE_MS),
    });
    if (opts.withAnswerMail) {
      const answerId = await insertTestEmail(trx, o.ctx, o.mailboxId, { received_at: at(-10 * MINUTE_MS) });
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
