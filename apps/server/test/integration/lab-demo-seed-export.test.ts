import { randomUUID } from "node:crypto";

import type { LiveRunPlan } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { recordAudit } from "../../src/modules/audit";
import {
  DEMO_TABLES,
  DemoSeedError,
  exportDemo,
  IMPORT_ORG_NAME,
  importDemo,
  serializeDemoSeed,
  type DemoSeed,
  type DemoSeedErrorCode,
  type DemoTable,
  type LabRun,
} from "../../src/modules/lab";
import { PLACEHOLDER_SECRET, TABLE_SPECS } from "../../src/modules/lab/demo-seed";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { EXPORT_MAP } from "../../src/modules/privacy";
import { addMember, createOrganizationWithOwner } from "../../src/modules/tenancy";

import {
  insertAttachmentHeaders,
  insertDelegate,
  insertDelegation,
  insertDraftAndSend,
  insertTriaged,
  testCapabilities,
} from "./fixtures";
import { testDb } from "./helpers";
import { insertLoopActionPair, insertLoopRow } from "./loops-fixtures";

// The demo seed export and import. Every test runs on test organizations of the test DB (committed:
// the export reads its own snapshot and the replace deletes in its own transaction) and never on a real organization,
// a real mailbox or a real address: all addresses are `.test`. The organizations of a test are removed in `afterEach`.
const db = testDb();
const MARK = "f113s15";
const NOW = new Date("2026-11-30T12:00:00.000Z");
const SEND_OFF = "off";

const orgIds: string[] = [];
afterEach(async () => {
  // The import orgs of a test: named like an import, with a member of this test.
  const imported = await sql<{ id: string }>`
    select o.id from organizations o join memberships m on m.org_id = o.id join users u on u.id = m.user_id
    where o.name = ${IMPORT_ORG_NAME} and u.email like ${`${MARK}-%`}`.execute(db);
  const all = [...orgIds.splice(0), ...imported.rows.map((row) => row.id)];
  if (all.length > 0) await db.deleteFrom("organizations").where("id", "in", all).execute();
  await db.deleteFrom("users").where("email", "like", `${MARK}-%`).execute();
});
afterAll(async () => {
  await db.destroy();
});

// Run day 1 is Monday 2026-11-23. Day `n` at 10:00 UTC is inside Warsaw day `n`.
const dayAt = (day: number): Date => new Date(`2026-11-${22 + day}T10:00:00.000Z`);

const PLAN: LiveRunPlan = {
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
const RUN: LabRun = { plan: PLAN, org: "demo", capUsd: 5 };

interface Fixture {
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

const SECRET = "SENTINEL-SECRET-VALUE";

// The fixture of the stage file: 1 mailbox, 2 delegates, 5 emails with headers and triage (one a day, days 1 to 5; the
// delegation mail is the fifth), 1 action `awaiting_approval` (the send) and 1 `applied` (the draft), 1 delegation,
// 2 outbox rows (one pending, one sent), 1 feedback row, 2 audit rows, a vip rule, and rows of the tables that a seed
// must never hold (credentials with a secret, a chat link).
async function buildFixture(name = "Kordelan demo"): Promise<Fixture> {
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

const FIXTURE_COUNTS: Record<DemoTable, number> = {
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

const exportOf = (fx: { orgId: string }, day = 7): Promise<DemoSeed> =>
  exportDemo(db, { orgId: fx.orgId }, RUN, day, { scenario: "lab-01", now: NOW });

const countsOf = (seed: DemoSeed): Record<string, number> =>
  Object.fromEntries(DEMO_TABLES.map((table) => [table, seed.tables[table].length]));

const orgColumn = (table: string): string => (table === "organizations" ? "id" : "org_id");

// Rows of an organization in every table with an `org_id` column, plus `organizations`.
async function rowCounts(orgId: string): Promise<Record<string, number>> {
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
async function idsOf(orgId: string): Promise<Record<string, string[]>> {
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
function elsewhere(seed: DemoSeed): DemoSeed {
  const oldId = String(seed.tables.organizations[0]?.id);
  return JSON.parse(JSON.stringify(seed).replaceAll(oldId, randomUUID())) as DemoSeed;
}

const owner = (): string => `${MARK}-dev-${randomUUID()}@dev.test`;

// Counts of the rows this file owns: its users, its fixture organizations and the import organizations. Other test files
// run at the same time on the same DB (`bun test --parallel`), so a count over the whole DB changes under this test.
async function snapshot() {
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

async function importRefusal(
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

describe("the tables of the seed against the database (a new column or key fails here)", () => {
  test("every foreign key column of a demo table is handled, every JSON column is listed, every id column is re-keyed", async () => {
    const names = [...DEMO_TABLES];
    const fks = await sql<{ t: string; col: string }>`
      select c.conrelid::regclass::text as t, a.attname as col
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
      where c.contype = 'f' and c.conrelid::regclass::text = any (${names})`.execute(db);
    for (const { t, col } of fks.rows) {
      const spec = TABLE_SPECS[t as DemoTable];
      const handled = new Set([
        "org_id",
        ...Object.keys(spec.refs),
        ...(spec.selfRefs ?? []),
        ...(spec.userRefs ?? []),
        ...(spec.unexportable ?? []),
      ]);
      expect(handled.has(col), `${t}.${col} is a foreign key that the seed does not handle`).toBe(true);
    }
    const json = await sql<{ t: string; col: string }>`
      select table_name as t, column_name as col from information_schema.columns
      where table_schema = 'public' and table_name = any (${names}) and data_type in ('json', 'jsonb')`.execute(db);
    for (const table of DEMO_TABLES) {
      const listed = new Set(TABLE_SPECS[table].json);
      const real = json.rows.filter((row) => row.t === table).map((row) => row.col);
      const exported = real.filter((col) => {
        const entry = EXPORT_MAP[table];
        return entry?.export === true && entry.columns.includes(col);
      });
      expect([...listed].sort(), `JSON columns of ${table}`).toEqual(exported.sort());
    }
    const ids = await sql<{ t: string }>`
      select table_name as t from information_schema.columns
      where table_schema = 'public' and table_name = any (${names}) and column_name = 'id' and data_type = 'uuid'`.execute(
      db
    );
    for (const { t } of ids.rows) expect(TABLE_SPECS[t as DemoTable].id, `${t}.id`).toBe("id");
  });
});

describe("exportDemo (F113 stage 15)", () => {
  test("1: day 7 holds every table of DEMO_TABLES with the fixture counts, the exported columns only, and no secret", async () => {
    const fx = await buildFixture();
    const seed = await exportOf(fx);
    expect(countsOf(seed)).toEqual(FIXTURE_COUNTS);
    expect(Object.keys(seed.tables)).toEqual([...DEMO_TABLES]);
    expect(seed).toMatchObject({
      format: "ea-demo-seed/1",
      scenario: "lab-01",
      runId: PLAN.runId,
      day: 7,
      exportedAt: NOW.toISOString(),
    });

    // The columns of each row are the `EXPORT_MAP` columns: no excluded column, and no table that `EXPORT_MAP` keeps out.
    for (const table of DEMO_TABLES) {
      const entry = EXPORT_MAP[table];
      if (entry?.export !== true) throw new Error(`${table} is not exported by EXPORT_MAP`);
      for (const row of seed.tables[table]) {
        expect(Object.keys(row)).toEqual([...entry.columns]);
        for (const column of Object.keys(entry.excluded)) expect(column in row).toBe(false);
      }
    }
    expect(seed.tables.emails.some((row) => "from_address_lower" in row)).toBe(false);
    const text = serializeDemoSeed(seed);
    for (const [name, entry] of Object.entries(EXPORT_MAP)) {
      if (!entry.export) expect(text).not.toContain(`"${name}"`);
    }
    expect(
      Object.keys(seed.tables).some((name) =>
        ["users", "memberships", "chat_links", "mailbox_credentials"].includes(name)
      )
    ).toBe(false);
    for (const secret of [SECRET, "encrypted_secret", "external_chat_id", fx.ownerEmail])
      expect(text).not.toContain(secret);
    // Token counts stay.
    expect(seed.tables.triage_results.every((row) => row.tokens_in === 11 && row.tokens_out === 7)).toBe(true);
    // The JSON ids are in the file as they are in the database: the import maps them.
    expect(seed.tables.audit_log.some((row) => (row.data as { mailbox_id?: string }).mailbox_id === fx.mailboxId)).toBe(
      true
    );
    expect(
      seed.tables.actions.every((row) => (row.payload as { delegation_id?: string }).delegation_id === fx.delegationId)
    ).toBe(true);
  });

  test("1b: two exports of the same rows are the same bytes; rows are sorted by id inside each table", async () => {
    const fx = await buildFixture();
    const first = serializeDemoSeed(await exportOf(fx));
    const second = serializeDemoSeed(await exportOf(fx));
    expect(second).toBe(first);
    const seed = await exportOf(fx);
    for (const table of DEMO_TABLES) {
      const key = table === "mailbox_settings" ? "mailbox_id" : table === "email_headers" ? "email_id" : "id";
      const keys = seed.tables[table].map((row) => row[key] as string);
      const sorted = table === "audit_log" ? [...keys].sort((a, b) => Number(BigInt(a) - BigInt(b))) : [...keys].sort();
      expect(keys, table).toEqual(sorted);
    }
  });

  // Each case plants one address outside `.test` in one column; the export refuses and names the table and column.
  const BAD: [string, string, string, string][] = [
    // Forms that the first scan let through into the seed file.
    [
      "emails",
      "body_text",
      "update emails set body_text = 'write to \"john\"@gmail.com today' where id = $1",
      "emails",
    ],
    ["emails", "body_text", "update emails set body_text = 'write to john@[10.0.0.1] today' where id = $1", "emails"],
    ["emails", "body_text", "update emails set body_text = 'write to john＠gmail.com today' where id = $1", "emails"],
    ["emails", "body_text", "update emails set body_text = 'write to john%40gmail.com today' where id = $1", "emails"],
    [
      "emails",
      "body_text",
      "update emails set body_text = 'write to john&#x40;gmail.com today' where id = $1",
      "emails",
    ],
    ["emails", "to_addresses", "update emails set to_addresses = array['x@gmail.com'] where id = $1", "emails"],
    [
      "emails",
      "body_text",
      "update emails set body_text = 'write to boss@realcompany.example today' where id = $1",
      "emails",
    ],
    ["emails", "subject", "update emails set subject = 'a@x.test.com' where id = $1", "emails"],
    [
      "delegates",
      "email",
      "update delegates set email = 'anna@gmail.com' where org_id = $2::uuid and name = 'Anna'",
      "delegates",
    ],
    [
      "actions",
      "payload",
      "update actions set payload = payload || jsonb_build_object('to', jsonb_build_array('c@mail.example')) where id = $3::uuid",
      "actions",
    ],
    [
      "audit_log",
      "data",
      "insert into audit_log (org_id, actor, event, data) values ($2::uuid, 'system', 'x', '{\"note\": \"real@person.org\"}')",
      "audit_log",
    ],
  ];
  test.each(BAD)(
    "2: an address outside .test in %s.%s: non_test_address with the table and column, no value",
    async (table, column, update) => {
      const fx = await buildFixture();
      await sql
        .raw(update.replace("$1", `'${fx.emailIds[0]}'`).replace("$2", `'${fx.orgId}'`).replace("$3", `'${fx.sendId}'`))
        .execute(db);
      const error = await exportOf(fx).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(DemoSeedError);
      expect(error).toMatchObject({ code: "non_test_address", table, column });
      expect(String((error as Error).message) + (error as DemoSeedError).detail).not.toMatch(
        /gmail|realcompany|mail\.example|person\.org|x\.test\.com/
      );
    }
  );

  test("2b: a mailbox host that is not a loopback or .test name: non_test_host with the column", async () => {
    const fx = await buildFixture();
    await db.updateTable("mailboxes").set({ imap_host: "imap.gmail.com" }).where("id", "=", fx.mailboxId).execute();
    await expect(exportOf(fx)).rejects.toMatchObject({
      code: "non_test_host",
      table: "mailboxes",
      column: "imap_host",
    });
  });

  test("3: the day cut: a mail created on day 2 is in day 2, one created on day 3 is not; rows that point at a cut row go too", async () => {
    const fx = await buildFixture();
    const day2 = await exportOf(fx, 2);
    const ids = (seed: DemoSeed) => seed.tables.emails.map((row) => row.id);
    expect(ids(day2)).toEqual([fx.emailIds[0], fx.emailIds[1]].sort());
    // Rows made on day 1 and 2 stay; every later row is out, and so is every row of a cut mail (the headers carry
    // today's time, so only the link to their mail removes them).
    expect(countsOf(day2)).toEqual({
      ...FIXTURE_COUNTS,
      emails: 2,
      email_headers: 2,
      triage_results: 2,
      triage_feedback: 1,
      actions: 0,
      delegations: 0,
      outbox: 0,
      audit_log: 1,
    });
    expect(day2.day).toBe(2);
    const day3 = await exportOf(fx, 3);
    expect(ids(day3)).toEqual([fx.emailIds[0], fx.emailIds[1], fx.emailIds[2]].sort());
    expect(day3.tables.email_headers).toHaveLength(3);
    expect((await exportOf(fx, 7)).tables.emails).toHaveLength(5);
    // The cut after day 2 is 00:00 Warsaw on 2026-11-25, that is 2026-11-24T23:00:00Z. A mail one millisecond before
    // it is in; a mail at that instant is out.
    const cut = new Date("2026-11-24T23:00:00.000Z");
    await db
      .updateTable("emails")
      .set({ created_at: new Date(cut.getTime() - 1) })
      .where("id", "=", fx.emailIds[2] as string)
      .execute();
    await db
      .updateTable("emails")
      .set({ created_at: cut })
      .where("id", "=", fx.emailIds[3] as string)
      .execute();
    const edge = await exportOf(fx, 2);
    expect(ids(edge)).toEqual([fx.emailIds[0], fx.emailIds[1], fx.emailIds[2]].sort());
  });

  test("3a: an action and a card of an open loop are not in the seed (the loop table is not)", async () => {
    const fx = await buildFixture();
    const before = await exportOf(fx);
    const loop = await db.transaction().execute(async (trx) => {
      const loopId = await insertLoopRow(trx, { orgId: fx.orgId }, fx.mailboxId);
      await insertLoopActionPair(trx, { orgId: fx.orgId }, loopId);
      await trx
        .insertInto("outbox")
        .values({
          org_id: fx.orgId,
          user_id: fx.userId,
          kind: "approval",
          dedup_key: `test:${randomUUID()}`,
          loop_id: loopId,
          text: "x",
          next_attempt_at: NOW,
          created_at: NOW,
        })
        .execute();
      return loopId;
    });
    const after = await exportOf(fx);
    expect(countsOf(after)).toEqual(countsOf(before));
    expect(JSON.stringify(after)).not.toContain(loop);
  });

  test("3b: a day outside the run, and a run that is not the demo run, are refused before any read", async () => {
    const fx = await buildFixture();
    for (const day of [0, 8, 1.5]) await expect(exportOf(fx, day)).rejects.toMatchObject({ code: "day_out_of_range" });
    await expect(
      exportDemo(db, { orgId: fx.orgId }, { ...RUN, org: "lab" }, 7, { scenario: "lab-01" })
    ).rejects.toMatchObject({
      code: "run_not_demo",
    });
  });

  test("13: it reads only the named org: a third org's rows and addresses are not in the file; an org with another name is refused", async () => {
    const fx = await buildFixture();
    const third = await buildFixture();
    const other = await buildFixture("Real Company Sp. z o.o.");
    const lab = await buildFixture("Kordelan lab");
    const text = serializeDemoSeed(await exportOf(fx));
    for (const foreign of [third, other]) {
      for (const [table, ids] of Object.entries(await idsOf(foreign.orgId))) {
        // A bigint id (`audit_log`) is a short number that can sit in any text: only UUID ids are searched.
        for (const id of ids.filter((value) => value.length > 20)) {
          expect(text, `${table} row of another org`).not.toContain(id);
        }
      }
      expect(text).not.toContain(foreign.address);
    }
    expect(text).toContain(fx.address);
    // The org of the call is the only filter that picks rows: a wrong name is refused, not exported.
    await expect(exportOf(other)).rejects.toMatchObject({ code: "org_mismatch" });
    await expect(exportOf(lab)).rejects.toMatchObject({ code: "org_mismatch" });
    await expect(exportOf({ orgId: randomUUID() })).rejects.toMatchObject({ code: "org_mismatch" });
    // Nothing of the source or the others changed.
    expect((await rowCounts(fx.orgId)).emails).toBe(5);
  });
});

describe("importDemo (F113 stage 15)", () => {
  test("4: a seed from another database makes a NEW org; every id is new, the counts match, every key points into the new org, JSON ids are mapped", async () => {
    const fx = await buildFixture();
    const third = await buildFixture();
    const seed = elsewhere(await exportOf(fx));
    const sourceBefore = await idsOf(fx.orgId);
    const thirdBefore = await idsOf(third.orgId);
    const email = owner();

    const result = await importDemo(db, seed, { ownerEmail: email, replace: false, sendScope: SEND_OFF, now: NOW });
    expect(result.orgId).not.toBe(fx.orgId);
    // The outbox row that was not sent is dropped; the others keep their count.
    expect(result.rows).toEqual({ ...FIXTURE_COUNTS, outbox: 1 });
    const after = await rowCounts(result.orgId);
    for (const table of DEMO_TABLES) expect(after[table], table).toBe(result.rows[table]);
    expect(await rowCounts(result.orgId)).toMatchObject({ mailbox_credentials: 1, memberships: 1, chat_links: 0 });

    // Every id of the new org is new: none is in the file, and none is a row of the source org (the file's ids are the source's).
    const fileText = JSON.stringify(seed);
    const fileIds = new Set(fileText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g));
    const newIds = await idsOf(result.orgId);
    for (const [table, ids] of Object.entries(newIds)) {
      for (const id of ids) expect(fileIds.has(id), `${table} ${id}`).toBe(false);
    }
    // The foreign keys: each one points at a row of the same new org.
    for (const table of DEMO_TABLES) {
      const spec = TABLE_SPECS[table];
      for (const [column, parent] of [
        ...Object.entries(spec.refs),
        ...(spec.selfRefs ?? []).map((c) => [c, table] as const),
      ]) {
        const parentKey = "id";
        const broken = await sql<{ n: string }>`
          select count(*) as n from ${sql.table(table)} c
          where c.org_id = ${result.orgId}::uuid and c.${sql.ref(column)} is not null
            and not exists (select 1 from ${sql.table(parent)} p where p.${sql.ref(parentKey)} = c.${sql.ref(column)} and p.org_id = ${result.orgId}::uuid)`.execute(
          db
        );
        expect(Number(broken.rows[0]?.n), `${table}.${column}`).toBe(0);
      }
      for (const column of spec.userRefs ?? []) {
        const wrong = await sql<{ n: string }>`
          select count(*) as n from ${sql.table(table)} where org_id = ${result.orgId}::uuid and ${sql.ref(column)} is not null and ${sql.ref(column)} <> (select id from users where email = ${email})`.execute(
          db
        );
        expect(Number(wrong.rows[0]?.n), `${table}.${column}`).toBe(0);
      }
    }
    // JSON and key columns: the ids that the M7 reader and the delegation links use are the new ones.
    const mailbox = await db
      .selectFrom("mailboxes")
      .select("id")
      .where("org_id", "=", result.orgId)
      .executeTakeFirstOrThrow();
    const newDelegation = await db
      .selectFrom("delegations")
      .select(["id", "send_action_id"])
      .where("org_id", "=", result.orgId)
      .executeTakeFirstOrThrow();
    const audit = await sql<{
      id: string;
    }>`select data->>'mailbox_id' as id from audit_log where org_id = ${result.orgId}::uuid and data ? 'mailbox_id'`.execute(
      db
    );
    expect(audit.rows.map((row) => row.id)).toEqual([mailbox.id]);
    const payloads = await sql<{
      id: string;
    }>`select payload->>'delegation_id' as id from actions where org_id = ${result.orgId}::uuid`.execute(db);
    expect(payloads.rows.map((row) => row.id)).toEqual([newDelegation.id, newDelegation.id]);
    const approval = await db
      .selectFrom("outbox")
      .select("dedup_key")
      .where("org_id", "=", result.orgId)
      .executeTakeFirstOrThrow();
    expect(approval.dedup_key).toBe(`approval:${newDelegation.send_action_id}`);
    const approvedAudit = await sql<{
      a: string;
    }>`select data->>'action_id' as a, actor from audit_log where org_id = ${result.orgId}::uuid and event = 'action.approved'`.execute(
      db
    );
    expect(approvedAudit.rows[0]?.a).toBe(newDelegation.send_action_id);
    // The token counts came along.
    const tokens = await db
      .selectFrom("triage_results")
      .select(["tokens_in", "tokens_out"])
      .where("org_id", "=", result.orgId)
      .execute();
    expect(tokens.every((row) => row.tokens_in === 11 && row.tokens_out === 7)).toBe(true);

    // The source org and the third org are the same.
    expect(await idsOf(fx.orgId)).toEqual(sourceBefore);
    expect(await idsOf(third.orgId)).toEqual(thirdBefore);
  });

  test("5: the imported org never syncs or sends: the open action is expired, the mailbox is paused, no chat link, no real secret", async () => {
    const fx = await buildFixture();
    const seed = elsewhere(await exportOf(fx));
    const email = owner();
    const { orgId } = await importDemo(db, seed, { ownerEmail: email, replace: false, sendScope: SEND_OFF, now: NOW });

    const org = await db
      .selectFrom("organizations")
      .select(["name", "plan", "trial_ends_at"])
      .where("id", "=", orgId)
      .executeTakeFirstOrThrow();
    expect(org).toMatchObject({ name: IMPORT_ORG_NAME, plan: "active", trial_ends_at: null });
    const actions = await db
      .selectFrom("actions")
      .select(["type", "status", "status_reason", "locked_at"])
      .where("org_id", "=", orgId)
      .orderBy("type")
      .execute();
    expect(actions.map((row) => [row.type, row.status])).toEqual([
      ["create_draft", "applied"],
      ["send", "expired"],
    ]);
    expect(actions[1]?.status_reason).toBe("demo_import");
    const mailbox = await db
      .selectFrom("mailboxes")
      .select(["status", "address", "auth_reason", "send_via"])
      .where("org_id", "=", orgId)
      .executeTakeFirstOrThrow();
    expect(mailbox).toMatchObject({ status: "paused", address: fx.address, auth_reason: null });
    const credentials = await db
      .selectFrom("mailbox_credentials")
      .select(["encrypted_secret", "secret_kind"])
      .where("org_id", "=", orgId)
      .execute();
    expect(credentials).toEqual([{ encrypted_secret: "demo-import-no-secret", secret_kind: "password" }]);
    expect(JSON.stringify(await rowCounts(orgId))).toContain('"chat_links":0');
    const links = await sql<{ n: string }>`select count(*) as n from chat_links where org_id = ${orgId}::uuid`.execute(
      db
    );
    expect(Number(links.rows[0]?.n)).toBe(0);
    const tokens = await sql<{
      n: string;
    }>`select count(*) as n from chat_link_tokens where org_id = ${orgId}::uuid`.execute(db);
    expect(Number(tokens.rows[0]?.n)).toBe(0);
    // The mail that was still pending is skipped, so no worker takes it.
    const open = await db
      .selectFrom("emails")
      .select("status")
      .where("org_id", "=", orgId)
      .where("status", "in", ["pending", "processing"])
      .execute();
    expect(open).toEqual([]);
    // One member: the owner with the email of the call, a new user.
    const members = await sql<{
      email: string;
      role: string;
    }>`select u.email, m.role from memberships m join users u on u.id = m.user_id where m.org_id = ${orgId}::uuid`.execute(
      db
    );
    expect(members.rows).toEqual([{ email, role: "owner" }]);
    // No outbox row waits to be sent.
    const waiting = await db
      .selectFrom("outbox")
      .select("status")
      .where("org_id", "=", orgId)
      .where("status", "not in", ["sent", "failed"])
      .execute();
    expect(waiting).toEqual([]);
  });

  test("5b: an existing user becomes the owner; no second user is made", async () => {
    const fx = await buildFixture();
    const seed = elsewhere(await exportOf(fx));
    const before = await snapshot();
    const { orgId } = await importDemo(db, seed, {
      ownerEmail: fx.ownerEmail,
      replace: false,
      sendScope: SEND_OFF,
      now: NOW,
    });
    expect((await snapshot()).users).toBe(before.users);
    const members = await sql<{
      id: string;
    }>`select user_id as id from memberships where org_id = ${orgId}::uuid`.execute(db);
    expect(members.rows).toEqual([{ id: fx.userId }]);
    // The source org still has its owner and all rows.
    expect((await rowCounts(fx.orgId)).memberships).toBe(1);
  });

  test("6: a second import is refused; with replace it is replaced and one import org is left", async () => {
    const fx = await buildFixture();
    const seed = elsewhere(await exportOf(fx));
    const email = owner();
    const first = await importDemo(db, seed, { ownerEmail: email, replace: false, sendScope: SEND_OFF, now: NOW });
    const before = await snapshot();
    expect((await importRefusal(elsewhere(seed), { ownerEmail: email })).code).toBe("import_exists");
    expect(await snapshot()).toEqual(before);

    const second = await importDemo(db, elsewhere(seed), {
      ownerEmail: email,
      replace: true,
      sendScope: SEND_OFF,
      now: NOW,
    });
    expect(second.orgId).not.toBe(first.orgId);
    expect((await rowCounts(first.orgId)).organizations).toBe(0);
    expect(Object.values(await rowCounts(first.orgId)).every((n) => n === 0)).toBe(true);
    const named = await sql<{ id: string }>`select id from organizations where name = ${IMPORT_ORG_NAME}`.execute(db);
    expect(named.rows).toEqual([{ id: second.orgId }]);
    // One user for the owner email, not two.
    const users = await sql<{ n: string }>`select count(*) as n from users where email = ${email}`.execute(db);
    expect(Number(users.rows[0]?.n)).toBe(1);
  });

  test("6b: replace deletes only a clear earlier import: another member, another mailbox or two orgs with the name refuse, and nothing is deleted", async () => {
    const fx = await buildFixture();
    const seed = elsewhere(await exportOf(fx));
    const email = owner();
    const first = await importDemo(db, seed, { ownerEmail: email, replace: false, sendScope: SEND_OFF, now: NOW });
    const before = await snapshot();

    // Another member in the org that carries the import name: it may be a real org.
    const added = await addMember(
      db,
      { orgId: first.orgId },
      {
        email: `${MARK}-real-${randomUUID()}@x.test`,
        displayName: "Real",
        role: "assistant",
        locale: "en",
        actor: "test",
        now: NOW,
      }
    );
    if (added.kind !== "added") throw new Error("the member was not added");
    const withMember = await snapshot();
    expect(withMember.users).toBe(before.users + 1);
    expect((await importRefusal(elsewhere(seed), { ownerEmail: email, replace: true })).code).toBe("replace_refused");
    expect(await snapshot()).toEqual(withMember);
    await db.deleteFrom("memberships").where("org_id", "=", first.orgId).where("user_id", "=", added.userId).execute();

    // A mailbox that is not one of the seed.
    const extra = randomUUID();
    await insertMailbox(
      db,
      { orgId: first.orgId },
      {
        id: extra,
        address: `real-${randomUUID()}@realcompany.example`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: {},
      }
    );
    expect((await importRefusal(elsewhere(seed), { ownerEmail: email, replace: true })).code).toBe("replace_refused");
    await db.deleteFrom("mailboxes").where("id", "=", extra).execute();
    expect(await snapshot()).toEqual(withMember);

    // Another owner email.
    expect((await importRefusal(elsewhere(seed), { ownerEmail: owner(), replace: true })).code).toBe("replace_refused");
    expect(await snapshot()).toEqual(withMember);

    // Two orgs with the name.
    const twin = await buildFixture(IMPORT_ORG_NAME);
    expect((await importRefusal(elsewhere(seed), { ownerEmail: email, replace: true })).code).toBe("replace_ambiguous");
    expect((await rowCounts(first.orgId)).organizations).toBe(1);
    expect((await rowCounts(twin.orgId)).organizations).toBe(1);
  });

  // Only an org that looks like an import (every mailbox paused with the placeholder secret) is replaced.
  test("6c: replace refuses an org with the import name and no mailbox, a mailbox that is active, or a mailbox with a real secret", async () => {
    const fx = await buildFixture();
    const seed = elsewhere(await exportOf(fx));
    const email = owner();

    // A real org renamed to the import name: owner = the --email user, no mailbox row.
    const { orgId: bare } = await createOrganizationWithOwner(db, {
      orgName: IMPORT_ORG_NAME,
      timezone: "Europe/Warsaw",
      email,
      displayName: "Real owner",
      locale: "en",
      plan: { kind: "active" },
    });
    orgIds.push(bare);
    const before = await snapshot();
    expect((await importRefusal(elsewhere(seed), { ownerEmail: email, replace: true })).code).toBe("replace_refused");
    expect(await snapshot()).toEqual(before);
    expect((await rowCounts(bare)).organizations).toBe(1);
    await db.deleteFrom("organizations").where("id", "=", bare).execute();

    // A real import is replaced; the same org with one changed mailbox is not.
    const first = await importDemo(db, elsewhere(seed), {
      ownerEmail: email,
      replace: false,
      sendScope: SEND_OFF,
      now: NOW,
    });
    const withFirst = await snapshot();
    await db.updateTable("mailboxes").set({ status: "active" }).where("org_id", "=", first.orgId).execute();
    expect((await importRefusal(elsewhere(seed), { ownerEmail: email, replace: true })).code).toBe("replace_refused");
    await db.updateTable("mailboxes").set({ status: "paused" }).where("org_id", "=", first.orgId).execute();
    await db
      .updateTable("mailbox_credentials")
      .set({ encrypted_secret: "v1:real-looking-secret" })
      .where("org_id", "=", first.orgId)
      .execute();
    expect((await importRefusal(elsewhere(seed), { ownerEmail: email, replace: true })).code).toBe("replace_refused");
    await db.deleteFrom("mailbox_credentials").where("org_id", "=", first.orgId).execute();
    expect((await importRefusal(elsewhere(seed), { ownerEmail: email, replace: true })).code).toBe("replace_refused");
    expect(await snapshot()).toEqual(withFirst);
    expect((await rowCounts(first.orgId)).organizations).toBe(1);

    // The unchanged import is replaced.
    await db
      .insertInto("mailbox_credentials")
      .values({
        mailbox_id: (
          await db.selectFrom("mailboxes").select("id").where("org_id", "=", first.orgId).executeTakeFirstOrThrow()
        ).id,
        org_id: first.orgId,
        secret_kind: "password",
        encrypted_secret: PLACEHOLDER_SECRET,
        key_version: 1,
      })
      .execute();
    const second = await importDemo(db, elsewhere(seed), {
      ownerEmail: email,
      replace: true,
      sendScope: SEND_OFF,
      now: NOW,
    });
    expect((await rowCounts(first.orgId)).organizations).toBe(0);
    expect((await rowCounts(second.orgId)).organizations).toBe(1);
  });

  test("7: SEND_SCOPE=all is refused with nothing written, also with replace", async () => {
    const fx = await buildFixture();
    const seed = elsewhere(await exportOf(fx));
    const before = await snapshot();
    const email = owner();
    expect((await importRefusal(seed, { ownerEmail: email, sendScope: "all" })).code).toBe(
      "import_needs_safe_send_scope"
    );
    expect((await importRefusal(seed, { ownerEmail: email, sendScope: "all", replace: true })).code).toBe(
      "import_needs_safe_send_scope"
    );
    expect(await snapshot()).toEqual(before);
    const users = await sql<{ n: string }>`select count(*) as n from users where email = ${email}`.execute(db);
    expect(Number(users.rows[0]?.n)).toBe(0);
    for (const sendScope of ["off", "self"]) {
      const ok = await importDemo(db, elsewhere(seed), { ownerEmail: email, replace: true, sendScope, now: NOW });
      expect(ok.orgId).toBeDefined();
    }
  });

  test("8: an import that fails in the middle (a bad row) leaves no new org, no new user, no row; with replace the earlier import is gone", async () => {
    const fx = await buildFixture();
    const good = elsewhere(await exportOf(fx));
    const bad = elsewhere(good);
    // The shape is fine; the database refuses the value (confidence is between 0 and 1) after the org, the mailbox and the mails are in.
    (bad.tables.triage_results[3] as Record<string, unknown>).confidence = 5;
    const before = await snapshot();
    const email = owner();
    await expect(
      importDemo(db, bad, { ownerEmail: email, replace: false, sendScope: SEND_OFF, now: NOW })
    ).rejects.not.toBeInstanceOf(DemoSeedError);
    expect(await snapshot()).toEqual(before);
    const named = await sql<{
      n: string;
    }>`select count(*) as n from organizations where name = ${IMPORT_ORG_NAME}`.execute(db);
    expect(Number(named.rows[0]?.n)).toBe(0);
    const users = await sql<{ n: string }>`select count(*) as n from users where email = ${email}`.execute(db);
    expect(Number(users.rows[0]?.n)).toBe(0);

    // With replace the delete is its own transaction: the old import is gone, the failed import leaves none.
    const first = await importDemo(db, elsewhere(good), {
      ownerEmail: email,
      replace: false,
      sendScope: SEND_OFF,
      now: NOW,
    });
    await expect(
      importDemo(db, elsewhere(bad), { ownerEmail: email, replace: true, sendScope: SEND_OFF, now: NOW })
    ).rejects.not.toBeInstanceOf(DemoSeedError);
    expect((await rowCounts(first.orgId)).organizations).toBe(0);
    const left = await sql<{
      n: string;
    }>`select count(*) as n from organizations where name = ${IMPORT_ORG_NAME}`.execute(db);
    expect(Number(left.rows[0]?.n)).toBe(0);
  });

  test("9: the source org and a third org are the same after an import: ids, counts of every org_id table", async () => {
    const fx = await buildFixture();
    const third = await buildFixture();
    const seed = elsewhere(await exportOf(fx));
    const before = {
      source: await rowCounts(fx.orgId),
      third: await rowCounts(third.orgId),
      ids: [await idsOf(fx.orgId), await idsOf(third.orgId)],
    };
    const email = owner();
    const imported = await importDemo(db, seed, { ownerEmail: email, replace: false, sendScope: SEND_OFF, now: NOW });
    await importDemo(db, elsewhere(seed), { ownerEmail: email, replace: true, sendScope: SEND_OFF, now: NOW });
    expect(await rowCounts(fx.orgId)).toEqual(before.source);
    expect(await rowCounts(third.orgId)).toEqual(before.third);
    expect([await idsOf(fx.orgId), await idsOf(third.orgId)]).toEqual(before.ids);
    expect((await rowCounts(imported.orgId)).organizations).toBe(0);
  });

  test("10: refusals, each with nothing written: an org id that exists, a real host, a real address, a secret column, a table of users, a row of another org, a bad file", async () => {
    const fx = await buildFixture();
    const third = await buildFixture();
    const seed = await exportOf(fx);
    const before = await snapshot();
    const refuse = async (mutate: (copy: DemoSeed) => void, code: DemoSeedErrorCode, where?: [string, string?]) => {
      const copy = elsewhere(seed);
      mutate(copy);
      const error = await importRefusal(copy);
      expect(error.code).toBe(code);
      if (where !== undefined) expect([error.table, error.column]).toEqual(where);
      expect(await snapshot()).toEqual(before);
    };

    // The file names an org id that this database holds: refused, and the source org is untouched.
    const same = await importRefusal(seed);
    expect([same.code, same.table, same.column]).toEqual(["org_id_exists", "organizations", "id"]);
    expect(await snapshot()).toEqual(before);

    await refuse(
      (copy) => ((copy.tables.mailboxes[0] as Record<string, unknown>).imap_host = "imap.gmail.com"),
      "real_host",
      ["mailboxes", "imap_host"]
    );
    await refuse(
      (copy) => ((copy.tables.mailboxes[0] as Record<string, unknown>).smtp_host = "smtp.example.com"),
      "real_host",
      ["mailboxes", "smtp_host"]
    );
    await refuse(
      (copy) => ((copy.tables.emails[0] as Record<string, unknown>).body_text = "mail me: boss@gmail.com"),
      "non_test_address",
      ["emails", "body_text"]
    );
    // A crafted file can carry the forms too; the import scan refuses them.
    for (const body of [
      'write to "john"@gmail.com',
      "write to john@[10.0.0.1]",
      "john＠gmail.com",
      "john%40gmail.com",
    ]) {
      await refuse(
        (copy) => ((copy.tables.emails[0] as Record<string, unknown>).body_text = body),
        "non_test_address",
        ["emails", "body_text"]
      );
    }
    await refuse(
      (copy) => ((copy.tables.actions[0] as Record<string, unknown>).payload = { to: ["x@y.org"] }),
      "non_test_address",
      ["actions", "payload"]
    );
    await refuse(
      (copy) => ((copy.tables.mailboxes[0] as Record<string, unknown>).encrypted_secret = SECRET),
      "bad_seed",
      ["mailboxes", "encrypted_secret"]
    );
    await refuse(
      (copy) => ((copy.tables.emails[0] as Record<string, unknown>).from_address_lower = "a@x.test"),
      "bad_seed",
      ["emails", "from_address_lower"]
    );
    await refuse(
      (copy) => ((copy.tables as Record<string, unknown>).users = [{ id: randomUUID(), email: "a@x.test" }]),
      "bad_seed",
      ["users"]
    );
    await refuse((copy) => ((copy.tables as Record<string, unknown>).mailbox_credentials = []), "bad_seed", [
      "mailbox_credentials",
    ]);
    // A row that names another organization (the third org's id): refused, not imported into the new org.
    await refuse(
      (copy) => ((copy.tables.delegates[0] as Record<string, unknown>).org_id = third.orgId),
      "foreign_org_row",
      ["delegates", "org_id"]
    );
    await refuse((copy) => (copy.format = "ea-org-export" as never), "bad_format");
    await refuse(
      (copy) => ((copy.tables.email_headers[0] as Record<string, unknown>).email_id = randomUUID()),
      "bad_seed",
      ["email_headers", "email_id"]
    );
    await refuse((copy) => ((copy.tables.organizations[0] as Record<string, unknown>).id = "not-a-uuid"), "bad_seed", [
      "organizations",
      "id",
    ]);
    // The source org is whole.
    expect((await rowCounts(fx.orgId)).emails).toBe(5);
    expect(FIXTURE_COUNTS.emails).toBe(5);
  });

  test("10b: the unchanged file imports once the source org is gone (the file came from another database)", async () => {
    const fx = await buildFixture();
    const seed = await exportOf(fx);
    await db.deleteFrom("organizations").where("id", "=", fx.orgId).execute();
    const result = await importDemo(db, seed, { ownerEmail: owner(), replace: false, sendScope: SEND_OFF, now: NOW });
    expect(result.orgId).not.toBe(fx.orgId);
    expect(result.rows).toEqual({ ...FIXTURE_COUNTS, outbox: 1 });
  });
});
