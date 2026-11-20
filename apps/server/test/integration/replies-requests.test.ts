import { MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  claimReplyRequests,
  countRedrafts,
  createReplyRequest,
  finishReplyRequest,
  listReplyRequestsOfEmail,
  releaseReplyRequest,
  REPLY_CLAIM_STALE_MS,
} from "../../src/modules/replies";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { insertReplyRequest } from "./reply-fixtures";

// The repository of `reply_requests` (claim, finish, release, list, count).
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const NOW = new Date("2026-11-18T10:00:00Z");
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);

async function newOrg(trx: Trx) {
  const created = await createOrgWithMailbox(trx);
  return { ctx: { orgId: created.orgId } satisfies TenantContext, ...created };
}

// A mail and a request for it. The status and the claim time are set by the caller.
async function request(trx: Trx, org: Awaited<ReturnType<typeof newOrg>>, overrides: Record<string, unknown> = {}) {
  const emailId = await insertTestEmail(trx, org.ctx, org.mailboxId);
  const id = await insertReplyRequest(trx, org.ctx, org.mailboxId, emailId, overrides);
  return { id, emailId };
}

async function rowOf(trx: Trx, id: string) {
  return trx.selectFrom("reply_requests").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

describe("createReplyRequest", () => {
  test("an automatic request is made once for a mail; a tap and a redraft repeat", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const emailId = await insertTestEmail(trx, org.ctx, org.mailboxId);
      const base = { mailboxId: org.mailboxId, emailId, threadKey: "t1", folder: "INBOX" };

      const first = await createReplyRequest(trx, org.ctx, { ...base, trigger: "auto" });
      expect(first).not.toBeNull();
      expect(await createReplyRequest(trx, org.ctx, { ...base, trigger: "auto" })).toBeNull();
      const tap = await createReplyRequest(trx, org.ctx, {
        ...base,
        trigger: "tap",
        instruction: "Say yes",
        requestedBy: org.userId,
      });
      const again = await createReplyRequest(trx, org.ctx, { ...base, trigger: "tap" });
      expect(tap).not.toBeNull();
      expect(again).not.toBeNull();
      expect(again).not.toBe(tap);

      const row = await rowOf(trx, first ?? "");
      expect(row).toMatchObject({
        status: "pending",
        attempts: 0,
        trigger: "auto",
        requested_by: null,
        instruction: null,
      });
      expect(await rowOf(trx, tap ?? "")).toMatchObject({ instruction: "Say yes", requested_by: org.userId });
    });
  });
});

describe("claimReplyRequests", () => {
  test("1. two parallel claims of 4 pending rows take each row once", async () => {
    // The test commits its data and uses two connections: a row lock only shows between two connections.
    const org = await db.transaction().execute(async (trx) => {
      const created = await newOrg(trx);
      const ids: string[] = [];
      for (let index = 0; index < 4; index += 1)
        ids.push((await request(trx, created, { next_attempt_at: ago(MINUTE_MS) })).id);
      return { ...created, ids };
    });
    try {
      const [first, second] = await Promise.all([
        claimReplyRequests(db, org.ctx, { mailboxId: org.mailboxId, now: NOW, limit: 3 }),
        claimReplyRequests(db, org.ctx, { mailboxId: org.mailboxId, now: NOW, limit: 3 }),
      ]);
      const claimed = [...first, ...second].map((row) => row.id);
      expect(new Set(claimed).size).toBe(claimed.length);
      expect(claimed.length).toBe(4);
      expect([...claimed].sort()).toEqual([...org.ids].sort());
      const rows = await db.selectFrom("reply_requests").selectAll().where("org_id", "=", org.orgId).execute();
      expect(rows.every((row) => row.status === "drafting" && row.attempts === 0)).toBe(true);
    } finally {
      await db.deleteFrom("organizations").where("id", "=", org.orgId).execute();
      await db.deleteFrom("users").where("id", "=", org.userId).execute();
    }
  });

  test("a row that another open transaction holds locked is skipped, not waited for; it is claimed after that transaction ends", async () => {
    const org = await db.transaction().execute(async (trx) => {
      const created = await newOrg(trx);
      const held = await request(trx, created, { next_attempt_at: ago(MINUTE_MS), created_at: ago(3 * MINUTE_MS) });
      const free = await request(trx, created, { next_attempt_at: ago(MINUTE_MS), created_at: ago(2 * MINUTE_MS) });
      return { ...created, held: held.id, free: free.id };
    });
    try {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked!: () => void;
      const hasLock = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const holder = db.transaction().execute(async (trx) => {
        await trx.selectFrom("reply_requests").select("id").where("id", "=", org.held).forUpdate().execute();
        locked();
        await gate;
      });
      await hasLock;
      // Without SKIP LOCKED this call waits for the holder, and the holder waits for this call: the test times out.
      const claimed = await claimReplyRequests(db, org.ctx, { mailboxId: org.mailboxId, now: NOW, limit: 10 });
      expect(claimed.map((row) => row.id)).toEqual([org.free]);
      release();
      await holder;
      const next = await claimReplyRequests(db, org.ctx, { mailboxId: org.mailboxId, now: NOW, limit: 10 });
      expect(next.map((row) => row.id)).toEqual([org.held]);
    } finally {
      await db.deleteFrom("organizations").where("id", "=", org.orgId).execute();
      await db.deleteFrom("users").where("id", "=", org.userId).execute();
    }
  });

  test("2. a drafting row locked 6 min ago is claimed again with attempts + 1; one locked 4 min ago is not", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const stale = await request(trx, org, { status: "drafting", locked_at: ago(6 * MINUTE_MS), attempts: 1 });
      const live = await request(trx, org, { status: "drafting", locked_at: ago(4 * MINUTE_MS), attempts: 1 });

      const claimed = await claimReplyRequests(trx, org.ctx, { mailboxId: org.mailboxId, now: NOW, limit: 10 });

      expect(claimed.map((row) => row.id)).toEqual([stale.id]);
      expect(claimed[0]).toMatchObject({ status: "drafting", attempts: 2 });
      expect(claimed[0]?.locked_at?.getTime()).toBe(NOW.getTime());
      expect(await rowOf(trx, live.id)).toMatchObject({ attempts: 1, status: "drafting" });
      expect(REPLY_CLAIM_STALE_MS).toBe(5 * MINUTE_MS);
    });
  });

  test("a pending row counts no attempt; a future next_attempt_at, a finished row and another mailbox or org are not claimed", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const other = await newOrg(trx);
      const due = await request(trx, org, { next_attempt_at: ago(MINUTE_MS) });
      const later = await request(trx, org, { next_attempt_at: new Date(NOW.getTime() + MINUTE_MS) });
      const done = await request(trx, org, { status: "done" });
      const foreign = await request(trx, other, { next_attempt_at: ago(MINUTE_MS) });

      const claimed = await claimReplyRequests(trx, org.ctx, { mailboxId: org.mailboxId, now: NOW, limit: 10 });
      expect(claimed.map((row) => row.id)).toEqual([due.id]);
      expect(claimed[0]?.attempts).toBe(0);
      // The org filter holds even for the id of a mailbox of another org.
      expect(await claimReplyRequests(trx, org.ctx, { mailboxId: other.mailboxId, now: NOW, limit: 10 })).toEqual([]);
      expect((await rowOf(trx, later.id)).status).toBe("pending");
      expect((await rowOf(trx, done.id)).status).toBe("done");
      expect((await rowOf(trx, foreign.id)).status).toBe("pending");
    });
  });

  test("the limit and the order: oldest first", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const old = await request(trx, org, { created_at: ago(3 * MINUTE_MS), next_attempt_at: ago(MINUTE_MS) });
      const mid = await request(trx, org, { created_at: ago(2 * MINUTE_MS), next_attempt_at: ago(MINUTE_MS) });
      await request(trx, org, { created_at: ago(MINUTE_MS), next_attempt_at: ago(MINUTE_MS) });
      const claimed = await claimReplyRequests(trx, org.ctx, { mailboxId: org.mailboxId, now: NOW, limit: 2 });
      expect(claimed.map((row) => row.id)).toEqual([old.id, mid.id]);
    });
  });
});

describe("finishReplyRequest and releaseReplyRequest", () => {
  test("finish ends only the claim that holds the row; a lost claim changes nothing", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const { id } = await request(trx, org, { next_attempt_at: ago(MINUTE_MS) });
      const [claimed] = await claimReplyRequests(trx, org.ctx, { mailboxId: org.mailboxId, now: NOW, limit: 1 });
      const lockedAt = claimed?.locked_at ?? NOW;

      const wrong = new Date(NOW.getTime() + 1);
      expect(await finishReplyRequest(trx, org.ctx, id, wrong, { status: "done", now: NOW })).toBe(false);
      expect((await rowOf(trx, id)).status).toBe("drafting");
      expect(
        await finishReplyRequest(trx, org.ctx, id, lockedAt, {
          status: "no_draft",
          reasonCode: "needs_facts",
          now: NOW,
        })
      ).toBe(true);
      expect(await rowOf(trx, id)).toMatchObject({ status: "no_draft", reason_code: "needs_facts", locked_at: null });
      // A second finish finds no claim.
      expect(await finishReplyRequest(trx, org.ctx, id, lockedAt, { status: "done", now: NOW })).toBe(false);
    });
  });

  test("release gives the row back with the time of the next try; the attempt counts only when asked", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const a = await request(trx, org, { next_attempt_at: ago(MINUTE_MS) });
      const b = await request(trx, org, { next_attempt_at: ago(MINUTE_MS) });
      const claimed = await claimReplyRequests(trx, org.ctx, { mailboxId: org.mailboxId, now: NOW, limit: 2 });
      const next = new Date(NOW.getTime() + 5 * MINUTE_MS);

      expect(
        await releaseReplyRequest(trx, org.ctx, a.id, NOW, { nextAttemptAt: next, countAttempt: true, now: NOW })
      ).toBe(true);
      expect(
        await releaseReplyRequest(trx, org.ctx, b.id, NOW, { nextAttemptAt: next, countAttempt: false, now: NOW })
      ).toBe(true);
      expect(claimed).toHaveLength(2);
      expect(await rowOf(trx, a.id)).toMatchObject({ status: "pending", attempts: 1, locked_at: null });
      expect((await rowOf(trx, a.id)).next_attempt_at.getTime()).toBe(next.getTime());
      expect(await rowOf(trx, b.id)).toMatchObject({ status: "pending", attempts: 0 });
      // The row is no longer claimed: a second release changes nothing.
      expect(
        await releaseReplyRequest(trx, org.ctx, a.id, NOW, { nextAttemptAt: next, countAttempt: true, now: NOW })
      ).toBe(false);
    });
  });

  test("a worker that lost its claim to a stale take-back can neither finish nor release the row", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const { id } = await request(trx, org, { next_attempt_at: ago(10 * MINUTE_MS) });
      const [first] = await claimReplyRequests(trx, org.ctx, {
        mailboxId: org.mailboxId,
        now: ago(7 * MINUTE_MS),
        limit: 1,
      });
      const oldToken = first?.locked_at ?? NOW;
      // 7 minutes later the claim is stale: a second worker takes the row back.
      const [second] = await claimReplyRequests(trx, org.ctx, { mailboxId: org.mailboxId, now: NOW, limit: 1 });
      expect(second).toMatchObject({ id, attempts: 1 });

      expect(await finishReplyRequest(trx, org.ctx, id, oldToken, { status: "done", now: NOW })).toBe(false);
      expect(
        await releaseReplyRequest(trx, org.ctx, id, oldToken, { nextAttemptAt: NOW, countAttempt: true, now: NOW })
      ).toBe(false);
      const row = await rowOf(trx, id);
      expect(row).toMatchObject({ status: "drafting", attempts: 1 });
      expect(row.locked_at?.getTime()).toBe(NOW.getTime());
      // The holder of the new claim can still end it.
      expect(await finishReplyRequest(trx, org.ctx, id, NOW, { status: "done", now: NOW })).toBe(true);
    });
  });

  test("finish and release do not touch a row of another organization", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const other = await newOrg(trx);
      const { id } = await request(trx, other, { status: "drafting", locked_at: NOW });
      expect(await finishReplyRequest(trx, org.ctx, id, NOW, { status: "done", now: NOW })).toBe(false);
      expect(
        await releaseReplyRequest(trx, org.ctx, id, NOW, { nextAttemptAt: NOW, countAttempt: true, now: NOW })
      ).toBe(false);
      expect((await rowOf(trx, id)).status).toBe("drafting");
    });
  });
});

describe("listReplyRequestsOfEmail and countRedrafts", () => {
  test("3. countRedrafts counts only the redraft rows of that mail", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const other = await newOrg(trx);
      const mail = await insertTestEmail(trx, org.ctx, org.mailboxId);
      const otherMail = await insertTestEmail(trx, org.ctx, org.mailboxId);
      const foreignMail = await insertTestEmail(trx, other.ctx, other.mailboxId);
      for (const trigger of ["auto", "tap", "redraft", "redraft", "sample"] as const) {
        await insertReplyRequest(trx, org.ctx, org.mailboxId, mail, { trigger });
      }
      await insertReplyRequest(trx, org.ctx, org.mailboxId, otherMail, { trigger: "redraft" });
      await insertReplyRequest(trx, other.ctx, other.mailboxId, foreignMail, { trigger: "redraft" });

      expect(await countRedrafts(trx, org.ctx, mail)).toBe(2);
      expect(await countRedrafts(trx, org.ctx, otherMail)).toBe(1);
      expect(await countRedrafts(trx, org.ctx, crypto.randomUUID())).toBe(0);
      // The org filter: the mail of another org counts nothing here.
      expect(await countRedrafts(trx, org.ctx, foreignMail)).toBe(0);
    });
  });

  test("list by mail: newest first, this mail and this org only", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const other = await newOrg(trx);
      const mail = await insertTestEmail(trx, org.ctx, org.mailboxId);
      const foreignMail = await insertTestEmail(trx, other.ctx, other.mailboxId);
      const first = await insertReplyRequest(trx, org.ctx, org.mailboxId, mail, {
        trigger: "auto",
        created_at: ago(3 * MINUTE_MS),
      });
      const second = await insertReplyRequest(trx, org.ctx, org.mailboxId, mail, {
        trigger: "tap",
        created_at: ago(MINUTE_MS),
      });
      await insertReplyRequest(trx, org.ctx, org.mailboxId, await insertTestEmail(trx, org.ctx, org.mailboxId));
      await insertReplyRequest(trx, other.ctx, other.mailboxId, foreignMail);

      expect((await listReplyRequestsOfEmail(trx, org.ctx, mail)).map((row) => row.id)).toEqual([second, first]);
      expect(await listReplyRequestsOfEmail(trx, org.ctx, foreignMail)).toEqual([]);
    });
  });
});
