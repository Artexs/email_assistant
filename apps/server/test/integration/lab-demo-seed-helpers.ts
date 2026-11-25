import { randomUUID } from "node:crypto";

import type { LiveRunPlan } from "@ea/core";
import { expect } from "bun:test";
import { sql } from "kysely";

import { recordAudit } from "../../src/modules/audit";
import {
  DEMO_TABLES,
  DemoSeedError,
  exportDemo,
  IMPORT_ORG_NAME,
  importDemo,
  type DemoSeed,
  type DemoTable,
  type LabRun,
} from "../../src/modules/lab";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { createOrganizationWithOwner } from "../../src/modules/tenancy";

import {
  insertAttachmentHeaders,
  insertDelegate,
  insertDelegation,
  insertDraftAndSend,
  insertTriaged,
  testCapabilities,
} from "./fixtures";
import { testDb } from "./helpers";

// The demo seed export and import. Every test runs on test organizations of the test DB (committed:
// the export reads its own snapshot and the replace deletes in its own transaction) and never on a real organization,
// a real mailbox or a real address: all addresses are `.test`. The organizations of a test are removed in `afterEach`.
export const db = testDb();
export const MARK = "f113s15";
export const NOW = new Date("2026-11-30T12:00:00.000Z");
export const SEND_OFF = "off";

export const orgIds: string[] = [];

export async function removeDemoOrgs(): Promise<void> {
  // The import orgs of a test: named like an import, with a member of this test.
  const imported = await sql<{ id: string }>`
    select o.id from organizations o join memberships m on m.org_id = o.id join users u on u.id = m.user_id
    where o.name = ${IMPORT_ORG_NAME} and u.email like ${`${MARK}-%`}`.execute(db);
  const all = [...orgIds.splice(0), ...imported.rows.map((row) => row.id)];
  if (all.length > 0) await db.deleteFrom("organizations").where("id", "in", all).execute();
  await db.deleteFrom("users").where("email", "like", `${MARK}-%`).execute();
}

// Run day 1 is Monday 2026-11-23. Day `n` at 10:00 UTC is inside Warsaw day `n`.
export const dayAt = (day: number): Date => new Date(`2026-11-${22 + day}T10:00:00.000Z`);

export const PLAN: LiveRunPlan = {
  runId: "week-20261123-aaaa",
  mode: "week",
  startDate: "2026-11-23",
  offsetDays: 0,
  scenarioDays: [1, 2, 3, 4, 5, 6, 7],
  items: [],
  endsAt: "2026-11-29T23:00:00.000Z",
  tailEndsAt: "2026-12-03T23:00:00.000Z",
  deadlines: [],
};
export const RUN: LabRun = { plan: PLAN, org: "demo", capUsd: 5 };

export interface Fixture {
  orgId: string;
  userId: string;
  ownerEmail: string;
  mailboxId: string;
  address: string;
  emailIds: string[];
  draftId: string;
  sendId: string;
  delegationId: string;
}

export const SECRET = "SENTINEL-SECRET-VALUE";

// The fixture of the stage file: 1 mailbox, 2 delegates, 5 emails with headers and triage (one a day, days 1 to 5; the
// delegation mail is the fifth), 1 action `awaiting_approval` (the send) and 1 `applied` (the draft), 1 delegation,
// 2 outbox rows (one pending, one sent), 1 feedback row, 2 audit rows, a vip rule, and rows of the tables that a seed
// must never hold (credentials with a secret, a chat link).
export async function buildFixture(name = "Kordelan demo"): Promise<Fixture> {
  const suffix = randomUUID();
  return db.transaction().execute(async (trx) => {
    const ownerEmail = `${MARK}-owner-${suffix}@kordelan.test`;
    const { orgId, userId } = await createOrganizationWithOwner(trx, {
      orgName: name,
      timezone: "Europe/Warsaw",
      email: ownerEmail,
      displayName: "Executive",
      locale: "en",
      plan: { kind: "active" },
    });
    orgIds.push(orgId);
    const ctx = { orgId };
    const mailboxId = randomUUID();
    const address = `${MARK}-box-${suffix}@kordelan.test`;
    await insertMailbox(trx, ctx, {
      id: mailboxId,
      address,
      imapHost: "127.0.0.1",
      imapPort: 3143,
      smtpHost: "127.0.0.1",
      smtpPort: 3025,
      capabilities: testCapabilities,
      folderMap: { drafts: "Drafts" },
    });
    await insertInboxFolder(trx, ctx, mailboxId);
    await trx
      .insertInto("mailbox_settings")
      .values({ mailbox_id: mailboxId, org_id: orgId, mode: "shadow", urgency_profile: JSON.stringify({ vip: [] }) })
      .execute();
    await trx
      .insertInto("sender_rules")
      .values({ org_id: orgId, mailbox_id: mailboxId, pattern: `ceo-${suffix}@kordelan.test`, kind: "vip" })
      .execute();
    const delegateIds = [
      await insertDelegate(trx, ctx, { name: "Anna", email: `${MARK}-anna-${suffix}@kordelan.test` }),
      await insertDelegate(trx, ctx, { name: "Piotr", email: `${MARK}-piotr-${suffix}@kordelan.test` }),
    ];
    // Rows of tables that a seed never holds.
    await trx
      .insertInto("mailbox_credentials")
      .values({
        mailbox_id: mailboxId,
        org_id: orgId,
        secret_kind: "password",
        encrypted_secret: SECRET,
        key_version: 1,
      })
      .execute();
    await trx
      .insertInto("chat_links")
      .values({
        org_id: orgId,
        user_id: userId,
        channel: "telegram",
        external_chat_id: 700_000 + Math.floor(Math.random() * 99_999),
      })
      .execute();

    const emailIds: string[] = [];
    for (const [index, category] of (["info", "needs_reply", "spam", "urgent"] as const).entries()) {
      emailIds.push(
        await insertTriaged(trx, ctx, mailboxId, {
          category,
          createdAt: dayAt(index + 1),
          subject: `Subject ${index + 1}`,
          from: `p${index}@x.test`,
        })
      );
    }
    const { emailId, draftId, sendId } = await insertDraftAndSend(trx, ctx, mailboxId, {
      createdAt: dayAt(5),
      delegateId: delegateIds[0] as string,
      to: `${MARK}-anna-${suffix}@kordelan.test`,
      requestSent: true,
    });
    emailIds.push(emailId);
    // One mail a day, by creation time; the third is still `pending` (it was not triaged yet).
    for (const [index, id] of emailIds.entries()) {
      await trx
        .updateTable("emails")
        .set({ created_at: dayAt(index + 1) })
        .where("id", "=", id)
        .execute();
      await insertAttachmentHeaders(trx, ctx, id, []);
    }
    await trx
      .updateTable("emails")
      .set({ status: "pending" })
      .where("id", "=", emailIds[2] as string)
      .execute();
    await trx
      .updateTable("triage_results")
      .set({ tokens_in: 11, tokens_out: 7, model: "gpt-6-luna" })
      .where("org_id", "=", orgId)
      .execute();

    // The database stamps these rows with the real clock. A day cut that falls before the real date would drop them
    // and every row that points at them, so each row gets the time of the run day it belongs to.
    for (const table of ["mailboxes", "sender_rules", "delegates"] as const)
      await trx
        .updateTable(table)
        .set({ created_at: dayAt(1) })
        .where("org_id", "=", orgId)
        .execute();
    await sql`
      update email_headers h set captured_at = e.created_at
      from emails e where e.id = h.email_id and e.org_id = ${orgId}::uuid`.execute(trx);

    const delegationId = await insertDelegation(trx, ctx, {
      mailboxId,
      emailId,
      delegateId: delegateIds[0] as string,
      draftActionId: draftId,
      sendActionId: sendId,
      createdAt: dayAt(5),
    });
    // The id of the delegation inside the payload of both actions (as the triage worker writes it).
    await sql`
      update actions set payload = payload || jsonb_build_object('delegation_id', ${delegationId}::text)
      where org_id = ${orgId}::uuid and id in (${draftId}::uuid, ${sendId}::uuid)`.execute(trx);
    await trx
      .insertInto("outbox")
      .values({
        org_id: orgId,
        user_id: userId,
        kind: "urgent",
        dedup_key: `urgent:${emailIds[3]}`,
        email_id: emailIds[3] as string,
        text: "Urgent",
        status: "pending",
        created_at: dayAt(4),
        next_attempt_at: dayAt(4),
      })
      .execute();
    await trx
      .insertInto("triage_feedback")
      .values({
        org_id: orgId,
        email_id: emailIds[1] as string,
        verdict: "wrong",
        true_category: "info",
        source: "telegram",
        user_id: userId,
        created_at: dayAt(2),
      })
      .execute();
    await recordAudit(trx, ctx, {
      actor: "system",
      event: "llm.call",
      data: { mailbox_id: mailboxId, role: "triage" },
      at: dayAt(1),
    });
    await recordAudit(trx, ctx, {
      actor: `user:${userId}`,
      event: "action.approved",
      emailId,
      actionId: sendId,
      data: { action_id: sendId },
      at: dayAt(5),
    });
    return { orgId, userId, ownerEmail, mailboxId, address, emailIds, draftId, sendId, delegationId };
  });
}

export const FIXTURE_COUNTS: Record<DemoTable, number> = {
  organizations: 1,
  mailboxes: 1,
  mailbox_settings: 1,
  sender_rules: 1,
  delegates: 2,
  emails: 5,
  email_headers: 5,
  triage_results: 5,
  triage_feedback: 1,
  actions: 2,
  delegations: 1,
  outbox: 2,
  audit_log: 2,
};

export const exportOf = (fx: { orgId: string }, day = 7): Promise<DemoSeed> =>
  exportDemo(db, { orgId: fx.orgId }, RUN, day, { scenario: "lab-01", now: NOW });

export const countsOf = (seed: DemoSeed): Record<string, number> =>
  Object.fromEntries(DEMO_TABLES.map((table) => [table, seed.tables[table].length]));

export const orgColumn = (table: string): string => (table === "organizations" ? "id" : "org_id");

// Rows of an organization in every table with an `org_id` column, plus `organizations`.
export async function rowCounts(orgId: string): Promise<Record<string, number>> {
  const tables = await sql<{ table_name: string }>`
    select c.table_name from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'org_id' and t.table_type = 'BASE TABLE'
    order by c.table_name`.execute(db);
  const counts: Record<string, number> = {};
  for (const { table_name: table } of tables.rows) {
    const row = await sql<{
      n: string;
    }>`select count(*) as n from ${sql.table(table)} where org_id = ${orgId}::uuid`.execute(db);
    counts[table] = Number(row.rows[0]?.n);
  }
  const own = await sql<{ n: string }>`select count(*) as n from organizations where id = ${orgId}::uuid`.execute(db);
  counts.organizations = Number(own.rows[0]?.n);
  return counts;
}

// The ids of the rows of an organization, per table: a changed, added or removed row shows.
export async function idsOf(orgId: string): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const table of DEMO_TABLES) {
    const key = table === "mailbox_settings" ? "mailbox_id" : table === "email_headers" ? "email_id" : "id";
    const rows = await sql<{
      k: string;
    }>`select ${sql.ref(key)}::text as k from ${sql.table(table)} where ${sql.ref(orgColumn(table))} = ${orgId}::uuid order by 1`.execute(
      db
    );
    out[table] = rows.rows.map((row) => row.k);
  }
  return out;
}

// A file from another database: the same rows, an organization id that this database does not hold. (The ids of the
// rows stay, and this database holds rows with these ids: the import must give new ones.)
export function elsewhere(seed: DemoSeed): DemoSeed {
  const oldId = String(seed.tables.organizations[0]?.id);
  return JSON.parse(JSON.stringify(seed).replaceAll(oldId, randomUUID())) as DemoSeed;
}

export const owner = (): string => `${MARK}-dev-${randomUUID()}@dev.test`;

// Counts of the rows this file owns: its users, its fixture organizations and the import organizations. Other test files
// run at the same time on the same DB (`bun test --parallel`), so a count over the whole DB changes under this test.
export async function snapshot() {
  const mine = sql`select o.id from organizations o
    where o.name = ${IMPORT_ORG_NAME}
      or o.id = any(${sql.val(orgIds)}::uuid[])
      or exists (select 1 from memberships m join users u on u.id = m.user_id where m.org_id = o.id and u.email like ${`${MARK}-%`})`;
  const one = async (query: ReturnType<typeof sql<{ n: string }>>) => Number((await query.execute(db)).rows[0]?.n);
  return {
    orgs: await one(sql`select count(*) as n from (${mine}) as t`),
    users: await one(sql`select count(*) as n from users where email like ${`${MARK}-%`}`),
    mailboxes: await one(sql`select count(*) as n from mailboxes where org_id in (${mine})`),
    emails: await one(sql`select count(*) as n from emails where org_id in (${mine})`),
    actions: await one(sql`select count(*) as n from actions where org_id in (${mine})`),
  };
}

export async function importRefusal(
  seed: DemoSeed,
  opts: Partial<Parameters<typeof importDemo>[2]> = {}
): Promise<DemoSeedError> {
  const error = await importDemo(db, seed, {
    ownerEmail: owner(),
    replace: false,
    sendScope: SEND_OFF,
    now: NOW,
    ...opts,
  }).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(DemoSeedError);
  return error as DemoSeedError;
}
