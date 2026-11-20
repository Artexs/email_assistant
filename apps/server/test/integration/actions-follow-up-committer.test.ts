import { MINUTE_MS, DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  applySend,
  claimActions,
  createFolderResolver,
  noDelegationHooks,
  type ApplyDeps,
  type ClaimedAction,
  type SendLimitHit,
} from "../../src/modules/actions";
import { loopHooks } from "../../src/modules/loops";
import { composeMessage } from "../../src/modules/mail";
import type { DB, Db } from "../../src/platform/db";

import {
  NOW,
  CREATED,
  at,
  MARKERS,
  Setup,
  setup,
  followUp,
  tap,
  committerOf,
  row,
  loopOf,
  draftsCount,
  prepare,
} from "./actions-follow-up-helpers";
import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The follow-up kind goes through the committer. A follow-up hangs on a loop (`loop_id`), not on a mail.
// Every test runs in a transaction that is rolled back: a committed loop row would break the Down guard of the migration test.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

async function auditOf(conn: Db | Transaction<DB>, actionId: string, event: string) {
  return conn
    .selectFrom("audit_log")
    .selectAll()
    .where("action_id", "=", actionId)
    .where("event", "=", event)
    .execute();
}

async function sentCount(s: Setup): Promise<number> {
  return (await s.fake.searchSinceIn("Sent", new Date(CREATED.getTime() - DAY_MS))).length;
}

// The applySend tests use one claimed action, as the crash tests of the other kinds do.
function applyDepsOf(s: Setup, conn: Db | Transaction<DB>, time: Date, over: Partial<ApplyDeps> = {}): ApplyDeps {
  return {
    db: conn,
    now: () => time,
    mailboxId: s.mailboxId,
    folders: createFolderResolver(
      { db: conn, now: () => time, provider: s.fake, mailboxId: s.mailboxId, folderMap: s.folderMap },
      s.ctx
    ),
    mailbox: { address: s.address, capabilities: { uidplus: true }, folderMap: s.folderMap },
    owner: { displayName: "Owner" },
    organization: { styleText: null, timezone: "Europe/Warsaw" },
    compose: composeMessage,
    sender: s.sender,
    hooks: noDelegationHooks,
    loopHooks: loopHooks(),
    appendFolders: new Set(),
    ...over,
  };
}

async function claimOne(trx: Transaction<DB>, s: Setup, id: string, time: Date): Promise<ClaimedAction> {
  const claimed = await claimActions(trx, s.ctx, s.mailboxId, {
    now: time,
    limit: 20,
    staleBefore: new Date(time.getTime() - 10 * MINUTE_MS),
    filter: { mailbox: { kind: "all" }, send: { kind: "all" } },
  });
  const action = claimed.find((entry) => entry.id === id);
  if (action === undefined) throw new Error("the action was not claimed");
  return action;
}

describe("T5 a follow-up through the committer", () => {
  test("the draft copy comes first; no mail goes out before the tap; then one mail to To and Cc, in the thread", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      const p = await followUp(trx, s, { cc: [MARKERS.jan, MARKERS.ewa] });
      const clock = { now: NOW };
      const committer = committerOf(trx, s, clock);

      // The draft is made while the send waits for the tap. Nothing is sent: the committer never sends without approval.
      await committer.run();
      expect(await draftsCount(s)).toBe(1);
      expect((await row(trx, p.draftId)).status).toBe("applied");
      expect((await row(trx, p.sendId)).status).toBe("awaiting_approval");
      clock.now = at(5);
      await committer.run();
      expect(s.sender.sent).toHaveLength(0);
      expect((await row(trx, p.sendId)).status).toBe("awaiting_approval");

      await tap(trx, s, p.sendId);
      clock.now = at(10);
      await committer.run();

      expect(s.sender.sent).toHaveLength(1);
      expect(s.sender.sent[0]?.envelope).toEqual({ from: s.address, to: [MARKERS.anna, MARKERS.jan, MARKERS.ewa] });
      const raw = s.sender.sent[0]?.raw.toString("latin1") ?? "";
      expect(raw).toContain(`To: ${MARKERS.anna}`);
      expect(raw.replace(/\r\n\s+/g, " ")).toContain(`Cc: ${MARKERS.jan}, ${MARKERS.ewa}`);
      expect(raw).toContain("In-Reply-To: <own-1@x.test>");
      expect(raw.replace(/\r\n\s+/g, " ")).toContain("References: <root@x.test> <own-1@x.test>");
      expect(raw).toMatch(new RegExp(`^x-ea-action-id: ${p.draftId}$`, "im"));
      const send = await row(trx, p.sendId);
      expect(send.status).toBe("applied");
      expect(send.email_id).toBeNull();
      expect(send.loop_id).toBe(p.loopId);
      expect(await sentCount(s)).toBe(1);

      // The loop counts the follow-up and waits again: at least 3 working days (Wed 25 Nov, 17:00 Warsaw).
      const loop = await loopOf(trx, p.loopId);
      expect(loop.follow_ups_sent).toBe(1);
      expect(loop.last_follow_up_at?.getTime()).toBe(at(10).getTime());
      expect(loop.wait_from_at.getTime()).toBe(at(10).getTime());
      expect(loop.due_at.toISOString()).toBe("2026-11-25T16:00:00.000Z");
      expect(loop.message_id).toBe(send.outgoing_message_id);
      expect(loop.references_ids).toEqual(["<root@x.test>", "<own-1@x.test>"]);
      expect(loop.status).toBe("open");
      // The audit rows of a loop action hold the action id and no mail id.
      const applied = await auditOf(trx, p.sendId, "action.applied");
      expect(applied).toHaveLength(1);
      expect(applied[0]?.email_id).toBeNull();
      expect(applied[0]?.data).toMatchObject({ kind: "follow_up", recipients: 3 });
    });
  });

  test("a second tap of the same send makes no second mail (the row is applied)", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      const p = await followUp(trx, s, { draftStatus: "applied", sendStatus: "approved" });
      await s.fake.appendMessage("Drafts", Buffer.from("x"), ["\\Draft"], CREATED);
      const clock = { now: NOW };
      const committer = committerOf(trx, s, clock);
      await committer.run();
      clock.now = at(3);
      await committer.run();
      expect(s.sender.sent).toHaveLength(1);
      expect((await loopOf(trx, p.loopId)).follow_ups_sent).toBe(1);
    });
  });
});

describe("T6 a loop that closes", () => {
  test("a loop closed after the tap: no SMTP, the send ends expired / loop_closed, the draft copy is removed", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      const p = await followUp(trx, s);
      const clock = { now: NOW };
      const committer = committerOf(trx, s, clock);
      await committer.run();
      expect(await draftsCount(s)).toBe(1);

      await tap(trx, s, p.sendId);
      await trx
        .updateTable("open_loops")
        .set({ status: "closed", close_reason: "replied", closed_at: at(1), updated_at: at(1) })
        .where("id", "=", p.loopId)
        .execute();
      clock.now = at(5);
      await committer.run();

      expect(s.sender.sent).toHaveLength(0);
      expect(await row(trx, p.sendId)).toMatchObject({
        status: "expired",
        status_reason: "loop_closed",
        locked_at: null,
      });
      const expired = await auditOf(trx, p.sendId, "action.expired");
      expect(expired).toHaveLength(1);
      expect(expired[0]).toMatchObject({ reason_code: "loop_closed", email_id: null });
      // The draft copy goes with it: a reverse row removes it.
      const reverses = await trx
        .selectFrom("actions")
        .selectAll()
        .where("reverses_action_id", "=", p.draftId)
        .execute();
      expect(reverses).toHaveLength(1);
      expect(reverses[0]).toMatchObject({ email_id: null, loop_id: p.loopId });
      clock.now = at(10);
      await committer.run();
      expect(await draftsCount(s)).toBe(0);
      expect((await row(trx, p.draftId)).status).toBe("undone");
      // The follow-up counters did not move.
      expect((await loopOf(trx, p.loopId)).follow_ups_sent).toBe(0);
    });
  });

  test("a loop that closes before the draft is made: no Drafts copy, the send and the draft end", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      const p = await followUp(trx, s, { loop: { status: "closed", close_reason: "done", closed_at: at(-30) } });
      const committer = committerOf(trx, s, { now: NOW });
      await committer.run();
      expect(await draftsCount(s)).toBe(0);
      expect(s.sender.sent).toHaveLength(0);
      expect(await row(trx, p.sendId)).toMatchObject({ status: "expired", status_reason: "loop_closed" });
      expect((await row(trx, p.draftId)).status).toBe("expired");
    });
  });

  test("a loop that is not in the mailbox of the committer run is not touched", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      const other = await createOrgWithMailbox(trx);
      const foreign: Setup = { ...s, ctx: { orgId: other.orgId }, mailboxId: other.mailboxId, userId: other.userId };
      const p = await followUp(trx, foreign, { draftStatus: "applied", sendStatus: "approved" });
      const committer = committerOf(trx, s, { now: NOW });
      await committer.run();
      expect(s.sender.sent).toHaveLength(0);
      expect(await row(trx, p.sendId)).toMatchObject({ status: "approved", locked_at: null });
    });
  });
});

describe("T7 the send limits count follow-ups and their Cc", () => {
  async function countedLoopSends(trx: Transaction<DB>, s: Setup, count: number, cc: string[]): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      const other = await followUp(trx, s, { cc, draftStatus: "applied", sendStatus: "applied" });
      await trx
        .updateTable("actions")
        .set({ send_started_at: at(-30 - index), applied_at: at(-30 - index) })
        .where("id", "=", other.sendId)
        .execute();
    }
  }

  test("a Cc recipient at its daily limit holds the follow-up: no SMTP, approved, one audit row", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      await countedLoopSends(trx, s, 5, [MARKERS.jan]);
      const p = await followUp(trx, s, { draftStatus: "applied", sendStatus: "approved", cc: [MARKERS.jan] });
      const hits: SendLimitHit[] = [];
      const committer = committerOf(trx, s, { now: NOW }, { onSendLimited: (_ctx, hit) => void hits.push(hit) });
      await committer.run();
      expect(s.sender.sent).toHaveLength(0);
      const held = await row(trx, p.sendId);
      expect(held).toMatchObject({ status: "approved", last_error: "send_limit:recipient_day", send_started_at: null });
      expect(hits).toHaveLength(1);
      expect(hits[0]?.limit).toBe("recipient_day");
      expect(await auditOf(trx, p.sendId, "action.send_limited")).toHaveLength(1);
    });
  });

  test("follow-ups that went out count in the mailbox limit: the next one is held, the To alone is not at a limit", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      // Two earlier follow-ups to other people used the hour of this mailbox.
      await countedLoopSends(trx, s, 2, [MARKERS.ewa]);
      const p = await followUp(trx, s, { draftStatus: "applied", sendStatus: "approved" });
      const limits = { mailboxHour: 2, mailboxDay: 100, recipientDay: 5 };
      await committerOf(trx, s, { now: NOW }, { sendLimits: limits }).run();
      expect(s.sender.sent).toHaveLength(0);
      expect(await row(trx, p.sendId)).toMatchObject({ status: "approved", last_error: "send_limit:mailbox_hour" });
    });
  });

  test("below the limits the same follow-up goes out", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      await countedLoopSends(trx, s, 1, [MARKERS.ewa]);
      const p = await followUp(trx, s, { draftStatus: "applied", sendStatus: "approved" });
      await s.fake.appendMessage("Drafts", Buffer.from("x"), ["\\Draft"], CREATED);
      const limits = { mailboxHour: 2, mailboxDay: 100, recipientDay: 5 };
      await committerOf(trx, s, { now: NOW }, { sendLimits: limits }).run();
      expect(s.sender.sent).toHaveLength(1);
      expect((await row(trx, p.sendId)).status).toBe("applied");
    });
  });
});

describe("T8 a crash after the SMTP call never sends a second mail and counts one follow-up", () => {
  test("a copy in Sent proves the send: the recovery ends applied, the loop counts one", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await followUp(trx, s, { draftStatus: "applied", sendStatus: "approved" });
      // The draft copy that the committer would have appended: the bytes of the message.
      const afterSend = () => {
        throw new Error("crash");
      };
      const first = await claimOne(trx, s, p.sendId, NOW);
      await expect(applySend(applyDepsOf(s, trx, NOW, { afterSend }), s.ctx, first, s.fake)).rejects.toThrow("crash");
      expect(s.sender.sent).toHaveLength(1);
      expect((await row(trx, p.sendId)).status).toBe("applying");
      expect((await loopOf(trx, p.loopId)).follow_ups_sent).toBe(0);

      // The mail server saved a copy in Sent.
      await s.fake.appendMessage("Sent", s.sender.sent[0]?.raw as Buffer, ["\\Seen"], NOW);
      const time = at(11);
      const again = await claimOne(trx, s, p.sendId, time);
      expect(await applySend(applyDepsOf(s, trx, time), s.ctx, again, s.fake)).toEqual({ kind: "applied" });
      expect(s.sender.sent).toHaveLength(1);
      expect((await row(trx, p.sendId)).status).toBe("applied");
      const loop = await loopOf(trx, p.loopId);
      expect(loop.follow_ups_sent).toBe(1);
      expect(loop.last_follow_up_at?.getTime()).toBe(time.getTime());
    });
  });

  test("no copy in Sent: the recovery ends outcome_unknown, no second mail, the loop is not counted", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await followUp(trx, s, { draftStatus: "applied", sendStatus: "approved" });
      const afterSend = () => {
        throw new Error("crash");
      };
      const first = await claimOne(trx, s, p.sendId, NOW);
      await expect(applySend(applyDepsOf(s, trx, NOW, { afterSend }), s.ctx, first, s.fake)).rejects.toThrow("crash");
      const time = at(11);
      const again = await claimOne(trx, s, p.sendId, time);
      expect(await applySend(applyDepsOf(s, trx, time, { sender: null }), s.ctx, again, s.fake)).toEqual({
        kind: "failed",
        reason: "outcome_unknown",
      });
      expect(s.sender.sent).toHaveLength(1);
      expect(await row(trx, p.sendId)).toMatchObject({ status: "failed", status_reason: "outcome_unknown" });
      expect((await loopOf(trx, p.loopId)).follow_ups_sent).toBe(0);
    });
  });
});
