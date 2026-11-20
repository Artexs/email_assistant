import { textTables, MINUTE_MS, HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { sentSwitchHooks } from "../../src/composition";
import { createOutboxSender, detectNotices } from "../../src/modules/channels";
import { createFakeChannel } from "../../src/modules/channels/fake/channel";
import { NO_TEST_SENDERS, setSentSync } from "../../src/modules/mail";
import { markSynced } from "../../src/modules/mail/repo";
import { setOrgFeature } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";

import { isolateChannels, linkChat, randomChatId } from "./fixtures";
import { CURRENT_CONSENT, consentRow, insertFollowUp } from "./follow-up-fixtures";
import { testDb, withRollback } from "./helpers";
import { commandOrg, type CommandOrg } from "./loops-commands-fixtures";

// A follow-up card that Telegram already delivered keeps its Send and Reject buttons when
// "Track my sent mail" goes off. The send is `expired`, so a tap is refused, but the buttons stay. The switch off queues one
// edit with a fixed text of ours as the original: no quote, no address, no subject.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const T = new Date("2026-11-20T10:00:00Z");
const QUOTE = "QUOTE-card-edit-7f3a";
const TO = "to-card-edit-7f3a@sent.example.test";
const CC = "cc-card-edit-7f3a@sent.example.test";
const SUBJECT = "SUBJECT-card-edit-7f3a";
const PLANTED = [QUOTE, TO, CC, SUBJECT];

async function world(trx: Transaction<DB>, locale: "en" | "pl" = "en") {
  await isolateChannels(trx);
  const org: CommandOrg = await commandOrg(trx);
  await markSynced(trx, org.ctx, org.mailboxId, new Date(T.getTime() - 5 * MINUTE_MS));
  await trx.updateTable("users").set({ locale }).where("id", "=", org.userId).execute();
  await linkChat(trx, org.ctx, org.userId, randomChatId(), new Date(T.getTime() - 2 * HOUR_MS));
  await consentRow(trx, org.ctx.orgId, org.userId, CURRENT_CONSENT, new Date(T.getTime() - HOUR_MS));
  await setOrgFeature(trx, org.ctx, { flag: "approvals_page", enabled: true, actor: "cli", now: T });
  const f = await insertFollowUp(trx, org.ctx, org.mailboxId, org.userId, {
    to: [TO],
    cc: [CC],
    subject: SUBJECT,
    quote: QUOTE,
    notifiedAt: null,
  });
  return { org, f };
}

const notify = (trx: Transaction<DB>, when: Date) =>
  detectNotices({ db: trx, now: () => when, startedAt: new Date(when.getTime() - HOUR_MS), testMail: NO_TEST_SENDERS });

const edits = (trx: Transaction<DB>, orgId: string) =>
  trx
    .selectFrom("outbox")
    .select(["id", "status", "text", "view", "edit_of_outbox_id", "dedup_key", "loop_id", "locale"])
    .where("org_id", "=", orgId)
    .where("kind", "=", "approval_edit")
    .orderBy("created_at")
    .execute();

async function deliver(trx: Transaction<DB>, when: Date) {
  const channel = createFakeChannel();
  const sender = createOutboxSender({ db: trx, channel, now: () => when });
  await sender.run();
  return { channel, sender };
}

describe("the switch off edits a delivered follow-up card", () => {
  test("one edit with a fixed text and no mail data; detectNotices adds none; the sender edits the message and drops the buttons", async () => {
    await withRollback(db, async (trx) => {
      const { org, f } = await world(trx);
      await notify(trx, T);
      const first = await deliver(trx, T);
      expect(first.channel.sent).toHaveLength(1);
      const card = first.channel.sent[0];
      expect(card?.message.buttons.flat().length).toBeGreaterThan(0);

      const later = new Date(T.getTime() + HOUR_MS);
      await setSentSync(trx, org.ctx, org.mailboxId, { enabled: false, actor: "test", at: later }, sentSwitchHooks);

      const send = await trx
        .selectFrom("actions")
        .select(["status", "status_reason"])
        .where("id", "=", f.sendId)
        .executeTakeFirstOrThrow();
      expect(send).toEqual({ status: "expired", status_reason: "loop_closed" });

      const rows = await edits(trx, org.ctx.orgId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: "pending", loop_id: f.loopId, locale: "en" });
      expect(JSON.stringify(rows[0]?.view)).toContain(textTables.en.approvals.followUpRemoved);
      for (const value of PLANTED) expect(JSON.stringify(rows)).not.toContain(value);

      // The detector finds no closed follow-up with text to edit: the blank card is not listed, the edit is not queued twice.
      await notify(trx, later);
      expect(await edits(trx, org.ctx.orgId)).toHaveLength(1);

      const second = await deliver(trx, new Date(later.getTime() + MINUTE_MS));
      expect(second.channel.edited).toHaveLength(1);
      const edit = second.channel.edited[0];
      expect(edit?.messageId).toBe(card?.messageId ?? -1);
      expect(edit?.message.buttons.flat()).toEqual([]);
      expect(edit?.message.text).toContain(textTables.en.approvals.followUpRemoved);
      for (const value of PLANTED) expect(edit?.message.text).not.toContain(value);
      expect((await edits(trx, org.ctx.orgId))[0]?.status).toBe("sent");
    });
  });

  test("the fixed text follows the locale of the card owner (Polish)", async () => {
    await withRollback(db, async (trx) => {
      const { org } = await world(trx, "pl");
      await notify(trx, T);
      await deliver(trx, T);
      await setSentSync(trx, org.ctx, org.mailboxId, { enabled: false, actor: "test", at: T }, sentSwitchHooks);
      const rows = await edits(trx, org.ctx.orgId);
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows[0]?.view)).toContain(textTables.pl.approvals.followUpRemoved);
      expect(rows[0]?.locale).toBe("pl");
    });
  });

  test("a card that no sender delivered gets no edit: it ends failed / outdated", async () => {
    await withRollback(db, async (trx) => {
      const { org } = await world(trx);
      await notify(trx, T);
      await setSentSync(trx, org.ctx, org.mailboxId, { enabled: false, actor: "test", at: T }, sentSwitchHooks);
      expect(await edits(trx, org.ctx.orgId)).toEqual([]);
      const card = await trx
        .selectFrom("outbox")
        .select(["status", "error_code"])
        .where("org_id", "=", org.ctx.orgId)
        .where("kind", "=", "approval")
        .executeTakeFirstOrThrow();
      expect(card).toEqual({ status: "failed", error_code: "outdated" });
    });
  });

  test("a card of a send that went out (applied) gets no removal edit", async () => {
    await withRollback(db, async (trx) => {
      const { org, f } = await world(trx);
      await notify(trx, T);
      await deliver(trx, T);
      await trx
        .updateTable("actions")
        .set({ status: "applied", applied_at: T, approved_at: T, approved_by: org.userId, approved_via: "telegram" })
        .where("id", "=", f.sendId)
        .execute();
      await setSentSync(trx, org.ctx, org.mailboxId, { enabled: false, actor: "test", at: T }, sentSwitchHooks);
      expect(await edits(trx, org.ctx.orgId)).toEqual([]);
    });
  });
});
