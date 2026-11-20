import { randomBytes, randomUUID } from "node:crypto";

import { buildOutgoingMessage, draftPayloadSchema, textTables, MINUTE_MS, DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { settingsDeps } from "../../src/composition";
import {
  approve,
  createCommitterJob,
  editApproval,
  listExpiredApprovals,
  listRejectRows,
  listSendResultsToNotify,
  noApprovalHooks,
  noDelegationHooks,
  reject,
  setDelegationId,
  type ApprovalDeps,
  type DelegationHooks,
} from "../../src/modules/actions";
import { expireSend } from "../../src/modules/actions/expiry";
import { handleCallback, type CallbackDeps, type LinkedChat } from "../../src/modules/channels";
import { insertDefaultSettings, setMode, updateMailboxSettings } from "../../src/modules/config";
import { delegationHooks } from "../../src/modules/delegation";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { createFakeMailSender, type FakeMailSender } from "../../src/modules/mail/fake/sender";
import { insertCredentials } from "../../src/modules/mail/repo";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, Db, TenantContext } from "../../src/platform/db";
import { ValidationError } from "../../src/platform/http";

import {
  createOrgWithMailbox,
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

const NOW = new Date("2026-11-20T13:05:00Z");
const CREATED = new Date("2026-11-20T12:00:00Z");
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);
const SWITCHES = { move: true, mark_read: true, flag: true, create_draft: true, move_unsure: false };
const NEW_SUBJECT = "Budget 2027";
const NEW_BODY = "Hello Anna,\r\nplease send the report.\n\nAdam";
const NEW_BODY_CLEAN = "Hello Anna,\nplease send the report.\n\nAdam";

interface Seed {
  ctx: TenantContext;
  userId: string;
  mailboxId: string;
  anna: string;
  piotr: string;
  fake: FakeMailProvider;
  sender: FakeMailSender;
  runCommitter(): Promise<void>;
  p: { emailId: string; draftId: string; sendId: string };
  delegationId: string | null;
}

function depsOf(
  trx: Db | Transaction<DB>,
  over: { hooks?: DelegationHooks; uidplus?: () => Promise<boolean> } = {}
): ApprovalDeps {
  return {
    db: trx,
    hooks: over.hooks ?? delegationHooks({ db }),
    approvalHooks: noApprovalHooks,
    uidplus: over.uidplus ?? (async () => true),
  };
}

async function waitingMailbox(trx: Transaction<DB>, ctx: TenantContext, mailboxId: string): Promise<void> {
  await insertDefaultSettings(trx, ctx, mailboxId);
  await updateMailboxSettings(trx, ctx, mailboxId, { mode: "assist", toolSwitches: SWITCHES });
}

// A delegation mail whose first draft the committer put into the fake Drafts folder, and its waiting send.
async function seed(trx: Transaction<DB>, opts: { kind?: "delegation" | "clarification" | "reminder" } = {}) {
  await pauseOtherMailboxes(trx);
  const box = await createOrgWithMailbox(trx);
  const ctx = { orgId: box.orgId };
  await waitingMailbox(trx, ctx, box.mailboxId);
  const kind = opts.kind ?? "delegation";
  const anna = await insertDelegate(trx, ctx, { name: "Anna", email: "anna@example.com" });
  const piotr = await insertDelegate(trx, ctx, { name: "Piotr", email: "piotr@example.com" });
  const fake = createFakeMailProvider();
  const sender = createFakeMailSender();
  await fake.ensureFolder("Drafts");
  const secret = secrets.encrypt("pw", `mailbox:${box.mailboxId}`);
  await insertCredentials(trx, ctx, {
    mailboxId: box.mailboxId,
    encryptedSecret: secret.ciphertext,
    secretKind: "password",
    keyVersion: secret.keyVersion,
  });
  const job = createCommitterJob({
    db: trx,
    secrets,
    openProvider: async () => fake,
    openSender: async () => sender,
    scope: { kind: "all" },
    sendScope: { kind: "all" },
    now: () => NOW,
  });
  const p = await insertDraftAndSend(trx, ctx, box.mailboxId, {
    kind,
    draftStatus: "ready",
    delegateId: anna,
    delegateName: "Anna",
    to: kind === "clarification" ? "boss@x.test" : "anna@example.com",
    createdAt: CREATED,
    from: "boss@x.test",
    subject: "Offer",
    messageId: `<orig-${randomUUID()}@x.test>`,
    bodyText: "Please prepare the offer",
    ...(kind === "reminder" ? { reminder: 1 as const } : {}),
  });
  let delegationId: string | null = null;
  if (kind === "delegation") {
    delegationId = await insertDelegation(trx, ctx, {
      mailboxId: box.mailboxId,
      emailId: p.emailId,
      delegateId: anna,
      draftActionId: p.draftId,
      sendActionId: p.sendId,
    });
    await setDelegationId(trx, ctx, [p.draftId, p.sendId], delegationId);
  }
  await job.run();
  const seeded: Seed = {
    ctx,
    userId: box.userId,
    mailboxId: box.mailboxId,
    anna,
    piotr,
    fake,
    sender,
    runCommitter: () => job.run(),
    p,
    delegationId,
  };
  return seeded;
}

// The message of the first draft as the committer builds it: the same builder and inputs.
async function builtMessage(trx: Transaction<DB>, s: Seed) {
  const draft = await row(trx, s.p.draftId);
  const mailbox = await trx
    .selectFrom("mailboxes")
    .select("address")
    .where("id", "=", s.mailboxId)
    .executeTakeFirstOrThrow();
  const email = await trx.selectFrom("emails").selectAll().where("id", "=", s.p.emailId).executeTakeFirstOrThrow();
  return buildOutgoingMessage({
    draft: draftPayloadSchema.parse(draft.payload),
    draftActionId: draft.id,
    createdAt: draft.created_at,
    mailbox: { address: mailbox.address },
    owner: { displayName: "Owner" },
    organization: { timezone: "Europe/Warsaw" },
    original: {
      fromAddress: email.from_address,
      subject: email.subject,
      receivedAt: email.received_at,
      messageId: email.message_id_header,
      inReplyTo: email.in_reply_to,
      references: [],
      bodyText: email.body_text,
    },
  });
}

async function row(trx: Db | Transaction<DB>, id: string) {
  return trx.selectFrom("actions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

async function reverseRowsOf(trx: Db | Transaction<DB>, draftId: string) {
  return trx.selectFrom("actions").selectAll().where("reverses_action_id", "=", draftId).execute();
}

const approval = (userId: string) => ({ approved_by: userId, approved_at: NOW, approved_via: "web" });

function editInput(over: Partial<Parameters<typeof editApproval>[3]> = {}): Parameters<typeof editApproval>[3] {
  return { userId: randomUUID(), via: "web", now: NOW, subject: NEW_SUBJECT, body: NEW_BODY, ...over };
}

async function edit(trx: Transaction<DB>, s: Seed, sendId: string, over: Parameters<typeof editInput>[0] = {}) {
  return editApproval(depsOf(trx), s.ctx, sendId, editInput({ userId: s.userId, ...over }));
}

describe("editApproval: the new version", () => {
  test("T1 + T2: S1 ends superseded, S2 waits with the edited draft, one committer tick deletes the old Drafts copy", async () => {
    await withRollback(db, async (trx) => {
      const s = await seed(trx);
      const d1 = await row(trx, s.p.draftId);
      expect(d1.status).toBe("applied");
      const d1Uid = (d1.provider_result as { uid: number }).uid;
      expect(await s.fake.searchSinceIn("Drafts", new Date(0))).toEqual([d1Uid]);

      const result = await edit(trx, s, s.p.sendId);

      expect(result.kind).toBe("edited");
      if (result.kind !== "edited") throw new Error("not edited");
      expect(result.version).toBe(2);
      const s2 = await row(trx, result.sendId);
      expect(s2).toMatchObject({ status: "awaiting_approval", supersedes_action_id: s.p.sendId, type: "send" });
      expect(s2.idempotency_key).toBe(`${s.p.sendId}:edit`);
      expect(s2.payload).toMatchObject({ kind: "delegation", to: ["anna@example.com"], delegation_id: s.delegationId });
      const d2 = await row(trx, s2.depends_on_action_id as string);
      expect(d2).toMatchObject({ status: "ready", type: "create_draft", supersedes_action_id: s.p.draftId });
      expect(d2.idempotency_key).toBe(`${s.p.draftId}:edit`);
      expect(d2.payload).toMatchObject({
        version: 2,
        subject_text: NEW_SUBJECT,
        body_text: NEW_BODY_CLEAN,
        delegation_id: s.delegationId,
      });
      const s1 = await row(trx, s.p.sendId);
      expect(s1.status).toBe("expired");
      expect(s1.status_reason).toBe("superseded");
      expect(s1.result_notified_at?.getTime()).toBe(NOW.getTime());
      const delegation = await trx
        .selectFrom("delegations")
        .selectAll()
        .where("id", "=", s.delegationId as string)
        .executeTakeFirstOrThrow();
      expect(delegation).toMatchObject({
        status: "drafted",
        draft_action_id: d2.id,
        send_action_id: s2.id,
        delegate_id: s.anna,
      });
      const edited = await trx
        .selectFrom("audit_log")
        .selectAll()
        .where("org_id", "=", s.ctx.orgId)
        .where("event", "=", "action.edited")
        .execute();
      expect(edited).toHaveLength(1);
      expect(edited[0]).toMatchObject({ action_id: s2.id, actor: s.userId });
      expect(edited[0]?.data).toEqual({
        previous_action_id: s.p.sendId,
        version: 2,
        delegate_changed: false,
        via: "web",
      });
      expect(JSON.stringify(edited[0]?.data)).not.toContain("Budget");
      const reverses = await reverseRowsOf(trx, s.p.draftId);
      expect(reverses).toHaveLength(1);
      expect(reverses[0]?.payload).toMatchObject({ reason: "expired", uid: d1Uid });

      // The committer runs the reverse row; the fake provider deletes the copy of the first draft and gets the copy of the second.
      await s.runCommitter();
      expect((await row(trx, s.p.draftId)).status).toBe("undone");
      expect((await row(trx, reverses[0]?.id as string)).status).toBe("applied");
      const uids = await s.fake.searchSinceIn("Drafts", new Date(0));
      expect(uids).toHaveLength(1);
      expect(uids).not.toContain(d1Uid);
      expect((await row(trx, d2.id)).status).toBe("applied");
      // The new send still waits for a tap: nothing sent anything.
      expect((await row(trx, s2.id)).status).toBe("awaiting_approval");
    });
  });

  test("no send goes out with the old text: the old send ends once, only the approved new version is sent", async () => {
    await withRollback(db, async (trx) => {
      const s = await seed(trx);
      const result = await edit(trx, s, s.p.sendId);
      if (result.kind !== "edited") throw new Error("edit failed");
      const input = { userId: s.userId, via: "web" as const, now: NOW };

      // Nothing is approved: the committer sends nothing, neither the old nor the new version.
      await s.runCommitter();
      await s.runCommitter();
      expect(s.sender.sent).toEqual([]);
      // The old version cannot be approved; the new one waits for its draft and then goes out once.
      expect((await approve(depsOf(trx), s.ctx, s.p.sendId, input)).kind).toBe("superseded");
      expect(await approve(depsOf(trx), s.ctx, result.sendId, input)).toEqual({ kind: "approved" });
      await s.runCommitter();
      await s.runCommitter();

      expect(s.sender.sent).toHaveLength(1);
      const raw = s.sender.sent[0]?.raw.toString("utf8") ?? "";
      expect(raw).toContain(`Subject: ${NEW_SUBJECT}`);
      expect(raw).toContain("please send the report.");
      expect(raw).not.toContain("Fwd: Offer");
      expect(await row(trx, result.sendId)).toMatchObject({ status: "applied" });
      const old = await row(trx, s.p.sendId);
      expect(old).toMatchObject({
        status: "expired",
        status_reason: "superseded",
        attempts: 0,
        outgoing_message_id: null,
      });
      // The old send has exactly one closing audit row and no apply or approval row.
      const events = await trx
        .selectFrom("audit_log")
        .select("event")
        .where("org_id", "=", s.ctx.orgId)
        .where("action_id", "=", s.p.sendId)
        .execute();
      expect(events.map((e) => e.event)).toEqual(["action.expired"]);
    });
  });

  test("T3: a second edit of S1 answers changed; an edit of S2 with D2 ready makes S3 and closes D2 without a reverse row", async () => {
    await withRollback(db, async (trx) => {
      const s = await seed(trx);
      const first = await edit(trx, s, s.p.sendId);
      if (first.kind !== "edited") throw new Error("first edit failed");

      expect(await edit(trx, s, s.p.sendId, { subject: "Other" })).toEqual({
        kind: "changed",
        currentId: first.sendId,
      });

      const second = await edit(trx, s, first.sendId, { subject: "Budget 2028" });
      expect(second).toMatchObject({ kind: "edited", version: 3 });
      if (second.kind !== "edited") throw new Error("second edit failed");
      expect(await edit(trx, s, s.p.sendId)).toEqual({ kind: "changed", currentId: second.sendId });
      const s2 = await row(trx, first.sendId);
      expect(s2).toMatchObject({ status: "expired", status_reason: "superseded" });
      const d2 = await row(trx, s2.depends_on_action_id as string);
      expect(d2).toMatchObject({ status: "expired", status_reason: "send_closed" });
      expect(await reverseRowsOf(trx, d2.id)).toEqual([]);
    });
  });

  test("T4: approve and reject of S1 answer superseded with the newest id; S1 stays", async () => {
    await withRollback(db, async (trx) => {
      const s = await seed(trx);
      const first = await edit(trx, s, s.p.sendId);
      if (first.kind !== "edited") throw new Error("edit failed");
      const second = await edit(trx, s, first.sendId, { subject: "Budget 2028" });
      if (second.kind !== "edited") throw new Error("second edit failed");
      const before = await row(trx, s.p.sendId);
      const input = { userId: s.userId, via: "web" as const, now: NOW };

      expect(await approve(depsOf(trx), s.ctx, s.p.sendId, input)).toEqual({
        kind: "superseded",
        currentId: second.sendId,
      });
      expect(await reject(depsOf(trx), s.ctx, s.p.sendId, input)).toEqual({
        kind: "superseded",
        currentId: second.sendId,
      });

      expect(await row(trx, s.p.sendId)).toEqual(before);
      // The newest version is approved as before.
      expect(await approve(depsOf(trx), s.ctx, second.sendId, input)).toEqual({ kind: "draft_not_ready" });
    });
  });

  test("T5: closed, unchanged, delegate_inactive", async () => {
    await withRollback(db, async (trx) => {
      // The same text as the built message of the template, and no delegate change: nothing changes.
      const s = await seed(trx);
      const built = await builtMessage(trx, s);
      expect(await edit(trx, s, s.p.sendId, { subject: built.subject, body: built.parts.body })).toEqual({
        kind: "unchanged",
      });
      expect((await row(trx, s.p.sendId)).status).toBe("awaiting_approval");
      // After an edit the built message is the edited text: the same text and the same delegate is `unchanged` again.
      const first = await edit(trx, s, s.p.sendId);
      if (first.kind !== "edited") throw new Error("edit failed");
      expect(await edit(trx, s, first.sendId, { delegateId: s.anna })).toEqual({ kind: "unchanged" });
      // Piotr is disabled: the new delegate must be active. A delegate of another organization is the same answer.
      await trx.updateTable("delegates").set({ active: false }).where("id", "=", s.piotr).execute();
      expect(await edit(trx, s, first.sendId, { delegateId: s.piotr })).toEqual({ kind: "delegate_inactive" });
      const other = await createOrgWithMailbox(trx);
      const foreign = await insertDelegate(trx, { orgId: other.orgId }, { name: "Eve", email: "eve@example.com" });
      expect(await edit(trx, s, first.sendId, { delegateId: foreign })).toEqual({ kind: "delegate_inactive" });
      expect((await row(trx, first.sendId)).status).toBe("awaiting_approval");
      // An approved send is closed with its state.
      const approved = await seed(trx);
      await trx
        .updateTable("actions")
        .set({ status: "approved", approved_by: approved.userId, approved_at: NOW, approved_via: "telegram" })
        .where("id", "=", approved.p.sendId)
        .execute();
      expect(await edit(trx, approved, approved.p.sendId)).toEqual({ kind: "closed", state: "approved" });
      expect(await edit(trx, approved, randomUUID())).toEqual({ kind: "not_found" });
    });
  });

  test("T5c: a send in any other state answers closed with that state and nothing changes", async () => {
    // The checks of `actions` want the approval fields for every state after `awaiting_approval`.
    const states: { state: string; set: (userId: string) => Record<string, unknown> }[] = [
      { state: "applying", set: (u) => ({ status: "applying", locked_at: NOW, ...approval(u) }) },
      { state: "applied", set: (u) => ({ status: "applied", applied_at: NOW, ...approval(u) }) },
      { state: "rejected", set: () => ({ status: "rejected", status_reason: "rejected" }) },
      { state: "expired", set: () => ({ status: "expired", status_reason: "timeout" }) },
      // Held by the send scope or a pause: approved, not locked.
      { state: "approved", set: (u) => ({ status: "approved", ...approval(u) }) },
    ];
    for (const { state, set } of states) {
      await withRollback(db, async (trx) => {
        const s = await seed(trx);
        await trx.updateTable("actions").set(set(s.userId)).where("id", "=", s.p.sendId).execute();
        expect(await edit(trx, s, s.p.sendId), state).toEqual({ kind: "closed", state });
        const rows = await trx
          .selectFrom("actions")
          .select("id")
          .where("org_id", "=", s.ctx.orgId)
          .where("supersedes_action_id", "is not", null)
          .execute();
        expect(rows, state).toEqual([]);
        expect((await row(trx, s.p.draftId)).status, state).toBe("applied");
      });
    }
  });

  test("T5b: a reminder is not editable; a delegateId on a clarification is a validation error; bad text too", async () => {
    await withRollback(db, async (trx) => {
      const reminder = await seed(trx, { kind: "reminder" });
      expect(await edit(trx, reminder, reminder.p.sendId)).toEqual({ kind: "not_editable" });
      expect((await row(trx, reminder.p.sendId)).status).toBe("awaiting_approval");

      const clarification = await seed(trx, { kind: "clarification" });
      const failure = await edit(trx, clarification, clarification.p.sendId, { delegateId: clarification.anna }).catch(
        (error: unknown) => error
      );
      expect(failure).toBeInstanceOf(ValidationError);
      expect((failure as ValidationError).details).toMatchObject([{ path: "delegateId" }]);
      for (const bad of [
        { subject: "  \r\n " },
        { subject: "x".repeat(201) },
        { body: "y".repeat(3001) },
        { body: "" },
      ]) {
        const error = await edit(trx, clarification, clarification.p.sendId, bad).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ValidationError);
      }
      expect((await row(trx, clarification.p.sendId)).status).toBe("awaiting_approval");
    });
  });

  test("T6: another delegate with the same text: S2 goes to Piotr and the delegation follows", async () => {
    await withRollback(db, async (trx) => {
      const s = await seed(trx);
      const result = await edit(trx, s, s.p.sendId, { delegateId: s.piotr });
      if (result.kind !== "edited") throw new Error("edit failed");
      const s2 = await row(trx, result.sendId);
      expect(s2.payload).toMatchObject({ to: ["piotr@example.com"], delegate_id: s.piotr });
      const d2 = await row(trx, s2.depends_on_action_id as string);
      expect(d2.payload).toMatchObject({ to: ["piotr@example.com"], delegate_id: s.piotr, delegate_name: "Piotr" });
      const delegation = await trx
        .selectFrom("delegations")
        .select(["delegate_id", "send_action_id"])
        .where("id", "=", s.delegationId as string)
        .executeTakeFirstOrThrow();
      expect(delegation).toEqual({ delegate_id: s.piotr, send_action_id: s2.id });
      const audit = await trx
        .selectFrom("audit_log")
        .select("data")
        .where("org_id", "=", s.ctx.orgId)
        .where("event", "=", "action.edited")
        .execute();
      expect(audit[0]?.data).toMatchObject({ delegate_changed: true });
    });
  });

  test("T7: a clarification send is edited and the delegation hook is not called", async () => {
    await withRollback(db, async (trx) => {
      const s = await seed(trx, { kind: "clarification" });
      const calls: string[] = [];
      const hooks: DelegationHooks = {
        ...noDelegationHooks,
        onSuperseded: async (_trx, _ctx, input) => {
          calls.push(input.delegationId);
          return true;
        },
      };

      const result = await editApproval(depsOf(trx, { hooks }), s.ctx, s.p.sendId, editInput({ userId: s.userId }));

      expect(result.kind).toBe("edited");
      expect(calls).toEqual([]);
    });
  });

  test("a delegation that is not drafted: nothing changes and the answer is closed", async () => {
    await withRollback(db, async (trx) => {
      const s = await seed(trx);
      await trx
        .updateTable("delegations")
        .set({ status: "cancelled", status_reason: "rejected" })
        .where("id", "=", s.delegationId as string)
        .execute();

      expect(await edit(trx, s, s.p.sendId)).toEqual({ kind: "closed", state: "delegation_closed" });

      expect((await row(trx, s.p.sendId)).status).toBe("awaiting_approval");
      expect((await row(trx, s.p.draftId)).status).toBe("applied");
      const count = await trx
        .selectFrom("actions")
        .select(sql<string>`count(*)`.as("n"))
        .where("org_id", "=", s.ctx.orgId)
        .where("supersedes_action_id", "is not", null)
        .executeTakeFirstOrThrow();
      expect(count.n).toBe("0");
      expect(await reverseRowsOf(trx, s.p.draftId)).toEqual([]);
    });
  });

  test("T9: shadow mode answers drafts_off and changes nothing", async () => {
    await withRollback(db, async (trx) => {
      const s = await seed(trx);
      await updateMailboxSettings(trx, s.ctx, s.mailboxId, { mode: "shadow" });
      expect(await edit(trx, s, s.p.sendId)).toEqual({ kind: "drafts_off" });
      await updateMailboxSettings(trx, s.ctx, s.mailboxId, {
        mode: "assist",
        toolSwitches: { ...SWITCHES, create_draft: false },
      });
      expect(await edit(trx, s, s.p.sendId)).toEqual({ kind: "drafts_off" });
      expect((await row(trx, s.p.sendId)).status).toBe("awaiting_approval");
    });
  });

  test("T10: without UIDPLUS the old copy stays in Drafts and no reverse row is written", async () => {
    await withRollback(db, async (trx) => {
      const s = await seed(trx);
      const result = await editApproval(
        depsOf(trx, { uidplus: async () => false }),
        s.ctx,
        s.p.sendId,
        editInput({ userId: s.userId })
      );
      expect(result.kind).toBe("edited");
      expect(await reverseRowsOf(trx, s.p.draftId)).toEqual([]);
      await s.runCommitter();
      expect((await row(trx, s.p.draftId)).status).toBe("applied");
      expect(await s.fake.searchSinceIn("Drafts", new Date(0))).toHaveLength(2);
    });
  });

  test("T11: no result notice for S1, the expiry job leaves it, a Telegram tap answers changed, no reject metric", async () => {
    await withRollback(db, async (trx) => {
      const s = await seed(trx);
      const result = await edit(trx, s, s.p.sendId);
      expect(result.kind).toBe("edited");

      const notify = await listSendResultsToNotify(trx, s.ctx, { limit: 50, now: NOW, pendingCopyMaxAgeMs: MINUTE_MS });
      expect(notify.map((send) => send.id)).not.toContain(s.p.sendId);
      const later = new Date(NOW.getTime() + 30 * DAY_MS);
      expect(
        await listExpiredApprovals(trx, s.ctx, s.mailboxId, { now: later, limit: 50, staleBefore: later })
      ).not.toContainEqual(expect.objectContaining({ id: s.p.sendId }));
      expect(
        await expireSend(trx, s.ctx, s.p.sendId, {
          reason: "timeout",
          now: later,
          actor: "system",
          hooks: noDelegationHooks,
          uidplus: true,
        })
      ).toBe(false);
      const range = { start: new Date(NOW.getTime() - DAY_MS), end: later };
      expect(
        await listRejectRows(trx, s.ctx, {
          range,
          mailboxId: null,
          testMail: { senders: [], domains: [], addresses: [] },
        } as never)
      ).toEqual([]);

      const linkOf = (locale: "en" | "pl"): LinkedChat => ({
        orgId: s.ctx.orgId,
        userId: s.userId,
        role: "owner",
        chatId: 1,
        linkedAt: CREATED,
        locale,
      });
      const deps: CallbackDeps = {
        db: trx,
        now: () => NOW,
        actionsScope: { kind: "all" },
        hooks: noDelegationHooks,
        uidplus: async () => true,
        sendScope: { kind: "all" },
      };
      for (const locale of ["en", "pl"] as const) {
        const changed = textTables[locale].bot.taps.changed;
        expect((await handleCallback(deps, linkOf(locale), `ap:${s.p.sendId}`)).answer).toBe(changed);
        expect((await handleCallback(deps, linkOf(locale), `ar:${s.p.sendId}`)).answer).toBe(changed);
      }
      expect(textTables.pl.bot.taps.changed).not.toBe(textTables.en.bot.taps.changed);
      expect((await row(trx, s.p.sendId)).status_reason).toBe("superseded");
    });
  });

  test("tenant isolation: an edit with the id of another organization is not_found and changes nothing", async () => {
    await withRollback(db, async (trx) => {
      const one = await seed(trx);
      const two = await seed(trx);

      expect(await edit(trx, two, one.p.sendId)).toEqual({ kind: "not_found" });
      expect(await edit(trx, one, two.p.sendId)).toEqual({ kind: "not_found" });
      // A delegate of the other organization cannot be the new recipient.
      expect(await edit(trx, one, one.p.sendId, { delegateId: two.piotr })).toEqual({ kind: "delegate_inactive" });

      for (const id of [one.p.sendId, one.p.draftId, two.p.sendId, two.p.draftId]) {
        expect((await row(trx, id)).supersedes_action_id).toBeNull();
      }
      expect((await row(trx, one.p.sendId)).status).toBe("awaiting_approval");
      expect((await row(trx, two.p.sendId)).status).toBe("awaiting_approval");
    });
  });
});

// Two connections: the rows are committed, the test removes its organization at the end.
describe("editApproval: concurrent writers", () => {
  async function committed() {
    const created = await db.transaction().execute(async (trx) => {
      const box = await createOrgWithMailbox(trx);
      const ctx = { orgId: box.orgId };
      await waitingMailbox(trx, ctx, box.mailboxId);
      const anna = await insertDelegate(trx, ctx, { name: "Anna", email: "anna@example.com" });
      const p = await insertDraftAndSend(trx, ctx, box.mailboxId, {
        kind: "clarification",
        delegateId: anna,
        to: "boss@x.test",
        createdAt: CREATED,
        from: "boss@x.test",
        subject: "Offer",
        messageId: `<orig-${randomUUID()}@x.test>`,
        bodyText: "Please prepare the offer",
      });
      return { ...box, ctx, p };
    });
    const clean = async (): Promise<void> => {
      await db.deleteFrom("organizations").where("id", "=", created.orgId).execute();
      await db.deleteFrom("users").where("id", "=", created.userId).execute();
    };
    return { ...created, clean };
  }

  const connections: Db[] = [];
  afterAll(async () => {
    await Promise.all(connections.map((connection) => connection.destroy()));
  });
  function connection(): Db {
    const next = testDb();
    connections.push(next);
    return next;
  }

  test("T8: two edits of S1 at once: one edited, one changed", async () => {
    const c = await committed();
    try {
      const [one, two] = [connection(), connection()];
      const [a, b] = await Promise.all([
        editApproval(depsOf(one, { hooks: noDelegationHooks }), c.ctx, c.p.sendId, editInput({ userId: c.userId })),
        editApproval(
          depsOf(two, { hooks: noDelegationHooks }),
          c.ctx,
          c.p.sendId,
          editInput({ userId: c.userId, subject: "Other subject" })
        ),
      ]);

      const kinds = [a.kind, b.kind].sort();
      expect(kinds).toEqual(["changed", "edited"]);
      const edited = a.kind === "edited" ? a : b;
      const changed = a.kind === "changed" ? a : b;
      if (edited.kind !== "edited" || changed.kind !== "changed") throw new Error("unexpected answers");
      expect(changed.currentId).toBe(edited.sendId);
      const rows = await db
        .selectFrom("actions")
        .select(["id", "status", "status_reason"])
        .where("org_id", "=", c.orgId)
        .where("type", "=", "send")
        .execute();
      expect(rows.filter((r) => r.status === "awaiting_approval")).toHaveLength(1);
      expect(rows.find((r) => r.id === c.p.sendId)).toMatchObject({ status: "expired", status_reason: "superseded" });
    } finally {
      await c.clean();
    }
  });

  test("T9b: the setter commits first: the edit answers drafts_off and no new send waits", async () => {
    const c = await committed();
    try {
      const [editor, setter] = [connection(), connection()];
      await setMode(
        settingsDeps(setter, () => NOW),
        c.ctx,
        c.mailboxId,
        { mode: "shadow", keepSwitches: true, actor: "test" }
      );

      const result = await editApproval(
        depsOf(editor, { hooks: noDelegationHooks }),
        c.ctx,
        c.p.sendId,
        editInput({ userId: c.userId })
      );

      expect(result).toEqual({ kind: "drafts_off" });
      const sends = await db
        .selectFrom("actions")
        .select(["status", "status_reason"])
        .where("org_id", "=", c.orgId)
        .where("type", "=", "send")
        .execute();
      expect(sends).toEqual([{ status: "expired", status_reason: "policy_changed" }]);
    } finally {
      await c.clean();
    }
  });

  test("T9: a setter to shadow mode that runs during an edit waits, then expires S2 (policy_changed)", async () => {
    const c = await committed();
    const [editor, setter, poller] = [connection(), connection(), connection()];
    const gate = Promise.withResolvers<boolean>();
    const insideEdit = Promise.withResolvers<null>();
    try {
      // `uidplus` runs after the settings lock and the new rows: the edit holds its locks while the gate is shut.
      const editing = editApproval(
        depsOf(editor, {
          hooks: noDelegationHooks,
          uidplus: async () => {
            insideEdit.resolve(null);
            return gate.promise;
          },
        }),
        c.ctx,
        c.p.sendId,
        editInput({ userId: c.userId })
      );
      await Promise.race([
        insideEdit.promise,
        Bun.sleep(10_000).then(() => {
          throw new Error("the edit never reached its last step");
        }),
      ]);
      const setting = setMode(
        settingsDeps(setter, () => NOW),
        c.ctx,
        c.mailboxId,
        {
          mode: "shadow",
          keepSwitches: true,
          actor: "test",
        }
      );
      const deadline = Date.now() + 10_000;
      let waiting = 0;
      while (waiting === 0 && Date.now() < deadline) {
        const found = await sql<{ n: string }>`
          select count(*)::text as n from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'`.execute(poller);
        waiting = Number(found.rows[0]?.n ?? "0");
        if (waiting === 0) await Bun.sleep(25);
      }
      expect(waiting).toBeGreaterThan(0);
      gate.resolve(true);

      const edited = await editing;
      await setting;

      expect(edited.kind).toBe("edited");
      const sends = await db
        .selectFrom("actions")
        .select(["id", "status", "status_reason"])
        .where("org_id", "=", c.orgId)
        .where("type", "=", "send")
        .execute();
      expect(sends.filter((send) => send.status === "awaiting_approval")).toEqual([]);
      const second = sends.find((send) => send.id === (edited.kind === "edited" ? edited.sendId : ""));
      expect(second).toMatchObject({ status: "expired", status_reason: "policy_changed" });
      const settings = await db
        .selectFrom("mailbox_settings")
        .select("mode")
        .where("mailbox_id", "=", c.mailboxId)
        .executeTakeFirstOrThrow();
      expect(settings.mode).toBe("shadow");
    } finally {
      gate.resolve(true);
      await c.clean();
    }
  }, 30_000);
});
