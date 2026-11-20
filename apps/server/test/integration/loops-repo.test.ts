import { randomUUID } from "node:crypto";

import { DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  briefLoopsOf,
  closeLoop,
  decodeLoopCursor,
  getLoop,
  insertLoop,
  setLoopLater,
  listLoops,
  lockLoop,
  openLoopsByThread,
  reopenLoopRow,
  restartLoop,
  type NewLoop,
} from "../../src/modules/loops";
import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertDelegate, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { insertLoopRow, insertSentRow } from "./loops-fixtures";

// The repository of the loops (step 1): the unique key, the close and reopen rules, the audit rows and the
// organization filter of every function. The tests run without `app.org_id`, so only the `org_id` filter of the query
// stands between an organization and the loops of another one.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const AT = new Date("2026-11-20T10:00:00Z");
const SUBJECT = "Confidential reorganisation of the audit team";

interface Org {
  ctx: { orgId: string };
  userId: string;
  mailboxId: string;
}

async function newOrg(trx: Trx): Promise<Org> {
  const created = await createOrgWithMailbox(trx);
  return { ctx: { orgId: created.orgId }, userId: created.userId, mailboxId: created.mailboxId };
}

async function twoOrgs(trx: Trx): Promise<{ a: Org; b: Org }> {
  return { a: await newOrg(trx), b: await newOrg(trx) };
}

function newLoop(org: Org, sentEmailId: string | null, overrides: Partial<NewLoop> = {}): NewLoop {
  return {
    mailboxId: org.mailboxId,
    kind: "waiting",
    sentEmailId,
    threadKey: `<${randomUUID()}@x.test>`,
    messageId: `<${randomUUID()}@x.test>`,
    referencesIds: [],
    subject: SUBJECT,
    toAddresses: ["counterpart@x.test"],
    ccAddresses: [],
    counterpart: "counterpart@x.test",
    delegateId: null,
    text: "send the numbers",
    language: "en",
    dueAt: new Date("2026-11-24T16:00:00Z"),
    dueSource: "default",
    usualReplyDays: null,
    waitFromAt: AT,
    at: AT,
    ...overrides,
  };
}

async function auditOf(trx: Trx, org: Org, event: string) {
  return trx
    .selectFrom("audit_log")
    .select(["actor", "data", "created_at"])
    .where("org_id", "=", org.ctx.orgId)
    .where("event", "=", event)
    .orderBy("id")
    .execute();
}

async function row(trx: Trx, id: string) {
  return trx.selectFrom("open_loops").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

describe("insertLoop", () => {
  test("T1: a second insert with the same sent mail and kind returns exists and writes nothing", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const sent = await insertSentRow(trx, org.ctx, org.mailboxId);

      const first = await insertLoop(trx, org.ctx, newLoop(org, sent));
      const second = await insertLoop(trx, org.ctx, newLoop(org, sent));

      expect(first).toEqual({ id: expect.any(String) });
      expect(second).toEqual({ kind: "exists" });
      const rows = await trx.selectFrom("open_loops").select("id").where("org_id", "=", org.ctx.orgId).execute();
      expect(rows).toHaveLength(1);
      expect(await auditOf(trx, org, "loop.opened")).toHaveLength(1);
    });
  });

  test("T1: another kind of the same sent mail is a new loop; a loop without a sent mail never conflicts", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const sent = await insertSentRow(trx, org.ctx, org.mailboxId);

      const waiting = await insertLoop(trx, org.ctx, newLoop(org, sent));
      const promised = await insertLoop(trx, org.ctx, newLoop(org, sent, { kind: "promised" }));
      const none1 = await insertLoop(trx, org.ctx, newLoop(org, null));
      const none2 = await insertLoop(trx, org.ctx, newLoop(org, null));

      for (const result of [waiting, promised, none1, none2]) expect(result).toHaveProperty("id");
    });
  });

  test("the row holds the given values; the audit row holds ids and codes only", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const sent = await insertSentRow(trx, org.ctx, org.mailboxId);
      const input = newLoop(org, sent, { ccAddresses: ["cc@x.test"], referencesIds: ["<a@x.test>"] });

      const result = await insertLoop(trx, org.ctx, input);
      if (!("id" in result)) throw new Error("not inserted");

      const loop = await getLoop(trx, org.ctx, result.id);
      expect(loop).toMatchObject({
        org_id: org.ctx.orgId,
        mailbox_id: org.mailboxId,
        kind: "waiting",
        status: "open",
        sent_email_id: sent,
        thread_key: input.threadKey,
        message_id: input.messageId,
        references_ids: ["<a@x.test>"],
        subject: SUBJECT,
        to_addresses: ["counterpart@x.test"],
        cc_addresses: ["cc@x.test"],
        counterpart: "counterpart@x.test",
        text: "send the numbers",
        language: "en",
        due_source: "default",
        later_count: 0,
        follow_ups_sent: 0,
      });
      expect(loop?.due_at.getTime()).toBe(input.dueAt.getTime());
      expect(loop?.wait_from_at.getTime()).toBe(AT.getTime());
      expect(loop?.created_at.getTime()).toBe(AT.getTime());
      const audit = await auditOf(trx, org, "loop.opened");
      expect(audit[0]).toMatchObject({ actor: "system", data: { loop_id: result.id, kind: "waiting" } });
      expect(audit[0]?.created_at.getTime()).toBe(AT.getTime());
      const text = JSON.stringify(audit);
      expect(text).not.toContain(SUBJECT);
      expect(text).not.toContain("@x.test");
    });
  });
});

describe("lockLoop and getLoop", () => {
  test("return the row of the own organization and nothing for another one", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await twoOrgs(trx);
      const id = await insertLoopRow(trx, a.ctx, a.mailboxId);

      expect((await lockLoop(trx, a.ctx, id))?.id).toBe(id);
      expect((await getLoop(trx, a.ctx, id))?.id).toBe(id);
      expect(await lockLoop(trx, b.ctx, id)).toBeUndefined();
      expect(await getLoop(trx, b.ctx, id)).toBeUndefined();
      expect(await getLoop(trx, a.ctx, randomUUID())).toBeUndefined();
    });
  });
});

describe("closeLoop", () => {
  test("T2: closes with the reason, the closer and one audit row; a second close is already and adds no row", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const id = await insertLoopRow(trx, org.ctx, org.mailboxId);

      expect(await closeLoop(trx, org.ctx, { loopId: id, reason: "replied_subject", userId: org.userId, at: AT })).toBe(
        "closed"
      );
      expect(await closeLoop(trx, org.ctx, { loopId: id, reason: "dropped", userId: org.userId, at: AT })).toBe(
        "already"
      );

      const loop = await row(trx, id);
      expect(loop).toMatchObject({ status: "closed", close_reason: "replied_subject", closed_by_user_id: org.userId });
      expect(loop.closed_at?.getTime()).toBe(AT.getTime());
      const audit = await auditOf(trx, org, "loop.closed");
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actor: org.userId,
        data: { loop_id: id, kind: "waiting", reason: "replied_subject" },
      });
    });
  });

  test("a close by a mail sets closed_by_email_id; a close by the system has the actor system", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const id = await insertLoopRow(trx, org.ctx, org.mailboxId);
      const emailId = await insertTestEmail(trx, org.ctx, org.mailboxId, { status: "done" });

      await closeLoop(trx, org.ctx, { loopId: id, reason: "replied", emailId, at: AT });

      expect(await row(trx, id)).toMatchObject({ closed_by_email_id: emailId, closed_by_user_id: null });
      expect((await auditOf(trx, org, "loop.closed"))[0]?.actor).toBe("system");
    });
  });

  test("a loop of another organization is not closed and writes no audit row", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await twoOrgs(trx);
      const id = await insertLoopRow(trx, a.ctx, a.mailboxId);

      expect(await closeLoop(trx, b.ctx, { loopId: id, reason: "done", at: AT })).toBe("already");

      expect((await row(trx, id)).status).toBe("open");
      expect(await auditOf(trx, b, "loop.closed")).toHaveLength(0);
      expect(await auditOf(trx, a, "loop.closed")).toHaveLength(0);
    });
  });
});

describe("reopenLoopRow", () => {
  test("T3: a replied loop opens again with the old due date, later_count and follow_ups_sent", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const due = new Date("2026-11-18T16:00:00Z");
      const id = await insertLoopRow(trx, org.ctx, org.mailboxId, {
        due_at: due,
        later_count: 2,
        follow_ups_sent: 1,
      });
      await closeLoop(trx, org.ctx, { loopId: id, reason: "replied", at: AT });

      const result = await reopenLoopRow(trx, org.ctx, { loopId: id, userId: org.userId, at: AT });

      expect(result).toBe("ok");
      const loop = await row(trx, id);
      expect(loop).toMatchObject({
        status: "open",
        close_reason: null,
        closed_at: null,
        closed_by_email_id: null,
        closed_by_user_id: null,
        later_count: 2,
        follow_ups_sent: 1,
      });
      expect(loop.due_at.getTime()).toBe(due.getTime());
      const audit = await auditOf(trx, org, "loop.reopened");
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actor: org.userId, data: { loop_id: id, kind: "waiting" } });
    });
  });

  test("a close by a user clears closed_by_user_id on reopen", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const id = await insertLoopRow(trx, org.ctx, org.mailboxId);
      await closeLoop(trx, org.ctx, { loopId: id, reason: "dropped", userId: org.userId, at: AT });

      await reopenLoopRow(trx, org.ctx, { loopId: id, at: AT });

      expect((await row(trx, id)).closed_by_user_id).toBeNull();
    });
  });

  test("a loop with cleared texts is not_allowed; an open loop is already; an unknown id is not_found", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const cleared = await insertLoopRow(trx, org.ctx, org.mailboxId, {
        status: "closed",
        close_reason: "replied",
        closed_at: AT,
        texts_cleared_at: AT,
        subject: null,
        text: null,
      });
      const open = await insertLoopRow(trx, org.ctx, org.mailboxId);

      expect(await reopenLoopRow(trx, org.ctx, { loopId: cleared, at: AT })).toBe("not_allowed");
      expect(await reopenLoopRow(trx, org.ctx, { loopId: open, at: AT })).toBe("already");
      expect(await reopenLoopRow(trx, org.ctx, { loopId: randomUUID(), at: AT })).toBe("not_found");

      expect((await row(trx, cleared)).status).toBe("closed");
      expect(await auditOf(trx, org, "loop.reopened")).toHaveLength(0);
    });
  });

  test("a loop of another organization is not_found and stays closed", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await twoOrgs(trx);
      const id = await insertLoopRow(trx, a.ctx, a.mailboxId, {
        status: "closed",
        close_reason: "done",
        closed_at: AT,
      });

      expect(await reopenLoopRow(trx, b.ctx, { loopId: id, at: AT })).toBe("not_found");

      expect((await row(trx, id)).status).toBe("closed");
    });
  });
});

describe("setLoopLater", () => {
  test("moves the due date, counts the use, writes loop.later; the fourth use is limit_reached", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const id = await insertLoopRow(trx, org.ctx, org.mailboxId);
      const due = (n: number) => new Date(AT.getTime() + n * DAY_MS);

      for (const n of [1, 2, 3]) {
        expect(await setLoopLater(trx, org.ctx, { loopId: id, dueAt: due(n), userId: org.userId, at: AT })).toBe("ok");
      }
      expect(await setLoopLater(trx, org.ctx, { loopId: id, dueAt: due(4), at: AT })).toBe("limit_reached");

      const loop = await row(trx, id);
      expect(loop.later_count).toBe(3);
      expect(loop.due_at.getTime()).toBe(due(3).getTime());
      const audit = await auditOf(trx, org, "loop.later");
      expect(audit.map((entry) => entry.data)).toEqual([
        { loop_id: id, kind: "waiting", later_count: 1 },
        { loop_id: id, kind: "waiting", later_count: 2 },
        { loop_id: id, kind: "waiting", later_count: 3 },
      ]);
    });
  });

  test("a closed loop and a loop of another organization are closed and unchanged", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await twoOrgs(trx);
      const open = await insertLoopRow(trx, a.ctx, a.mailboxId);
      const closed = await insertLoopRow(trx, a.ctx, a.mailboxId, {
        status: "closed",
        close_reason: "done",
        closed_at: AT,
      });
      const before = (await row(trx, open)).due_at;

      expect(await setLoopLater(trx, a.ctx, { loopId: closed, dueAt: AT, at: AT })).toBe("closed");
      expect(await setLoopLater(trx, b.ctx, { loopId: open, dueAt: AT, at: AT })).toBe("closed");

      expect((await row(trx, open)).due_at.getTime()).toBe(before.getTime());
      expect((await row(trx, open)).later_count).toBe(0);
    });
  });
});

describe("restartLoop", () => {
  test("sets the newest own mail, the message ids, the wait and the due date; keeps the recipients and the opening mail", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const opening = await insertSentRow(trx, org.ctx, org.mailboxId);
      const later = await insertSentRow(trx, org.ctx, org.mailboxId);
      const id = await insertLoopRow(trx, org.ctx, org.mailboxId, {
        sent_email_id: opening,
        cc_addresses: ["cc@x.test"],
      });
      const waitFrom = new Date("2026-11-19T09:00:00Z");
      const dueAt = new Date("2026-11-24T16:00:00Z");

      const ok = await restartLoop(trx, org.ctx, {
        loopId: id,
        sentEmailId: later,
        messageId: "<new@x.test>",
        referencesIds: ["<old@x.test>", "<new@x.test>"],
        waitFrom,
        dueAt,
      });

      expect(ok).toBe(true);
      const loop = await row(trx, id);
      expect(loop).toMatchObject({
        sent_email_id: opening,
        last_sent_email_id: later,
        message_id: "<new@x.test>",
        references_ids: ["<old@x.test>", "<new@x.test>"],
        to_addresses: ["counterpart@x.test"],
        cc_addresses: ["cc@x.test"],
        status: "open",
      });
      expect(loop.wait_from_at.getTime()).toBe(waitFrom.getTime());
      expect(loop.due_at.getTime()).toBe(dueAt.getTime());
      const audit = await auditOf(trx, org, "loop.restarted");
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actor: "system", data: { loop_id: id, kind: "waiting" } });
    });
  });

  test("keeps surfaced_at: the loop was shown, a restart does not hide that", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const sent = await insertSentRow(trx, org.ctx, org.mailboxId);
      const surfaced = new Date("2026-11-18T08:00:00Z");
      const id = await insertLoopRow(trx, org.ctx, org.mailboxId, { surfaced_at: surfaced });

      const ok = await restartLoop(trx, org.ctx, {
        loopId: id,
        sentEmailId: sent,
        messageId: "<new@x.test>",
        referencesIds: [],
        waitFrom: AT,
        dueAt: new Date("2026-11-24T16:00:00Z"),
      });

      expect(ok).toBe(true);
      expect((await row(trx, id)).surfaced_at?.getTime()).toBe(surfaced.getTime());
    });
  });

  test("a closed loop and a loop of another organization do not restart", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await twoOrgs(trx);
      const sent = await insertSentRow(trx, a.ctx, a.mailboxId);
      const open = await insertLoopRow(trx, a.ctx, a.mailboxId);
      const closed = await insertLoopRow(trx, a.ctx, a.mailboxId, {
        status: "closed",
        close_reason: "done",
        closed_at: AT,
      });
      const input = (loopId: string) => ({
        loopId,
        sentEmailId: sent,
        messageId: "<new@x.test>",
        referencesIds: [],
        waitFrom: AT,
        dueAt: AT,
      });

      expect(await restartLoop(trx, a.ctx, input(closed))).toBe(false);
      expect(await restartLoop(trx, b.ctx, input(open))).toBe(false);

      expect((await row(trx, open)).last_sent_email_id).toBeNull();
      expect((await row(trx, closed)).last_sent_email_id).toBeNull();
      expect(await auditOf(trx, a, "loop.restarted")).toHaveLength(0);
    });
  });
});

describe("openLoopsByThread", () => {
  test("T4: returns the open rows of the threads, of every kind, and no closed row, other mailbox or other organization", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await twoOrgs(trx);
      const otherMailbox = (await newOrg(trx)).mailboxId;
      const thread = `<${randomUUID()}@x.test>`;
      const waiting = await insertLoopRow(trx, a.ctx, a.mailboxId, { thread_key: thread });
      const promised = await insertLoopRow(trx, a.ctx, a.mailboxId, { thread_key: thread, kind: "promised" });
      await insertLoopRow(trx, a.ctx, a.mailboxId, {
        thread_key: thread,
        status: "closed",
        close_reason: "replied",
        closed_at: AT,
      });
      await insertLoopRow(trx, a.ctx, a.mailboxId, { thread_key: `<${randomUUID()}@x.test>` });
      // A mailbox id of another organization, and a row of another organization in the same thread key.
      await insertLoopRow(trx, b.ctx, b.mailboxId, { thread_key: thread });

      const rows = await openLoopsByThread(trx, a.ctx, a.mailboxId, [thread]);

      expect(rows.map((r) => r.id).sort()).toEqual([waiting, promised].sort());
      expect(await openLoopsByThread(trx, a.ctx, otherMailbox, [thread])).toEqual([]);
      expect(await openLoopsByThread(trx, b.ctx, a.mailboxId, [thread])).toEqual([]);
      expect(await openLoopsByThread(trx, a.ctx, a.mailboxId, [])).toEqual([]);
    });
  });
});

describe("listLoops", () => {
  test("T5: limit 2 over 3 rows gives 2 rows and a cursor; the cursor gives the third row and no next", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const ids: string[] = [];
      for (const day of [22, 21, 23]) {
        ids.push(await insertLoopRow(trx, org.ctx, org.mailboxId, { due_at: new Date(`2026-11-${day}T16:00:00Z`) }));
      }
      const [d22, d21, d23] = ids as [string, string, string];

      const first = await listLoops(trx, org.ctx, { filter: "open", now: AT, limit: 2 });

      expect(first.items.map((r) => r.id)).toEqual([d21, d22]);
      expect(first.next).not.toBeNull();
      const cursor = decodeLoopCursor(first.next ?? "");
      expect(cursor?.id).toBe(d22);
      const second = await listLoops(trx, org.ctx, {
        filter: "open",
        now: AT,
        limit: 2,
        ...(cursor ? { before: cursor } : {}),
      });
      expect(second.items.map((r) => r.id)).toEqual([d23]);
      expect(second.next).toBeNull();
    });
  });

  test("rows with the same due date page by id without a gap or a repeat", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const due = new Date("2026-11-22T16:00:00Z");
      const ids: string[] = [];
      for (let i = 0; i < 5; i += 1) ids.push(await insertLoopRow(trx, org.ctx, org.mailboxId, { due_at: due }));

      const seen: string[] = [];
      let before: ReturnType<typeof decodeLoopCursor> = null;
      for (let page = 0; page < 5; page += 1) {
        const result = await listLoops(trx, org.ctx, {
          filter: "open",
          now: AT,
          limit: 2,
          ...(before ? { before } : {}),
        });
        seen.push(...result.items.map((r) => r.id));
        if (result.next === null) break;
        before = decodeLoopCursor(result.next);
      }

      expect(seen).toEqual([...ids].sort());
    });
  });

  test("the filters pick open, due and closed rows and the kind; another organization is never listed", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await twoOrgs(trx);
      const late = await insertLoopRow(trx, a.ctx, a.mailboxId, { due_at: new Date("2026-11-19T16:00:00Z") });
      const future = await insertLoopRow(trx, a.ctx, a.mailboxId, {
        due_at: new Date("2026-11-25T16:00:00Z"),
        kind: "promised",
      });
      const closed = await insertLoopRow(trx, a.ctx, a.mailboxId, {
        status: "closed",
        close_reason: "done",
        closed_at: AT,
      });
      await insertLoopRow(trx, b.ctx, b.mailboxId, { due_at: new Date("2026-11-19T16:00:00Z") });
      const ids = async (opts: Parameters<typeof listLoops>[2]) =>
        (await listLoops(trx, a.ctx, opts)).items.map((r) => r.id);

      expect(await ids({ filter: "open", now: AT, limit: 10 })).toEqual([late, future]);
      expect(await ids({ filter: "due", now: AT, limit: 10 })).toEqual([late]);
      expect(await ids({ filter: "closed", now: AT, limit: 10 })).toEqual([closed]);
      expect(await ids({ filter: "open", kind: "promised", now: AT, limit: 10 })).toEqual([future]);
      expect((await listLoops(trx, b.ctx, { filter: "open", now: AT, limit: 10 })).items).toHaveLength(1);
    });
  });
});

describe("decodeLoopCursor", () => {
  test("refuses text that is not a cursor", () => {
    for (const text of ["", "not a cursor", "a|b", Buffer.from("x|y").toString("base64url")]) {
      expect(decodeLoopCursor(text)).toBeNull();
    }
    const id = randomUUID();
    const good = Buffer.from(`2026-11-22T16:00:00.000Z|${id}`).toString("base64url");
    expect(decodeLoopCursor(good)?.id).toBe(id);
    const rolled = Buffer.from(`2026-02-30T16:00:00.000Z|${id}`).toString("base64url");
    expect(decodeLoopCursor(rolled)).toBeNull();
  });
});

describe("briefLoopsOf", () => {
  // Fri 2026-11-20 08:00 in Warsaw (07:00Z): the local day ends at 23:00Z.
  const NOW = new Date("2026-11-20T07:00:00Z");
  const zone = "Europe/Warsaw";

  test("waiting and delegated loops due by the end of the local day, promised loops and unnamed stale loops, oldest due first", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const delegateId = await insertDelegate(trx, org.ctx);
      const late = await insertLoopRow(trx, org.ctx, org.mailboxId, { due_at: new Date("2026-11-18T16:00:00Z") });
      const today = await insertLoopRow(trx, org.ctx, org.mailboxId, { due_at: new Date("2026-11-20T16:00:00Z") });
      const delegated = await insertLoopRow(trx, org.ctx, org.mailboxId, {
        kind: "delegated",
        delegate_id: delegateId,
        due_at: new Date("2026-11-19T16:00:00Z"),
      });
      const promised = await insertLoopRow(trx, org.ctx, org.mailboxId, {
        kind: "promised",
        due_at: new Date("2026-11-20T10:00:00Z"),
      });
      // Not in the brief: due after the local day ends (23:00Z), a closed loop, a stale loop already named.
      await insertLoopRow(trx, org.ctx, org.mailboxId, { due_at: new Date("2026-11-20T23:00:00Z") });
      await insertLoopRow(trx, org.ctx, org.mailboxId, {
        status: "closed",
        close_reason: "done",
        closed_at: AT,
        due_at: new Date("2026-11-18T16:00:00Z"),
      });
      const stale = await insertLoopRow(trx, org.ctx, org.mailboxId, {
        status: "closed",
        close_reason: "stale",
        closed_at: AT,
      });
      await insertLoopRow(trx, org.ctx, org.mailboxId, {
        status: "closed",
        close_reason: "stale",
        closed_at: AT,
        stale_notified_at: AT,
      });

      const brief = await briefLoopsOf(trx, org.ctx, [org.mailboxId], { now: NOW, timeZone: zone });

      expect(brief.waiting.rows.map((r) => r.id)).toEqual([late, delegated, today]);
      expect(brief.waiting.total).toBe(3);
      expect(brief.promised.rows.map((r) => r.id)).toEqual([promised]);
      expect(brief.stale.rows.map((r) => r.id)).toEqual([stale]);
      expect(brief.stale.total).toBe(1);
    });
  });

  test("only the given mailboxes and only the organization of the context", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await twoOrgs(trx);
      const mine = await insertLoopRow(trx, a.ctx, a.mailboxId, { due_at: new Date("2026-11-19T16:00:00Z") });
      await insertLoopRow(trx, b.ctx, b.mailboxId, { due_at: new Date("2026-11-19T16:00:00Z") });

      const own = await briefLoopsOf(trx, a.ctx, [a.mailboxId], { now: NOW, timeZone: zone });
      // The mailbox of the other organization named by id: the org filter still hides its rows.
      const cross = await briefLoopsOf(trx, a.ctx, [b.mailboxId], { now: NOW, timeZone: zone });
      const none = await briefLoopsOf(trx, a.ctx, [], { now: NOW, timeZone: zone });

      expect(own.waiting.rows.map((r) => r.id)).toEqual([mine]);
      expect(cross.waiting.total).toBe(0);
      expect(none).toEqual({
        waiting: { rows: [], total: 0 },
        promised: { rows: [], total: 0 },
        stale: { rows: [], total: 0 },
      });
    });
  });
});
