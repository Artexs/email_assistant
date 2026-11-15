import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  doneLoop,
  draftFollowUp,
  dropLoop,
  laterLoop,
  matchReplies,
  onSentOff,
  reopenLoop,
  untrackLoop,
  type LoopAnswer,
} from "../../src/modules/loops";
import { writeSentSwitch } from "../../src/modules/mail";
import type { DB } from "../../src/platform/db";
import { captureLogs, eventLines, logProblems } from "../log-capture";

import { testDb, withRollback } from "./helpers";
import {
  actionsOfLoop,
  ANNA,
  auditOf,
  commandLoop,
  commandOrg,
  FRIDAY,
  JAN,
  loopOf,
  type CommandOrg,
} from "./loops-commands-fixtures";
import { reply } from "./loops-match-fixtures";

// F116 stage 14, step 2: Later, Done, Drop, Reopen, Untrack. The races of the same rules are in `loops-commands-race.test.ts`.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

type Command = typeof doneLoop;
const run = (
  command: Command,
  trx: Transaction<DB>,
  org: CommandOrg,
  loopId: string,
  over: { userId?: string; now?: Date } = {}
): Promise<LoopAnswer> =>
  command({ db: trx, now: () => over.now ?? FRIDAY }, org.ctx, {
    loopId,
    userId: over.userId ?? org.userId,
    via: "web",
  });
const later = (trx: Transaction<DB>, org: CommandOrg, loopId: string, over: { userId?: string; now?: Date } = {}) =>
  laterLoop({ db: trx, now: () => over.now ?? FRIDAY }, org.ctx, {
    loopId,
    userId: over.userId ?? org.userId,
    via: "web",
  });

// A loop with a waiting follow-up pair, made by the command itself.
async function withFollowUp(trx: Transaction<DB>, org: CommandOrg, over: Parameters<typeof commandLoop>[2] = {}) {
  const loop = await commandLoop(trx, org, over);
  const made = await draftFollowUp({ db: trx, now: () => FRIDAY }, org.ctx, {
    loopId: loop.id,
    userId: org.userId,
    via: "web",
  });
  expect(made.kind).toBe("planned");
  return { ...loop, sendId: made.kind === "planned" ? made.sendId : "" };
}

describe("laterLoop", () => {
  test("T9 three uses from Monday 17:00: Thursday, the next Tuesday, the next Friday (17:00 Warsaw); the fourth is limit_reached", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      // Due Monday 2026-11-23 17:00 Warsaw (16:00 UTC); now Friday 2026-11-20 09:00 Warsaw.
      const loop = await commandLoop(trx, org);
      const due = ["2026-11-26T16:00:00.000Z", "2026-12-01T16:00:00.000Z", "2026-12-04T16:00:00.000Z"];
      for (const [i, expected] of due.entries()) {
        const answer = await later(trx, org, loop.id);
        expect(answer.kind).toBe("ok");
        expect(answer.kind === "ok" ? answer.dueAt.toISOString() : "").toBe(expected);
        const row = await loopOf(trx, loop.id);
        expect([row.due_at.toISOString(), row.later_count]).toEqual([expected, i + 1]);
      }
      expect(await later(trx, org, loop.id)).toEqual({ kind: "limit_reached" });
      const row = await loopOf(trx, loop.id);
      expect([row.due_at.toISOString(), row.later_count]).toEqual([due[2] ?? "", 3]);
      const audit = await auditOf(trx, org.ctx.orgId, "loop.later");
      expect(audit).toHaveLength(3);
      expect(audit.every((entry) => entry.actor === org.userId)).toBe(true);
      expect(audit[0]?.data).toMatchObject({ loop_id: loop.id, kind: "waiting", later_count: 1, via: "web" });
    });
  });

  test("a due date in the past counts from now: Friday 09:00 plus three working days is Wednesday 17:00", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const loop = await commandLoop(trx, org, { due_at: new Date("2026-11-16T16:00:00Z") });
      const answer = await later(trx, org, loop.id);
      expect(answer.kind === "ok" ? answer.dueAt.toISOString() : "").toBe("2026-11-25T16:00:00.000Z");
    });
  });

  test("an assistant may tap Later; a delegated loop too; a promised loop and a closed loop may not", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const waiting = await commandLoop(trx, org);
      const delegated = await commandLoop(trx, org, { kind: "delegated" });
      const promised = await commandLoop(trx, org, { kind: "promised" });
      const closed = await commandLoop(trx, org, { status: "closed", close_reason: "done", closed_at: FRIDAY });
      expect((await later(trx, org, waiting.id, { userId: org.memberId })).kind).toBe("ok");
      expect((await later(trx, org, delegated.id)).kind).toBe("ok");
      expect(await later(trx, org, promised.id)).toEqual({ kind: "not_allowed" });
      expect(await later(trx, org, closed.id)).toEqual({ kind: "closed" });
      expect((await loopOf(trx, promised.id)).later_count).toBe(0);
      expect(await later(trx, org, waiting.id, { userId: randomUUID() })).toEqual({ kind: "not_allowed" });
    });
  });

  test("the flag off, an unknown id, a loop of another organization", async () => {
    await withRollback(db, async (trx) => {
      const off = await commandOrg(trx, { loopsFlag: false });
      const offLoop = await commandLoop(trx, off);
      expect(await later(trx, off, offLoop.id)).toEqual({ kind: "feature_off" });
      const org = await commandOrg(trx);
      const other = await commandOrg(trx);
      const loop = await commandLoop(trx, org);
      expect(await later(trx, org, randomUUID())).toEqual({ kind: "not_found" });
      expect(await later(trx, other, loop.id)).toEqual({ kind: "not_found" });
      expect((await loopOf(trx, loop.id)).later_count).toBe(0);
    });
  });
});

describe("doneLoop, dropLoop, untrackLoop", () => {
  test("T10 Done by an assistant closes `done` with the user; the second Done is already, with one audit row", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const loop = await commandLoop(trx, org);
      expect(await run(doneLoop, trx, org, loop.id, { userId: org.memberId })).toEqual({ kind: "ok" });
      const row = await loopOf(trx, loop.id);
      expect([row.status, row.close_reason, row.closed_by_user_id]).toEqual(["closed", "done", org.memberId]);
      expect(row.closed_at?.getTime()).toBe(FRIDAY.getTime());
      expect(await run(doneLoop, trx, org, loop.id)).toEqual({ kind: "already" });
      const audit = await auditOf(trx, org.ctx.orgId, "loop.closed");
      expect(audit).toHaveLength(1);
      expect(audit[0]?.data).toMatchObject({ loop_id: loop.id, reason: "done", via: "web" });
      expect(audit[0]?.actor).toBe(org.memberId);
    });
  });

  test("Done closes a promised loop too", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const loop = await commandLoop(trx, org, { kind: "promised" });
      expect(await run(doneLoop, trx, org, loop.id)).toEqual({ kind: "ok" });
    });
  });

  test("T11 Drop by an assistant is not allowed; an owner drops; a closed loop is already; a promised loop drops", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const loop = await commandLoop(trx, org);
      expect(await run(dropLoop, trx, org, loop.id, { userId: org.memberId })).toEqual({ kind: "not_allowed" });
      expect((await loopOf(trx, loop.id)).status).toBe("open");
      expect(await run(dropLoop, trx, org, loop.id)).toEqual({ kind: "ok" });
      expect((await loopOf(trx, loop.id)).close_reason).toBe("dropped");
      expect(await run(dropLoop, trx, org, loop.id)).toEqual({ kind: "already" });
      const promised = await commandLoop(trx, org, { kind: "promised" });
      expect(await run(dropLoop, trx, org, promised.id)).toEqual({ kind: "ok" });
    });
  });

  test("T13 Untrack of a waiting loop is not allowed; of a delegated loop it closes `untracked`; again is already", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const waiting = await commandLoop(trx, org);
      const delegated = await commandLoop(trx, org, { kind: "delegated" });
      expect(await run(untrackLoop, trx, org, waiting.id)).toEqual({ kind: "not_allowed" });
      expect((await loopOf(trx, waiting.id)).status).toBe("open");
      expect(await run(untrackLoop, trx, org, delegated.id, { userId: org.memberId })).toEqual({ kind: "not_allowed" });
      expect(await run(untrackLoop, trx, org, delegated.id)).toEqual({ kind: "ok" });
      expect((await loopOf(trx, delegated.id)).close_reason).toBe("untracked");
      expect(await run(untrackLoop, trx, org, delegated.id)).toEqual({ kind: "already" });
    });
  });

  test("a closed waiting loop: Untrack stays not_allowed (the kind decides first)", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const loop = await commandLoop(trx, org, { status: "closed", close_reason: "done", closed_at: FRIDAY });
      expect(await run(untrackLoop, trx, org, loop.id)).toEqual({ kind: "not_allowed" });
    });
  });

  for (const [name, command] of [
    ["Done", doneLoop],
    ["Drop", dropLoop],
    ["Untrack", untrackLoop],
  ] as const) {
    test(`T14 ${name} with a waiting follow-up: the send ends expired / loop_closed in the same call`, async () => {
      await withRollback(db, async (trx) => {
        const org = await commandOrg(trx);
        const loop = await withFollowUp(trx, org, { kind: name === "Untrack" ? "delegated" : "waiting" });
        expect(await run(command, trx, org, loop.id)).toEqual({ kind: "ok" });
        const send = (await actionsOfLoop(trx, loop.id)).find((row) => row.type === "send");
        expect([send?.status, send?.status_reason]).toEqual(["expired", "loop_closed"]);
      });
    });
  }

  test("T14b a follow-up that the committer holds (applying) is not expired by Done", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const loop = await withFollowUp(trx, org);
      await trx
        .updateTable("actions")
        .set({
          status: "applying",
          approved_at: FRIDAY,
          approved_by: org.userId,
          approved_via: "web",
          send_started_at: FRIDAY,
        })
        .where("id", "=", loop.sendId)
        .execute();
      expect(await run(doneLoop, trx, org, loop.id)).toEqual({ kind: "ok" });
      const send = (await actionsOfLoop(trx, loop.id)).find((row) => row.type === "send");
      expect(send?.status).toBe("applying");
    });
  });

  test("a closing command ends only the follow-up of its own loop", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const one = await withFollowUp(trx, org);
      const two = await withFollowUp(trx, org);
      await run(doneLoop, trx, org, one.id);
      const sendOf = async (id: string) => (await actionsOfLoop(trx, id)).find((row) => row.type === "send")?.status;
      expect([await sendOf(one.id), await sendOf(two.id)]).toEqual(["expired", "awaiting_approval"]);
    });
  });

  test("the flag off hides the loop: not_found, nothing changes", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx, { loopsFlag: false });
      const loop = await commandLoop(trx, org);
      for (const command of [doneLoop, dropLoop, untrackLoop, reopenLoop]) {
        expect(await run(command, trx, org, loop.id)).toEqual({ kind: "not_found" });
      }
      expect((await loopOf(trx, loop.id)).status).toBe("open");
    });
  });

  test("a loop of another organization and an unknown id are not_found", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const other = await commandOrg(trx);
      const loop = await commandLoop(trx, org);
      for (const command of [doneLoop, dropLoop, untrackLoop, reopenLoop]) {
        expect(await run(command, trx, other, loop.id)).toEqual({ kind: "not_found" });
        expect(await run(command, trx, org, randomUUID())).toEqual({ kind: "not_found" });
      }
      expect((await loopOf(trx, loop.id)).status).toBe("open");
    });
  });
});

describe("reopenLoop", () => {
  test("T12 a replied loop opens with its old due and counters; the wait starts again, so the reply does not close it again", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const loop = await commandLoop(trx, org, { later_count: 2, follow_ups_sent: 1 });
      const mail = await reply(trx, org, {
        from: ANNA,
        threadKey: loop.threadKey,
        at: new Date("2026-11-19T08:00:00Z"),
      });
      expect((await matchReplies({ db: trx }, org.ctx, org.mailboxId, { now: FRIDAY })).replied).toBe(1);
      const closed = await loopOf(trx, loop.id);
      expect([closed.status, closed.closed_by_email_id]).toEqual(["closed", mail]);
      expect(await run(reopenLoop, trx, org, loop.id)).toEqual({ kind: "ok" });
      const row = await loopOf(trx, loop.id);
      expect(row.status).toBe("open");
      expect([row.close_reason, row.closed_at, row.closed_by_email_id, row.closed_by_user_id]).toEqual([
        null,
        null,
        null,
        null,
      ]);
      expect([row.due_at.toISOString(), row.later_count, row.follow_ups_sent]).toEqual([
        "2026-11-23T16:00:00.000Z",
        2,
        1,
      ]);
      expect(row.wait_from_at.getTime()).toBe(FRIDAY.getTime());
      // The old reply is before the new wait: the next run leaves the loop open. A reply after the reopen closes it.
      expect((await matchReplies({ db: trx }, org.ctx, org.mailboxId, { now: FRIDAY })).replied).toBe(0);
      expect((await loopOf(trx, loop.id)).status).toBe("open");
      await reply(trx, org, { from: ANNA, threadKey: loop.threadKey, at: new Date("2026-11-20T09:00:00Z") });
      expect((await matchReplies({ db: trx }, org.ctx, org.mailboxId, { now: FRIDAY })).replied).toBe(1);
      const audit = await auditOf(trx, org.ctx.orgId, "loop.reopened");
      expect(audit).toHaveLength(1);
      expect(audit[0]?.data).toMatchObject({ loop_id: loop.id, via: "web" });
    });
  });

  test("T12b a sent_off loop is not allowed (the real hook, and a row with only the reason)", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const real = await commandLoop(trx, org);
      expect(await onSentOff(trx, org.ctx, { mailboxId: org.mailboxId, at: FRIDAY })).toBe(1);
      // The tracking is off after the hook in real life; turn it on to prove the reason alone refuses.
      await writeSentSwitch(trx, org.ctx, org.mailboxId, { enabled: true, at: FRIDAY });
      expect(await run(reopenLoop, trx, org, real.id)).toEqual({ kind: "not_allowed" });
      const bare = await commandLoop(trx, org, { status: "closed", close_reason: "sent_off", closed_at: FRIDAY });
      expect(await run(reopenLoop, trx, org, bare.id)).toEqual({ kind: "not_allowed" });
      expect((await loopOf(trx, bare.id)).status).toBe("closed");
    });
  });

  test("a loop with cleared texts is not allowed; an open loop is already; an assistant is not allowed", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const cleared = await commandLoop(trx, org, {
        status: "closed",
        close_reason: "done",
        closed_at: FRIDAY,
        texts_cleared_at: FRIDAY,
        subject: null,
        to_addresses: [],
        cc_addresses: [],
        counterpart: null,
        text: null,
      });
      expect(await run(reopenLoop, trx, org, cleared.id)).toEqual({ kind: "not_allowed" });
      const open = await commandLoop(trx, org);
      expect(await run(reopenLoop, trx, org, open.id)).toEqual({ kind: "already" });
      const done = await commandLoop(trx, org, { status: "closed", close_reason: "done", closed_at: FRIDAY });
      expect(await run(reopenLoop, trx, org, done.id, { userId: org.memberId })).toEqual({ kind: "not_allowed" });
      expect((await loopOf(trx, done.id)).status).toBe("closed");
    });
  });

  test("Sent tracking off: no reopen (an open loop would have nothing to close it)", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const done = await commandLoop(trx, org, { status: "closed", close_reason: "done", closed_at: FRIDAY });
      await writeSentSwitch(trx, org.ctx, org.mailboxId, { enabled: false, at: FRIDAY });
      expect(await run(reopenLoop, trx, org, done.id)).toEqual({ kind: "not_allowed" });
      await writeSentSwitch(trx, org.ctx, org.mailboxId, { enabled: true, at: FRIDAY });
      expect(await run(reopenLoop, trx, org, done.id)).toEqual({ kind: "ok" });
    });
  });
});

describe("the commands log ids and codes only", () => {
  test("a line per command: loop id, command, answer, via; none of the loop text or the addresses", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const secret = "Confidential reorganisation";
      const loop = await commandLoop(trx, org, { subject: secret, text: secret });
      const logs = captureLogs();
      try {
        await later(trx, org, loop.id);
        await run(doneLoop, trx, org, loop.id);
        await run(reopenLoop, trx, org, loop.id);
        const lines = eventLines(logs.lines, "loop_command");
        expect(lines.map((line) => `${String(line.command)}:${String(line.kind)}`)).toEqual([
          "later:ok",
          "done:ok",
          "reopen:ok",
        ]);
        expect(lines.every((line) => line.loop_id === loop.id && line.via === "web")).toBe(true);
        expect(logProblems(logs.lines, [secret, ANNA, JAN])).toEqual([]);
      } finally {
        logs.stop();
      }
    });
  });
});
