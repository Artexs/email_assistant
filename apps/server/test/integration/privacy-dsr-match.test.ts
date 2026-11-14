import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import {
  addressRegex,
  DSR_ADDRESS_MAP,
  matchSubject,
  MESSAGE_TABLES,
  normalizeDsrAddress,
  NO_PERSONAL_TABLES,
  NOT_PERSONAL,
} from "../../src/modules/privacy";
import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";

import { insertAction, insertDelegate, insertDelegation, insertTestEmail, testCapabilities } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// F106 stage 06: the address map and `matchSubject`. Every test runs in a transaction that rolls back. The addresses
// carry a random part, because `users.email` and `mailboxes.address` are unique across the database.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

interface World {
  orgId: string;
  userId: string;
  suffix: string;
  person: string; // the third party
  own: string; // mailbox 1
  own2: string; // mailbox 2
  owner: string; // the member
  box1: string;
  box2: string;
  mail(box: string, overrides?: Parameters<typeof insertTestEmail>[3]): Promise<string>;
  at(name: string): string;
}

async function world(trx: Transaction<DB>): Promise<World> {
  const suffix = randomUUID().slice(0, 8);
  const at = (name: string) => `${name}-${suffix}@x.test`;
  const owner = at("owner");
  const { orgId, userId } = await createOrganizationWithOwner(trx, {
    orgName: `Org ${suffix}`,
    timezone: "Europe/Warsaw",
    email: owner,
    displayName: "Owner",
    locale: "en",
  });
  const boxes: string[] = [];
  for (const address of [at("own"), at("own2")]) {
    const id = randomUUID();
    boxes.push(id);
    await insertMailbox(
      trx,
      { orgId },
      {
        id,
        address,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: {},
      }
    );
    await insertInboxFolder(trx, { orgId }, id);
  }
  return {
    orgId,
    userId,
    suffix,
    person: at("p"),
    own: at("own"),
    own2: at("own2"),
    owner,
    box1: boxes[0] as string,
    box2: boxes[1] as string,
    at,
    mail: (box, overrides) => insertTestEmail(trx, { orgId }, box, overrides),
  };
}

async function addHeaders(
  trx: Transaction<DB>,
  w: World,
  emailId: string,
  values: { reply_to?: string[]; return_path?: string | null; from_name?: string | null }
): Promise<void> {
  await trx
    .insertInto("email_headers")
    .values({
      email_id: emailId,
      org_id: w.orgId,
      reply_to: values.reply_to ?? [],
      return_path: values.return_path ?? null,
      from_name: values.from_name ?? null,
      parts_known: true,
      captured_at: new Date(),
    })
    .execute();
}

// Columns that can hold an address: the name patterns of the plan, and every text, array and jsonb column of the
// message tables.
async function candidateColumns(): Promise<string[]> {
  const result = await sql<{ name: string }>`
    select c.table_name || '.' || c.column_name as name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public'
      and c.data_type in ('text', 'character varying', 'ARRAY', 'jsonb')
      and (
        c.column_name ilike '%address%' or c.column_name ilike '%email%' or c.column_name ilike 'from\\_%'
        or c.column_name ilike 'to\\_%' or c.column_name ilike '%pattern%'
        or c.table_name = any (${[...MESSAGE_TABLES]}::text[])
      )
    order by 1`.execute(db);
  return result.rows.map((row) => row.name);
}

// Every text, varchar, array and jsonb column of every table with an `org_id` column, and of `organizations` (its key
// is `id`). Read from `pg_attribute`.
async function tenantColumns(): Promise<{ table: string; name: string }[]> {
  const result = await sql<{ tbl: string; name: string }>`
    select c.relname as tbl, c.relname || '.' || a.attname as name
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid and c.relkind = 'r'
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where a.attnum > 0 and not a.attisdropped
      and (
        c.relname = 'organizations'
        or exists (select 1 from pg_attribute o where o.attrelid = c.oid and o.attname = 'org_id' and not o.attisdropped)
      )
      and (
        format_type(a.atttypid, a.atttypmod) like 'text%'
        or format_type(a.atttypid, a.atttypmod) like 'character varying%'
        or format_type(a.atttypid, a.atttypmod) like '%[]'
        or format_type(a.atttypid, a.atttypmod) = 'jsonb'
      )
    order by 2`.execute(db);
  return result.rows.map((row) => ({ table: row.tbl, name: row.name }));
}

async function realColumns(): Promise<Set<string>> {
  const result = await sql<{ name: string }>`
    select table_name || '.' || column_name as name from information_schema.columns where table_schema = 'public'`.execute(
    db
  );
  return new Set(result.rows.map((row) => row.name));
}

describe("DSR address map", () => {
  test("1. each candidate column is in exactly one of the map and NOT_PERSONAL; each entry is a real column", async () => {
    const mapped = Object.entries(DSR_ADDRESS_MAP).flatMap(([table, columns]) =>
      Object.keys(columns).map((column) => `${table}.${column}`)
    );
    const excluded = Object.keys(NOT_PERSONAL);
    const candidates = await candidateColumns();
    expect(candidates.length).toBeGreaterThan(40);

    expect(candidates.filter((name) => !mapped.includes(name) && !excluded.includes(name))).toEqual([]);
    // Stricter: every such column of every tenant table has a decision, unless its whole table has none to make.
    const tenant = await tenantColumns();
    expect(tenant.length).toBeGreaterThan(60);
    expect(
      tenant
        .filter(
          (column) =>
            !mapped.includes(column.name) && !excluded.includes(column.name) && !(column.table in NO_PERSONAL_TABLES)
        )
        .map((column) => column.name)
    ).toEqual([]);
    // A table cannot be both exempt and mapped, and each exempt table is a real tenant table with a reason.
    const tenantTables = new Set(tenant.map((column) => column.table));
    for (const [table, reason] of Object.entries(NO_PERSONAL_TABLES)) {
      expect(tenantTables.has(table)).toBe(true);
      expect(Object.keys(DSR_ADDRESS_MAP)).not.toContain(table);
      expect(reason.length).toBeGreaterThan(5);
    }
    // A display name can hold an address (owner decision): it is searched, not excluded.
    expect(DSR_ADDRESS_MAP.email_headers?.from_name).toBe("text");
    expect(excluded).not.toContain("email_headers.from_name");
    expect(candidates.filter((name) => mapped.includes(name) && excluded.includes(name))).toEqual([]);
    expect(mapped.filter((name) => excluded.includes(name))).toEqual([]);

    const real = await realColumns();
    expect([...mapped, ...excluded].filter((name) => !real.has(name))).toEqual([]);
    for (const reason of Object.values(NOT_PERSONAL)) expect(reason.length).toBeGreaterThan(5);
    // The message tables are real tables, and the plan names seven.
    expect(MESSAGE_TABLES).toHaveLength(7);
  });

  test("7. normalizeDsrAddress", () => {
    expect(normalizeDsrAddress(" P@X.Test ")).toBe("p@x.test");
    for (const bad of ["p@x", "a b@x.test", "<p@x.test>", "p@@x.test", "@x.test", "", 'a"b@x.test', "a\\b@x.test"]) {
      expect(normalizeDsrAddress(bad)).toBeNull();
    }
    // A trailing or empty domain label, a full-width letter and a zero-width space match no stored address: null.
    for (const bad of [
      "p@x.test.",
      "p@.test",
      "p@x..test",
      "p@.x.test",
      "ｐ@x.test",
      "p@x.test\u200b",
      "p\u200b@x.test",
    ]) {
      expect(normalizeDsrAddress(bad)).toBeNull();
    }
    expect(normalizeDsrAddress(`${"a".repeat(247)}@x.test`)).toBe(`${"a".repeat(247)}@x.test`); // 254 characters
    expect(normalizeDsrAddress(`${"a".repeat(248)}@x.test`)).toBeNull(); // 255 characters
  });

  // One row per form: the text, and whether `addressRegex(address)` finds the address in it.
  const PATTERN_ROWS: { address: string; text: string; hit: boolean }[] = [
    // The address between other characters: found.
    { address: "p@x.test", text: "p@x.test", hit: true },
    { address: "p@x.test", text: "write to p@x.test now", hit: true },
    { address: "p@x.test", text: "a, p@x.test, b", hit: true },
    { address: "p@x.test", text: "Pat <p@x.test>", hit: true },
    { address: "p@x.test", text: '"p@x.test"', hit: true },
    { address: "p@x.test", text: "(p@x.test)", hit: true },
    { address: "p@x.test", text: "mailto:p@x.test?subject=x", hit: true },
    { address: "p@x.test", text: "ends p@x.test.", hit: true },
    { address: "p@x.test", text: "line one\np@x.test\nline three", hit: true },
    { address: "p@x.test", text: "“p@x.test”", hit: true },
    { address: "p@x.test", text: "P@X.TEST", hit: true },
    // A key and `=` in front (an authentication result): found. A bare `=` is a longer local part (below).
    { address: "p@x.test", text: "spf=pass smtp.mailfrom=p@x.test; dkim=pass", hit: true },
    { address: "p@x.test", text: "header.from=P@X.TEST", hit: true },
    // A quote or a brace at the start of the text, or after a character that is not `atext`: punctuation, found.
    { address: "p@x.test", text: "'p@x.test'", hit: true },
    { address: "p@x.test", text: "{p@x.test}", hit: true },
    { address: "p@x.test", text: "write 'p@x.test' now", hit: true },
    { address: "p@x.test", text: "a, {p@x.test}", hit: true },
    { address: "p@x.test", text: "(\"'p@x.test'\")", hit: true },
    // The address inside a longer local part or domain: not found.
    { address: "p@x.test", text: "a{p@x.test", hit: false },
    { address: "p@x.test", text: "a'p@x.test", hit: false },
    { address: "p@x.test", text: "''p@x.test", hit: false },
    { address: "p@x.test", text: ".{p@x.test", hit: false },
    { address: "p@x.test", text: "jimp@x.test", hit: false },
    { address: "p@x.test", text: "o'p@x.test", hit: false },
    { address: "p@x.test", text: "=p@x.test", hit: false },
    { address: "p@x.test", text: "x/p@x.test", hit: false },
    { address: "p@x.test", text: "łp@x.test", hit: false },
    { address: "p@x.test", text: "p.p@x.test", hit: false },
    { address: "p@x.test", text: "p+tag@x.test", hit: false },
    { address: "p@x.test", text: "p@x.test_x", hit: false },
    { address: "p@x.test", text: "p@x.testé", hit: false },
    { address: "p@x.test", text: "p@x.test.pl", hit: false },
    { address: "p@x.test", text: "p@x.test.é", hit: false },
    { address: "p@x.test", text: "p@x.test-lab", hit: false },
    { address: "a@b.com", text: "aa@b.com", hit: false },
    { address: "a@b.com", text: "a@b.com.pl", hit: false },
    { address: "a@b.com", text: "a@b.company", hit: false },
    { address: "a@b.com", text: "a@b.com-x", hit: false },
    // Metacharacters of the address are ordinary characters.
    { address: "a.b+c@x.test", text: "write A.B+C@X.test.", hit: true },
    { address: "a.b+c@x.test", text: "axb+c@x.test", hit: false },
    { address: "a.b+c@x.test", text: "aab+c@x.test", hit: false },
    { address: "a(b|c)*{1}$^@x.test", text: "<a(b|c)*{1}$^@x.test>", hit: true },
    { address: "a(b|c)*{1}$^@x.test", text: "abc@x.test", hit: false },
  ];

  test("the pattern: one row per form (inside a longer address, between other characters, metacharacters)", async () => {
    for (const row of PATTERN_ROWS) {
      const regex = addressRegex(row.address);
      const found = (await sql<{ hit: boolean }>`select ${row.text} ~* ${regex} as hit`.execute(db)).rows[0]?.hit;
      expect({ ...row, hit: found }).toEqual(row);
      // The json pattern differs only in the escaped line breaks of a jsonb text form.
      const jsonFound = (
        await sql<{ hit: boolean }>`select ${row.text} ~* ${addressRegex(row.address, { json: true })} as hit`.execute(
          db
        )
      ).rows[0]?.hit;
      expect({ ...row, hit: jsonFound }).toEqual(row);
    }
  });

  test("the pattern also scrubs: regexp_replace with the same pattern keeps the neighbours", async () => {
    const regex = addressRegex("p@x.test");
    const scrub = async (text: string) =>
      (await sql<{ out: string }>`select regexp_replace(${text}, ${regex}, '[removed]', 'gi') as out`.execute(db))
        .rows[0]?.out;
    expect(await scrub("<p@x.test>, P@X.test. o'p@x.test p@x.testé")).toBe(
      "<[removed]>, [removed]. o'p@x.test p@x.testé"
    );
    expect(await scrub("'p@x.test' {p@x.test} a{p@x.test o'p@x.test")).toBe(
      "'[removed]' {[removed]} a{p@x.test o'p@x.test"
    );
  });
});

describe("matchSubject", () => {
  test("2. the mail rule: sender, only Reply-To, or only the organization's own addresses besides the person", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const upper = await w.mail(w.box1, { from_address: w.person.toUpperCase() });
      const between = await w.mail(w.box1, { from_address: w.own, to_addresses: [w.own2, w.person] });
      const form = await w.mail(w.box1, { from_address: w.at("noreply") });
      await addHeaders(trx, w, form, { reply_to: [w.person] });
      const group = await w.mail(w.box1, { from_address: w.at("r"), to_addresses: [w.person, w.at("q")] });
      const copy = await w.mail(w.box1, {
        from_address: w.at("r"),
        cc_addresses: [w.at(`jim${w.person.split("@")[0]}`)],
      });
      const twoReplyTo = await w.mail(w.box1, { from_address: w.at("r2") });
      await addHeaders(trx, w, twoReplyTo, { reply_to: [w.person, w.at("q")] });

      const match = await matchSubject(trx, w.orgId, w.person);
      expect(match.ownAddress).toBe(false);
      expect(match.mails.map((mail) => mail.id).sort()).toEqual([upper, between, form].sort());
      const rows = await trx
        .selectFrom("emails")
        .select(["id", "dedup_key"])
        .where(
          "id",
          "in",
          match.mails.map((m) => m.id)
        )
        .execute();
      expect(match.mails.map((mail) => mail.dedupKey).sort()).toEqual(rows.map((row) => row.dedup_key).sort());
      expect(match.mentions["emails.to_addresses"]).toEqual([group]);
      expect(match.mentions["emails.cc_addresses"]).toBeUndefined();
      expect(match.mentions["email_headers.reply_to"]).toEqual([twoReplyTo]);
      expect(copy).not.toBeNull();
      expect(match.mails.map((mail) => mail.id)).not.toContain(copy);

      // The same mail stored in both mailboxes gets the same answer.
      const a = await w.mail(w.box1, { from_address: w.own, to_addresses: [w.own2, w.person, w.at("q")] });
      const b = await w.mail(w.box2, { from_address: w.own, to_addresses: [w.own2, w.person, w.at("q")] });
      const c = await w.mail(w.box1, { from_address: w.own, to_addresses: [w.own2, w.person] });
      const d = await w.mail(w.box2, { from_address: w.own, to_addresses: [w.own2, w.person] });
      const again = await matchSubject(trx, w.orgId, w.person);
      const ids = again.mails.map((mail) => mail.id);
      expect(ids).toEqual(expect.arrayContaining([c, d]));
      expect(ids).not.toContain(a);
      expect(ids).not.toContain(b);
      expect(again.mentions["emails.to_addresses"]).toEqual([group, a, b].sort());
    });
  });

  test("an upper-case address in to or cc is found, and still counts for the mail rule", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const upper = w.person.toUpperCase();
      const toMail = await w.mail(w.box1, { from_address: w.at("r"), to_addresses: [upper, w.at("q")] });
      const ccMail = await w.mail(w.box1, { from_address: w.at("r"), cc_addresses: [w.at("q"), upper] });
      const goes = await w.mail(w.box1, { from_address: w.own.toUpperCase(), to_addresses: [w.own2, upper] });
      const match = await matchSubject(trx, w.orgId, w.person);
      expect(match.mails.map((mail) => mail.id)).toEqual([goes]);
      expect(match.mentions["emails.to_addresses"]).toEqual([toMail]);
      expect(match.mentions["emails.cc_addresses"]).toEqual([ccMail]);
    });
  });

  test("3. mentions in text and json columns of kept mails; a longer domain does not match", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const kept = (overrides?: Parameters<World["mail"]>[1]) =>
        w.mail(w.box1, { from_address: w.at("r"), ...overrides });
      const body = await kept({ body_text: `write ${w.person}.` });
      await kept({ body_text: `write ${w.person}.pl` });
      const subject = await kept({ subject: `Re: <${w.person.toUpperCase()}>` });
      const triaged = await kept();
      await trx
        .insertInto("triage_results")
        .values({
          org_id: w.orgId,
          email_id: triaged,
          category: "info",
          confidence: 0.9,
          reason_code: "direct_request",
          reason: `asks ${w.person}`,
          fields: JSON.stringify({ to: [w.person] }),
        })
        .execute();
      const actionMail = await kept();
      const failed = await insertAction(trx, { orgId: w.orgId }, actionMail, {
        type: "move",
        status: "failed",
        lastError: `bounce from ${w.person}`,
        providerResult: { note: `copy to ${w.person}` },
      });
      const headers = await kept();
      await addHeaders(trx, w, headers, { return_path: w.person });
      // A display name can be an address. Another kept mail has a plain name: no match.
      const named = await kept();
      await addHeaders(trx, w, named, { from_name: `"${w.person.toUpperCase()}"` });
      await addHeaders(trx, w, await kept(), { from_name: "Pat Smith" });
      const outboxRow = randomUUID();
      await trx
        .insertInto("outbox")
        .values({
          id: outboxRow,
          org_id: w.orgId,
          user_id: w.userId,
          kind: "mailbox_removed",
          dedup_key: `test:${randomUUID()}`,
          text: `mail from ${w.person}`,
          view: JSON.stringify({ sender: w.person }),
          next_attempt_at: new Date(),
          created_at: new Date(),
        })
        .execute();
      const delegate = await insertDelegate(trx, { orgId: w.orgId });
      const draft = await insertAction(trx, { orgId: w.orgId }, actionMail, {
        type: "create_draft",
        status: "applied",
      });
      const send = await insertAction(trx, { orgId: w.orgId }, actionMail, { type: "send", status: "failed" });
      const delegation = await insertDelegation(
        trx,
        { orgId: w.orgId },
        {
          mailboxId: w.box1,
          emailId: actionMail,
          delegateId: delegate,
          draftActionId: draft,
          sendActionId: send,
          taskSummary: `call ${w.person}`,
        }
      );

      const match = await matchSubject(trx, w.orgId, w.person);
      expect(match.mails).toEqual([]);
      expect(match.mentions).toEqual({
        "emails.body_text": [body],
        "emails.subject": [subject],
        "email_headers.from_name": [named],
        "email_headers.return_path": [headers],
        "triage_results.reason": [expect.any(String)],
        "triage_results.fields": [expect.any(String)],
        "actions.last_error": [failed],
        "actions.provider_result": [failed],
        "outbox.text": [outboxRow],
        "outbox.view": [outboxRow],
        "delegations.task_summary": [delegation],
      });
    });
  });

  test("4. open actions and chain actions", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const ctx = { orgId: w.orgId };
      const kept = await w.mail(w.box1, { from_address: w.at("r") });
      const pending = await insertAction(trx, ctx, kept, {
        type: "send",
        status: "awaiting_approval",
        payload: { to: [w.person] },
      });
      let match = await matchSubject(trx, w.orgId, w.person);
      expect(match.openActions).toEqual([pending]);
      expect(match.mentions["actions.payload"]).toEqual([pending]);

      await trx
        .updateTable("actions")
        .set({ status: "applied", applied_at: new Date(), approved_at: new Date() })
        .where("id", "=", pending)
        .execute();
      match = await matchSubject(trx, w.orgId, w.person);
      expect(match.openActions).toEqual([]);
      expect(match.mentions["actions.payload"]).toEqual([pending]);

      // On a mail that goes, a ready move is not open; an awaiting send, a draft and an applying action are.
      const goes = await w.mail(w.box1, { from_address: w.person });
      await insertAction(trx, ctx, goes, { type: "move", status: "ready" });
      expect((await matchSubject(trx, w.orgId, w.person)).openActions).toEqual([]);
      const send = await insertAction(trx, ctx, goes, { type: "send", status: "awaiting_approval" });
      const draft = await insertAction(trx, ctx, goes, { type: "create_draft", status: "ready" });
      const applying = await insertAction(trx, ctx, goes, { type: "flag", status: "applying" });
      const ended = await insertAction(trx, ctx, goes, { type: "send", status: "failed" });
      match = await matchSubject(trx, w.orgId, w.person);
      expect(match.openActions.sort()).toEqual([send, draft, applying].sort());
      expect(match.openActions).not.toContain(ended);

      // A kept mail's action that depends on an action of a mail that goes (or reverses one) is a chain action.
      // An action of the mail that goes, tied to another action of it, goes with the mail by the cascade: not a chain action.
      await insertAction(trx, ctx, goes, { type: "move", status: "ready", dependsOnActionId: send });
      const chained = await insertAction(trx, ctx, kept, { type: "move", status: "ready", dependsOnActionId: send });
      const reverse = await insertAction(trx, ctx, kept, {
        type: "move",
        status: "undone",
        reversesActionId: applying,
      });
      await insertAction(trx, ctx, kept, { type: "move", status: "ready" });
      match = await matchSubject(trx, w.orgId, w.person);
      expect(match.chainActions.sort()).toEqual([chained, reverse].sort());
    });
  });

  test("5. delegates and blocklist rules are listed, not matched as mentions; a domain rule is not listed", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const delegate = await insertDelegate(trx, { orgId: w.orgId }, { email: w.person });
      await insertDelegate(trx, { orgId: w.orgId }, { email: w.at("d2"), name: w.person.toUpperCase() });
      const rule = await trx
        .insertInto("sender_rules")
        .values({ org_id: w.orgId, pattern: w.person, kind: "blocklist" })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx.insertInto("sender_rules").values({ org_id: w.orgId, pattern: "@x.test", kind: "blocklist" }).execute();

      const match = await matchSubject(trx, w.orgId, w.person);
      expect(match.listed.delegates).toHaveLength(2);
      expect(match.listed.delegates).toContain(delegate);
      expect(match.listed.senderRules).toEqual([rule.id]);
      expect(match.mails).toEqual([]);
      expect(match.mentions).toEqual({});
    });
  });

  test("6. a mailbox address or a member's e-mail is an own address", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await w.mail(w.box1, { from_address: w.own });
      await insertDelegate(trx, { orgId: w.orgId }, { email: w.own });
      for (const address of [w.own, w.own2.toUpperCase(), w.owner]) {
        expect(await matchSubject(trx, w.orgId, address)).toEqual({
          ownAddress: true,
          mails: [],
          mentions: {},
          listed: { delegates: [], senderRules: [] },
          openActions: [],
          chainActions: [],
          chainDelegations: [],
        });
      }
      expect((await matchSubject(trx, w.orgId, w.person)).ownAddress).toBe(false);
    });
  });

  test("an address that is not an address is refused without the value in the error", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const error = await matchSubject(trx, w.orgId, "not an address").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("dsr_match_invalid_address");
    });
  });

  test("8. the rows of another organization never show", async () => {
    await withRollback(db, async (trx) => {
      const a = await world(trx);
      const b = await world(trx);
      // The same person address in both organizations.
      const person = a.person;
      await insertDelegate(trx, { orgId: b.orgId }, { email: person });
      await trx.insertInto("sender_rules").values({ org_id: b.orgId, pattern: person, kind: "vip" }).execute();
      const theirs = await b.mail(b.box1, { from_address: person, body_text: person });
      await insertAction(trx, { orgId: b.orgId }, theirs, {
        type: "send",
        status: "awaiting_approval",
        payload: { to: [person] },
      });
      await b.mail(b.box1, { from_address: b.at("r"), to_addresses: [person, b.at("q")] });

      const mine = await a.mail(a.box1, { from_address: person });
      const match = await matchSubject(trx, a.orgId, person);
      expect(match.mails.map((mail) => mail.id)).toEqual([mine]);
      expect(match.mentions).toEqual({});
      expect(match.listed).toEqual({ delegates: [], senderRules: [] });
      expect(match.openActions).toEqual([]);
      expect(match.chainActions).toEqual([]);
      // Own addresses of the other organization are not own addresses here.
      expect((await matchSubject(trx, a.orgId, b.own)).ownAddress).toBe(false);
      expect((await matchSubject(trx, a.orgId, b.owner)).ownAddress).toBe(false);
      expect((await matchSubject(trx, a.orgId, a.owner)).ownAddress).toBe(true);
    });
  });

  test("9. no row changes", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const goes = await w.mail(w.box1, { from_address: w.person, body_text: w.person });
      await insertAction(trx, { orgId: w.orgId }, goes, {
        type: "send",
        status: "awaiting_approval",
        payload: { to: [w.person] },
      });
      await w.mail(w.box1, { from_address: w.at("r"), subject: w.person });
      await insertDelegate(trx, { orgId: w.orgId }, { email: w.person });

      const tables = [...MESSAGE_TABLES, "delegates", "sender_rules", "mailboxes", "audit_log", "users", "memberships"];
      const state = async () => {
        const out: Record<string, string> = {};
        for (const table of tables) {
          const rows = await sql<{ h: string }>`
            select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as h
            from ${sql.table(table)} as t`.execute(trx);
          out[table] = rows.rows[0]?.h ?? "";
        }
        return out;
      };
      const before = await state();
      await sql`set transaction read only`.execute(trx);
      const match = await matchSubject(trx, w.orgId, w.person);
      expect(match.mails).toHaveLength(1);
      expect(await state()).toEqual(before);
    });
  });
});
