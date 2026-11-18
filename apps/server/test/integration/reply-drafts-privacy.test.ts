import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Decrypter, generateX25519Identity, identityToRecipient } from "age-encryption";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { eraseSubjectData, exportOrganization, matchSubject } from "../../src/modules/privacy";

import { createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb, TEST_CREDENTIALS_KEY } from "./helpers";
import { insertMailboxProfile, insertReplyRequest } from "./reply-fixtures";

// The reply request and the mailbox profile are in the data request, the erase and the organization
// export. The seed is committed (the erase runs its own transaction); `afterEach` removes it. The connection is the
// `app` role.
const db = testDb();
const KEY = Buffer.alloc(32, 7).toString("base64");
const NOW = new Date("2026-11-20T10:00:00Z");
const dir = mkdtempSync(join(tmpdir(), "f115-privacy-"));

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
  await db.destroy();
});

interface World {
  orgId: string;
  mailboxId: string;
  userId: string;
  person: string;
  other: string;
}

async function seedWorld(person?: string): Promise<World> {
  const suffix = randomUUID().slice(0, 8);
  const world = await db.transaction().execute(async (trx): Promise<World> => {
    const o = await createOrgWithMailbox(trx);
    userIds.push(o.userId);
    return { ...o, person: person ?? `p-${suffix}@firma.test`, other: `q-${suffix}@firma.test` };
  });
  orgIds.push(world.orgId);
  return world;
}

const seedMail = (w: World, from = "someone@elsewhere.test") =>
  db.transaction().execute((trx) => insertTestEmail(trx, w, w.mailboxId, { from_address: from }));

const seedRequest = (w: World, emailId: string, over: Parameters<typeof insertReplyRequest>[4] = {}) =>
  db
    .transaction()
    .execute((trx) =>
      insertReplyRequest(trx, w, w.mailboxId, emailId, { trigger: "tap", requested_by: w.userId, ...over })
    );

const requestRow = (id: string) => db.selectFrom("reply_requests").selectAll().where("id", "=", id).executeTakeFirst();

const profileRow = (mailboxId: string) =>
  db.selectFrom("mailbox_profiles").selectAll().where("mailbox_id", "=", mailboxId).executeTakeFirstOrThrow();

const match = (w: World, address = w.person) =>
  db.transaction().execute((trx) => matchSubject(trx, w.orgId, address, TEST_CREDENTIALS_KEY));

const erase = (w: World, address = w.person) =>
  eraseSubjectData(db, { orgId: w.orgId, address, confirm: address, credentialsKey: KEY, now: NOW });

describe("reply requests and profiles in a data request", () => {
  test("1: the find lists the requests whose instruction or sample holds the address, and the profiles whose text does", async () => {
    const w = await seedWorld();
    const mail = await seedMail(w);
    const byInstruction = await seedRequest(w, mail, { instruction: `tell ${w.person.toUpperCase()} that we agree` });
    const bySample = await seedRequest(w, mail, { trigger: "sample", sample_body: `Hello, write to ${w.person}.` });
    const unrelated = await seedRequest(w, mail, { instruction: `tell ${w.other} that we agree` });
    await db
      .transaction()
      .execute((trx) => insertMailboxProfile(trx, w, w.mailboxId, { signature: `Call ${w.person}` }));

    const found = await match(w);
    expect(found.mentions["reply_requests.instruction"]).toEqual([byInstruction]);
    expect(found.mentions["reply_requests.sample_body"]).toEqual([bySample]);
    expect(found.mentions["mailbox_profiles.signature"]).toEqual([w.mailboxId]);
    expect(Object.values(found.mentions).flat()).not.toContain(unrelated);
    expect(found.mentions["mailbox_profiles.display_name"]).toBeUndefined();
  });

  test("2: the erase replaces the address in the texts, keeps the other requests, and leaves no trace of the address", async () => {
    const w = await seedWorld();
    const mail = await seedMail(w);
    const named = await seedRequest(w, mail, { instruction: `tell ${w.person} that we agree` });
    const sample = await seedRequest(w, mail, { trigger: "sample", sample_body: `Hello ${w.person}` });
    const untouched = await seedRequest(w, mail, { instruction: `tell ${w.other} that we agree` });
    await db.transaction().execute((trx) =>
      insertMailboxProfile(trx, w, w.mailboxId, {
        display_name: "Jan",
        signature: `Jan, ${w.person}`,
        writing_style: "short",
      })
    );
    const before = await requestRow(untouched);

    const result = await erase(w);
    expect(result.kind).toBe("erased");
    if (result.kind !== "erased") return;
    expect(result.scrubbed["reply_requests.instruction"]).toBe(1);
    expect(result.scrubbed["reply_requests.sample_body"]).toBe(1);
    expect(result.scrubbed["mailbox_profiles.signature"]).toBe(1);

    expect((await requestRow(named))?.instruction).toBe("tell [removed] that we agree");
    expect((await requestRow(sample))?.sample_body).toBe("Hello [removed]");
    expect(await requestRow(untouched)).toEqual(before);
    const profile = await profileRow(w.mailboxId);
    expect(profile.signature).toBe("Jan, [removed]");
    expect(profile.display_name).toBe("Jan");
    expect(profile.writing_style).toBe("short");
    expect((await match(w)).mentions).toEqual({});
  });

  test("3: a short address makes the scrubbed text longer: each text is cut to the limit of its CHECK", async () => {
    const w = await seedWorld("a@b.co");
    const mail = await seedMail(w);
    const instruction = `${"x".repeat(293)} ${w.person}`;
    const sampleBody = `${"y".repeat(1993)} ${w.person}`;
    const signature = `${"s".repeat(993)} ${w.person}`;
    const displayName = `${"n".repeat(93)} ${w.person}`;
    const style = `${"w".repeat(993)} ${w.person}`;
    for (const [text, limit] of [
      [instruction, 300],
      [sampleBody, 2000],
      [signature, 1000],
      [displayName, 100],
      [style, 1000],
    ] as const) {
      expect(text).toHaveLength(limit);
    }
    const a = await seedRequest(w, mail, { instruction });
    const b = await seedRequest(w, mail, { trigger: "sample", sample_body: sampleBody });
    await db
      .transaction()
      .execute((trx) =>
        insertMailboxProfile(trx, w, w.mailboxId, { display_name: displayName, signature, writing_style: style })
      );
    const result = await erase(w);
    expect(result.kind).toBe("erased");
    expect((await requestRow(a))?.instruction).toHaveLength(300);
    expect((await requestRow(b))?.sample_body).toHaveLength(2000);
    const profile = await profileRow(w.mailboxId);
    expect(profile.signature).toHaveLength(1000);
    expect(profile.display_name).toHaveLength(100);
    expect(profile.writing_style).toHaveLength(1000);
    for (const value of [profile.signature, profile.display_name, profile.writing_style]) {
      expect(value).not.toContain(w.person);
    }
  });

  test("4: a request of a mail that goes with the person is deleted with the mail, and is not a mention", async () => {
    const w = await seedWorld();
    const goes = await seedMail(w, w.person);
    const stays = await seedMail(w);
    const ofGoing = await seedRequest(w, goes, { instruction: `about ${w.person}` });
    const ofKept = await seedRequest(w, stays, { instruction: `about ${w.person}` });
    const found = await match(w);
    expect(found.mentions["reply_requests.instruction"]).toEqual([ofKept]);

    const result = await erase(w);
    expect(result.kind).toBe("erased");
    expect(await requestRow(ofGoing)).toBeUndefined();
    expect((await requestRow(ofKept))?.instruction).toBe("about [removed]");
  });
});

async function decrypt(path: string): Promise<Record<string, unknown>> {
  const decrypter = new Decrypter();
  decrypter.addIdentity(identity);
  return JSON.parse(await decrypter.decrypt(new Uint8Array(await readFile(path)), "text"));
}

describe("reply requests and profiles in the organization export", () => {
  test("5: the export holds the texts and the state, not the ids, the thread key or the counters", async () => {
    const w = await seedWorld();
    const mail = await seedMail(w);
    await seedRequest(w, mail, { instruction: "Say yes.", status: "done", reason_code: "needs_facts" });
    await db
      .transaction()
      .execute((trx) =>
        insertMailboxProfile(trx, w, w.mailboxId, { display_name: "Jan", signature: "Jan K.", writing_style: "short" })
      );
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

    expect(tables.reply_requests).toHaveLength(1);
    expect(Object.keys(tables.reply_requests?.[0] ?? {}).sort()).toEqual(
      ["created_at", "instruction", "org_id", "reason_code", "sample_body", "status", "trigger"].sort()
    );
    expect(tables.reply_requests?.[0]).toMatchObject({
      trigger: "tap",
      status: "done",
      reason_code: "needs_facts",
      instruction: "Say yes.",
      sample_body: null,
    });
    expect(tables.mailbox_profiles).toHaveLength(1);
    expect(Object.keys(tables.mailbox_profiles?.[0] ?? {}).sort()).toEqual(
      ["display_name", "mailbox_id", "org_id", "signature", "updated_at", "writing_style"].sort()
    );
    expect(tables.mailbox_profiles?.[0]).toMatchObject({
      display_name: "Jan",
      signature: "Jan K.",
      writing_style: "short",
    });
  });
});
