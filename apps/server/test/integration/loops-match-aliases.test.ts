import { afterAll, describe, expect, test } from "bun:test";

import { loopHooks, matchReplies } from "../../src/modules/loops";

import { testDb, withRollback } from "./helpers";
import { sentMail } from "./loops-analyze-fixtures";
import { ANNA, JAN, loopRow, loopsOrg, reply, RUN_AT, waiting } from "./loops-match-fixtures";
import { siblingMailbox } from "./mail-sent-fixtures";

// F116 stage 14 (carry-over of the stage 13 review, N2): an alias of the user is not a mailbox address, but the user wrote
// from it in the Sent folder, so a mail from it is not a reply. The own addresses of a mailbox are the mailbox addresses
// of the organization and every From address of the Sent rows of that mailbox.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const ALIAS = "me.alias@alias.example.test";

describe("an alias of the user does not close a loop", () => {
  test("a reply from an address that the user sent from stays open; a stranger closes; no Sent row closes", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      await sentMail(trx, org, { fromAddress: ALIAS });
      const aliasLoop = await waiting(trx, org);
      const strangerLoop = await waiting(trx, org);
      await reply(trx, org, { from: ALIAS, threadKey: aliasLoop.threadKey, subject: "Note to self" });
      await reply(trx, org, { from: ANNA, threadKey: strangerLoop.threadKey, subject: "Anything" });
      const out = await matchReplies({ db: trx }, org.ctx, org.mailboxId, { now: RUN_AT });
      expect(out.replied).toBe(1);
      expect((await loopRow(trx, aliasLoop.id)).status).toBe("open");
      expect((await loopRow(trx, strangerLoop.id)).status).toBe("closed");
    });
  });

  test("without a Sent row from the alias, the same mail closes the loop (the control)", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const loop = await waiting(trx, org);
      await reply(trx, org, { from: ALIAS, threadKey: loop.threadKey, subject: "Note to self" });
      expect((await matchReplies({ db: trx }, org.ctx, org.mailboxId, { now: RUN_AT })).replied).toBe(1);
    });
  });

  test("the compare ignores case and spaces around the address", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      await sentMail(trx, org, { fromAddress: "  Me.Alias@Alias.Example.Test " });
      const loop = await waiting(trx, org);
      await reply(trx, org, { from: ALIAS, threadKey: loop.threadKey, subject: "Note to self" });
      expect((await matchReplies({ db: trx }, org.ctx, org.mailboxId, { now: RUN_AT })).replied).toBe(0);
    });
  });

  test("the Sent rows of another mailbox of the organization do not count", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const other = await siblingMailbox(trx, org);
      await sentMail(trx, other, { fromAddress: ALIAS });
      const loop = await waiting(trx, org);
      await reply(trx, org, { from: ALIAS, threadKey: loop.threadKey, subject: "Note to self" });
      expect((await matchReplies({ db: trx }, org.ctx, org.mailboxId, { now: RUN_AT })).replied).toBe(1);
    });
  });

  test("the Sent rows of another organization do not count", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const stranger = await loopsOrg(trx);
      await sentMail(trx, stranger, { fromAddress: ALIAS });
      const loop = await waiting(trx, org);
      await reply(trx, org, { from: ALIAS, threadKey: loop.threadKey, subject: "Note to self" });
      expect((await matchReplies({ db: trx }, org.ctx, org.mailboxId, { now: RUN_AT })).replied).toBe(1);
    });
  });

  test("a person of the loop who also sends as the user is a stranger: the reply closes the loop (To, Cc, counterpart)", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      // Send-as or delegate access: the people below appear as From in the Sent rows of the mailbox.
      for (const address of [ANNA, JAN, "third@example.test"]) await sentMail(trx, org, { fromAddress: address });
      // Each person is only in one list: the counterpart is another address, so To and Cc are tested alone.
      const byTo = await waiting(trx, org, { cc_addresses: [], counterpart: "first@example.test" });
      const byCc = await waiting(trx, org, { to_addresses: ["first@example.test"], counterpart: "first@example.test" });
      const byCounterpart = await waiting(trx, org, {
        to_addresses: ["first@example.test"],
        cc_addresses: [],
        counterpart: "third@example.test",
      });
      await reply(trx, org, { from: ANNA, threadKey: byTo.threadKey, subject: "Anything" });
      await reply(trx, org, { from: JAN, threadKey: byCc.threadKey, subject: "Anything" });
      await reply(trx, org, { from: "third@example.test", threadKey: byCounterpart.threadKey, subject: "Anything" });
      const out = await matchReplies({ db: trx }, org.ctx, org.mailboxId, { now: RUN_AT });
      expect(out.replied).toBe(3);
      for (const loop of [byTo, byCc, byCounterpart]) expect((await loopRow(trx, loop.id)).status).toBe("closed");
    });
  });

  test("the people of one loop do not free the alias for another loop: a stranger's loop still ignores that alias", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      await sentMail(trx, org, { fromAddress: ALIAS });
      await sentMail(trx, org, { fromAddress: ANNA });
      // The loop to anna frees anna only; the alias stays own for it.
      const toAnna = await waiting(trx, org);
      await reply(trx, org, { from: ALIAS, threadKey: toAnna.threadKey, subject: "Note to self" });
      const out = await matchReplies({ db: trx }, org.ctx, org.mailboxId, { now: RUN_AT });
      expect(out.replied).toBe(0);
      expect((await loopRow(trx, toAnna.id)).status).toBe("open");
    });
  });

  test("the subject rule: a recipient who is also a Sent From address closes the loop by subject", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      await sentMail(trx, org, { fromAddress: ALIAS });
      const loop = await waiting(trx, org, { cc_addresses: [ALIAS] });
      await reply(trx, org, { from: ALIAS, subject: "Re: Oferta Q1" });
      expect((await matchReplies({ db: trx }, org.ctx, org.mailboxId, { now: RUN_AT })).repliedSubject).toBe(1);
      expect((await loopRow(trx, loop.id)).status).toBe("closed");
    });
  });

  test("a Sent row with no From address adds nothing", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      await sentMail(trx, org, { fromAddress: null });
      await sentMail(trx, org, { fromAddress: "" });
      const loop = await waiting(trx, org);
      await reply(trx, org, { from: ANNA, threadKey: loop.threadKey, subject: "Anything" });
      expect((await matchReplies({ db: trx }, org.ctx, org.mailboxId, { now: RUN_AT })).replied).toBe(1);
    });
  });

  test("the send check (`isOpen`) uses the same rule: an alias mail does not stop a follow-up", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      await sentMail(trx, org, { fromAddress: ALIAS });
      const loop = await waiting(trx, org);
      await reply(trx, org, { from: ALIAS, threadKey: loop.threadKey, subject: "Note to self" });
      expect(await loopHooks().isOpen(trx, org.ctx, loop.id)).toBe(true);
      const stranger = await waiting(trx, org);
      await reply(trx, org, { from: ANNA, threadKey: stranger.threadKey, subject: "Anything" });
      expect(await loopHooks().isOpen(trx, org.ctx, stranger.id)).toBe(false);
      // A recipient of the loop who is also a Sent From address: the reply counts, so the follow-up must not go out.
      await sentMail(trx, org, { fromAddress: JAN });
      const recipient = await waiting(trx, org);
      await reply(trx, org, { from: JAN, threadKey: recipient.threadKey, subject: "Anything" });
      expect(await loopHooks().isOpen(trx, org.ctx, recipient.id)).toBe(false);
    });
  });
});
