import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { insertMailbox } from "../../src/modules/mail/repo";
import { createDb, type DB } from "../../src/platform/db";
import { checkMigrationSql } from "../../src/scripts/lib/check-migrations-rules";

import { createOrgWithMailbox, testCapabilities } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { insertLoopRow } from "./loops-fixtures";

// Sender context: the migration `20261118120001_sender_context.sql` (the tables `sender_profiles` and
// `sender_suggestions`, and the columns of `open_loops` that the contact wait uses). The connection is the `app` role;
// the Down and Up section runs as the owner.
const db = testDb();
afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const CHECK = "23514";
const UNIQUE = "23505";
const FOREIGN_KEY = "23503";
const RLS = "42501";

const migrations = join(import.meta.dir, "../../../../db/migrations");
const file = readFileSync(join(migrations, "20261118120001_sender_context.sql"), "utf8");
const [upPart = "", downPart = ""] = file.split("-- migrate:down");
const up = upPart.replace("-- migrate:up", "");

const hash = () => randomUUID().replaceAll("-", "").repeat(2);

function sqlState(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
}

// A Postgres error aborts the transaction: the savepoint lets the test go on after it.
async function expectSqlState(trx: Trx, run: () => Promise<unknown>, code: string): Promise<void> {
  await sql`savepoint sender_context_case`.execute(trx);
  let state: string | undefined;
  try {
    await run();
  } catch (error) {
    state = sqlState(error);
  }
  expect(state).toBe(code);
  await sql`rollback to savepoint sender_context_case`.execute(trx);
}

async function scopeLocal(trx: Trx, orgId: string): Promise<void> {
  await sql`select set_config('app.org_id', ${orgId}, true)`.execute(trx);
}

interface Org {
  orgId: string;
  mailboxId: string;
}

const NOW = new Date("2026-11-18T10:00:00Z");

const profile = (trx: Trx, o: Org, over: Record<string, unknown> = {}) =>
  trx
    .insertInto("sender_profiles")
    .values({
      org_id: o.orgId,
      mailbox_id: o.mailboxId,
      key_hash: hash(),
      relation: "new",
      first_seen_at: NOW,
      last_seen_at: NOW,
      ...over,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

const suggestion = (trx: Trx, o: Org, over: Record<string, unknown> = {}) =>
  trx
    .insertInto("sender_suggestions")
    .values({
      org_id: o.orgId,
      mailbox_id: o.mailboxId,
      key_hash: hash(),
      scope: "address",
      kind: "vip",
      pattern: "jan@acme.test",
      ...over,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

describe("sender_profiles: constraints", () => {
  test("1: the key is 64 lower-case hex characters, so a plain address does not fit; a hash passes", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      await expectSqlState(trx, () => profile(trx, o, { key_hash: "a@x.pl" }), CHECK);
      await expectSqlState(trx, () => profile(trx, o, { key_hash: "jan.kowalski@acme.test" }), CHECK);
      await expectSqlState(trx, () => profile(trx, o, { key_hash: "A".repeat(64) }), CHECK);
      await expectSqlState(trx, () => profile(trx, o, { key_hash: "a".repeat(63) }), CHECK);
      await expectSqlState(trx, () => profile(trx, o, { key_hash: `${"a".repeat(63)}\n` }), CHECK);
      await profile(trx, o, { key_hash: "a".repeat(64) });
    });
  });

  test("2: the defaults make a zero-count row; one row per mailbox and key; another mailbox may repeat the key", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const key = hash();
      const { id } = await profile(trx, o, { key_hash: key });
      const row = await trx.selectFrom("sender_profiles").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
      expect(row).toMatchObject({
        received: 0,
        moved_back: 0,
        answered: 0,
        flagged: 0,
        unseen_7d: 0,
        user_mails_to: 0,
        delegations_to: 0,
        by_category: {},
        corrections: {},
        bulk_signals: [],
        median_user_reply_hours: null,
        median_their_reply_hours: null,
        reply_samples_theirs: 0,
        last_user_mail_at: null,
      });
      expect(row.refreshed_at).toBeInstanceOf(Date);
      await expectSqlState(trx, () => profile(trx, o, { key_hash: key }), UNIQUE);
      const other = await createOrgWithMailbox(trx);
      await profile(trx, other, { key_hash: key });
    });
  });

  test("3: a count is never negative; a median is between 0 and 100000 hours or null", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      for (const column of [
        "received",
        "moved_back",
        "answered",
        "flagged",
        "unseen_7d",
        "user_mails_to",
        "delegations_to",
        "reply_samples_theirs",
      ])
        await expectSqlState(trx, () => profile(trx, o, { [column]: -1 }), CHECK);
      for (const column of ["median_user_reply_hours", "median_their_reply_hours"]) {
        await expectSqlState(trx, () => profile(trx, o, { [column]: -0.5 }), CHECK);
        await expectSqlState(trx, () => profile(trx, o, { [column]: 100001 }), CHECK);
        await profile(trx, o, { [column]: 0 });
        await profile(trx, o, { [column]: 36.5 });
      }
    });
  });

  test("4: the relation, the bulk signals and the category keys come from closed lists", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      await expectSqlState(trx, () => profile(trx, o, { relation: "friend" }), CHECK);
      await expectSqlState(trx, () => profile(trx, o, { bulk_signals: ["jan@acme.test"] }), CHECK);
      await expectSqlState(trx, () => profile(trx, o, { bulk_signals: ["list_id", "other"] }), CHECK);
      // An address as a key of the JSON counts is refused, as is a JSON value that is no object.
      await expectSqlState(trx, () => profile(trx, o, { by_category: JSON.stringify({ "jan@acme.test": 3 }) }), CHECK);
      await expectSqlState(trx, () => profile(trx, o, { corrections: JSON.stringify({ "jan@acme.test": 1 }) }), CHECK);
      await expectSqlState(trx, () => profile(trx, o, { by_category: JSON.stringify(["urgent"]) }), CHECK);
      // A value must be a number >= 0: a string (an address), an array, an object, null or a negative count is refused.
      for (const value of ["jan@acme.test", ["jan@acme.test"], { a: 1 }, null, -1, []]) {
        await expectSqlState(trx, () => profile(trx, o, { by_category: JSON.stringify({ urgent: value }) }), CHECK);
        await expectSqlState(trx, () => profile(trx, o, { corrections: JSON.stringify({ spam: value }) }), CHECK);
      }
      for (const relation of ["delegate", "vip", "bulk", "known", "new"]) await profile(trx, o, { relation });
      await profile(trx, o, {
        bulk_signals: ["list_id", "list_unsubscribe", "noreply", "auto_submitted"],
        by_category: JSON.stringify({ urgent: 2, needs_reply: 1, spam: 4 }),
        corrections: JSON.stringify({ info: 1, unsure: 1, delegation: 1, notification: 1 }),
      });
    });
  });

  test("5: a row has a date of incoming mail or of an own mail; a contact only written to has no first or last seen date", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      await expectSqlState(trx, () => profile(trx, o, { first_seen_at: null, last_seen_at: null }), CHECK);
      await profile(trx, o, { first_seen_at: null, last_seen_at: null, last_user_mail_at: NOW });
      await profile(trx, o, { last_user_mail_at: NOW });
    });
  });

  test("6: the mailbox must belong to the organization of the row; the row goes with its mailbox, not with another", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      await expectSqlState(trx, () => profile(trx, a, { org_id: b.orgId }), FOREIGN_KEY);
      await expectSqlState(trx, () => profile(trx, a, { mailbox_id: randomUUID() }), FOREIGN_KEY);
      await expectSqlState(trx, () => profile(trx, a, { org_id: randomUUID() }), FOREIGN_KEY);
      await expectSqlState(trx, () => suggestion(trx, a, { org_id: b.orgId }), FOREIGN_KEY);
    });
  });
});

describe("sender_suggestions: constraints", () => {
  test("7: the key is a hash; the scope, the kind and the status come from closed lists", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      await expectSqlState(trx, () => suggestion(trx, o, { key_hash: "jan@acme.test" }), CHECK);
      // The anchors: 64 hex characters and then more text (a line end, an address) are refused, as is a shorter key.
      await expectSqlState(trx, () => suggestion(trx, o, { key_hash: `${"a".repeat(64)}\n` }), CHECK);
      await expectSqlState(trx, () => suggestion(trx, o, { key_hash: `${"a".repeat(64)}@x.test` }), CHECK);
      await expectSqlState(trx, () => suggestion(trx, o, { key_hash: `x${"a".repeat(64)}` }), CHECK);
      await expectSqlState(trx, () => suggestion(trx, o, { key_hash: "A".repeat(64) }), CHECK);
      await expectSqlState(trx, () => suggestion(trx, o, { scope: "org" }), CHECK);
      await expectSqlState(trx, () => suggestion(trx, o, { kind: "mute" }), CHECK);
      await expectSqlState(trx, () => suggestion(trx, o, { status: "done", ended_at: NOW, pattern: null }), CHECK);
      for (const kind of ["vip", "whitelist", "blocklist"]) await suggestion(trx, o, { kind });
      for (const status of ["accepted", "dismissed", "withdrawn", "expired"])
        await suggestion(trx, o, { status, ended_at: NOW, pattern: null });
    });
  });

  test("8: two open suggestions with the same mailbox, scope, key and kind are refused; an open and an ended one are both stored", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const key = hash();
      await suggestion(trx, o, { key_hash: key });
      await expectSqlState(trx, () => suggestion(trx, o, { key_hash: key }), UNIQUE);
      // Another kind, another scope or another mailbox may repeat the key.
      await suggestion(trx, o, { key_hash: key, kind: "blocklist" });
      await suggestion(trx, o, { key_hash: key, scope: "domain", pattern: "@acme.test" });
      const second = await createOrgWithMailbox(trx);
      await suggestion(trx, second, { key_hash: key });
      // An ended row does not block a new open row of the same key, and two ended rows may coexist.
      await suggestion(trx, o, { key_hash: key, status: "dismissed", ended_at: NOW, pattern: null });
      await suggestion(trx, o, { key_hash: key, status: "dismissed", ended_at: NOW, pattern: null });
      const rows = await trx
        .selectFrom("sender_suggestions")
        .select(["status"])
        .where("mailbox_id", "=", o.mailboxId)
        .where("key_hash", "=", key)
        .where("kind", "=", "vip")
        .where("scope", "=", "address")
        .execute();
      expect(rows.map((row) => row.status).sort()).toEqual(["dismissed", "dismissed", "open"]);
    });
  });

  test("9: an open row has no end; an ended row has an end and no pattern; the pattern agrees with the scope", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      await expectSqlState(trx, () => suggestion(trx, o, { ended_at: NOW }), CHECK);
      await expectSqlState(trx, () => suggestion(trx, o, { status: "dismissed", pattern: null }), CHECK);
      // An ended row that still holds the address is refused: the end clears the pattern.
      await expectSqlState(trx, () => suggestion(trx, o, { status: "dismissed", ended_at: NOW }), CHECK);
      await expectSqlState(trx, () => suggestion(trx, o, { scope: "domain", pattern: "acme.test" }), CHECK);
      await expectSqlState(trx, () => suggestion(trx, o, { scope: "address", pattern: "@acme.test" }), CHECK);
      await expectSqlState(trx, () => suggestion(trx, o, { pattern: "Jan@acme.test" }), CHECK);
      await expectSqlState(trx, () => suggestion(trx, o, { pattern: "x" }), CHECK);
      // No whitespace, control character, `<` or `>`: a pasted `Jan <jan@acme.test>` or a line break is not an address.
      for (const pattern of [
        "jan @acme.test",
        "jan@acme.test ",
        "jan@acme.test\n",
        "jan\t@acme.test",
        "<jan@acme.test>",
        "jan@acme.test>",
        "jan\u0001@acme.test",
        "jan\u007f@acme.test",
      ])
        await expectSqlState(trx, () => suggestion(trx, o, { pattern }), CHECK);
      await expectSqlState(trx, () => suggestion(trx, o, { pattern: `${"a".repeat(250)}@l.test` }), CHECK);
      await suggestion(trx, o, { scope: "domain", pattern: "@acme.test" });
      await suggestion(trx, o, { pattern: "jan@acme.test", kind: "whitelist" });
    });
  });

  test("10: the reason holds counts under the fixed keys and nothing else", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      await expectSqlState(
        trx,
        () => suggestion(trx, o, { reason: JSON.stringify({ sender: "jan@acme.test" }) }),
        CHECK
      );
      await expectSqlState(trx, () => suggestion(trx, o, { reason: JSON.stringify(["received"]) }), CHECK);
      // A value must be a number >= 0 (a string, an array, an object, null or a negative count could hold an address).
      for (const value of ["jan@acme.test", ["jan@acme.test"], { a: 1 }, null, -1])
        await expectSqlState(trx, () => suggestion(trx, o, { reason: JSON.stringify({ received: value }) }), CHECK);
      await suggestion(trx, o, {
        reason: JSON.stringify({ received: 9, answered: 6, flagged: 1, corrected: 2, rescued: 3, senders: 4 }),
      });
      const { id } = await suggestion(trx, o, { kind: "whitelist" });
      const row = await trx.selectFrom("sender_suggestions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
      expect(row).toMatchObject({ reason: {}, status: "open", ended_at: null, ended_by: null });
      expect(row.created_at).toBeInstanceOf(Date);
    });
  });

  test("11: the end user may go: the suggestion stays and its ended_by is cleared", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const { id } = await suggestion(trx, o, { status: "accepted", ended_at: NOW, ended_by: o.userId, pattern: null });
      await trx.deleteFrom("memberships").where("user_id", "=", o.userId).execute();
      await trx.deleteFrom("users").where("id", "=", o.userId).execute();
      const row = await trx
        .selectFrom("sender_suggestions")
        .select("ended_by")
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      expect(row.ended_by).toBeNull();
    });
  });
});

describe("the mailbox and the organization delete", () => {
  test("12: deleting a mailbox removes its profiles and suggestions; the rows of the other mailbox stay", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const secondId = randomUUID();
      await insertMailbox(
        trx,
        { orgId: a.orgId },
        {
          id: secondId,
          address: `box2-${randomUUID()}@x.test`,
          imapHost: "imap.x.test",
          imapPort: 993,
          smtpHost: "smtp.x.test",
          smtpPort: 465,
          capabilities: testCapabilities,
          folderMap: { drafts: "Drafts" },
        }
      );
      const second: Org = { orgId: a.orgId, mailboxId: secondId };
      await profile(trx, a);
      await suggestion(trx, a);
      await profile(trx, second);
      await suggestion(trx, second);
      await trx.deleteFrom("mailboxes").where("id", "=", a.mailboxId).execute();
      const profiles = await trx
        .selectFrom("sender_profiles")
        .select("mailbox_id")
        .where("org_id", "=", a.orgId)
        .execute();
      const suggestions = await trx
        .selectFrom("sender_suggestions")
        .select("mailbox_id")
        .where("org_id", "=", a.orgId)
        .execute();
      expect(profiles.map((row) => row.mailbox_id)).toEqual([secondId]);
      expect(suggestions.map((row) => row.mailbox_id)).toEqual([secondId]);
    });
  });

  test("13: deleting the organization removes its rows through the key of the mailbox", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      await profile(trx, a);
      await suggestion(trx, a);
      await profile(trx, b);
      await suggestion(trx, b);
      await sql`select delete_organization(${a.orgId}::uuid)`.execute(trx);
      for (const table of ["sender_profiles", "sender_suggestions"] as const) {
        const left = await trx.selectFrom(table).select("org_id").where("org_id", "in", [a.orgId, b.orgId]).execute();
        expect({ table, orgs: left.map((row) => row.org_id) }).toEqual({ table, orgs: [b.orgId] });
      }
    });
  });
});

describe("row-level security: two organizations through the app role", () => {
  test("14: under the scope of organization B, A's rows are not visible, none can be written for A, none can change", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      await profile(trx, a);
      await suggestion(trx, a);
      await profile(trx, b);
      await suggestion(trx, b);
      await scopeLocal(trx, b.orgId);
      for (const table of ["sender_profiles", "sender_suggestions"] as const) {
        const rows = await trx.selectFrom(table).select("org_id").execute();
        expect({ table, orgs: rows.map((row) => row.org_id) }).toEqual({ table, orgs: [b.orgId] });
      }
      // No RETURNING: it would also need the SELECT side of the policy, and hide a missing WITH CHECK.
      await expectSqlState(
        trx,
        () =>
          trx
            .insertInto("sender_profiles")
            .values({ org_id: a.orgId, mailbox_id: a.mailboxId, key_hash: hash(), relation: "new", last_seen_at: NOW })
            .execute(),
        RLS
      );
      await expectSqlState(
        trx,
        () =>
          trx
            .insertInto("sender_suggestions")
            .values({ org_id: a.orgId, mailbox_id: a.mailboxId, key_hash: hash(), scope: "address", kind: "vip" })
            .execute(),
        RLS
      );
      const changed = await trx
        .updateTable("sender_profiles")
        .set({ received: 5 })
        .where("org_id", "=", a.orgId)
        .executeTakeFirst();
      expect(changed.numUpdatedRows).toBe(0n);
      const changedSuggestion = await trx
        .updateTable("sender_suggestions")
        .set({ kind: "blocklist" })
        .where("org_id", "=", a.orgId)
        .executeTakeFirst();
      expect(changedSuggestion.numUpdatedRows).toBe(0n);
      const deleted = await trx.deleteFrom("sender_profiles").where("org_id", "=", a.orgId).executeTakeFirst();
      expect(deleted.numDeletedRows).toBe(0n);
      const deletedSuggestion = await trx
        .deleteFrom("sender_suggestions")
        .where("org_id", "=", a.orgId)
        .executeTakeFirst();
      expect(deletedSuggestion.numDeletedRows).toBe(0n);
      // The rows of A are still there for A.
      await scopeLocal(trx, a.orgId);
      const own = await trx.selectFrom("sender_profiles").select("org_id").execute();
      expect(own.map((row) => row.org_id)).toEqual([a.orgId]);
    });
  });

  test("15: both tables have row-level security on, the one tenant policy, and the app role may use them", async () => {
    for (const table of ["sender_profiles", "sender_suggestions"]) {
      const policy = await sql<{ policyname: string; roles: string[]; qual: string; with_check: string }>`
        select policyname, roles::text[] as roles, qual, with_check from pg_policies where tablename = ${table}`.execute(
        db
      );
      expect(policy.rows).toHaveLength(1);
      expect(policy.rows[0]).toMatchObject({
        policyname: "tenant_rows",
        roles: ["app"],
        qual: "((app_current_org() IS NULL) OR (org_id = app_current_org()))",
        with_check: "((app_current_org() IS NULL) OR (org_id = app_current_org()))",
      });
      const flags = await sql<{ rls: boolean; privs: string }>`
        select c.relrowsecurity as rls,
          (select string_agg(p, ',' order by p) from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
            where has_table_privilege('app', c.oid, p)) as privs
        from pg_class c where c.relname = ${table}`.execute(db);
      expect({ table, ...flags.rows[0] }).toEqual({ table, rls: true, privs: "DELETE,INSERT,SELECT,UPDATE" });
    }
  });

  test("16: the indexes are the primary key, the unique keys and the lookups that the later stages use", async () => {
    const { rows } = await sql<{ indexname: string }>`
      select indexname from pg_indexes
      where tablename in ('sender_profiles', 'sender_suggestions') order by indexname`.execute(db);
    expect(rows.map((row) => row.indexname)).toEqual([
      "sender_profiles_mailbox_id_key_hash_key",
      "sender_profiles_org_key_idx",
      "sender_profiles_pkey",
      "sender_suggestions_mailbox_created_idx",
      "sender_suggestions_open_key",
      "sender_suggestions_org_idx",
      "sender_suggestions_pkey",
    ]);
  });

  test("17: the only free-text columns of the two tables are the hashes, the closed codes and the pattern of a suggestion", async () => {
    const { rows } = await sql<{ table_name: string; column_name: string }>`
      select table_name, column_name from information_schema.columns
      where table_name in ('sender_profiles', 'sender_suggestions')
        and (data_type in ('text', 'ARRAY', 'jsonb', 'json', 'character varying'))
      order by table_name, column_name`.execute(db);
    expect(rows.map((row) => `${row.table_name}.${row.column_name}`)).toEqual([
      "sender_profiles.bulk_signals",
      "sender_profiles.by_category",
      "sender_profiles.corrections",
      "sender_profiles.key_hash",
      "sender_profiles.relation",
      "sender_suggestions.key_hash",
      "sender_suggestions.kind",
      "sender_suggestions.pattern",
      "sender_suggestions.reason",
      "sender_suggestions.scope",
      "sender_suggestions.status",
    ]);
  });
});

describe("open_loops and the previous release", () => {
  test("18: due_source accepts contact with usual_reply_days; the days are between 1 and 60; another source is refused", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const id = await insertLoopRow(trx, o, o.mailboxId, { due_source: "contact", usual_reply_days: 2 });
      const row = await trx
        .selectFrom("open_loops")
        .select(["due_source", "usual_reply_days"])
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ due_source: "contact", usual_reply_days: 2 });
      await expectSqlState(
        trx,
        () => insertLoopRow(trx, o, o.mailboxId, { due_source: "contact", usual_reply_days: 0 }),
        CHECK
      );
      await expectSqlState(
        trx,
        () => insertLoopRow(trx, o, o.mailboxId, { due_source: "contact", usual_reply_days: 61 }),
        CHECK
      );
      await expectSqlState(trx, () => insertLoopRow(trx, o, o.mailboxId, { due_source: "guess" }), CHECK);
      await insertLoopRow(trx, o, o.mailboxId, { due_source: "contact", usual_reply_days: 1 });
      await insertLoopRow(trx, o, o.mailboxId, { due_source: "contact", usual_reply_days: 60 });
      for (const due_source of ["stated", "default"]) await insertLoopRow(trx, o, o.mailboxId, { due_source });
    });
  });

  test("19: the INSERT of the previous release (it names no usual_reply_days) still works and leaves the column null", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      // The statement of the code before this migration: the columns that the loops repository writes, with no new one.
      const { rows } = await sql<{ id: string }>`
        INSERT INTO open_loops (org_id, mailbox_id, kind, thread_key, language, due_at, due_source, wait_from_at)
        VALUES (${o.orgId}, ${o.mailboxId}, 'waiting', ${`<${randomUUID()}@x.test>`}, 'en', now(), 'stated', now())
        RETURNING id`.execute(trx);
      const row = await trx
        .selectFrom("open_loops")
        .select("usual_reply_days")
        .where("id", "=", rows[0]?.id ?? "")
        .executeTakeFirstOrThrow();
      expect(row.usual_reply_days).toBeNull();
      const column = await sql<{ is_nullable: string; column_default: string | null; data_type: string }>`
        select is_nullable, column_default, data_type from information_schema.columns
        where table_name = 'open_loops' and column_name = 'usual_reply_days'`.execute(trx);
      expect(column.rows[0]).toEqual({ is_nullable: "YES", column_default: null, data_type: "smallint" });
    });
  });
});

describe("the Down and Up sections", () => {
  async function withOwner(run: (trx: Trx) => Promise<void>): Promise<void> {
    const url = process.env.MIGRATOR_DATABASE_URL;
    if (!url) throw new Error("MIGRATOR_DATABASE_URL is missing: the owner role runs the Down and Up sections");
    const owner = createDb(url);
    try {
      await withRollback(owner, run);
    } finally {
      await owner.destroy();
    }
  }

  const present = async (trx: Trx) => {
    const { rows } = await sql<{ tables: number; columns: number }>`
      select
        (select count(*)::int from pg_tables where schemaname = 'public'
          and tablename in ('sender_profiles', 'sender_suggestions')) as tables,
        (select count(*)::int from information_schema.columns
          where table_name = 'open_loops' and column_name = 'usual_reply_days') as columns`.execute(trx);
    return rows[0];
  };

  test("20: Down rewrites contact loops to default, drops the tables and the column, and narrows the list; Up makes them again", async () => {
    await withOwner(async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const contact = await insertLoopRow(trx, o, o.mailboxId, { due_source: "contact", usual_reply_days: 3 });
      const stated = await insertLoopRow(trx, o, o.mailboxId, { due_source: "stated" });
      await profile(trx, o);
      await suggestion(trx, o);
      expect(await present(trx)).toEqual({ tables: 2, columns: 1 });

      await sql.raw(downPart).execute(trx);
      expect(await present(trx)).toEqual({ tables: 0, columns: 0 });
      // The loops stay; the contact loop reads as the old code expects: the source `default` and the same due date.
      const loops = await trx
        .selectFrom("open_loops")
        .select(["id", "due_source"])
        .where("id", "in", [contact, stated])
        .execute();
      expect(Object.fromEntries(loops.map((row) => [row.id, row.due_source]))).toEqual({
        [contact]: "default",
        [stated]: "stated",
      });
      // The old list is back: `contact` is refused.
      await sql`savepoint after_down`.execute(trx);
      let state: string | undefined;
      try {
        await insertLoopRow(trx, o, o.mailboxId, { due_source: "contact" });
      } catch (error) {
        state = sqlState(error);
      }
      expect(state).toBe(CHECK);
      await sql`rollback to savepoint after_down`.execute(trx);

      await sql.raw(up).execute(trx);
      expect(await present(trx)).toEqual({ tables: 2, columns: 1 });
      await insertLoopRow(trx, o, o.mailboxId, { due_source: "contact", usual_reply_days: 1 });
      await profile(trx, o);
      await suggestion(trx, o);
    });
  });

  test("21: the rollback statement for a code rollback (no schema Down) clears the contact loops of the new release", async () => {
    await withOwner(async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const contact = await insertLoopRow(trx, o, o.mailboxId, { due_source: "contact", usual_reply_days: 4 });
      // The statement of an earlier release: the old release parses `due_source` as `stated` or `default`.
      const rollback =
        /UPDATE open_loops SET due_source = 'default', usual_reply_days = NULL WHERE due_source = 'contact';/.exec(
          file
        );
      expect(rollback).not.toBeNull();
      await sql.raw(rollback?.[0] ?? "").execute(trx);
      const row = await trx
        .selectFrom("open_loops")
        .select(["due_source", "usual_reply_days"])
        .where("id", "=", contact)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ due_source: "default", usual_reply_days: null });
    });
  });
});

describe("the migration file", () => {
  test("22: db:check-migrations finds nothing in the file; no contract line; the old tables change only in the loops list and one column", () => {
    expect(checkMigrationSql(file)).toEqual([]);
    expect(upPart).not.toContain("-- contract:");
    const statements = upPart
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    // Expand only: no UPDATE or DELETE of old rows; the only old table that changes is `open_loops`.
    expect(statements).not.toMatch(/^\s*(UPDATE|DELETE FROM|INSERT INTO)\b/im);
    const altered = [...statements.matchAll(/ALTER TABLE (\w+)/g)].map((match) => match[1]);
    expect(altered.filter((name) => name !== "sender_profiles" && name !== "sender_suggestions")).toEqual([
      "open_loops",
      "open_loops",
      "open_loops",
    ]);
    expect(statements).toContain("CHECK (due_source IN ('stated', 'default', 'contact'))");
  });

  test("23: the Down part rewrites contact rows before it narrows the list, and the notes line for the code rollback is in the file", () => {
    const update = downPart.indexOf("UPDATE open_loops SET due_source = 'default'");
    const narrow = downPart.indexOf("CHECK (due_source IN ('stated', 'default'))");
    expect(update).toBeGreaterThan(-1);
    expect(narrow).toBeGreaterThan(update);
    expect(upPart).toContain(
      "UPDATE open_loops SET due_source = 'default', usual_reply_days = NULL WHERE due_source = 'contact';"
    );
  });
});
