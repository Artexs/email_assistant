import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import {
  addDelegate,
  bumpReminder,
  countOpenDelegations,
  countPendingReminderSends,
  findDelegationBySendAction,
  findOpenDelegationByMessageIds,
  getDelegate,
  getDelegation,
  insertDelegation,
  listAnsweredUnnotified,
  listDelegateAddresses,
  listDelegateNames,
  listDelegates,
  listDelegationPage,
  listDelegations,
  listDueDelegations,
  lockDelegation,
  markAnsweredNotified,
  markDelegationOverdue,
  markDelegationSent,
  markReminderPlanned,
  type DelegationPageRow,
} from "../../src/modules/delegation";
import {
  insertDelegate,
  lockDelegate,
  markDelegationAnswered,
  markDelegationCancelled,
  markDelegationDone,
  updateDelegateFields,
  USER_CANCELLED,
} from "../../src/modules/delegation/repo";
import type { DB, TenantContext } from "../../src/platform/db";

import {
  createOrgWithMailbox,
  insertAction,
  insertDelegate as fixtureDelegate,
  insertDelegation as fixtureDelegation,
  insertTestEmail,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const now = new Date("2026-11-07T12:00:00Z");

interface Pair {
  emailId: string;
  draftId: string;
  sendId: string;
}

async function insertPair(trx: Transaction<DB>, ctx: TenantContext, mailboxId: string): Promise<Pair> {
  const emailId = await insertTestEmail(trx, ctx, mailboxId, { subject: "Offer", from_address: "boss@x.test" });
  const draftId = await insertAction(trx, ctx, emailId, { type: "create_draft", status: "applied" });
  const sendId = await insertAction(trx, ctx, emailId, {
    type: "send",
    status: "awaiting_approval",
    dependsOnActionId: draftId,
  });
  return { emailId, draftId, sendId };
}

async function makeDelegation(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  delegateId: string,
  opts?: Partial<Parameters<typeof fixtureDelegation>[2]>
): Promise<{ id: string } & Pair> {
  const pair = await insertPair(trx, ctx, mailboxId);
  const id = await fixtureDelegation(trx, ctx, {
    mailboxId,
    emailId: pair.emailId,
    delegateId,
    draftActionId: pair.draftId,
    sendActionId: pair.sendId,
    ...opts,
  });
  return { id, ...pair };
}

async function twoOrgs(trx: Transaction<DB>) {
  const a = await createOrgWithMailbox(trx);
  const b = await createOrgWithMailbox(trx);
  return { a, ctxA: { orgId: a.orgId }, b, ctxB: { orgId: b.orgId } };
}

describe("delegates", () => {
  test("insertDelegate: an id; the same email again → null; another org → an id", async () => {
    await withRollback(db, async (trx) => {
      const { ctxA, ctxB } = await twoOrgs(trx);
      const input = { name: "Anna", email: "anna@x.test", tags: ["sales"] };
      expect(typeof (await insertDelegate(trx, ctxA, input))).toBe("string");
      expect(await insertDelegate(trx, ctxA, input)).toBeNull();
      expect(typeof (await insertDelegate(trx, ctxB, input))).toBe("string");
    });
  });

  test("list functions, names, addresses, updateDelegateFields", async () => {
    await withRollback(db, async (trx) => {
      const { ctxA } = await twoOrgs(trx);
      const zed = await fixtureDelegate(trx, ctxA, { name: "Zed", email: "zed@x.test" });
      const ann = await fixtureDelegate(trx, ctxA, { name: "Ann", email: "ann@x.test", tags: ["a", "b"] });
      const off = await fixtureDelegate(trx, ctxA, { name: "Off", email: "off@x.test", active: false });

      expect((await listDelegates(trx, ctxA)).map((d) => d.name)).toEqual(["Ann", "Off", "Zed"]);
      const active = await listDelegates(trx, ctxA, { activeOnly: true });
      expect(active.map((d) => d.id)).toEqual([ann, zed]);
      expect(active[0]?.competence_tags).toEqual(["a", "b"]);
      expect(await listDelegateAddresses(trx, ctxA)).toEqual(["ann@x.test", "off@x.test", "zed@x.test"]);
      expect(await listDelegateAddresses(trx, ctxA, { activeOnly: true })).toEqual(["ann@x.test", "zed@x.test"]);
      expect([...(await listDelegateNames(trx, ctxA, [zed, off]))]).toEqual(
        expect.arrayContaining([
          [zed, "Zed"],
          [off, "Off"],
        ])
      );
      expect((await listDelegateNames(trx, ctxA, [])).size).toBe(0);
      expect((await getDelegate(trx, ctxA, ann))?.email).toBe("ann@x.test");

      await updateDelegateFields(trx, ctxA, off, { active: true }, now);
      expect((await getDelegate(trx, ctxA, off))?.active).toBe(true);
    });
  });
});

describe("delegations", () => {
  test("insertDelegation + getDelegation, lockDelegation, findDelegationBySendAction", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await twoOrgs(trx);
      const delegateId = await fixtureDelegate(trx, ctxA);
      const pair = await insertPair(trx, ctxA, a.mailboxId);
      const dueAt = new Date("2026-11-10T16:00:00Z");
      const id = await insertDelegation(trx, ctxA, {
        mailboxId: a.mailboxId,
        emailId: pair.emailId,
        delegateId,
        draftActionId: pair.draftId,
        sendActionId: pair.sendId,
        taskSummary: "Prepare the offer",
        dueAt,
        createdAt: now,
      });
      const row = await getDelegation(trx, ctxA, id);
      expect(row).toMatchObject({
        id,
        mailbox_id: a.mailboxId,
        email_id: pair.emailId,
        delegate_id: delegateId,
        draft_action_id: pair.draftId,
        send_action_id: pair.sendId,
        task_summary: "Prepare the offer",
        status: "drafted",
        status_reason: null,
        sent_message_id: null,
        reminders_sent: 0,
      });
      expect(row?.due_at).toEqual(dueAt);
      expect(row?.created_at).toEqual(now);
      expect((await lockDelegation(trx, ctxA, id))?.id).toBe(id);
      expect((await findDelegationBySendAction(trx, ctxA, pair.sendId))?.id).toBe(id);
    });
  });

  test("state changes", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await twoOrgs(trx);
      const delegateId = await fixtureDelegate(trx, ctxA);
      const next = { sentMessageId: "<m1>", sentAt: now, dueAtWhenNull: new Date("2026-11-10T12:00:00Z") };
      const status = async (id: string) => (await getDelegation(trx, ctxA, id))?.status;

      // sent: from drafted; due_at filled when null
      const d1 = await makeDelegation(trx, ctxA, a.mailboxId, delegateId);
      expect(await markDelegationSent(trx, ctxA, d1.id, next)).toBe(true);
      const sent = await getDelegation(trx, ctxA, d1.id);
      expect(sent).toMatchObject({ status: "sent", sent_message_id: "<m1>", status_reason: null });
      expect(sent?.due_at).toEqual(next.dueAtWhenNull);
      expect(await markDelegationSent(trx, ctxA, d1.id, next)).toBe(false);

      // due_at kept when set
      const own = new Date("2026-11-09T16:00:00Z");
      const d2 = await makeDelegation(trx, ctxA, a.mailboxId, delegateId, { dueAt: own });
      expect(await markDelegationSent(trx, ctxA, d2.id, next)).toBe(true);
      expect((await getDelegation(trx, ctxA, d2.id))?.due_at).toEqual(own);

      // cancelled → sent again
      const d3 = await makeDelegation(trx, ctxA, a.mailboxId, delegateId);
      expect(await markDelegationCancelled(trx, ctxA, d3.id, { reason: "outcome_unknown", at: now })).toBe(true);
      expect((await getDelegation(trx, ctxA, d3.id))?.status_reason).toBe("outcome_unknown");
      expect(await markDelegationCancelled(trx, ctxA, d3.id, { reason: "x", at: now })).toBe(false);
      expect(await markDelegationSent(trx, ctxA, d3.id, next)).toBe(true);
      expect((await getDelegation(trx, ctxA, d3.id))?.status_reason).toBeNull();

      // answered: from sent and overdue, not from done
      const answer = await insertTestEmail(trx, ctxA, a.mailboxId);
      expect(await markDelegationAnswered(trx, ctxA, d1.id, { answeredEmailId: answer, at: now })).toBe(true);
      expect(await getDelegation(trx, ctxA, d1.id)).toMatchObject({ status: "answered", answered_email_id: answer });
      const d4 = await makeDelegation(trx, ctxA, a.mailboxId, delegateId, { status: "overdue" });
      expect(await markDelegationAnswered(trx, ctxA, d4.id, { answeredEmailId: answer, at: now })).toBe(true);
      const d5 = await makeDelegation(trx, ctxA, a.mailboxId, delegateId, { status: "sent" });
      expect(await markDelegationDone(trx, ctxA, d5.id, now)).toBe(false);
      const d6 = await makeDelegation(trx, ctxA, a.mailboxId, delegateId, { status: "overdue" });
      expect(await markDelegationDone(trx, ctxA, d6.id, now)).toBe(true);
      expect(await markDelegationAnswered(trx, ctxA, d6.id, { answeredEmailId: answer, at: now })).toBe(false);

      // overdue only from sent; done from answered
      expect(await markDelegationOverdue(trx, ctxA, d2.id, now)).toBe(true);
      expect(await status(d2.id)).toBe("overdue");
      expect(await markDelegationOverdue(trx, ctxA, d2.id, now)).toBe(false);
      expect(await markDelegationOverdue(trx, ctxA, d1.id, now)).toBe(false);
      expect(await markDelegationDone(trx, ctxA, d1.id, now)).toBe(true);

      // cancel only from drafted
      expect(await markDelegationCancelled(trx, ctxA, d2.id, { reason: "x", at: now })).toBe(false);

      // reminders
      const planned = new Date("2026-11-07T07:30:00Z");
      expect(await markReminderPlanned(trx, ctxA, d2.id, planned)).toBe(true);
      expect((await getDelegation(trx, ctxA, d2.id))?.last_reminder_at).toEqual(planned);
      expect(await bumpReminder(trx, ctxA, d2.id, now)).toBe(true);
      expect(await bumpReminder(trx, ctxA, d2.id, now)).toBe(true);
      expect((await getDelegation(trx, ctxA, d2.id))?.reminders_sent).toBe(2);
      expect(await bumpReminder(trx, ctxA, d1.id, now)).toBe(false);
      expect(await markReminderPlanned(trx, ctxA, d1.id, now)).toBe(false);
    });
  });

  test("findOpenDelegationByMessageIds", async () => {
    await withRollback(db, async (trx) => {
      const { a, b, ctxA } = await twoOrgs(trx);
      const first = await fixtureDelegate(trx, ctxA, { email: "first@x.test" });
      const second = await fixtureDelegate(trx, ctxA, { email: "second@x.test" });
      const one = await makeDelegation(trx, ctxA, a.mailboxId, first, {
        status: "sent",
        sentMessageId: "<m1>",
        createdAt: new Date("2026-11-05T10:00:00Z"),
      });
      const two = await makeDelegation(trx, ctxA, a.mailboxId, second, {
        status: "sent",
        sentMessageId: "<m2>",
        createdAt: new Date("2026-11-05T11:00:00Z"),
      });

      expect(await findOpenDelegationByMessageIds(trx, ctxA, a.mailboxId, ["<m1>"], "FIRST@x.test")).toEqual({
        id: one.id,
        delegateId: first,
      });
      expect(await findOpenDelegationByMessageIds(trx, ctxA, a.mailboxId, ["<m1>"], "other@x.test")).toBeUndefined();
      // one thread, two delegates: the reply of the second one finds the second delegation
      expect(await findOpenDelegationByMessageIds(trx, ctxA, a.mailboxId, ["<m1>", "<m2>"], "second@x.test")).toEqual({
        id: two.id,
        delegateId: second,
      });
      expect(await findOpenDelegationByMessageIds(trx, ctxA, a.mailboxId, [], "first@x.test")).toBeUndefined();

      // a reminder send that was applied
      const reminder = await insertAction(trx, ctxA, one.emailId, {
        type: "send",
        status: "applied",
        approvedAt: now,
        payload: { kind: "reminder", delegation_id: one.id, reminder: 1 },
        outgoingMessageId: "<r1>",
      });
      expect(reminder).toBeString();
      expect(await findOpenDelegationByMessageIds(trx, ctxA, a.mailboxId, ["<x>", "<r1>"], "first@x.test")).toEqual({
        id: one.id,
        delegateId: first,
      });
      expect(
        await findOpenDelegationByMessageIds(trx, ctxA, a.mailboxId, ["<x>", "<r1>"], "second@x.test")
      ).toBeUndefined();

      // done: not found; another mailbox: not found
      const done = await makeDelegation(trx, ctxA, a.mailboxId, first, { status: "done", sentMessageId: "<d1>" });
      expect(done.id).toBeString();
      expect(await findOpenDelegationByMessageIds(trx, ctxA, a.mailboxId, ["<d1>"], "first@x.test")).toBeUndefined();
      expect(await findOpenDelegationByMessageIds(trx, ctxA, b.mailboxId, ["<m1>"], "first@x.test")).toBeUndefined();
    });
  });

  test("findOpenDelegationByMessageIds: an applied send of another organization never matches (the org_id of the action join)", async () => {
    await withRollback(db, async (trx) => {
      const { a, b, ctxA, ctxB } = await twoOrgs(trx);
      const delegateId = await fixtureDelegate(trx, ctxA, { email: "iso@x.test" });
      const d = await makeDelegation(trx, ctxA, a.mailboxId, delegateId, { status: "sent", sentMessageId: "<own>" });
      const emailB = await insertTestEmail(trx, ctxB, b.mailboxId);
      await insertAction(trx, ctxB, emailB, {
        type: "send",
        status: "applied",
        approvedAt: now,
        payload: { kind: "reminder", delegation_id: d.id, reminder: 1 },
        outgoingMessageId: "<foreign>",
      });

      expect(await findOpenDelegationByMessageIds(trx, ctxA, a.mailboxId, ["<foreign>"], "iso@x.test")).toBeUndefined();
      expect(await findOpenDelegationByMessageIds(trx, ctxA, a.mailboxId, ["<own>"], "iso@x.test")).toEqual({
        id: d.id,
        delegateId,
      });
    });
  });

  async function replyFixture(trx: Transaction<DB>, email: string, sentMessageId: string, viaAdd: boolean) {
    const { a, ctxA } = await twoOrgs(trx);
    let delegateId: string;
    if (viaAdd) {
      const added = await addDelegate(trx, ctxA, {
        name: "Typed",
        email,
        tags: [],
        actor: "cli",
        via: "cli",
        now,
      });
      if (added.kind !== "added") throw new Error("the delegate was not added");
      delegateId = added.id;
    } else {
      // an address typed with a plain sigma: the row is inserted as it is
      delegateId = await fixtureDelegate(trx, ctxA, { email });
    }
    const delegation = await makeDelegation(trx, ctxA, a.mailboxId, delegateId, { status: "sent", sentMessageId });
    const find = (from: string) => findOpenDelegationByMessageIds(trx, ctxA, a.mailboxId, [sentMessageId], from);
    return { find, expected: { id: delegation.id, delegateId } };
  }

  test("02-T7: a reply from a dotted I delegate is found whatever the case form of the From", async () => {
    await withRollback(db, async (trx) => {
      const { find, expected } = await replyFixture(trx, "İlker@Example.com", "<m1@example.com>", true);
      // guard: the stored form holds `i` + U+0307, the From does not
      expect(await find("ilker@example.com")).toEqual(expected);
      expect(await find("İLKER@example.com")).toEqual(expected);
      // pin: another address finds nothing
      expect(await find("other@example.com")).toBeUndefined();
    });
  });

  test("02-T8: a reply from a Greek delegate is found when the row holds a plain sigma", async () => {
    await withRollback(db, async (trx) => {
      const { find, expected } = await replyFixture(trx, "νίκοσ@example.gr", "<m2@example.gr>", false);
      // guard: JavaScript lower case of the capital sigma From gives the final sigma
      expect(await find("ΝΊΚΟΣ@example.gr")).toEqual(expected);
      expect(await find("other@example.gr")).toBeUndefined();
    });
  });

  test("02-T8 pin: a reply from a delegate added through addDelegate with capital letters is found", async () => {
    await withRollback(db, async (trx) => {
      const { find, expected } = await replyFixture(trx, "ΝΊΚΟΣ@example.gr", "<m3@example.gr>", true);
      expect(await find("ΝΊΚΟΣ@example.gr")).toEqual(expected);
      expect(await find("νίκοσ@example.gr")).toEqual(expected);
    });
  });

  test("listDueDelegations", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await twoOrgs(trx);
      const delegateId = await fixtureDelegate(trx, ctxA, { name: "Due", email: "due@x.test", active: false });
      const late = await makeDelegation(trx, ctxA, a.mailboxId, delegateId, {
        status: "overdue",
        dueAt: new Date("2026-11-04T16:00:00Z"),
      });
      const recent = await makeDelegation(trx, ctxA, a.mailboxId, delegateId, {
        status: "sent",
        dueAt: new Date("2026-11-06T16:00:00Z"),
      });
      await makeDelegation(trx, ctxA, a.mailboxId, delegateId, {
        status: "sent",
        dueAt: new Date("2026-11-08T16:00:00Z"),
      });
      await makeDelegation(trx, ctxA, a.mailboxId, delegateId, {
        status: "answered",
        dueAt: new Date("2026-11-01T16:00:00Z"),
      });
      await makeDelegation(trx, ctxA, a.mailboxId, delegateId, { status: "sent", dueAt: null });

      const rows = await listDueDelegations(trx, ctxA, a.mailboxId, { now, limit: 10 });
      expect(rows.map((r) => r.id)).toEqual([late.id, recent.id]);
      expect(rows[0]).toMatchObject({ delegate_active: false, delegate_email: "due@x.test", delegate_name: "Due" });
      expect(await listDueDelegations(trx, ctxA, a.mailboxId, { now, limit: 1 })).toHaveLength(1);
    });
  });

  test("countPendingReminderSends", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await twoOrgs(trx);
      const delegateId = await fixtureDelegate(trx, ctxA);
      const d = await makeDelegation(trx, ctxA, a.mailboxId, delegateId, { status: "sent" });
      const reminder = (status: string, extra?: Record<string, unknown>) =>
        insertAction(trx, ctxA, d.emailId, {
          type: "send",
          status,
          payload: { kind: "reminder", delegation_id: d.id, reminder: 1, ...extra },
          approvedAt: status === "awaiting_approval" || status === "rejected" ? null : now,
        });
      await reminder("awaiting_approval");
      await reminder("approved");
      await reminder("applied");
      await reminder("rejected");
      // the delegation send itself has no `reminder` key
      await insertAction(trx, ctxA, d.emailId, {
        type: "send",
        status: "awaiting_approval",
        payload: { kind: "delegation", delegation_id: d.id },
      });
      expect(await countPendingReminderSends(trx, ctxA, d.id)).toBe(2);
    });
  });

  test("countOpenDelegations, listDelegations, listAnsweredUnnotified, markAnsweredNotified", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await twoOrgs(trx);
      const delegateId = await fixtureDelegate(trx, ctxA, { name: "Named" });
      await makeDelegation(trx, ctxA, a.mailboxId, delegateId, { status: "sent" });
      await makeDelegation(trx, ctxA, a.mailboxId, delegateId, { status: "sent" });
      await makeDelegation(trx, ctxA, a.mailboxId, delegateId, { status: "overdue" });
      const answered = await makeDelegation(trx, ctxA, a.mailboxId, delegateId, {
        status: "answered",
        answeredAt: now,
        createdAt: new Date("2026-11-05T10:00:00Z"),
      });
      await makeDelegation(trx, ctxA, a.mailboxId, delegateId, {
        status: "answered",
        answeredAt: now,
        answeredNotifiedAt: now,
      });
      await makeDelegation(trx, ctxA, a.mailboxId, delegateId, { status: "done" });
      expect(await countOpenDelegations(trx, ctxA)).toEqual({ open: 2, overdue: 1 });

      const all = await listDelegations(trx, ctxA, { limit: 50 });
      expect(all).toHaveLength(6);
      expect(all[0]).toMatchObject({ delegate_name: "Named", subject: "Offer" });
      expect(await listDelegations(trx, ctxA, { status: "answered", limit: 50 })).toHaveLength(2);
      expect(await listDelegations(trx, ctxA, { limit: 2 })).toHaveLength(2);

      const unnotified = await listAnsweredUnnotified(trx, ctxA, { limit: 10 });
      expect(unnotified.map((r) => r.id)).toEqual([answered.id]);
      expect(unnotified[0]?.delegate_name).toBe("Named");
      expect(await markAnsweredNotified(trx, ctxA, answered.id, now)).toBe(true);
      expect(await markAnsweredNotified(trx, ctxA, answered.id, now)).toBe(false);
      expect(await listAnsweredUnnotified(trx, ctxA, { limit: 10 })).toEqual([]);
    });
  });
});

describe("the cancel by the user and the page list", () => {
  test("markDelegationCancelled: `user_cancelled` takes drafted, sent and overdue; no other reason takes sent; answered, done and cancelled never change", async () => {
    await withRollback(db, async (trx) => {
      const { a, b, ctxA, ctxB } = await twoOrgs(trx);
      const delegateId = await fixtureDelegate(trx, ctxA);
      const cancel = (id: string, reason = USER_CANCELLED) =>
        markDelegationCancelled(trx, ctxA, id, { reason, at: now });
      for (const status of ["drafted", "sent", "overdue"]) {
        const d = await makeDelegation(trx, ctxA, a.mailboxId, delegateId, { status });
        expect(await cancel(d.id, "expired")).toBe(status === "drafted");
        expect(await cancel(d.id)).toBe(status !== "drafted");
        if (status === "drafted") expect(await cancel(d.id)).toBe(false);
      }
      for (const status of ["answered", "done", "cancelled"] as const) {
        const d = await makeDelegation(trx, ctxA, a.mailboxId, delegateId, { status });
        expect(await cancel(d.id)).toBe(false);
        expect((await getDelegation(trx, ctxA, d.id))?.status).toBe(status);
      }
      // A cancel by the user of another organization changes nothing.
      const d = await makeDelegation(trx, ctxA, a.mailboxId, delegateId, { status: "sent" });
      expect(await markDelegationCancelled(trx, ctxB, d.id, { reason: USER_CANCELLED, at: now })).toBe(false);
      expect((await getDelegation(trx, ctxA, d.id))?.status).toBe("sent");
      expect(b.orgId).not.toBe(a.orgId);
    });
  });

  test("markDelegationSent: a delegation that the user cancelled stays cancelled; a failed send can still be sent again", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await twoOrgs(trx);
      const delegateId = await fixtureDelegate(trx, ctxA);
      const next = { sentMessageId: "<m1>", sentAt: now, dueAtWhenNull: new Date("2026-11-10T12:00:00Z") };
      const user = await makeDelegation(trx, ctxA, a.mailboxId, delegateId);
      expect(await markDelegationCancelled(trx, ctxA, user.id, { reason: USER_CANCELLED, at: now })).toBe(true);
      expect(await markDelegationSent(trx, ctxA, user.id, next)).toBe(false);
      expect(await getDelegation(trx, ctxA, user.id)).toMatchObject({
        status: "cancelled",
        status_reason: USER_CANCELLED,
      });
      for (const reason of ["outcome_unknown", "send_failed", "rejected"]) {
        const d = await makeDelegation(trx, ctxA, a.mailboxId, delegateId);
        expect(await markDelegationCancelled(trx, ctxA, d.id, { reason, at: now })).toBe(true);
        expect(await markDelegationSent(trx, ctxA, d.id, next)).toBe(true);
      }
    });
  });

  test("listDelegationPage: states, order, cursor with ties, reminder flag, and nothing of another organization", async () => {
    await withRollback(db, async (trx) => {
      const { a, b, ctxA, ctxB } = await twoOrgs(trx);
      const delegateId = await fixtureDelegate(trx, ctxA, { name: "Named", email: "named@x.test" });
      // Microseconds: a JS date holds milliseconds only, so the time goes in as text.
      const at = sql<Date>`'2026-11-07T10:00:00.123456Z'::timestamptz`;
      const ids: string[] = [];
      for (const status of ["sent", "sent", "sent", "answered", "drafted"]) {
        const d = await makeDelegation(trx, ctxA, a.mailboxId, delegateId, { status });
        await trx.updateTable("delegations").set({ created_at: at }).where("id", "=", d.id).execute();
        ids.push(d.id);
      }
      const [s1, s2, s3, answered, drafted] = ids as [string, string, string, string, string];
      // The ties come in id order; a cursor from a row (microseconds kept) gives the rows after it, none twice.
      const page = (opts: Partial<Parameters<typeof listDelegationPage>[2]> = {}) =>
        listDelegationPage(trx, ctxA, { statuses: ["sent"], limit: 10, ...opts });
      const all = await page();
      expect(all.map((r) => r.id)).toEqual([s1, s2, s3].sort());
      expect(all[0]).toMatchObject({ delegate_name: "Named", delegate_email: "named@x.test", delegate_active: true });
      expect(all[0]?.created_at_key).toBe("2026-11-07T10:00:00.123456Z");
      const second = (await page({ cursor: { createdAtKey: all[0]?.created_at_key ?? "", id: all[0]?.id ?? "" } })).map(
        (r) => r.id
      );
      expect(second).toEqual(all.slice(1).map((r) => r.id));
      expect(await page({ limit: 2 })).toHaveLength(2);
      expect((await page({ statuses: ["answered"] })).map((r) => r.id)).toEqual([answered]);
      expect((await page({ statuses: ["drafted", "sent"] })).map((r) => r.id).sort()).toEqual(
        [s1, s2, s3, drafted].sort()
      );

      // Another organization sees none of it, and its reminder send that names the delegation of A does not count for A.
      const forged = await insertTestEmail(trx, ctxB, b.mailboxId);
      await insertAction(trx, ctxB, forged, {
        type: "send",
        status: "awaiting_approval",
        payload: { kind: "reminder", delegation_id: s1, reminder: 1 },
      });
      const flags = (rows: DelegationPageRow[]) => rows.map((r) => r.reminder_waiting);
      expect(flags(await page())).toEqual([false, false, false]);
      for (const statuses of [["sent"], ["drafted", "sent", "answered", "overdue", "done", "cancelled"]] as const) {
        expect(await listDelegationPage(trx, ctxB, { statuses, limit: 10 })).toEqual([]);
      }
      // A real reminder of A counts, in A only.
      await insertAction(trx, ctxA, (await getDelegation(trx, ctxA, s2))?.email_id ?? "", {
        type: "send",
        status: "awaiting_approval",
        payload: { kind: "reminder", delegation_id: s2, reminder: 1 },
      });
      expect(Object.fromEntries((await page()).map((r) => [r.id, r.reminder_waiting]))).toEqual({
        [s1]: false,
        [s2]: true,
        [s3]: false,
      });
    });
  });
});

describe("tenant filter", () => {
  test("org B sees and changes nothing of org A", async () => {
    await withRollback(db, async (trx) => {
      const { a, b, ctxA, ctxB } = await twoOrgs(trx);
      const delegateId = await fixtureDelegate(trx, ctxA, { email: "t@x.test" });
      const d = await makeDelegation(trx, ctxA, a.mailboxId, delegateId, {
        status: "sent",
        sentMessageId: "<t1>",
        dueAt: new Date("2026-11-01T00:00:00Z"),
      });
      await makeDelegation(trx, ctxA, a.mailboxId, delegateId, { status: "answered", answeredAt: now });
      const answer = await insertTestEmail(trx, ctxA, a.mailboxId);
      await insertAction(trx, ctxA, d.emailId, {
        type: "send",
        status: "awaiting_approval",
        payload: { kind: "reminder", delegation_id: d.id, reminder: 1 },
      });

      expect(await listDelegates(trx, ctxB)).toEqual([]);
      expect(await getDelegate(trx, ctxB, delegateId)).toBeUndefined();
      expect((await listDelegateNames(trx, ctxB, [delegateId])).size).toBe(0);
      expect(await listDelegateAddresses(trx, ctxB)).toEqual([]);
      await updateDelegateFields(trx, ctxB, delegateId, { active: false, name: "Other" }, now);
      expect((await getDelegate(trx, ctxA, delegateId))?.active).toBe(true);
      expect(await lockDelegate(trx, ctxB, delegateId)).toBeUndefined();
      expect(await getDelegation(trx, ctxB, d.id)).toBeUndefined();
      expect(await lockDelegation(trx, ctxB, d.id)).toBeUndefined();
      expect(await findDelegationBySendAction(trx, ctxB, d.sendId)).toBeUndefined();
      expect(await findOpenDelegationByMessageIds(trx, ctxB, a.mailboxId, ["<t1>"], "t@x.test")).toBeUndefined();
      expect(await markDelegationSent(trx, ctxB, d.id, { sentMessageId: "<z>", sentAt: now, dueAtWhenNull: now })).toBe(
        false
      );
      expect(await markDelegationAnswered(trx, ctxB, d.id, { answeredEmailId: answer, at: now })).toBe(false);
      expect(await markDelegationOverdue(trx, ctxB, d.id, now)).toBe(false);
      expect(await markDelegationCancelled(trx, ctxB, d.id, { reason: "x", at: now })).toBe(false);
      expect(await markDelegationDone(trx, ctxB, d.id, now)).toBe(false);
      expect(await markReminderPlanned(trx, ctxB, d.id, now)).toBe(false);
      expect(await bumpReminder(trx, ctxB, d.id, now)).toBe(false);
      expect(await listDueDelegations(trx, ctxB, a.mailboxId, { now, limit: 10 })).toEqual([]);
      expect(await countPendingReminderSends(trx, ctxB, d.id)).toBe(0);
      expect(await countOpenDelegations(trx, ctxB)).toEqual({ open: 0, overdue: 0 });
      expect(await listDelegations(trx, ctxB, { limit: 10 })).toEqual([]);
      expect(await listAnsweredUnnotified(trx, ctxB, { limit: 10 })).toEqual([]);
      expect(await markAnsweredNotified(trx, ctxB, d.id, now)).toBe(false);
      expect(b.orgId).not.toBe(a.orgId);
    });
  });
});
