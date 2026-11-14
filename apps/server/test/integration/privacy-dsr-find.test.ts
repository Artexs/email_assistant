import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Decrypter, generateX25519Identity, identityToRecipient } from "age-encryption";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { auditEvents } from "../../src/modules/audit";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { dsrAuditData, dsrCounts, dsrIsEmpty, findSubjectData, matchSubject } from "../../src/modules/privacy";
import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import { dsrAddressHash } from "../../src/platform/crypto";
import type { DB } from "../../src/platform/db";

import { insertAction, insertDelegate, insertDelegation, insertTestEmail, testCapabilities } from "./fixtures";
import { testDb } from "./helpers";

// F106 stage 07: `findSubjectData`, `dsrAddressHash` and the `org:dsr --find` CLI. The seed is committed (the find reads
// a snapshot in its own transaction); `afterEach` removes it. The connection is the `app` role.
const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const script = resolve(import.meta.dir, "../../src/scripts/org-dsr.ts");
const dir = mkdtempSync(join(tmpdir(), "f106-dsr-find-"));
const KEY = Buffer.alloc(32, 7).toString("base64");
const KEY2 = Buffer.alloc(32, 8).toString("base64");

const orgIds: string[] = [];
const userIds: string[] = [];
let identity: string;
let recipient: string;

beforeAll(async () => {
  identity = await generateX25519Identity();
  recipient = await identityToRecipient(identity);
});

afterEach(async () => {
  if (orgIds.length > 0) await db.deleteFrom("organizations").where("id", "in", orgIds).execute();
  if (userIds.length > 0) await db.deleteFrom("users").where("id", "in", userIds).execute();
  orgIds.length = 0;
  userIds.length = 0;
});

afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await db.destroy();
});

interface World {
  orgId: string;
  person: string;
  own: string;
  ownerEmail: string;
  orgName: string;
  goes: string[]; // ids of the two mails that go
  kept: string;
}

// Person `p`, mailboxes `own` and `own2`, member `owner`. Two mails go (from the person; from `own` to `own2` and the
// person). One kept mail (to the person and `q`) with an open send that names the person, a header row with an
// attachment name that holds the address, and one delegate. The first mail has a triage result.
async function seed(): Promise<World> {
  const suffix = randomUUID().slice(0, 8);
  const at = (name: string) => `${name}-${suffix}@x.test`;
  const world = await db.transaction().execute(async (trx): Promise<World> => {
    const orgName = `Org ${suffix}`;
    const { orgId, userId } = await createOrganizationWithOwner(trx, {
      orgName,
      timezone: "Europe/Warsaw",
      email: at("owner"),
      displayName: "Owner",
      locale: "en",
    });
    userIds.push(userId);
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
    const box = boxes[0] as string;
    const person = at("p");
    const first = await insertTestEmail(trx, { orgId }, box, {
      from_address: person,
      to_addresses: [at("own")],
      subject: "hello",
      body_text: "body of the first mail",
    });
    const second = await insertTestEmail(trx, { orgId }, box, {
      from_address: at("own"),
      to_addresses: [at("own2"), person],
      subject: "second",
      body_text: "body of the second mail",
    });
    const kept = await insertTestEmail(trx, { orgId }, box, {
      from_address: at("r"),
      to_addresses: [person, at("q")],
    });
    await trx
      .insertInto("triage_results")
      .values({
        org_id: orgId,
        email_id: first,
        category: "info",
        confidence: 0.9,
        reason_code: "test",
        fields: JSON.stringify({}),
      })
      .execute();
    await trx
      .insertInto("email_headers")
      .values({
        email_id: kept,
        org_id: orgId,
        attachments: JSON.stringify([{ filename: `forward from ${person} (copy).eml` }]),
        parts_known: true,
        captured_at: new Date(),
      })
      .execute();
    await insertAction(trx, { orgId }, kept, {
      type: "send",
      status: "awaiting_approval",
      payload: { to: [person] },
    });
    await insertDelegate(trx, { orgId }, { email: person, name: "Pat" });
    return { orgId, person, own: at("own"), ownerEmail: at("owner"), orgName, goes: [first, second], kept };
  });
  orgIds.push(world.orgId);
  return world;
}

async function auditRows(orgId: string) {
  return db
    .selectFrom("audit_log")
    .select(["event", "actor", "data"])
    .where("org_id", "=", orgId)
    .where("event", "=", auditEvents.dsrFind)
    .orderBy("id")
    .execute();
}

// Row counts of every table with an `org_id` column, except `audit_log`.
async function tableCounts(orgId: string): Promise<Record<string, number>> {
  const tables = await sql<{ table_name: string }>`
    select c.table_name from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'org_id' and t.table_type = 'BASE TABLE'
      and c.table_name <> 'audit_log'
    order by 1`.execute(db);
  const out: Record<string, number> = {};
  for (const { table_name } of tables.rows) {
    const rows = await sql<{ n: string }>`
      select count(*)::text as n from ${sql.table(table_name)} where org_id = ${orgId}::uuid`.execute(db);
    out[table_name] = Number(rows.rows[0]?.n);
  }
  return out;
}

async function decryptReport(path: string): Promise<Record<string, unknown>> {
  const decrypter = new Decrypter();
  decrypter.addIdentity(identity);
  return JSON.parse(await decrypter.decrypt(new Uint8Array(await readFile(path)), "text"));
}

async function run(args: string[]) {
  const proc = Bun.spawn(["bun", script, ...args], {
    cwd: repoRoot,
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  return { code, stdout: await new Response(proc.stdout).text(), stderr: await new Response(proc.stderr).text() };
}

describe("findSubjectData", () => {
  test("1. found: two mails, a to-mention, a listed delegate, an open action, and the attachments mention", async () => {
    const w = await seed();
    const result = await findSubjectData(db, { orgId: w.orgId, address: w.person.toUpperCase(), credentialsKey: KEY });
    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;
    expect(result.reportBytes).toBeNull();
    expect(result.counts.mails).toBe(2);
    expect(result.counts.mentions["emails.to_addresses"]).toBe(1);
    expect(result.counts.mentions["email_headers.attachments"]).toBe(1);
    expect(result.counts.mentions["actions.payload"]).toBe(1);
    expect(result.counts.listed.delegates).toBe(1);
    expect(result.counts.listed.sender_rules).toBe(0);
    expect(result.counts.open_actions).toBe(1);
    expect(dsrIsEmpty(result.counts)).toBe(false);
  });

  test("2. one dsr.find row: a 64-hex hash equal to dsrAddressHash, flat counts, no address", async () => {
    const w = await seed();
    await findSubjectData(db, { orgId: w.orgId, address: w.person, credentialsKey: KEY });
    const rows = await auditRows(w.orgId);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.actor).toBe("cli");
    const data = row?.data as Record<string, unknown>;
    expect(data.address_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(data.address_hash).toBe(dsrAddressHash(KEY, w.person));
    expect(data).toMatchObject({ mails: 2, listed_delegates: 1, open_actions: 1 });
    expect(JSON.stringify(row)).not.toContain(w.person);
    expect(JSON.stringify(row)).not.toContain("x.test");
  });

  test("4. a mailbox address or a member's e-mail: own_address, no audit row", async () => {
    const w = await seed();
    for (const address of [w.own, w.ownerEmail]) {
      const result = await findSubjectData(db, { orgId: w.orgId, address, credentialsKey: KEY });
      expect(result).toEqual({ kind: "own_address" });
    }
    expect(await auditRows(w.orgId)).toHaveLength(0);
  });

  test("a bad address or an unknown organization is refused with no audit row", async () => {
    const w = await seed();
    for (const address of ["p@x.test.", "p@.test", "p@x..test", "p@x.test\u200b", "ｐ@x.test", "p@x", "no at"]) {
      expect(await findSubjectData(db, { orgId: w.orgId, address, credentialsKey: KEY })).toEqual({
        kind: "bad_address",
      });
    }
    expect(await findSubjectData(db, { orgId: randomUUID(), address: w.person, credentialsKey: KEY })).toEqual({
      kind: "not_found",
    });
    expect(await auditRows(w.orgId)).toHaveLength(0);
  });

  test("5. with a report: decrypts, holds the two mail ids, mode 600, reportBytes is the file size", async () => {
    const w = await seed();
    const out = join(dir, `${randomUUID()}.age`);
    const result = await findSubjectData(db, {
      orgId: w.orgId,
      address: w.person,
      credentialsKey: KEY,
      report: { recipient, out },
    });
    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;
    const info = await stat(out);
    expect(info.mode & 0o777).toBe(0o600);
    expect(result.reportBytes).toBe(info.size);
    const report = await decryptReport(out);
    expect(report).toMatchObject({ format: "ea-dsr-report", version: 1, org_id: w.orgId, address: w.person });
    const mails = report.mails as { id: string; category: string | null; body_text: string }[];
    expect(mails.map((mail) => mail.id).sort()).toEqual([...w.goes].sort());
    expect(mails.find((mail) => mail.id === w.goes[0])?.category).toBe("info");
    expect(Object.keys(report.mentions as object)).toContain("email_headers.attachments");
    expect((report.listed as { delegates: unknown[] }).delegates).toHaveLength(1);
    expect(report.open_actions as string[]).toHaveLength(1);
    expect(await auditRows(w.orgId)).toHaveLength(1);
  });

  test("6. a report path that exists: exists, no audit row, the file is unchanged", async () => {
    const w = await seed();
    const out = join(dir, `${randomUUID()}.age`);
    await Bun.write(out, "keep me");
    const result = await findSubjectData(db, {
      orgId: w.orgId,
      address: w.person,
      credentialsKey: KEY,
      report: { recipient, out },
    });
    expect(result).toEqual({ kind: "exists" });
    expect(await readFile(out, "utf8")).toBe("keep me");
    expect(await auditRows(w.orgId)).toHaveLength(0);
  });

  test("8. every table of the organization has the same row count before and after, the audit table aside", async () => {
    const w = await seed();
    const before = await tableCounts(w.orgId);
    await findSubjectData(db, {
      orgId: w.orgId,
      address: w.person,
      credentialsKey: KEY,
      report: { recipient, out: join(dir, `${randomUUID()}.age`) },
    });
    expect(await tableCounts(w.orgId)).toEqual(before);
    expect(before.emails).toBe(3);
  });

  test("8b. the find reads in a REPEATABLE READ READ ONLY transaction: a write inside it fails", async () => {
    const w = await seed();
    const seen: { readOnly?: string; isolation?: string; scope?: string; writeCode?: unknown } = {};
    // A Db whose `transaction()` reports the mode of the transaction that `findSubjectData` opens, and tries a write in it
    // before the real callback runs (a read only transaction refuses it with SQLSTATE 25006).
    const probe = (builder: ReturnType<typeof db.transaction>): ReturnType<typeof db.transaction> =>
      new Proxy(builder, {
        get(target, prop) {
          const member = Reflect.get(target, prop, target);
          if (typeof member !== "function") return member;
          if (prop === "execute") {
            return (callback: (trx: Transaction<DB>) => Promise<unknown>) =>
              target.execute(async (trx) => {
                seen.readOnly = (
                  await sql<{ v: string }>`select current_setting('transaction_read_only') as v`.execute(trx)
                ).rows[0]?.v;
                seen.isolation = (
                  await sql<{ v: string }>`select current_setting('transaction_isolation') as v`.execute(trx)
                ).rows[0]?.v;
                seen.scope = (
                  await sql<{ v: string }>`select current_setting('app.org_id', true) as v`.execute(trx)
                ).rows[0]?.v;
                await sql`savepoint probe`.execute(trx);
                try {
                  await sql`update emails set subject = subject where org_id = ${w.orgId}::uuid`.execute(trx);
                } catch (error) {
                  seen.writeCode = (error as { code?: unknown }).code;
                  await sql`rollback to savepoint probe`.execute(trx);
                }
                return callback(trx);
              });
          }
          return (...args: unknown[]) => probe((member as (...a: unknown[]) => never).apply(target, args));
        },
      });
    const spy = new Proxy(db, {
      get(target, prop) {
        if (prop === "transaction") return () => probe(target.transaction());
        const member = Reflect.get(target, prop, target);
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
    const result = await findSubjectData(spy, { orgId: w.orgId, address: w.person, credentialsKey: KEY });
    expect(result.kind).toBe("found");
    expect(seen).toEqual({ readOnly: "on", isolation: "repeatable read", scope: w.orgId, writeCode: "25006" });
  });

  test("counts and audit data come from the match", async () => {
    const w = await seed();
    const match = await db.transaction().execute((trx) => matchSubject(trx, w.orgId, w.person));
    const counts = dsrCounts(match);
    expect(dsrAuditData("h", counts)).toMatchObject({ address_hash: "h", mails: 2, open_actions: 1 });
  });
});

describe("dsrAddressHash", () => {
  test("3. a fixed key gives a fixed value; another key gives another", () => {
    const first = dsrAddressHash(KEY, "p@x.test");
    expect(first).toBe("2daea06c3beb3375330aedca71532f9f871d0318b8d90eefdcef392462ca6352");
    expect(dsrAddressHash(KEY2, "p@x.test")).not.toBe(first);
    expect(dsrAddressHash(KEY, "q@x.test")).not.toBe(first);
  });

  test("a key that is not 32 bytes of base64 throws, and the message holds no key", () => {
    expect(() => dsrAddressHash("short", "p@x.test")).toThrow("Credentials key must be base64");
  });
});

describe("org:dsr --find CLI", () => {
  test("7. exit 0 and the count lines; stdout and stderr hold no address", async () => {
    const w = await seed();
    const out = join(dir, `${randomUUID()}.age`);
    const result = await run([
      "--org-id",
      w.orgId,
      "--address",
      w.person,
      "--find",
      "--recipient",
      recipient,
      "--out",
      out,
    ]);
    expect(result.code).toBe(0);
    const lines = result.stdout.trimEnd().split("\n");
    expect(lines).toContain("mails 2");
    expect(lines).toContain("mention emails.to_addresses 1");
    expect(lines).toContain("mention email_headers.attachments 1");
    expect(lines).toContain("listed delegates 1");
    expect(lines).toContain("listed sender_rules 0");
    expect(lines).toContain("open actions 1");
    expect(lines).toContain("chain actions 0");
    expect(lines).toContain("chain delegations 0");
    expect(lines.at(-1)).toMatch(/^report [1-9][0-9]* bytes$/);
    expect(result.stderr).toBe("");
    for (const needle of [w.person, w.orgName, w.own, "@"]) {
      expect(result.stdout + result.stderr).not.toContain(needle);
    }
    expect(await auditRows(w.orgId)).toHaveLength(1);
  });

  test("a chain: --find prints the chain actions and the delegations that an erase would delete", async () => {
    const w = await seed();
    await db.transaction().execute(async (trx) => {
      const ctx = { orgId: w.orgId };
      const mail = await trx
        .selectFrom("emails")
        .select("mailbox_id")
        .where("id", "=", w.kept)
        .executeTakeFirstOrThrow();
      const goesAction = await insertAction(trx, ctx, w.goes[0] as string, { type: "move", status: "applied" });
      const chained = await insertAction(trx, ctx, w.kept, {
        type: "move",
        status: "ready",
        dependsOnActionId: goesAction,
      });
      const other = await insertAction(trx, ctx, w.kept, { type: "create_draft", status: "applied" });
      const delegate = await insertDelegate(trx, ctx, { email: `d-${randomUUID().slice(0, 8)}@x.test` });
      await insertDelegation(trx, ctx, {
        mailboxId: mail.mailbox_id,
        emailId: w.kept,
        delegateId: delegate,
        draftActionId: other,
        sendActionId: chained,
      });
    });
    const result = await run(["--org-id", w.orgId, "--address", w.person, "--find"]);
    expect(result.code).toBe(0);
    const lines = result.stdout.trimEnd().split("\n");
    expect(lines).toContain("chain actions 1");
    expect(lines).toContain("chain delegations 1");
  });

  test("an address that matches nothing: exit 0 and a warning on stderr", async () => {
    const w = await seed();
    const result = await run(["--org-id", w.orgId, "--address", `nobody-${randomUUID()}@x.test`, "--find"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("mails 0");
    expect(result.stderr).toContain("warning: no match");
    expect(result.stderr).not.toContain("@");
  });

  test("a refusal: exit 1 and org_dsr_refused with the reason, no address", async () => {
    const w = await seed();
    const own = await run(["--org-id", w.orgId, "--address", w.own, "--find"]);
    expect(own.code).toBe(1);
    expect(own.stdout + own.stderr).toContain("org_dsr_refused");
    expect(own.stdout + own.stderr).toContain("own_address");
    expect(own.stdout + own.stderr).not.toContain(w.own);
    const bad = await run(["--org-id", w.orgId, "--address", "p@x.test.", "--find"]);
    expect(bad.code).toBe(1);
    expect(bad.stdout + bad.stderr).toContain("bad_address");
    expect(bad.stdout + bad.stderr).not.toContain("p@x.test");
    const missing = await run(["--org-id", randomUUID(), "--address", w.person, "--find"]);
    expect(missing.code).toBe(1);
    expect(missing.stdout + missing.stderr).toContain("not_found");
    expect(await auditRows(w.orgId)).toHaveLength(0);
  });

  test("a usage error: exit 2 for --recipient without --out, for no mode", async () => {
    const w = await seed();
    const half = await run(["--org-id", w.orgId, "--address", w.person, "--find", "--recipient", recipient]);
    expect(half.code).toBe(2);
    expect(half.stderr).toContain("usage: bun run org:dsr");
    expect(half.stderr).not.toContain(w.person);
    const noMode = await run(["--org-id", w.orgId, "--address", w.person]);
    expect(noMode.code).toBe(2);
    expect(await auditRows(w.orgId)).toHaveLength(0);
  });
});
