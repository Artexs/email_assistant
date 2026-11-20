import { randomUUID } from "node:crypto";

import { delegationRemindAnswerSchema, DAY_MS } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { setDelegationId } from "../../src/modules/actions";
import { remindNow } from "../../src/modules/delegation";

import { insertDelegation } from "./fixtures";
import { testDb } from "./helpers";
import { approvalKit, NOW, post, type Seed } from "./web-approvals-kit";
import { TEST_ORIGIN } from "./web-helpers";

// POST /api/delegations/:id/remind, and the calls of `remindNow` on two connections (the double click, the settings
// lock). The owner of the second organization O2 is the session `other`. The service rules are in `delegation-remind.test.ts`.
const db = testDb();
const { cleanup, setup, addSend, insertDelegateNow, send } = approvalKit(db);

afterEach(cleanup);

afterAll(async () => {
  await db.destroy();
});

const LATER = new Date("2026-11-20T13:05:00Z");

// An `overdue` delegation with 0 reminders sent, in O1 by default (or in O2 with its own delegate and mailbox).
async function overdue(
  s: Seed,
  opts: { theirs?: boolean; remindersSent?: number; status?: string; active?: boolean } = {}
) {
  const orgId = opts.theirs === true ? s.org.otherOrgId : s.org.orgId;
  const mailboxId = opts.theirs === true ? s.theirMailboxId : s.mailboxId;
  const ctx = { orgId };
  const delegateId = await insertDelegateNow(
    { ...s, ctx },
    { name: "Anna", email: `anna-${randomUUID()}@x.test`, active: opts.active ?? true }
  );
  const sendId = await addSend(
    s,
    { delegateId, sendStatus: "applied", approved: { userId: s.org.ownerId, at: NOW }, createdAt: NOW },
    orgId,
    mailboxId
  );
  const pair = await db
    .selectFrom("actions")
    .select(["email_id", "depends_on_action_id"])
    .where("id", "=", sendId)
    .executeTakeFirstOrThrow();
  const draftId = pair.depends_on_action_id as string;
  const id = await db.transaction().execute((trx) =>
    insertDelegation(trx, ctx, {
      mailboxId,
      emailId: pair.email_id as string,
      delegateId,
      draftActionId: draftId,
      sendActionId: sendId,
      status: opts.status ?? "overdue",
      dueAt: new Date(NOW.getTime() - DAY_MS),
      sentMessageId: `<sent-${randomUUID()}@x.test>`,
      ...(opts.remindersSent === undefined ? {} : { remindersSent: opts.remindersSent }),
    })
  );
  await setDelegationId(db, ctx, [draftId, sendId], id);
  return { id, ctx, delegateId, emailId: pair.email_id };
}

const remind = (s: Seed, who: string, id: string, body: unknown = {}) =>
  s.app.request(`/api/delegations/${id}/remind`, post(who, "remind", body));

const reminderSends = (orgId: string) =>
  db
    .selectFrom("actions")
    .select(["id", "status", "payload"])
    .where("org_id", "=", orgId)
    .where("type", "=", "send")
    .where(sql<boolean>`idempotency_key LIKE '%:send:reminder:manual:%'`)
    .execute();

const remindAudit = (orgId: string) =>
  db
    .selectFrom("audit_log")
    .selectAll()
    .where("org_id", "=", orgId)
    .where("event", "=", "delegation.remind_requested")
    .execute();

describe("POST /api/delegations/:id/remind", () => {
  test("T10. the owner plans a reminder: 200 { status: planned, sendId }; the send waits for a tap; the audit row names the user", async () => {
    const s = await setup({ delegationFlag: true });
    const d = await overdue(s);
    const res = await remind(s, "owner", d.id);
    expect(res.status).toBe(200);
    const body = delegationRemindAnswerSchema.parse(await res.json());
    expect(await send(body.sendId)).toMatchObject({ status: "awaiting_approval", approved_by: null });
    const [row] = await reminderSends(s.org.orgId);
    expect(row?.id).toBe(body.sendId);
    expect("set_id" in (row?.payload as object)).toBe(false);
    const audit = await remindAudit(s.org.orgId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor: s.org.ownerId,
      action_id: body.sendId,
      data: { delegation_id: d.id, reminder: 1, via: "web" },
    });
  });

  test("T10b. a member gets 403 owner_only and nothing changes; the flag comes before the role", async () => {
    const s = await setup({ delegationFlag: true });
    const d = await overdue(s);
    const res = await remind(s, "member", d.id);
    expect([res.status, await res.json()]).toEqual([403, { error: "owner_only" }]);
    expect(await reminderSends(s.org.orgId)).toEqual([]);

    const off = await setup({ delegationFlag: false });
    const e = await overdue(off);
    for (const [who, id] of [
      ["owner", e.id],
      ["member", e.id],
      ["owner", "nope"],
      ["member", "nope"],
    ] as const) {
      const answer = await remind(off, who, id);
      expect([who, id === "nope", answer.status, await answer.json()]).toEqual([
        who,
        id === "nope",
        404,
        { error: "not_found" },
      ]);
    }
    expect(await reminderSends(off.org.orgId)).toEqual([]);
    expect(await remindAudit(off.org.orgId)).toEqual([]);
  });

  test("T10c. a delegation of O2 is 404 for the owner of O1; O2's owner reminds their own; no row crosses", async () => {
    const s = await setup({ delegationFlag: true });
    const mine = await overdue(s);
    const theirs = await overdue(s, { theirs: true });
    const cross = await remind(s, "owner", theirs.id);
    expect([cross.status, await cross.json()]).toEqual([404, { error: "not_found" }]);
    const back = await remind(s, "other", mine.id);
    expect([back.status, await back.json()]).toEqual([404, { error: "not_found" }]);
    expect(await reminderSends(s.org.orgId)).toEqual([]);
    expect(await reminderSends(s.org.otherOrgId)).toEqual([]);

    expect((await remind(s, "other", theirs.id)).status).toBe(200);
    expect(await reminderSends(s.org.orgId)).toEqual([]);
    expect(await reminderSends(s.org.otherOrgId)).toHaveLength(1);
    expect(await remindAudit(s.org.orgId)).toEqual([]);
    expect(await remindAudit(s.org.otherOrgId)).toHaveLength(1);
  });

  test("T10d. every refusal is a 409 with its code; a bad id and a body with a field are 400; no session is 401", async () => {
    const s = await setup({ delegationFlag: true });
    const first = await overdue(s);
    expect((await remind(s, "owner", first.id)).status).toBe(200);
    const waiting = await remind(s, "owner", first.id);
    expect([waiting.status, await waiting.json()]).toEqual([409, { error: "reminder_waiting" }]);

    const cases: [string, Awaited<ReturnType<typeof overdue>>][] = [
      ["not_open", await overdue(s, { status: "answered" })],
      ["limit_reached", await overdue(s, { remindersSent: 2 })],
      ["delegate_inactive", await overdue(s, { active: false })],
    ];
    for (const [code, d] of cases) {
      const res = await remind(s, "owner", d.id);
      expect([code, res.status, await res.json()]).toEqual([code, 409, { error: code }]);
    }
    await db.updateTable("mailbox_settings").set({ mode: "shadow" }).where("mailbox_id", "=", s.mailboxId).execute();
    const other = await overdue(s);
    const off = await remind(s, "owner", other.id);
    expect([off.status, await off.json()]).toEqual([409, { error: "drafts_off" }]);

    expect((await remind(s, "owner", "nope")).status).toBe(400);
    expect((await remind(s, "owner", randomUUID())).status).toBe(404);
    expect((await remind(s, "owner", other.id, { more: 1 })).status).toBe(400);
    const anonymous = await s.app.request(`/api/delegations/${other.id}/remind`, {
      method: "POST",
      headers: { origin: TEST_ORIGIN, "content-type": "application/json" },
      body: "{}",
    });
    expect(anonymous.status).toBe(401);
    expect(await reminderSends(s.org.orgId)).toHaveLength(1);
  });
});

describe("remindNow on two connections", () => {
  test("T3. two calls at once: one planned, one reminder_waiting; one reminder pair (8 loops)", async () => {
    const s = await setup({ delegationFlag: true });
    for (let loop = 0; loop < 8; loop += 1) {
      const d = await overdue(s);
      const input = { userId: s.org.ownerId, via: "web", now: LATER } as const;
      const results = await Promise.all([remindNow({ db }, d.ctx, d.id, input), remindNow({ db }, d.ctx, d.id, input)]);
      expect(results.map((r) => r.kind).sort()).toEqual(["planned", "reminder_waiting"]);
      const rows = await db
        .selectFrom("actions")
        .select("type")
        .where("org_id", "=", s.org.orgId)
        .where("email_id", "=", d.emailId)
        .where(sql<boolean>`idempotency_key LIKE '%:reminder:manual:%'`)
        .execute();
      expect(rows.map((r) => r.type).sort()).toEqual(["create_draft", "send"]);
    }
  });

  test("T12. a setter holds the settings row: the call waits for it, then sees shadow mode and plans nothing", async () => {
    const s = await setup({ delegationFlag: true });
    const d = await overdue(s);
    let held!: () => void;
    const holding = new Promise<void>((resolve) => (held = resolve));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const setter = db.transaction().execute(async (trx) => {
      await trx.updateTable("mailbox_settings").set({ mode: "shadow" }).where("mailbox_id", "=", s.mailboxId).execute();
      held();
      await gate;
    });
    await holding;
    const call = remindNow({ db }, d.ctx, d.id, { userId: s.org.ownerId, via: "web", now: LATER });
    try {
      const state = await Promise.race([
        call.then(() => "settled"),
        new Promise((resolve) => setTimeout(() => resolve("waiting"), 80)),
      ]);
      expect(state).toBe("waiting");
    } finally {
      release();
      await setter;
    }
    expect(await call).toEqual({ kind: "drafts_off" });
    expect(await reminderSends(s.org.orgId)).toEqual([]);
  });
});
