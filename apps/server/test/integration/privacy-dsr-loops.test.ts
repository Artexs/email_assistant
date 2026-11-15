import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Decrypter, generateX25519Identity, identityToRecipient } from "age-encryption";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { eraseSubjectData, exportOrganization, matchSubject } from "../../src/modules/privacy";
import { addressPatterns } from "../../src/modules/privacy/dsr-match";
import { clearLoopTextsOfPerson } from "../../src/modules/privacy/erase";
import { createDb } from "../../src/platform/db";

import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { insertAnalysisRow, insertLoopActionPair, insertLoopRow, insertSentRow } from "./loops-fixtures";

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

  test("2: the erase clears the three address columns, the subject and the text, and keeps the other recipients", async () => {
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
    expect(row.subject).toBeNull();
    expect(row.text).toBeNull();
    expect(row.texts_cleared_at).not.toBeNull();
    expect(JSON.stringify(row)).not.toContain(w.person);
    // A loop that does not name the person keeps its text.
    expect(await loopRow(untouched)).toEqual(before);
    expect((await match(w.orgId, w.person)).mentions).toEqual({});
  });

  test("2c: the text and the subject go also when the person is only a To or only a Cc recipient", async () => {
    const w = await seedWorld();
    const onlyTo = await seedLoop(w, {
      counterpart: w.other,
      to_addresses: [w.other, w.person],
      text: "send the plan",
    });
    const onlyCc = await seedLoop(w, {
      counterpart: w.other,
      to_addresses: [w.other],
      cc_addresses: [w.person],
      text: "call back",
    });
    const result = await erase(w);
    expect(result.kind).toBe("erased");
    for (const id of [onlyTo, onlyCc]) {
      const row = await loopRow(id);
      expect(row.text).toBeNull();
      expect(row.subject).toBeNull();
      expect(row.counterpart).toBe(w.other);
      expect(row.to_addresses).toEqual([w.other]);
      expect(row.cc_addresses).toEqual([]);
    }
  });

  test("2b: a short address makes the scrubbed subject longer: it is cut to the 300 characters of the CHECK", async () => {
    const w = await seedWorld();
    const person = "a@b.co";
    const subject = `${"x".repeat(293)} ${person}`;
    expect(subject).toHaveLength(300);
    // The person is only in the subject, not a recipient: the loop keeps its subject, scrubbed.
    const loop = await seedLoop(w, { counterpart: w.other, to_addresses: [w.other], subject });
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
      subject: null,
      to_addresses: [],
    });
    const analyses = await db
      .selectFrom("sent_analyses")
      .select("sent_email_id")
      .where("org_id", "=", w.orgId)
      .execute();
    expect(analyses).toEqual([]);
  });

  test("3b: the subject of a sent mail that the erase deletes does not stay in the loop or the analysis rows", async () => {
    const w = await seedWorld();
    const subject = "Your test results and the treatment plan";
    const sentId = await db
      .transaction()
      .execute((trx) => insertSentRow(trx, { orgId: w.orgId }, w.mailboxId, { toAddresses: [w.person], subject }));
    await db.updateTable("sent_emails").set({ from_address: w.boss }).where("id", "=", sentId).execute();
    await seedLoop(w, { sent_email_id: sentId, counterpart: w.person, to_addresses: [w.person], subject });
    await db.transaction().execute((trx) => insertAnalysisRow(trx, { orgId: w.orgId }, w.mailboxId, sentId));

    const result = await erase(w);
    expect(result.kind).toBe("erased");
    expect(await db.selectFrom("sent_emails").select("id").where("id", "=", sentId).execute()).toEqual([]);
    // Every column of every loop and analysis row of the organization, as text.
    const rows = await sql<{ j: string }>`
      select row_to_json(t)::text as j from open_loops t where org_id = ${w.orgId}::uuid
      union all
      select row_to_json(t)::text as j from sent_analyses t where org_id = ${w.orgId}::uuid`.execute(db);
    const dump = rows.rows.map((row) => row.j).join("\n");
    expect(dump).not.toContain(subject);
    expect(dump.toLowerCase()).not.toContain(w.person);
  });

  test("7: the follow-up of a closed loop loses the person from its payload and its card text; an open one stops the erase", async () => {
    const w = await seedWorld();
    const loop = await seedLoop(w, { counterpart: w.person, to_addresses: [w.person, w.other] });
    const payload = { kind: "follow_up", to: [w.person], cc: [w.other], quote: `hello ${w.person}` };
    const closed = await db.transaction().execute(async (trx) => {
      const pair = await insertLoopActionPair(trx, { orgId: w.orgId }, loop, {
        draftStatus: "expired",
        sendStatus: "expired",
        payloads: { draft: payload, send: { kind: "follow_up", to: [w.person], cc: [w.other] } },
      });
      const member = await trx
        .selectFrom("memberships")
        .select("user_id")
        .where("org_id", "=", w.orgId)
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("outbox")
        .values({
          org_id: w.orgId,
          user_id: member.user_id,
          kind: "approval",
          dedup_key: `approval:${pair.sendId}`,
          loop_id: loop,
          text: `Follow-up to ${w.person}`,
          // The stored view of a follow-up card spells out every recipient (F116 stage 11).
          view: JSON.stringify({
            view: { kind: "follow_up", to: [w.person, w.other], cc: [], body: `Hi ${w.person}` },
          }),
          buttons: "[]",
          status: "sent",
          created_at: NOW,
          next_attempt_at: NOW,
          sent_at: NOW,
        })
        .execute();
      return pair;
    });
    // A mail that goes in the same erase: the loop actions have no mail and must not break the chain query.
    const result = await erase(w);
    expect(result.kind).toBe("erased");
    const rows = await db
      .selectFrom("actions")
      .select(["id", "payload"])
      .where("id", "in", [closed.draftId, closed.sendId])
      .execute();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(JSON.stringify(row.payload)).not.toContain(w.person);
      expect(JSON.stringify(row.payload)).toContain("[removed]");
    }
    const outbox = await db
      .selectFrom("outbox")
      .select(["text", "view"])
      .where("loop_id", "=", loop)
      .executeTakeFirstOrThrow();
    expect(outbox.text).toBe("Follow-up to [removed]");
    expect(JSON.stringify(outbox.view)).not.toContain(w.person);
    expect(JSON.stringify(outbox.view)).toContain(w.other);
    // The other recipient stays.
    expect(JSON.stringify(rows.find((row) => row.id === closed.sendId)?.payload)).toContain(w.other);

    const second = await seedWorld();
    const secondLoop = await seedLoop(second, { counterpart: second.person, to_addresses: [second.person] });
    await db.transaction().execute((trx) =>
      insertLoopActionPair(trx, { orgId: second.orgId }, secondLoop, {
        payloads: {
          draft: { kind: "follow_up", to: [second.person], cc: [] },
          send: { kind: "follow_up", to: [second.person], cc: [] },
        },
      })
    );
    const refused = await erase(second);
    expect(refused.kind).toBe("open_actions");
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

describe("the organization filter of the loop text clear", () => {
  // The erase runs under row-level security, which hides other organizations by itself. The owner role bypasses the
  // policy, so only the `org_id` filter of the statement keeps organization B out here.
  test("6: a connection without row-level security still clears only the loops of the given organization", async () => {
    const url = process.env.MIGRATOR_DATABASE_URL;
    if (!url) throw new Error("MIGRATOR_DATABASE_URL is missing: the owner role bypasses row-level security");
    const owner = createDb(url);
    try {
      await withRollback(owner, async (trx) => {
        const a = await createOrgWithMailbox(trx);
        const b = await createOrgWithMailbox(trx);
        const person = `p-${randomUUID().slice(0, 8)}@x.test`;
        const loopOf = (o: { orgId: string; mailboxId: string }) =>
          insertLoopRow(trx, o, o.mailboxId, { counterpart: person, to_addresses: [person], text: "send the plan" });
        const loopA = await loopOf(a);
        const loopB = await loopOf(b);
        const cleared = await clearLoopTextsOfPerson(trx, a.orgId, addressPatterns(person));
        expect(cleared).toBe(1);
        const read = (id: string) =>
          trx.selectFrom("open_loops").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
        expect(await read(loopA)).toMatchObject({ text: null, subject: null });
        expect(await read(loopB)).toMatchObject({
          text: "send the plan",
          subject: "Confidential reorganisation of the audit team",
          texts_cleared_at: null,
        });
      });
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
