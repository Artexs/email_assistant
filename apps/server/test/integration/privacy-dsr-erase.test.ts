import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { auditEvents, recordAudit } from "../../src/modules/audit";
import { backfillInbox, syncMailbox, type SeedMessage, type SyncDeps } from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import {
  insertEmail,
  insertInboxFolder,
  insertMailbox,
  lockSyncFolder,
  updateCursor,
} from "../../src/modules/mail/repo";
import { eraseSubjectData, matchSubject, type DsrEraseResult } from "../../src/modules/privacy";
import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import { dsrAddressHash, tombstoneKeyHash } from "../../src/platform/crypto";
import { waitFor } from "../wait-for";

import {
  createOrgWithMailbox,
  insertAction,
  insertDelegate,
  insertDelegation,
  insertTestEmail,
  testCapabilities,
} from "./fixtures";
import { testDb } from "./helpers";

// F106 stage 08: `eraseSubjectData` and the `org:dsr --erase` CLI. The seed is committed (the erase runs its own
// transaction and takes row locks); `afterEach` removes it. The connection is the `app` role.
const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const script = resolve(import.meta.dir, "../../src/scripts/org-dsr.ts");
const KEY = Buffer.alloc(32, 7).toString("base64");
const HOUR = 3_600_000;

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
  orgName: string;
  person: string;
  own: string;
  ownerEmail: string;
  boxId: string;
  goes: string[]; // ids of the mails that go
  goesKeys: string[]; // their dedup keys
  k1: string; // kept mail that names the person everywhere
  k2: string; // kept mail that does not name the person
  g1Action: string; // an action of a mail that goes
  chain: string[]; // C1 (kept mail k1, depends on g1Action), C2 (k2, depends on C1), C3 (k2, reverses C2)
  keptAction: string; // an unrelated action of k2
  delegation: string; // a delegation of k2 whose send action is C2
  delegateId: string;
  ruleId: string;
}

// Org with the mailboxes `own` and `own2` and the member `owner`. Mails that go: `g1` (from the person) with a triage
// result, an applied action, an outbox row, headers and an audit row; `g2` (own to own2 and the person). Kept mails: `k1`
// names the person in every kind of column, `k2` does not. A chain over three levels (see `World`), one delegation that
// the chain removes, one delegate and one sender rule of the person.
async function seedOrg(person: string): Promise<World> {
  const suffix = randomUUID().slice(0, 8);
  const at = (name: string) => `${name}-${suffix}@x.test`;
  const world = await db.transaction().execute(async (trx): Promise<World> => {
    const orgName = `Org ${suffix}`;
    const { orgId, userId } = await createOrganizationWithOwner(trx, {
      orgName,
      timezone: "Europe/Warsaw",
      email: at("owner"),
      displayName: "Owner",
      locale: "en",
    });
    userIds.push(userId);
    const ctx = { orgId };
    const boxes: string[] = [];
    for (const address of [at("own"), at("own2")]) {
      const id = randomUUID();
      boxes.push(id);
      await insertMailbox(trx, ctx, {
        id,
        address,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: {},
      });
      await insertInboxFolder(trx, ctx, id);
    }
    const box = boxes[0] as string;
    const goesKeys = [`mid:<g1-${suffix}@x.test>:h1`, `mid:<g2-${suffix}@x.test>:h1`];
    const g1 = await insertTestEmail(trx, ctx, box, {
      dedup_key: goesKeys[0],
      from_address: person,
      to_addresses: [at("own")],
      subject: "hello",
      body_text: "body of the first mail",
    });
    const g2 = await insertTestEmail(trx, ctx, box, {
      dedup_key: goesKeys[1],
      from_address: at("own"),
      to_addresses: [at("own2"), person],
    });
    const k1 = await insertTestEmail(trx, ctx, box, {
      from_address: at("r"),
      to_addresses: [person, at("q")],
      cc_addresses: [person.toUpperCase()],
      subject: `re ${person}`,
      body_text: `write ${person}.`,
    });
    const k2 = await insertTestEmail(trx, ctx, box, { from_address: at("s"), to_addresses: [at("own")] });

    await trx
      .insertInto("triage_results")
      .values({
        org_id: orgId,
        email_id: g1,
        category: "info",
        confidence: 0.9,
        reason_code: "test",
        fields: JSON.stringify({}),
      })
      .execute();
    await trx
      .insertInto("triage_results")
      .values({
        org_id: orgId,
        email_id: k1,
        category: "info",
        confidence: 0.9,
        reason_code: "test",
        reason: `asked ${person}`,
        fields: JSON.stringify({ to: [person], note: `Regards\n${person}` }),
      })
      .execute();
    await trx
      .insertInto("email_headers")
      .values({
        email_id: k1,
        org_id: orgId,
        from_name: person,
        reply_to: [at("q"), person],
        return_path: person,
        auth_results: `spf=pass smtp.mailfrom=${person}`,
        attachments: JSON.stringify([{ filename: `forward from ${person} (copy).eml`, size: 12 }]),
        parts_known: true,
        captured_at: new Date(),
      })
      .execute();
    await trx
      .insertInto("email_headers")
      .values({ email_id: g1, org_id: orgId, from_name: person, parts_known: true, captured_at: new Date() })
      .execute();
    await recordAudit(trx, ctx, { emailId: g1, actor: "system", event: "test.mail_note", data: { note: "n" } });

    const g1Action = await insertAction(trx, ctx, g1, { type: "move", status: "applied" });
    const c1 = await insertAction(trx, ctx, k1, { type: "move", status: "ready", dependsOnActionId: g1Action });
    const c2 = await insertAction(trx, ctx, k2, { type: "move", status: "ready", dependsOnActionId: c1 });
    const c3 = await insertAction(trx, ctx, k2, { type: "move", status: "undone", reversesActionId: c2 });
    const keptAction = await insertAction(trx, ctx, k2, { type: "create_draft", status: "applied" });
    await insertAction(trx, ctx, k1, {
      type: "send",
      status: "applied",
      approvedAt: new Date(),
      payload: { to: [person], body: `Hi\n${person}\nbye` },
      lastError: `rejected ${person}`,
      providerResult: { rcpt: [person] },
    });
    const delegateId = await insertDelegate(trx, ctx, { email: person, name: "Pat" });
    const other = await insertDelegate(trx, ctx, { email: at("d2") });
    const delegation = await insertDelegation(trx, ctx, {
      mailboxId: box,
      emailId: k2,
      delegateId: other,
      draftActionId: keptAction,
      sendActionId: c2,
      taskSummary: "Prepare the offer",
    });
    const rule = await trx
      .insertInto("sender_rules")
      .values({ org_id: orgId, pattern: person, kind: "blocklist" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const member = await trx
      .selectFrom("memberships")
      .select("user_id")
      .where("org_id", "=", orgId)
      .executeTakeFirstOrThrow();
    const outbox = (email: string, key: string, text: string, view: object) =>
      trx
        .insertInto("outbox")
        .values({
          org_id: orgId,
          user_id: member.user_id,
          kind: "urgent",
          dedup_key: key,
          email_id: email,
          text,
          view: JSON.stringify(view),
          status: "sent",
          created_at: new Date(),
          next_attempt_at: new Date(),
          sent_at: new Date(),
        })
        .execute();
    await outbox(g1, `urgent:g1:${suffix}`, `Mail from ${person}`, { from: person });
    await outbox(k1, `urgent:k1:${suffix}`, `Mail from ${person} to us`, { from: person, n: 1 });
    return {
      orgId,
      orgName,
      person,
      own: at("own"),
      ownerEmail: at("owner"),
      boxId: box,
      goes: [g1, g2],
      goesKeys,
      k1,
      k2,
      g1Action,
      chain: [c1, c2, c3],
      keptAction,
      delegation,
      delegateId,
      ruleId: rule.id,
    };
  });
  orgIds.push(world.orgId);
  return world;
}

// One md5 per table of every table with an `org_id` column: a change to any row of the organization shows.
async function snapshot(orgId: string): Promise<Record<string, string>> {
  const tables = await sql<{ table_name: string }>`
    select c.table_name from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'org_id' and t.table_type = 'BASE TABLE'
    order by 1`.execute(db);
  const out: Record<string, string> = {};
  for (const { table_name } of tables.rows) {
    const rows = await sql<{ h: string }>`
      select md5(coalesce(string_agg(row_to_json(t)::text, '|' order by row_to_json(t)::text), '')) as h
      from ${sql.table(table_name)} as t where org_id = ${orgId}::uuid`.execute(db);
    out[table_name] = rows.rows[0]?.h ?? "";
  }
  return out;
}

async function count(table: string, orgId: string): Promise<number> {
  const rows = await sql<{ n: string }>`
    select count(*)::text as n from ${sql.table(table)} where org_id = ${orgId}::uuid`.execute(db);
  return Number(rows.rows[0]?.n);
}

async function erase(w: World, extra: Partial<Parameters<typeof eraseSubjectData>[1]> = {}): Promise<DsrEraseResult> {
  return eraseSubjectData(db, {
    orgId: w.orgId,
    address: w.person,
    confirm: w.person,
    credentialsKey: KEY,
    ...extra,
  });
}

async function erased(w: World, extra: Partial<Parameters<typeof eraseSubjectData>[1]> = {}) {
  const result = await erase(w, extra);
  if (result.kind !== "erased") throw new Error(`erase answered ${result.kind}`);
  return result;
}

async function eraseAudit(orgId: string) {
  return db
    .selectFrom("audit_log")
    .select(["actor", "data"])
    .where("org_id", "=", orgId)
    .where("event", "=", auditEvents.dsrErase)
    .execute();
}

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

// Polls until a backend waits on a lock while its query text holds `fragment`, or `done()` is true.
async function waitBlocked(fragment: string, done: () => boolean): Promise<void> {
  let waiting = false;
  await waitFor(() => {
    void db
      .selectFrom(sql<{ n: string }>`pg_stat_activity`.as("a"))
      .select(sql<boolean>`true`.as("x"))
      .where(sql<boolean>`a.wait_event_type = 'Lock' and a.query like ${`%${fragment}%`} and a.pid <> pg_backend_pid()`)
      .execute()
      .then((rows) => {
        waiting = rows.length > 0;
      });
    return waiting || done();
  }, `the erase waits on a lock (${fragment}) or finishes`);
}

const unique = () => `p-${randomUUID().slice(0, 8)}@x.test`;

describe("eraseSubjectData", () => {
  test("1. the mails that go are gone with their dependent rows; one tombstone each", async () => {
    const w = await seedOrg(unique());
    const result = await erased(w);
    expect(result.counts.mails).toBe(2);
    expect(result.tombstones).toBe(2);
    const left = await db.selectFrom("emails").select("id").where("org_id", "=", w.orgId).execute();
    expect(left.map((row) => row.id).sort()).toEqual([w.k1, w.k2].sort());
    for (const table of ["triage_results", "actions", "outbox", "email_headers", "audit_log"] as const) {
      const rows = await db.selectFrom(table).select("email_id").where("org_id", "=", w.orgId).execute();
      expect(rows.some((row) => w.goes.includes(row.email_id as string))).toBe(false);
    }
    const tombs = await db.selectFrom("dsr_tombstones").select("key_hash").where("org_id", "=", w.orgId).execute();
    expect(tombs.map((row) => row.key_hash).sort()).toEqual(w.goesKeys.map(tombstoneKeyHash).sort());
  });

  test("2. kept rows lose the address: arrays, text, json (valid), an escaped line break, a NULLed header", async () => {
    const w = await seedOrg(unique());
    await erased(w);
    const k1 = await db.selectFrom("emails").selectAll().where("id", "=", w.k1).executeTakeFirstOrThrow();
    expect(k1.to_addresses).toHaveLength(1);
    expect(k1.to_addresses[0]).toContain("q-");
    expect(k1.cc_addresses).toEqual([]);
    expect(k1.subject).toBe("re [removed]");
    expect(k1.body_text).toBe("write [removed].");
    const triage = await db
      .selectFrom("triage_results")
      .selectAll()
      .where("email_id", "=", w.k1)
      .executeTakeFirstOrThrow();
    expect(triage.reason).toBe("asked [removed]");
    expect(triage.fields).toEqual({ to: ["[removed]"], note: "Regards\n[removed]" });
    const head = await db
      .selectFrom("email_headers")
      .selectAll()
      .where("email_id", "=", w.k1)
      .executeTakeFirstOrThrow();
    expect(head.from_name).toBe("[removed]");
    expect(head.reply_to).toHaveLength(1);
    expect(head.return_path).toBeNull();
    expect(head.auth_results).toBe("spf=pass smtp.mailfrom=[removed]");
    expect(head.attachments).toEqual([{ filename: "forward from [removed] (copy).eml", size: 12 }]);
    const send = await db
      .selectFrom("actions")
      .selectAll()
      .where("email_id", "=", w.k1)
      .where("type", "=", "send")
      .executeTakeFirstOrThrow();
    expect(send.payload).toEqual({ to: ["[removed]"], body: "Hi\n[removed]\nbye" });
    expect(send.last_error).toBe("rejected [removed]");
    expect(send.provider_result).toEqual({ rcpt: ["[removed]"] });
    const outbox = await db
      .selectFrom("outbox")
      .select(["text", "view"])
      .where("email_id", "=", w.k1)
      .executeTakeFirstOrThrow();
    expect(outbox.text).toBe("Mail from [removed] to us");
    expect(outbox.view).toEqual({ from: "[removed]", n: 1 });
    // No row of the organization holds the address any more, in any column (a text dump of every table).
    const dump = await sql<{ hit: boolean }>`
      select (
        exists (select 1 from emails where org_id = ${w.orgId}::uuid and emails::text ilike ${`%${w.person}%`}) or
        exists (select 1 from email_headers h where org_id = ${w.orgId}::uuid and h::text ilike ${`%${w.person}%`}) or
        exists (select 1 from triage_results t where org_id = ${w.orgId}::uuid and t::text ilike ${`%${w.person}%`}) or
        exists (select 1 from actions a where org_id = ${w.orgId}::uuid and a::text ilike ${`%${w.person}%`}) or
        exists (select 1 from outbox o where org_id = ${w.orgId}::uuid and o::text ilike ${`%${w.person}%`}) or
        exists (select 1 from audit_log l where org_id = ${w.orgId}::uuid and l::text ilike ${`%${w.person}%`})
      ) as hit`.execute(db);
    expect(dump.rows[0]?.hit).toBe(false);
  });

  test("2b. an address in single quotes or braces is scrubbed; a longer local part with a quote or a brace stays", async () => {
    const w = await seedOrg(unique());
    const body = `quoted '${w.person}' and {${w.person}} but a{${w.person}} and o'${w.person} stay`;
    await db.updateTable("emails").set({ body_text: body }).where("id", "=", w.k2).execute();
    await erased(w);
    const row = await db.selectFrom("emails").select("body_text").where("id", "=", w.k2).executeTakeFirstOrThrow();
    expect(row.body_text).toBe(`quoted '[removed]' and {[removed]} but a{${w.person}} and o'${w.person} stay`);
  });

  test("3. afterwards the match is empty; delegates and sender rules are unchanged and kept", async () => {
    const w = await seedOrg(unique());
    const beforeDelegates = await db.selectFrom("delegates").selectAll().where("org_id", "=", w.orgId).execute();
    const beforeRules = await db.selectFrom("sender_rules").selectAll().where("org_id", "=", w.orgId).execute();
    const keptBefore = await db.selectFrom("emails").selectAll().where("id", "=", w.k2).executeTakeFirstOrThrow();
    const result = await erased(w);
    expect(result.counts.listed).toEqual({ delegates: 1, sender_rules: 1 });
    const match = await db.transaction().execute((trx) => matchSubject(trx, w.orgId, w.person));
    expect(match.mails).toEqual([]);
    expect(match.mentions).toEqual({});
    expect(match.listed).toEqual({ delegates: [w.delegateId], senderRules: [w.ruleId] });
    expect(await db.selectFrom("delegates").selectAll().where("org_id", "=", w.orgId).execute()).toEqual(
      beforeDelegates
    );
    expect(await db.selectFrom("sender_rules").selectAll().where("org_id", "=", w.orgId).execute()).toEqual(
      beforeRules
    );
    expect(await db.selectFrom("emails").selectAll().where("id", "=", w.k2).executeTakeFirstOrThrow()).toEqual(
      keptBefore
    );
  });

  test("5. an open send of a kept mail that names the person, or an applying chain action: refused, nothing changes", async () => {
    const w = await seedOrg(unique());
    const open = await db.transaction().execute((trx) =>
      insertAction(trx, { orgId: w.orgId }, w.k2, {
        type: "send",
        status: "awaiting_approval",
        payload: { to: [w.person] },
      })
    );
    const before = await snapshot(w.orgId);
    expect(await erase(w)).toEqual({ kind: "open_actions", actionIds: [open] });
    expect(await snapshot(w.orgId)).toEqual(before);

    await db.deleteFrom("actions").where("id", "=", open).execute();
    await db
      .updateTable("actions")
      .set({ status: "applying", locked_at: new Date() })
      .where("id", "=", w.chain[0] as string)
      .execute();
    const second = await snapshot(w.orgId);
    expect(await erase(w)).toEqual({ kind: "open_actions", actionIds: [w.chain[0] as string] });
    expect(await snapshot(w.orgId)).toEqual(second);

    await db
      .updateTable("actions")
      .set({ status: "ready", locked_at: null })
      .where("id", "=", w.chain[0] as string)
      .execute();
    await db
      .transaction()
      .execute((trx) =>
        insertAction(trx, { orgId: w.orgId }, w.goes[0] as string, { type: "send", status: "awaiting_approval" })
      );
    expect((await erase(w)).kind).toBe("open_actions");
  });

  test("6. refusals: a confirm that differs, a bad address, an own address, an unknown organization", async () => {
    const w = await seedOrg(unique());
    const before = await snapshot(w.orgId);
    expect(await erase(w, { confirm: `x-${w.person}` })).toEqual({ kind: "confirm_mismatch" });
    expect(await erase(w, { address: "p@x.", confirm: "p@x." })).toEqual({ kind: "bad_address" });
    expect(await erase(w, { address: w.own, confirm: w.own })).toEqual({ kind: "own_address" });
    expect(await erase(w, { address: w.ownerEmail, confirm: w.ownerEmail })).toEqual({ kind: "own_address" });
    expect(await erase(w, { orgId: randomUUID() })).toEqual({ kind: "not_found" });
    expect(await snapshot(w.orgId)).toEqual(before);
    // The confirm may differ in case and spaces only.
    expect((await erase(w, { address: ` ${w.person.toUpperCase()} `, confirm: w.person })).kind).toBe("erased");
  });

  test("7. a second erase matches nothing, writes a second audit row, adds no tombstone", async () => {
    const w = await seedOrg(unique());
    await erased(w);
    const tombstones = await count("dsr_tombstones", w.orgId);
    const again = await erased(w);
    expect(again.counts).toMatchObject({ mails: 0, mentions: {}, chain_actions: 0, chain_delegations: 0 });
    expect(again.tombstones).toBe(0);
    expect(again.scrubbed).toEqual({});
    expect(await count("dsr_tombstones", w.orgId)).toBe(tombstones);
    const rows = await eraseAudit(w.orgId);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.data).toMatchObject({ mails: 0, mentions: 0, tombstones: 0, chain_actions: 0 });
  });

  test("8. a failure after the deletes changes nothing: no row, no tombstone, no audit row", async () => {
    const w = await seedOrg(unique());
    const before = await snapshot(w.orgId);
    const boom = new Error("boom");
    await expect(
      erase(w, {
        step: async (trx, orgId, erasedRows) => {
          // The mails are already deleted here (inside the transaction).
          const left = await trx.selectFrom("emails").select("id").where("org_id", "=", orgId).execute();
          expect(left).toHaveLength(2);
          expect(erasedRows.mailIds.sort()).toEqual([...w.goes].sort());
          throw boom;
        },
      })
    ).rejects.toBe(boom);
    expect(await snapshot(w.orgId)).toEqual(before);
    expect(await count("dsr_tombstones", w.orgId)).toBe(0);
    expect(await eraseAudit(w.orgId)).toHaveLength(0);
  });

  test("8b. a foreign key error is `blocked` with the constraint and changes nothing; a deadlock is retried once", async () => {
    const w = await seedOrg(unique());
    const before = await snapshot(w.orgId);
    const fk = Object.assign(new Error("fk"), { code: "23503", constraint: "probe_fkey" });
    expect(await erase(w, { step: async () => Promise.reject(fk) })).toEqual({
      kind: "blocked",
      constraint: "probe_fkey",
    });
    expect(await snapshot(w.orgId)).toEqual(before);

    let calls = 0;
    const result = await erased(w, {
      step: async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error("dead"), { code: "40P01" });
        return { outbox_blanked: 3 };
      },
    });
    expect(calls).toBe(2);
    expect(result.stepCounts).toEqual({ outbox_blanked: 3 });
    expect(await eraseAudit(w.orgId)).toHaveLength(1);
    expect((await eraseAudit(w.orgId))[0]?.data).toMatchObject({ outbox_blanked: 3 });
  });

  test("8c. the erase runs in the tenant scope of its organization (row-level security backs up the org filter)", async () => {
    const w = await seedOrg(unique());
    let scope = "";
    let visible = -1;
    await erased(w, {
      step: async (trx) => {
        scope =
          (await sql<{ v: string }>`select current_setting('app.org_id', true) as v`.execute(trx)).rows[0]?.v ?? "";
        // Another organization's rows are invisible here, even without an org filter.
        visible = (
          await sql<{ n: string }>`select count(*)::text as n from emails where org_id <> ${w.orgId}::uuid`.execute(trx)
        ).rows[0]?.n as unknown as number;
        return {};
      },
    });
    expect(scope).toBe(w.orgId);
    expect(Number(visible)).toBe(0);
  });

  test("9. a chain of actions over three levels is deleted and counted; the erase is not blocked", async () => {
    const w = await seedOrg(unique());
    const match = await db.transaction().execute((trx) => matchSubject(trx, w.orgId, w.person));
    expect(match.chainActions.sort()).toEqual([...w.chain].sort());
    expect(match.chainDelegations).toEqual([w.delegation]);
    const result = await erased(w);
    expect(result.counts.chain_actions).toBe(3);
    expect(result.counts.chain_delegations).toBe(1);
    const left = await db.selectFrom("actions").select("id").where("org_id", "=", w.orgId).execute();
    const ids = left.map((row) => row.id);
    for (const gone of [...w.chain, w.g1Action]) expect(ids).not.toContain(gone);
    expect(ids).toContain(w.keptAction);
    // The delegation of the kept mail goes with its send action (the foreign key cascades) and is counted.
    expect(await count("delegations", w.orgId)).toBe(0);
    expect((await eraseAudit(w.orgId))[0]?.data).toMatchObject({ chain_actions: 3, chain_delegations: 1 });
  });

  test("10. another organization with the same address, mails and rows stays whole", async () => {
    const person = unique();
    const a = await seedOrg(person);
    const b = await seedOrg(person);
    const beforeB = await snapshot(b.orgId);
    await erased(a);
    expect(await snapshot(b.orgId)).toEqual(beforeB);
    expect(await count("dsr_tombstones", b.orgId)).toBe(0);
    expect(await count("emails", b.orgId)).toBe(4);
    expect(await eraseAudit(b.orgId)).toHaveLength(0);
  });

  test("11. the audit row is flat: the hash and counts, no address; the person's mails of another person stay", async () => {
    const w = await seedOrg(unique());
    const keptBefore = await db.selectFrom("emails").selectAll().where("id", "=", w.k2).executeTakeFirstOrThrow();
    await erased(w);
    const rows = await eraseAudit(w.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe("cli");
    const data = rows[0]?.data as Record<string, unknown>;
    expect(data.address_hash).toBe(dsrAddressHash(KEY, w.person));
    expect(data).toMatchObject({
      mails: 2,
      tombstones: 2,
      chain_actions: 3,
      listed_delegates: 1,
      listed_sender_rules: 1,
    });
    expect(Object.values(data).every((v) => ["string", "number", "boolean"].includes(typeof v) || v === null)).toBe(
      true
    );
    expect(JSON.stringify(rows)).not.toContain(w.person);
    expect(JSON.stringify(rows)).not.toContain("x.test");
    expect(await db.selectFrom("emails").selectAll().where("id", "=", w.k2).executeTakeFirstOrThrow()).toEqual(
      keptBefore
    );
  });

  test("12. a scrub that grows a short address is cut to the column limits", async () => {
    const w = await seedOrg("a@b.co");
    await db
      .updateTable("email_headers")
      .set({ from_name: `${"x".repeat(193)} a@b.co`, auth_results: `${"y".repeat(993)} a@b.co` })
      .where("email_id", "=", w.k1)
      .execute();
    await erased(w);
    const head = await db
      .selectFrom("email_headers")
      .selectAll()
      .where("email_id", "=", w.k1)
      .executeTakeFirstOrThrow();
    expect(head.from_name).toBe(`${"x".repeat(193)} [remov`);
    expect(head.auth_results).toHaveLength(1000);
  });
});

describe("the sync folder lock and the tombstones", () => {
  test("a sync chunk that holds the folder lock makes the erase wait, and its mail from the person goes too", async () => {
    const w = await seedOrg(unique());
    const ctx = { orgId: w.orgId };
    const folder = await db
      .selectFrom("mailbox_folders")
      .select("id")
      .where("mailbox_id", "=", w.boxId)
      .executeTakeFirstOrThrow();
    let locked!: () => void;
    const lockedP = new Promise<void>((resolveLock) => (locked = resolveLock));
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => (release = resolveGate));
    const lateKey = `mid:<late-${randomUUID().slice(0, 8)}@x.test>:h1`;
    // The chunk of a sync: it takes the folder lock and inserts a mail from the person that the erase cannot see yet.
    const chunk = db.transaction().execute(async (trx) => {
      await lockSyncFolder(trx, ctx, folder.id);
      await insertEmail(trx, ctx, {
        mailbox_id: w.boxId,
        dedup_key: lateKey,
        thread_key: `t:${lateKey}`,
        content_hash: "h",
        uid: 99,
        received_at: new Date(),
        source_folder: "INBOX",
        from_address: w.person,
        to_addresses: [w.own],
      });
      locked();
      await gate;
    });
    await lockedP;
    let finished = false;
    const erasing = erase(w).then((result) => {
      finished = true;
      return result;
    });
    try {
      // The erase waits on the folder lock (a backend that waits on a lock while its text names the folder table).
      await waitBlocked("mailbox_folders", () => finished);
      expect(finished).toBe(false);
    } finally {
      release();
    }
    await chunk;
    const result = await erasing;
    expect(result.kind).toBe("erased");
    if (result.kind !== "erased") return;
    expect(result.counts.mails).toBe(3);
    const left = await db
      .selectFrom("emails")
      .select("dedup_key")
      .where("org_id", "=", w.orgId)
      .where("from_address", "=", w.person)
      .execute();
    expect(left).toEqual([]);
    const tombs = await db.selectFrom("dsr_tombstones").select("key_hash").where("org_id", "=", w.orgId).execute();
    expect(tombs.map((row) => row.key_hash)).toContain(tombstoneKeyHash(lateKey));
  });

  test("an open send that commits after the match, before the mail lock: refused, nothing deleted", async () => {
    const w = await seedOrg(unique());
    const ctx = { orgId: w.orgId };
    let inserted!: () => void;
    const insertedP = new Promise<void>((resolveInsert) => (inserted = resolveInsert));
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => (release = resolveGate));
    let sendId = "";
    // A writer (a triage job) adds an open send to a mail that goes and keeps it uncommitted: the match cannot see it.
    const writer = db.transaction().execute(async (trx) => {
      sendId = await insertAction(trx, ctx, w.goes[0] as string, { type: "send", status: "awaiting_approval" });
      inserted();
      await gate;
    });
    await insertedP;
    const before = await count("emails", w.orgId);
    let finished = false;
    const erasing = erase(w).then((result) => {
      finished = true;
      return result;
    });
    try {
      // The erase waits for the row lock of the mail (the writer holds a key share on it through its foreign key).
      await waitBlocked("from emails", () => finished);
      expect(finished).toBe(false);
    } finally {
      release();
    }
    await writer;
    expect(await erasing).toEqual({ kind: "open_actions", actionIds: [sendId] });
    expect(await count("emails", w.orgId)).toBe(before);
    expect(await db.selectFrom("actions").select("id").where("id", "=", sendId).execute()).toHaveLength(1);
    expect(await count("dsr_tombstones", w.orgId)).toBe(0);
    expect(await eraseAudit(w.orgId)).toHaveLength(0);
  });

  test("4. rescan and backfill store none of the erased mails, not as `#2` either; a new mail from the person is stored", async () => {
    const person = unique();
    const NOW = new Date("2026-11-03T12:00:00Z");
    const day = 86_400_000;
    const ago = (ms: number) => new Date(NOW.getTime() - ms);
    const { orgId, userId, mailboxId } = await db.transaction().execute((trx) => createOrgWithMailbox(trx));
    orgIds.push(orgId);
    userIds.push(userId);
    const ctx = { orgId };
    const mailbox = await db
      .selectFrom("mailboxes")
      .select("address")
      .where("id", "=", mailboxId)
      .executeTakeFirstOrThrow();
    const fake = createFakeMailProvider({ uidValidity: 7 });
    const seed = (n: number, from: string): SeedMessage => ({
      messageId: `<e${n}-${person}>`,
      from,
      to: [mailbox.address],
      subject: `Mail ${n}`,
      date: NOW,
      text: `Body ${n}`,
    });
    fake.deliver("INBOX", seed(1, person), { internalDate: ago(20 * day) });
    fake.deliver("INBOX", seed(2, person), { internalDate: ago(10 * day) });
    fake.deliver("INBOX", seed(3, `other-${person}`), { internalDate: ago(5 * day) });
    fake.deliver("INBOX", seed(4, person), { internalDate: ago(2 * 3_600_000) });
    const deps: SyncDeps = { db, provider: fake, isOwnActionId: async () => false, now: () => NOW };
    expect((await syncMailbox(deps, ctx, mailboxId)).stored).toBe(1);
    expect((await backfillInbox(deps, ctx, mailboxId, { since: ago(30 * day) })).stored).toBe(3);
    const ids = async () =>
      (await db.selectFrom("emails").select("message_id_header").where("mailbox_id", "=", mailboxId).execute())
        .map((row) => row.message_id_header)
        .sort();
    expect(await ids()).toHaveLength(4);

    const result = await eraseSubjectData(db, { orgId, address: person, confirm: person, credentialsKey: KEY });
    expect(result.kind).toBe("erased");
    if (result.kind !== "erased") return;
    expect(result.counts.mails).toBe(3);
    expect(await ids()).toEqual([`<e3-${person}>`]);

    // The mailbox still holds the erased mails. A rescan (UIDVALIDITY changed) and a backfill must not bring them back.
    fake.resetUidValidity(8);
    fake.deliver("INBOX", seed(5, person), { internalDate: ago(HOUR) });
    const rescan = await syncMailbox(deps, ctx, mailboxId);
    expect(rescan.mode).toBe("rescan");
    expect(rescan.stored).toBe(1);
    expect((await backfillInbox(deps, ctx, mailboxId, { since: ago(30 * day) })).stored).toBe(0);
    expect(await ids()).toEqual([`<e3-${person}>`, `<e5-${person}>`]);
  });

  test("4b. a copy `#2` of an erased mail is skipped by the trigger; a mail with another key is stored", async () => {
    const w = await seedOrg(unique());
    await erased(w);
    const ctx = { orgId: w.orgId };
    const row = (key: string) => ({
      mailbox_id: w.boxId,
      dedup_key: key,
      thread_key: `t:${key}`,
      content_hash: "h",
      uid: 5,
      received_at: new Date(),
      source_folder: "INBOX",
      from_address: w.person,
    });
    const keys = w.goesKeys;
    expect(await insertEmail(db, ctx, row(keys[0] as string))).toBe(false);
    expect(await insertEmail(db, ctx, row(`${keys[0]}#2`))).toBe(false);
    expect(await insertEmail(db, ctx, row(`${keys[1]}#7`))).toBe(false);
    expect(await insertEmail(db, ctx, row(`mid:<new-${randomUUID().slice(0, 8)}@x.test>:h1`))).toBe(true);
  });
});

describe("org:dsr --erase CLI", () => {
  test("exit 0 and the count lines; stdout and stderr hold no address or name; the record line is there", async () => {
    const w = await seedOrg(unique());
    const result = await run(["--org-id", w.orgId, "--address", w.person, "--erase", "--confirm", w.person]);
    expect(result.code).toBe(0);
    const lines = result.stdout.trimEnd().split("\n");
    expect(lines).toContain("erased mails 2");
    expect(lines).toContain("tombstones 2");
    expect(lines).toContain("chain actions 3");
    expect(lines).toContain("chain delegations 1");
    expect(lines).toContain("scrubbed emails.to_addresses 1");
    expect(lines).toContain("scrubbed email_headers.attachments 1");
    expect(lines).toContain("blanked outbox 0");
    expect(lines).toContain("dropped outbox 0");
    expect(lines).toContain("kept delegates 1");
    expect(lines).toContain("kept sender_rules 1");
    expect(lines.at(-1)).toMatch(new RegExp(`^record: dsr erase ${w.orgId} \\d{4}-\\d{2}-\\d{2}$`));
    for (const needle of [w.person, w.orgName, w.own, w.ownerEmail, "@"]) {
      expect(result.stdout + result.stderr).not.toContain(needle);
    }
    expect(await eraseAudit(w.orgId)).toHaveLength(1);
  });

  test("an open action: open action <id>, org_dsr_refused, exit 1, nothing changes", async () => {
    const w = await seedOrg(unique());
    const open = await db.transaction().execute((trx) =>
      insertAction(trx, { orgId: w.orgId }, w.k2, {
        type: "send",
        status: "awaiting_approval",
        payload: { to: [w.person] },
      })
    );
    const before = await snapshot(w.orgId);
    const result = await run(["--org-id", w.orgId, "--address", w.person, "--erase", "--confirm", w.person]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(`open action ${open}`);
    expect(result.stdout + result.stderr).toContain("org_dsr_refused");
    expect(result.stdout + result.stderr).toContain("open_actions");
    expect(result.stdout + result.stderr).not.toContain(w.person);
    expect(await snapshot(w.orgId)).toEqual(before);
  });

  test("a refusal, a missing confirm and both modes: exit 1 or 2, no address in the output", async () => {
    const w = await seedOrg(unique());
    const mismatch = await run(["--org-id", w.orgId, "--address", w.person, "--erase", "--confirm", `x${w.person}`]);
    expect(mismatch.code).toBe(1);
    expect(mismatch.stdout + mismatch.stderr).toContain("confirm_mismatch");
    expect(mismatch.stdout + mismatch.stderr).not.toContain(w.person);
    const noConfirm = await run(["--org-id", w.orgId, "--address", w.person, "--erase"]);
    expect(noConfirm.code).toBe(2);
    expect(noConfirm.stderr).toContain("usage: bun run org:dsr");
    expect(noConfirm.stderr).not.toContain(w.person);
    const both = await run(["--org-id", w.orgId, "--address", w.person, "--erase", "--find", "--confirm", w.person]);
    expect(both.code).toBe(2);
    const confirmWithFind = await run(["--org-id", w.orgId, "--address", w.person, "--find", "--confirm", w.person]);
    expect(confirmWithFind.code).toBe(2);
    expect(await count("emails", w.orgId)).toBe(4);
    expect(await eraseAudit(w.orgId)).toHaveLength(0);
  });
});
