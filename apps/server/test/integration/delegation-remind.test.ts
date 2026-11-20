import { randomBytes, randomUUID } from "node:crypto";

import { parseToolSwitches, HOUR_MS, DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { createCommitterJob, listSendsToNotify } from "../../src/modules/actions";
import { detectNotices } from "../../src/modules/channels";
import { getMailboxSettings, insertDefaultSettings, updateMailboxSettings } from "../../src/modules/config";
import { getDelegation, remindNow, runChaserForMailbox } from "../../src/modules/delegation";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { insertCredentials } from "../../src/modules/mail/repo";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, TenantContext } from "../../src/platform/db";

import {
  createOrgWithMailbox,
  insertDelegate,
  insertDelegation,
  insertDraftAndSend,
  isolateChannels,
  linkChat,
  pauseOtherMailboxes,
  randomChatId,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

// `remindNow` plans a reminder to the delegate at once. Service level, one rolled-back transaction per test (the route,
// the double click and the settings lock with two connections are in `web-delegation-remind.test.ts`).
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-20T13:05:00Z");
const TZ = "Europe/Warsaw";

async function setSettings(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  patch: { mode?: "assist" | "shadow"; createDraft?: boolean }
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
  await isolateChannels(trx);
  const org = await createOrgWithMailbox(trx);
  const ctx = { orgId: org.orgId };
  await insertDefaultSettings(trx, ctx, org.mailboxId);
  await setSettings(trx, ctx, org.mailboxId, opts);
  return { ...org, ctx };
}

type Setup = Awaited<ReturnType<typeof setup>>;

// A delegation with its original mail, draft and send (the send is applied, as for a sent delegation).
async function openDelegation(
  trx: Transaction<DB>,
  s: Pick<Setup, "ctx" | "mailboxId" | "userId">,
  opts: { status?: string; active?: boolean; remindersSent?: number; dueAt?: Date | null } = {}
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
    dueDate: "2026-11-25",
    language: "pl",
    sendStatus: "applied",
    approved: { userId: s.userId, at: new Date("2026-11-15T09:00:00Z") },
    messageId: "<orig@x.test>",
    referencesHeader: "<root@x.test>",
    createdAt: new Date("2026-11-15T08:00:00Z"),
  });
  const id = await insertDelegation(trx, s.ctx, {
    mailboxId: s.mailboxId,
    emailId: pair.emailId,
    delegateId,
    draftActionId: pair.draftId,
    sendActionId: pair.sendId,
    status: opts.status ?? "overdue",
    dueAt: opts.dueAt === undefined ? new Date("2026-11-19T16:00:00Z") : opts.dueAt,
    sentMessageId: `<sent-${randomUUID()}@x.test>`,
    remindersSent: opts.remindersSent,
  });
  return { id, delegateId, delegateEmail: delegate.email, ...pair };
}

const remind = (trx: Transaction<DB>, s: Pick<Setup, "ctx" | "userId">, id: string, via: "web" | "cli" = "web") =>
  remindNow({ db: trx }, s.ctx, id, { userId: s.userId, via, now: NOW });

// The rows that `remindNow` made: its keys have the `manual` segment.
async function manualRows(trx: Transaction<DB>, ctx: TenantContext) {
  return trx
    .selectFrom("actions")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where(sql<boolean>`idempotency_key LIKE '%:reminder:manual:%'`)
    .orderBy("type")
    .orderBy("created_at")
    .execute();
}

async function reminderRows(trx: Transaction<DB>, ctx: TenantContext) {
  return trx
    .selectFrom("actions")
    .select(["id", "type", "status"])
    .where("org_id", "=", ctx.orgId)
    .where(sql<boolean>`idempotency_key LIKE '%:reminder:%'`)
    .orderBy("id")
    .execute();
}

async function auditRows(trx: Transaction<DB>, ctx: TenantContext, event: string) {
  return trx.selectFrom("audit_log").selectAll().where("org_id", "=", ctx.orgId).where("event", "=", event).execute();
}

async function chaserMailbox(trx: Transaction<DB>, s: Setup) {
  const settings = await getMailboxSettings(trx, s.ctx, s.mailboxId);
  return { id: s.mailboxId, timezone: TZ, settingsVersion: settings?.version as string };
}

describe("remindNow", () => {
  test("T1. an overdue delegation: one reminder draft `ready` and one send `awaiting_approval` without a set; one audit row", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const d = await openDelegation(trx, s);
      const result = await remind(trx, s, d.id);
      expect(result.kind).toBe("planned");

      const [draft, send] = await manualRows(trx, s.ctx);
      expect(draft).toMatchObject({ type: "create_draft", status: "ready", email_id: d.emailId });
      expect(draft?.payload).toMatchObject({
        kind: "reminder",
        reminder: 1,
        delegation_id: d.id,
        delegate_id: d.delegateId,
        to: [d.delegateEmail],
        language: "pl",
        due_date: "2026-11-25",
      });
      expect(send).toMatchObject({ type: "send", status: "awaiting_approval", depends_on_action_id: draft?.id });
      expect(result).toEqual({ kind: "planned", sendId: send?.id as string });
      expect(send?.payload).toMatchObject({ delegation_id: d.id, reminder: 1, to: [d.delegateEmail] });
      expect("set_id" in (send?.payload as object)).toBe(false);
      expect(send?.approved_by).toBeNull();
      expect(draft?.idempotency_key).toMatch(new RegExp(`^${d.emailId}:create_draft:reminder:manual:[0-9a-f-]{36}$`));
      expect(send?.idempotency_key).toMatch(new RegExp(`^${d.emailId}:send:reminder:manual:[0-9a-f-]{36}$`));
      // The thread of the delegation mail: the references, the original id and the id of the sent mail.
      expect((draft?.payload as { thread: { references: string[] } }).thread.references).toEqual([
        "<root@x.test>",
        "<orig@x.test>",
        (await getDelegation(trx, s.ctx, d.id))?.sent_message_id as string,
      ]);

      const audit = await auditRows(trx, s.ctx, "delegation.remind_requested");
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actor: s.userId,
        email_id: d.emailId,
        action_id: send?.id,
        data: { delegation_id: d.id, reminder: 1, via: "web" },
      });
      expect(Object.keys(audit[0]?.data as object).sort()).toEqual(["delegation_id", "reminder", "via"]);
      // The status stays; the 3-day gap of the chaser starts now.
      const row = await getDelegation(trx, s.ctx, d.id);
      expect(row).toMatchObject({ status: "overdue", reminders_sent: 0 });
      expect(row?.last_reminder_at?.toISOString()).toBe(NOW.toISOString());
    });
  });

  test("T1b. the second reminder says 2; via cli is in the audit row", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const d = await openDelegation(trx, s, { remindersSent: 1 });
      expect((await remind(trx, s, d.id, "cli")).kind).toBe("planned");
      const [draft] = await manualRows(trx, s.ctx);
      expect(draft?.payload).toMatchObject({ reminder: 2 });
      const audit = await auditRows(trx, s.ctx, "delegation.remind_requested");
      expect(audit[0]?.data).toMatchObject({ reminder: 2, via: "cli" });
    });
  });

  test("T2. the same call again is reminder_waiting; no new row", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const d = await openDelegation(trx, s);
      expect((await remind(trx, s, d.id)).kind).toBe("planned");
      expect(await remind(trx, s, d.id)).toEqual({ kind: "reminder_waiting" });
      expect(await manualRows(trx, s.ctx)).toHaveLength(2);
      expect(await auditRows(trx, s.ctx, "delegation.remind_requested")).toHaveLength(1);
    });
  });

  test("T2b. a reminder send that is awaiting_approval, approved or applying waits; one that is over does not", async () => {
    for (const [status, expected] of [
      ["awaiting_approval", "reminder_waiting"],
      ["approved", "reminder_waiting"],
      ["applying", "reminder_waiting"],
      ["applied", "planned"],
      ["expired", "planned"],
    ] as const) {
      await withRollback(db, async (trx) => {
        const s = await setup(trx);
        const d = await openDelegation(trx, s);
        await insertDraftAndSend(trx, s.ctx, s.mailboxId, {
          delegateId: d.delegateId,
          delegationId: d.id,
          reminder: 1,
          sendStatus: status,
          ...(status === "awaiting_approval" || status === "expired"
            ? {}
            : { approved: { userId: s.userId, at: NOW } }),
          ...(status === "applying" ? { lockedAt: NOW } : {}),
        });
        expect([status, (await remind(trx, s, d.id)).kind]).toEqual([status, expected]);
      });
    }
  });

  test("T4. a sent delegation that is due tomorrow gets a reminder: no due-date gate", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const d = await openDelegation(trx, s, { status: "sent", dueAt: new Date(NOW.getTime() + DAY_MS) });
      expect((await remind(trx, s, d.id)).kind).toBe("planned");
      expect((await getDelegation(trx, s.ctx, d.id))?.status).toBe("sent");
    });
  });

  test("T4b. no 3-day gap and no 07:30 gate: a reminder of 2 hours ago does not stop it", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const d = await openDelegation(trx, s, { remindersSent: 1 });
      await trx
        .updateTable("delegations")
        .set({ last_reminder_at: new Date(NOW.getTime() - 2 * HOUR_MS) })
        .where("id", "=", d.id)
        .execute();
      expect((await remind(trx, s, d.id)).kind).toBe("planned");
    });
  });

  test("T5. two reminders sent is limit_reached; drafted, answered, done and cancelled are not_open; an unknown id is not_found", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const limit = await openDelegation(trx, s, { remindersSent: 2 });
      expect(await remind(trx, s, limit.id)).toEqual({ kind: "limit_reached" });
      for (const status of ["drafted", "answered", "done", "cancelled"]) {
        const d = await openDelegation(trx, s, { status });
        expect([status, await remind(trx, s, d.id)]).toEqual([status, { kind: "not_open" }]);
      }
      // `not_open` comes before `limit_reached`.
      const closed = await openDelegation(trx, s, { status: "done", remindersSent: 2 });
      expect(await remind(trx, s, closed.id)).toEqual({ kind: "not_open" });
      expect(await remind(trx, s, randomUUID())).toEqual({ kind: "not_found" });
      expect(await manualRows(trx, s.ctx)).toEqual([]);
      expect(await auditRows(trx, s.ctx, "delegation.remind_requested")).toEqual([]);
    });
  });

  test("T6. shadow mode and create_draft off are drafts_off; a disabled delegate is delegate_inactive, also with drafts off", async () => {
    await withRollback(db, async (trx) => {
      const shadow = await setup(trx, { mode: "shadow" });
      const a = await openDelegation(trx, shadow);
      expect(await remind(trx, shadow, a.id)).toEqual({ kind: "drafts_off" });

      const off = await setup(trx, { createDraft: false });
      const b = await openDelegation(trx, off);
      expect(await remind(trx, off, b.id)).toEqual({ kind: "drafts_off" });

      const ok = await setup(trx);
      const c = await openDelegation(trx, ok, { active: false });
      expect(await remind(trx, ok, c.id)).toEqual({ kind: "delegate_inactive" });
      await setSettings(trx, ok.ctx, ok.mailboxId, { mode: "shadow" });
      expect(await remind(trx, ok, c.id)).toEqual({ kind: "delegate_inactive" });

      for (const s of [shadow, off, ok]) expect(await manualRows(trx, s.ctx)).toEqual([]);
    });
  });

  test("T6b. a waiting reminder wins over an inactive delegate; without a waiting reminder the inactive delegate is reported", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const waiting = await openDelegation(trx, s);
      await insertDraftAndSend(trx, s.ctx, s.mailboxId, {
        delegateId: waiting.delegateId,
        delegationId: waiting.id,
        reminder: 1,
        sendStatus: "awaiting_approval",
      });
      // Turning a delegate off does not expire a waiting reminder: both states exist together.
      await trx.updateTable("delegates").set({ active: false }).where("id", "=", waiting.delegateId).execute();
      expect(await remind(trx, s, waiting.id)).toEqual({ kind: "reminder_waiting" });

      const idle = await openDelegation(trx, s, { active: false });
      expect(await remind(trx, s, idle.id)).toEqual({ kind: "delegate_inactive" });
    });
  });

  test("T7. after a remind, a forced chaser run plans no second reminder for the delegation", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const d = await openDelegation(trx, s);
      expect((await remind(trx, s, d.id)).kind).toBe("planned");
      const before = await reminderRows(trx, s.ctx);
      const result = await runChaserForMailbox({ db: trx, now: () => NOW }, s.ctx, await chaserMailbox(trx, s), NOW, {
        force: true,
      });
      expect(result).toMatchObject({ reminders: 0, skipped: null });
      expect(await reminderRows(trx, s.ctx)).toEqual(before);
    });
  });

  test("T7b. the chaser of the next morning, after the remind was applied, waits for the 3-day gap", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const d = await openDelegation(trx, s);
      expect((await remind(trx, s, d.id)).kind).toBe("planned");
      await trx
        .updateTable("actions")
        .set({ status: "applied", applied_at: NOW, approved_by: s.userId, approved_at: NOW, approved_via: "telegram" })
        .where("org_id", "=", s.ctx.orgId)
        .where(sql<boolean>`idempotency_key LIKE '%:reminder:manual:%'`)
        .execute();
      await trx.updateTable("delegations").set({ reminders_sent: 1 }).where("id", "=", d.id).execute();
      const next = new Date("2026-11-21T06:30:00Z");
      const result = await runChaserForMailbox({ db: trx, now: () => next }, s.ctx, await chaserMailbox(trx, s), next);
      expect(result).toMatchObject({ reminders: 0, skipped: null });
      expect(await reminderRows(trx, s.ctx)).toHaveLength(2);
    });
  });

  test("T8. a rejected reminder of the same day: the second remind plans again (no key clash)", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const d = await openDelegation(trx, s);
      const first = await remind(trx, s, d.id);
      if (first.kind !== "planned") throw new Error("not planned");
      await trx.updateTable("actions").set({ status: "rejected" }).where("id", "=", first.sendId).execute();
      const second = await remind(trx, s, d.id);
      if (second.kind !== "planned") throw new Error("not planned");
      expect(second.sendId).not.toBe(first.sendId);
      const rows = await manualRows(trx, s.ctx);
      expect(rows).toHaveLength(4);
      expect(new Set(rows.map((row) => row.idempotency_key)).size).toBe(4);
      expect(await auditRows(trx, s.ctx, "delegation.remind_requested")).toHaveLength(2);
    });
  });

  test("T11. another organization: its context finds nothing (not_found) and no row is made", async () => {
    await withRollback(db, async (trx) => {
      const mine = await setup(trx);
      const d = await openDelegation(trx, mine);
      const theirs = await setup(trx);
      expect(await remind(trx, theirs, d.id)).toEqual({ kind: "not_found" });
      expect(await manualRows(trx, mine.ctx)).toEqual([]);
      expect(await manualRows(trx, theirs.ctx)).toEqual([]);
      expect(await auditRows(trx, theirs.ctx, "delegation.remind_requested")).toEqual([]);
      expect((await remind(trx, mine, d.id)).kind).toBe("planned");
    });
  });
});

// A tap is always needed (ADR 0003). One committer tick applies the draft and never the send; the notifier then queues one
// `approval` card for the owner and no set card.
describe("remindNow: a mail to a person needs a tap", () => {
  const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

  test("T9. after a committer tick the send is still awaiting_approval; the notifier queues one approval card once the draft is applied", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const secret = secrets.encrypt("pw", `mailbox:${s.mailboxId}`);
      await insertCredentials(trx, s.ctx, {
        mailboxId: s.mailboxId,
        encryptedSecret: secret.ciphertext,
        secretKind: "password",
        keyVersion: secret.keyVersion,
      });
      await linkChat(trx, s.ctx, s.userId, randomChatId(), NOW);
      const d = await openDelegation(trx, s);
      const planned = await remind(trx, s, d.id);
      if (planned.kind !== "planned") throw new Error("not planned");

      // The draft is not applied yet: nothing to notify.
      expect(await listSendsToNotify(trx, s.ctx, { limit: 10 })).toEqual([]);

      const job = createCommitterJob({
        db: trx,
        secrets,
        openProvider: async () => createFakeMailProvider(),
        scope: { kind: "all" },
        now: () => NOW,
      });
      await job.run();

      const [draft, send] = await manualRows(trx, s.ctx);
      expect(draft?.status).toBe("applied");
      expect(send).toMatchObject({
        id: planned.sendId,
        status: "awaiting_approval",
        approved_by: null,
        approved_at: null,
        locked_at: null,
      });

      expect((await listSendsToNotify(trx, s.ctx, { limit: 10 })).map((row) => row.id)).toEqual([planned.sendId]);
      await detectNotices({
        db: trx,
        now: () => NOW,
        startedAt: new Date(NOW.getTime() - HOUR_MS),
        testMail: NO_TEST_SENDERS,
      });
      const cards = await trx
        .selectFrom("outbox")
        .select(["kind", "dedup_key", "user_id"])
        .where("org_id", "=", s.orgId)
        .where("kind", "in", ["approval", "approval_set"])
        .execute();
      expect(cards).toEqual([{ kind: "approval", dedup_key: `approval:${planned.sendId}`, user_id: s.userId }]);

      // Another tick leaves the send as it is: only a tap approves it.
      await job.run();
      const after = await trx
        .selectFrom("actions")
        .select("status")
        .where("id", "=", planned.sendId)
        .executeTakeFirst();
      expect(after).toEqual({ status: "awaiting_approval" });
    });
  });
});
