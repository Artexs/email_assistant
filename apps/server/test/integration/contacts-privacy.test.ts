import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { eraseSubjectData, matchSubject } from "../../src/modules/privacy";

import { createOrgWithMailbox } from "./fixtures";
import { testDb, TEST_CREDENTIALS_KEY } from "./helpers";

// Sender context: the address of an open rule suggestion is in the data request. A data-request erase of the
// address deletes the row (`DSR_ADDRESS_MAP`, rule `delete`), as for `unsubscribe_requests`. A domain pattern names no person
// and stays. The seed is committed (the erase runs its own transaction); `afterEach` removes it. The connection is the `app` role.
const db = testDb();
const KEY = Buffer.alloc(32, 7).toString("base64");
const NOW = new Date("2026-11-20T10:00:00Z");

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

interface World {
  orgId: string;
  mailboxId: string;
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

const hash = () => randomUUID().replaceAll("-", "").repeat(2);

const seedSuggestion = (w: World, over: { pattern?: string | null; scope?: string; kind?: string } = {}) =>
  db
    .insertInto("sender_suggestions")
    .values({ org_id: w.orgId, mailbox_id: w.mailboxId, key_hash: hash(), scope: "address", kind: "vip", ...over })
    .returning("id")
    .executeTakeFirstOrThrow()
    .then((row) => row.id);

const idsOf = (w: World) =>
  db
    .selectFrom("sender_suggestions")
    .select("id")
    .where("org_id", "=", w.orgId)
    .orderBy("id")
    .execute()
    .then((rows) => rows.map((row) => row.id));

const match = (w: World, address: string) =>
  db.transaction().execute((trx) => matchSubject(trx, w.orgId, address, TEST_CREDENTIALS_KEY));

const erase = (w: World, address: string) =>
  eraseSubjectData(db, { orgId: w.orgId, address, confirm: address, credentialsKey: KEY, now: NOW });

describe("open suggestions in a data request", () => {
  test("1: the find lists the open suggestion whose pattern is the address (any case), and no other row", async () => {
    const w = await seedWorld();
    const suffix = randomUUID().slice(0, 8);
    const person = `jan-${suffix}@acme.test`;
    const mine = await seedSuggestion(w, { pattern: person });
    await seedSuggestion(w, { pattern: `other-${suffix}@acme.test`, kind: "whitelist" });
    await seedSuggestion(w, { pattern: `jan-${suffix}@acme.test.pl`, kind: "blocklist" });
    // A domain suggestion names no person: the find does not list it.
    await seedSuggestion(w, { pattern: "@acme.test", scope: "domain", kind: "whitelist" });

    const found = await match(w, person.toUpperCase());
    expect(found.mentions["sender_suggestions.pattern"]).toEqual([mine]);
    expect(Object.keys(found.mentions)).toEqual(["sender_suggestions.pattern"]);
  });

  test("2: the erase deletes the open suggestion of the address and keeps the others, the domain row and an ended row", async () => {
    const w = await seedWorld();
    const suffix = randomUUID().slice(0, 8);
    const person = `jan-${suffix}@acme.test`;
    const other = await seedSuggestion(w, { pattern: `other-${suffix}@acme.test`, kind: "whitelist" });
    const domain = await seedSuggestion(w, { pattern: "@acme.test", scope: "domain", kind: "blocklist" });
    const ended = await db
      .insertInto("sender_suggestions")
      .values({
        org_id: w.orgId,
        mailbox_id: w.mailboxId,
        key_hash: hash(),
        scope: "address",
        kind: "vip",
        pattern: null,
        status: "dismissed",
        ended_at: NOW,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await seedSuggestion(w, { pattern: person });

    const result = await erase(w, person);
    expect(result.kind).toBe("erased");
    if (result.kind !== "erased") return;
    expect(result.scrubbed["sender_suggestions.pattern"]).toBe(1);
    expect(await idsOf(w)).toEqual([other, domain, ended.id].sort());
    expect((await match(w, person)).mentions).toEqual({});
    // A second erase of the same address ends in the same state.
    expect((await erase(w, person)).kind).toBe("erased");
  });

  test("3: another organization's suggestion for the same address stays", async () => {
    const w = await seedWorld();
    const other = await seedWorld();
    const person = `jan-${randomUUID().slice(0, 8)}@acme.test`;
    await seedSuggestion(w, { pattern: person });
    const theirs = await seedSuggestion(other, { pattern: person });

    expect((await erase(w, person)).kind).toBe("erased");
    expect(await idsOf(w)).toEqual([]);
    expect(await idsOf(other)).toEqual([theirs]);
  });
});
