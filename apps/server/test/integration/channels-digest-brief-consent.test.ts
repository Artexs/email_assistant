// The consent of the member in the brief: counts and one ask for a member whom the consent does not cover.

import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import type { DB } from "../../src/platform/db";

import {
  briefOrg,
  digestTexts,
  EIGHT,
  ready,
  runDigests,
  SIXTEEN,
  waitingLoop,
  type BriefOrg,
} from "./channels-digest-brief-fixtures";
import { insertTriaged, isolateChannels } from "./fixtures";
import { consentRow, unlinkRow } from "./follow-up-fixtures";
import { testDb, withRollback } from "./helpers";
import { insertLoopRow } from "./loops-fixtures";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("the consent of the member (D17, review 17 N4, N5)", () => {
  async function covered(trx: Transaction<DB>, opts: Parameters<typeof briefOrg>[1]) {
    const org = await ready(trx, opts);
    await waitingLoop(trx, org);
    await insertLoopRow(trx, org.ctx, org.mailboxId, {
      kind: "promised",
      text: "PROMISE-TEXT",
      counterpart: "promise@example.test",
      due_at: new Date("2026-11-20T10:00:00Z"),
    });
    await insertLoopRow(trx, org.ctx, org.mailboxId, {
      status: "closed",
      close_reason: "stale",
      closed_at: new Date("2026-11-19T10:00:00Z"),
      subject: "STALE-SUBJECT",
      due_at: new Date("2026-10-01T10:00:00Z"),
    });
    await insertTriaged(trx, org.ctx, org.mailboxId, {
      category: "needs_reply",
      createdAt: new Date("2026-11-18T05:00:00Z"),
      subject: "REPLY-MAIL",
      from: "x@x.test",
    });
    await runDigests(trx, EIGHT);
    return { org, text: (await digestTexts(trx, org.ctx.orgId))[0] ?? "" };
  }

  test("a member with no consent row: counts and the ask; no address, no loop subject, no loop text; mail lines show; nothing is marked", async () => {
    await withRollback(db, async (trx) => {
      const { org, text } = await covered(trx, { consent: false });
      expect(text).toContain("⏳ Waiting on others: 1");
      expect(text).toContain("🤝 Promised: 1");
      expect(text).toContain("⌛ Closed without an answer: 1");
      expect(text).toContain("Confirm the new Telegram terms in the panel to see them here.");
      for (const secret of [
        "anna@example.test",
        "promise@example.test",
        "Offer for Q1",
        "send the offer",
        "PROMISE-TEXT",
        "STALE-SUBJECT",
      ])
        expect(text).not.toContain(secret);
      expect(text).toContain("REPLY-MAIL");
      const loops = await trx
        .selectFrom("open_loops")
        .select(["surfaced_at", "stale_notified_at"])
        .where("org_id", "=", org.ctx.orgId)
        .execute();
      expect(loops.every((row) => row.surfaced_at === null && row.stale_notified_at === null)).toBe(true);
      const view = (
        await trx.selectFrom("outbox").select("view").where("org_id", "=", org.ctx.orgId).executeTakeFirstOrThrow()
      ).view as { loopIds?: string[] };
      expect(view.loopIds).toBeUndefined();
    });
  });

  test("an old consent version, a garbage version and an unlink after the consent are not covered; a newer consent is", async () => {
    for (const make of [
      (trx: Transaction<DB>, org: BriefOrg) =>
        consentRow(trx, org.ctx.orgId, org.userId, "2026-11-15", new Date("2026-11-06T00:00:00Z")),
      (trx: Transaction<DB>, org: BriefOrg) =>
        consentRow(trx, org.ctx.orgId, org.userId, "garbage", new Date("2026-11-06T00:00:00Z")),
      (trx: Transaction<DB>, org: BriefOrg) =>
        unlinkRow(trx, org.ctx.orgId, org.userId, new Date("2026-11-19T00:00:00Z")),
    ]) {
      await withRollback(db, async (trx) => {
        await isolateChannels(trx);
        const org = await briefOrg(trx, { consent: false });
        await make(trx, org);
        await waitingLoop(trx, org);
        await runDigests(trx, EIGHT);
        const text = (await digestTexts(trx, org.ctx.orgId))[0] ?? "";
        expect(text).toContain("Confirm the new Telegram terms in the panel");
        expect(text).not.toContain("anna@example.test");
      });
    }
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const org = await briefOrg(trx, { consent: false });
      await unlinkRow(trx, org.ctx.orgId, org.userId, new Date("2026-11-06T00:00:00Z"));
      await consentRow(trx, org.ctx.orgId, org.userId, "2026-11-15.2", new Date("2026-11-07T00:00:00Z"));
      await waitingLoop(trx, org);
      await runDigests(trx, EIGHT);
      expect((await digestTexts(trx, org.ctx.orgId))[0]).toContain("anna@example.test");
    });
  });

  test("a covered member gets the lines; the later digest of an uncovered member still gets the counts only", async () => {
    await withRollback(db, async (trx) => {
      const { text } = await covered(trx, {});
      expect(text).toContain("anna@example.test");
      expect(text).not.toContain("Confirm the new Telegram terms");
    });
    await withRollback(db, async (trx) => {
      const org = await ready(trx, { consent: false });
      await waitingLoop(trx, org);
      await runDigests(trx, EIGHT);
      await runDigests(trx, SIXTEEN);
      expect((await digestTexts(trx, org.ctx.orgId))[1]?.split("\n").at(-1)).toBe("🔁 Open loops: 1 waiting");
    });
  });
});
