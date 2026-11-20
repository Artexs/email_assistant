// The guards under the brief: the flag, the marks that keep their first time, the logs and the audit rows, and the local day.
import { format } from "node:util";

import { DAY_MS } from "@ea/core";
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { isFirstDigestOfDay } from "../../src/modules/channels";
import { markBriefShown } from "../../src/modules/loops";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { buildDigest } from "../../src/modules/reports";
import type { DB } from "../../src/platform/db";

import {
  briefOrg,
  digestTexts,
  EIGHT,
  loopRow,
  ready,
  runDigests,
  waitingLoop,
  type BriefOrg,
} from "./channels-digest-brief-fixtures";
import {} from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { insertLoopRow } from "./loops-fixtures";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("the guards under the brief", () => {
  const request = (over: object = {}) => ({
    kind: "scheduled" as const,
    periodStart: new Date("2026-11-19T00:00:00Z"),
    periodEnd: new Date(EIGHT),
    slot: { date: "2026-11-20", time: "08:00", late: false },
    now: new Date(EIGHT),
    locale: "en" as const,
    role: "owner" as const,
    testMail: NO_TEST_SENDERS,
    ...over,
  });

  test("the builder decides on the flag itself: a caller that asks for the brief of an organization with the flag off gets today's digest", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx, { loopsFlag: false });
      await waitingLoop(trx, org);
      const built = await buildDigest(trx, org.ctx, request({ loops: { firstOfDay: true, loopConsent: true } }));
      expect(built.message.text).not.toContain("NEEDS YOU TODAY");
      expect(built.message.text).not.toContain("anna@example.test");
      expect(built.shown).toEqual({ surfaced: [], stale: [], lineOf: {} });
      const on = await ready(trx);
      await waitingLoop(trx, on);
      const shown = await buildDigest(trx, on.ctx, request({ loops: { firstOfDay: true, loopConsent: true } }));
      expect(shown.message.text).toContain("NEEDS YOU TODAY");
      // The digest on demand has no loop part: no brief even with the flag on.
      expect((await buildDigest(trx, on.ctx, request({ kind: "on_demand", slot: null }))).message.text).not.toContain(
        "NEEDS YOU TODAY"
      );
    });
  });

  test("markBriefShown keeps the first time of each mark and marks a stale line only on a closed loop", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const open = await waitingLoop(trx, org);
      const stale = await insertLoopRow(trx, org.ctx, org.mailboxId, {
        status: "closed",
        close_reason: "stale",
        closed_at: new Date("2026-11-19T10:00:00Z"),
      });
      const first = new Date("2026-11-20T07:00:00Z");
      const second = new Date("2026-11-20T15:00:00Z");
      await markBriefShown(trx, org.ctx, { surfaced: [open], stale: [stale], at: first });
      await markBriefShown(trx, org.ctx, { surfaced: [open], stale: [stale], at: second });
      expect((await loopRow(trx, open)).surfaced_at?.toISOString()).toBe(first.toISOString());
      expect((await loopRow(trx, stale)).stale_notified_at?.toISOString()).toBe(first.toISOString());
      // An open loop is never marked as a stale line, and another organization's loop is never marked.
      const other = await briefOrg(trx);
      const foreign = await waitingLoop(trx, other);
      await markBriefShown(trx, org.ctx, { surfaced: [foreign], stale: [open, foreign], at: second });
      expect((await loopRow(trx, open)).stale_notified_at).toBeNull();
      expect((await loopRow(trx, foreign)).surfaced_at).toBeNull();
      expect((await loopRow(trx, foreign)).stale_notified_at).toBeNull();
    });
  });
});

describe("logs and audit rows", () => {
  test("the digest job logs ids and codes only: no address, subject or ask of a loop, in a log line or an audit row", async () => {
    const lines: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(format(...args));
    });
    const errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      lines.push(format(...args));
    });
    try {
      await withRollback(db, async (trx) => {
        const org = await ready(trx);
        const marks = ["LOGMARK-ADDRESS@example.test", "LOGMARK-SUBJECT", "LOGMARK-ASK"];
        await waitingLoop(trx, org, {
          counterpart: marks[0],
          to_addresses: [marks[0] ?? ""],
          subject: marks[1],
          text: marks[2],
        });
        await insertLoopRow(trx, org.ctx, org.mailboxId, {
          status: "closed",
          close_reason: "stale",
          closed_at: new Date("2026-11-19T10:00:00Z"),
          subject: "LOGMARK-STALE",
        });
        await runDigests(trx, EIGHT);
        const [text = ""] = await digestTexts(trx, org.ctx.orgId);
        expect(text).toContain("LOGMARK-ASK");
        expect(lines.some((line) => line.includes("digest_queued"))).toBe(true);
        for (const mark of [...marks, "LOGMARK-STALE"]) expect(lines.join("\n")).not.toContain(mark);
        const audit = await trx
          .selectFrom("audit_log")
          .select(["event", "data"])
          .where("org_id", "=", org.ctx.orgId)
          .execute();
        expect(JSON.stringify(audit)).not.toContain("LOGMARK");
      });
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe("the local day of the member", () => {
  async function queued(trx: Transaction<DB>, org: BriefOrg, slot: string, at: string): Promise<void> {
    const digest = await trx
      .insertInto("digests")
      .values({
        org_id: org.ctx.orgId,
        user_id: org.userId,
        slot_key: slot,
        period_start: new Date(Date.parse(at) - DAY_MS),
        period_end: new Date(at),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("outbox")
      .values({
        org_id: org.ctx.orgId,
        user_id: org.userId,
        kind: "digest",
        dedup_key: `digest:${slot}`,
        digest_id: digest.id,
        view: JSON.stringify({ text: "x", buttons: [] }),
        buttons: "[]",
        created_at: new Date(at),
        next_attempt_at: new Date(at),
      })
      .execute();
  }
  // The day is the date of the slot, not the clock time at which the job runs.
  const first = (trx: Transaction<DB>, org: BriefOrg, slotDate: string) =>
    isFirstDigestOfDay(trx, org.ctx, { userId: org.userId, slotDate });

  test("the day is the date of the slot: a 23:30 slot and the 00:30 slot of the next date are two days, in winter and summer time", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      await queued(trx, org, "2026-11-20T23:30", "2026-11-20T22:30:00Z");
      expect(await first(trx, org, "2026-11-20")).toBe(false);
      expect(await first(trx, org, "2026-11-21")).toBe(true);
      await queued(trx, org, "2026-07-10T23:30", "2026-07-10T21:30:00Z");
      expect(await first(trx, org, "2026-07-10")).toBe(false);
      expect(await first(trx, org, "2026-07-11")).toBe(true);
    });
  });

  test("a late run does not change the day: the 20:00 slot that runs at 01:00 of the next date is not the first digest of its day", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      await queued(trx, org, "2026-11-20T08:00", "2026-11-20T07:00:00Z");
      // The job runs at 2026-11-21 01:00 local: the slot key keeps the date of the slot, 2026-11-20.
      expect(await first(trx, org, "2026-11-20")).toBe(false);
    });
  });

  test("the day of the change back to winter time has 25 hours: a digest of the 00:30 slot and the 23:45 slot are the same day", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      await queued(trx, org, "2026-10-25T00:30", "2026-10-24T22:30:00Z");
      expect(await first(trx, org, "2026-10-25")).toBe(false);
      expect(await first(trx, org, "2026-10-26")).toBe(true);
    });
  });

  test("a digest of a failed row and a row of another organization do not count", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const other = await briefOrg(trx);
      await queued(trx, other, "2026-11-20T08:00", "2026-11-20T07:00:00Z");
      await queued(trx, org, "2026-11-20T08:00", "2026-11-20T07:00:00Z");
      await trx
        .updateTable("outbox")
        .set({ status: "failed", error_code: "blocked" })
        .where("org_id", "=", org.ctx.orgId)
        .execute();
      expect(await first(trx, org, "2026-11-20")).toBe(true);
      await trx
        .updateTable("outbox")
        .set({ status: "sent", error_code: null, sent_at: new Date("2026-11-20T07:00:05Z") })
        .where("org_id", "=", org.ctx.orgId)
        .execute();
      expect(await first(trx, org, "2026-11-20")).toBe(false);
    });
  });
});
