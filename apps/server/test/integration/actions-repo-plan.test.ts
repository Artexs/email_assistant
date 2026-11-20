import { MINUTE_MS, HOUR_MS, DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import {
  claimActions,
  countActionsSince,
  createPlanned,
  expireReadyOriginals,
  insertReverse,
  isOwnActionId,
  listActionsForEmail,
  listActionsForEmails,
  listDraftTasks,
  listFailedUnnotified,
  listSummaries,
  lockActionsForUndo,
  lockLatestOriginalMove,
  markNotified,
  markUndone,
  setDelegationId,
  type PlannedActionInput,
} from "../../src/modules/actions";
import { insertMailbox } from "../../src/modules/mail/repo";

import { createTwoTenants, actionRows, NOW, STALE_BEFORE, ago, claimOpts, actionState } from "./actions-repo-helpers";
import {
  insertAction,
  insertDelegate,
  insertDraftAndSend,
  insertTestEmail,
  insertTriagedWithActions,
  testCapabilities,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("actions repository", () => {
  test("createPlanned stores the context org and inserts each key once per org", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const emailA = await insertTestEmail(trx, a.ctx, a.mailboxId);
      const emailB = await insertTestEmail(trx, b.ctx, b.mailboxId);
      const move: PlannedActionInput = {
        type: "move",
        payload: { folder: "ai_info" },
        status: "logged",
        idempotencyKey: "k-move",
      };
      const items: PlannedActionInput[] = [
        move,
        { type: "save_summary", payload: { summary: "short summary" }, status: "logged", idempotencyKey: "k-summary" },
      ];

      const first = await createPlanned(trx, a.ctx, emailA, items);
      expect(first).toHaveLength(2);
      expect(first.map((row) => [row.type, row.status])).toEqual([
        ["move", "logged"],
        ["save_summary", "logged"],
      ]);

      const rowsA = await actionRows(trx, a.ctx.orgId);
      expect(rowsA).toHaveLength(2);
      expect(rowsA.map((row) => row.id).sort()).toEqual(first.map((row) => row.id).sort());
      expect(rowsA.find((row) => row.type === "move")).toMatchObject({
        org_id: a.ctx.orgId,
        email_id: emailA,
        status: "logged",
        payload: { folder: "ai_info" },
        idempotency_key: "k-move",
      });

      // The same keys again: no insert, no rows returned.
      expect(await createPlanned(trx, a.ctx, emailA, items)).toEqual([]);
      expect(await actionRows(trx, a.ctx.orgId)).toHaveLength(2);

      // The key is unique per org: the same key in the other org inserts.
      const inB = await createPlanned(trx, b.ctx, emailB, [move]);
      expect(inB).toHaveLength(1);
      expect(await actionRows(trx, b.ctx.orgId)).toHaveLength(1);
      expect(await actionRows(trx, a.ctx.orgId)).toHaveLength(2);

      expect(await createPlanned(trx, a.ctx, emailA, [])).toEqual([]);
    });
  });

  test("listActionsForEmail returns the rows of the context org only", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const emailA = await insertTestEmail(trx, a.ctx, a.mailboxId);
      await createPlanned(trx, a.ctx, emailA, [
        { type: "move", payload: { folder: "ai_spam" }, status: "ready", idempotencyKey: "l-move" },
        { type: "mark_read", payload: {}, status: "awaiting_approval", idempotencyKey: "l-read" },
      ]);

      const rows = await listActionsForEmail(trx, a.ctx, emailA);
      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.type === "move")).toMatchObject({
        status: "ready",
        payload: { folder: "ai_spam" },
      });
      expect(rows.find((row) => row.type === "mark_read")).toMatchObject({ status: "awaiting_approval", payload: {} });

      expect(await listActionsForEmail(trx, b.ctx, emailA)).toEqual([]);
    });
  });

  test("listSummaries returns only save_summary payloads of the context org", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const emailA1 = await insertTestEmail(trx, a.ctx, a.mailboxId);
      const emailA2 = await insertTestEmail(trx, a.ctx, a.mailboxId);
      const emailA3 = await insertTestEmail(trx, a.ctx, a.mailboxId);
      const emailB = await insertTestEmail(trx, b.ctx, b.mailboxId);

      await createPlanned(trx, a.ctx, emailA1, [
        { type: "save_summary", payload: { summary: "summary A1" }, status: "logged", idempotencyKey: "s-a1" },
        { type: "move", payload: { folder: "ai_info" }, status: "logged", idempotencyKey: "s-a1-move" },
      ]);
      // A `move` action only: no summary for this email.
      await createPlanned(trx, a.ctx, emailA2, [
        { type: "move", payload: { folder: "ai_notifications" }, status: "logged", idempotencyKey: "s-a2-move" },
      ]);
      await createPlanned(trx, b.ctx, emailB, [
        { type: "save_summary", payload: { summary: "summary B" }, status: "logged", idempotencyKey: "s-b" },
      ]);

      const summaries = await listSummaries(trx, a.ctx, [emailA1, emailA2, emailA3, emailB]);
      expect([...summaries.entries()]).toEqual([[emailA1, "summary A1"]]);

      const otherOrg = await listSummaries(trx, b.ctx, [emailA1, emailB]);
      expect([...otherOrg.entries()]).toEqual([[emailB, "summary B"]]);

      const empty = await listSummaries(trx, a.ctx, []);
      expect(empty.size).toBe(0);
    });
  });
});

describe("createPlanned with dependsOn and setDelegationId", () => {
  const draftOf = (emailId: string, suffix = ""): PlannedActionInput => ({
    type: "create_draft",
    payload: { kind: "delegation" },
    status: "ready",
    idempotencyKey: `${emailId}:create_draft${suffix}`,
  });
  const sendOf = (emailId: string, suffix = ""): PlannedActionInput => ({
    type: "send",
    payload: { kind: "delegation" },
    status: "awaiting_approval",
    idempotencyKey: `${emailId}:send${suffix}`,
    dependsOn: "create_draft",
  });

  test("the send links to the draft of the same call; the same call again inserts nothing", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const emailId = await insertTestEmail(trx, a.ctx, a.mailboxId);
      const created = await createPlanned(trx, a.ctx, emailId, [draftOf(emailId), sendOf(emailId)]);
      expect(created.map((row) => row.type)).toEqual(["create_draft", "send"]);
      const rows = await actionRows(trx, a.ctx.orgId);
      const draftRow = rows.find((row) => row.type === "create_draft");
      const sendRow = rows.find((row) => row.type === "send");
      const dependsOn = await trx
        .selectFrom("actions")
        .select("depends_on_action_id")
        .where("id", "=", sendRow?.id ?? "")
        .executeTakeFirstOrThrow();
      expect(dependsOn.depends_on_action_id).toBe(draftRow?.id ?? null);

      expect(await createPlanned(trx, a.ctx, emailId, [draftOf(emailId), sendOf(emailId)])).toEqual([]);
      expect(await actionRows(trx, a.ctx.orgId)).toHaveLength(2);
    });
  });

  test("a send alone links to the draft whose key exists", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const emailId = await insertTestEmail(trx, a.ctx, a.mailboxId);
      const [first] = await createPlanned(trx, a.ctx, emailId, [draftOf(emailId)]);
      const created = await createPlanned(trx, a.ctx, emailId, [sendOf(emailId)]);
      expect(created.map((row) => row.type)).toEqual(["send"]);
      const row = await trx
        .selectFrom("actions")
        .select("depends_on_action_id")
        .where("id", "=", created[0]?.id ?? "")
        .executeTakeFirstOrThrow();
      expect(row.depends_on_action_id).toBe(first?.id ?? null);
    });
  });

  test("a lone reminder send links to the reminder draft, not the delegation draft", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const emailId = await insertTestEmail(trx, a.ctx, a.mailboxId);
      const reminder = ":reminder:2026-11-08";
      const [delegationDraft] = await createPlanned(trx, a.ctx, emailId, [draftOf(emailId), sendOf(emailId)]);
      const [reminderDraft] = await createPlanned(trx, a.ctx, emailId, [draftOf(emailId, reminder)]);
      const created = await createPlanned(trx, a.ctx, emailId, [sendOf(emailId, reminder)]);
      const row = await trx
        .selectFrom("actions")
        .select("depends_on_action_id")
        .where("id", "=", created[0]?.id ?? "")
        .executeTakeFirstOrThrow();
      expect(row.depends_on_action_id).toBe(reminderDraft?.id ?? null);
      expect(row.depends_on_action_id).not.toBe(delegationDraft?.id ?? null);
    });
  });

  test("a send without a draft in the call and no existing key throws", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const emailId = await insertTestEmail(trx, a.ctx, a.mailboxId);
      await expect(createPlanned(trx, a.ctx, emailId, [sendOf(emailId)])).rejects.toThrow("send needs its draft");
    });
  });

  test("setDelegationId writes only delegation_id, only on create_draft and send rows, in the context org", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const emailId = await insertTestEmail(trx, a.ctx, a.mailboxId);
      const created = await createPlanned(trx, a.ctx, emailId, [draftOf(emailId), sendOf(emailId)]);
      const ids = created.map((row) => row.id);
      const move = await insertAction(trx, a.ctx, emailId, {
        type: "move",
        status: "ready",
        payload: { folder: "info" },
      });

      expect(await setDelegationId(trx, b.ctx, ids, "x")).toBe(0);
      expect(await setDelegationId(trx, a.ctx, [...ids, move], "x")).toBe(2);
      const rows = await actionRows(trx, a.ctx.orgId);
      for (const row of rows.filter((r) => ids.includes(r.id))) {
        expect(row.payload).toEqual({ kind: "delegation", delegation_id: "x" });
      }
      expect(rows.find((r) => r.id === move)?.payload).toEqual({ folder: "info" });
      expect(await setDelegationId(trx, a.ctx, [], "y")).toBe(0);
    });
  });
});

describe("isOwnActionId", () => {
  test("is true for a draft or send of an email of this mailbox and org only", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const otherMailboxId = crypto.randomUUID();
      await insertMailbox(trx, a.ctx, {
        id: otherMailboxId,
        address: `other-${otherMailboxId}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: { drafts: "Drafts" },
      });
      const email = await insertTestEmail(trx, a.ctx, a.mailboxId);
      const draftId = await insertAction(trx, a.ctx, email, { type: "create_draft", status: "ready" });
      const sendId = await insertAction(trx, a.ctx, email, {
        type: "send",
        status: "awaiting_approval",
        dependsOnActionId: draftId,
      });
      const moveId = await insertAction(trx, a.ctx, email, { type: "move", status: "ready" });

      expect(await isOwnActionId(trx, a.ctx, a.mailboxId, draftId)).toBe(true);
      expect(await isOwnActionId(trx, a.ctx, a.mailboxId, sendId)).toBe(true);
      expect(await isOwnActionId(trx, a.ctx, otherMailboxId, draftId)).toBe(false);
      expect(await isOwnActionId(trx, b.ctx, b.mailboxId, draftId)).toBe(false);
      expect(await isOwnActionId(trx, b.ctx, a.mailboxId, draftId)).toBe(false);
      expect(await isOwnActionId(trx, a.ctx, a.mailboxId, moveId)).toBe(false);
      expect(await isOwnActionId(trx, a.ctx, a.mailboxId, crypto.randomUUID())).toBe(false);
    });
  });

  test("a value that is not a uuid is false and sends no query", async () => {
    const queries: string[] = [];
    const fake = new Proxy({}, { get: () => () => queries.push("query") }) as never;
    expect(await isOwnActionId(fake, { orgId: crypto.randomUUID() }, crypto.randomUUID(), "not-a-uuid")).toBe(false);
    expect(queries).toEqual([]);
  });
});

describe("listActionsForEmails (grown view)", () => {
  test("returns id, reverse, reversesActionId and appliedAt", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(2 * HOUR_MS),
        actions: [{ type: "move", status: "undone", payload: { folder: "ai_info" }, appliedAt: ago(HOUR_MS) }],
      });
      const [original] = mail.actionIds as [string];
      const reverse = await insertAction(trx, a.ctx, mail.emailId, {
        type: "move",
        status: "applied",
        payload: { folder: "ai_info" },
        reversesActionId: original,
        appliedAt: ago(1000),
        createdAt: ago(MINUTE_MS),
      });

      const views = (await listActionsForEmails(trx, a.ctx, [mail.emailId], new Date())).get(mail.emailId);
      expect(views).toEqual([
        {
          id: original,
          type: "move",
          status: "undone",
          folder: "ai_info",
          reverse: false,
          reversesActionId: null,
          appliedAt: ago(HOUR_MS),
          kind: null,
          delegateId: null,
        },
        {
          id: reverse,
          type: "move",
          status: "applied",
          folder: "ai_info",
          reverse: true,
          reversesActionId: original,
          appliedAt: ago(1000),
          kind: null,
          delegateId: null,
        },
      ]);
    });
  });

  test("(12) a logged move to inbox shows the key inbox", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        sourceFolder: "Wiadomości-śmieci",
        folder: "Wiadomości-śmieci",
        actions: [{ type: "move", status: "logged", payload: { folder: "inbox" } }],
      });

      const views = (await listActionsForEmails(trx, a.ctx, [mail.emailId], new Date())).get(mail.emailId);
      expect(views?.map((view) => [view.type, view.folder])).toEqual([["move", "inbox"]]);
    });
  });

  test("a claimed action carries emails.source_folder", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        folder: "AI/Info",
        sourceFolder: "Oferty",
        actions: [{ type: "move", status: "ready", payload: { folder: "ai_info" } }],
      });

      const claimed = await claimActions(trx, a.ctx, a.mailboxId, claimOpts());

      expect(claimed.map((action) => action.email?.source_folder)).toEqual(["Oferty"]);
    });
  });

  test("a draft and a send give kind and delegate id; listDraftTasks gives the draft task per tenant", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const delegateId = await insertDelegate(trx, a.ctx);
      const pair = await insertDraftAndSend(trx, a.ctx, a.mailboxId, { delegateId, task: "Prepare the offer" });
      const views = (await listActionsForEmails(trx, a.ctx, [pair.emailId], new Date())).get(pair.emailId);
      expect(views?.map((view) => [view.type, view.kind, view.delegateId]).sort()).toEqual([
        ["create_draft", "delegation", delegateId],
        ["send", "delegation", delegateId],
      ]);
      expect((await listDraftTasks(trx, a.ctx, [pair.emailId])).get(pair.emailId)).toBe("Prepare the offer");
      expect((await listDraftTasks(trx, b.ctx, [pair.emailId])).size).toBe(0);
      expect((await listDraftTasks(trx, a.ctx, [])).size).toBe(0);
    });
  });
});

describe("tenant filter (7.1b)", () => {
  test("org B's context sees nothing of org A", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        actions: [
          { type: "move", status: "applied", payload: { folder: "ai_info" } },
          { type: "flag", status: "failed" },
          { type: "mark_read", status: "ready" },
        ],
      });
      const [move, flag] = mail.actionIds as [string, string];
      const applied = { id: move, emailId: mail.emailId, type: "move" as const, payload: { folder: "ai_info" } };

      expect(await markUndone(trx, b.ctx, move, { at: NOW, reason: "undo" })).toBe(false);
      expect(await lockActionsForUndo(trx, b.ctx, mail.emailId)).toEqual([]);
      expect(await lockLatestOriginalMove(trx, b.ctx, mail.emailId)).toBeUndefined();
      expect(await listFailedUnnotified(trx, b.ctx, { limit: 10 })).toEqual([]);
      expect(await markNotified(trx, b.ctx, flag, NOW)).toBe(false);
      expect(await countActionsSince(trx, b.ctx, { since: ago(DAY_MS) })).toEqual({ applied: 0, failed: 0, undone: 0 });
      expect(
        await expireReadyOriginals(
          trx,
          b.ctx,
          { mailboxId: a.mailboxId, types: ["move", "mark_read", "flag"] },
          { now: NOW, staleBefore: STALE_BEFORE, reason: "manual" }
        )
      ).toEqual([]);
      // org B cannot attach a reverse row to org A's mail: the composite foreign key rejects it
      await sql`savepoint cross_org`.execute(trx);
      await expect(insertReverse(trx, b.ctx, applied)).rejects.toThrow();
      await sql`rollback to savepoint cross_org`.execute(trx);
      expect((await actionState(trx, move)).status).toBe("applied");
      expect((await actionState(trx, flag)).notified_at).toBeNull();
    });
  });
});
