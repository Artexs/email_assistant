import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import {
  closeDraftOfSend,
  expireReminderActions,
  expireSend,
  getDraft,
  getSend,
  listSendsOfDraft,
  noDelegationHooks,
  STALE_AFTER_MS,
  type DelegationHooks,
  type SendCloseReason,
} from "../../src/modules/actions";
import { markAnswered } from "../../src/modules/delegation";
import { mailboxHasUidplus } from "../../src/modules/mail";
import { insertMailbox } from "../../src/modules/mail/repo";
import type { DB, TenantContext } from "../../src/platform/db";

import {
  createOrgWithMailbox,
  insertAction,
  insertDelegate,
  insertDelegation,
  insertTestEmail,
  insertTriagedWithActions,
  testCapabilities,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const now = new Date("2026-11-07T12:00:00Z");
const delegationId = "11111111-1111-4111-8111-111111111111";

function recordingHooks() {
  const calls: { delegationId: string; reason: string; at: Date }[] = [];
  const hooks: DelegationHooks = {
    ...noDelegationHooks,
    onCancelled: async (_trx, _ctx, input) => {
      calls.push(input);
      return true;
    },
  };
  return { hooks, calls };
}

type SendOpts = Partial<Parameters<typeof insertAction>[3]>;

// A mail with a draft and a send that depends on it.
async function pair(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  opts: {
    draft?: SendOpts;
    send?: SendOpts;
    sendPayload?: Record<string, unknown>;
    draftPayload?: Record<string, unknown>;
  } = {}
) {
  const { emailId, actionIds } = await insertTriagedWithActions(trx, ctx, mailboxId, {
    category: "delegation",
    createdAt: new Date("2026-11-07T08:00:00Z"),
    actions: [
      {
        type: "create_draft",
        status: "applied",
        payload: opts.draftPayload ?? { kind: "delegation" },
        providerResult: { uid: 7, folder: "Drafts" },
        ...opts.draft,
      },
    ],
  });
  const draftId = actionIds[0] as string;
  const sendId = await insertAction(trx, ctx, emailId, {
    type: "send",
    status: "awaiting_approval",
    dependsOnActionId: draftId,
    payload: opts.sendPayload ?? { kind: "delegation", to: ["d@x.test"], delegation_id: delegationId },
    ...opts.send,
  });
  return { emailId, draftId, sendId };
}

async function setup(trx: Transaction<DB>) {
  const org = await createOrgWithMailbox(trx);
  return { ...org, ctx: { orgId: org.orgId } };
}

async function auditRows(trx: Transaction<DB>, ctx: TenantContext, event: string) {
  return trx.selectFrom("audit_log").selectAll().where("org_id", "=", ctx.orgId).where("event", "=", event).execute();
}

async function reverseRows(trx: Transaction<DB>, ctx: TenantContext, draftId: string) {
  return trx
    .selectFrom("actions")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("reverses_action_id", "=", draftId)
    .execute();
}

function close(
  trx: Transaction<DB>,
  ctx: TenantContext,
  sendId: string,
  hooks: DelegationHooks,
  opts?: { reason?: SendCloseReason; uidplus?: boolean }
) {
  return expireSend(trx, ctx, sendId, {
    reason: opts?.reason ?? "timeout",
    now,
    actor: "system",
    hooks,
    uidplus: opts?.uidplus ?? true,
  });
}

describe("expireSend", () => {
  test("an awaiting_approval delegation send with an applied draft, UIDPLUS", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s.ctx, s.mailboxId);
      const { hooks, calls } = recordingHooks();

      expect(await close(trx, s.ctx, p.sendId, hooks)).toBe(true);

      const send = await getSend(trx, s.ctx, p.sendId);
      expect(send).toMatchObject({ status: "expired", status_reason: "timeout" });
      const audit = await auditRows(trx, s.ctx, "action.expired");
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        action_id: p.sendId,
        email_id: p.emailId,
        actor: "system",
        reason_code: "timeout",
        data: { action_type: "send", reason: "timeout" },
      });
      const reverses = await reverseRows(trx, s.ctx, p.draftId);
      expect(reverses).toHaveLength(1);
      expect(reverses[0]).toMatchObject({
        type: "create_draft",
        status: "ready",
        payload: { kind: "delegation", folder: "Drafts", uid: 7, reason: "expired" },
      });
      expect(calls).toEqual([{ delegationId, reason: "expired", at: now }]);
      const sentRow = await trx
        .selectFrom("actions")
        .select("result_notified_at")
        .where("id", "=", p.sendId)
        .executeTakeFirstOrThrow();
      expect(sentRow.result_notified_at).toBeNull();
    });
  });

  test("no UIDPLUS: no reverse row; ready draft expired; applying draft untouched; failed draft: draft_missing", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks, calls } = recordingHooks();

      const noUid = await pair(trx, s.ctx, s.mailboxId);
      expect(await close(trx, s.ctx, noUid.sendId, hooks, { uidplus: false })).toBe(true);
      expect(await reverseRows(trx, s.ctx, noUid.draftId)).toEqual([]);
      expect((await getDraft(trx, s.ctx, noUid.draftId))?.status).toBe("applied");

      const ready = await pair(trx, s.ctx, s.mailboxId, { draft: { status: "ready", providerResult: null } });
      expect(await close(trx, s.ctx, ready.sendId, hooks)).toBe(true);
      const readyDraft = await trx
        .selectFrom("actions")
        .select(["status", "status_reason"])
        .where("id", "=", ready.draftId)
        .executeTakeFirstOrThrow();
      expect(readyDraft).toEqual({ status: "expired", status_reason: "send_closed" });
      const draftAudit = (await auditRows(trx, s.ctx, "action.expired")).filter((r) => r.action_id === ready.draftId);
      expect(draftAudit).toHaveLength(1);

      const applying = await pair(trx, s.ctx, s.mailboxId, {
        draft: { status: "applying", providerResult: null, lockedAt: now },
      });
      expect(await close(trx, s.ctx, applying.sendId, hooks)).toBe(true);
      expect((await getDraft(trx, s.ctx, applying.draftId))?.status).toBe("applying");
      expect(await reverseRows(trx, s.ctx, applying.draftId)).toEqual([]);

      calls.length = 0;
      const failed = await pair(trx, s.ctx, s.mailboxId, {
        draft: { status: "failed", providerResult: null, statusReason: "hard_error" },
      });
      expect(await close(trx, s.ctx, failed.sendId, hooks, { reason: "draft_missing" })).toBe(true);
      expect(calls).toEqual([{ delegationId, reason: "draft_missing", at: now }]);
    });
  });

  test("a reminder send and a clarification send call no hook", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks, calls } = recordingHooks();
      const reminder = await pair(trx, s.ctx, s.mailboxId, {
        sendPayload: { kind: "reminder", to: ["d@x.test"], delegation_id: delegationId, reminder: 1 },
      });
      const clarification = await pair(trx, s.ctx, s.mailboxId, {
        sendPayload: { kind: "clarification", to: ["s@x.test"] },
      });
      expect(await close(trx, s.ctx, reminder.sendId, hooks)).toBe(true);
      expect(await close(trx, s.ctx, clarification.sendId, hooks)).toBe(true);
      expect(calls).toEqual([]);
    });
  });

  test("an approved send", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks } = recordingHooks();
      const approved = (lockedAt: Date | null) =>
        pair(trx, s.ctx, s.mailboxId, { send: { status: "approved", approvedAt: now, lockedAt } });

      const timeout = await approved(null);
      expect(await close(trx, s.ctx, timeout.sendId, hooks, { reason: "timeout" })).toBe(false);
      expect((await getSend(trx, s.ctx, timeout.sendId))?.status).toBe("approved");

      const held = await approved(null);
      expect(await close(trx, s.ctx, held.sendId, hooks, { reason: "held_timeout" })).toBe(true);
      expect(await getSend(trx, s.ctx, held.sendId)).toMatchObject({
        status: "expired",
        status_reason: "held_timeout",
      });

      const fresh = await approved(new Date(now.getTime() - 60_000));
      expect(await close(trx, s.ctx, fresh.sendId, hooks, { reason: "held_timeout" })).toBe(false);
      expect((await getSend(trx, s.ctx, fresh.sendId))?.status).toBe("approved");

      const stale = await approved(new Date(now.getTime() - STALE_AFTER_MS - 60_000));
      expect(await close(trx, s.ctx, stale.sendId, hooks, { reason: "held_timeout" })).toBe(true);
      expect((await getSend(trx, s.ctx, stale.sendId))?.status).toBe("expired");

      const closed = await approved(null);
      expect(await close(trx, s.ctx, closed.sendId, hooks, { reason: "delegation_closed" })).toBe(true);
    });
  });

  test("an applied, rejected or expired send: false, no audit row", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks, calls } = recordingHooks();
      for (const status of ["applied", "rejected", "expired", "applying", "failed"]) {
        const p = await pair(trx, s.ctx, s.mailboxId, {
          send: { status, approvedAt: now, appliedAt: status === "applied" ? now : null },
        });
        expect(await close(trx, s.ctx, p.sendId, hooks)).toBe(false);
        expect((await getSend(trx, s.ctx, p.sendId))?.status).toBe(status);
      }
      expect(await auditRows(trx, s.ctx, "action.expired")).toEqual([]);
      expect(calls).toEqual([]);
      expect(await close(trx, s.ctx, randomUUID(), hooks)).toBe(false);
    });
  });
});

describe("closeDraftOfSend", () => {
  test("twice on an applied draft: one reverse row", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s.ctx, s.mailboxId);
      const opts = { reason: "rejected" as const, now, uidplus: true };
      expect(await closeDraftOfSend(trx, s.ctx, p.draftId, opts)).toBe("reverse");
      expect(await closeDraftOfSend(trx, s.ctx, p.draftId, opts)).toBe("reverse");
      const rows = await reverseRows(trx, s.ctx, p.draftId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ idempotency_key: `${p.draftId}:undo`, payload: { reason: "rejected" } });
    });
  });

  test("the other draft states", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const opts = { reason: "sent" as const, now, uidplus: true };
      expect(await closeDraftOfSend(trx, s.ctx, randomUUID(), opts)).toBe("none");
      for (const status of ["applying", "failed", "expired", "undone"]) {
        const p = await pair(trx, s.ctx, s.mailboxId, {
          draft: { status, appliedAt: status === "undone" ? now : null },
        });
        expect(await closeDraftOfSend(trx, s.ctx, p.draftId, opts)).toBe("none");
        expect(await reverseRows(trx, s.ctx, p.draftId)).toEqual([]);
      }
      const ready = await pair(trx, s.ctx, s.mailboxId, { draft: { status: "ready", providerResult: null } });
      expect(await closeDraftOfSend(trx, s.ctx, ready.draftId, opts)).toBe("expired");
      expect(await closeDraftOfSend(trx, s.ctx, ready.draftId, opts)).toBe("none");
      const noUid = await pair(trx, s.ctx, s.mailboxId);
      expect(await closeDraftOfSend(trx, s.ctx, noUid.draftId, { ...opts, uidplus: false })).toBe("none");
    });
  });
});

describe("expireReminderActions", () => {
  const reminderPayload = (id: string) => ({ kind: "reminder", to: ["d@x.test"], delegation_id: id, reminder: 1 });

  test("closes the open reminder sends with their drafts", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const awaiting = await pair(trx, s.ctx, s.mailboxId, {
        draft: { status: "ready", providerResult: null },
        sendPayload: reminderPayload(delegationId),
      });
      const applied = await pair(trx, s.ctx, s.mailboxId, { sendPayload: reminderPayload(delegationId) });
      const approved = await pair(trx, s.ctx, s.mailboxId, {
        send: { status: "approved", approvedAt: now },
        sendPayload: reminderPayload(delegationId),
      });
      const applying = await pair(trx, s.ctx, s.mailboxId, {
        send: { status: "applying", approvedAt: now, lockedAt: now },
        sendPayload: reminderPayload(delegationId),
      });
      const appliedSend = await pair(trx, s.ctx, s.mailboxId, {
        send: { status: "applied", approvedAt: now, appliedAt: now },
        sendPayload: reminderPayload(delegationId),
      });
      const delegationSend = await pair(trx, s.ctx, s.mailboxId); // no `reminder` key
      const other = await pair(trx, s.ctx, s.mailboxId, { sendPayload: reminderPayload(randomUUID()) });

      const result = await expireReminderActions(trx, s.ctx, delegationId, { now, uidplus: true, actor: "system" });
      expect(result).toEqual({ sends: 3 });

      for (const p of [awaiting, applied, approved]) {
        expect(await getSend(trx, s.ctx, p.sendId)).toMatchObject({
          status: "expired",
          status_reason: "delegation_closed",
        });
      }
      const draft = await getDraft(trx, s.ctx, awaiting.draftId);
      expect(draft?.status).toBe("expired");
      const closed = await trx
        .selectFrom("actions")
        .select("status_reason")
        .where("id", "=", awaiting.draftId)
        .executeTakeFirstOrThrow();
      expect(closed.status_reason).toBe("send_closed");
      const reverses = await reverseRows(trx, s.ctx, applied.draftId);
      expect(reverses).toHaveLength(1);
      expect(reverses[0]?.payload).toMatchObject({ reason: "expired", folder: "Drafts", uid: 7 });
      for (const p of [applying, appliedSend, delegationSend, other]) {
        const row = await getSend(trx, s.ctx, p.sendId);
        expect(["applying", "applied", "awaiting_approval"]).toContain(row?.status as string);
        expect(await reverseRows(trx, s.ctx, p.draftId)).toEqual([]);
      }
      expect((await getSend(trx, s.ctx, applying.sendId))?.status).toBe("applying");
      expect((await getSend(trx, s.ctx, appliedSend.sendId))?.status).toBe("applied");
      expect((await getSend(trx, s.ctx, delegationSend.sendId))?.status).toBe("awaiting_approval");
      expect(await listSendsOfDraft(trx, s.ctx, applied.draftId)).toEqual([{ id: applied.sendId, status: "expired" }]);
    });
  });
});

describe("mailboxHasUidplus", () => {
  test("true, false, another org", async () => {
    await withRollback(db, async (trx) => {
      const a = await setup(trx);
      const b = await setup(trx);
      const noUid = randomUUID();
      await insertMailbox(trx, a.ctx, {
        id: noUid,
        address: `nouid-${noUid}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: { ...testCapabilities, uidplus: false },
        folderMap: {},
      });
      expect(await mailboxHasUidplus(trx, a.ctx, a.mailboxId)).toBe(true);
      expect(await mailboxHasUidplus(trx, a.ctx, noUid)).toBe(false);
      expect(await mailboxHasUidplus(trx, b.ctx, a.mailboxId)).toBe(false);
      expect(await mailboxHasUidplus(trx, a.ctx, randomUUID())).toBe(false);
    });
  });
});

describe("lock order (S3 feature 4)", () => {
  test("markAnswered does not wait for an applying reminder send that another connection holds", async () => {
    const created = await db.transaction().execute((trx) => setup(trx));
    const ctx = created.ctx;
    try {
      const fixture = await db.transaction().execute(async (trx) => {
        const delegateId = await insertDelegate(trx, ctx);
        const p = await pair(trx, ctx, created.mailboxId);
        const id = await insertDelegation(trx, ctx, {
          mailboxId: created.mailboxId,
          emailId: p.emailId,
          delegateId,
          draftActionId: p.draftId,
          sendActionId: p.sendId,
          status: "sent",
        });
        const reminder = await pair(trx, ctx, created.mailboxId, {
          send: { status: "applying", approvedAt: now, lockedAt: now },
          sendPayload: { kind: "reminder", to: ["d@x.test"], delegation_id: id, reminder: 1 },
        });
        const answerId = await insertTestEmail(trx, ctx, created.mailboxId);
        return { id, reminderSendId: reminder.sendId, answerId };
      });

      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked: () => void = () => undefined;
      const lockedPromise = new Promise<void>((resolve) => {
        locked = resolve;
      });
      // connection 1: the committer's finishAction holds the applying send
      const holder = db.transaction().execute(async (trx) => {
        await sql`SELECT id FROM actions WHERE id = ${fixture.reminderSendId} FOR UPDATE`.execute(trx);
        locked();
        await gate;
      });
      await lockedPromise;

      // connection 2
      const answered = await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL lock_timeout = '2s'`.execute(trx);
        return markAnswered(trx, ctx, fixture.id, { emailId: fixture.answerId, at: now });
      });
      release();
      await holder;

      expect(answered).toBe(true);
      const row = await db
        .selectFrom("delegations")
        .select("status")
        .where("id", "=", fixture.id)
        .executeTakeFirstOrThrow();
      expect(row.status).toBe("answered");
      expect((await getSend(db, ctx, fixture.reminderSendId))?.status).toBe("applying");
      const audit = await db
        .selectFrom("audit_log")
        .select("data")
        .where("org_id", "=", ctx.orgId)
        .where("event", "=", "delegation.answered")
        .execute();
      expect(audit).toHaveLength(1);
      expect(audit[0]?.data).toMatchObject({ delegation_id: fixture.id, reminders_expired: 0 });
    } finally {
      await db.deleteFrom("organizations").where("id", "=", created.orgId).execute();
      await db.deleteFrom("users").where("id", "=", created.userId).execute();
    }
  });
});
