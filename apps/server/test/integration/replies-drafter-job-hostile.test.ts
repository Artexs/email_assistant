import { afterAll, describe, expect, test } from "bun:test";

import { createCommitterJob, createPlanned } from "../../src/modules/actions";
import { composeMessage } from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { createFakeMailSender } from "../../src/modules/mail/fake/sender";
import { insertCredentials } from "../../src/modules/mail/repo";

import { pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { secrets, fresh } from "./replies-drafter-job-helpers";
import {
  addReplyMail,
  CLEAN_ANSWER,
  fakeLlm,
  jobDeps,
  NOW,
  pairRows,
  queueRequest,
  requestsOf,
  runJob,
  setupBox,
} from "./reply-job-fixtures";

// The drafter job (scan, claim, call, write) against Postgres with a fake model. Every test runs in a transaction that
// is rolled back. The tests that need a real commit (the kill point, two instances at once) are in replies-drafter-committed.test.ts.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("the drafter job: hostile data never reaches a command or a recipient (F115 stage 04 and 07 carry-over)", () => {
  test("a payload folder of hostile text is data: the draft goes to Drafts only, no move, no delete, no folder of that name", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const s = await setupBox(trx);
      await trx
        .updateTable("mailboxes")
        .set({ folder_map: JSON.stringify({ drafts: "Drafts", sent: "Sent" }) })
        .where("id", "=", s.mailboxId)
        .execute();
      const secret = secrets.encrypt("pw", `mailbox:${s.mailboxId}`);
      await insertCredentials(trx, s.ctx, {
        mailboxId: s.mailboxId,
        encryptedSecret: secret.ciphertext,
        secretKind: "password",
        keyVersion: secret.keyVersion,
      });
      const hostile = ["INBOX; DELETE", "../other-box/INBOX", 'INBOX" DELETE "Drafts'];
      const mails: string[] = [];
      for (const folder of hostile) {
        const mail = await addReplyMail(trx, s, { category: "info" });
        mails.push(mail);
        await queueRequest(trx, s, mail, "tap", { folder });
      }
      // One mail per thread, so no reply closes another.
      await runJob(jobDeps(trx, fakeLlm(() => CLEAN_ANSWER).llm, fresh()), s);
      const drafts = (await pairRows(trx, s)).filter((row) => row.type === "create_draft");
      expect(drafts.map((row) => (row.payload as { folder: string }).folder).sort()).toEqual([...hostile].sort());

      const fake = createFakeMailProvider();
      await fake.ensureFolder("Drafts");
      await fake.ensureFolder("Sent");
      const sender = createFakeMailSender();
      await createCommitterJob({
        db: trx,
        secrets,
        openProvider: async () => fake,
        openSender: async () => sender,
        compose: composeMessage,
        scope: { kind: "all" },
        sendScope: { kind: "all" },
        now: () => NOW,
      }).run();

      expect((await pairRows(trx, s)).filter((row) => row.type === "create_draft").map((row) => row.status)).toEqual([
        "applied",
        "applied",
        "applied",
      ]);
      expect(await fake.searchSinceIn("Drafts", new Date(0))).toHaveLength(3);
      for (const call of fake.folderCalls) expect(hostile).not.toContain(call.folder);
      for (const method of ["moveMessage", "transferByAppend", "deleteMessage", "setFlags"]) {
        expect(fake.calls).not.toContain(method);
      }
      expect(sender.calls).toEqual([]);
      // The mails stay where they were.
      const folders = await trx.selectFrom("emails").select("folder").where("id", "in", mails).execute();
      expect(folders.map((row) => row.folder)).toEqual(["INBOX", "INBOX", "INBOX"]);
    });
  });

  test("a sender address that is not one clean address gets no request step: cancelled / bad_recipient, no call, no pair", async () => {
    await withRollback(db, async (trx) => {
      for (const from of ["jan@x.test\r\nBcc: evil@y.test", "a@b.test, c@d.test", "Jan <jan@x.test>", "jan@x.test>"]) {
        const s = await setupBox(trx);
        await addReplyMail(trx, s, { from });
        const { llm, requests } = fakeLlm(() => CLEAN_ANSWER);
        await runJob(jobDeps(trx, llm, fresh()), s);
        const [request] = await requestsOf(trx, s);
        expect([from, request?.status, request?.reason_code]).toEqual([from, "cancelled", "bad_recipient"]);
        expect(requests).toHaveLength(0);
        expect(await pairRows(trx, s)).toEqual([]);
      }
    });
  });

  test("the writer refuses a reply pair whose recipient or folder is hostile: nothing is stored", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx);
      const emailId = await addReplyMail(trx, s);
      const base = {
        kind: "reply",
        cc: [],
        language: "pl",
        body: "Tak.",
        request_id: "5d7b8a7e-9b7e-4e8a-9d6e-1f2d3c4b5a69",
        folder: "INBOX",
        recipients: "from",
      };
      for (const to of ["x@y.test\r\nBcc: evil@z.test", "a@b.test, c@d.test", ""]) {
        await expect(
          createPlanned(trx, s.ctx, emailId, [
            {
              type: "create_draft",
              payload: { ...base, to: [to] },
              status: "ready",
              idempotencyKey: `k:${to.length}:create_draft`,
            },
          ])
        ).rejects.toThrow();
      }
      expect(await pairRows(trx, s)).toEqual([]);
    });
  });
});
