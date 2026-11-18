import { afterAll, describe, expect, test } from "bun:test";

import { createLoopMatchJob, matchReplies } from "../../src/modules/loops";
import { captureLogs, eventLines, logProblems } from "../log-capture";

import { pauseOtherMailboxes, suspendOrg } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { loopRow, loopsOrg, reply, RUN_AT, waiting } from "./loops-match-fixtures";

// The job `loops.match` (step 2): the runner over the mailboxes.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("createLoopMatchJob", () => {
  test("a run closes the answered loops of every active mailbox and returns counts", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const a = await loopsOrg(trx);
      const b = await loopsOrg(trx);
      const la = await waiting(trx, a);
      const lb = await waiting(trx, b);
      await reply(trx, a, { threadKey: la.threadKey });
      await reply(trx, b, { threadKey: lb.threadKey });
      const out = await createLoopMatchJob({ db: trx, now: () => RUN_AT }).run();
      expect(out).toMatchObject({ mailboxes: 2, checked: 2, replied: 2, mailboxErrors: 0 });
      expect((await loopRow(trx, la.id)).status).toBe("closed");
      expect((await loopRow(trx, lb.id)).status).toBe("closed");
    });
  });

  test("an organization with the flag `open_loops` off or suspended is not walked", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const off = await loopsOrg(trx, { loopsFlag: false });
      const suspended = await loopsOrg(trx);
      await suspendOrg(trx, suspended.ctx.orgId);
      const lo = await waiting(trx, off);
      const ls = await waiting(trx, suspended);
      await reply(trx, off, { threadKey: lo.threadKey });
      await reply(trx, suspended, { threadKey: ls.threadKey });
      const out = await createLoopMatchJob({ db: trx, now: () => RUN_AT }).run();
      expect(out).toMatchObject({ mailboxes: 0, checked: 0, replied: 0 });
      expect((await loopRow(trx, lo.id)).status).toBe("open");
      expect((await loopRow(trx, ls.id)).status).toBe("open");
    });
  });

  test("the error of one mailbox does not stop the next; the log line holds codes only", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const a = await loopsOrg(trx);
      const b = await loopsOrg(trx);
      const lb = await waiting(trx, b);
      await reply(trx, b, { threadKey: lb.threadKey });
      const logs = captureLogs();
      try {
        const out = await createLoopMatchJob({
          db: trx,
          now: () => RUN_AT,
          match: async (deps, ctx, mailboxId, opts) => {
            if (mailboxId === a.mailboxId) throw new Error("boom with PLANTED-JOB-13");
            return matchReplies(deps, ctx, mailboxId, opts);
          },
        }).run();
        expect(out).toMatchObject({ mailboxes: 1, mailboxErrors: 1, replied: 1 });
      } finally {
        logs.stop();
      }
      expect(logProblems(logs.lines, ["PLANTED-JOB-13"])).toEqual([]);
      expect(eventLines(logs.lines, "loops_match_mailbox_failed")).toHaveLength(1);
      expect((await loopRow(trx, lb.id)).status).toBe("closed");
    });
  });
});
