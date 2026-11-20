import { randomBytes, randomUUID } from "node:crypto";

import { MINUTE_MS, DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import {
  createCommitterJob,
  editApproval,
  noApprovalHooks,
  reject,
  type ApprovalDeps,
} from "../../src/modules/actions";
import { insertDefaultSettings, updateMailboxSettings } from "../../src/modules/config";
import { countDelegationsOfEmail, delegationHooks, findOpenDelegationOfEmail } from "../../src/modules/delegation";
import { delegateMail, delegateTaskText, type DelegateMailDeps } from "../../src/modules/loops";
import { composeMessage } from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { createFakeMailSender } from "../../src/modules/mail/fake/sender";
import { insertCredentials } from "../../src/modules/mail/repo";
import { configureFeatures, setOrgFeature } from "../../src/modules/tenancy";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, TenantContext } from "../../src/platform/db";
import { captureLogs, logProblems } from "../log-capture";

import {
  addMember,
  createOrgWithMailbox,
  insertAction,
  insertDelegate,
  insertDelegation,
  insertTriaged,
  pauseOtherMailboxes,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The Delegate command. Every test runs in a transaction that is rolled back.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-20T10:00:00Z");
const SWITCHES = { move: true, mark_read: true, flag: true, create_draft: true, move_unsure: false };
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

interface Setup {
  ctx: TenantContext;
  userId: string;
  mailboxId: string;
  delegateId: string;
  delegateAddress: string;
  emailId: string;
}

// An owner, an `assist` mailbox, an active delegate and a triaged `info` mail; the flag is on.
async function setup(
  trx: Transaction<DB>,
  opts: { category?: "info" | "spam" | "needs_reply"; mode?: "assist" | "shadow"; from?: string } = {}
): Promise<Setup> {
  await configureFeatures({ off: [] });
  const box = await createOrgWithMailbox(trx);
  const ctx = { orgId: box.orgId };
  await setOrgFeature(trx, ctx, { flag: "delegate_button", enabled: true, actor: "cli", now: NOW });
  await insertDefaultSettings(trx, ctx, box.mailboxId);
  await updateMailboxSettings(trx, ctx, box.mailboxId, { mode: opts.mode ?? "assist", toolSwitches: SWITCHES });
  const delegateAddress = `delegate-${randomUUID()}@x.test`;
  const delegateId = await insertDelegate(trx, ctx, { name: "Anna", email: delegateAddress });
  const emailId = await insertTriaged(trx, ctx, box.mailboxId, {
    category: opts.category ?? "info",
    createdAt: NOW,
    subject: "Offer for the autumn campaign",
    from: opts.from ?? `sender-${randomUUID()}@y.test`,
    fields: { language: "en" },
  });
  return { ctx, userId: box.userId, mailboxId: box.mailboxId, delegateId, delegateAddress, emailId };
}

const depsOf = (trx: Transaction<DB>, now: Date = NOW): DelegateMailDeps => ({ db: trx, now: () => now });

const pick = (s: Setup, over: Partial<Parameters<typeof delegateMail>[2]> = {}) => ({
  emailId: s.emailId,
  delegateId: s.delegateId,
  userId: s.userId,
  via: "web" as const,
  ...over,
});

const actionsOf = (trx: Transaction<DB>, s: Setup) =>
  trx.selectFrom("actions").selectAll().where("org_id", "=", s.ctx.orgId).where("email_id", "=", s.emailId).execute();

const delegationsOf = (trx: Transaction<DB>, s: Setup) =>
  trx.selectFrom("delegations").selectAll().where("org_id", "=", s.ctx.orgId).execute();

const approvalsOf = (trx: Transaction<DB>): ApprovalDeps => ({
  db: trx,
  hooks: delegationHooks({ db }),
  approvalHooks: noApprovalHooks,
  uidplus: async () => true,
});

describe("T1 the pick makes a pair and a delegation", () => {
  test("an info mail, an active delegate, assist: a ready draft, a send that waits, a drafted delegation", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const result = await delegateMail(depsOf(trx), s.ctx, pick(s));
      expect(result.kind).toBe("planned");
      if (result.kind !== "planned") return;

      const rows = await actionsOf(trx, s);
      const draft = rows.find((row) => row.type === "create_draft");
      const send = rows.find((row) => row.type === "send");
      expect(draft).toMatchObject({
        status: "ready",
        idempotency_key: `${s.emailId}:create_draft:delegation:button:1`,
      });
      // A mail to a person needs a tap (ADR 0003): the send is never ready or approved here.
      expect(send).toMatchObject({
        id: result.sendId,
        status: "awaiting_approval",
        depends_on_action_id: draft?.id,
        approved_at: null,
        idempotency_key: `${s.emailId}:send:delegation:button:1`,
      });
      // The recipient is the address of the delegates row.
      expect(send?.payload).toMatchObject({
        kind: "delegation",
        to: [s.delegateAddress],
        delegation_id: result.delegationId,
      });
      expect(draft?.payload).toMatchObject({
        kind: "delegation",
        to: [s.delegateAddress],
        delegate_id: s.delegateId,
        delegation_id: result.delegationId,
        due_date: "",
        language: "en",
        task: "Offer for the autumn campaign",
      });

      const [delegation] = await delegationsOf(trx, s);
      expect(delegation).toMatchObject({
        id: result.delegationId,
        status: "drafted",
        source: "button",
        email_id: s.emailId,
        delegate_id: s.delegateId,
        draft_action_id: draft?.id,
        send_action_id: send?.id,
        due_at: null,
        task_summary: "Offer for the autumn campaign",
      });

      // The audit row names the source and the way, never the task or an address.
      const audit = await trx
        .selectFrom("audit_log")
        .selectAll()
        .where("org_id", "=", s.ctx.orgId)
        .where("event", "=", "delegation.created")
        .execute();
      expect(audit).toHaveLength(1);
      expect(audit[0]?.actor).toBe(s.userId);
      expect(audit[0]?.data).toEqual({
        delegation_id: result.delegationId,
        delegate_id: s.delegateId,
        send_action_id: send?.id,
        due: false,
        source: "button",
        via: "web",
      });
      expect(JSON.stringify(audit)).not.toContain(s.delegateAddress);
      expect(JSON.stringify(audit)).not.toContain("autumn campaign");
    });
  });

  test("the stored triage summary is the task; mail text that holds an address or a link is marked", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await insertAction(trx, s.ctx, s.emailId, {
        type: "save_summary",
        status: "applied",
        payload: { summary: "Send the offer to boss@evil.test or see https://evil.test/x\nnow" },
      });
      const result = await delegateMail(depsOf(trx), s.ctx, pick(s));
      expect(result.kind).toBe("planned");
      const [delegation] = await delegationsOf(trx, s);
      expect(delegation?.task_summary).toBe("Send the offer to [address] or see [link] now");
      const draft = (await actionsOf(trx, s)).find((row) => row.type === "create_draft");
      expect(JSON.stringify(draft?.payload)).not.toContain("evil.test");
    });
  });

  test("a mail with no subject and no summary gets the no-subject word; a long subject is cut to the task length", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await trx.updateTable("emails").set({ subject: null }).where("id", "=", s.emailId).execute();
      expect((await delegateMail(depsOf(trx), s.ctx, pick(s))).kind).toBe("planned");
      expect((await delegationsOf(trx, s))[0]?.task_summary).toBe("(no subject)");

      const t = await setup(trx);
      await trx
        .updateTable("emails")
        .set({ subject: "x".repeat(500) })
        .where("id", "=", t.emailId)
        .execute();
      expect((await delegateMail(depsOf(trx), t.ctx, pick(t))).kind).toBe("planned");
      expect((await delegationsOf(trx, t))[0]?.task_summary).toHaveLength(300);
    });
  });
});

describe("T2 the same tap again", () => {
  test("exists with the id of the open delegation; no second pair", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const first = await delegateMail(depsOf(trx), s.ctx, pick(s));
      if (first.kind !== "planned") throw new Error("not planned");
      expect(await delegateMail(depsOf(trx), s.ctx, pick(s))).toEqual({
        kind: "exists",
        delegationId: first.delegationId,
      });
      const other = await insertDelegate(trx, s.ctx, { name: "Piotr" });
      expect(await delegateMail(depsOf(trx), s.ctx, pick(s, { delegateId: other }))).toEqual({
        kind: "exists",
        delegationId: first.delegationId,
      });
      expect(await actionsOf(trx, s)).toHaveLength(2);
      expect(await delegationsOf(trx, s)).toHaveLength(1);
    });
  });

  test("two taps at once make one pair (the unique key); the loser answers exists", async () => {
    // Two real transactions: the second waits on the key of the first and finds the open delegation after its commit.
    const s = await db.transaction().execute((trx) => setup(trx));
    try {
      const results = await Promise.all([
        delegateMail({ db, now: () => NOW }, s.ctx, pick(s)),
        delegateMail({ db, now: () => NOW }, s.ctx, pick(s, { via: "telegram" })),
      ]);
      expect(results.map((r) => r.kind).sort()).toEqual(["exists", "planned"]);
      const rows = await db.selectFrom("delegations").selectAll().where("org_id", "=", s.ctx.orgId).execute();
      expect(rows).toHaveLength(1);
      const sends = await db
        .selectFrom("actions")
        .select("id")
        .where("org_id", "=", s.ctx.orgId)
        .where("type", "=", "send")
        .execute();
      expect(sends).toHaveLength(1);
    } finally {
      await db.deleteFrom("organizations").where("id", "=", s.ctx.orgId).execute();
    }
  });
});

describe("T3 a mail that is not delegable", () => {
  test("a spam mail; a mail with a suspicious reason; a mail that triage did not see", async () => {
    await withRollback(db, async (trx) => {
      const spam = await setup(trx, { category: "spam" });
      expect(await delegateMail(depsOf(trx), spam.ctx, pick(spam))).toEqual({ kind: "not_delegable" });
      expect(await actionsOf(trx, spam)).toEqual([]);
      expect(await delegationsOf(trx, spam)).toEqual([]);

      const s = await setup(trx);
      const suspicious = await insertTriaged(trx, s.ctx, s.mailboxId, {
        category: "needs_reply",
        createdAt: NOW,
        subject: "Pay now",
        suspiciousReasons: ["lookalike_domain"],
      });
      expect(await delegateMail(depsOf(trx), s.ctx, pick(s, { emailId: suspicious }))).toEqual({
        kind: "not_delegable",
      });
      // A clean newer result clears it: the newest result decides (the rule of `suspiciousReasonsOf`).
      await trx
        .insertInto("triage_results")
        .values({
          org_id: s.ctx.orgId,
          email_id: suspicious,
          category: "needs_reply",
          confidence: 0.9,
          reason_code: "direct_request",
          fields: JSON.stringify({}),
          suspicious_reasons: [],
          created_at: new Date(NOW.getTime() + 1000),
        })
        .execute();
      expect((await delegateMail(depsOf(trx), s.ctx, pick(s, { emailId: suspicious }))).kind).toBe("planned");

      const untriaged = await trx
        .insertInto("emails")
        .values({
          org_id: s.ctx.orgId,
          mailbox_id: s.mailboxId,
          dedup_key: `test:${randomUUID()}`,
          thread_key: `test:${randomUUID()}`,
          content_hash: "h",
          uid: 2,
          received_at: NOW,
          status: "pending",
          subject: "Not triaged yet",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      expect(await delegateMail(depsOf(trx), s.ctx, pick(s, { emailId: untriaged.id }))).toEqual({
        kind: "not_delegable",
      });
    });
  });

  test("a sender that is an own mailbox, in any case, of this organization", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const own = await trx
        .selectFrom("mailboxes")
        .select("address")
        .where("id", "=", s.mailboxId)
        .executeTakeFirstOrThrow();
      await trx
        .updateTable("emails")
        .set({ from_address: own.address.toUpperCase() })
        .where("id", "=", s.emailId)
        .execute();
      expect(await delegateMail(depsOf(trx), s.ctx, pick(s))).toEqual({ kind: "not_delegable" });
      expect(await delegationsOf(trx, s)).toEqual([]);
    });
  });

  test("04-T6: a sender that is an own mailbox by the one rule (İlker@Example.com, ilker@example.com)", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await trx.updateTable("mailboxes").set({ address: "İlker@Example.com" }).where("id", "=", s.mailboxId).execute();
      await trx.updateTable("emails").set({ from_address: "ilker@example.com" }).where("id", "=", s.emailId).execute();
      expect(await delegateMail(depsOf(trx), s.ctx, pick(s))).toEqual({ kind: "not_delegable" });
      expect(await delegationsOf(trx, s)).toEqual([]);
    });
  });

  test("a mail of the system itself (its Message-ID names an action of the mailbox)", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const own = await insertAction(trx, s.ctx, s.emailId, { type: "create_draft", status: "applied" });
      await trx
        .updateTable("emails")
        .set({ message_id_header: `<ea-${own}@x.test>` })
        .where("id", "=", s.emailId)
        .execute();
      expect(await delegateMail(depsOf(trx), s.ctx, pick(s))).toEqual({ kind: "not_delegable" });

      // Any sender can write such an id: one that names no action of this mailbox does not count.
      const t = await setup(trx);
      await trx
        .updateTable("emails")
        .set({ message_id_header: `<ea-${randomUUID()}@x.test>` })
        .where("id", "=", t.emailId)
        .execute();
      expect((await delegateMail(depsOf(trx), t.ctx, pick(t))).kind).toBe("planned");
    });
  });
});

describe("T4 drafts are off", () => {
  test("shadow mode, or the switch create_draft off: drafts_off and no row", async () => {
    await withRollback(db, async (trx) => {
      const shadow = await setup(trx, { mode: "shadow" });
      expect(await delegateMail(depsOf(trx), shadow.ctx, pick(shadow))).toEqual({ kind: "drafts_off" });
      expect(await actionsOf(trx, shadow)).toEqual([]);
      expect(await delegationsOf(trx, shadow)).toEqual([]);

      const s = await setup(trx);
      await updateMailboxSettings(trx, s.ctx, s.mailboxId, { toolSwitches: { ...SWITCHES, create_draft: false } });
      expect(await delegateMail(depsOf(trx), s.ctx, pick(s))).toEqual({ kind: "drafts_off" });
      expect(await actionsOf(trx, s)).toEqual([]);
      expect(await delegationsOf(trx, s)).toEqual([]);
    });
  });

  test("a mailbox with no settings row has no drafts", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await trx.deleteFrom("mailbox_settings").where("mailbox_id", "=", s.mailboxId).execute();
      expect(await delegateMail(depsOf(trx), s.ctx, pick(s))).toEqual({ kind: "drafts_off" });
    });
  });
});

describe("T5 and T6 the delegate", () => {
  test("a disabled delegate: delegate_inactive and no row", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await trx.updateTable("delegates").set({ active: false }).where("id", "=", s.delegateId).execute();
      expect(await delegateMail(depsOf(trx), s.ctx, pick(s))).toEqual({ kind: "delegate_inactive" });
      expect(await actionsOf(trx, s)).toEqual([]);
      expect(await delegationsOf(trx, s)).toEqual([]);
    });
  });

  test("a delegate of organization B, and an unknown id: not_found; the mail of organization B: not_found", async () => {
    await withRollback(db, async (trx) => {
      const a = await setup(trx);
      const b = await setup(trx);
      expect(await delegateMail(depsOf(trx), a.ctx, pick(a, { delegateId: b.delegateId }))).toEqual({
        kind: "not_found",
      });
      expect(await delegateMail(depsOf(trx), a.ctx, pick(a, { delegateId: randomUUID() }))).toEqual({
        kind: "not_found",
      });
      expect(await delegateMail(depsOf(trx), a.ctx, pick(a, { emailId: b.emailId }))).toEqual({ kind: "not_found" });
      expect(await delegateMail(depsOf(trx), a.ctx, pick(a, { emailId: randomUUID() }))).toEqual({
        kind: "not_found",
      });
      expect(await actionsOf(trx, a)).toEqual([]);
      expect(await actionsOf(trx, b)).toEqual([]);
      expect(await delegationsOf(trx, a)).toEqual([]);
      expect(await delegationsOf(trx, b)).toEqual([]);
    });
  });

  test("a delegation of organization B on its own mail does not block organization A's mail", async () => {
    await withRollback(db, async (trx) => {
      const a = await setup(trx);
      const b = await setup(trx);
      const draft = await insertAction(trx, b.ctx, b.emailId, { type: "create_draft", status: "applied" });
      const send = await insertAction(trx, b.ctx, b.emailId, {
        type: "send",
        status: "awaiting_approval",
        dependsOnActionId: draft,
      });
      await insertDelegation(trx, b.ctx, {
        mailboxId: b.mailboxId,
        emailId: b.emailId,
        delegateId: b.delegateId,
        draftActionId: draft,
        sendActionId: send,
      });
      expect((await delegateMail(depsOf(trx), a.ctx, pick(a))).kind).toBe("planned");
    });
  });
});

describe("T7 a mail that triage already delegated", () => {
  test("a delegation in drafted, sent or overdue: exists with its id; answered, done and cancelled do not block", async () => {
    await withRollback(db, async (trx) => {
      for (const status of ["drafted", "sent", "overdue"]) {
        const s = await setup(trx);
        const draft = await insertAction(trx, s.ctx, s.emailId, { type: "create_draft", status: "applied" });
        const send = await insertAction(trx, s.ctx, s.emailId, {
          type: "send",
          status: status === "drafted" ? "awaiting_approval" : "applied",
          approvedAt: status === "drafted" ? null : NOW,
          appliedAt: status === "drafted" ? null : NOW,
          dependsOnActionId: draft,
        });
        const id = await insertDelegation(trx, s.ctx, {
          mailboxId: s.mailboxId,
          emailId: s.emailId,
          delegateId: s.delegateId,
          draftActionId: draft,
          sendActionId: send,
          status,
        });
        expect(await delegateMail(depsOf(trx), s.ctx, pick(s))).toEqual({ kind: "exists", delegationId: id });
        expect(await actionsOf(trx, s)).toHaveLength(2);
      }
      for (const status of ["answered", "done", "cancelled"]) {
        const s = await setup(trx);
        const draft = await insertAction(trx, s.ctx, s.emailId, { type: "create_draft", status: "applied" });
        const send = await insertAction(trx, s.ctx, s.emailId, {
          type: "send",
          status: status === "cancelled" ? "rejected" : "applied",
          approvedAt: status === "cancelled" ? null : NOW,
          appliedAt: status === "cancelled" ? null : NOW,
          dependsOnActionId: draft,
        });
        await insertDelegation(trx, s.ctx, {
          mailboxId: s.mailboxId,
          emailId: s.emailId,
          delegateId: s.delegateId,
          draftActionId: draft,
          sendActionId: send,
          status,
        });
        expect((await delegateMail(depsOf(trx), s.ctx, pick(s))).kind).toBe("planned");
      }
    });
  });
});

// A committer on the fake provider and sender. The Drafts and Sent folders exist; the mailbox has credentials.
async function committerFor(trx: Transaction<DB>, s: Setup, clock: { now: Date }) {
  const folderMap = { drafts: "Drafts", sent: "Sent" };
  await trx
    .updateTable("mailboxes")
    .set({ folder_map: JSON.stringify(folderMap) })
    .where("id", "=", s.mailboxId)
    .execute();
  const secret = secrets.encrypt("pw", `mailbox:${s.mailboxId}`);
  await insertCredentials(trx, s.ctx, {
    mailboxId: s.mailboxId,
    encryptedSecret: secret.ciphertext,
    secretKind: "password",
    keyVersion: secret.keyVersion,
  });
  const fake = createFakeMailProvider();
  await fake.ensureFolder("Drafts");
  await fake.ensureFolder("Sent");
  const sender = createFakeMailSender();
  const committer = createCommitterJob({
    db: trx,
    secrets,
    openProvider: async () => fake,
    openSender: async () => {
      sender.closed = false;
      return sender;
    },
    compose: composeMessage,
    scope: { kind: "all" },
    sendScope: { kind: "all" },
    hooks: delegationHooks({ db }),
    now: () => clock.now,
  });
  return { committer, sender };
}

describe("T8 the send is applied", () => {
  test("a tap and the committer: the delegation is sent with a due date 3 days later", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const s = await setup(trx);
      const clock = { now: NOW };
      const { committer, sender } = await committerFor(trx, s, clock);

      const result = await delegateMail(depsOf(trx), s.ctx, pick(s));
      if (result.kind !== "planned") throw new Error("not planned");
      // The draft copy is made; nothing goes out before the tap.
      await committer.run();
      expect(sender.sent).toHaveLength(0);
      expect((await delegationsOf(trx, s))[0]?.status).toBe("drafted");

      await trx
        .updateTable("actions")
        .set({ status: "approved", approved_at: NOW, approved_by: s.userId, approved_via: "web" })
        .where("id", "=", result.sendId)
        .execute();
      clock.now = new Date(NOW.getTime() + MINUTE_MS);
      await committer.run();

      expect(sender.sent).toHaveLength(1);
      expect(sender.sent[0]?.envelope.to).toEqual([s.delegateAddress]);
      const [delegation] = await delegationsOf(trx, s);
      expect(delegation?.status).toBe("sent");
      expect(delegation?.sent_at?.getTime()).toBe(clock.now.getTime());
      expect(delegation?.due_at?.getTime()).toBe(clock.now.getTime() + 3 * DAY_MS);
    });
  });
});

describe("T9 a rejected button delegation, then a new pick", () => {
  test("a new pair and a new delegation with the attempt number 2; a third pick after the second reject: 3", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const first = await delegateMail(depsOf(trx), s.ctx, pick(s));
      if (first.kind !== "planned") throw new Error("not planned");
      const rejected = await reject(approvalsOf(trx), s.ctx, first.sendId, {
        userId: s.userId,
        via: "web",
        now: NOW,
      });
      expect(rejected.kind).toBe("rejected");
      expect((await delegationsOf(trx, s))[0]?.status).toBe("cancelled");

      const second = await delegateMail(depsOf(trx), s.ctx, pick(s));
      expect(second.kind).toBe("planned");
      if (second.kind !== "planned") return;
      expect(second.delegationId).not.toBe(first.delegationId);
      expect(second.sendId).not.toBe(first.sendId);
      const keys = (await actionsOf(trx, s)).map((row) => row.idempotency_key).sort();
      expect(keys).toEqual(
        [
          `${s.emailId}:create_draft:delegation:button:1`,
          `${s.emailId}:create_draft:delegation:button:2`,
          `${s.emailId}:send:delegation:button:1`,
          `${s.emailId}:send:delegation:button:2`,
        ].sort()
      );
      expect((await delegationsOf(trx, s)).filter((row) => row.status === "drafted")).toHaveLength(1);

      await reject(approvalsOf(trx), s.ctx, second.sendId, { userId: s.userId, via: "web", now: NOW });
      const third = await delegateMail(depsOf(trx), s.ctx, pick(s));
      expect(third.kind).toBe("planned");
      expect((await actionsOf(trx, s)).map((row) => row.idempotency_key)).toContain(
        `${s.emailId}:send:delegation:button:3`
      );
    });
  });

  test("a delegation that was answered leaves its keys: the next pick still makes a new pair", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const first = await delegateMail(depsOf(trx), s.ctx, pick(s));
      if (first.kind !== "planned") throw new Error("not planned");
      await trx
        .updateTable("delegations")
        .set({ status: "cancelled", status_reason: "outcome_unknown" })
        .where("id", "=", first.delegationId)
        .execute();
      const second = await delegateMail(depsOf(trx), s.ctx, pick(s));
      expect(second.kind).toBe("planned");
      expect((await delegationsOf(trx, s)).filter((row) => row.source === "button")).toHaveLength(2);
    });
  });
});

describe("the first checks", () => {
  test("the flag off: feature_off before any other check, and nothing is written", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await setOrgFeature(trx, s.ctx, { flag: "delegate_button", enabled: false, actor: "cli", now: NOW });
      expect(await delegateMail(depsOf(trx), s.ctx, pick(s))).toEqual({ kind: "feature_off" });
      // Even a mail of nobody: the flag answers first.
      expect(await delegateMail(depsOf(trx), s.ctx, pick(s, { emailId: randomUUID() }))).toEqual({
        kind: "feature_off",
      });
      expect(await actionsOf(trx, s)).toEqual([]);
    });
  });

  test("a member, a user of another organization and an unknown user are not_allowed; no row", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const member = await addMember(trx, s.ctx.orgId, "assistant");
      expect(await delegateMail(depsOf(trx), s.ctx, pick(s, { userId: member }))).toEqual({ kind: "not_allowed" });
      const other = await setup(trx);
      expect(await delegateMail(depsOf(trx), s.ctx, pick(s, { userId: other.userId }))).toEqual({
        kind: "not_allowed",
      });
      expect(await delegateMail(depsOf(trx), s.ctx, pick(s, { userId: randomUUID() }))).toEqual({
        kind: "not_allowed",
      });
      expect(await actionsOf(trx, s)).toEqual([]);
      expect(await delegationsOf(trx, s)).toEqual([]);
    });
  });

  test("the mail of an unknown id is not_found before the owner check", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const member = await addMember(trx, s.ctx.orgId, "assistant");
      expect(await delegateMail(depsOf(trx), s.ctx, pick(s, { emailId: randomUUID(), userId: member }))).toEqual({
        kind: "not_found",
      });
    });
  });
});

describe("the edit follows the existing path (F102)", () => {
  test("the panel changes the delegate of the new send: the delegation and the recipient follow; still a tap", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const s = await setup(trx);
      const clock = { now: NOW };
      const { committer, sender } = await committerFor(trx, s, clock);
      const piotrAddress = `piotr-${randomUUID()}@x.test`;
      const piotr = await insertDelegate(trx, s.ctx, { name: "Piotr", email: piotrAddress });
      const first = await delegateMail(depsOf(trx), s.ctx, pick(s));
      if (first.kind !== "planned") throw new Error("not planned");
      await committer.run();

      const edited = await editApproval(approvalsOf(trx), s.ctx, first.sendId, {
        userId: s.userId,
        via: "web",
        now: NOW,
        subject: "Offer",
        body: "Please take this.",
        delegateId: piotr,
      });
      expect(edited.kind).toBe("edited");
      const open = await trx
        .selectFrom("actions")
        .select(["id", "status", "payload"])
        .where("org_id", "=", s.ctx.orgId)
        .where("type", "=", "send")
        .where("status", "=", "awaiting_approval")
        .execute();
      expect(open).toHaveLength(1);
      expect(open[0]?.payload).toMatchObject({ to: [piotrAddress], delegate_id: piotr });
      expect(sender.sent).toHaveLength(0);
      const [delegation] = await delegationsOf(trx, s);
      expect(delegation).toMatchObject({ status: "drafted", delegate_id: piotr, source: "button" });
    });
  });
});

describe("the settings lock (a setter at the same time)", () => {
  test("a setter that turned drafts off and has not committed: the pick waits, then answers drafts_off", async () => {
    const s = await db.transaction().execute((trx) => setup(trx));
    const poller = testDb();
    try {
      let result: Awaited<ReturnType<typeof delegateMail>> | undefined;
      let delegating: Promise<void> | undefined;
      let waiting = 0;
      await db.transaction().execute(async (setter) => {
        await updateMailboxSettings(setter, s.ctx, s.mailboxId, { toolSwitches: { ...SWITCHES, create_draft: false } });
        // The pick runs on its own connection: it must wait for the setter's lock on the settings row.
        delegating = delegateMail({ db, now: () => NOW }, s.ctx, pick(s)).then((value) => {
          result = value;
        });
        const deadline = Date.now() + 5000;
        while (waiting === 0 && result === undefined && Date.now() < deadline) {
          const found = await sql<{ n: string }>`
            select count(*)::text as n from pg_stat_activity
            where datname = current_database() and wait_event_type = 'Lock'`.execute(poller);
          waiting = Number(found.rows[0]?.n ?? "0");
          if (waiting === 0) await Bun.sleep(25);
        }
        // Still waiting while the setter holds its lock.
        expect(result).toBeUndefined();
      });
      await delegating;
      expect(waiting).toBeGreaterThan(0);
      expect(result).toEqual({ kind: "drafts_off" });
      const rows = await db.selectFrom("delegations").select("id").where("org_id", "=", s.ctx.orgId).execute();
      expect(rows).toEqual([]);
    } finally {
      await poller.destroy();
      await db.deleteFrom("organizations").where("id", "=", s.ctx.orgId).execute();
    }
  }, 30_000);
});

describe("organization filters of the new repository functions", () => {
  test("the open delegation and the attempt count of a mail are read only for the organization of the context", async () => {
    await withRollback(db, async (trx) => {
      const a = await setup(trx);
      const b = await setup(trx);
      const first = await delegateMail(depsOf(trx), a.ctx, pick(a));
      if (first.kind !== "planned") throw new Error("not planned");
      expect(await findOpenDelegationOfEmail(trx, a.ctx, a.emailId)).toBe(first.delegationId);
      expect(await countDelegationsOfEmail(trx, a.ctx, a.emailId, "button")).toBe(1);
      expect(await countDelegationsOfEmail(trx, a.ctx, a.emailId, "triage")).toBe(0);
      // Organization B names the mail of organization A: it sees nothing.
      expect(await findOpenDelegationOfEmail(trx, b.ctx, a.emailId)).toBeUndefined();
      expect(await countDelegationsOfEmail(trx, b.ctx, a.emailId, "button")).toBe(0);
    });
  });
});

describe("delegateTaskText", () => {
  test("the summary first, else the subject; marked, one line, cut to 300; the empty case reads the locale word", () => {
    expect(delegateTaskText("Summary", "Subject", "en")).toBe("Summary");
    expect(delegateTaskText(undefined, "Subject", "en")).toBe("Subject");
    expect(delegateTaskText("   ", "Subject", "en")).toBe("Subject");
    expect(delegateTaskText(null, "Write to a@b.example", "en")).toBe("Write to [address]");
    expect(delegateTaskText("line one\r\nline two", null, "en")).toBe("line one line two");
    expect(delegateTaskText(null, "x".repeat(400), "en")).toHaveLength(300);
    expect(delegateTaskText(null, null, "en")).toBe("(no subject)");
    expect(delegateTaskText(null, "", "pl")).toBe("(bez tematu)");
  });
});

describe("logs", () => {
  test("a pick writes no mail text, address or id of a delegate that a person could read into a log line", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await trx
        .updateTable("emails")
        .set({ subject: `MARKER-SUBJECT-${s.emailId}` })
        .where("id", "=", s.emailId)
        .execute();
      const capture = captureLogs();
      try {
        const first = await delegateMail(depsOf(trx), s.ctx, pick(s));
        const again = await delegateMail(depsOf(trx), s.ctx, pick(s));
        const refused = await delegateMail(depsOf(trx), s.ctx, pick(s, { userId: randomUUID() }));
        expect([first.kind, again.kind, refused.kind]).toEqual(["planned", "exists", "not_allowed"]);
        expect(logProblems(capture.lines, [`MARKER-SUBJECT-${s.emailId}`, s.delegateAddress])).toEqual([]);
      } finally {
        capture.stop();
      }
    });
  });
});
