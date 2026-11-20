import { afterAll, describe, expect, test } from "bun:test";

import { sentSwitchHooks } from "../../src/composition";
import { setSentSync } from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { createFakeMailSender } from "../../src/modules/mail/fake/sender";
import { configureFeatures } from "../../src/modules/tenancy";

import { NOW, Setup, followUp, row, loopOf } from "./actions-follow-up-helpers";
import { testDb, withRollback } from "./helpers";
import { newOrg, siblingMailbox } from "./mail-sent-fixtures";

// The follow-up kind goes through the committer. A follow-up hangs on a loop (`loop_id`), not on a mail.
// Every test runs in a transaction that is rolled back: a committed loop row would break the Down guard of the migration test.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("T10 the switch off ends a waiting follow-up", () => {
  test("setSentSync off: the loops close, a waiting send and an approved send expire with loop_closed", async () => {
    configureFeatures({ off: [] });
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const s: Setup = {
        ctx: org.ctx,
        userId: org.userId,
        mailboxId: org.mailboxId,
        address: "me@corp.test",
        fake: createFakeMailProvider(),
        sender: createFakeMailSender(),
        folderMap: {},
      };
      const waiting = await followUp(trx, s, { draftStatus: "ready", sendStatus: "awaiting_approval" });
      const approved = await followUp(trx, s, { draftStatus: "applied", sendStatus: "approved" });
      const sent = await followUp(trx, s, { draftStatus: "applied", sendStatus: "applied" });

      await setSentSync(trx, s.ctx, s.mailboxId, { enabled: false, actor: "user-1", at: NOW }, sentSwitchHooks);

      for (const item of [waiting, approved]) {
        expect(await row(trx, item.sendId)).toMatchObject({ status: "expired", status_reason: "loop_closed" });
        expect((await loopOf(trx, item.loopId)).status).toBe("closed");
      }
      expect((await row(trx, waiting.draftId)).status).toBe("expired");
      // A send that went out stays as it is.
      expect((await row(trx, sent.sendId)).status).toBe("applied");
      // An applied draft copy gets its reverse row (UIDPLUS): the mailbox of `newOrg` has the capability.
      const reverses = await trx
        .selectFrom("actions")
        .select("id")
        .where("reverses_action_id", "=", approved.draftId)
        .execute();
      expect(reverses).toHaveLength(1);
    });
  });
});

describe("T10b the switch off of one mailbox leaves the follow-ups of another mailbox of the organization", () => {
  test("mailbox B keeps its waiting and its approved follow-up, and its loop stays open", async () => {
    configureFeatures({ off: [] });
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const sibling = await siblingMailbox(trx, org);
      const a: Setup = {
        ctx: org.ctx,
        userId: org.userId,
        mailboxId: org.mailboxId,
        address: "me@corp.test",
        fake: createFakeMailProvider(),
        sender: createFakeMailSender(),
        folderMap: {},
      };
      const waitingA = await followUp(trx, a, { draftStatus: "ready", sendStatus: "awaiting_approval" });
      const approvedA = await followUp(trx, a, { draftStatus: "applied", sendStatus: "approved" });
      const waitingB = await followUp(trx, a, {
        mailboxId: sibling.mailboxId,
        draftStatus: "ready",
        sendStatus: "awaiting_approval",
      });
      const approvedB = await followUp(trx, a, {
        mailboxId: sibling.mailboxId,
        draftStatus: "applied",
        sendStatus: "approved",
      });

      await setSentSync(trx, a.ctx, a.mailboxId, { enabled: false, actor: "user-1", at: NOW }, sentSwitchHooks);

      for (const item of [waitingA, approvedA]) {
        expect(await row(trx, item.sendId)).toMatchObject({ status: "expired", status_reason: "loop_closed" });
      }
      expect((await row(trx, waitingB.sendId)).status).toBe("awaiting_approval");
      expect((await row(trx, approvedB.sendId)).status).toBe("approved");
      expect((await row(trx, waitingB.draftId)).status).toBe("ready");
      expect((await row(trx, approvedB.draftId)).status).toBe("applied");
      expect((await loopOf(trx, waitingB.loopId)).status).toBe("open");
      expect((await loopOf(trx, approvedB.loopId)).status).toBe("open");
    });
  });
});
