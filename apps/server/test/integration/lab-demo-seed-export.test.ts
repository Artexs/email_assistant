// The tables of the seed and the export of the demo seed.
// The shared fixture of these tests is in `lab-demo-seed-helpers.ts`.
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import {
  DEMO_TABLES,
  DemoSeedError,
  exportDemo,
  serializeDemoSeed,
  type DemoSeed,
  type DemoTable,
} from "../../src/modules/lab";
import { TABLE_SPECS } from "../../src/modules/lab/demo-seed";
import { EXPORT_MAP } from "../../src/modules/privacy";

import {
  db,
  NOW,
  removeDemoOrgs,
  PLAN,
  RUN,
  SECRET,
  buildFixture,
  FIXTURE_COUNTS,
  exportOf,
  countsOf,
  rowCounts,
  idsOf,
} from "./lab-demo-seed-helpers";
import { insertLoopActionPair, insertLoopRow } from "./loops-fixtures";

afterEach(removeDemoOrgs);
afterAll(async () => {
  await db.destroy();
});

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
