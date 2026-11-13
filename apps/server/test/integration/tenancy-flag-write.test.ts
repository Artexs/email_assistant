import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { createOrganizationWithOwner, setOrgFeature } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";

import { testDb, withRollback } from "./helpers";

const db = testDb();
const NOW = new Date("2026-11-20T10:00:00Z");
const MINUTE_LATER = new Date(NOW.getTime() + 60_000);
const MISSING = { orgId: "00000000-0000-4000-8000-000000000000" };

afterAll(async () => {
  await db.destroy();
});

async function newOrg(trx: Transaction<DB>) {
  const suffix = randomUUID();
  const { orgId } = await createOrganizationWithOwner(trx, {
    orgName: `Org ${suffix}`,
    timezone: "Europe/Warsaw",
    email: `owner-${suffix}@x.test`,
    displayName: "Owner",
  });
  return { orgId };
}

const on = (flag: string, now = NOW) => ({ flag, enabled: true, actor: "cli", now });
const off = (flag: string, now = NOW) => ({ flag, enabled: false, actor: "cli", now });

async function flagAudit(trx: Transaction<DB>, orgId: string) {
  return trx
    .selectFrom("audit_log")
    .select(["actor", "data", "created_at"])
    .where("org_id", "=", orgId)
    .where("event", "=", "org.flag_changed")
    .orderBy("created_at")
    .orderBy("id")
    .execute();
}

async function featureRows(trx: Transaction<DB>, orgId: string) {
  return trx
    .selectFrom("org_features")
    .select(["flag", "enabled", "set_by", "set_at"])
    .where("org_id", "=", orgId)
    .execute();
}

describe("setOrgFeature", () => {
  test("1. no row, on: changed, the row and one audit row", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await newOrg(trx);
      expect(await setOrgFeature(trx, { orgId }, on("stats_page"))).toEqual({
        kind: "changed",
        flag: "stats_page",
        before: null,
        enabled: true,
      });
      expect(await featureRows(trx, orgId)).toEqual([
        { flag: "stats_page", enabled: true, set_by: "cli", set_at: NOW },
      ]);
      const audit = await flagAudit(trx, orgId);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actor: "cli", data: { flag: "stats_page", enabled: true }, created_at: NOW });
    });
  });

  test("2. no row, off: a row with enabled false is written (D11)", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await newOrg(trx);
      expect(await setOrgFeature(trx, { orgId }, off("sent_sync"))).toEqual({
        kind: "changed",
        flag: "sent_sync",
        before: null,
        enabled: false,
      });
      expect(await featureRows(trx, orgId)).toEqual([
        { flag: "sent_sync", enabled: false, set_by: "cli", set_at: NOW },
      ]);
      const audit = await flagAudit(trx, orgId);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.data).toEqual({ flag: "sent_sync", enabled: false });
    });
  });

  test("3. same value again: unchanged, no write, no new audit row", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await newOrg(trx);
      await setOrgFeature(trx, { orgId }, on("stats_page"));
      expect(await setOrgFeature(trx, { orgId }, on("stats_page", MINUTE_LATER))).toEqual({
        kind: "unchanged",
        flag: "stats_page",
        enabled: true,
      });
      expect((await featureRows(trx, orgId))[0]?.set_at).toEqual(NOW);
      expect(await flagAudit(trx, orgId)).toHaveLength(1);
    });
  });

  test("4. on, then off: changed with before true, two audit rows", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await newOrg(trx);
      await setOrgFeature(trx, { orgId }, on("stats_page"));
      expect(await setOrgFeature(trx, { orgId }, off("stats_page", MINUTE_LATER))).toEqual({
        kind: "changed",
        flag: "stats_page",
        before: true,
        enabled: false,
      });
      expect(await featureRows(trx, orgId)).toEqual([
        { flag: "stats_page", enabled: false, set_by: "cli", set_at: MINUTE_LATER },
      ]);
      expect(await flagAudit(trx, orgId)).toHaveLength(2);
    });
  });

  test("5. an unknown key is refused before any write", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await newOrg(trx);
      for (const flag of ["stats_pag", "toString"]) {
        expect(await setOrgFeature(trx, { orgId }, on(flag))).toEqual({ kind: "unknown_flag" });
      }
      expect(await featureRows(trx, orgId)).toEqual([]);
      expect(await flagAudit(trx, orgId)).toEqual([]);
    });
  });

  test("6. a missing organization: not_found, no audit row", async () => {
    await withRollback(db, async (trx) => {
      expect(await setOrgFeature(trx, MISSING, on("stats_page"))).toEqual({ kind: "not_found" });
      expect(await flagAudit(trx, MISSING.orgId)).toEqual([]);
      expect(await featureRows(trx, MISSING.orgId)).toEqual([]);
    });
  });

  test("7. tenant: a write for org A leaves org B alone", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      await setOrgFeature(trx, a, on("stats_page"));
      expect(await featureRows(trx, b.orgId)).toEqual([]);
      expect(await flagAudit(trx, b.orgId)).toEqual([]);
      expect(await featureRows(trx, a.orgId)).toHaveLength(1);
    });
  });

  test("8. two writes at once: one changed, one unchanged, one audit row", async () => {
    const suffix = randomUUID();
    const { orgId, userId } = await createOrganizationWithOwner(db, {
      orgName: `Org ${suffix}`,
      timezone: "Europe/Warsaw",
      email: `owner-${suffix}@x.test`,
      displayName: "Owner",
    });
    try {
      const results = await Promise.all([
        setOrgFeature(db, { orgId }, on("stats_page")),
        setOrgFeature(db, { orgId }, on("stats_page")),
      ]);
      expect(results.map((result) => result.kind).sort()).toEqual(["changed", "unchanged"]);
      const audit = await db
        .selectFrom("audit_log")
        .select("id")
        .where("org_id", "=", orgId)
        .where("event", "=", "org.flag_changed")
        .execute();
      expect(audit).toHaveLength(1);
    } finally {
      await db.deleteFrom("organizations").where("id", "=", orgId).execute();
      await db.deleteFrom("users").where("id", "=", userId).execute();
    }
  });
});
