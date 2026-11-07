import { randomUUID } from "node:crypto";

import { parseToolSwitches } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { getDraft, getSend } from "../../src/modules/actions";
import {
  getMailboxSettings,
  insertDefaultSettings,
  lockMailboxSettings,
  updateMailboxSettings,
} from "../../src/modules/config";
import {
  CHASER_SET_LIMIT,
  createChaserJob,
  getDelegation,
  reminderDecision,
  runChaserForMailbox,
} from "../../src/modules/delegation";
import type { DB, TenantContext } from "../../src/platform/db";

import {
  createOrgWithMailbox,
  insertAction,
  insertDelegate,
  insertDelegation,
  insertDraftAndSend,
  pauseOtherMailboxes,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const DAY = 24 * 3_600_000;
const TZ = "Europe/Warsaw";
// 07:29 and 07:30 in Warsaw (CET) on 2026-11-10.
const at0729 = new Date("2026-11-10T06:29:00Z");
const at0730 = new Date("2026-11-10T06:30:00Z");
const at0745 = new Date("2026-11-10T06:45:00Z");
const nextDay = new Date("2026-11-11T06:30:00Z");
const dueAt = new Date("2026-11-09T16:00:00Z"); // yesterday 17:00 Warsaw

async function enableAssist(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  patch: { mode?: "assist" | "shadow"; createDraft?: boolean } = {}
): Promise<void> {
  const row = await getMailboxSettings(trx, ctx, mailboxId);
  if (!row) throw new Error("no settings");
  await updateMailboxSettings(trx, ctx, mailboxId, {
    mode: patch.mode ?? "assist",
    toolSwitches: { ...parseToolSwitches(row.tool_switches), create_draft: patch.createDraft ?? true },
  });
  // One transaction has one now(): give each settings write its own version.
  await trx
    .updateTable("mailbox_settings")
    .set({ updated_at: sql`clock_timestamp()` })
    .where("mailbox_id", "=", mailboxId)
    .execute();
}

async function setup(trx: Transaction<DB>, opts: { mode?: "assist" | "shadow"; createDraft?: boolean } = {}) {
  await pauseOtherMailboxes(trx);
  const org = await createOrgWithMailbox(trx);
  const ctx = { orgId: org.orgId };
  await insertDefaultSettings(trx, ctx, org.mailboxId);
  await enableAssist(trx, ctx, org.mailboxId, opts);
  const settings = await getMailboxSettings(trx, ctx, org.mailboxId);
  if (!settings) throw new Error("no settings");
  const mailbox = { id: org.mailboxId, timezone: TZ, settingsVersion: settings.version };
  return { ...org, ctx, mailbox, deps: { db: trx, now: () => at0730 } };
}

type Setup = Awaited<ReturnType<typeof setup>>;

// An open delegation (the original delegation mail, its draft and send, the delegation row).
async function openDelegation(
  trx: Transaction<DB>,
  s: { ctx: TenantContext; mailboxId: string; userId: string },
  opts: {
    status?: string;
    active?: boolean;
    dueDate?: string;
    remindersSent?: number;
    lastReminderAt?: Date | null;
    dueAt?: Date | null;
    referencesHeader?: string | null;
  } = {}
) {
  const delegateId = await insertDelegate(trx, s.ctx, { name: "Anna", active: opts.active ?? true });
  const delegate = await trx
    .selectFrom("delegates")
    .select("email")
    .where("id", "=", delegateId)
    .executeTakeFirstOrThrow();
  const pair = await insertDraftAndSend(trx, s.ctx, s.mailboxId, {
    delegateId,
    delegateName: "Anna",
    to: delegate.email,
    task: "Prepare the offer",
    dueDate: opts.dueDate ?? "2026-11-09",
    language: "pl",
    sendStatus: "applied",
    approved: { userId: s.userId, at: new Date("2026-11-05T09:00:00Z") },
    messageId: "<orig@x.test>",
    referencesHeader: opts.referencesHeader === undefined ? "<root@x.test>" : opts.referencesHeader,
    createdAt: new Date("2026-11-05T08:00:00Z"),
  });
  const sentMessageId = `<sent-${randomUUID()}@x.test>`;
  const id = await insertDelegation(trx, s.ctx, {
    mailboxId: s.mailboxId,
    emailId: pair.emailId,
    delegateId,
    draftActionId: pair.draftId,
    sendActionId: pair.sendId,
    status: opts.status ?? "sent",
    dueAt: opts.dueAt === undefined ? dueAt : opts.dueAt,
    sentMessageId,
    remindersSent: opts.remindersSent,
    lastReminderAt: opts.lastReminderAt,
  });
  return { id, delegateId, delegateEmail: delegate.email, sentMessageId, ...pair };
}

async function reminderRows(trx: Transaction<DB>, ctx: TenantContext, emailId?: string) {
  return trx
    .selectFrom("actions")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where(sql<boolean>`idempotency_key LIKE '%:reminder:%'`)
    .$if(emailId !== undefined, (qb) => qb.where("email_id", "=", emailId as string))
    .orderBy("type")
    .orderBy("idempotency_key")
    .execute();
}

async function auditRows(trx: Transaction<DB>, ctx: TenantContext, event: string) {
  return trx
    .selectFrom("audit_log")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("event", "=", event)
    .orderBy("created_at")
    .execute();
}

async function run(s: Setup, now: Date, opts?: { force?: boolean }) {
  return runChaserForMailbox({ ...s.deps, now: () => now }, s.ctx, s.mailbox, now, opts);
}

describe("reminderDecision", () => {
  const now = new Date("2026-11-10T06:30:00Z");
  const base = { status: "overdue" as const, reminders_sent: 0, last_reminder_at: null, delegate_active: true };

  test("(11) rows", () => {
    expect(reminderDecision({ ...base, status: "sent" }, 0, now)).toEqual({ markOverdue: true, remind: true });
    expect(reminderDecision(base, 0, now)).toEqual({ markOverdue: false, remind: true });
    expect(reminderDecision({ ...base, delegate_active: false }, 0, now).remind).toBe(false);
    expect(reminderDecision(base, 1, now).remind).toBe(false);
    expect(reminderDecision({ ...base, reminders_sent: 2 }, 0, now).remind).toBe(false);
    const gap = (ms: number) => new Date(now.getTime() - ms);
    expect(reminderDecision({ ...base, reminders_sent: 1, last_reminder_at: gap(3 * DAY - 1) }, 0, now).remind).toBe(
      false
    );
    expect(reminderDecision({ ...base, reminders_sent: 1, last_reminder_at: gap(3 * DAY) }, 0, now).remind).toBe(true);
  });
});

describe("runChaserForMailbox", () => {
  test("(1) before 07:30 local: gate, nothing changes", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const d = await openDelegation(trx, s);
      expect(await run(s, at0729)).toEqual({ overdue: 0, reminders: 0, skipped: "gate" });
      expect((await getDelegation(trx, s.ctx, d.id))?.status).toBe("sent");
      expect(await reminderRows(trx, s.ctx)).toEqual([]);
      expect(await auditRows(trx, s.ctx, "delegation.chaser_run")).toEqual([]);
    });
  });

  test("(2) at 07:30: overdue, a reminder pair, the day marker", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const d = await openDelegation(trx, s);
      expect(await run(s, at0730)).toEqual({ overdue: 1, reminders: 1, skipped: null });

      const row = await getDelegation(trx, s.ctx, d.id);
      expect(row?.status).toBe("overdue");
      expect(row?.last_reminder_at).toEqual(at0730);
      expect(row?.reminders_sent).toBe(0);
      expect(await auditRows(trx, s.ctx, "delegation.overdue")).toHaveLength(1);

      const [draft, send] = await reminderRows(trx, s.ctx, d.emailId);
      expect(draft?.type).toBe("create_draft");
      expect(draft?.status).toBe("ready");
      expect(draft?.idempotency_key).toBe(`${d.emailId}:create_draft:reminder:2026-11-10`);
      expect(draft?.payload).toEqual({
        kind: "reminder",
        delegate_id: d.delegateId,
        delegate_name: "Anna",
        to: [d.delegateEmail],
        task: "Prepare the offer",
        due_date: "2026-11-09",
        language: "pl",
        delegation_id: d.id,
        reminder: 1,
        thread: { in_reply_to: d.sentMessageId, references: ["<root@x.test>", "<orig@x.test>", d.sentMessageId] },
      });
      expect(send?.type).toBe("send");
      expect(send?.status).toBe("awaiting_approval");
      expect(send?.idempotency_key).toBe(`${d.emailId}:send:reminder:2026-11-10`);
      expect(send?.depends_on_action_id).toBe(draft?.id);
      expect(send?.payload).toMatchObject({
        kind: "reminder",
        delegation_id: d.id,
        reminder: 1,
        to: [d.delegateEmail],
      });
      expect((send?.payload as { set_id?: string }).set_id).toMatch(/^[0-9a-f-]{36}$/);

      const [marker] = await auditRows(trx, s.ctx, "delegation.chaser_run");
      expect(marker?.data).toMatchObject({ mailbox_id: s.mailboxId, due: 1, overdue: 1, reminders: 1, forced: false });
      expect(await getDraft(trx, s.ctx, draft?.id ?? "")).toBeDefined();
      expect(await getSend(trx, s.ctx, send?.id ?? "")).toBeDefined();
    });
  });

  test("(3) a second run the same day: gate; force runs, plans no new pair, marks again", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await openDelegation(trx, s);
      await run(s, at0730);
      expect(await run(s, at0745)).toEqual({ overdue: 0, reminders: 0, skipped: "gate" });

      expect(await run(s, at0745, { force: true })).toEqual({ overdue: 0, reminders: 0, skipped: null });
      expect(await reminderRows(trx, s.ctx)).toHaveLength(2);
      const markers = await auditRows(trx, s.ctx, "delegation.chaser_run");
      expect(markers).toHaveLength(2);
      expect(markers[1]?.data).toMatchObject({ forced: true });
    });
  });

  test("(4) the next day with the reminder send still waiting: no second reminder, a day marker", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await openDelegation(trx, s);
      await run(s, at0730);
      expect(await run(s, nextDay)).toEqual({ overdue: 0, reminders: 0, skipped: null });
      expect(await reminderRows(trx, s.ctx)).toHaveLength(2);
      expect(await auditRows(trx, s.ctx, "delegation.chaser_run")).toHaveLength(2);
    });
  });

  test("(5) the gap, the second reminder and the limit", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const young = await openDelegation(trx, s, {
        status: "overdue",
        remindersSent: 1,
        lastReminderAt: new Date(at0730.getTime() - 2 * DAY),
      });
      expect(await run(s, at0730)).toMatchObject({ reminders: 0 });
      expect(await reminderRows(trx, s.ctx, young.emailId)).toEqual([]);

      await trx
        .updateTable("delegations")
        .set({ last_reminder_at: new Date(at0730.getTime() - 3 * DAY) })
        .where("id", "=", young.id)
        .execute();
      expect(await run(s, nextDay)).toMatchObject({ reminders: 1 });
      const [draft, send] = await reminderRows(trx, s.ctx, young.emailId);
      expect(draft?.idempotency_key).toBe(`${young.emailId}:create_draft:reminder:2026-11-11`);
      expect(send?.idempotency_key).toBe(`${young.emailId}:send:reminder:2026-11-11`);
      expect(draft?.payload).toMatchObject({ reminder: 2 });

      const spent = await openDelegation(trx, s, { status: "overdue", remindersSent: 2 });
      expect(await run(s, new Date("2026-11-20T06:30:00Z"), { force: true })).toMatchObject({ reminders: 0 });
      expect(await reminderRows(trx, s.ctx, spent.emailId)).toEqual([]);
      expect((await getDelegation(trx, s.ctx, spent.id))?.status).toBe("overdue");
    });
  });

  test("(5b) a rejected reminder keeps the gap, then a new pair with the new day key", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const d = await openDelegation(trx, s, {
        status: "overdue",
        lastReminderAt: new Date(at0730.getTime() - DAY),
      });
      expect(await run(s, at0730)).toMatchObject({ reminders: 0 });
      expect(await reminderRows(trx, s.ctx, d.emailId)).toEqual([]);

      const later = new Date("2026-11-13T06:30:00Z");
      expect(await run(s, later)).toMatchObject({ reminders: 1 });
      const [draft] = await reminderRows(trx, s.ctx, d.emailId);
      expect(draft?.idempotency_key).toBe(`${d.emailId}:create_draft:reminder:2026-11-13`);
    });
  });

  test("(6) an inactive delegate: overdue, no reminder", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const d = await openDelegation(trx, s, { active: false });
      expect(await run(s, at0730)).toEqual({ overdue: 1, reminders: 0, skipped: null });
      expect((await getDelegation(trx, s.ctx, d.id))?.status).toBe("overdue");
      expect(await reminderRows(trx, s.ctx)).toEqual([]);
    });
  });

  test("(7) a drafted or answered delegation with a past due date stays untouched", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const drafted = await openDelegation(trx, s, { status: "drafted" });
      const answered = await openDelegation(trx, s, { status: "answered" });
      expect(await run(s, at0730)).toEqual({ overdue: 0, reminders: 0, skipped: null });
      expect((await getDelegation(trx, s.ctx, drafted.id))?.status).toBe("drafted");
      expect((await getDelegation(trx, s.ctx, answered.id))?.status).toBe("answered");
      expect(await reminderRows(trx, s.ctx)).toEqual([]);
    });
  });

  test("(14) an original draft without a due date: the reminder due_date is empty", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const d = await openDelegation(trx, s, { dueDate: "", referencesHeader: null });
      await run(s, at0730);
      const [draft] = await reminderRows(trx, s.ctx, d.emailId);
      expect(draft?.payload).toMatchObject({
        due_date: "",
        thread: { in_reply_to: d.sentMessageId, references: ["<orig@x.test>", d.sentMessageId] },
      });
    });
  });

  test("(9) two due delegations share one set; 15 give 10 reminders and 15 overdue", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await openDelegation(trx, s);
      await openDelegation(trx, s);
      expect(await run(s, at0730)).toEqual({ overdue: 2, reminders: 2, skipped: null });
      const sends = (await reminderRows(trx, s.ctx)).filter((row) => row.type === "send");
      const setIds = new Set(sends.map((row) => (row.payload as { set_id: string }).set_id));
      expect(sends).toHaveLength(2);
      expect(setIds.size).toBe(1);
    });
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      for (let i = 0; i < 15; i += 1) await openDelegation(trx, s);
      expect(await run(s, at0730)).toEqual({ overdue: 15, reminders: CHASER_SET_LIMIT, skipped: null });
      expect((await reminderRows(trx, s.ctx)).filter((row) => row.type === "send")).toHaveLength(CHASER_SET_LIMIT);
      // The other five get their reminder on the next local day.
      expect(await run(s, nextDay)).toEqual({ overdue: 0, reminders: 5, skipped: null });
    });
  });

  test("(10) existing keys: the day marker is written, no reminder counts", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const d = await openDelegation(trx, s);
      const draftId = await insertAction(trx, s.ctx, d.emailId, {
        type: "create_draft",
        status: "expired",
        idempotencyKey: `${d.emailId}:create_draft:reminder:2026-11-10`,
      });
      await insertAction(trx, s.ctx, d.emailId, {
        type: "send",
        status: "expired",
        idempotencyKey: `${d.emailId}:send:reminder:2026-11-10`,
        dependsOnActionId: draftId,
      });
      expect(await run(s, at0730)).toEqual({ overdue: 1, reminders: 0, skipped: null });
      expect(await auditRows(trx, s.ctx, "delegation.chaser_run")).toHaveLength(1);
      expect((await getDelegation(trx, s.ctx, d.id))?.last_reminder_at).toBeNull();
    });
  });

  test("(12) another organization's rows stay untouched", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const other = await setup(trx);
      const mine = await openDelegation(trx, s);
      const theirs = await openDelegation(trx, other);
      await run(s, at0730);
      expect((await getDelegation(trx, s.ctx, mine.id))?.status).toBe("overdue");
      expect((await getDelegation(trx, other.ctx, theirs.id))?.status).toBe("sent");
      expect(await reminderRows(trx, other.ctx)).toEqual([]);
      expect(await auditRows(trx, other.ctx, "delegation.chaser_run")).toEqual([]);
    });
  });

  test("(13) the switch day in March: 07:30 CEST runs, the day window is the local day", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const d = await openDelegation(trx, s, { dueAt: new Date("2026-03-28T16:00:00Z") });
      const sunday = new Date("2026-03-29T05:30:00Z");
      expect(await run(s, new Date("2026-03-29T05:29:00Z"))).toMatchObject({ skipped: "gate" });
      expect(await run(s, sunday)).toEqual({ overdue: 1, reminders: 1, skipped: null });
      const [draft] = await reminderRows(trx, s.ctx, d.emailId);
      expect(draft?.idempotency_key).toBe(`${d.emailId}:create_draft:reminder:2026-03-29`);
      expect(await run(s, new Date("2026-03-29T10:00:00Z"))).toMatchObject({ skipped: "gate" });
    });
  });

  test("(15) the settings changed after the snapshot: nothing is written", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const d = await openDelegation(trx, s);
      await enableAssist(trx, s.ctx, s.mailboxId, { createDraft: false });
      expect(await run(s, at0730)).toEqual({ overdue: 0, reminders: 0, skipped: "settings" });
      expect((await getDelegation(trx, s.ctx, d.id))?.status).toBe("sent");
      expect(await reminderRows(trx, s.ctx)).toEqual([]);
      expect(await auditRows(trx, s.ctx, "delegation.chaser_run")).toEqual([]);
    });
  });
});

describe("createChaserJob", () => {
  test("(8) shadow mode or the switch off: skipped, nothing changes", async () => {
    for (const patch of [{ mode: "shadow" as const }, { createDraft: false }]) {
      await withRollback(db, async (trx) => {
        const s = await setup(trx, patch);
        const d = await openDelegation(trx, s);
        await createChaserJob({ db: trx, now: () => at0730 }).run();
        expect((await getDelegation(trx, s.ctx, d.id))?.status).toBe("sent");
        expect(await reminderRows(trx, s.ctx)).toEqual([]);
        expect(await auditRows(trx, s.ctx, "delegation.chaser_run")).toEqual([]);
      });
    }
  });

  test("run() plans the reminder of an assist mailbox; force skips the time gate", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const d = await openDelegation(trx, s);
      const job = createChaserJob({ db: trx, now: () => at0729 });
      await job.run();
      expect(await reminderRows(trx, s.ctx, d.emailId)).toEqual([]);
      await job.run({ force: true });
      expect(await reminderRows(trx, s.ctx, d.emailId)).toHaveLength(2);
    });
  });
});

describe("two connections", () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // Own org, committed: the chaser and the other writer run on separate connections. The caller cleans up.
  async function committedSetup() {
    const created = await db.transaction().execute(async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const ctx = { orgId: org.orgId };
      await insertDefaultSettings(trx, ctx, org.mailboxId);
      await enableAssist(trx, ctx, org.mailboxId);
      const d = await openDelegation(trx, { ctx, mailboxId: org.mailboxId, userId: org.userId });
      return { ...org, delegationId: d.id, emailId: d.emailId };
    });
    const ctx = { orgId: created.orgId };
    const settings = await getMailboxSettings(db, ctx, created.mailboxId);
    if (!settings) throw new Error("no settings");
    const mailbox = { id: created.mailboxId, timezone: TZ, settingsVersion: settings.version };
    return { created, ctx, mailbox };
  }

  async function cleanup(created: { orgId: string; userId: string }): Promise<void> {
    await db.deleteFrom("organizations").where("id", "=", created.orgId).execute();
    await db.deleteFrom("users").where("id", "=", created.userId).execute();
  }

  test("(16) an open setter holds the settings lock: the chaser waits, sees the new version, writes nothing", async () => {
    const s = await committedSetup();
    try {
      let chaser: ReturnType<typeof runChaserForMailbox> | undefined;
      let done = false;
      await db.transaction().execute(async (trx) => {
        await lockMailboxSettings(trx, s.ctx, s.created.mailboxId);
        await updateMailboxSettings(trx, s.ctx, s.created.mailboxId, {
          toolSwitches: { ...parseToolSwitches({}), create_draft: false },
        });
        chaser = runChaserForMailbox({ db, now: () => at0730 }, s.ctx, s.mailbox, at0730);
        void chaser.then(() => {
          done = true;
        });
        await sleep(200);
        expect(done).toBe(false);
      });

      expect(await chaser).toEqual({ overdue: 0, reminders: 0, skipped: "settings" });
      expect(
        await db
          .selectFrom("actions")
          .select("id")
          .where("org_id", "=", s.ctx.orgId)
          .where(sql<boolean>`idempotency_key LIKE '%:reminder:%'`)
          .execute()
      ).toEqual([]);
      expect((await getDelegation(db, s.ctx, s.created.delegationId))?.status).toBe("sent");
      expect(
        await db
          .selectFrom("audit_log")
          .select("id")
          .where("org_id", "=", s.ctx.orgId)
          .where("event", "=", "delegation.chaser_run")
          .execute()
      ).toEqual([]);
    } finally {
      await cleanup(s.created);
    }
  });

  test("(7b) a reply triaged before the lock: the row is skipped, no pair", async () => {
    const s = await committedSetup();
    try {
      let chaser: ReturnType<typeof runChaserForMailbox> | undefined;
      await db.transaction().execute(async (trx) => {
        await trx.selectFrom("delegations").select("id").where("id", "=", s.created.delegationId).forUpdate().execute();
        chaser = runChaserForMailbox({ db, now: () => at0730 }, s.ctx, s.mailbox, at0730);
        await sleep(200);
        await trx
          .updateTable("delegations")
          .set({ status: "answered", answered_at: at0730 })
          .where("id", "=", s.created.delegationId)
          .execute();
      });

      expect(await chaser).toEqual({ overdue: 0, reminders: 0, skipped: null });
      expect((await getDelegation(db, s.ctx, s.created.delegationId))?.status).toBe("answered");
      expect(
        await db
          .selectFrom("actions")
          .select("id")
          .where("org_id", "=", s.ctx.orgId)
          .where(sql<boolean>`idempotency_key LIKE '%:reminder:%'`)
          .execute()
      ).toEqual([]);
    } finally {
      await cleanup(s.created);
    }
  });
});
