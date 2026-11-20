import { randomUUID } from "node:crypto";

import { delegationListSchema, type DelegationItem, MINUTE_MS, DAY_MS } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { setDelegationId } from "../../src/modules/actions";
import { cardEditHooks } from "../../src/modules/channels";
import {
  cancelByUser,
  delegationHooks,
  lockDelegation,
  markAnswered,
  type CancelByUserDeps,
} from "../../src/modules/delegation";

import { insertDelegate, insertDelegation } from "./fixtures";
import { testDb } from "./helpers";
import { approvalKit, NOW, post, type Seed } from "./web-approvals-kit";
import { as } from "./web-helpers";

// GET /api/delegations, POST /api/delegations/:id/done and /cancel. Any member reads and marks done; the cancel is owner
// only. Tenancy is tested with the second organization O2 (its owner is the session `other`).
const db = testDb();
const { cleanup, setup, addSend, send, auditOf, editRows } = approvalKit(db);

afterEach(cleanup);

afterAll(async () => {
  await db.destroy();
});

type Status = "drafted" | "sent" | "answered" | "overdue" | "done" | "cancelled";

interface Made {
  id: string;
  sendId: string;
  draftId: string;
  emailId: string;
}

// The test data: D1 `drafted`, D2 `sent` due tomorrow, D3 `overdue` with a waiting reminder, D4 `answered`, D5 `done`, D6 `cancelled`,
// made in this order (each one minute after the one before). A sent card exists for U1 and U2 for every send of the organization.
async function world(s: Seed, opts: { orgId?: string; mailboxId?: string; delegateId?: string; start?: number } = {}) {
  const orgId = opts.orgId ?? s.org.orgId;
  const ctx = { orgId };
  const mailboxId = opts.mailboxId ?? s.mailboxId;
  const delegateId =
    opts.delegateId ??
    (await db
      .transaction()
      .execute((trx) => insertDelegate(trx, ctx, { name: "Anna", email: `anna-${randomUUID()}@x.test` })));
  let n = opts.start ?? 0;

  async function make(
    status: Status,
    extra: { dueAt?: Date; remindersSent?: number; task?: string } = {}
  ): Promise<Made> {
    n += 1;
    const createdAt = new Date(NOW.getTime() - (100 - n) * MINUTE_MS);
    const drafted = status === "drafted";
    const sendId = await addSend(
      s,
      {
        delegateId,
        createdAt,
        subject: `Subject ${status}`,
        ...(drafted ? {} : { sendStatus: "applied", approved: { userId: s.org.ownerId, at: createdAt } }),
      },
      orgId,
      mailboxId
    );
    const row = await db
      .selectFrom("actions")
      .select(["email_id", "depends_on_action_id"])
      .where("id", "=", sendId)
      .executeTakeFirstOrThrow();
    const draftId = row.depends_on_action_id as string;
    const id = await db.transaction().execute((trx) =>
      insertDelegation(trx, ctx, {
        mailboxId,
        emailId: row.email_id as string,
        delegateId,
        draftActionId: draftId,
        sendActionId: sendId,
        status,
        createdAt,
        taskSummary: extra.task ?? `Task ${status}`,
        ...(extra.dueAt === undefined ? {} : { dueAt: extra.dueAt }),
        ...(extra.remindersSent === undefined ? {} : { remindersSent: extra.remindersSent }),
      })
    );
    if (status === "cancelled") {
      await db.updateTable("delegations").set({ status_reason: "rejected" }).where("id", "=", id).execute();
    }
    await setDelegationId(db, ctx, [draftId, sendId], id);
    return { id, sendId, draftId, emailId: row.email_id as string };
  }

  // A reminder send of the delegation (its own mail, draft and cards).
  async function addReminder(d: Made, sendStatus: string, orgOfCards = orgId): Promise<string> {
    return addSend(
      s,
      {
        kind: "reminder",
        reminder: 1,
        delegationId: d.id,
        delegateId,
        sendStatus,
        ...(sendStatus === "awaiting_approval" ? {} : { approved: { userId: s.org.ownerId, at: NOW } }),
        createdAt: NOW,
      },
      orgOfCards,
      orgOfCards === s.org.orgId ? s.mailboxId : s.theirMailboxId
    );
  }

  const d1 = await make("drafted");
  const d2 = await make("sent", { dueAt: new Date(NOW.getTime() + DAY_MS) });
  const d3 = await make("overdue", { dueAt: new Date(NOW.getTime() - DAY_MS), remindersSent: 1 });
  const d4 = await make("answered");
  const d5 = await make("done");
  const d6 = await make("cancelled");
  return { ctx, delegateId, make, addReminder, d1, d2, d3, d4, d5, d6 };
}

const get = (s: Seed, who: string, query = "") => s.app.request(`/api/delegations${query}`, as(who));
const act = (s: Seed, who: string, id: string, action: "done" | "cancel") =>
  s.app.request(`/api/delegations/${id}/${action}`, post(who, action));

async function items(res: Response): Promise<DelegationItem[]> {
  expect(res.status).toBe(200);
  return delegationListSchema.parse(await res.json()).items;
}

const row = (id: string) =>
  db.selectFrom("delegations").select(["status", "status_reason"]).where("id", "=", id).executeTakeFirstOrThrow();

const auditRows = (orgId: string, event: string) =>
  db.selectFrom("audit_log").selectAll().where("org_id", "=", orgId).where("event", "=", event).orderBy("id").execute();

describe("GET /api/delegations", () => {
  test("T1. each filter lists its states, newest first; the item carries the delegate, the mail subject and reminderWaiting", async () => {
    const s = await setup({ delegationFlag: true });
    const w = await world(s);
    await w.addReminder(w.d3, "awaiting_approval");
    // A reminder that is over (applied) and one that waits for another delegation do not count.
    await w.addReminder(w.d2, "applied");

    const open = await items(await get(s, "owner", "?filter=open"));
    expect(open.map((d) => d.id)).toEqual([w.d2.id, w.d1.id]);
    expect(open.every((d) => d.kind === "delegation")).toBe(true);
    expect(open[0]).toMatchObject({
      status: "sent",
      task: "Task sent",
      subject: "Subject sent",
      delegate: { id: w.delegateId, name: "Anna", active: true },
      remindersSent: 0,
      reminderWaiting: false,
      answeredAt: null,
    });
    expect(open[0]?.sentAt).not.toBeNull();
    expect(open[0]?.dueAt).toBe(new Date(NOW.getTime() + DAY_MS).toISOString());

    const overdue = await items(await get(s, "owner", "?filter=overdue"));
    expect(overdue.map((d) => d.id)).toEqual([w.d3.id]);
    expect(overdue[0]).toMatchObject({ reminderWaiting: true, remindersSent: 1 });
    expect((await items(await get(s, "owner", "?filter=answered"))).map((d) => d.id)).toEqual([w.d4.id]);
    expect((await items(await get(s, "owner", "?filter=closed"))).map((d) => d.id)).toEqual([w.d6.id, w.d5.id]);
    // No filter: `open`. A member reads too.
    expect((await items(await get(s, "member"))).map((d) => d.id)).toEqual([w.d2.id, w.d1.id]);
  });

  test("T1b. a reminder send counts while it is awaiting_approval, approved or applying, and no longer when it is over", async () => {
    const s = await setup({ delegationFlag: true });
    const w = await world(s);
    const waiting = new Map<string, boolean>();
    for (const status of ["awaiting_approval", "approved", "applying", "applied", "rejected", "expired"]) {
      const d = await w.make("sent");
      await w.addReminder(d, status);
      const found = (await items(await get(s, "owner", "?filter=open&limit=100"))).find((item) => item.id === d.id);
      waiting.set(status, found?.reminderWaiting === true);
    }
    expect(Object.fromEntries(waiting)).toEqual({
      awaiting_approval: true,
      approved: true,
      applying: true,
      applied: false,
      rejected: false,
      expired: false,
    });
  });

  test("T2. limit=1 on open gives D2 and a cursor; before=<cursor> gives D1 and next null", async () => {
    const s = await setup({ delegationFlag: true });
    const w = await world(s);
    const first = delegationListSchema.parse(await (await get(s, "owner", "?filter=open&limit=1")).json());
    expect(first.items.map((d) => d.id)).toEqual([w.d2.id]);
    expect(first.next).not.toBeNull();
    const second = delegationListSchema.parse(
      await (await get(s, "owner", `?filter=open&limit=1&before=${first.next}`)).json()
    );
    expect(second.items.map((d) => d.id)).toEqual([w.d1.id]);
    expect(second.next).toBeNull();
  });

  test("T2b. two delegations with the same created_at come in id order, none twice and none lost, across pages", async () => {
    const s = await setup({ delegationFlag: true });
    const w = await world(s);
    const same = new Date(NOW.getTime() - 5 * MINUTE_MS);
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const d = await w.make("sent");
      await db.updateTable("delegations").set({ created_at: same }).where("id", "=", d.id).execute();
      ids.push(d.id);
    }
    const seen: string[] = [];
    let before: string | null = null;
    for (let page = 0; page < 6; page += 1) {
      const res = await get(s, "owner", `?filter=open&limit=1${before === null ? "" : `&before=${before}`}`);
      const body = delegationListSchema.parse(await res.json());
      seen.push(...body.items.map((d) => d.id));
      before = body.next;
      if (before === null) break;
    }
    expect(seen).toHaveLength(new Set(seen).size);
    expect(seen).toHaveLength(5); // D1, D2 and the three at the same time
    const tied = seen.filter((id) => ids.includes(id));
    expect(tied).toEqual([...ids].sort());
  });

  test("T3. a drafted delegation carries the id of its send; a sent one has none", async () => {
    const s = await setup({ delegationFlag: true });
    const w = await world(s);
    const open = await items(await get(s, "owner", "?filter=open"));
    expect(open.find((d) => d.id === w.d1.id)?.sendId).toBe(w.d1.sendId);
    expect(open.find((d) => d.id === w.d2.id)?.sendId).toBeNull();
  });

  test("T3b. the task is null after retention", async () => {
    const s = await setup({ delegationFlag: true });
    const w = await world(s);
    await db.updateTable("delegations").set({ task_summary: "[removed]" }).where("id", "=", w.d5.id).execute();
    const closed = await items(await get(s, "owner", "?filter=closed"));
    expect(closed.find((d) => d.id === w.d5.id)?.task).toBeNull();
    expect(closed.find((d) => d.id === w.d6.id)?.task).toBe("Task cancelled");
  });

  test("T4. a delegation of O2 never shows; filter=late and a bad cursor and limit are 400; flag off is 404 for every role", async () => {
    const s = await setup({ delegationFlag: true });
    const w = await world(s);
    const theirs = await world(s, { orgId: s.org.otherOrgId, mailboxId: s.theirMailboxId });
    const mine = new Set((await items(await get(s, "owner", "?filter=closed&limit=100"))).map((d) => d.id));
    for (const d of [theirs.d5, theirs.d6]) expect(mine.has(d.id)).toBe(false);
    expect([...mine].sort()).toEqual([w.d5.id, w.d6.id].sort());
    expect((await items(await get(s, "other", "?filter=open"))).map((d) => d.id)).toEqual([theirs.d2.id, theirs.d1.id]);
    // A cursor made in O2 gives O1 no row of O2.
    const page = delegationListSchema.parse(await (await get(s, "other", "?filter=open&limit=1")).json());
    const cross = await items(await get(s, "owner", `?filter=open&before=${page.next}`));
    expect(cross.some((d) => [theirs.d1.id, theirs.d2.id].includes(d.id))).toBe(false);

    for (const query of ["?filter=late", "?limit=0", "?limit=101", "?before=%25%25", "?before=aGVsbG8"]) {
      const res = await get(s, "owner", query);
      expect([query, res.status, ((await res.json()) as { error: string }).error]).toEqual([query, 400, "validation"]);
    }
    expect((await s.app.request("/api/delegations")).status).toBe(401);

    const off = await setup({ delegationFlag: false });
    for (const who of ["owner", "member"]) {
      const res = await get(off, who, "?filter=late");
      expect([who, res.status, await res.json()]).toEqual([who, 404, { error: "not_found" }]);
    }
  });
});

describe("POST /api/delegations/:id/done", () => {
  test("T5. a member marks an answered delegation done (audit with via); again is 409 already; an open one is 409 not_closable", async () => {
    const s = await setup({ delegationFlag: true });
    const w = await world(s);
    const res = await act(s, "member", w.d4.id, "done");
    expect([res.status, await res.json()]).toEqual([200, { status: "done" }]);
    expect(await row(w.d4.id)).toEqual({ status: "done", status_reason: null });
    const audit = await auditRows(s.org.orgId, "delegation.done");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor: s.org.assistantId, data: { delegation_id: w.d4.id, via: "web" } });

    const again = await act(s, "member", w.d4.id, "done");
    expect([again.status, await again.json()]).toEqual([409, { error: "already" }]);
    for (const d of [w.d1, w.d2, w.d6]) {
      const open = await act(s, "member", d.id, "done");
      expect([open.status, await open.json()]).toEqual([409, { error: "not_closable" }]);
    }
    // An overdue delegation closes too (the owner as well); its waiting reminder expires.
    await w.addReminder(w.d3, "awaiting_approval");
    expect((await act(s, "owner", w.d3.id, "done")).status).toBe(200);
    expect((await row(w.d3.id)).status).toBe("done");
    expect(await auditRows(s.org.orgId, "delegation.done")).toHaveLength(2);
  });

  test("T5b. a body with a field is 400; an id that is no uuid is 400; an unknown id is 404", async () => {
    const s = await setup({ delegationFlag: true });
    const w = await world(s);
    const extra = await s.app.request(`/api/delegations/${w.d4.id}/done`, post("member", "done", { more: 1 }));
    expect(extra.status).toBe(400);
    expect((await act(s, "member", "nope", "done")).status).toBe(400);
    expect((await act(s, "member", randomUUID(), "done")).status).toBe(404);
    expect((await row(w.d4.id)).status).toBe("answered");
  });
});

describe("POST /api/delegations/:id/cancel", () => {
  test("T6. a member gets 403 owner_only; nothing changes", async () => {
    const s = await setup({ delegationFlag: true });
    const w = await world(s);
    for (const d of [w.d1, w.d2, w.d3]) {
      const res = await act(s, "member", d.id, "cancel");
      expect([res.status, await res.json()]).toEqual([403, { error: "owner_only" }]);
    }
    expect((await row(w.d1.id)).status).toBe("drafted");
    expect((await row(w.d2.id)).status).toBe("sent");
    expect(await send(w.d1.sendId)).toMatchObject({ status: "awaiting_approval" });
    expect(await editRows(s.org.orgId)).toEqual([]);
  });

  test("T7. the owner cancels a drafted delegation: the send is rejected, each sent card gets a rejected edit, the audit names the user", async () => {
    const s = await setup({ delegationFlag: true });
    const w = await world(s);
    const res = await act(s, "owner", w.d1.id, "cancel");
    expect([res.status, await res.json()]).toEqual([200, { status: "cancelled" }]);
    expect(await row(w.d1.id)).toEqual({ status: "cancelled", status_reason: "user_cancelled" });
    expect(await send(w.d1.sendId)).toMatchObject({ status: "rejected" });
    const edits = (await editRows(s.org.orgId)).filter((r) => r.dedup_key.includes(":"));
    expect(edits.map((r) => r.user_id).sort()).toEqual([s.org.ownerId, s.u2].sort());
    expect(edits.every((r) => r.dedup_key.endsWith(":rejected"))).toBe(true);
    const rejected = (await auditOf(w.d1.sendId)).filter((a) => a.event === "action.rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ actor: s.org.ownerId, data: { via: "web" } });
    const cancelled = await auditRows(s.org.orgId, "delegation.cancelled");
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]).toMatchObject({
      actor: s.org.ownerId,
      reason_code: "user_cancelled",
      data: { delegation_id: w.d1.id, reason: "user_cancelled", via: "web" },
    });
    expect((await items(await get(s, "owner", "?filter=closed"))).map((d) => d.id)).toContain(w.d1.id);
  });

  test("T8. the owner cancels an overdue delegation: its waiting reminder expires with one expired edit per sent card; a reply leaves it cancelled", async () => {
    const s = await setup({ delegationFlag: true });
    const w = await world(s);
    const reminderId = await w.addReminder(w.d3, "awaiting_approval");
    const res = await act(s, "owner", w.d3.id, "cancel");
    expect([res.status, await res.json()]).toEqual([200, { status: "cancelled" }]);
    expect(await row(w.d3.id)).toEqual({ status: "cancelled", status_reason: "user_cancelled" });
    expect(await send(reminderId)).toMatchObject({ status: "expired", status_reason: "delegation_closed" });
    const edits = await editRows(s.org.orgId);
    expect(edits.map((r) => r.user_id).sort()).toEqual([s.org.ownerId, s.u2].sort());
    expect(edits.every((r) => r.dedup_key.endsWith(":expired"))).toBe(true);
    const cancelled = await auditRows(s.org.orgId, "delegation.cancelled");
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]).toMatchObject({
      actor: s.org.ownerId,
      reason_code: "user_cancelled",
      data: { delegation_id: w.d3.id, reminders_expired: 1, reason: "user_cancelled", via: "web" },
    });
    // The delegate answers in the thread: the delegation stays cancelled.
    const answered = await db
      .transaction()
      .execute((trx) => markAnswered(trx, w.ctx, w.d3.id, { emailId: w.d3.emailId, at: NOW }));
    expect(answered).toBe(false);
    expect(await row(w.d3.id)).toEqual({ status: "cancelled", status_reason: "user_cancelled" });
  });

  test("T8b. a sent delegation with no reminder cancels too, and no card edit is queued", async () => {
    const s = await setup({ delegationFlag: true });
    const w = await world(s);
    expect((await act(s, "owner", w.d2.id, "cancel")).status).toBe(200);
    expect(await row(w.d2.id)).toEqual({ status: "cancelled", status_reason: "user_cancelled" });
    expect(await editRows(s.org.orgId)).toEqual([]);
  });

  test("T9. a send in flight is 409 sending; answered, done and cancelled are 409 not_open; a held send is rejected", async () => {
    const s = await setup({ delegationFlag: true });
    const w = await world(s);
    const lock = (status: string, at: Date | null) =>
      db
        .updateTable("actions")
        .set({ status, locked_at: at, approved_by: s.org.ownerId, approved_at: NOW, approved_via: "telegram" })
        .where("id", "=", w.d1.sendId)
        .execute();

    await lock("applying", NOW);
    const applying = await act(s, "owner", w.d1.id, "cancel");
    expect([applying.status, await applying.json()]).toEqual([409, { error: "sending" }]);
    await lock("approved", NOW); // the committer holds the lock now
    const fresh = await act(s, "owner", w.d1.id, "cancel");
    expect([fresh.status, await fresh.json()]).toEqual([409, { error: "sending" }]);
    expect(await row(w.d1.id)).toEqual({ status: "drafted", status_reason: null });
    expect(await editRows(s.org.orgId)).toEqual([]);

    for (const d of [w.d4, w.d5, w.d6]) {
      const res = await act(s, "owner", d.id, "cancel");
      expect([res.status, await res.json()]).toEqual([409, { error: "not_open" }]);
    }
    expect((await row(w.d4.id)).status).toBe("answered");
    expect((await row(w.d5.id)).status).toBe("done");
    expect(await row(w.d6.id)).toEqual({ status: "cancelled", status_reason: "rejected" });

    // An approved send that nobody works on (no lock) is held: the cancel rejects it.
    await lock("approved", null);
    const held = await act(s, "owner", w.d1.id, "cancel");
    expect([held.status, await held.json()]).toEqual([200, { status: "cancelled" }]);
    expect(await send(w.d1.sendId)).toMatchObject({ status: "rejected" });
  });

  test("T9b. a send that went out leaves a sent delegation: the cancel reads it again and cancels it", async () => {
    const s = await setup({ delegationFlag: true });
    const w = await world(s);
    let first = true;
    const deps: CancelByUserDeps = {
      db,
      hooks: delegationHooks({ db }),
      approvalHooks: cardEditHooks({ sendScope: { kind: "all" } }),
      uidplus: async () => true,
      afterRead: async () => {
        if (!first) return;
        first = false;
        // The committer sent the mail between the read and the cancel.
        await db
          .updateTable("actions")
          .set({
            status: "applied",
            approved_by: s.org.ownerId,
            approved_at: NOW,
            approved_via: "telegram",
            applied_at: NOW,
          })
          .where("id", "=", w.d1.sendId)
          .execute();
        await db
          .updateTable("delegations")
          .set({ status: "sent", sent_message_id: "<m@x.test>", sent_at: NOW })
          .where("id", "=", w.d1.id)
          .execute();
      },
    };
    expect(await cancelByUser(deps, w.ctx, w.d1.id, { userId: s.org.ownerId, via: "web", now: NOW })).toEqual({
      kind: "cancelled",
    });
    expect(await row(w.d1.id)).toEqual({ status: "cancelled", status_reason: "user_cancelled" });
  });

  test("T9c. an edit that replaces the send just before the reject: the cancel tries again with the new send and rejects it", async () => {
    const s = await setup({ delegationFlag: true });
    const w = await world(s);
    let newId: string | undefined;
    const deps: CancelByUserDeps = {
      db,
      hooks: delegationHooks({ db }),
      approvalHooks: cardEditHooks({ sendScope: { kind: "all" } }),
      uidplus: async () => true,
      afterRead: async () => {
        if (newId !== undefined) return;
        const res = await s.app.request(
          `/api/approvals/${w.d1.sendId}/edit`,
          post("owner", "edit", { subject: "Budget", body: "New text" })
        );
        expect(res.status).toBe(200);
        newId = ((await res.json()) as { id: string }).id;
      },
    };
    expect(await cancelByUser(deps, w.ctx, w.d1.id, { userId: s.org.ownerId, via: "web", now: NOW })).toEqual({
      kind: "cancelled",
    });
    expect(newId).toBeDefined();
    expect(await row(w.d1.id)).toEqual({ status: "cancelled", status_reason: "user_cancelled" });
    expect(await send(newId as string)).toMatchObject({ status: "rejected" });
    expect(await send(w.d1.sendId)).toMatchObject({ status: "expired", status_reason: "superseded" });
  });

  test("T9d. an edit on every attempt: the cancel gives up with not_open and changes nothing", async () => {
    const s = await setup({ delegationFlag: true });
    const w = await world(s);
    let current = w.d1.sendId;
    const deps: CancelByUserDeps = {
      db,
      hooks: delegationHooks({ db }),
      approvalHooks: cardEditHooks({ sendScope: { kind: "all" } }),
      uidplus: async () => true,
      afterRead: async () => {
        const res = await s.app.request(
          `/api/approvals/${current}/edit`,
          post("owner", "edit", { subject: "Budget", body: `Text ${randomUUID()}` })
        );
        expect(res.status).toBe(200);
        current = ((await res.json()) as { id: string }).id;
      },
    };
    expect(await cancelByUser(deps, w.ctx, w.d1.id, { userId: s.org.ownerId, via: "web", now: NOW })).toEqual({
      kind: "not_open",
    });
    expect(await row(w.d1.id)).toEqual({ status: "drafted", status_reason: null });
    expect(await send(current)).toMatchObject({ status: "awaiting_approval" });
  });

  test("T10. two cancels of one sent delegation at once: one 200, one 409 not_open, one audit row", async () => {
    const s = await setup({ delegationFlag: true });
    const w = await world(s);
    for (let round = 0; round < 6; round += 1) {
      const d = await w.make("sent");
      const [a, b] = await Promise.all([act(s, "owner", d.id, "cancel"), act(s, "owner", d.id, "cancel")]);
      const answers = [
        [a.status, await a.json()],
        [b.status, await b.json()],
      ].sort((x, y) => (x[0] as number) - (y[0] as number));
      expect(answers).toEqual([
        [200, { status: "cancelled" }],
        [409, { error: "not_open" }],
      ]);
      expect(await row(d.id)).toEqual({ status: "cancelled", status_reason: "user_cancelled" });
    }
    expect(await auditRows(s.org.orgId, "delegation.cancelled")).toHaveLength(6);
  });

  test("T10c. a held row lock of the delegation blocks the cancel of a sent delegation until the holder commits", async () => {
    const s = await setup({ delegationFlag: true });
    const w = await world(s);
    const deps: CancelByUserDeps = {
      db,
      hooks: delegationHooks({ db }),
      approvalHooks: cardEditHooks({ sendScope: { kind: "all" } }),
      uidplus: async () => true,
    };
    let settled = false;
    let pending: ReturnType<typeof cancelByUser> | undefined;
    await db.transaction().execute(async (trx) => {
      expect(await lockDelegation(trx, w.ctx, w.d2.id)).toMatchObject({ id: w.d2.id });
      pending = cancelByUser(deps, w.ctx, w.d2.id, { userId: s.org.ownerId, via: "web", now: NOW });
      void pending.then(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(settled).toBe(false);
    });
    expect(await pending).toEqual({ kind: "cancelled" });
    expect(await row(w.d2.id)).toEqual({ status: "cancelled", status_reason: "user_cancelled" });
  });

  test("T10b. a cancel of a drafted delegation and a cancel at once: one 200, one 409", async () => {
    const s = await setup({ delegationFlag: true });
    const w = await world(s);
    const [a, b] = await Promise.all([act(s, "owner", w.d1.id, "cancel"), act(s, "owner", w.d1.id, "cancel")]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await row(w.d1.id)).toEqual({ status: "cancelled", status_reason: "user_cancelled" });
    expect(await auditRows(s.org.orgId, "action.rejected")).toHaveLength(1);
  });

  test("T11. flag off: 404 on both routes for the owner and a member, also with a bad id; an id of O2 is 404 and stays unchanged", async () => {
    const off = await setup({ delegationFlag: false });
    const w = await world(off);
    for (const who of ["owner", "member"]) {
      for (const action of ["done", "cancel"] as const) {
        for (const id of [w.d1.id, w.d4.id, randomUUID(), "not-an-id"]) {
          const res = await act(off, who, id, action);
          expect([who, action, res.status, await res.json()]).toEqual([who, action, 404, { error: "not_found" }]);
        }
      }
    }
    expect((await row(w.d1.id)).status).toBe("drafted");
    expect((await row(w.d4.id)).status).toBe("answered");

    const s = await setup({ delegationFlag: true });
    const mine = await world(s);
    const theirs = await world(s, { orgId: s.org.otherOrgId, mailboxId: s.theirMailboxId });
    for (const [who, action, d] of [
      ["owner", "cancel", theirs.d1],
      ["owner", "cancel", theirs.d2],
      ["owner", "done", theirs.d4],
      ["member", "done", theirs.d4],
      ["other", "cancel", mine.d1],
      ["other", "cancel", mine.d2],
      ["other", "done", mine.d4],
    ] as const) {
      const res = await act(s, who, d.id, action);
      expect([who, action, res.status, await res.json()]).toEqual([who, action, 404, { error: "not_found" }]);
    }
    expect((await row(theirs.d1.id)).status).toBe("drafted");
    expect((await row(theirs.d4.id)).status).toBe("answered");
    expect((await row(mine.d1.id)).status).toBe("drafted");
    expect(await send(theirs.d1.sendId)).toMatchObject({ status: "awaiting_approval" });
  });

  test("T12. user_cancelled is final: no send of the delegation, no went-out tap and no send-again reopens it", async () => {
    const s = await setup({ delegationFlag: true });
    const w = await world(s);
    expect((await act(s, "owner", w.d1.id, "cancel")).status).toBe(200);
    const hooks = delegationHooks({ db });
    const sentAt = new Date(NOW.getTime() + MINUTE_MS);
    const input = { delegationId: w.d1.id, sentMessageId: "<m@x.test>", dueAtWhenNull: NOW };
    expect(await db.transaction().execute((trx) => hooks.onSent(trx, w.ctx, { ...input, sentAt }))).toBe(false);
    expect(
      await db
        .transaction()
        .execute((trx) => hooks.onWentOut(trx, w.ctx, { ...input, at: sentAt, actor: s.org.ownerId }))
    ).toBe("not_open");
    expect(await db.transaction().execute((trx) => hooks.isOpen(trx, w.ctx, w.d1.id, "delegation"))).toBe(false);
    expect(await db.transaction().execute((trx) => hooks.isOpen(trx, w.ctx, w.d1.id, "reminder"))).toBe(false);
    expect(await row(w.d1.id)).toEqual({ status: "cancelled", status_reason: "user_cancelled" });
  });
});
