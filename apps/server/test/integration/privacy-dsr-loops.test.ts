import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Decrypter, generateX25519Identity, identityToRecipient } from "age-encryption";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { eraseSubjectData, exportOrganization, matchSubject } from "../../src/modules/privacy";

import { createOrgWithMailbox } from "./fixtures";
import { testDb } from "./helpers";
import { insertAnalysisRow, insertLoopRow, insertSentRow } from "./loops-fixtures";

// F116 stage 07: the open loops are in the data request and the organization export. A loop copies recipients and
// short texts from sent mail, so an erase for a person must leave no address and no text of that person in it. The seed
// is committed (the erase runs its own transaction); `afterEach` removes it. The connection is the `app` role.
const db = testDb();
const KEY = Buffer.alloc(32, 7).toString("base64");
const NOW = new Date("2026-11-20T10:00:00Z");
const dir = mkdtempSync(join(tmpdir(), "f116-dsr-loops-"));

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
  boss: string;
  person: string;
  other: string;
  third: string;
}

async function seedWorld(person?: string): Promise<World> {
  const suffix = randomUUID().slice(0, 8);
  const world = await db.transaction().execute(async (trx): Promise<World> => {
    const o = await createOrgWithMailbox(trx);
    const box = await trx
      .selectFrom("mailboxes")
      .select("address")
      .where("id", "=", o.mailboxId)
      .executeTakeFirstOrThrow();
    userIds.push(o.userId);
    return {
      orgId: o.orgId,
      mailboxId: o.mailboxId,
      boss: box.address,
      person: person ?? `p-${suffix}@x.test`,
      other: `q-${suffix}@x.test`,
      third: `r-${suffix}@x.test`,
    };
  });
  orgIds.push(world.orgId);
  return world;
}

function loopRow(id: string) {
  return db.selectFrom("open_loops").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

function seedLoop(w: World, overrides: Parameters<typeof insertLoopRow>[3] = {}) {
  return db.transaction().execute((trx) => insertLoopRow(trx, { orgId: w.orgId }, w.mailboxId, overrides));
}

function match(orgId: string, address: string) {
  return db.transaction().execute((trx) => matchSubject(trx, orgId, address));
}

function erase(w: World, address = w.person) {
  return eraseSubjectData(db, { orgId: w.orgId, address, confirm: address, credentialsKey: KEY, now: NOW });
}

describe("open loops in a data request", () => {
  test("1: the find lists the loops that name the person in the counterpart, the recipients and the subject", async () => {
    const w = await seedWorld();
    const byCounterpart = await seedLoop(w, { counterpart: w.person, to_addresses: [w.person], cc_addresses: [] });
    const byCc = await seedLoop(w, {
      counterpart: w.other,
      to_addresses: [w.other],
      cc_addresses: [w.person.toUpperCase()],
    });
    const bySubject = await seedLoop(w, {
      counterpart: w.other,
      to_addresses: [w.other],
      subject: `about ${w.person}`,
    });
    const unrelated = await seedLoop(w, { counterpart: w.other, to_addresses: [w.other] });
    const found = await match(w.orgId, w.person);
    expect(found.mentions["open_loops.counterpart"]).toEqual([byCounterpart]);
    expect(found.mentions["open_loops.to_addresses"]).toEqual([byCounterpart]);
    expect(found.mentions["open_loops.cc_addresses"]).toEqual([byCc]);
    expect(found.mentions["open_loops.subject"]).toEqual([bySubject]);
    expect(Object.values(found.mentions).flat()).not.toContain(unrelated);
  });

  test("2: the erase clears the three address columns and the text, and keeps the other recipients", async () => {
    const w = await seedWorld();
    const loop = await seedLoop(w, {
      counterpart: w.person,
      to_addresses: [w.person, w.other],
      cc_addresses: [w.third, w.person],
      subject: `call ${w.person} today`,
      text: "send the plan",
    });
    const untouched = await seedLoop(w, { counterpart: w.other, to_addresses: [w.other], text: "send the report" });
    const before = await loopRow(untouched);

    const result = await erase(w);
    expect(result.kind).toBe("erased");
    if (result.kind !== "erased") return;
    expect(result.scrubbed["open_loops.text"]).toBe(1);

    const row = await loopRow(loop);
    expect(row.counterpart).toBeNull();
    expect(row.to_addresses).toEqual([w.other]);
    expect(row.cc_addresses).toEqual([w.third]);
    expect(row.subject).not.toContain(w.person);
    expect(row.text).toBeNull();
    expect(row.texts_cleared_at).not.toBeNull();
    expect(JSON.stringify(row)).not.toContain(w.person);
    // A loop that does not name the person keeps its text.
    expect(await loopRow(untouched)).toEqual(before);
    expect((await match(w.orgId, w.person)).mentions).toEqual({});
  });

  test("2b: a short address makes the scrubbed subject longer: it is cut to the 300 characters of the CHECK", async () => {
    const w = await seedWorld();
    const person = "a@b.co";
    const subject = `${"x".repeat(293)} ${person}`;
    expect(subject).toHaveLength(300);
    const loop = await seedLoop(w, { counterpart: person, to_addresses: [person], subject });
    const result = await erase(w, person);
    expect(result.kind).toBe("erased");
    const row = await loopRow(loop);
    expect(row.subject).not.toContain(person);
    expect(row.subject?.length).toBe(300);
  });

  test("3: a loop outlives the sent mail that the erase deletes, with no address of the person", async () => {
    const w = await seedWorld();
    const sentId = await db
      .transaction()
      .execute((trx) => insertSentRow(trx, { orgId: w.orgId }, w.mailboxId, { toAddresses: [w.person] }));
    // The sent mail goes with the person: its only other party is the own mailbox.
    await db.updateTable("sent_emails").set({ from_address: w.boss }).where("id", "=", sentId).execute();
    const loop = await seedLoop(w, {
      sent_email_id: sentId,
      last_sent_email_id: sentId,
      counterpart: w.person,
      to_addresses: [w.person],
    });
    await db.transaction().execute((trx) => insertAnalysisRow(trx, { orgId: w.orgId }, w.mailboxId, sentId));

    const result = await erase(w);
    expect(result.kind).toBe("erased");
    const row = await loopRow(loop);
    expect(row).toMatchObject({
      sent_email_id: null,
      last_sent_email_id: null,
      counterpart: null,
      text: null,
      to_addresses: [],
    });
    const analyses = await db
      .selectFrom("sent_analyses")
      .select("sent_email_id")
      .where("org_id", "=", w.orgId)
      .execute();
    expect(analyses).toEqual([]);
  });

  test("4: the loops of another organization with the same person stay whole", async () => {
    const a = await seedWorld();
    const b = await seedWorld(a.person);
    const loopB = await seedLoop(b, {
      counterpart: b.person,
      to_addresses: [b.person, b.other],
      text: "send the plan",
    });
    await seedLoop(a, { counterpart: a.person, to_addresses: [a.person] });
    const before = await loopRow(loopB);
    expect((await match(a.orgId, a.person)).mentions["open_loops.counterpart"]).toHaveLength(1);

    const result = await erase(a);
    expect(result.kind).toBe("erased");
    expect(await loopRow(loopB)).toEqual(before);
    expect((await match(b.orgId, b.person)).mentions["open_loops.counterpart"]).toEqual([loopB]);
  });
});

async function decrypt(path: string): Promise<Record<string, unknown>> {
  const decrypter = new Decrypter();
  decrypter.addIdentity(identity);
  return JSON.parse(await decrypter.decrypt(new Uint8Array(await readFile(path)), "text"));
}

describe("open loops in the organization export", () => {
  test("5: the export holds the loop texts and state, not the matching ids; the analysis holds codes only", async () => {
    const w = await seedWorld();
    const sentId = await db
      .transaction()
      .execute((trx) => insertSentRow(trx, { orgId: w.orgId }, w.mailboxId, { toAddresses: [w.other] }));
    await seedLoop(w, { sent_email_id: sentId, counterpart: w.other, to_addresses: [w.other], text: "send the plan" });
    await db.transaction().execute((trx) => insertAnalysisRow(trx, { orgId: w.orgId }, w.mailboxId, sentId));
    const out = join(dir, `${randomUUID()}.age`);
    const exported = await exportOrganization(db, { orgId: w.orgId, recipient, out, now: NOW });
    expect(exported.kind).toBe("written");
    const tables = (await decrypt(out)).tables as Record<string, Record<string, unknown>[]>;

    expect(tables.open_loops).toHaveLength(1);
    expect(Object.keys(tables.open_loops?.[0] ?? {}).sort()).toEqual(
      [
        "cc_addresses",
        "closed_at",
        "close_reason",
        "counterpart",
        "created_at",
        "due_at",
        "kind",
        "org_id",
        "status",
        "subject",
        "text",
        "to_addresses",
      ].sort()
    );
    expect(tables.open_loops?.[0]).toMatchObject({
      kind: "waiting",
      status: "open",
      counterpart: w.other,
      text: "send the plan",
    });
    expect(tables.sent_analyses).toHaveLength(1);
    expect(Object.keys(tables.sent_analyses?.[0] ?? {}).sort()).toEqual(
      ["expects_reply", "has_promise", "org_id", "prompt_version", "skip_reason", "status"].sort()
    );
  });
});
