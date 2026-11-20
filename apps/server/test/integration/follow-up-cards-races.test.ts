// Every rule of the form "exactly one", "once", "never twice", "only" gets a race on two connections with committed
// rows, as the app role and as the table owner (the owner is not filtered by row-level security, so a missing `org_id` filter shows).
// The organization and its users are deleted after each test.
import { MINUTE_MS, HOUR_MS } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

import {
  approve,
  editApproval,
  expireSend,
  noDelegationHooks,
  reject,
  type ApprovalDeps,
} from "../../src/modules/actions";
import { cardEditHooks, detectNotices } from "../../src/modules/channels";
import { closeLoop, loopHooks, lockLoop } from "../../src/modules/loops";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { createDb, type Db } from "../../src/platform/db";

import { addMember, linkChat, randomChatId } from "./fixtures";
import { CURRENT_CONSENT, consentRow, insertFollowUp, OLD_CONSENT } from "./follow-up-fixtures";
import { testDb } from "./helpers";
import { approvalKit } from "./web-approvals-kit";

const appDb = testDb();
const ownerUrl = process.env.MIGRATOR_DATABASE_URL;
if (!ownerUrl) throw new Error("MIGRATOR_DATABASE_URL is missing: the race tests also run as the table owner");
const connections: Record<"app" | "owner", Db[]> = {
  app: [appDb, testDb()],
  owner: [createDb(ownerUrl), createDb(ownerUrl)],
};
const kit = approvalKit(appDb);
afterEach(kit.cleanup);
afterAll(async () => {
  for (const conn of [...connections.app, ...connections.owner]) await conn.destroy();
});

const ROLES = ["app", "owner"] as const;
const ROUNDS = 12;
const T = new Date();

function withTimeout<T>(p: Promise<T>, ms = 20_000): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout (deadlock?)")), ms))]);
}

// An organization: owner and owner 2 (both linked, both covered), a third owner with an old consent (linked), a member.
async function world() {
  const s = await kit.setup();
  await consentRow(appDb, s.org.orgId, s.org.ownerId, CURRENT_CONSENT, new Date(T.getTime() - HOUR_MS));
  await consentRow(appDb, s.org.orgId, s.u2, CURRENT_CONSENT, new Date(T.getTime() - HOUR_MS));
  const oldOwner = await appDb.transaction().execute(async (trx) => {
    const id = await addMember(trx, s.org.orgId, "owner");
    await linkChat(trx, s.ctx, id, randomChatId(), new Date(T.getTime() - HOUR_MS));
    return id;
  });
  await consentRow(appDb, s.org.orgId, oldOwner, OLD_CONSENT, new Date(T.getTime() - HOUR_MS));
  return { ...s, oldOwner };
}
type World = Awaited<ReturnType<typeof world>>;

const followUps = (s: World, count: number, opts: Parameters<typeof insertFollowUp>[4] = {}) =>
  Promise.all(
    Array.from({ length: count }, () =>
      insertFollowUp(appDb, s.ctx, s.mailboxId, s.org.ownerId, { createdAt: T, notifiedAt: null, ...opts })
    )
  );

const detect = (conn: Db) =>
  detectNotices({
    db: conn,
    now: () => new Date(),
    startedAt: new Date(T.getTime() - HOUR_MS),
    testMail: NO_TEST_SENDERS,
  });

const approvalDeps = (conn: Db): ApprovalDeps => ({
  db: conn,
  hooks: noDelegationHooks,
  approvalHooks: cardEditHooks({ sendScope: { kind: "all" } }),
  loopHooks: loopHooks(),
  uidplus: async () => true,
});

const outboxOf = (orgId: string, kind: string) =>
  appDb
    .selectFrom("outbox")
    .select(["user_id", "dedup_key", "status"])
    .where("org_id", "=", orgId)
    .where("kind", "=", kind)
    .execute();

const countBy = (rows: { user_id: string; dedup_key: string }[]) => {
  const counts = new Map<string, number>();
  for (const row of rows)
    counts.set(`${row.user_id}|${row.dedup_key}`, (counts.get(`${row.user_id}|${row.dedup_key}`) ?? 0) + 1);
  return counts;
};

for (const role of ROLES) {
  const [a, b] = connections[role];
  if (a === undefined || b === undefined) throw new Error("two connections");

  describe(`as the ${role} role: one notice per event`, () => {
    test("two notifier runs at once: one card per covered owner and send, one consent line per owner and day, no duplicate", async () => {
      const s = await world();
      const sends = await followUps(s, ROUNDS);
      await Promise.all([withTimeout(detect(a)), withTimeout(detect(b))]);
      const cards = await outboxOf(s.org.orgId, "approval");
      expect(cards).toHaveLength(ROUNDS * 2);
      for (const [, count] of countBy(cards)) expect(count).toBe(1);
      expect(new Set(cards.map((card) => card.dedup_key))).toEqual(new Set(sends.map((f) => `approval:${f.sendId}`)));
      expect(new Set(cards.map((card) => card.user_id))).toEqual(new Set([s.org.ownerId, s.u2]));
      const lines = await outboxOf(s.org.orgId, "loop_consent");
      expect(lines.map((line) => line.user_id)).toEqual([s.oldOwner]);
      // A third run adds nothing.
      await Promise.all([withTimeout(detect(a)), withTimeout(detect(b))]);
      expect(await outboxOf(s.org.orgId, "approval")).toHaveLength(ROUNDS * 2);
      expect(await outboxOf(s.org.orgId, "loop_consent")).toHaveLength(1);
    });

    test("an owner with an old consent: ten sends and two runs at once give one line", async () => {
      const s = await world();
      // The second owner withdraws: an old consent row replaces the current one.
      await consentRow(appDb, s.org.orgId, s.u2, OLD_CONSENT, new Date(T.getTime() - 30 * MINUTE_MS));
      await followUps(s, ROUNDS);
      await Promise.all([withTimeout(detect(a)), withTimeout(detect(b))]);
      const lines = await outboxOf(s.org.orgId, "loop_consent");
      expect(lines.map((line) => line.user_id).sort()).toEqual([s.oldOwner, s.u2].sort());
      expect(await outboxOf(s.org.orgId, "approval").then((rows) => new Set(rows.map((row) => row.user_id)))).toEqual(
        new Set([s.org.ownerId])
      );
    });

    test("a result and a failure: one send_result per covered owner, one action_failed per owner, even when two runs race", async () => {
      const s = await world();
      const ended = await followUps(s, ROUNDS, {
        sendStatus: "applied",
        notifiedAt: new Date(T.getTime() - HOUR_MS),
        send: { provider_result: JSON.stringify({ sent_copy: "appended" }) },
      });
      const failed = await followUps(s, ROUNDS, {
        sendStatus: "failed",
        notifiedAt: new Date(T.getTime() - HOUR_MS),
        send: { status_reason: "smtp_error" },
      });
      await Promise.all([withTimeout(detect(a)), withTimeout(detect(b))]);
      const results = await outboxOf(s.org.orgId, "send_result");
      expect(results).toHaveLength(ROUNDS * 2);
      for (const [, count] of countBy(results)) expect(count).toBe(1);
      const lines = await outboxOf(s.org.orgId, "loop_consent");
      expect(lines.map((line) => line.user_id)).toEqual([s.oldOwner]);
      const notices = (await outboxOf(s.org.orgId, "action_failed")).filter((row) =>
        failed.some((f) => row.dedup_key === `action_failed:${f.sendId}`)
      );
      expect(notices).toHaveLength(ROUNDS * 3);
      for (const [, count] of countBy(notices)) expect(count).toBe(1);
      expect(ended).toHaveLength(ROUNDS);
    });

    test("the card edit of a closed loop: two runs at once give one approval_edit per sent card", async () => {
      const s = await world();
      const sends = await followUps(s, ROUNDS);
      await detect(a);
      await appDb
        .updateTable("outbox")
        .set((eb) => ({ status: "sent", text: eb.ref("dedup_key"), external_message_id: 9, sent_at: new Date() }))
        .where("org_id", "=", s.org.orgId)
        .where("kind", "=", "approval")
        .execute();
      await appDb
        .updateTable("actions")
        .set({ status: "expired", status_reason: "loop_closed" })
        .where("org_id", "=", s.org.orgId)
        .where("type", "=", "send")
        .execute();
      await Promise.all([withTimeout(detect(a)), withTimeout(detect(b))]);
      const edits = await outboxOf(s.org.orgId, "approval_edit");
      expect(edits).toHaveLength(ROUNDS * 2);
      for (const [, count] of countBy(edits)) expect(count).toBe(1);
      expect(sends).toHaveLength(ROUNDS);
    });
  });

  describe(`as the ${role} role: one decision per send`, () => {
    test("two approvals at once: exactly one approves, one audit row", async () => {
      const s = await world();
      const sends = await followUps(s, ROUNDS, { notifiedAt: new Date() });
      const input = { userId: s.org.ownerId, via: "web" as const, now: new Date() };
      for (const f of sends) {
        const results = await Promise.all([
          withTimeout(approve(approvalDeps(a), s.ctx, f.sendId, input)),
          withTimeout(approve(approvalDeps(b), s.ctx, f.sendId, input)),
        ]);
        expect(results.filter((r) => r.kind === "approved")).toHaveLength(1);
        expect(results.filter((r) => r.kind === "already_approved" || r.kind === "sending")).toHaveLength(1);
        const audit = await kit.auditOf(f.sendId);
        expect(audit.filter((row) => row.event === "action.approved")).toHaveLength(1);
      }
    });

    test("approve against reject: exactly one decision wins, never both", async () => {
      const s = await world();
      const sends = await followUps(s, ROUNDS, { notifiedAt: new Date() });
      const input = { userId: s.org.ownerId, via: "web" as const, now: new Date() };
      for (const f of sends) {
        const [approved, rejected] = await Promise.all([
          withTimeout(approve(approvalDeps(a), s.ctx, f.sendId, input)),
          withTimeout(reject(approvalDeps(b), s.ctx, f.sendId, input)),
        ]);
        const decided = (approved.kind === "approved" ? 1 : 0) + (rejected.kind === "rejected" ? 1 : 0);
        // A reject of an `approved` send that no run holds also wins (the owner changed his mind): then the approve is not final.
        const status = (await kit.send(f.sendId)).status;
        expect(["approved", "rejected"]).toContain(status);
        expect(decided).toBeGreaterThanOrEqual(1);
        const audit = (await kit.auditOf(f.sendId)).map((row) => row.event);
        if (status === "rejected") expect(audit.filter((event) => event === "action.rejected")).toHaveLength(1);
        else expect(audit).not.toContain("action.rejected");
      }
    });

    test("approve against the expiry: exactly one outcome, one audit row", async () => {
      const s = await world();
      const sends = await followUps(s, ROUNDS, { notifiedAt: new Date() });
      const input = { userId: s.org.ownerId, via: "web" as const, now: new Date() };
      for (const f of sends) {
        const [approved, closed] = await Promise.all([
          withTimeout(approve(approvalDeps(a), s.ctx, f.sendId, input)),
          withTimeout(
            b.transaction().execute((trx) =>
              expireSend(trx, s.ctx, f.sendId, {
                reason: "timeout",
                now: new Date(),
                actor: "system",
                hooks: noDelegationHooks,
                uidplus: false,
              })
            )
          ),
        ]);
        const status = (await kit.send(f.sendId)).status;
        const audit = (await kit.auditOf(f.sendId)).map((row) => row.event);
        if (status === "approved") {
          expect(approved.kind).toBe("approved");
          expect(closed).toBe(false);
          expect(audit).not.toContain("action.expired");
        } else {
          expect(status).toBe("expired");
          expect(closed).toBe(true);
          expect(approved.kind).toBe("expired");
          expect(audit.filter((event) => event === "action.expired")).toHaveLength(1);
          expect(audit).not.toContain("action.approved");
        }
      }
    });
  });

  describe(`as the ${role} role: one new version per edit`, () => {
    test("two edits of the same send at once: one version, the other sees `changed`; one new pair", async () => {
      const s = await world();
      const sends = await followUps(s, ROUNDS);
      for (const [index, f] of sends.entries()) {
        const edit = (conn: Db, body: string) =>
          withTimeout(
            editApproval(approvalDeps(conn), s.ctx, f.sendId, {
              userId: s.org.ownerId,
              via: "web",
              now: new Date(),
              subject: `S${index}`,
              body,
            })
          );
        const [x, y] = await Promise.all([edit(a, "First text"), edit(b, "Second text")]);
        const kinds = [x.kind, y.kind].sort();
        expect(kinds).toEqual(["changed", "edited"]);
        const pairs = await appDb
          .selectFrom("actions")
          .select(["type", "status"])
          .where("supersedes_action_id", "=", f.sendId)
          .execute();
        expect(pairs).toEqual([{ type: "send", status: "awaiting_approval" }]);
      }
    });

    test("an edit against an approval: either the edit wins and the approval sees `superseded`, or the approval wins and the edit sees `closed`", async () => {
      const s = await world();
      const sends = await followUps(s, ROUNDS, { notifiedAt: new Date() });
      for (const f of sends) {
        const [edited, approved] = await Promise.all([
          withTimeout(
            editApproval(approvalDeps(a), s.ctx, f.sendId, {
              userId: s.org.ownerId,
              via: "web",
              now: new Date(),
              subject: "S",
              body: "New text",
            })
          ),
          withTimeout(
            approve(approvalDeps(b), s.ctx, f.sendId, { userId: s.org.ownerId, via: "web", now: new Date() })
          ),
        ]);
        const newer = await appDb
          .selectFrom("actions")
          .select("id")
          .where("supersedes_action_id", "=", f.sendId)
          .execute();
        if (edited.kind === "edited") {
          expect(approved.kind).toBe("superseded");
          expect(newer).toHaveLength(1);
          expect((await kit.send(f.sendId)).status).toBe("expired");
        } else {
          expect(edited).toEqual({ kind: "closed", state: "approved" });
          expect(approved.kind).toBe("approved");
          expect(newer).toEqual([]);
        }
      }
    });

    test("an edit against the closing of its loop: no deadlock (the loop lock comes first), no send is left half done", async () => {
      const s = await world();
      const sends = await followUps(s, ROUNDS);
      for (const f of sends) {
        const close = b.transaction().execute(async (trx) => {
          // The order of the close rules: the loop first, then its sends.
          await lockLoop(trx, s.ctx, f.loopId);
          await closeLoop(trx, s.ctx, { loopId: f.loopId, reason: "replied", at: new Date() });
          return expireSend(trx, s.ctx, f.sendId, {
            reason: "loop_closed",
            now: new Date(),
            actor: "system",
            hooks: noDelegationHooks,
            uidplus: false,
          });
        });
        const [edited] = await Promise.all([
          withTimeout(
            editApproval(approvalDeps(a), s.ctx, f.sendId, {
              userId: s.org.ownerId,
              via: "web",
              now: new Date(),
              subject: "S",
              body: "Edited",
            })
          ),
          withTimeout(close),
        ]);
        expect(["edited", "closed", "changed"]).toContain(edited.kind);
        const loop = await appDb
          .selectFrom("open_loops")
          .select("status")
          .where("id", "=", f.loopId)
          .executeTakeFirstOrThrow();
        expect(loop.status).toBe("closed");
        const old = await kit.send(f.sendId);
        expect(old.status).toBe("expired");
        // An edit that won the lock left a new awaiting version: it is the loop that now refuses it at the next tap or send.
        // The close ends the send in its own transaction, so a late edit names the state of the send.
        if (edited.kind === "closed") expect(["expired", "loop_closed"]).toContain(edited.state);
      }
    });
  });
}
