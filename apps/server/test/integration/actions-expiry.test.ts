import { randomBytes } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  createCommitterJob,
  createExpiryJob,
  expireSend,
  getDraft,
  getSend,
  listExpiredApprovals,
  noDelegationHooks,
  STALE_AFTER_MS,
  type DelegationHooks,
} from "../../src/modules/actions";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { createFakeMailSender } from "../../src/modules/mail/fake/sender";
import { insertCredentials, setMailboxStatus } from "../../src/modules/mail/repo";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertDraftAndSend, pauseOtherMailboxes, resumeOrg, suspendOrg } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = new Date("2026-11-07T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const APPLIED = { folder: "Drafts", uid: 7 };

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

async function setup(trx: Transaction<DB>) {
  await pauseOtherMailboxes(trx);
  const org = await createOrgWithMailbox(trx);
  return { ...org, ctx: { orgId: org.orgId } };
}

function jobFor(
  trx: Transaction<DB>,
  hooks: DelegationHooks,
  opts: { uidplus?: boolean; listExpired?: typeof listExpiredApprovals } = {}
) {
  return createExpiryJob({
    db: trx,
    now: () => now,
    hooks,
    uidplus: async () => opts.uidplus ?? true,
    listExpired: opts.listExpired,
  });
}

async function reverseRows(trx: Transaction<DB>, ctx: TenantContext, draftId: string) {
  return trx
    .selectFrom("actions")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("reverses_action_id", "=", draftId)
    .execute();
}

async function auditCount(trx: Transaction<DB>, ctx: TenantContext, actionId: string) {
  const rows = await trx
    .selectFrom("audit_log")
    .select("id")
    .where("org_id", "=", ctx.orgId)
    .where("action_id", "=", actionId)
    .where("event", "=", "action.expired")
    .execute();
  return rows.length;
}

type Pair = Parameters<typeof insertDraftAndSend>[3];

async function waiting(trx: Transaction<DB>, ctx: TenantContext, mailboxId: string, opts: Pair = {}) {
  return insertDraftAndSend(trx, ctx, mailboxId, {
    delegationId: "11111111-1111-4111-8111-111111111111",
    draftProviderResult: APPLIED,
    createdAt: ago(DAY),
    notifiedAt: ago(HOUR),
    ...opts,
  });
}

describe("createExpiryJob", () => {
  test("(1) timeout: expired, audit, reverse row, hook", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks, calls } = recordingHooks();
      const p = await waiting(trx, s.ctx, s.mailboxId, { notifiedAt: ago(49 * HOUR) });

      await jobFor(trx, hooks).run();

      expect(await getSend(trx, s.ctx, p.sendId)).toMatchObject({ status: "expired", status_reason: "timeout" });
      expect(await auditCount(trx, s.ctx, p.sendId)).toBe(1);
      const reverses = await reverseRows(trx, s.ctx, p.draftId);
      expect(reverses).toHaveLength(1);
      expect(reverses[0]).toMatchObject({
        type: "create_draft",
        status: "ready",
        payload: { folder: "Drafts", uid: 7, reason: "expired" },
      });
      expect(calls).toEqual([{ delegationId: "11111111-1111-4111-8111-111111111111", reason: "expired", at: now }]);
    });
  });

  test("(2) notified 47 h ago: unchanged", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks, calls } = recordingHooks();
      const p = await waiting(trx, s.ctx, s.mailboxId, { notifiedAt: ago(47 * HOUR) });

      await jobFor(trx, hooks).run();

      expect((await getSend(trx, s.ctx, p.sendId))?.status).toBe("awaiting_approval");
      expect(calls).toEqual([]);
    });
  });

  test("(3) failed draft: draft_missing, no reverse row", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks, calls } = recordingHooks();
      const p = await waiting(trx, s.ctx, s.mailboxId, { draftStatus: "failed", draftProviderResult: undefined });

      await jobFor(trx, hooks).run();

      expect(await getSend(trx, s.ctx, p.sendId)).toMatchObject({ status: "expired", status_reason: "draft_missing" });
      expect(await reverseRows(trx, s.ctx, p.draftId)).toEqual([]);
      expect(calls.map((call) => call.reason)).toEqual(["draft_missing"]);
    });
  });

  test("(3a) an undone draft: draft_missing too", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks, calls } = recordingHooks();
      const p = await waiting(trx, s.ctx, s.mailboxId, { draftStatus: "undone" });

      await jobFor(trx, hooks).run();

      expect(await getSend(trx, s.ctx, p.sendId)).toMatchObject({ status: "expired", status_reason: "draft_missing" });
      expect(calls.map((call) => call.reason)).toEqual(["draft_missing"]);
    });
  });

  test("(3b) an applying draft is not draft_missing", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks } = recordingHooks();
      const p = await waiting(trx, s.ctx, s.mailboxId, { draftStatus: "applying", draftProviderResult: undefined });

      await jobFor(trx, hooks).run();

      expect((await getSend(trx, s.ctx, p.sendId))?.status).toBe("awaiting_approval");
    });
  });

  test("(4) never notified: 8 days expired, 6 days unchanged", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks, calls } = recordingHooks();
      const old = await waiting(trx, s.ctx, s.mailboxId, { notifiedAt: null, createdAt: ago(8 * DAY) });
      const young = await waiting(trx, s.ctx, s.mailboxId, { notifiedAt: null, createdAt: ago(6 * DAY) });

      await jobFor(trx, hooks).run();

      expect(await getSend(trx, s.ctx, old.sendId)).toMatchObject({ status: "expired", status_reason: "not_notified" });
      expect((await getSend(trx, s.ctx, young.sendId))?.status).toBe("awaiting_approval");
      expect(calls.map((call) => call.reason)).toEqual(["expired"]);
    });
  });

  test("(4b) timeout with a ready draft: the draft expires, no reverse row", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks } = recordingHooks();
      const p = await waiting(trx, s.ctx, s.mailboxId, {
        notifiedAt: ago(49 * HOUR),
        draftStatus: "ready",
        draftProviderResult: undefined,
      });

      await jobFor(trx, hooks).run();

      expect((await getDraft(trx, s.ctx, p.draftId))?.status).toBe("expired");
      const audit = await trx
        .selectFrom("audit_log")
        .select("reason_code")
        .where("action_id", "=", p.draftId)
        .where("event", "=", "action.expired")
        .execute();
      expect(audit).toEqual([{ reason_code: "send_closed" }]);
      expect(await reverseRows(trx, s.ctx, p.draftId)).toEqual([]);
    });
  });

  test("(5) a paused mailbox is walked", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await setMailboxStatus(trx, s.ctx, s.mailboxId, "paused", now);
      const { hooks } = recordingHooks();
      const p = await waiting(trx, s.ctx, s.mailboxId, { notifiedAt: ago(49 * HOUR) });

      await jobFor(trx, hooks).run();

      expect((await getSend(trx, s.ctx, p.sendId))?.status).toBe("expired");
    });
  });

  test("(6) held_timeout: old approval with no lock expires; 47 h and in-flight stay", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks, calls } = recordingHooks();
      const approved = (at: Date, lockedAt: Date | null = null): Pair => ({
        sendStatus: "approved",
        approved: { userId: s.userId, at },
        notifiedAt: ago(100 * HOUR),
        lockedAt,
      });
      const held = await waiting(trx, s.ctx, s.mailboxId, approved(ago(49 * HOUR)));
      const fresh = await waiting(trx, s.ctx, s.mailboxId, approved(ago(47 * HOUR)));
      const flying = await waiting(trx, s.ctx, s.mailboxId, approved(ago(72 * HOUR), ago(60_000)));
      const staleLock = await waiting(trx, s.ctx, s.mailboxId, approved(ago(72 * HOUR), ago(STALE_AFTER_MS + 60_000)));

      await jobFor(trx, hooks).run();

      expect(await getSend(trx, s.ctx, held.sendId)).toMatchObject({
        status: "expired",
        status_reason: "held_timeout",
      });
      expect(await reverseRows(trx, s.ctx, held.draftId)).toHaveLength(1);
      expect((await getSend(trx, s.ctx, fresh.sendId))?.status).toBe("approved");
      expect((await getSend(trx, s.ctx, flying.sendId))?.status).toBe("approved");
      expect((await getSend(trx, s.ctx, staleLock.sendId))?.status).toBe("expired");
      expect(calls.map((call) => call.reason)).toEqual(["expired", "expired"]);
    });
  });

  test("(7) clarification and reminder sends expire without a hook call", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks, calls } = recordingHooks();
      const clarification = await insertDraftAndSend(trx, s.ctx, s.mailboxId, {
        kind: "clarification",
        draftProviderResult: APPLIED,
        createdAt: ago(DAY),
        notifiedAt: ago(49 * HOUR),
      });
      const reminder = await insertDraftAndSend(trx, s.ctx, s.mailboxId, {
        reminder: 1,
        draftProviderResult: APPLIED,
        createdAt: ago(DAY),
        notifiedAt: ago(49 * HOUR),
      });

      await jobFor(trx, hooks).run();

      expect((await getSend(trx, s.ctx, clarification.sendId))?.status).toBe("expired");
      expect((await getSend(trx, s.ctx, reminder.sendId))?.status).toBe("expired");
      expect(calls).toEqual([]);
    });
  });

  test("(8) no UIDPLUS: no reverse row", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks } = recordingHooks();
      const p = await waiting(trx, s.ctx, s.mailboxId, { notifiedAt: ago(49 * HOUR) });

      await jobFor(trx, hooks, { uidplus: false }).run();

      expect((await getSend(trx, s.ctx, p.sendId))?.status).toBe("expired");
      expect(await reverseRows(trx, s.ctx, p.draftId)).toEqual([]);
    });
  });

  test("(9) a tap that wins the race: expireSend returns false and writes nothing", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks, calls } = recordingHooks();
      const p = await waiting(trx, s.ctx, s.mailboxId, { notifiedAt: ago(49 * HOUR) });
      await trx
        .updateTable("actions")
        .set({ status: "approved", approved_at: now, approved_by: s.userId, approved_via: "telegram" })
        .where("id", "=", p.sendId)
        .execute();

      const closed = await expireSend(trx, s.ctx, p.sendId, {
        reason: "timeout",
        now,
        actor: "system",
        hooks,
        uidplus: true,
      });

      expect(closed).toBe(false);
      expect(await auditCount(trx, s.ctx, p.sendId)).toBe(0);
      expect(await reverseRows(trx, s.ctx, p.draftId)).toEqual([]);
      expect(calls).toEqual([]);
    });
  });

  test("(9b) held_timeout on an approved send with a fresh lock: false, nothing changes", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks, calls } = recordingHooks();
      const p = await waiting(trx, s.ctx, s.mailboxId, {
        sendStatus: "approved",
        approved: { userId: s.userId, at: ago(72 * HOUR) },
        lockedAt: ago(60_000),
      });

      const closed = await expireSend(trx, s.ctx, p.sendId, {
        reason: "held_timeout",
        now,
        actor: "system",
        hooks,
        uidplus: true,
      });

      expect(closed).toBe(false);
      expect((await getSend(trx, s.ctx, p.sendId))?.status).toBe("approved");
      expect(await auditCount(trx, s.ctx, p.sendId)).toBe(0);
      expect(await reverseRows(trx, s.ctx, p.draftId)).toEqual([]);
      expect(calls).toEqual([]);
    });
  });

  test("(10) two organizations; an error on one mailbox does not stop the next", async () => {
    await withRollback(db, async (trx) => {
      const a = await setup(trx);
      const b = await createOrgWithMailbox(trx);
      // The job walks mailboxes by `created_at`: A comes first, so its error comes before B.
      await trx
        .updateTable("mailboxes")
        .set({ created_at: ago(DAY) })
        .where("id", "=", a.mailboxId)
        .execute();
      const { hooks } = recordingHooks();
      const pa = await waiting(trx, a.ctx, a.mailboxId, { notifiedAt: ago(49 * HOUR) });
      const pb = await waiting(trx, { orgId: b.orgId }, b.mailboxId, { notifiedAt: ago(49 * HOUR) });

      await jobFor(trx, hooks).run();
      expect((await getSend(trx, a.ctx, pa.sendId))?.status).toBe("expired");
      expect((await getSend(trx, { orgId: b.orgId }, pb.sendId))?.status).toBe("expired");

      const pa2 = await waiting(trx, a.ctx, a.mailboxId, { notifiedAt: ago(49 * HOUR) });
      const pb2 = await waiting(trx, { orgId: b.orgId }, b.mailboxId, { notifiedAt: ago(49 * HOUR) });
      let thrown = false;
      await jobFor(trx, hooks, {
        listExpired: (dbOrTrx, ctx, mailboxId, opts) => {
          if (mailboxId === a.mailboxId) {
            thrown = true;
            throw new Error("boom");
          }
          return listExpiredApprovals(dbOrTrx, ctx, mailboxId, opts);
        },
      }).run();

      const statuses = [
        (await getSend(trx, a.ctx, pa2.sendId))?.status,
        (await getSend(trx, { orgId: b.orgId }, pb2.sendId))?.status,
      ];
      expect(thrown).toBe(true);
      expect(statuses).toEqual(["awaiting_approval", "expired"]);
    });
  });

  test("(11) tenant: org A's context does not reach org B's rows", async () => {
    await withRollback(db, async (trx) => {
      const a = await setup(trx);
      const b = await createOrgWithMailbox(trx);
      const { hooks } = recordingHooks();
      const pb = await waiting(trx, { orgId: b.orgId }, b.mailboxId, { notifiedAt: ago(49 * HOUR) });

      const rows = await listExpiredApprovals(trx, a.ctx, b.mailboxId, {
        now,
        limit: 10,
        staleBefore: ago(STALE_AFTER_MS),
      });
      expect(rows).toEqual([]);
      expect(
        await expireSend(trx, a.ctx, pb.sendId, { reason: "timeout", now, actor: "system", hooks, uidplus: true })
      ).toBe(false);
      expect((await getSend(trx, { orgId: b.orgId }, pb.sendId))?.status).toBe("awaiting_approval");
    });
  });
});

describe("suspended organizations", () => {
  test("(12) the expiry runs for a suspended organization; a resume does not send an approval older than 48 h", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const secret = createSecretBox(randomBytes(32).toString("base64"), 1);
      const box = secret.encrypt("pw", `mailbox:${s.mailboxId}`);
      await insertCredentials(trx, s.ctx, {
        mailboxId: s.mailboxId,
        encryptedSecret: box.ciphertext,
        secretKind: "password",
        keyVersion: box.keyVersion,
      });
      await suspendOrg(trx, s.orgId);
      const { hooks } = recordingHooks();
      const awaiting = await waiting(trx, s.ctx, s.mailboxId, { notifiedAt: ago(49 * HOUR) });

      await jobFor(trx, hooks).run();

      expect(await getSend(trx, s.ctx, awaiting.sendId)).toMatchObject({ status: "expired", status_reason: "timeout" });

      // A send that was approved 49 h ago, before the pause. The resume does not revive it.
      const approved = await waiting(trx, s.ctx, s.mailboxId, {
        delegationId: undefined,
        sendStatus: "approved",
        approved: { userId: s.userId, at: ago(49 * HOUR) },
      });
      await resumeOrg(trx, s.orgId, now);
      // The committer still applies the reverse draft row of the first expiry: it opens the provider, not the sender.
      const opened: string[] = [];
      const smtpCalls: string[] = [];
      const sender = createFakeMailSender();
      const committer = createCommitterJob({
        db: trx,
        secrets: secret,
        openProvider: async (opts) => {
          opened.push(opts.user);
          return createFakeMailProvider();
        },
        openSender: async (opts) => {
          smtpCalls.push(opts.user);
          return sender;
        },
        scope: { kind: "all" },
        sendScope: { kind: "all" },
        now: () => now,
      });

      await committer.run();

      expect(opened).toHaveLength(1);
      expect(smtpCalls).toEqual([]);
      expect(sender.sent).toEqual([]);
      expect(await getSend(trx, s.ctx, approved.sendId)).toMatchObject({
        status: "approved",
        locked_at: null,
        attempts: 0,
      });

      await jobFor(trx, hooks).run();

      expect(await getSend(trx, s.ctx, approved.sendId)).toMatchObject({
        status: "expired",
        status_reason: "held_timeout",
      });
    });
  });
});
