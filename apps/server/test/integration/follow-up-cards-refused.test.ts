// A follow-up card that the renderer refuses is not tried again at every run, so 50 of them do not hold
// back newer cards. Every test runs in a transaction that is rolled back.
import { MINUTE_MS, HOUR_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { detectNotices } from "../../src/modules/channels";
import { forgetRefusedCards } from "../../src/modules/channels/notices/approval";
import { APPROVAL_LIMIT } from "../../src/modules/channels/notices/run";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { markSynced } from "../../src/modules/mail/repo";
import { setOrgFeature } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox, isolateChannels, linkChat, randomChatId } from "./fixtures";
import { CURRENT_CONSENT, consentRow, insertFollowUp } from "./follow-up-fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();
afterAll(async () => {
  await db.destroy();
});

const T = new Date("2026-11-20T10:00:00Z");
const at = (ms: number) => new Date(T.getTime() + ms);
const LIMIT = APPROVAL_LIMIT;

// The notice code warns about rows it skips; the test keeps the output quiet.
let spies: ReturnType<typeof spyOn>[] = [];
beforeEach(() => {
  forgetRefusedCards();
  spies = [
    spyOn(console, "log").mockImplementation((): void => undefined),
    spyOn(console, "error").mockImplementation((): void => undefined),
    spyOn(console, "warn").mockImplementation((): void => undefined),
  ];
});
afterEach(() => {
  for (const spy of spies) spy.mockRestore();
  forgetRefusedCards();
});

// One organization with one owner who has a chat and the current consent: every follow-up card goes to this owner.
async function world(trx: Transaction<DB>) {
  await isolateChannels(trx);
  const created = await createOrgWithMailbox(trx);
  const ctx = { orgId: created.orgId };
  await markSynced(trx, ctx, created.mailboxId, at(-5 * MINUTE_MS));
  await trx
    .updateTable("mailboxes")
    .set({ status_changed_at: at(-HOUR_MS) })
    .where("id", "=", created.mailboxId)
    .execute();
  await linkChat(trx, ctx, created.userId, randomChatId(), at(-2 * HOUR_MS));
  await consentRow(trx, created.orgId, created.userId, CURRENT_CONSENT, at(-HOUR_MS));
  await setOrgFeature(trx, ctx, { flag: "approvals_page", enabled: true, actor: "cli", now: T });
  return { ctx, orgId: created.orgId, mailboxId: created.mailboxId, owner: created.userId };
}

async function run(trx: Transaction<DB>): Promise<void> {
  await detectNotices({
    db: trx,
    now: () => T,
    startedAt: at(-HOUR_MS),
    testMail: NO_TEST_SENDERS,
    webBaseUrl: "https://panel.example.test",
  });
}

const cardSendIds = async (trx: Transaction<DB>, orgId: string): Promise<string[]> =>
  (
    await trx
      .selectFrom("outbox")
      .select("dedup_key")
      .where("org_id", "=", orgId)
      .where("kind", "=", "approval")
      .execute()
  ).map((row) => row.dedup_key.replace("approval:", ""));

describe("N5 refused follow-up cards", () => {
  test("a list of refused cards as long as the limit does not hold back a newer card: the next run reaches it", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const long = Array.from({ length: 10 }, (_, i) => `${"x".repeat(240)}${i}@example.test`);
      // The refused ones are older than the good one, and as many as one run lists.
      const refused: string[] = [];
      for (let i = 0; i < LIMIT; i += 1) {
        const made = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {
          to: long.slice(0, 5),
          cc: long.slice(5),
          createdAt: at(-3 * HOUR_MS + i * 1000),
        });
        refused.push(made.sendId);
      }
      const good = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, { createdAt: at(-HOUR_MS) });

      // Run 1 lists the 50 refused rows and no card goes out.
      await run(trx);
      expect(await cardSendIds(trx, w.orgId)).toEqual([]);
      // Run 2 does not list them again: the good card is queued, and the refused ones stay unnotified for the panel.
      await run(trx);
      expect(await cardSendIds(trx, w.orgId)).toEqual([good.sendId]);
      const unnotified = await trx
        .selectFrom("actions")
        .select("id")
        .where("id", "in", refused)
        .where("notified_at", "is", null)
        .execute();
      expect(unnotified).toHaveLength(LIMIT);
    });
  });

  test("a refused card and a good card of one run: the good one is queued once, however many runs follow", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const long = Array.from({ length: 10 }, (_, i) => `${"y".repeat(240)}${i}@example.test`);
      await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, { to: long.slice(0, 5), cc: long.slice(5) });
      const good = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {});
      await run(trx);
      await run(trx);
      expect(await cardSendIds(trx, w.orgId)).toEqual([good.sendId]);
    });
  });

  test("an error that is no refusal is not remembered: after the data is repaired the next run queues the card", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      // The draft names another loop than its send: an ordinary error, not a refusal of the renderer.
      const broken = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {
        draft: { loop_id: "0190f5a0-0000-7000-8000-00000000dead" },
      });
      await run(trx);
      expect(await cardSendIds(trx, w.orgId)).toEqual([]);
      await trx
        .updateTable("actions")
        .set({ payload: sql`jsonb_set(payload, '{loop_id}', to_jsonb(${broken.loopId}::text))` })
        .where("id", "=", broken.draftId)
        .execute();
      await run(trx);
      expect(await cardSendIds(trx, w.orgId)).toEqual([broken.sendId]);
    });
  });
});
