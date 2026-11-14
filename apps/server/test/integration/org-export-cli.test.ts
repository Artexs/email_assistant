import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Decrypter, generateX25519Identity, identityToRecipient } from "age-encryption";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { createOrgWithMailbox } from "./fixtures";
import { testDb } from "./helpers";
import { fillMailbox } from "./mailbox-rows";

// F106 stage 05: `org:export` as a subprocess. D17: stdout and stderr hold ids, sizes and counts only.
const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const script = resolve(import.meta.dir, "../../src/scripts/org-export.ts");
const dir = mkdtempSync(join(tmpdir(), "f106-export-cli-"));

const orgIds: string[] = [];
const userIds: string[] = [];

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

async function createOrg() {
  const seeded = await db.transaction().execute(async (trx) => {
    const org = await createOrgWithMailbox(trx);
    await fillMailbox(trx, { orgId: org.orgId }, org.mailboxId, org.userId);
    return org;
  });
  orgIds.push(seeded.orgId);
  userIds.push(seeded.userId);
  const row = await db
    .selectFrom("organizations")
    .select("name")
    .where("id", "=", seeded.orgId)
    .executeTakeFirstOrThrow();
  const mailbox = await db
    .selectFrom("mailboxes")
    .select("address")
    .where("id", "=", seeded.mailboxId)
    .executeTakeFirstOrThrow();
  const owner = await db.selectFrom("users").select("email").where("id", "=", seeded.userId).executeTakeFirstOrThrow();
  return { orgId: seeded.orgId, name: row.name, address: mailbox.address, ownerEmail: owner.email };
}

function expectNoData(
  result: { stdout: string; stderr: string },
  org: { name: string; address: string; ownerEmail: string }
) {
  const all = result.stdout + result.stderr;
  for (const needle of [org.name, org.address, org.ownerEmail, "@"]) expect(all).not.toContain(needle);
}

describe("org:export CLI", () => {
  test("1. a good run: exit 0, a size line and one line per table, a 600 file that decrypts; no address, name or mail text", async () => {
    const org = await createOrg();
    const identity = await generateX25519Identity();
    const recipient = await identityToRecipient(identity);
    const out = join(dir, `${randomUUID()}.age`);
    const result = await run(["--org-id", org.orgId, "--recipient", recipient, "--out", out]);
    expect(result.code).toBe(0);
    const [first, ...tableLines] = result.stdout.trimEnd().split("\n");
    expect(first).toMatch(new RegExp(`^exported ${org.orgId}: [1-9][0-9]* bytes$`));
    expect(tableLines.length).toBeGreaterThan(10);
    for (const line of tableLines) expect(line).toMatch(/^[a-z_]+ [0-9]+$/);
    expect(tableLines).toContain("organizations 1");
    expect(tableLines).toContain("users 1");
    expectNoData(result, org);
    expect((await stat(out)).mode & 0o777).toBe(0o600);
    const decrypter = new Decrypter();
    decrypter.addIdentity(identity);
    const text = await decrypter.decrypt(new Uint8Array(await readFile(out)), "text");
    expect(JSON.parse(text)).toMatchObject({ format: "ea-org-export", org_id: org.orgId });
  });

  test("2. the same path again: exit 1, org_export_refused, exists; the first file stays", async () => {
    const org = await createOrg();
    const recipient = await identityToRecipient(await generateX25519Identity());
    const out = join(dir, `${randomUUID()}.age`);
    expect((await run(["--org-id", org.orgId, "--recipient", recipient, "--out", out])).code).toBe(0);
    const before = await readFile(out);
    const again = await run(["--org-id", org.orgId, "--recipient", recipient, "--out", out]);
    expect(again.code).toBe(1);
    expect(again.stderr + again.stdout).toContain("org_export_refused");
    expect(again.stderr + again.stdout).toContain("exists");
    expect(again.stdout).not.toContain("exported");
    expect(Buffer.compare(before, await readFile(out))).toBe(0);
    expectNoData(again, org);
  });

  test("3. an unknown organization: exit 1, org_export_refused, not_found, no file", async () => {
    const recipient = await identityToRecipient(await generateX25519Identity());
    const out = join(dir, `${randomUUID()}.age`);
    const result = await run(["--org-id", randomUUID(), "--recipient", recipient, "--out", out]);
    expect(result.code).toBe(1);
    expect(result.stderr + result.stdout).toContain("org_export_refused");
    expect(result.stderr + result.stdout).toContain("not_found");
    expect(await Bun.file(out).exists()).toBe(false);
  });

  test("4. a bad recipient or a missing argument: exit 2 with the usage text, nothing written", async () => {
    const org = await createOrg();
    const recipient = await identityToRecipient(await generateX25519Identity());
    const out = join(dir, `${randomUUID()}.age`);
    const badKey = await run(["--org-id", org.orgId, "--recipient", "hunter2", "--out", out]);
    expect(badKey.code).toBe(2);
    expect(badKey.stderr).toContain("usage: bun run org:export");
    const noOut = await run(["--org-id", org.orgId, "--recipient", recipient]);
    expect(noOut.code).toBe(2);
    expect(noOut.stderr).toContain("usage: bun run org:export");
    expect((await run(["--org-id", "nope", "--recipient", recipient, "--out", out])).code).toBe(2);
    expect(await Bun.file(out).exists()).toBe(false);
  });
});
