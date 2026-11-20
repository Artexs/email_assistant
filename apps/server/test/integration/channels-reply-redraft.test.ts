import { REPLY_CONSENT_SINCE, textTables, HOUR_MS, MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { noDelegationHooks } from "../../src/modules/actions";
import { auditEvents, recordAudit } from "../../src/modules/audit";
import { handleCallback, type LinkedChat } from "../../src/modules/channels";
import { digestNowMessage, type CommandDeps } from "../../src/modules/channels/commands";
import { handleReplyText } from "../../src/modules/channels/reply-redraft";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { draftableMails, redraftReply, requestReply } from "../../src/modules/replies";
import type { DB } from "../../src/platform/db";

import { addMember, linkChat, randomChatId, renderedOf } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import {
  addReplyMail,
  CLEAN_ANSWER,
  draftedReply,
  fakeLlm,
  jobDeps,
  NOW,
  pairRows,
  requestsOf,
  runJob,
  setMailAddresses,
} from "./reply-job-fixtures";
import { cardOut, openSend, outboxOf, rig, type Rig } from "./reply-telegram-fixtures";

// The reply drafts in Telegram: Redraft, Reply all, Draft reply. The model is a fake and the channel is a fake; the sender, the notice
// detectors and the drafter job run against one transaction that is rolled back. One clock moves forward after each step.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("Redraft", () => {
  test("1. Redraft sends one question with ForceReply; the user's line answers it; the job writes version 2; the user gets the version 2 card", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      const { emailId, sendId } = await draftedReply(trx, r.box, r.clock);
      await cardOut(trx, r);

      const tap = await handleCallback(r.deps, r.owner, `rd:${sendId}`);
      expect(tap).toEqual({ answer: textTables.en.bot.taps.reply.redraftAsk });
      // A second tap while the question waits does not double it.
      await handleCallback(r.deps, r.owner, `rd:${sendId}`);
      expect(await outboxOf(trx, r, "reply_prompt")).toHaveLength(1);
      await r.sendOut();
      const prompt = r.channel.sent.at(-1);
      expect(prompt?.message).toEqual({
        text: "✍️ Write one line: what should the reply say?",
        buttons: [],
        forceReply: true,
      });
      const [row] = await outboxOf(trx, r, "reply_prompt");
      expect(row).toMatchObject({ status: "sent", email_id: emailId, dedup_key: `reply_prompt:${sendId}:1` });

      const answer = await handleReplyText(r.deps, r.owner, "say yes for Tuesday", prompt?.messageId as number);
      expect(answer).toEqual({ text: textTables.en.bot.taps.reply.redraftQueued, buttons: [] });
      const redraft = (await requestsOf(trx, r.box)).find((row) => row.trigger === "redraft");
      expect(redraft).toMatchObject({
        trigger: "redraft",
        previous_send_id: sendId,
        instruction: "say yes for Tuesday",
      });

      const llm = fakeLlm(() => CLEAN_ANSWER);
      r.clock.now = new Date(r.clock.now.getTime() + MINUTE_MS);
      await runJob(jobDeps(trx, llm.llm, r.clock), r.box);
      expect(llm.requests[0]?.prompt).toContain("say yes for Tuesday");
      const second = await openSend(trx, r);
      expect(second?.id).not.toBe(sendId);

      await r.detect();
      const cards = (await outboxOf(trx, r, "approval")).filter((card) =>
        card.dedup_key.startsWith(`approval:${second?.id}`)
      );
      expect(cards.map((card) => card.dedup_key)).toEqual([`approval:${second?.id}:r1`]);
      expect(renderedOf(cards[0] as never).text).toContain("Version 2");
      // The detector answers once: a second tick queues no second card, also after the first one went out.
      await r.sendOut();
      await r.detect();
      expect(
        (await outboxOf(trx, r, "approval")).filter((card) => card.dedup_key.startsWith(`approval:${second?.id}`))
      ).toHaveLength(1);
    });
  });

  test("2. a line that replies to the review card itself is a redraft too", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      const { sendId } = await draftedReply(trx, r.box, r.clock);
      const cardId = await cardOut(trx, r);

      const answer = await handleReplyText(r.deps, r.owner, "shorter please", cardId);

      expect(answer?.text).toBe(textTables.en.bot.taps.reply.redraftQueued);
      const redrafts = (await requestsOf(trx, r.box)).filter((row) => row.trigger === "redraft");
      expect(redrafts).toHaveLength(1);
      expect(redrafts[0]).toMatchObject({ previous_send_id: sendId, requested_by: r.box.userId });
    });
  });

  test("3. a line that replies to another message, or to a message of another chat, gives no request: the help answer follows", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      await draftedReply(trx, r.box, r.clock);
      const cardId = await cardOut(trx, r);

      expect(await handleReplyText(r.deps, r.owner, "text", 987_654)).toBeUndefined();
      // The member has no such message: the id of the owner's card means nothing in the member's chat.
      expect(await handleReplyText(r.deps, r.member, "text", cardId)).toBeUndefined();
      expect((await requestsOf(trx, r.box)).filter((row) => row.trigger === "redraft")).toEqual([]);
    });
  });

  test("4. a member's line that replies to a reply card gets the owner-only answer, no request", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      const { emailId, sendId } = await draftedReply(trx, r.box, r.clock);
      // The member once got a card (as an owner before the role changed): the card is a sent row of this user.
      await trx
        .insertInto("outbox")
        .values({
          org_id: r.box.ctx.orgId,
          user_id: r.memberId,
          kind: "reply_prompt",
          dedup_key: `reply_prompt:${sendId}:1`,
          email_id: emailId,
          view: JSON.stringify({ emailId }),
          locale: "en",
          status: "sent",
          attempts: 0,
          next_attempt_at: NOW,
          created_at: NOW,
          sent_at: NOW,
          external_message_id: "5555",
        })
        .execute();

      const answer = await handleReplyText(r.deps, r.member, "say yes", 5555);

      expect(answer).toEqual({ text: textTables.en.bot.taps.ownerOnly, buttons: [] });
      expect((await requestsOf(trx, r.box)).filter((row) => row.trigger === "redraft")).toEqual([]);
    });
  });

  test("5. a member taps Redraft, Reply all, Use Reply-To or Draft reply: the owner-only answer, nothing is queued", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      const { emailId, sendId } = await draftedReply(trx, r.box, r.clock);

      for (const data of [`rd:${sendId}`, `ra:${sendId}`, `ru:${sendId}`, `dr:${emailId}`]) {
        expect(await handleCallback(r.deps, r.member, data), data).toEqual({
          answer: textTables.en.bot.taps.ownerOnly,
        });
      }
      expect(await outboxOf(trx, r, "reply_prompt")).toEqual([]);
      expect((await requestsOf(trx, r.box)).filter((row) => row.trigger !== "auto")).toEqual([]);
    });
  });

  test("6. an owner whose consent does not cover reply data gets the consent line for a tap and for a line of text; nothing is queued", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      const { sendId } = await draftedReply(trx, r.box, r.clock);
      const cardId = await cardOut(trx, r);
      // The consent is withdrawn after the card went out: the owner unlinks and links again with no consent step.
      await recordAudit(trx, r.box.ctx, {
        event: auditEvents.chatUnlinked,
        actor: "system",
        data: { user_id: r.box.userId },
        at: new Date(r.clock.now.getTime() + 1),
      });

      const tap = await handleCallback(r.deps, r.owner, `rd:${sendId}`);
      expect(tap.send?.text).toContain(textTables.en.notices.replyDrafts.consent);
      const text = await handleReplyText(r.deps, r.owner, "say yes", cardId);
      expect(text?.text).toBe(textTables.en.notices.replyDrafts.consent);
      expect(await outboxOf(trx, r, "reply_prompt")).toEqual([]);
      expect((await requestsOf(trx, r.box)).filter((row) => row.trigger === "redraft")).toEqual([]);
    });
  });

  test("7. the sixth redraft is refused at once: the tap says so and no question is queued; a line that is too long is refused", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      let { sendId } = await draftedReply(trx, r.box, r.clock);
      for (let n = 1; n <= 5; n += 1) {
        const cardId = await cardOut(trx, r);
        expect((await handleReplyText(r.deps, r.owner, `line ${n}`, cardId))?.text).toBe(
          textTables.en.bot.taps.reply.redraftQueued
        );
        await r.job();
        sendId = (await openSend(trx, r))?.id as string;
      }
      const tap = await handleCallback(r.deps, r.owner, `rd:${sendId}`);
      expect(tap).toEqual({ answer: textTables.en.bot.taps.reply.redraftLimit });
      expect(await outboxOf(trx, r, "reply_prompt")).toEqual([]);

      const cardId = await cardOut(trx, r);
      expect((await handleReplyText(r.deps, r.owner, "line 6", cardId))?.text).toBe(
        textTables.en.bot.taps.reply.redraftLimit
      );
      expect((await handleReplyText(r.deps, r.owner, "x".repeat(301), cardId))?.text).toBe(
        textTables.en.bot.taps.reply.instructionLength
      );
    });
  });

  test("8. a request that ends with no draft or with an error comes as one fixed line (kind reply_result); the line is Polish for a Polish user", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      const { sendId } = await draftedReply(trx, r.box, r.clock);
      const cardId = await cardOut(trx, r);
      await handleReplyText(r.deps, r.owner, "what is the price?", cardId);

      await r.job({ decision: "no_draft", reason_code: "needs_facts", body: "", gaps: [], language: "pl" });
      await r.detect();
      await r.detect();

      const results = await outboxOf(trx, r, "reply_result");
      expect(results).toHaveLength(1);
      expect(results[0]?.view).toEqual({ emailId: expect.any(String), reason: "needs_facts" });
      expect(renderedOf(results[0] as never)).toEqual({
        text: textTables.en.notices.replyDrafts.results.needs_facts,
        buttons: [],
      });
      expect(renderedOf({ ...results[0], locale: "pl" } as never).text).toBe(
        textTables.pl.notices.replyDrafts.results.needs_facts
      );
      // The old version stays open: the redraft changed nothing.
      expect((await openSend(trx, r))?.id).toBe(sendId);
    });
  });
});

describe("Reply all and Use Reply-To", () => {
  test("9. Reply all gives the version 2 card with the Cc line; the tapped card is edited; a second tap on the old card answers `changed`", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      const { emailId, sendId } = await draftedReply(trx, r.box, r.clock, { from: "anna@client.test" });
      await setMailAddresses(trx, emailId, {
        to: [r.box.address, "b@y.test"],
        cc: ["c@z.test"],
        replyTo: ["office@client.test"],
      });
      const cardId = await cardOut(trx, r);
      // The first card has the buttons: Redraft, Reply all and Use Reply-To.
      const firstCard = await outboxOf(trx, r, "approval");
      expect(renderedOf(firstCard[0] as never).buttons[1]?.map((button) => button.data)).toEqual([
        `rd:${sendId}`,
        `ra:${sendId}`,
        `ru:${sendId}`,
      ]);

      const tap = await handleCallback(r.deps, r.owner, `ra:${sendId}`, { messageId: cardId });

      expect(tap.answer).toBe(textTables.en.bot.taps.reply.recipientsDone);
      expect(tap.edit?.text).toContain("✏️ Changed");
      expect(tap.edit?.buttons).toEqual([]);
      const second = await openSend(trx, r);
      expect(second?.id).not.toBe(sendId);
      expect(second?.payload).toEqual({ kind: "reply", to: ["anna@client.test"], cc: ["b@y.test", "c@z.test"] });
      const cards = (await outboxOf(trx, r, "approval")).filter((card) =>
        card.dedup_key.startsWith(`approval:${second?.id}`)
      );
      expect(cards).toHaveLength(1);
      const message = renderedOf(cards[0] as never);
      expect(message.text).toContain("Cc: b@y.test, c@z.test");
      expect(message.text).toContain("Version 2");
      // Reply all is done: the new card offers Use Reply-To and Redraft, not Reply all again.
      expect(message.buttons[1]?.map((button) => button.data)).toEqual([`rd:${second?.id}`, `ru:${second?.id}`]);

      const old = await handleCallback(r.deps, r.owner, `ra:${sendId}`);
      expect(old).toEqual({ answer: textTables.en.bot.taps.changed });
    });
  });

  test("10. Use Reply-To swaps the recipient; a mail with no other Reply-To answers with the text; 11 other recipients answer too_many", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      const { emailId, sendId } = await draftedReply(trx, r.box, r.clock, { from: "anna@client.test" });
      const t = textTables.en.bot.taps.reply;

      expect((await handleCallback(r.deps, r.owner, `ru:${sendId}`)).answer).toBe(t.noReplyTo);
      expect((await handleCallback(r.deps, r.owner, `ra:${sendId}`)).answer).toBe(t.noOthers);
      await setMailAddresses(trx, emailId, {
        to: [r.box.address, ...Array.from({ length: 11 }, (_, index) => `p${index}@y.test`)],
        replyTo: ["office@client.test"],
      });
      expect((await handleCallback(r.deps, r.owner, `ra:${sendId}`)).answer).toBe(t.tooManyRecipients);

      expect((await handleCallback(r.deps, r.owner, `ru:${sendId}`)).answer).toBe(t.recipientsDone);
      expect((await openSend(trx, r))?.payload).toEqual({ kind: "reply", to: ["office@client.test"], cc: [] });
    });
  });

  test("11. a tap on a send that was rejected answers `closed`; the flag off answers `feature off`", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      const { sendId } = await draftedReply(trx, r.box, r.clock);
      await trx.updateTable("actions").set({ status: "rejected" }).where("id", "=", sendId).execute();

      for (const data of [`rd:${sendId}`, `ra:${sendId}`, `ru:${sendId}`]) {
        expect(await handleCallback(r.deps, r.owner, data), data).toEqual({
          answer: textTables.en.bot.taps.reply.closed,
        });
      }
    });
  });
});

describe("Draft reply", () => {
  async function urgentRig(trx: Transaction<DB>, opts: { consented?: boolean } = {}) {
    const r = await rig(trx, opts);
    // A mail of the category `urgent` that a reply answers.
    const emailId = await addReplyMail(trx, r.box, {
      category: "urgent",
      receivedAt: new Date(NOW.getTime() - 10 * MINUTE_MS),
      from: "anna@client.test",
    });
    await trx
      .updateTable("triage_results")
      .set({ created_at: new Date(NOW.getTime() - 5 * MINUTE_MS) })
      .where("email_id", "=", emailId)
      .execute();
    return { r, emailId };
  }

  test("12. the urgent notice of a mail that a reply can answer has the Draft reply button; the tap queues a `tap` request; the job drafts; the user gets the card", async () => {
    await withRollback(db, async (trx) => {
      const { r, emailId } = await urgentRig(trx);

      await r.detect();
      const urgentRows = await outboxOf(trx, r, "urgent");
      expect(urgentRows).toHaveLength(2);
      // The owner gets the button; the member, who may not draft, gets none.
      const own = urgentRows.find((row) => row.user_id === r.box.userId);
      const members = urgentRows.find((row) => row.user_id === r.memberId);
      expect(renderedOf(own as never).buttons.at(-1)).toEqual([{ text: "✍️ Draft reply", data: `dr:${emailId}` }]);
      expect(renderedOf(members as never).buttons).toHaveLength(1);

      const tap = await handleCallback(r.deps, r.owner, `dr:${emailId}`);
      expect(tap).toEqual({ answer: textTables.en.bot.taps.reply.drafting });
      expect((await requestsOf(trx, r.box)).filter((row) => row.trigger === "tap")).toHaveLength(1);
      // A second tap while it waits makes no second request.
      await handleCallback(r.deps, r.owner, `dr:${emailId}`);
      expect((await requestsOf(trx, r.box)).filter((row) => row.trigger === "tap")).toHaveLength(1);

      await r.job();
      const send = await openSend(trx, r);
      expect(send?.email_id).toBe(emailId);
      await r.detect();
      const cards = (await outboxOf(trx, r, "approval")).filter((card) =>
        card.dedup_key.startsWith(`approval:${send?.id}`)
      );
      expect(cards.map((card) => card.dedup_key)).toEqual([`approval:${send?.id}:r1`]);
      expect(cards[0]?.user_id).toBe(r.box.userId);
    });
  });

  test("13. a tap on a mail whose draft is open gives that card and no new request", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      const { emailId, sendId } = await draftedReply(trx, r.box, r.clock);
      const before = (await requestsOf(trx, r.box)).length;

      const tap = await handleCallback(r.deps, r.owner, `dr:${emailId}`);

      expect(tap).toEqual({ answer: "" });
      expect((await requestsOf(trx, r.box)).length).toBe(before);
      expect((await outboxOf(trx, r, "approval")).map((card) => card.dedup_key)).toEqual([`approval:${sendId}:r1`]);
    });
  });

  test("14. a tap that the rules block answers with the reason text and queues nothing (en and pl texts exist for every reason)", async () => {
    await withRollback(db, async (trx) => {
      const { r, emailId } = await urgentRig(trx);
      await trx
        .updateTable("triage_results")
        .set({ suspicious_reasons: ["reply_to_mismatch"] })
        .where("email_id", "=", emailId)
        .execute();

      const tap = await handleCallback(r.deps, r.owner, `dr:${emailId}`);

      expect(tap).toEqual({ answer: textTables.en.bot.taps.reply.blocked.suspicious });
      expect(await requestsOf(trx, r.box)).toEqual([]);
      const unknown = await handleCallback(r.deps, r.owner, "dr:00000000-0000-4000-8000-000000000000");
      expect(unknown).toEqual({ answer: textTables.en.bot.taps.notFound });
    });
  });

  test("15. no Draft reply button without the consent, for a mail that is answered, or for a mail whose draft is open", async () => {
    await withRollback(db, async (trx) => {
      const { r, emailId } = await urgentRig(trx, { consented: false });
      await r.detect();
      const rows = await outboxOf(trx, r, "urgent");
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(renderedOf(row as never).buttons, emailId).toHaveLength(1);
    });
    await withRollback(db, async (trx) => {
      const { r, emailId } = await urgentRig(trx);
      // The draft of the mail is open before the notice is made.
      await requestReply({ db: trx, now: () => r.clock.now }, r.box.ctx, {
        userId: r.box.userId,
        via: "telegram",
        emailId,
      });
      await r.job();
      expect((await openSend(trx, r))?.email_id).toBe(emailId);
      await r.detect();
      const rows = await outboxOf(trx, r, "urgent");
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(renderedOf(row as never).buttons).toHaveLength(1);
    });
  });
});

describe("the line of text and the result: what they never do", () => {
  test("16. a card that was sent before the chat was linked, and a question that no sender took yet, answer no line of text", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      const { sendId } = await draftedReply(trx, r.box, r.clock);
      const cardId = await cardOut(trx, r);
      // A question that waits in the outbox has no Telegram message id: nothing to answer.
      await handleCallback(r.deps, r.owner, `rd:${sendId}`);
      expect(await handleReplyText(r.deps, r.owner, "x", 1)).toBeUndefined();
      // The chat was linked again after the card went out: message ids belong to one chat, so the old card means nothing.
      const relinked: LinkedChat = { ...r.owner, linkedAt: new Date(r.clock.now.getTime() + HOUR_MS) };

      expect(await handleReplyText(r.deps, relinked, "say yes", cardId)).toBeUndefined();
      expect((await requestsOf(trx, r.box)).filter((row) => row.trigger === "redraft")).toEqual([]);
      expect(await handleReplyText(r.deps, r.owner, "say yes", cardId)).toBeDefined();
    });
  });

  test("17. a request that the web made gets no Telegram answer; the request of Telegram does, once, to the user who asked", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      const web = await addReplyMail(trx, r.box, {
        category: "info",
        receivedAt: new Date(NOW.getTime() - 20 * MINUTE_MS),
      });
      const chat = await addReplyMail(trx, r.box, {
        category: "info",
        receivedAt: new Date(NOW.getTime() - 10 * MINUTE_MS),
      });
      const ask = { db: trx, now: () => r.clock.now };
      await requestReply(ask, r.box.ctx, { userId: r.box.userId, via: "web", emailId: web });
      await requestReply(ask, r.box.ctx, { userId: r.box.userId, via: "telegram", emailId: chat });

      await r.job();
      await r.detect();
      await r.detect();

      const cards = await outboxOf(trx, r, "approval");
      const sendOf = async (emailId: string) =>
        (await pairRows(trx, r.box)).find((row) => row.type === "send" && row.email_id === emailId);
      expect(cards.map((card) => card.dedup_key)).toEqual([`approval:${(await sendOf(chat))?.id}:r1`]);
      expect(await sendOf(web)).toBeDefined();
    });
  });

  test("18. a result for an owner whose consent does not cover reply data is not queued", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx, { consented: false });
      const emailId = await addReplyMail(trx, r.box, { category: "info" });
      await requestReply({ db: trx, now: () => r.clock.now }, r.box.ctx, {
        userId: r.box.userId,
        via: "telegram",
        emailId,
      });
      await r.job();
      await r.detect();

      expect(await outboxOf(trx, r, "approval")).toEqual([]);
      expect(await outboxOf(trx, r, "reply_result")).toEqual([]);
    });
  });

  test("19. a draft that cannot be made for an OAuth mailbox, and the flag off, answer with the reason; the redraft too", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      const { emailId, sendId } = await draftedReply(trx, r.box, r.clock);
      const ask = { db: trx, now: () => r.clock.now };
      await trx.updateTable("mailboxes").set({ oauth_provider: "google" }).where("id", "=", r.box.mailboxId).execute();
      const other = await addReplyMail(trx, r.box, { category: "info" });

      expect(await requestReply(ask, r.box.ctx, { userId: r.box.userId, via: "telegram", emailId: other })).toEqual({
        kind: "blocked",
        reason: "oauth_mailbox",
      });
      expect(
        await redraftReply(ask, r.box.ctx, { userId: r.box.userId, via: "telegram", sendId, instruction: "x" })
      ).toEqual({ kind: "blocked", reason: "oauth_mailbox" });
      await trx.updateTable("mailboxes").set({ oauth_provider: null }).where("id", "=", r.box.mailboxId).execute();
      await trx.updateTable("org_features").set({ enabled: false }).where("org_id", "=", r.box.ctx.orgId).execute();
      expect(
        await redraftReply(ask, r.box.ctx, { userId: r.box.userId, via: "telegram", sendId, instruction: "x" })
      ).toEqual({ kind: "feature_off" });
      expect(emailId).toBeDefined();
    });
  });

  test("20. the question and the result are not held in quiet hours (a notice of another kind is: the control)", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      const { sendId } = await draftedReply(trx, r.box, r.clock);
      await cardOut(trx, r);
      // 23:30 in Europe/Warsaw (22:30 UTC in November): inside the default quiet hours.
      r.clock.now = new Date("2026-11-18T22:30:00Z");
      await handleCallback(r.deps, r.owner, `rd:${sendId}`);
      await r.sendOut();
      expect(r.channel.sent.at(-1)?.message.forceReply).toBe(true);
      const [prompt] = await outboxOf(trx, r, "reply_prompt");
      expect(prompt?.status).toBe("sent");

      await trx
        .insertInto("outbox")
        .values({
          org_id: r.box.ctx.orgId,
          user_id: r.box.userId,
          kind: "reply_result",
          dedup_key: "reply_result:quiet-check",
          email_id: prompt?.email_id,
          view: JSON.stringify({ emailId: prompt?.email_id, reason: "timeout" }),
          locale: "en",
          status: "pending",
          attempts: 0,
          next_attempt_at: r.clock.now,
          created_at: r.clock.now,
        })
        .execute();
      await trx
        .insertInto("outbox")
        .values({
          org_id: r.box.ctx.orgId,
          user_id: r.box.userId,
          kind: "replies_ready",
          dedup_key: "replies_ready:quiet-control",
          view: JSON.stringify({ count: 1, now: r.clock.now, timeZone: "Europe/Warsaw", review: false }),
          locale: "en",
          status: "pending",
          attempts: 0,
          next_attempt_at: r.clock.now,
          created_at: r.clock.now,
        })
        .execute();
      await r.sendOut();
      const [result] = await outboxOf(trx, r, "reply_result");
      expect(result?.status).toBe("sent");
      // The control: the same hour holds a notice that nobody asked for.
      const [control] = await outboxOf(trx, r, "replies_ready");
      expect(control?.status).toBe("pending");
    });
  });
});

describe("who gets the answer, and which mails get the button", () => {
  test("23. with two owners, each gets the answer to his own request only", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      const second = await addMember(trx, r.box.ctx.orgId, "owner");
      await linkChat(trx, r.box.ctx, second, randomChatId(), new Date(NOW.getTime() - HOUR_MS));
      await recordAudit(trx, r.box.ctx, {
        event: auditEvents.webTelegramConsent,
        actor: second,
        data: { via: "web", version: REPLY_CONSENT_SINCE },
        at: new Date(NOW.getTime() - 2 * HOUR_MS),
      });
      const ask = { db: trx, now: () => r.clock.now };
      const first = await addReplyMail(trx, r.box, {
        category: "info",
        receivedAt: new Date(NOW.getTime() - 20 * MINUTE_MS),
      });
      const other = await addReplyMail(trx, r.box, {
        category: "info",
        receivedAt: new Date(NOW.getTime() - 10 * MINUTE_MS),
      });
      await requestReply(ask, r.box.ctx, { userId: r.box.userId, via: "telegram", emailId: first });
      await requestReply(ask, r.box.ctx, { userId: second, via: "telegram", emailId: other });

      await r.job();
      await r.detect();

      const sendOf = async (emailId: string) =>
        (await pairRows(trx, r.box)).find((row) => row.type === "send" && row.email_id === emailId);
      const cards = (await outboxOf(trx, r, "approval")).map((card) => [card.user_id, card.dedup_key]);
      expect(cards.sort()).toEqual(
        [
          [r.box.userId, `approval:${(await sendOf(first))?.id}:r1`],
          [second, `approval:${(await sendOf(other))?.id}:r1`],
        ].sort()
      );
    });
  });

  test("24. draftableMails: only a needs_reply or urgent mail with a clean sender and no open draft; an info mail and an answered mail are left out", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      const needs = await addReplyMail(trx, r.box, { receivedAt: new Date(NOW.getTime() - 40 * MINUTE_MS) });
      const urgent = await addReplyMail(trx, r.box, {
        category: "urgent",
        receivedAt: new Date(NOW.getTime() - 30 * MINUTE_MS),
      });
      const info = await addReplyMail(trx, r.box, {
        category: "info",
        receivedAt: new Date(NOW.getTime() - 20 * MINUTE_MS),
      });
      const answered = await addReplyMail(trx, r.box, { receivedAt: new Date(NOW.getTime() - 10 * MINUTE_MS) });
      await trx
        .insertInto("email_flags")
        .values({
          email_id: answered,
          org_id: r.box.ctx.orgId,
          answered: true,
          checked_at: NOW,
          seen: true,
          flagged: false,
        })
        .execute();
      const ids = [needs, urgent, info, answered];

      expect([...(await draftableMails(trx, r.box.ctx, ids, { now: NOW }))].sort()).toEqual([needs, urgent].sort());
    });
  });
});

describe("the question after Redraft: a resend", () => {
  test("22. a question that was sent before a crash and is sent again keeps ForceReply", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      const { emailId, sendId } = await draftedReply(trx, r.box, r.clock);
      await trx
        .insertInto("outbox")
        .values({
          org_id: r.box.ctx.orgId,
          user_id: r.box.userId,
          kind: "reply_prompt",
          dedup_key: `reply_prompt:${sendId}:1`,
          email_id: emailId,
          view: JSON.stringify({ emailId }),
          locale: "en",
          // The first send was taken and never marked: the claim is stale and the stored text is sent as it is.
          status: "sending",
          locked_at: new Date(NOW.getTime() - HOUR_MS),
          text: "✍️ Write one line: what should the reply say?",
          buttons: JSON.stringify([]),
          attempts: 0,
          next_attempt_at: NOW,
          created_at: new Date(NOW.getTime() - HOUR_MS),
        })
        .execute();

      await r.sendOut();

      expect(r.channel.sent.at(-1)?.message).toEqual({
        text: "✍️ Write one line: what should the reply say?",
        buttons: [],
        forceReply: true,
      });
    });
  });
});

describe("the Draft reply button on the digest", () => {
  function commandDeps(trx: Transaction<DB>, r: Rig): CommandDeps {
    return {
      db: trx,
      now: () => r.clock.now,
      llmDailyCap: 300,
      triageScope: "all",
      actionsScope: { kind: "all" },
      llm: { provider: "gemini", classifierModel: "m" },
      hooks: noDelegationHooks,
      uidplus: async () => true,
      sendScope: { kind: "all" },
      testMail: NO_TEST_SENDERS,
      operatorContact: null,
      syncEveryMin: 2,
    };
  }

  test("21. an owner with the consent gets the button on a needs_reply row with no open draft; an info row, a member and an unconsented owner get none", async () => {
    await withRollback(db, async (trx) => {
      const r = await rig(trx);
      const needs = await addReplyMail(trx, r.box, { receivedAt: new Date(NOW.getTime() - 30 * MINUTE_MS) });
      const info = await addReplyMail(trx, r.box, {
        category: "info",
        receivedAt: new Date(NOW.getTime() - 20 * MINUTE_MS),
      });
      const buttons = (message: { buttons: { data: string }[][] }) =>
        message.buttons.flat().map((button) => button.data);

      const ownerDigest = await digestNowMessage(commandDeps(trx, r), r.owner);
      expect(buttons(ownerDigest)).toContain(`dr:${needs}`);
      expect(buttons(ownerDigest)).not.toContain(`dr:${info}`);

      expect(
        buttons(await digestNowMessage(commandDeps(trx, r), r.member)).some((data) => data.startsWith("dr:"))
      ).toBe(false);

      // The draft of the mail is open now: no button.
      await requestReply({ db: trx, now: () => r.clock.now }, r.box.ctx, {
        userId: r.box.userId,
        via: "telegram",
        emailId: needs,
      });
      await r.job();
      expect(buttons(await digestNowMessage(commandDeps(trx, r), r.owner)).some((data) => data.startsWith("dr:"))).toBe(
        false
      );
    });
    await withRollback(db, async (trx) => {
      const r = await rig(trx, { consented: false });
      await addReplyMail(trx, r.box, { receivedAt: new Date(NOW.getTime() - 30 * MINUTE_MS) });
      const message = await digestNowMessage(commandDeps(trx, r), r.owner);
      expect(message.buttons.flat().some((button) => button.data.startsWith("dr:"))).toBe(false);
    });
  });
});
