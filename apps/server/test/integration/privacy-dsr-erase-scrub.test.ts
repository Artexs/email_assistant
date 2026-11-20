import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { matchSubject } from "../../src/modules/privacy";
import { tombstoneKeyHash } from "../../src/platform/crypto";

import { insertAction } from "./fixtures";
import { testDb, TEST_CREDENTIALS_KEY } from "./helpers";
import { unique, type World, makeDsrKit } from "./privacy-dsr-erase-helpers";

// `eraseSubjectData`: the mails that go and the address that leaves the rows that stay. The seed is committed (the erase runs its own transaction and takes row locks);
// `afterEach` removes it. The connection is the `app` role.
const db = testDb();
const { seedOrg, snapshot, erase, erased, cleanup } = makeDsrKit(db);

afterEach(cleanup);

afterAll(async () => {
  await db.destroy();
});

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
    const match = await db.transaction().execute((trx) => matchSubject(trx, w.orgId, w.person, TEST_CREDENTIALS_KEY));
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

  test("13. a sent mail that names the person loses the address in cc and subject; the other organization's row stays", async () => {
    const person = unique();
    const a = await seedOrg(person);
    const b = await seedOrg(person);
    const insertSent = async (w: World) =>
      db
        .insertInto("sent_emails")
        .values({
          org_id: w.orgId,
          mailbox_id: w.boxId,
          dedup_key: `mid:<s-${randomUUID()}@x.test>:h1`,
          path: "Sent",
          uidvalidity: 7,
          uid: 1,
          thread_key: "<s@x.test>",
          origin: "user",
          content: "pending",
          sent_at: new Date("2026-11-10T10:00:00Z"),
          internal_date: new Date("2026-11-10T10:00:00Z"),
          to_addresses: ["q@x.test"],
          cc_addresses: [person, "r@x.test"],
          subject: `about ${person}`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
    const sentA = await insertSent(a);
    const sentB = await insertSent(b);
    const beforeB = await db.selectFrom("sent_emails").selectAll().where("id", "=", sentB.id).executeTakeFirstOrThrow();
    await erased(a);
    const rowA = await db.selectFrom("sent_emails").selectAll().where("id", "=", sentA.id).executeTakeFirstOrThrow();
    expect(rowA.cc_addresses).toEqual(["r@x.test"]);
    expect(rowA.to_addresses).toEqual(["q@x.test"]);
    expect(rowA.subject).not.toContain(person);
    const match = await db.transaction().execute((trx) => matchSubject(trx, a.orgId, person, TEST_CREDENTIALS_KEY));
    expect(match.mentions).toEqual({});
    expect(await db.selectFrom("sent_emails").selectAll().where("id", "=", sentB.id).executeTakeFirstOrThrow()).toEqual(
      beforeB
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
});
