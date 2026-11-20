import { format } from "node:util";

import { DAY_MS } from "@ea/core";
import { afterAll, describe, expect, spyOn, test } from "bun:test";

import { createCommitterJob } from "../../src/modules/actions";
import { SoftError } from "../../src/platform/errors";
import { logFormatFromEnv, setLogFormat, setLogLevel } from "../../src/platform/log";

import {
  NOW,
  secrets,
  addBox,
  addMail,
  openerFor,
  actionState,
  senderOpener,
  sendJob,
  pairOf,
} from "./actions-committer-helpers";
import { insertAction, pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("createCommitterJob with sends", () => {
  test("(24) a batch with only a send opens the provider and the sender once and saves the Sent copy", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const opener = openerFor([box]);
      const smtp = senderOpener();
      const p = await pairOf(trx, box);

      await sendJob(trx, opener, smtp, box).run();

      expect(opener.calls).toEqual([box.address]);
      expect(smtp.calls).toEqual([box.address]);
      expect(smtp.sender.sent).toHaveLength(1);
      expect((await actionState(trx, p.sendId)).status).toBe("applied");
      expect(await box.fake.searchSinceIn("Sent", new Date(NOW.getTime() - 2 * DAY_MS))).toHaveLength(1);
      expect(smtp.sender.closed).toBe(true);
      expect(box.fake.closed).toBe(true);
    });
  });

  test("(25) a batch with only a reverse draft opens the provider and no sender", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const opener = openerFor([box]);
      const smtp = senderOpener();
      const p = await pairOf(trx, box, { sendStatus: "applied" });
      await insertAction(trx, { orgId: box.orgId }, p.emailId, {
        type: "create_draft",
        status: "ready",
        payload: { kind: "delegation", folder: "Drafts", uid: 1, reason: "sent" },
        reversesActionId: p.draftId,
        idempotencyKey: `${p.draftId}:undo`,
      });
      await box.fake.ensureFolder("Drafts");

      await sendJob(trx, opener, smtp, box).run();

      expect(opener.calls).toEqual([box.address]);
      expect(smtp.calls).toEqual([]);
    });
  });

  test("(25b) a batch with only an applying send (the recovery) opens no sender", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const opener = openerFor([box]);
      const smtp = senderOpener();
      const p = await pairOf(trx, box, { sendStatus: "applying" });

      await sendJob(trx, opener, smtp, box).run();

      expect(opener.calls).toEqual([box.address]);
      expect(smtp.calls).toEqual([]);
      expect(smtp.sender.calls).toEqual([]);
      expect(await actionState(trx, p.sendId)).toMatchObject({ status: "failed", status_reason: "outcome_unknown" });
    });
  });

  test("(20) a sender that cannot open releases the draft and the send, no count", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const opener = openerFor([box]);
      const smtp = senderOpener();
      smtp.failure = new SoftError("smtp down");
      const waiting = await pairOf(trx, box, {
        draftStatus: "ready",
        sendStatus: "awaiting_approval",
        approved: undefined,
      });
      const ready = await pairOf(trx, box);

      await sendJob(trx, opener, smtp, box).run();

      expect(await actionState(trx, waiting.draftId)).toMatchObject({ status: "ready", locked_at: null, attempts: 0 });
      expect(await actionState(trx, ready.sendId)).toMatchObject({ status: "approved", locked_at: null, attempts: 0 });
      expect(box.fake.closed).toBe(true);
    });
  });

  test("(21) a soft error on an earlier row releases a later send as approved", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const opener = openerFor([box]);
      const smtp = senderOpener();
      const mail = await addMail(trx, box, { messageId: "<f1@x.test>", actions: [{ type: "flag" }] });
      const p = await pairOf(trx, box);
      box.fake.failOn("setFlags", new SoftError("slow"));

      await sendJob(trx, opener, smtp, box).run();

      expect(await actionState(trx, mail.actionIds[0] as string)).toMatchObject({ status: "ready", locked_at: null });
      expect(await actionState(trx, p.sendId)).toMatchObject({ status: "approved", locked_at: null, attempts: 0 });
      expect(smtp.sender.calls).not.toContain("send");
    });
  });

  test("(26) facts that cannot load release the batch without a count and close the connections", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const smtp = senderOpener();
      const ready = await pairOf(trx, box);
      // The first organizations read is the suspend re-check of the loop; the facts read after it fails.
      let organizationReads = 0;
      const failing = new Proxy(trx, {
        get(target, prop) {
          const value = Reflect.get(target, prop, target) as unknown;
          if (prop === "selectFrom") {
            return (table: string) => {
              if (table === "organizations" && ++organizationReads > 1) throw new Error("db read failed");
              return (value as (name: string) => unknown).call(target, table);
            };
          }
          return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      });
      const job = createCommitterJob({
        db: failing,
        secrets,
        openProvider: openerFor([box]).openProvider,
        openSender: smtp.openSender,
        scope: { kind: "all" },
        sendScope: { kind: "all" },
        now: () => NOW,
      });

      await expect(job.run()).resolves.toBeUndefined();

      expect(await actionState(trx, ready.sendId)).toMatchObject({ status: "approved", locked_at: null, attempts: 0 });
      expect(smtp.sender.sent).toEqual([]);
      expect(box.fake.closed).toBe(true);
    });
  });

  test("(22b) a mailbox with only a held send logs the held line once over two runs", async () => {
    const lines: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(format(...args)));
    setLogFormat("json");
    setLogLevel("info");
    try {
      await withRollback(db, async (trx) => {
        await pauseOtherMailboxes(trx);
        const box = await addBox(trx);
        const smtp = senderOpener();
        await pairOf(trx, box);
        const job = sendJob(trx, openerFor([box]), smtp, box, { kind: "off" });

        await job.run();
        await job.run();

        const held = lines
          .map((line) => JSON.parse(line) as Record<string, unknown>)
          .filter((line) => line.event === "committer_sends_held");
        expect(held).toHaveLength(1);
        expect(held[0]).toMatchObject({ mailbox_id: box.mailboxId, count: 1, scope: "off", config_key: "SEND_SCOPE" });
        expect(smtp.calls).toEqual([]);
      });
    } finally {
      logSpy.mockRestore();
      setLogFormat(logFormatFromEnv(process.env));
    }
  });
});
