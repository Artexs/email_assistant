import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { createOrganizationWithOwner } from "../../src/modules/tenancy";

import { testCapabilities } from "./fixtures";
import { testDb } from "./helpers";

// F106 stage 02: `org:delete` as a subprocess. D17: stdout and stderr hold no organization name; the mailbox address
// lines after a delete are the one place that prints addresses.
const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const script = resolve(import.meta.dir, "../../src/scripts/org-delete.ts");

const orgIds: string[] = [];
const userIds: string[] = [];

afterEach(async () => {
  if (orgIds.length > 0) await db.deleteFrom("organizations").where("id", "in", orgIds).execute();
  if (userIds.length > 0) await db.deleteFrom("users").where("id", "in", userIds).execute();
  orgIds.length = 0;
  userIds.length = 0;
});

afterAll(async () => {
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
  const suffix = randomUUID();
  const orgName = `Secret Org ${suffix}`;
  const { orgId, userId } = await createOrganizationWithOwner(db, {
    orgName,
    timezone: "Europe/Warsaw",
    email: `org-delete-${suffix}@x.test`,
    displayName: "Owner",
  });
  orgIds.push(orgId);
  userIds.push(userId);
  const mailboxId = randomUUID();
  const address = `box-${suffix}@x.test`;
  await insertMailbox(
    db,
    { orgId },
    {
      id: mailboxId,
      address,
      imapHost: "imap.x.test",
      imapPort: 993,
      smtpHost: "smtp.x.test",
      smtpPort: 465,
      capabilities: testCapabilities,
      folderMap: {},
    }
  );
  await insertInboxFolder(db, { orgId }, mailboxId);
  return { orgId, orgName, address, ownerEmail: `org-delete-${suffix}@x.test` };
}

const orgRows = (orgId: string) => db.selectFrom("organizations").select("id").where("id", "=", orgId).execute();

function expectNoName(result: { stdout: string; stderr: string }, orgName: string) {
  expect(result.stdout).not.toContain(orgName);
  expect(result.stderr).not.toContain(orgName);
}

describe("org:delete CLI", () => {
  test("1. the right name: exit 0, the id and the mailbox address line, the organization is gone", async () => {
    const { orgId, orgName, address, ownerEmail } = await createOrg();
    const result = await run(["--org-id", orgId, "--confirm", orgName]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`deleted ${orgId}: mailboxes 1`);
    expect(result.stdout).toContain(`change the password of ${address}`);
    // The address lines are the only place with an address; no owner email, no name.
    expect(result.stdout.split("\n").filter((line) => line.includes("@"))).toEqual([
      `change the password of ${address}`,
    ]);
    expect(result.stderr).not.toContain("@");
    expect(result.stdout).not.toContain(ownerEmail);
    expectNoName(result, orgName);
    expect(await orgRows(orgId)).toHaveLength(0);
  });

  test("2. the wrong name: exit 1, the organization stays, no address and no name in the output", async () => {
    const { orgId, orgName, address } = await createOrg();
    const result = await run(["--org-id", orgId, "--confirm", "Not The Name"]);
    expect(result.code).toBe(1);
    expect(result.stderr + result.stdout).toContain("org_delete_refused");
    expect(result.stderr + result.stdout).toContain("name_mismatch");
    expect(result.stdout).not.toContain("deleted");
    expect(result.stdout + result.stderr).not.toContain(address);
    expectNoName(result, orgName);
    expect(await orgRows(orgId)).toHaveLength(1);
  });

  test("3. no --confirm or a bad id: exit 2 with the usage text", async () => {
    const { orgId } = await createOrg();
    const missing = await run(["--org-id", orgId]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("usage: bun run org:delete");
    expect((await run(["--org-id", "nope", "--confirm", "x"])).code).toBe(2);
    expect(await orgRows(orgId)).toHaveLength(1);
  });

  test("4. a repeat run on the deleted organization is safe: exit 1, not_found, no address", async () => {
    const { orgId, orgName, address } = await createOrg();
    expect((await run(["--org-id", orgId, "--confirm", orgName])).code).toBe(0);
    const again = await run(["--org-id", orgId, "--confirm", orgName]);
    expect(again.code).toBe(1);
    expect(again.stderr + again.stdout).toContain("not_found");
    expect(again.stdout).not.toContain("deleted");
    expect(again.stdout + again.stderr).not.toContain(address);
    expectNoName(again, orgName);
  });
});
