import { MINUTE_MS } from "@ea/core";
import { afterAll, afterEach, expect, test } from "bun:test";

import { lookupCard } from "../../../apps/server/src/modules/lab";
import { insertDraftAndSend } from "../../../apps/server/test/integration/fixtures";
import { testDb } from "../../../apps/server/test/integration/helpers";

import { RIGHT_DELEGATE, kinds, labId, makeExecutiveKit, until } from "./lab-executive.test-helper";

// The executive driver presses the Undo button of a digest card (fu:); lookupCard reads the cards' rows.
const db = testDb();
const kit = makeExecutiveKit(db);
const { withWorld } = kit;
afterAll(async () => {
  await db.destroy();
});
afterEach(kit.cleanup);

const { movedMail, digestCard } = kit;

test(
  "3: an applied move of an urgent mail and its digest card with Undo: one fu: press; the Undo starts",
  async () => {
    await withWorld(async (w) => {
      await w.tick();
      const emailId = await movedMail(w, "w-1-011", "urgent", "ai_info");
      const digest = await digestCard(w);
      expect(digest.buttons.flat().map((button) => button.data)).toContain(`fu:${emailId}`);

      expect((await w.tick()).planned).toBe(1);
      w.clock.at = new Date("2026-11-23T12:00:00Z");
      expect((await w.tick()).pressed).toBe(1);
      // The test and the server share one connection: a read can run between the Undo's reverse row and its feedback row.
      // The feedback row is the last write of the Undo transaction, so wait for it, then read both.
      const readFeedback = () =>
        w.trx.selectFrom("triage_feedback").select("source").where("email_id", "=", emailId).execute();
      await until("undo feedback row", async () => (await readFeedback()).length > 0);
      const reverses = await w.trx
        .selectFrom("actions")
        .select("id")
        .where("email_id", "=", emailId)
        .where("reverses_action_id", "is not", null)
        .execute();
      expect(reverses).toHaveLength(1);
      expect(await readFeedback()).toEqual([{ source: "undo" }]);
      expect(w.callbackData(w.a.chatId)).toEqual([`fu:${emailId}`]);
    });
  },
  MINUTE_MS
);

test(
  "5b: a digest message with feedback buttons for 3 mails: one fu: press, for the wrongly moved urgent mail only",
  async () => {
    await withWorld(async (w) => {
      await w.tick();
      const urgent = await movedMail(w, "w-1-011", "urgent", "ai_info");
      const info = await movedMail(w, "w-1-002", "info", "ai_info");
      const spam = await movedMail(w, "w-1-005", "spam", "ai_spam");
      const digest = await digestCard(w);
      const data = digest.buttons.flat().map((button) => button.data);
      for (const id of [urgent, info, spam]) expect(data).toContain(`fu:${id}`);

      expect(await w.tick()).toMatchObject({ planned: 1, pressed: 0, unmapped: 0 });
      w.clock.at = new Date("2026-11-23T12:00:00Z");
      expect((await w.tick()).pressed).toBe(1);
      await until("undo reverse row", async () => {
        const rows = await w.trx
          .selectFrom("actions")
          .select("email_id")
          .where("reverses_action_id", "is not", null)
          .execute();
        return rows.length === 1;
      });
      const reversed = await w.trx
        .selectFrom("actions")
        .select("email_id")
        .where("reverses_action_id", "is not", null)
        .execute();
      expect(reversed).toEqual([{ email_id: urgent }]);
      expect(w.callbackData(w.a.chatId)).toEqual([`fu:${urgent}`]);
    });
  },
  MINUTE_MS
);

test(
  "TG1: two digests list the same wrongly moved urgent mail: one fu: press and skip tap_repeat",
  async () => {
    await withWorld(async (w) => {
      await w.tick();
      const emailId = await movedMail(w, "w-1-011", "urgent", "ai_info");
      const first = await digestCard(w);
      expect(await w.tick()).toMatchObject({ planned: 1 });
      const second = await digestCard(w);
      expect(second.messageId).not.toBe(first.messageId);
      expect(second.buttons.flat().map((button) => button.data)).toContain(`fu:${emailId}`);
      expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 0, noRule: 0 });
      expect(w.events().filter((event) => event.t === "skip")).toEqual([
        expect.objectContaining({ code: "tap_repeat", ref: `${second.messageId}:fu:${emailId}` }),
      ]);
      expect(w.events().filter((event) => event.t === "tap_planned")).toHaveLength(1);

      w.clock.at = new Date("2026-11-23T12:00:00Z");
      expect((await w.tick()).pressed).toBe(1);
      await until("undo reverse row", async () => {
        const rows = await w.trx
          .selectFrom("actions")
          .select("id")
          .where("email_id", "=", emailId)
          .where("reverses_action_id", "is not", null)
          .execute();
        return rows.length === 1;
      });
      expect(w.callbackData(w.a.chatId)).toEqual([`fu:${emailId}`]);
      expect(kinds(w.events()).filter((type) => type === "tap_intent")).toHaveLength(1);
    });
  },
  MINUTE_MS
);

test(
  "lookupCard reads only the rows of its organization: a send, a reminder set and a mail",
  async () => {
    await withWorld(async (w) => {
      const ctxA = { orgId: w.a.orgId };
      const ctxB = { orgId: w.b.orgId };
      const { sendId, emailId } = await insertDraftAndSend(w.trx, ctxA, w.a.mailboxId, {
        to: RIGHT_DELEGATE,
        messageId: labId("w-1-008"),
      });
      expect(await lookupCard(w.trx, ctxA, { actionId: sendId })).toEqual({
        messageId: labId("w-1-008"),
        draft: { kind: "delegation", recipient: RIGHT_DELEGATE },
      });
      expect(await lookupCard(w.trx, ctxB, { actionId: sendId })).toBeNull();

      const setId = "11111111-1111-4111-8111-111111111111";
      await insertDraftAndSend(w.trx, ctxA, w.a.mailboxId, {
        reminder: 1,
        setId,
        to: RIGHT_DELEGATE,
        messageId: labId("w-1-017"),
      });
      expect(await lookupCard(w.trx, ctxA, { setId })).toEqual({
        messageId: labId("w-1-017"),
        draft: { kind: "other", recipient: RIGHT_DELEGATE },
      });
      expect(await lookupCard(w.trx, ctxB, { setId })).toBeNull();

      const moved = await movedMail(w, "w-1-011", "urgent", "ai_info");
      expect(await lookupCard(w.trx, ctxA, { emailId: moved })).toEqual({ messageId: labId("w-1-011"), moved: true });
      expect(await lookupCard(w.trx, ctxB, { emailId: moved })).toBeNull();
      // Not moved (a delegation mail with no move row), and an undone move.
      expect(await lookupCard(w.trx, ctxA, { emailId })).toEqual({ messageId: labId("w-1-008"), moved: false });
      await w.trx.updateTable("actions").set({ status: "undone" }).where("email_id", "=", moved).execute();
      expect(await lookupCard(w.trx, ctxA, { emailId: moved })).toEqual({ messageId: labId("w-1-011"), moved: false });
    });
  },
  MINUTE_MS
);
