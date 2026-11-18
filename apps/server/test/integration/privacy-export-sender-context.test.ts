import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Decrypter, generateX25519Identity, identityToRecipient } from "age-encryption";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { insertSenderRule } from "../../src/modules/config/repo";
import { EXPORT_MAP, exportOrganization } from "../../src/modules/privacy";
import { senderKeyHash } from "../../src/platform/crypto";

import { ago, KEY, newOrg, NOW, secondMailbox, type Org } from "./contacts-fixtures";
import { insertDelegate, seedSenderActivity } from "./fixtures";
import { testDb } from "./helpers";

// The export of the sender context: each profile row carries the plain address where the organization still holds it, the
// suggestions go whole. The seed is committed (the export reads a snapshot in its own transaction); `afterEach` removes it.
const db = testDb();
const dir = mkdtempSync(join(tmpdir(), "f120-export-"));
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

const hashOf = (org: Org, address: string) => senderKeyHash(KEY, org.ctx.orgId, address);

async function seedOrg(): Promise<Org> {
  const org = await db.transaction().execute((trx) => newOrg(trx));
  orgIds.push(org.ctx.orgId);
  const owner = await db
    .selectFrom("memberships")
    .select("user_id")
    .where("org_id", "=", org.ctx.orgId)
    .executeTakeFirst();
  if (owner) userIds.push(owner.user_id);
  return org;
}

const profileRow = (org: Org, address: string, mailboxId = org.mailboxId) =>
  db
    .insertInto("sender_profiles")
    .values({
      org_id: org.ctx.orgId,
      mailbox_id: mailboxId,
      key_hash: hashOf(org, address),
      relation: "known",
      received: 3,
      last_seen_at: ago(5),
    })
    .execute();

async function exportRows(org: Org): Promise<Record<string, Record<string, unknown>[]>> {
  const out = join(dir, `${randomUUID()}.age`);
  const result = await exportOrganization(db, {
    orgId: org.ctx.orgId,
    recipient,
    out,
    credentialsKey: KEY,
    now: NOW,
  });
  expect(result.kind).toBe("written");
  const decrypter = new Decrypter();
  decrypter.addIdentity(identity);
  const text = await decrypter.decrypt(new Uint8Array(await readFile(out)), "text");
  const json = JSON.parse(text) as { tables: Record<string, Record<string, unknown>[]> };
  return json.tables;
}

const profileOf = (rows: Record<string, unknown>[], hash: string) => rows.find((row) => row.key_hash === hash);

describe("the export of sender profiles and suggestions", () => {
  test("1 a profile whose address is still on a mail, a Sent mail, a sender rule or a delegate has `address`", async () => {
    const org = await seedOrg();
    await db.transaction().execute(async (trx) => {
      await seedSenderActivity(trx, org.ctx, org.mailboxId, { address: "Anna@Acme.pl", mails: [{ at: ago(3) }] });
      await seedSenderActivity(trx, org.ctx, org.mailboxId, { sent: [{ at: ago(2), to: ["bob@acme.pl"] }] });
      await insertDelegate(trx, org.ctx, { email: "dele@corp.pl" });
    });
    await insertSenderRule(db, org.ctx, { mailboxId: null, pattern: "vip@rule.pl", kind: "vip" });
    for (const address of ["anna@acme.pl", "bob@acme.pl", "dele@corp.pl", "vip@rule.pl"])
      await profileRow(org, address);

    const profiles = (await exportRows(org)).sender_profiles ?? [];
    expect(profiles).toHaveLength(4);
    for (const address of ["anna@acme.pl", "bob@acme.pl", "dele@corp.pl", "vip@rule.pl"]) {
      expect(profileOf(profiles, hashOf(org, address))?.address).toBe(address);
    }
  });

  test("2 a profile whose mails are past retention and that no rule names has `address: null`; its counts are there", async () => {
    const org = await seedOrg();
    // The mail row stays, its address is gone (the retention clear of the headers).
    await db.transaction().execute(async (trx) => {
      await seedSenderActivity(trx, org.ctx, org.mailboxId, { address: "gone@acme.pl", mails: [{ at: ago(3) }] });
    });
    await db.updateTable("emails").set({ from_address: null }).where("org_id", "=", org.ctx.orgId).execute();
    await profileRow(org, "gone@acme.pl");
    // A key that no address of the organization hashes to (a key of another credentials key).
    await db
      .insertInto("sender_profiles")
      .values({
        org_id: org.ctx.orgId,
        mailbox_id: org.mailboxId,
        key_hash: senderKeyHash(Buffer.alloc(32, 9).toString("base64"), org.ctx.orgId, "gone@acme.pl"),
        relation: "known",
        received: 7,
        last_seen_at: ago(5),
      })
      .execute();

    const profiles = (await exportRows(org)).sender_profiles ?? [];
    expect(profiles).toHaveLength(2);
    for (const row of profiles) {
      expect(row.address).toBeNull();
      expect(row.received).toBeGreaterThan(0);
    }
  });

  test("3 an address that only another organization holds (a mail, a Sent mail, a rule, a delegate) never joins", async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    await db.transaction().execute(async (trx) => {
      await seedSenderActivity(trx, b.ctx, b.mailboxId, { address: "anna@acme.pl", mails: [{ at: ago(3) }] });
      await seedSenderActivity(trx, b.ctx, b.mailboxId, { sent: [{ at: ago(2), to: ["bob@acme.pl"] }] });
      await insertDelegate(trx, b.ctx, { email: "dele@corp.pl" });
    });
    await insertSenderRule(db, b.ctx, { mailboxId: null, pattern: "vip@rule.pl", kind: "vip" });
    // The key holds the organization id, so the same address has another key in each organization: the row of A is
    // found by the hash with the id of A. A lookup that read the rows of B would hash B's addresses with the id of A.
    for (const address of ["anna@acme.pl", "bob@acme.pl", "dele@corp.pl", "vip@rule.pl"]) await profileRow(a, address);
    const profiles = (await exportRows(a)).sender_profiles ?? [];
    expect(profiles).toHaveLength(4);
    for (const row of profiles) expect(row.address).toBeNull();
  });

  test("4 each exported profile row has the map columns and `address`; suggestions go whole, in every mailbox", async () => {
    const org = await seedOrg();
    const second = await db.transaction().execute((trx) => secondMailbox(trx, org));
    await profileRow(org, "anna@acme.pl", second.mailboxId);
    await db
      .insertInto("sender_suggestions")
      .values([
        {
          org_id: org.ctx.orgId,
          mailbox_id: org.mailboxId,
          key_hash: hashOf(org, "anna@acme.pl"),
          scope: "address",
          kind: "vip",
          pattern: "anna@acme.pl",
          reason: JSON.stringify({ received: 4 }),
        },
        {
          org_id: org.ctx.orgId,
          mailbox_id: second.mailboxId,
          key_hash: hashOf(org, "@acme.pl"),
          scope: "domain",
          kind: "whitelist",
          pattern: null,
          status: "dismissed",
          ended_at: NOW,
        },
      ])
      .execute();
    const tables = await exportRows(org);
    const profile = tables.sender_profiles?.[0] ?? {};
    const mapped = EXPORT_MAP.sender_profiles;
    if (mapped === undefined || !mapped.export) throw new Error("sender_profiles is not exported");
    expect(Object.keys(profile).sort()).toEqual([...mapped.columns, "address"].sort());
    const suggestions = tables.sender_suggestions ?? [];
    expect(suggestions).toHaveLength(2);
    const suggestionMap = EXPORT_MAP.sender_suggestions;
    if (suggestionMap === undefined || !suggestionMap.export) throw new Error("sender_suggestions is not exported");
    for (const row of suggestions) expect(Object.keys(row).sort()).toEqual([...suggestionMap.columns].sort());
    expect(suggestions.map((row) => row.pattern).sort()).toEqual(["anna@acme.pl", null]);
  });
});
