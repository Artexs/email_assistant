import { afterAll, describe, expect, test } from "bun:test";

import { loopHooks, matchReplies } from "../../src/modules/loops";

import { testDb, withRollback } from "./helpers";
import { sentMail } from "./loops-analyze-fixtures";
import { ANNA, loopRow, loopsOrg, reply, RUN_AT, waiting } from "./loops-match-fixtures";
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

  test("the subject rule uses the same own addresses: an alias in the recipients of the loop is not a reply", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      await sentMail(trx, org, { fromAddress: ALIAS });
      // The user put the alias in Cc of its own mail; a mail from the alias in another thread is not an answer.
      const loop = await waiting(trx, org, { cc_addresses: [ALIAS] });
      await reply(trx, org, { from: ALIAS, subject: "Re: Oferta Q1" });
      expect((await matchReplies({ db: trx }, org.ctx, org.mailboxId, { now: RUN_AT })).replied).toBe(0);
      expect((await loopRow(trx, loop.id)).status).toBe("open");
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
    });
  });
});
