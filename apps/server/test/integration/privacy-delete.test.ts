import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { sql } from "kysely";

import { auditEvents, recordAudit } from "../../src/modules/audit";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { deleteOrganization } from "../../src/modules/privacy";
import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import { insertMembership, insertUser } from "../../src/modules/tenancy/repo";

import { insertTestEmail, testCapabilities } from "./fixtures";
import { testDb } from "./helpers";

// F106 stage 02: `deleteOrganization`. The organizations are committed (the service opens its own transaction);
// `afterEach` removes what a test leaves. The connection is the `app` role, with no tenant scope.
const db = testDb();
const NOW = new Date("2026-11-20T10:00:00Z");

const orgIds: string[] = [];
const userIds: string[] = [];
const lines: string[] = [];
const spies: ReturnType<typeof spyOn>[] = [];

beforeAll(() => {
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
  await db.destroy();
});

interface Org {
  orgId: string;
  name: string;
  userId: string;
  addresses: string[];
}

// An organization with an owner, one mailbox per address, one mail in the first mailbox and one audit row.
async function createOrg(label: string, count = 1): Promise<Org> {
  const suffix = randomUUID();
  const name = `${label} ${suffix}`;
  const { orgId, userId } = await createOrganizationWithOwner(db, {
    orgName: name,
    timezone: "Europe/Warsaw",
    email: `owner-${suffix}@x.test`,
    displayName: "Owner",
    locale: "en",
  });
  orgIds.push(orgId);
  userIds.push(userId);
  const addresses: string[] = [];
  for (let i = 0; i < count; i++) {
    const mailboxId = randomUUID();
    const address = `box${i}-${suffix}@x.test`;
    addresses.push(address);
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
    if (i === 0) await db.transaction().execute((trx) => insertTestEmail(trx, { orgId }, mailboxId));
  }
  await recordAudit(db, { orgId }, { actor: "system", event: auditEvents.mailboxPaused, data: { mailbox_id: orgId } });
  return { orgId, name, userId, addresses };
}

async function addUser(orgId: string): Promise<string> {
  const user = await insertUser(db, { email: `member-${randomUUID()}@x.test`, displayName: "Member", locale: "en" });
  userIds.push(user.id);
  await insertMembership(db, { orgId }, { userId: user.id, role: "assistant" });
  return user.id;
}

// Row counts of one organization over the tables the delete touches, and of its users.
async function snapshot(org: { orgId: string; userId: string }, extraUsers: string[] = []) {
  const count = async (table: string, column: string, id: string) =>
    (
      await sql<{
        n: number;
      }>`select count(*)::int as n from ${sql.table(table)} where ${sql.ref(column)} = ${id}::uuid`.execute(db)
    ).rows[0]?.n;
  const users = [org.userId, ...extraUsers];
  const userRows = (
    await sql<{ n: number }>`select count(*)::int as n from users where id = any(${users}::uuid[])`.execute(db)
  ).rows[0]?.n;
  return {
    organizations: await count("organizations", "id", org.orgId),
    memberships: await count("memberships", "org_id", org.orgId),
    mailboxes: await count("mailboxes", "org_id", org.orgId),
    emails: await count("emails", "org_id", org.orgId),
    audit: await count("audit_log", "org_id", org.orgId),
    users: userRows,
  };
}

describe("deleteOrganization", () => {
  test("1. a right name (trimmed, any case) deletes only that organization; other organizations and shared users stay", async () => {
    const acme = await createOrg("Acme Test", 2);
    const other = await createOrg("Other Org");
    const shared = await addUser(acme.orgId); // a user in two organizations
    await insertMembership(db, { orgId: other.orgId }, { userId: shared, role: "assistant" });
    const onlyAcme = await addUser(acme.orgId); // a user in Acme only
    const otherBefore = await snapshot(other, [shared]);
    expect(await snapshot(acme, [shared, onlyAcme])).toMatchObject({
      organizations: 1,
      memberships: 3,
      mailboxes: 2,
      emails: 1,
      audit: 1,
      users: 3,
    });

    const result = await deleteOrganization(db, {
      orgId: acme.orgId,
      confirmName: ` ${acme.name.toUpperCase()} `,
      via: "cli",
    });

    expect(result).toEqual({ kind: "deleted", mailboxAddresses: [...acme.addresses].sort() });
    // Acme is gone with its owner and its own member; the shared user stays.
    expect(await snapshot(acme, [onlyAcme])).toEqual({
      organizations: 0,
      memberships: 0,
      mailboxes: 0,
      emails: 0,
      audit: 0,
      users: 0,
    });
    expect(await snapshot(other, [shared])).toEqual(otherBefore);
    const memberships = await db.selectFrom("memberships").select("org_id").where("user_id", "=", shared).execute();
    expect(memberships).toEqual([{ org_id: other.orgId }]);
  });

  test("2. a wrong name returns name_mismatch and changes nothing; the name of another organization does not work", async () => {
    const acme = await createOrg("Acme Test");
    const other = await createOrg("Other Org");
    const acmeBefore = await snapshot(acme);
    const otherBefore = await snapshot(other);

    expect(await deleteOrganization(db, { orgId: acme.orgId, confirmName: "Acme", via: "web" })).toEqual({
      kind: "name_mismatch",
    });
    expect(await deleteOrganization(db, { orgId: acme.orgId, confirmName: "", via: "web" })).toEqual({
      kind: "name_mismatch",
    });
    // The name of the other organization with the id of this one.
    expect(await deleteOrganization(db, { orgId: acme.orgId, confirmName: other.name, via: "web" })).toEqual({
      kind: "name_mismatch",
    });
    expect(await snapshot(acme)).toEqual(acmeBefore);
    expect(await snapshot(other)).toEqual(otherBefore);
    expect(lines.join("\n")).not.toContain("org_deleted");
  });

  test("3. an unknown id is not_found; a repeat run on a deleted organization is safe and also not_found", async () => {
    const acme = await createOrg("Acme Test");
    const other = await createOrg("Other Org");
    const otherBefore = await snapshot(other);

    expect(await deleteOrganization(db, { orgId: randomUUID(), confirmName: acme.name, via: "cli" })).toEqual({
      kind: "not_found",
    });
    expect(await deleteOrganization(db, { orgId: acme.orgId, confirmName: acme.name, via: "cli" })).toMatchObject({
      kind: "deleted",
    });
    expect(await deleteOrganization(db, { orgId: acme.orgId, confirmName: acme.name, via: "cli" })).toEqual({
      kind: "not_found",
    });
    expect(await snapshot(other)).toEqual(otherBefore);
  });

  test("4. the log holds one org_deleted event with the organization id, no name and no address", async () => {
    const acme = await createOrg("Acme Test");
    await deleteOrganization(db, { orgId: acme.orgId, confirmName: acme.name, via: "web" });
    const events = lines.filter((line) => line.includes("org_deleted"));
    expect(events).toHaveLength(1);
    expect(events[0]).toContain(acme.orgId);
    const all = lines.join("\n");
    expect(all).not.toContain("Acme");
    expect(all).not.toContain("@x.test");
  });

  test("5. an invite into another organization that commits during the delete keeps its membership", async () => {
    const acme = await createOrg("Acme Test");
    const other = await createOrg("Other Org");
    const invited = await addUser(acme.orgId); // in Acme only, until the invite below commits

    // Deterministic: transaction A has inserted the membership in the other organization and holds the foreign key
    // lock on the user. The delete starts now: it must wait on the user row, not read the memberships and go on.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let inserted!: () => void;
    const isInserted = new Promise<void>((resolve) => (inserted = resolve));
    const invite = db.transaction().execute(async (trx) => {
      await insertMembership(trx, { orgId: other.orgId }, { userId: invited, role: "assistant" });
      inserted();
      await gate;
    });
    await isInserted;
    const deleting = deleteOrganization(db, { orgId: acme.orgId, confirmName: acme.name, via: "cli" });
    // Wait until a backend waits on a lock, up to 10 s.
    let waited = false;
    for (let i = 0; i < 200 && !waited; i++) {
      const waiting = await sql<{ n: string }>`
        SELECT count(*) AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND (query ILIKE '%from users u%' OR query ILIKE '%delete_organization%')`.execute(db);
      waited = Number(waiting.rows[0]?.n) > 0;
      if (!waited) await Bun.sleep(50);
    }
    expect(waited).toBe(true);
    release();
    await invite;
    expect(await deleting).toMatchObject({ kind: "deleted" });

    const memberships = await db.selectFrom("memberships").select("org_id").where("user_id", "=", invited).execute();
    expect(memberships).toEqual([{ org_id: other.orgId }]);
    expect(await db.selectFrom("users").select("id").where("id", "=", invited).execute()).toHaveLength(1);
  });
});

describe("audit data of the F106 events", () => {
  test("6. recordAudit stores flat data for the new events and refuses a nested value", async () => {
    const acme = await createOrg("Acme Test");
    const ctx = { orgId: acme.orgId };
    await recordAudit(db, ctx, {
      actor: "cli",
      event: auditEvents.orgDeleteRefused,
      data: { reason: "bad_password", via: "web" },
      at: NOW,
    });
    await recordAudit(db, ctx, {
      actor: "cli",
      event: auditEvents.dsrFind,
      data: { address_hash: "ab", mails: 2, mentions: 3, listed_delegates: 0, listed_sender_rules: 1, open_actions: 0 },
      at: NOW,
    });
    // A cast hides a nested value from the type; the guard throws and no row is written.
    const nested = { counts: { mails: 1 } } as unknown as Record<string, string>;
    await expect(
      recordAudit(db, ctx, { actor: "cli", event: auditEvents.dsrErase, data: nested, at: NOW })
    ).rejects.toThrow("not flat");
    const rows = await db
      .selectFrom("audit_log")
      .select(["event", "data"])
      .where("org_id", "=", acme.orgId)
      .where("event", "in", [auditEvents.orgDeleteRefused, auditEvents.dsrFind, auditEvents.dsrErase])
      .execute();
    expect(rows.map((row) => row.event).sort()).toEqual([auditEvents.dsrFind, auditEvents.orgDeleteRefused]);
    for (const row of rows) {
      for (const value of Object.values(row.data as Record<string, unknown>)) {
        expect(typeof value === "object" && value !== null).toBe(false);
      }
      expect(JSON.stringify(row.data)).not.toContain("@");
    }
  });
});
