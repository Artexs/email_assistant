import { randomUUID } from "node:crypto";

import { MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { insertDefaultSettings, updateMailboxSettings } from "../../src/modules/config";
import { delegateMail } from "../../src/modules/loops";
import { configureFeatures, setOrgFeature } from "../../src/modules/tenancy";
import { createDb, type Db, type DB, type TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertAction, insertDelegate, insertTriaged } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The Delegate command under two picks at once, the Polish draft and the actor of the audit rows.
// The race tests commit their rows and delete the organization after; the others roll back.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-20T10:00:00Z");
const SWITCHES = { move: true, mark_read: true, flag: true, create_draft: true, move_unsure: false };
const LOOPS = 20;

interface Setup {
  ctx: TenantContext;
  userId: string;
  mailboxId: string;
  delegateId: string;
  emailId: string;
}

// An owner, an `assist` mailbox, an active delegate and a triaged `info` mail; the flag is on.
async function setup(
  trx: Transaction<DB>,
  opts: { language?: "pl" | "en"; subject?: string | null } = {}
): Promise<Setup> {
  await configureFeatures({ off: [] });
  const box = await createOrgWithMailbox(trx);
  const ctx = { orgId: box.orgId };
  await setOrgFeature(trx, ctx, { flag: "delegate_button", enabled: true, actor: "cli", now: NOW });
  await insertDefaultSettings(trx, ctx, box.mailboxId);
  await updateMailboxSettings(trx, ctx, box.mailboxId, { mode: "assist", toolSwitches: SWITCHES });
  const delegateId = await insertDelegate(trx, ctx, { name: "Anna", email: `anna-${randomUUID()}@x.test` });
  const emailId = await insertTriaged(trx, ctx, box.mailboxId, {
    category: "info",
    createdAt: NOW,
    subject: opts.subject === undefined ? "Offer for the autumn campaign" : opts.subject,
    from: `sender-${randomUUID()}@y.test`,
    fields: { language: opts.language ?? "en" },
  });
  return { ctx, userId: box.userId, mailboxId: box.mailboxId, delegateId, emailId };
}

const pick = (s: Setup, delegateId: string = s.delegateId, via: "web" | "telegram" = "web") => ({
  emailId: s.emailId,
  delegateId,
  userId: s.userId,
  via,
});

// Two picks of the same mail at once with different delegates, on two pool connections of `conn`; the second starts
// 0 to 7 ms after the first. Exactly one delegation and one pair may result; the other call answers `exists`.
async function race(conn: Db): Promise<void> {
  for (let i = 0; i < LOOPS; i++) {
    const s = await db.transaction().execute((trx) => setup(trx));
    const other = await db
      .transaction()
      .execute((trx) => insertDelegate(trx, s.ctx, { name: "Piotr", email: `piotr-${randomUUID()}@x.test` }));
    try {
      const results = await Promise.all([
        delegateMail({ db: conn, now: () => NOW }, s.ctx, pick(s)),
        Bun.sleep(i % 8).then(() => delegateMail({ db: conn, now: () => NOW }, s.ctx, pick(s, other, "telegram"))),
      ]);
      expect(results.map((result) => result.kind).sort()).toEqual(["exists", "planned"]);
      const planned = results.find((result) => result.kind === "planned");
      const exists = results.find((result) => result.kind === "exists");
      const delegations = await db.selectFrom("delegations").selectAll().where("org_id", "=", s.ctx.orgId).execute();
      expect(delegations).toHaveLength(1);
      expect(exists).toEqual({ kind: "exists", delegationId: delegations[0]?.id ?? "" });
      const actions = await db
        .selectFrom("actions")
        .select(["id", "type", "status", "idempotency_key"])
        .where("org_id", "=", s.ctx.orgId)
        .where("email_id", "=", s.emailId)
        .execute();
      expect(actions.map((row) => `${row.type}:${row.status}`).sort()).toEqual([
        "create_draft:ready",
        "send:awaiting_approval",
      ]);
      expect(actions.map((row) => row.idempotency_key).sort()).toEqual([
        `${s.emailId}:create_draft:delegation:button:1`,
        `${s.emailId}:send:delegation:button:1`,
      ]);
      expect(planned).toMatchObject({ delegationId: delegations[0]?.id });
    } finally {
      await db.deleteFrom("organizations").where("id", "=", s.ctx.orgId).execute();
    }
  }
}

describe("B1 two picks of one mail at once with different delegates", () => {
  test(
    `${LOOPS} loops, app role: one delegation, one pair, the other call answers exists`,
    async () => {
      await race(db);
    },
    MINUTE_MS
  );

  test(
    `${LOOPS} loops, table-owner role: one delegation, one pair, the other call answers exists`,
    async () => {
      const url = process.env.MIGRATOR_DATABASE_URL;
      if (!url) throw new Error("MIGRATOR_DATABASE_URL is missing: the owner role runs this test");
      const owner = createDb(url);
      try {
        await race(owner);
      } finally {
        await owner.destroy();
      }
    },
    MINUTE_MS
  );
});

describe("the key conflict", () => {
  test("keys of the next attempt that exist with no open delegation: the call fails and writes nothing", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      // A pair that no delegation owns. The command makes both in one transaction, so no crash leaves this.
      await insertAction(trx, s.ctx, s.emailId, {
        type: "create_draft",
        status: "applied",
        idempotencyKey: `${s.emailId}:create_draft:delegation:button:1`,
      });
      await expect(delegateMail({ db: trx, now: () => NOW }, s.ctx, pick(s))).rejects.toThrow(
        "the delegate keys exist after the mail lock"
      );
      const delegations = await trx.selectFrom("delegations").select("id").where("org_id", "=", s.ctx.orgId).execute();
      expect(delegations).toEqual([]);
    });
  });
});

describe("the draft language follows the language of the mail", () => {
  test("a Polish mail gets a Polish draft; the empty task reads the Polish word", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, { language: "pl", subject: null });
      expect((await delegateMail({ db: trx, now: () => NOW }, s.ctx, pick(s))).kind).toBe("planned");
      const draft = await trx
        .selectFrom("actions")
        .select("payload")
        .where("org_id", "=", s.ctx.orgId)
        .where("type", "=", "create_draft")
        .executeTakeFirstOrThrow();
      expect(draft.payload).toMatchObject({ kind: "delegation", language: "pl", task: "(bez tematu)" });
      const [delegation] = await trx
        .selectFrom("delegations")
        .select("task_summary")
        .where("org_id", "=", s.ctx.orgId)
        .execute();
      expect(delegation?.task_summary).toBe("(bez tematu)");
    });
  });

  test("an English mail gets an English draft", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, { language: "en" });
      expect((await delegateMail({ db: trx, now: () => NOW }, s.ctx, pick(s))).kind).toBe("planned");
      const draft = await trx
        .selectFrom("actions")
        .select("payload")
        .where("org_id", "=", s.ctx.orgId)
        .where("type", "=", "create_draft")
        .executeTakeFirstOrThrow();
      expect(draft.payload).toMatchObject({ language: "en" });
    });
  });
});

describe("the audit rows of a pick", () => {
  test("action.planned and delegation.created name the user as the actor, with the status and no text", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      expect((await delegateMail({ db: trx, now: () => NOW }, s.ctx, pick(s))).kind).toBe("planned");
      const planned = await trx
        .selectFrom("audit_log")
        .select(["actor", "action_id", "email_id", "data"])
        .where("org_id", "=", s.ctx.orgId)
        .where("event", "=", "action.planned")
        .execute();
      expect(planned).toHaveLength(2);
      expect(planned.map((row) => row.actor)).toEqual([s.userId, s.userId]);
      expect(planned.every((row) => row.email_id === s.emailId && row.action_id !== null)).toBe(true);
      expect(planned.map((row) => JSON.stringify(row.data)).sort()).toEqual([
        '{"status":"awaiting_approval","action_type":"send"}',
        '{"status":"ready","action_type":"create_draft"}',
      ]);
    });
  });
});
