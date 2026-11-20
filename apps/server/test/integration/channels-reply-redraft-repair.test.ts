import { textTables, HOUR_MS, MINUTE_MS, DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { handleCallback } from "../../src/modules/channels";
import { handleReplyText } from "../../src/modules/channels/reply-redraft";
import { findReplyTargetOfMessage } from "../../src/modules/channels/repo";
import { clearReplyTexts, redraftReply } from "../../src/modules/replies";
import { insertMembership } from "../../src/modules/tenancy/repo";
import type { DB } from "../../src/platform/db";

import { addMember, createOrgWithMailbox, insertTestEmail, linkChat, randomChatId, renderedOf } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { addReplyMail, draftedReply, NOW, requestsOf, setMailAddresses } from "./reply-job-fixtures";
import { cardOut, openSend, outboxOf, rig, type Rig } from "./reply-telegram-fixtures";

// The repair of the review of the Telegram redraft: a request is answered once and only when it ended now, the buttons follow
// the rules of the recipients, and a tap or a line of text finds only what belongs to its user and organization.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

// The state after a redraft: the card of version 1 went out, the user wrote a line, the job made version 2 and the card of it is queued.
async function redrafted(trx: Transaction<DB>, r: Rig) {
  const { emailId, sendId } = await draftedReply(trx, r.box, r.clock);
  const cardId = await cardOut(trx, r);
  expect((await handleReplyText(r.deps, r.owner, "say yes", cardId))?.text).toBe(
    textTables.en.bot.taps.reply.redraftQueued
  );
  await r.job();
  await r.detect();
  const second = await openSend(trx, r);
  expect(second?.id).not.toBe(sendId);
  return { emailId, sendId, secondId: second?.id as string };
}

const redraftRequests = async (trx: Transaction<DB>, r: Rig) =>
  (await requestsOf(trx, r.box)).filter((row) => row.trigger === "redraft");

describe("a request is answered once, and only when it ended now", () => {
  test("1. a redraft, its card, a reject, 91 days, retention and the detector: no `reply_result` row and no new card", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      const { secondId } = await redrafted(trx, r);
      expect((await handleCallback(r.deps, r.owner, `ar:${secondId}`)).answer).toBe(textTables.en.bot.taps.rejectedNow);
      const cardsBefore = (await outboxOf(trx, r, "approval")).length;

      // 91 days later by the clock of the job. The requests are moved to the real clock of this run, because retention writes the
      // clock of the database: the detector must read the end time of the request, not the time of the clearing.
      const realNow = new Date();
      const ended = new Date(realNow.getTime() - 91 * DAY_MS);
      await trx
        .updateTable("reply_requests")
        .set({ created_at: ended, updated_at: new Date(ended.getTime() + 3 * MINUTE_MS) })
        .where("org_id", "=", r.box.ctx.orgId)
        .execute();
      const cleared = await clearReplyTexts(trx, r.box.ctx, { before: new Date(realNow.getTime() - 90 * DAY_MS) });
      expect(cleared).toBeGreaterThanOrEqual(1);
      expect((await redraftRequests(trx, r))[0]?.instruction).toBeNull();
      r.clock.now = realNow;

      await r.detect();
      await r.detect();

      expect(await outboxOf(trx, r, "reply_result")).toEqual([]);
      expect(await outboxOf(trx, r, "approval")).toHaveLength(cardsBefore);
    });
  });

  test("2. a request of 91 days ago whose `updated_at` was touched now is no end of this window: no answer", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      const { secondId } = await redrafted(trx, r);
      await handleCallback(r.deps, r.owner, `ar:${secondId}`);
      // Something other than the drafter moved `updated_at` (an operator, a repair job).
      await trx
        .updateTable("reply_requests")
        .set({
          created_at: new Date(r.clock.now.getTime() - 91 * DAY_MS),
          updated_at: new Date(r.clock.now.getTime() + 30_000),
        })
        .where("org_id", "=", r.box.ctx.orgId)
        .execute();

      await r.detect();

      expect(await outboxOf(trx, r, "reply_result")).toEqual([]);
    });
  });

  test("3. a request that ended now and whose new send was rejected before the detector ran gets the closed line, no card", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      const { sendId } = await draftedReply(trx, r.box, r.clock);
      const cardId = await cardOut(trx, r);
      await handleReplyText(r.deps, r.owner, "say yes", cardId);
      await r.job();
      const second = await openSend(trx, r);
      expect(second?.id).not.toBe(sendId);
      await trx
        .updateTable("actions")
        .set({ status: "rejected" })
        .where("id", "=", second?.id as string)
        .execute();
      const cardsBefore = (await outboxOf(trx, r, "approval")).length;

      await r.detect();

      const [result] = await outboxOf(trx, r, "reply_result");
      expect(result?.view).toEqual({ emailId: expect.any(String), reason: "closed" });
      expect(renderedOf(result as never).text).toBe(textTables.en.notices.replyDrafts.results.closed);
      expect(await outboxOf(trx, r, "approval")).toHaveLength(cardsBefore);
    });
  });
});

describe("a redraft is refused when the mail changed", () => {
  test("4. a mail that became suspicious or answered after the draft was made: no redraft request", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      const { emailId, sendId } = await draftedReply(trx, r.box, r.clock);
      const ask = { db: trx, now: () => r.clock.now };
      const redraft = () =>
        redraftReply(ask, r.box.ctx, { userId: r.box.userId, via: "telegram", sendId, instruction: "say yes" });

      await trx
        .updateTable("triage_results")
        .set({ suspicious_reasons: ["reply_to_mismatch"] })
        .where("email_id", "=", emailId)
        .execute();
      expect(await redraft()).toEqual({ kind: "blocked", reason: "suspicious" });
      await trx.updateTable("triage_results").set({ suspicious_reasons: [] }).where("email_id", "=", emailId).execute();
      await trx
        .insertInto("email_flags")
        .values({
          email_id: emailId,
          org_id: r.box.ctx.orgId,
          answered: true,
          checked_at: NOW,
          seen: true,
          flagged: false,
        })
        .execute();
      expect(await redraft()).toEqual({ kind: "blocked", reason: "answered" });
      expect(await redraftRequests(trx, r)).toEqual([]);
    });
  });
});

describe("Draft reply on a mail whose draft was tapped", () => {
  test("5. a send that is approved or applying answers `sending`: no request, no card", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      const { emailId, sendId } = await draftedReply(trx, r.box, r.clock);
      const before = (await requestsOf(trx, r.box)).length;

      for (const status of ["approved", "applying"] as const) {
        await trx
          .updateTable("actions")
          .set({
            status,
            approved_by: r.box.userId,
            approved_at: NOW,
            approved_via: "telegram",
            ...(status === "applying" ? { locked_at: NOW } : {}),
          })
          .where("id", "=", sendId)
          .execute();
        expect(await handleCallback(r.deps, r.owner, `dr:${emailId}`), status).toEqual({
          answer: textTables.en.bot.taps.sending,
        });
      }
      expect((await requestsOf(trx, r.box)).length).toBe(before);
      expect(await outboxOf(trx, r, "approval")).toEqual([]);
    });
  });
});

describe("the buttons of the card follow the recipient rules", () => {
  const secondRow = async (trx: Transaction<DB>, r: Rig) =>
    renderedOf((await outboxOf(trx, r, "approval")).at(-1) as never).buttons[1]?.map((button) =>
      button.data.slice(0, 2)
    );

  test("6. Reply all shows for 10 other recipients and not for 11", async () => {
    for (const [count, expected] of [
      [10, ["rd", "ra"]],
      [11, ["rd"]],
    ] as const) {
      await withRollback(db, async (trx) => {
        const r = await rig(trx);
        const { emailId } = await draftedReply(trx, r.box, r.clock);
        await setMailAddresses(trx, emailId, {
          to: [r.box.address, ...Array.from({ length: count }, (_, index) => `p${index}@y.test`)],
        });
        await cardOut(trx, r);
        expect(await secondRow(trx, r), `${count} others`).toEqual([...expected]);
      });
    }
  });

  test("7. after Use Reply-To the new card does not offer Use Reply-To again, but still Reply all", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      const { emailId, sendId } = await draftedReply(trx, r.box, r.clock, { from: "anna@client.test" });
      await setMailAddresses(trx, emailId, { to: [r.box.address, "b@y.test"], replyTo: ["office@client.test"] });
      const cardId = await cardOut(trx, r);
      expect(await secondRow(trx, r)).toEqual(["rd", "ra", "ru"]);

      const tap = await handleCallback(r.deps, r.owner, `ru:${sendId}`, { messageId: cardId });

      expect(tap.answer).toBe(textTables.en.bot.taps.reply.recipientsDone);
      expect(await secondRow(trx, r)).toEqual(["rd", "ra"]);
    });
  });

  test("7b. the Reply-To line and the Use Reply-To button skip an own mailbox and its +tag form", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      const { emailId } = await draftedReply(trx, r.box, r.clock, { from: "anna@client.test" });
      const [local, domain] = r.box.address.split("@") as [string, string];
      const ownTagged = `${local}+news@${domain}`;
      await setMailAddresses(trx, emailId, { to: [r.box.address], replyTo: [r.box.address, ownTagged] });

      await cardOut(trx, r);

      // Only own addresses: no line and no button (the line and the service agree).
      const only = renderedOf((await outboxOf(trx, r, "approval")).at(-1) as never);
      expect(only.text).not.toContain(textTables.en.approvals.reply.replyTo);
      expect(only.buttons[1]?.map((button) => button.data.slice(0, 2))).toEqual(["rd"]);

      // A real other address next to them: only that one shows.
      await setMailAddresses(trx, emailId, {
        to: [r.box.address],
        replyTo: [ownTagged, "Office <Office@Client.test>", r.box.address],
      });
      await trx.deleteFrom("outbox").where("org_id", "=", r.box.ctx.orgId).where("kind", "=", "approval").execute();
      await cardOut(trx, r);
      const both = renderedOf((await outboxOf(trx, r, "approval")).at(-1) as never);
      expect(both.text).toContain(`${textTables.en.approvals.reply.replyTo} office@client.test`);
      expect(both.text).not.toContain(ownTagged);
      expect(both.buttons[1]?.map((button) => button.data.slice(0, 2))).toEqual(["rd", "ru"]);
    });
  });

  test("8. the Draft reply button of an urgent notice goes to the owner whose consent covers reply data, not to a second owner without it", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      const second = await addMember(trx, r.box.ctx.orgId, "owner");
      await linkChat(trx, r.box.ctx, second, randomChatId(), new Date(NOW.getTime() - HOUR_MS));
      const emailId = await addReplyMail(trx, r.box, {
        category: "urgent",
        receivedAt: new Date(NOW.getTime() - 10 * MINUTE_MS),
      });
      await trx
        .updateTable("triage_results")
        .set({ created_at: new Date(NOW.getTime() - 5 * MINUTE_MS) })
        .where("email_id", "=", emailId)
        .execute();

      await r.detect();

      const rows = await outboxOf(trx, r, "urgent");
      const buttonsOf = (userId: string) =>
        renderedOf(rows.find((row) => row.user_id === userId) as never)
          .buttons.flat()
          .map((button) => button.data);
      expect(buttonsOf(r.box.userId)).toContain(`dr:${emailId}`);
      expect(buttonsOf(second)).not.toContain(`dr:${emailId}`);
      expect(rows).toHaveLength(3);
    });
  });
});

describe("a line of text finds only what belongs to its user and organization", () => {
  test("9. a sent question of the same user in another organization answers no line in this one", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      const { emailId, sendId } = await draftedReply(trx, r.box, r.clock);
      const other = await createOrgWithMailbox(trx);
      const otherMail = await insertTestEmail(trx, { orgId: other.orgId }, other.mailboxId);
      // The same person is a member of a second organization and got a question there with message id 7777.
      await insertMembership(trx, { orgId: other.orgId }, { userId: r.box.userId, role: "owner" });
      const row = {
        user_id: r.box.userId,
        kind: "reply_prompt" as const,
        email_id: emailId,
        view: JSON.stringify({ emailId }),
        locale: "en",
        status: "sent",
        attempts: 0,
        next_attempt_at: NOW,
        created_at: NOW,
        sent_at: NOW,
        external_message_id: "7777",
      };
      const link = { userId: r.box.userId, linkedAt: new Date(NOW.getTime() - HOUR_MS) };
      await trx
        .insertInto("outbox")
        .values({
          ...row,
          org_id: other.orgId,
          dedup_key: `reply_prompt:${sendId}:1`,
          email_id: otherMail,
          view: JSON.stringify({ emailId: otherMail }),
        })
        .execute();

      expect(await findReplyTargetOfMessage(trx, r.box.ctx, link, 7777)).toBeUndefined();
      // The control: the same row in this organization is found.
      await trx
        .insertInto("outbox")
        .values({ ...row, org_id: r.box.ctx.orgId, dedup_key: `reply_prompt:${sendId}:1`, external_message_id: "8888" })
        .execute();
      expect(await findReplyTargetOfMessage(trx, r.box.ctx, link, 8888)).toBe(sendId);
    });
  });
});
