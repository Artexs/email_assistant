import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { Decrypter, generateX25519Identity, identityToRecipient } from "age-encryption";
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { sql } from "kysely";

import { auditEvents } from "../../src/modules/audit";
import { insertLinkToken } from "../../src/modules/channels/repo";
import {
  EXPORT_MAP,
  exportOrganization,
  isAgeRecipient,
  writeEncryptedFile,
  type OrgExportResult,
} from "../../src/modules/privacy";

import { addMember, createOrgWithMailbox, linkChat, randomChatId } from "./fixtures";
import { testDb } from "./helpers";
import { fillMailbox } from "./mailbox-rows";

// F106 stage 05: `exportOrganization` and `writeEncryptedFile`. The seed is committed (the export reads a snapshot in
// its own transaction); `afterEach` removes it. The connection is the `app` role, with no tenant scope.
const db = testDb();
const NOW = new Date("2026-11-20T10:00:00Z");
const dir = mkdtempSync(join(tmpdir(), "f106-export-"));

const orgIds: string[] = [];
const userIds: string[] = [];
const lines: string[] = [];
const spies: ReturnType<typeof spyOn>[] = [];

let identity: string;
let recipient: string;

beforeAll(async () => {
  identity = await generateX25519Identity();
  recipient = await identityToRecipient(identity);
  for (const name of ["log", "error", "warn"] as const) {
    spies.push(
      spyOn(console, name).mockImplementation((...args: unknown[]): void => {
        lines.push(args.map(String).join(" "));
      })
    );
  }
});

afterEach(async () => {
  lines.length = 0;
  if (orgIds.length > 0) await db.deleteFrom("organizations").where("id", "in", orgIds).execute();
  if (userIds.length > 0) await db.deleteFrom("users").where("id", "in", userIds).execute();
  orgIds.length = 0;
  userIds.length = 0;
});

afterAll(async () => {
  for (const spy of spies) spy.mockRestore();
  rmSync(dir, { recursive: true, force: true });
  await db.destroy();
});

interface Seed {
  orgId: string;
  mailboxId: string;
  ownerId: string;
  memberId: string;
  ownerEmail: string;
  mailboxAddress: string;
  password: string;
  sessionToken: string;
  linkTokenHash: string;
  encryptedSecret: string;
  verificationIdentifier: string;
}

// An organization with two members, a mailbox with credentials, mail, triage, actions, outbox rows, a chat link, an unused
// chat link token, and a password, a session and a reset token of the owner.
async function seedOrg(): Promise<Seed> {
  return db.transaction().execute(async (trx) => {
    const { orgId, userId: ownerId, mailboxId } = await createOrgWithMailbox(trx);
    orgIds.push(orgId);
    userIds.push(ownerId);
    const memberId = await addMember(trx, orgId);
    userIds.push(memberId);
    await fillMailbox(trx, { orgId }, mailboxId, ownerId);
    const encryptedSecret = `enc-${randomUUID()}`;
    await trx
      .updateTable("mailbox_credentials")
      .set({ encrypted_secret: encryptedSecret })
      .where("org_id", "=", orgId)
      .execute();
    await linkChat(trx, { orgId }, ownerId, randomChatId(), NOW);
    const linkTokenHash = createHash("sha256").update(randomUUID()).digest("hex");
    await insertLinkToken(
      trx,
      { orgId },
      { tokenHash: linkTokenHash, userId: ownerId, expiresAt: new Date("2026-11-20T10:15:00Z"), createdAt: NOW }
    );
    const password = `scrypt-hash-${randomUUID()}`;
    const sessionToken = `session-${randomUUID()}`;
    const verificationIdentifier = `reset-password:${randomUUID()}`;
    await sql`insert into auth_accounts (user_id, account_id, provider_id, password)
      values (${ownerId}::uuid, ${randomUUID()}, 'credential', ${password})`.execute(trx);
    await sql`insert into auth_sessions (user_id, token, expires_at)
      values (${ownerId}::uuid, ${sessionToken}, ${NOW})`.execute(trx);
    await sql`insert into auth_verifications (identifier, value, expires_at)
      values (${verificationIdentifier}, ${ownerId}, ${NOW})`.execute(trx);
    const { rows } = await sql<{ email: string; address: string }>`
      select u.email, m.address from users u, mailboxes m where u.id = ${ownerId}::uuid and m.id = ${mailboxId}::uuid`.execute(
      trx
    );
    return {
      orgId,
      mailboxId,
      ownerId,
      memberId,
      ownerEmail: rows[0]?.email ?? "",
      mailboxAddress: rows[0]?.address ?? "",
      password,
      sessionToken,
      linkTokenHash,
      encryptedSecret,
      verificationIdentifier,
    };
  });
}

// The file and its part file, when they exist.
async function leftovers(path: string): Promise<string[]> {
  const name = basename(path);
  return (await readdir(dir)).filter((entry) => entry === name || entry === `${name}.part`);
}

function outPath(): string {
  return join(dir, `${randomUUID()}.age`);
}

async function decryptFile(path: string): Promise<{ text: string; json: Record<string, unknown> }> {
  const decrypter = new Decrypter();
  decrypter.addIdentity(identity);
  const text = await decrypter.decrypt(new Uint8Array(await readFile(path)), "text");
  return { text, json: JSON.parse(text) as Record<string, unknown> };
}

function written(result: OrgExportResult): Extract<OrgExportResult, { kind: "written" }> {
  if (result.kind !== "written") throw new Error(`expected written, got ${result.kind}`);
  return result;
}

async function auditRows(orgId: string) {
  return db
    .selectFrom("audit_log")
    .select(["actor", "event", "data"])
    .where("org_id", "=", orgId)
    .where("event", "=", auditEvents.orgExported)
    .execute();
}

async function dbCount(table: string, orgId: string): Promise<number> {
  const where =
    table === "organizations"
      ? sql`id = ${orgId}::uuid`
      : table === "users"
        ? sql`id in (select user_id from memberships where org_id = ${orgId}::uuid)`
        : sql`org_id = ${orgId}::uuid`;
  const { rows } = await sql<{ n: number }>`select count(*)::int as n from ${sql.table(table)} where ${where}`.execute(
    db
  );
  return rows[0]?.n ?? 0;
}

const exportedNames = Object.entries(EXPORT_MAP)
  .filter(([, spec]) => spec.export)
  .map(([name]) => name);

describe("exportOrganization", () => {
  test("1. the file decrypts; it holds every exported table, the rows of the seed and no row of another organization", async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    const path = outPath();
    const expected: Record<string, number> = {};
    for (const name of exportedNames) expected[name] = await dbCount(name, a.orgId);
    const result = written(await exportOrganization(db, { orgId: a.orgId, recipient, out: path, now: NOW }));

    const { json, text } = await decryptFile(path);
    expect(json).toMatchObject({
      format: "ea-org-export",
      version: 1,
      org_id: a.orgId,
      exported_at: NOW.toISOString(),
    });
    const tables = json.tables as Record<string, Record<string, unknown>[]>;
    expect(Object.keys(tables)).toEqual(exportedNames);
    for (const name of exportedNames) {
      expect({ name, rows: tables[name]?.length }).toEqual({ name, rows: expected[name] });
      expect(result.rows[name]).toBe(tables[name]?.length ?? -1);
    }
    expect(tables.users).toHaveLength(2);
    for (const name of ["organizations", "mailboxes", "emails", "actions", "triage_results", "outbox", "chat_links"]) {
      expect(tables[name]?.length ?? 0).toBeGreaterThan(0);
    }
    expect(tables.users?.map((row) => Object.keys(row).sort())[0]).toEqual([
      "created_at",
      "display_name",
      "email",
      "id",
      "locale",
      "terms_accepted_at",
      "terms_version",
      "two_factor_enabled",
    ]);
    // bigint as a string, dates as ISO text.
    expect(typeof tables.emails?.[0]?.uid).toBe("string");
    expect(tables.mailboxes?.[0]?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // No row of organization B.
    for (const needle of [b.orgId, b.ownerId, b.memberId, b.ownerEmail, b.mailboxAddress]) {
      expect(text).not.toContain(needle);
    }
    expect(text).toContain(a.mailboxAddress);
  });

  test("2. the plain text holds no password, credential, session token, link token or verification identifier", async () => {
    const a = await seedOrg();
    const path = outPath();
    written(await exportOrganization(db, { orgId: a.orgId, recipient, out: path, now: NOW }));
    const { text } = await decryptFile(path);
    for (const secret of [a.password, a.encryptedSecret, a.sessionToken, a.linkTokenHash, a.verificationIdentifier]) {
      expect(text).not.toContain(secret);
    }
    // The file itself is cipher text.
    const raw = await readFile(path, "latin1");
    expect(raw).not.toContain(a.mailboxAddress);
    expect(raw.startsWith("age-encryption.org/v1")).toBe(true);
  });

  test("3. the file has mode 600 and no .part file is left", async () => {
    const a = await seedOrg();
    const path = outPath();
    written(await exportOrganization(db, { orgId: a.orgId, recipient, out: path, now: NOW }));
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await readdir(dir)).filter((name) => name.endsWith(".part"))).toEqual([]);
  });

  test("4. a second run with the same path gives exists; the first file stays the same; one audit row", async () => {
    const a = await seedOrg();
    const path = outPath();
    written(await exportOrganization(db, { orgId: a.orgId, recipient, out: path, now: NOW }));
    const before = await readFile(path);
    expect(await exportOrganization(db, { orgId: a.orgId, recipient, out: path, now: NOW })).toEqual({
      kind: "exists",
    });
    expect(Buffer.compare(before, await readFile(path))).toBe(0);
    expect(await auditRows(a.orgId)).toHaveLength(1);
    expect((await readdir(dir)).filter((name) => name.endsWith(".part"))).toEqual([]);
  });

  test("5. a failure after one table leaves no file, no .part file and no audit row", async () => {
    const a = await seedOrg();
    const path = outPath();
    await expect(
      exportOrganization(db, {
        orgId: a.orgId,
        recipient,
        out: path,
        now: NOW,
        onTable: () => {
          throw new Error("stop after one table");
        },
      })
    ).rejects.toThrow("stop after one table");
    expect(await leftovers(path)).toEqual([]);
    expect(await auditRows(a.orgId)).toHaveLength(0);
  });

  test("6. one org.exported row: actor cli, tables and rows as numbers that match the file", async () => {
    const a = await seedOrg();
    const path = outPath();
    const result = written(await exportOrganization(db, { orgId: a.orgId, recipient, out: path, now: NOW }));
    const rows = await auditRows(a.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe("cli");
    const total = Object.values(result.rows).reduce((sum, n) => sum + n, 0);
    expect(rows[0]?.data).toEqual({ tables: exportedNames.length, rows: total });
  });

  test("7. the console holds no address, no mail text and no organization name", async () => {
    const a = await seedOrg();
    const path = outPath();
    written(await exportOrganization(db, { orgId: a.orgId, recipient, out: path, now: NOW }));
    const org = await db.selectFrom("organizations").select("name").where("id", "=", a.orgId).executeTakeFirstOrThrow();
    const log = lines.join("\n");
    for (const needle of [a.ownerEmail, a.mailboxAddress, org.name, "@"]) expect(log).not.toContain(needle);
  });

  test("8. an unknown organization gives not_found and writes no file", async () => {
    const path = outPath();
    expect(await exportOrganization(db, { orgId: randomUUID(), recipient, out: path, now: NOW })).toEqual({
      kind: "not_found",
    });
    expect(await leftovers(path)).toEqual([]);
  });

  test("9. more than one batch of rows: all rows, in primary key order", async () => {
    const a = await seedOrg();
    await sql`insert into audit_log (org_id, actor, event, created_at)
      select ${a.orgId}::uuid, 'system', 'test.bulk', ${NOW} from generate_series(1, 1250)`.execute(db);
    const path = outPath();
    const before = await dbCount("audit_log", a.orgId);
    written(await exportOrganization(db, { orgId: a.orgId, recipient, out: path, now: NOW }));
    const { json } = await decryptFile(path);
    const audit = (json.tables as Record<string, { id: string }[]>).audit_log ?? [];
    expect(audit).toHaveLength(before);
    expect(audit.length).toBeGreaterThan(1250);
    const ids = audit.map((row) => BigInt(row.id));
    expect(ids).toEqual([...ids].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)));
  });
});

describe("writeEncryptedFile", () => {
  async function* failing(): AsyncGenerator<string> {
    yield `{"a":[1,2,`;
    throw new Error("source failed");
  }

  test("a chunk source that throws leaves neither the file nor the part, and rethrows", async () => {
    const path = outPath();
    await expect(writeEncryptedFile(path, recipient, failing())).rejects.toThrow("source failed");
    expect(await leftovers(path)).toEqual([]);
  });

  test("a file that appears while the writer runs is not replaced", async () => {
    const path = outPath();
    async function* late(): AsyncGenerator<string> {
      yield "one";
      await Bun.write(path, "someone else");
      yield "two";
    }
    expect(await writeEncryptedFile(path, recipient, late())).toEqual({ kind: "exists" });
    expect(await readFile(path, "utf8")).toBe("someone else");
    expect(await leftovers(`${path}.part`)).toEqual([]);
  });

  test("a part file that is not ours stays", async () => {
    const path = outPath();
    await Bun.write(`${path}.part`, "not ours");
    await expect(
      writeEncryptedFile(
        path,
        recipient,
        (async function* () {
          yield "x";
        })()
      )
    ).rejects.toThrow();
    expect(await readFile(`${path}.part`, "utf8")).toBe("not ours");
  });

  test("the text round trips", async () => {
    const path = outPath();
    const result = await writeEncryptedFile(
      path,
      recipient,
      (async function* () {
        yield "hello ";
        yield "world";
      })()
    );
    expect(result.kind).toBe("written");
    const decrypter = new Decrypter();
    decrypter.addIdentity(identity);
    expect(await decrypter.decrypt(new Uint8Array(await readFile(path)), "text")).toBe("hello world");
  });
});

describe("isAgeRecipient", () => {
  test("accepts an age public key; refuses text, a secret key and a passphrase", async () => {
    expect(isAgeRecipient(recipient)).toBe(true);
    expect(isAgeRecipient(identity)).toBe(false);
    expect(isAgeRecipient("age1notakey")).toBe(false);
    expect(isAgeRecipient("hunter2")).toBe(false);
    expect(isAgeRecipient("")).toBe(false);
  });
});
