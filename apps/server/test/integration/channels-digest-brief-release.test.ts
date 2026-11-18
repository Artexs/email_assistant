// The marks of a digest that no sender delivered go back, on every path that ends it.
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { sentSwitchHooks } from "../../src/composition";
import {
  cancelPendingOutboxOfOrg,
  createOutboxSender,
  releaseMarksOfUndeliveredDigests,
} from "../../src/modules/channels";
import { createFakeChannel } from "../../src/modules/channels/fake/channel";
import { setSentSync } from "../../src/modules/mail";
import { eraseManyMailOutbox } from "../../src/modules/privacy";
import { blankDigestsNamingLoops } from "../../src/modules/privacy/outbox";
import type { DB } from "../../src/platform/db";

import {
  EIGHT,
  loopRow,
  ready,
  runDigests,
  SIXTEEN,
  waitingLoop,
  type BriefOrg,
} from "./channels-digest-brief-fixtures";
import { testDb, withRollback } from "./helpers";
import { FRIDAY } from "./loops-commands-fixtures";
import { insertLoopRow } from "./loops-fixtures";
import { siblingMailbox } from "./mail-sent-fixtures";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const staleLoop = (trx: Transaction<DB>, org: BriefOrg, mailboxId = org.mailboxId) =>
  insertLoopRow(trx, org.ctx, mailboxId, {
    status: "closed",
    close_reason: "stale",
    closed_at: new Date("2026-11-19T10:00:00Z"),
    subject: "STALE-SUBJECT",
    due_at: new Date("2026-10-01T10:00:00Z"),
  });

const failAll = async (trx: Transaction<DB>, org: BriefOrg, at: string): Promise<void> => {
  await trx.deleteFrom("chat_links").where("org_id", "=", org.ctx.orgId).execute();
  await createOutboxSender({ db: trx, channel: createFakeChannel(), now: () => new Date(at) }).run();
};

const relink = (trx: Transaction<DB>, org: BriefOrg) =>
  trx
    .insertInto("chat_links")
    .values({
      org_id: org.ctx.orgId,
      user_id: org.userId,
      channel: "telegram",
      external_chat_id: org.chatId,
      linked_at: new Date("2026-11-05T20:00:00Z"),
    })
    .execute();

describe("TG1 the suspend hook", () => {
  test("a pending digest ends failed when the organization is suspended: its marks go back", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const waiting = await waitingLoop(trx, org);
      const stale = await staleLoop(trx, org);
      await runDigests(trx, EIGHT);
      expect((await loopRow(trx, waiting)).surfaced_at).toEqual(new Date(EIGHT));
      expect((await loopRow(trx, stale)).stale_notified_at).toEqual(new Date(EIGHT));
      expect(await cancelPendingOutboxOfOrg(trx, org.ctx)).toBeGreaterThanOrEqual(1);
      expect((await loopRow(trx, waiting)).surfaced_at).toBeNull();
      expect((await loopRow(trx, stale)).stale_notified_at).toBeNull();
    });
  });
});

describe("TG4 a failed digest does not hold the marks of the next one", () => {
  test("digest A fails, digest B names the same loop and fails too: the marks of B go back", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const stale = await staleLoop(trx, org);
      await runDigests(trx, EIGHT);
      await failAll(trx, org, EIGHT);
      expect((await loopRow(trx, stale)).stale_notified_at).toBeNull();
      await relink(trx, org);
      await runDigests(trx, SIXTEEN);
      expect((await loopRow(trx, stale)).stale_notified_at).toEqual(new Date(SIXTEEN));
      await failAll(trx, org, SIXTEEN);
      const statuses = await trx.selectFrom("outbox").select("status").where("org_id", "=", org.ctx.orgId).execute();
      expect(statuses.map((row) => row.status)).toEqual(["failed", "failed"]);
      // A failed digest A (the older one) also names the loop: it must not count as a digest that still shows it.
      expect((await loopRow(trx, stale)).stale_notified_at).toBeNull();
    });
  });
});

describe("N1 the paths that blank or delete a pending digest give back the marks of the loops that stay", () => {
  test("the Sent switch off on mailbox A: the loop of mailbox B is named again by the next digest; the cleared loop keeps its mark", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const sibling = await siblingMailbox(trx, org);
      const a = await waitingLoop(trx, org);
      const b = await waitingLoop(trx, org, { mailbox_id: sibling.mailboxId });
      const staleB = await staleLoop(trx, org, sibling.mailboxId);
      await runDigests(trx, EIGHT);
      expect((await loopRow(trx, b)).surfaced_at).toEqual(new Date(EIGHT));
      await setSentSync(trx, org.ctx, org.mailboxId, { enabled: false, actor: "test", at: FRIDAY }, sentSwitchHooks);
      const digest = await trx
        .selectFrom("outbox")
        .select(["status", "error_code", "view"])
        .where("org_id", "=", org.ctx.orgId)
        .executeTakeFirstOrThrow();
      expect([digest.status, digest.error_code, JSON.stringify(digest.view)]).toEqual(["failed", "outdated", "{}"]);
      expect((await loopRow(trx, b)).surfaced_at).toBeNull();
      expect((await loopRow(trx, staleB)).stale_notified_at).toBeNull();
      expect((await loopRow(trx, a)).surfaced_at).toEqual(new Date(EIGHT));
    });
  });

  test("the erase of a person (blankDigestsNamingLoops): a pending digest is deleted, the marks of its other loops go back; a delivered digest keeps them", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const erased = await waitingLoop(trx, org);
      const kept = await waitingLoop(trx, org);
      await runDigests(trx, EIGHT);
      const counts = await blankDigestsNamingLoops(trx, org.ctx.orgId, [erased]);
      expect(counts).toEqual({ blanked: 0, dropped: 1 });
      expect((await loopRow(trx, kept)).surfaced_at).toBeNull();
      expect((await loopRow(trx, erased)).surfaced_at).toEqual(new Date(EIGHT));
    });
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const erased = await waitingLoop(trx, org);
      const kept = await waitingLoop(trx, org);
      await runDigests(trx, EIGHT);
      await createOutboxSender({ db: trx, channel: createFakeChannel(), now: () => new Date(EIGHT) }).run();
      expect(await blankDigestsNamingLoops(trx, org.ctx.orgId, [erased])).toEqual({ blanked: 1, dropped: 0 });
      expect((await loopRow(trx, kept)).surfaced_at).toEqual(new Date(EIGHT));
    });
  });

  test("a digest that was delivered (sent) keeps the marks of its loops: the release reads pending and sending rows only", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const loop = await waitingLoop(trx, org);
      await runDigests(trx, EIGHT);
      await createOutboxSender({ db: trx, channel: createFakeChannel(), now: () => new Date(EIGHT) }).run();
      const row = await trx
        .selectFrom("outbox")
        .select("status")
        .where("org_id", "=", org.ctx.orgId)
        .executeTakeFirstOrThrow();
      expect(row.status).toBe("sent");
      await releaseMarksOfUndeliveredDigests(trx, org.ctx, { named: [loop] });
      await releaseMarksOfUndeliveredDigests(trx, org.ctx, { since: new Date("2026-11-01T00:00:00Z") });
      expect((await loopRow(trx, loop)).surfaced_at).toEqual(new Date(EIGHT));
    });
  });

  test("the erase of a mail (eraseManyMailOutbox): the pending digest is deleted and its loops are named again", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const loop = await waitingLoop(trx, org);
      const stale = await staleLoop(trx, org);
      await runDigests(trx, EIGHT);
      const counts = await eraseManyMailOutbox(trx, org.ctx.orgId, {
        mailIds: ["0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"],
        earliestCreatedAt: new Date("2026-11-01T00:00:00Z"),
      });
      expect(counts.outbox_dropped).toBe(1);
      expect((await loopRow(trx, loop)).surfaced_at).toBeNull();
      expect((await loopRow(trx, stale)).stale_notified_at).toBeNull();
    });
  });
});
