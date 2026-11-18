import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";

import { delegationHooks } from "../../src/modules/delegation";
import { createReplySweep } from "../../src/modules/replies";
import { lockThread } from "../../src/modules/replies/write";

import { testDb } from "./helpers";
import { markAnswered, SWEEP_NOW, sweepOrg, sweepReply, type SweepOrg } from "./reply-answered-fixtures";

// F115 stage 09: the sweep with real commits. A rollback test cannot show that the close waits for the lock of the thread, or that two
// sweeps at once close a send once. Each test makes its own organization and deletes it at the end.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function committedReply() {
  return db.transaction().execute(async (trx) => {
    const o = await sweepOrg(trx);
    const thread = `<thread-${randomUUID()}@x.test>`;
    const pair = await sweepReply(trx, o, { threadKey: thread });
    await markAnswered(trx, o, pair.emailId);
    return { o, thread, pair };
  });
}

async function drop(o: SweepOrg): Promise<void> {
  await db.deleteFrom("organizations").where("id", "=", o.ctx.orgId).execute();
  await db.deleteFrom("users").where("id", "=", o.userId).execute();
}

const sweep = () =>
  createReplySweep({
    db,
    hooks: delegationHooks({ db }),
    approvalHooks: { onDecided: async () => undefined },
    uidplus: async () => true,
    now: () => SWEEP_NOW,
  });

const stateOf = (id: string) =>
  db.selectFrom("actions").select("status").where("id", "=", id).executeTakeFirstOrThrow();

describe("the sweep with real commits (F115 stage 09)", () => {
  test("a close waits for the advisory lock of the thread (the drafter write holds it) and then closes", async () => {
    const { o, thread, pair } = await committedReply();
    try {
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let gotLock: () => void = () => undefined;
      const locked = new Promise<void>((resolve) => {
        gotLock = resolve;
      });
      const holder = db.transaction().execute(async (trx) => {
        await lockThread(trx, o.ctx, o.mailboxId, thread);
        gotLock();
        await held;
      });
      await locked;
      let done = false;
      const running = sweep()
        .run({ mailboxId: o.mailboxId })
        .then((result) => {
          done = true;
          return result;
        });

      await sleep(600);
      expect(done).toBe(false);
      expect((await stateOf(pair.sendId)).status).toBe("awaiting_approval");

      release();
      await holder;
      const result = await running;
      expect(result.closed.answered).toBe(1);
      expect((await stateOf(pair.sendId)).status).toBe("expired");
    } finally {
      await drop(o);
    }
  });

  test("two sweeps at once close the send once: one audit row, one reverse row", async () => {
    const { o, pair } = await committedReply();
    try {
      const results = await Promise.all([
        sweep().run({ mailboxId: o.mailboxId }),
        sweep().run({ mailboxId: o.mailboxId }),
      ]);

      expect(results.reduce((sum, result) => sum + result.closed.answered, 0)).toBe(1);
      expect(results.reduce((sum, result) => sum + result.mailboxErrors, 0)).toBe(0);
      expect(
        await db
          .selectFrom("audit_log")
          .select("id")
          .where("org_id", "=", o.ctx.orgId)
          .where("action_id", "=", pair.sendId)
          .where("event", "=", "action.expired")
          .execute()
      ).toHaveLength(1);
      expect(
        await db.selectFrom("actions").select("id").where("reverses_action_id", "=", pair.draftId).execute()
      ).toHaveLength(1);
    } finally {
      await drop(o);
    }
  });
});
