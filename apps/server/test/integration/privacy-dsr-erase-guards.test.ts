import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { matchSubject } from "../../src/modules/privacy";
import { dsrAddressHash } from "../../src/platform/crypto";

import { testDb, TEST_CREDENTIALS_KEY } from "./helpers";
import { KEY, unique, makeDsrKit } from "./privacy-dsr-erase-helpers";

// `eraseSubjectData`: repeats, failures, other organizations, the audit row and the column limits. The seed is committed (the erase runs its own transaction and takes row locks);
// `afterEach` removes it. The connection is the `app` role.
const db = testDb();
const { seedOrg, snapshot, count, erase, erased, eraseAudit, cleanup } = makeDsrKit(db);

afterEach(cleanup);

afterAll(async () => {
  await db.destroy();
});

describe("eraseSubjectData", () => {
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
    const match = await db.transaction().execute((trx) => matchSubject(trx, w.orgId, w.person, TEST_CREDENTIALS_KEY));
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
