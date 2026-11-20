import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Decrypter, generateX25519Identity, identityToRecipient } from "age-encryption";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { eraseSubjectData, exportOrganization, matchSubject } from "../../src/modules/privacy";
import { createDb } from "../../src/platform/db";

import { createOrgWithMailbox } from "./fixtures";
import { testDb, TEST_CREDENTIALS_KEY } from "./helpers";

// The unsubscribe request of a sender is in the data request, the erase and the organization export.
// The seed is committed (the erase runs its own transaction); `afterEach` removes it. The connection is the `app` role.
const db = testDb();
const KEY = Buffer.alloc(32, 7).toString("base64");
const NOW = new Date("2026-11-20T10:00:00Z");
const dir = mkdtempSync(join(tmpdir(), "f110-s22-privacy-"));

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
  mailboxId: string;
  userId: string;
}

async function seedWorld(): Promise<World> {
  const world = await db.transaction().execute(async (trx) => {
    const o = await createOrgWithMailbox(trx);
    userIds.push(o.userId);
    return o;
  });
  orgIds.push(world.orgId);
  return world;
}

const domainOf = (address: string) => address.slice(address.indexOf("@") + 1);

const seedRequest = (w: World, sender: string, over: { status?: string; code?: string } = {}) =>
  db
    .insertInto("unsubscribe_requests")
    .values({
      org_id: w.orgId,
      mailbox_id: w.mailboxId,
      sender_lower: sender,
      sender_domain: domainOf(sender),
      method: "one_click",
      ...over,
    })
    .returning("id")
    .executeTakeFirstOrThrow()
    .then((row) => row.id);

const rowsOf = (w: World) =>
  db
    .selectFrom("unsubscribe_requests")
    .select(["id", "sender_lower"])
    .where("org_id", "=", w.orgId)
    .orderBy("id")
    .execute();

const match = (w: World, address: string) =>
  db.transaction().execute((trx) => matchSubject(trx, w.orgId, address, TEST_CREDENTIALS_KEY));

const erase = (w: World, address: string) =>
  eraseSubjectData(db, { orgId: w.orgId, address, confirm: address, credentialsKey: KEY, now: NOW });

describe("unsubscribe requests in a data request", () => {
  test("1: the find lists the request of the sender (any case in the address), and no other row", async () => {
    const w = await seedWorld();
    const suffix = randomUUID().slice(0, 8);
    const person = `news-${suffix}@list.test`;
    const mine = await seedRequest(w, person);
    await seedRequest(w, `other-${suffix}@list.test`);
    await seedRequest(w, `news-${suffix}@list.test.pl`);

    const found = await match(w, person.toUpperCase());
    expect(found.mentions["unsubscribe_requests.sender_lower"]).toEqual([mine]);
    // The domain alone names no person: a request for another sender of the domain is not found.
    expect(Object.keys(found.mentions)).toEqual(["unsubscribe_requests.sender_lower"]);
  });

  test("2: the erase deletes the row of the sender and keeps the others", async () => {
    const w = await seedWorld();
    const suffix = randomUUID().slice(0, 8);
    const person = `news-${suffix}@list.test`;
    const kept = await seedRequest(w, `other-${suffix}@list.test`, { status: "done", code: "http_200" });
    await seedRequest(w, person);

    const result = await erase(w, person);
    expect(result.kind).toBe("erased");
    if (result.kind !== "erased") return;
    expect(result.scrubbed["unsubscribe_requests.sender_lower"]).toBe(1);
    expect((await rowsOf(w)).map((row) => row.id)).toEqual([kept]);
    expect((await match(w, person)).mentions).toEqual({});
  });

  test("3: two senders, each with a request in one mailbox: both erasures succeed and no row of either is left", async () => {
    const w = await seedWorld();
    const suffix = randomUUID().slice(0, 8);
    const a = `a-${suffix}@list.test`;
    const b = `b-${suffix}@list.test`;
    await seedRequest(w, a, { status: "done", code: "http_200" });
    await seedRequest(w, b, { status: "failed", code: "timeout" });

    expect((await erase(w, a)).kind).toBe("erased");
    expect((await rowsOf(w)).map((row) => row.sender_lower)).toEqual([b]);
    expect((await erase(w, b)).kind).toBe("erased");
    expect(await rowsOf(w)).toEqual([]);
    // A second erase of the same sender finds nothing and ends in the same state.
    expect((await erase(w, b)).kind).toBe("erased");
  });

  test("4: another organization's request for the same address stays", async () => {
    const w = await seedWorld();
    const other = await seedWorld();
    const person = `news-${randomUUID().slice(0, 8)}@list.test`;
    await seedRequest(w, person);
    const theirs = await seedRequest(other, person);

    expect((await erase(w, person)).kind).toBe("erased");
    expect(await rowsOf(w)).toEqual([]);
    expect((await rowsOf(other)).map((row) => row.id)).toEqual([theirs]);
    expect(Object.keys((await match(other, person)).mentions)).toEqual(["unsubscribe_requests.sender_lower"]);
  });
});

describe("the org filter of the delete rule", () => {
  test("4b: an erase run as the owner role (row-level security does not apply) deletes only the rows of its own organization", async () => {
    const url = process.env.MIGRATOR_DATABASE_URL;
    if (!url) throw new Error("MIGRATOR_DATABASE_URL is missing: the owner role runs this erase");
    const owner = createDb(url);
    try {
      const w = await seedWorld();
      const other = await seedWorld();
      const person = `news-${randomUUID().slice(0, 8)}@list.test`;
      await seedRequest(w, person);
      const theirs = await seedRequest(other, person);

      const result = await eraseSubjectData(owner, {
        orgId: w.orgId,
        address: person,
        confirm: person,
        credentialsKey: KEY,
        now: NOW,
      });
      expect(result.kind).toBe("erased");
      expect(await rowsOf(w)).toEqual([]);
      expect((await rowsOf(other)).map((row) => row.id)).toEqual([theirs]);
    } finally {
      await owner.destroy();
    }
  });
});

async function decrypt(path: string): Promise<Record<string, unknown>> {
  const decrypter = new Decrypter();
  decrypter.addIdentity(identity);
  return JSON.parse(await decrypter.decrypt(new Uint8Array(await readFile(path)), "text"));
}

describe("unsubscribe requests in the organization export", () => {
  test("5: the export holds the sender, the domain, the status and the code of each request", async () => {
    const w = await seedWorld();
    const person = `news-${randomUUID().slice(0, 8)}@list.test`;
    await seedRequest(w, person, { status: "refused", code: "private_host" });
    const out = join(dir, `${randomUUID()}.age`);
    const exported = await exportOrganization(db, {
      orgId: w.orgId,
      recipient,
      out,
      credentialsKey: TEST_CREDENTIALS_KEY,
      now: NOW,
    });
    expect(exported.kind).toBe("written");
    const tables = (await decrypt(out)).tables as Record<string, Record<string, unknown>[]>;

    expect(tables.unsubscribe_requests).toHaveLength(1);
    expect(tables.unsubscribe_requests?.[0]).toMatchObject({
      sender_lower: person,
      sender_domain: "list.test",
      method: "one_click",
      status: "refused",
      code: "private_host",
      finished_at: null,
    });
  });
});
