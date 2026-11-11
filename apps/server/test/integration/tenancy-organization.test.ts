import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  isSupportedTimeZone,
  updateOrganizationSettings,
  type UpdateOrganizationResult,
} from "../../src/modules/tenancy";
import { lockOrganization, updateOrganization } from "../../src/modules/tenancy/repo";
import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();
const NOW = new Date("2026-11-11T12:00:00Z");
const ACTOR = "actor-1";
const MISSING = { orgId: "00000000-0000-4000-8000-000000000000" };

afterAll(async () => {
  await db.destroy();
});

async function auditRows(trx: Transaction<DB>, orgId: string, event: string) {
  return trx
    .selectFrom("audit_log")
    .selectAll()
    .where("org_id", "=", orgId)
    .where("event", "=", event)
    .orderBy("id")
    .execute();
}

async function orgRow(trx: Transaction<DB>, orgId: string) {
  return trx.selectFrom("organizations").selectAll().where("id", "=", orgId).executeTakeFirstOrThrow();
}

function updatedOrg(result: UpdateOrganizationResult) {
  if (result.kind !== "updated") throw new Error(`expected updated, got ${result.kind}`);
  return result.organization;
}

describe("isSupportedTimeZone", () => {
  test("accepts a listed zone, refuses others", () => {
    expect(isSupportedTimeZone("Europe/Warsaw")).toBe(true);
    expect(isSupportedTimeZone("Mars/Base")).toBe(false);
    expect(isSupportedTimeZone("Europe/Warsaw ")).toBe(false);
  });
});

describe("updateOrganizationSettings: timezone", () => {
  test("changes the zone and writes one audit row", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrgWithMailbox(trx);
      const result = await updateOrganizationSettings(
        trx,
        { orgId },
        { timezone: "America/New_York" },
        { actor: ACTOR, now: NOW }
      );
      expect(updatedOrg(result).timezone).toBe("America/New_York");
      expect((await orgRow(trx, orgId)).timezone).toBe("America/New_York");
      const rows = await auditRows(trx, orgId, "org.timezone_changed");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.data).toEqual({ from: "Europe/Warsaw", to: "America/New_York" });
      expect(rows[0]?.actor).toBe(ACTOR);
      expect(rows[0]?.created_at).toEqual(NOW);
    });
  });

  test("the same zone again writes nothing", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrgWithMailbox(trx);
      const result = await updateOrganizationSettings(
        trx,
        { orgId },
        { timezone: "Europe/Warsaw" },
        { actor: ACTOR, now: NOW }
      );
      expect(updatedOrg(result).timezone).toBe("Europe/Warsaw");
      expect(await auditRows(trx, orgId, "org.timezone_changed")).toHaveLength(0);
    });
  });

  test("an unsupported zone is refused and nothing changes", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrgWithMailbox(trx);
      for (const timezone of ["Mars/Base", "Europe/Warsaw "]) {
        const result = await updateOrganizationSettings(trx, { orgId }, { timezone }, { actor: ACTOR, now: NOW });
        expect(result).toEqual({ kind: "bad_timezone" });
      }
      expect((await orgRow(trx, orgId)).timezone).toBe("Europe/Warsaw");
      expect(await auditRows(trx, orgId, "org.timezone_changed")).toHaveLength(0);
    });
  });
});

describe("updateOrganizationSettings: signature", () => {
  test("sets and clears the text; the audit row holds no text", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrgWithMailbox(trx);
      const ctx = { orgId };
      const set = await updateOrganizationSettings(
        trx,
        ctx,
        { styleText: "Anna Nowak\nCEO" },
        { actor: ACTOR, now: NOW }
      );
      expect(updatedOrg(set).style_text).toBe("Anna Nowak\nCEO");
      let rows = await auditRows(trx, orgId, "org.style_changed");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.data).toEqual({ set: true });
      expect(JSON.stringify(rows[0]?.data)).not.toContain("Anna");

      const cleared = await updateOrganizationSettings(trx, ctx, { styleText: null }, { actor: ACTOR, now: NOW });
      expect(updatedOrg(cleared).style_text).toBeNull();
      rows = await auditRows(trx, orgId, "org.style_changed");
      expect(rows).toHaveLength(2);
      expect(rows[1]?.data).toEqual({ set: false });

      await updateOrganizationSettings(trx, ctx, { styleText: null }, { actor: ACTOR, now: NOW });
      expect(await auditRows(trx, orgId, "org.style_changed")).toHaveLength(2);
    });
  });
});

describe("updateOrganizationSettings: both fields", () => {
  test("two audit rows for two changes", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrgWithMailbox(trx);
      const result = await updateOrganizationSettings(
        trx,
        { orgId },
        { timezone: "Europe/London", styleText: "Anna" },
        { actor: ACTOR, now: NOW }
      );
      const org = updatedOrg(result);
      expect(org.timezone).toBe("Europe/London");
      expect(org.style_text).toBe("Anna");
      expect(await auditRows(trx, orgId, "org.timezone_changed")).toHaveLength(1);
      expect(await auditRows(trx, orgId, "org.style_changed")).toHaveLength(1);
    });
  });

  test("a bad zone with a style text writes nothing", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrgWithMailbox(trx);
      const result = await updateOrganizationSettings(
        trx,
        { orgId },
        { timezone: "Mars/Base", styleText: "Anna" },
        { actor: ACTOR, now: NOW }
      );
      expect(result).toEqual({ kind: "bad_timezone" });
      expect((await orgRow(trx, orgId)).style_text).toBeNull();
      expect(await auditRows(trx, orgId, "org.style_changed")).toHaveLength(0);
    });
  });

  test("an empty patch returns the row and writes nothing", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrgWithMailbox(trx);
      const result = await updateOrganizationSettings(trx, { orgId }, {}, { actor: ACTOR, now: NOW });
      expect(updatedOrg(result).id).toBe(orgId);
      expect(await auditRows(trx, orgId, "org.timezone_changed")).toHaveLength(0);
    });
  });
});

describe("tenant filter", () => {
  test("changes only the organization of the context", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      await updateOrganizationSettings(
        trx,
        { orgId: b.orgId },
        { timezone: "Asia/Tokyo", styleText: "B" },
        { actor: ACTOR, now: NOW }
      );
      const rowA = await orgRow(trx, a.orgId);
      expect(rowA.timezone).toBe("Europe/Warsaw");
      expect(rowA.style_text).toBeNull();
      expect((await orgRow(trx, b.orgId)).timezone).toBe("Asia/Tokyo");
      expect(await auditRows(trx, a.orgId, "org.timezone_changed")).toHaveLength(0);
    });
  });

  test("an unknown organization gives undefined and not_found", async () => {
    await withRollback(db, async (trx) => {
      expect(await lockOrganization(trx, MISSING)).toBeUndefined();
      expect(await updateOrganization(trx, MISSING, { timezone: "Europe/London" })).toBeUndefined();
      const result = await updateOrganizationSettings(
        trx,
        MISSING,
        { timezone: "Europe/London" },
        { actor: ACTOR, now: NOW }
      );
      expect(result).toEqual({ kind: "not_found" });
    });
  });
});
