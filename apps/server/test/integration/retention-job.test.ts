import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { clearMailBodies } from "../../src/modules/mail";
import { listOrganizations } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";
import { createRetentionJob, type RetentionCounts } from "../../src/retention";

import {
  createOrgWithMailbox,
  insertAction,
  insertDelegate,
  insertDelegation,
  insertDraftAndSend,
  insertTestEmail,
  insertTriaged,
  suspendOrg,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-12T02:40:00Z");
const DAY_MS = 24 * 3_600_000;
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);
const over90 = ago(90 * DAY_MS + 1000);

// `log.info` writes to console.log; `log.warn` and `log.error` write to console.error.
let lines: string[] = [];
let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  lines = [];
  logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.join(" "));
  });
  errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    lines.push(args.join(" "));
  });
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

interface Org {
  orgId: string;
  userId: string;
  mailboxId: string;
}

async function newOrg(trx: Transaction<DB>, retentionDays: number, suspended = false): Promise<Org> {
  const org = await createOrgWithMailbox(trx);
  await trx
    .updateTable("organizations")
    .set({ data_retention_days: retentionDays })
    .where("id", "=", org.orgId)
    .execute();
  if (suspended) await suspendOrg(trx, org.orgId);
  return org;
}

async function body(trx: Transaction<DB>, id: string): Promise<string | null> {
  return (await trx.selectFrom("emails").select("body_text").where("id", "=", id).executeTakeFirstOrThrow()).body_text;
}

const doneMail = (trx: Transaction<DB>, org: Org, age: number) =>
  insertTestEmail(trx, { orgId: org.orgId }, org.mailboxId, {
    status: "done",
    created_at: ago(age),
    body_text: "Body text",
  });

describe("retention job: run", () => {
  test("clears the bodies by the retention days of each organization, for every plan", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx, 30);
      const b = await newOrg(trx, 7);
      const c = await newOrg(trx, 30, true);
      const rows = {
        a10: await doneMail(trx, a, 10 * DAY_MS),
        a40: await doneMail(trx, a, 40 * DAY_MS),
        b10: await doneMail(trx, b, 10 * DAY_MS),
        b40: await doneMail(trx, b, 40 * DAY_MS),
        c10: await doneMail(trx, c, 10 * DAY_MS),
        c40: await doneMail(trx, c, 40 * DAY_MS),
      };

      await createRetentionJob({ db: trx, now: () => NOW }).run();

      expect(await body(trx, rows.a10)).toBe("Body text");
      expect(await body(trx, rows.a40)).toBeNull();
      expect(await body(trx, rows.b10)).toBeNull();
      expect(await body(trx, rows.b40)).toBeNull();
      expect(await body(trx, rows.c10)).toBe("Body text");
      expect(await body(trx, rows.c40)).toBeNull();
      expect(lines.some((line) => /^\[retention\] retention: \d+ organizations, \d+ rows$/.test(line))).toBe(true);
    });
  });
});

// One row per kind of the A23 list, all over 90 days (the mail body is over the 30 days of the organization).
async function seedFullSet(trx: Transaction<DB>, org: Org, text: string) {
  const ctx = { orgId: org.orgId };
  const old = await insertTestEmail(trx, ctx, org.mailboxId, {
    status: "done",
    created_at: over90,
    body_text: text,
    subject: text,
    from_address: `${text}@x.test`,
  });
  // The mail of the other rows is new: its own body and headers stay.
  const fresh = await insertTestEmail(trx, ctx, org.mailboxId, { status: "done", created_at: ago(DAY_MS) });
  await insertTriaged(trx, ctx, org.mailboxId, {
    category: "info",
    createdAt: over90,
    reason: text,
    fields: { a: text },
  });
  await insertAction(trx, ctx, fresh, {
    type: "save_summary",
    status: "applied",
    createdAt: over90,
    payload: { text },
  });
  const failedMove = await insertAction(trx, ctx, fresh, { type: "move", status: "failed", createdAt: over90 });
  await trx.updateTable("actions").set({ last_error: text, updated_at: over90 }).where("id", "=", failedMove).execute();
  const delegateId = await insertDelegate(trx, ctx);
  const pair = await insertDraftAndSend(trx, ctx, org.mailboxId, { delegateId });
  const delegationId = await insertDelegation(trx, ctx, {
    mailboxId: org.mailboxId,
    emailId: pair.emailId,
    delegateId,
    draftActionId: pair.draftId,
    sendActionId: pair.sendId,
    status: "done",
    taskSummary: text,
  });
  await trx.updateTable("delegations").set({ updated_at: over90 }).where("id", "=", delegationId).execute();
  await trx
    .insertInto("outbox")
    .values({
      org_id: org.orgId,
      user_id: org.userId,
      kind: "sync_ok",
      dedup_key: `key-${randomUUID()}`,
      mailbox_id: org.mailboxId,
      text,
      buttons: "[]",
      status: "sent",
      created_at: over90,
      next_attempt_at: over90,
      sent_at: over90,
    })
    .execute();
  await trx
    .insertInto("chat_link_tokens")
    .values({
      org_id: org.orgId,
      user_id: org.userId,
      token_hash: `${randomUUID()}${randomUUID()}`.replaceAll("-", ""),
      expires_at: ago(2 * DAY_MS),
    })
    .execute();
  return old;
}

const ZERO: RetentionCounts = {
  body: 0,
  headers: 0,
  triage: 0,
  payloads: 0,
  errors: 0,
  tasks: 0,
  outbox: 0,
  tokens: 0,
};

describe("retention job: runOrg", () => {
  test("a full row set gives 1 in every count; the second run gives 0 in every count", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx, 30);
      await seedFullSet(trx, a, "secret");
      const job = createRetentionJob({ db: trx, now: () => NOW });
      const org = { id: a.orgId, dataRetentionDays: 30 };

      expect(await job.runOrg(org, NOW)).toEqual({
        body: 1,
        headers: 1,
        triage: 1,
        payloads: 1,
        errors: 1,
        tasks: 1,
        outbox: 1,
        tokens: 1,
      });
      expect(await job.runOrg(org, NOW)).toEqual(ZERO);
    });
  });

  test("keeps the applied draft payload of an open delegation; clears the one of a closed delegation", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx, 30);
      const ctx = { orgId: a.orgId };
      async function draftOf(status: string): Promise<string> {
        const delegateId = await insertDelegate(trx, ctx);
        const { emailId, draftId, sendId } = await insertDraftAndSend(trx, ctx, a.mailboxId, {
          delegateId,
          createdAt: over90,
          dueDate: "2027-03-01",
          language: "pl",
        });
        await insertDelegation(trx, ctx, {
          mailboxId: a.mailboxId,
          emailId,
          delegateId,
          draftActionId: draftId,
          sendActionId: sendId,
          status,
          remindersSent: 0,
        });
        return draftId;
      }
      const sent = await draftOf("sent");
      const done = await draftOf("done");

      await createRetentionJob({ db: trx, now: () => NOW }).runOrg({ id: a.orgId, dataRetentionDays: 30 }, NOW);

      const read = async (id: string) =>
        (await trx.selectFrom("actions").select("payload").where("id", "=", id).executeTakeFirstOrThrow()).payload;
      expect(await read(sent)).toMatchObject({ due_date: "2027-03-01", language: "pl" });
      expect(await read(done)).toEqual({});
    });
  });
});

// F083 (minor-4): the job reads no mailbox status, plan or triage scope. Scope `off` means the triage worker does not run,
// so for the retention job it is the same as a stuck mail in a mailbox that no worker visits. Each §7 row, with the
// stuck `processing` mail and the stuck `applying` payload, must clear in every state; open work must stay.
describe("retention job: every §7 row in a paused mailbox, a suspended organization and with triage off", () => {
  const variants: { name: string; paused: boolean; suspended: boolean }[] = [
    { name: "paused mailbox", paused: true, suspended: false },
    { name: "suspended organization", paused: false, suspended: true },
    { name: "triage off: active mailbox, active organization, no worker run", paused: false, suspended: false },
    { name: "paused mailbox of a suspended organization", paused: true, suspended: true },
  ];

  for (const variant of variants) {
    test(variant.name, async () => {
      await withRollback(db, async (trx) => {
        const a = await newOrg(trx, 30, variant.suspended);
        if (variant.paused) {
          await trx.updateTable("mailboxes").set({ status: "paused" }).where("id", "=", a.mailboxId).execute();
        }
        const ctx = { orgId: a.orgId };
        const text = "secret";
        const mail = (created: Date, extra: Record<string, unknown> = {}) =>
          insertTestEmail(trx, ctx, a.mailboxId, { created_at: created, body_text: text, ...extra });
        const doneOld = await mail(over90, { status: "done", subject: text, from_address: `${text}@x.test` });
        const pendingOld = await mail(ago(40 * DAY_MS), { status: "pending" });
        const stuckProcessing = await mail(ago(40 * DAY_MS), { status: "processing", locked_at: ago(40 * DAY_MS) });
        const youngProcessing = await mail(ago(40 * DAY_MS), { status: "processing", locked_at: ago(DAY_MS) });
        const fresh = await insertTestEmail(trx, ctx, a.mailboxId, { status: "done", created_at: ago(DAY_MS) });
        await insertTriaged(trx, ctx, a.mailboxId, { category: "info", createdAt: over90, reason: text });
        await insertAction(trx, ctx, fresh, {
          type: "save_summary",
          status: "applied",
          createdAt: over90,
          payload: { text },
        });
        const stuckSend = await insertAction(trx, ctx, fresh, {
          type: "send",
          status: "applying",
          createdAt: over90,
          lockedAt: over90,
          approvedAt: over90,
          payload: { text },
        });
        await trx.updateTable("actions").set({ updated_at: over90 }).where("id", "=", stuckSend).execute();
        const failedMove = await insertAction(trx, ctx, fresh, { type: "move", status: "failed", createdAt: over90 });
        await trx
          .updateTable("actions")
          .set({ last_error: text, updated_at: over90 })
          .where("id", "=", failedMove)
          .execute();
        const delegations: Record<string, string> = {};
        for (const status of ["done", "sent"]) {
          const delegateId = await insertDelegate(trx, ctx);
          const pair = await insertDraftAndSend(trx, ctx, a.mailboxId, { delegateId, createdAt: ago(DAY_MS) });
          delegations[status] = await insertDelegation(trx, ctx, {
            mailboxId: a.mailboxId,
            emailId: pair.emailId,
            delegateId,
            draftActionId: pair.draftId,
            sendActionId: pair.sendId,
            status,
            taskSummary: text,
          });
          await trx
            .updateTable("delegations")
            .set({ updated_at: over90 })
            .where("id", "=", delegations[status] ?? "")
            .execute();
        }
        await trx
          .insertInto("outbox")
          .values({
            org_id: a.orgId,
            user_id: a.userId,
            kind: "sync_ok",
            dedup_key: `key-${randomUUID()}`,
            mailbox_id: a.mailboxId,
            text,
            buttons: "[]",
            status: "sent",
            created_at: over90,
            next_attempt_at: over90,
            sent_at: over90,
          })
          .execute();
        await trx
          .insertInto("chat_link_tokens")
          .values({
            org_id: a.orgId,
            user_id: a.userId,
            token_hash: `${randomUUID()}${randomUUID()}`.replaceAll("-", ""),
            expires_at: ago(2 * DAY_MS),
          })
          .execute();

        const job = createRetentionJob({ db: trx, now: () => NOW });
        const org = { id: a.orgId, dataRetentionDays: 30 };

        expect(await job.runOrg(org, NOW)).toEqual({
          body: 3,
          headers: 1,
          triage: 1,
          payloads: 2,
          errors: 1,
          tasks: 1,
          outbox: 1,
          tokens: 1,
        });
        expect(await body(trx, doneOld)).toBeNull();
        expect(await body(trx, pendingOld)).toBeNull();
        expect(await body(trx, stuckProcessing)).toBeNull();
        expect(await body(trx, youngProcessing)).toBe(text);
        const task = async (id: string) =>
          (await trx.selectFrom("delegations").select("task_summary").where("id", "=", id).executeTakeFirstOrThrow())
            .task_summary;
        expect(await task(delegations.done ?? "")).toBe("[removed]");
        expect(await task(delegations.sent ?? "")).toBe(text);
        expect(await job.runOrg(org, NOW)).toEqual(ZERO);
      });
    });
  }
});

describe("retention job: log", () => {
  test("the lines hold counts and the organization id; no subject, address or body text", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx, 30);
      const old = await seedFullSet(trx, a, "TopSecretText");

      await createRetentionJob({ db: trx, now: () => NOW }).run();

      expect(await body(trx, old)).toBeNull();
      const joined = lines.join("\n");
      expect(joined).toContain(
        `[retention] retention org ${a.orgId}: body 1, headers 1, triage 1, payloads 1, errors 1, tasks 1, outbox 1, tokens 1`
      );
      expect(joined).not.toContain("TopSecretText");
      expect(joined).not.toContain("@x.test");
      expect(joined).not.toContain(old);
    });
  });
});

describe("retention job: an error in one organization", () => {
  test("run() resolves, logs one error line for the first organization and clears the second", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx, 30);
      const b = await newOrg(trx, 30);
      const mine = new Set([a.orgId, b.orgId]);
      const first = (await listOrganizations(trx)).find((org) => mine.has(org.id));
      expect(first).toBeDefined();
      const firstOrg = first?.id === a.orgId ? a : b;
      const secondOrg = firstOrg === a ? b : a;
      const firstMail = await doneMail(trx, firstOrg, 40 * DAY_MS);
      const secondMail = await doneMail(trx, secondOrg, 40 * DAY_MS);

      const job = createRetentionJob({
        db: trx,
        now: () => NOW,
        clearers: {
          clearMailBodies: async (dbOrTrx, ctx, opts) => {
            if (ctx.orgId === firstOrg.orgId) throw new Error("boom");
            return clearMailBodies(dbOrTrx, ctx, opts);
          },
        },
      });
      await job.run();

      expect(lines.filter((line) => line.includes(`retention org ${firstOrg.orgId} failed: `))).toHaveLength(1);
      expect(await body(trx, firstMail)).toBe("Body text");
      expect(await body(trx, secondMail)).toBeNull();
    });
  });
});
