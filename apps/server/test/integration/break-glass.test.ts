import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  clearBreakGlassOwner,
  getBreakGlassUserId,
  getMembership,
  getUserAuthProfile,
  insertMembership,
  insertUser,
  isBreakGlassOwner,
  setBreakGlassOwner,
} from "../../src/modules/tenancy";

import { testDb } from "./helpers";
import { webOrg, type WebOrg } from "./web-helpers";

const db = testDb();
const NOW = new Date("2026-11-20T10:00:00Z");
const MISSING = { orgId: "00000000-0000-4000-8000-000000000000" };

let org: WebOrg;
let ctx: { orgId: string };
let secondOwnerId: string;

const set = (userId: string, orgCtx = ctx) => setBreakGlassOwner(db, orgCtx, { userId, actor: "cli", now: NOW });
const turnTotpOn = (userId: string) =>
  db.updateTable("users").set({ two_factor_enabled: true }).where("id", "=", userId).execute();

async function auditRows(orgId: string, event: string) {
  return db
    .selectFrom("audit_log")
    .select(["actor", "data", "created_at"])
    .where("org_id", "=", orgId)
    .where("event", "=", event)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
}

beforeAll(async () => {
  org = await webOrg(db);
  ctx = { orgId: org.orgId };
  await turnTotpOn(org.ownerId);
  await turnTotpOn(org.assistantId);
  const second = await insertUser(db, { email: `second-owner-${randomUUID()}@x.test`, displayName: "Second" });
  secondOwnerId = second.id;
  await insertMembership(db, ctx, { userId: secondOwnerId, role: "owner" });
});

afterAll(async () => {
  await org.cleanup();
  await db.deleteFrom("users").where("id", "=", secondOwnerId).execute();
  await db.destroy();
});

describe("break-glass owner (F105 stage 05)", () => {
  test("1-2 the owner with TOTP is set; the same call again is unchanged and writes no row", async () => {
    expect(await set(org.ownerId)).toEqual({ kind: "set", replaced: null });
    expect((await getMembership(db, ctx, org.ownerId))?.break_glass).toBe(true);
    const rows = await auditRows(org.orgId, "org.break_glass_set");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: "cli", data: { user_id: org.ownerId }, created_at: NOW });

    expect(await set(org.ownerId)).toEqual({ kind: "unchanged" });
    expect(await auditRows(org.orgId, "org.break_glass_set")).toHaveLength(1);
  });

  test("3 an assistant, a non-member and an unknown organization are refused", async () => {
    expect(await set(org.assistantId)).toEqual({ kind: "not_owner" });
    expect(await set(org.otherOwnerId)).toEqual({ kind: "not_owner" });
    expect(await set(org.ownerId, MISSING)).toEqual({ kind: "not_found" });
    expect((await getMembership(db, ctx, org.assistantId))?.break_glass).toBe(false);
  });

  test("4 a second owner needs TOTP; with it the mark moves and both changes are audited", async () => {
    expect(await set(secondOwnerId)).toEqual({ kind: "no_two_factor" });
    expect(await getBreakGlassUserId(db, ctx)).toBe(org.ownerId);

    await turnTotpOn(secondOwnerId);
    expect(await set(secondOwnerId)).toEqual({ kind: "set", replaced: org.ownerId });

    const cleared = await auditRows(org.orgId, "org.break_glass_cleared");
    expect(cleared).toHaveLength(1);
    expect(cleared[0]?.data).toEqual({ user_id: org.ownerId, reason: "replaced" });
    expect(await auditRows(org.orgId, "org.break_glass_set")).toHaveLength(2);
    expect((await getMembership(db, ctx, org.ownerId))?.break_glass).toBe(false);
    expect((await getMembership(db, ctx, secondOwnerId))?.break_glass).toBe(true);
    expect(await getBreakGlassUserId(db, ctx)).toBe(secondOwnerId);
  });

  test("7 isBreakGlassOwner is true only for the marked user", async () => {
    expect(await isBreakGlassOwner(db, secondOwnerId)).toBe(true);
    expect(await isBreakGlassOwner(db, org.ownerId)).toBe(false);
    expect(await isBreakGlassOwner(db, org.assistantId)).toBe(false);
    expect(await isBreakGlassOwner(db, MISSING.orgId)).toBe(false);
  });

  test("8 getUserAuthProfile reads twoFactorEnabled; getMembership reads break_glass", async () => {
    expect((await getUserAuthProfile(db, org.ownerId))?.twoFactorEnabled).toBe(true);
    expect((await getUserAuthProfile(db, org.otherOwnerId))?.twoFactorEnabled).toBe(false);
    expect((await getMembership(db, ctx, secondOwnerId))?.break_glass).toBe(true);
  });

  test("5 clear writes one row; a second clear finds none; an unknown organization is not_found", async () => {
    const before = (await auditRows(org.orgId, "org.break_glass_cleared")).length;
    expect(await clearBreakGlassOwner(db, ctx, { actor: "cli", now: NOW, reason: "cli" })).toEqual({
      kind: "cleared",
      userId: secondOwnerId,
    });
    const rows = await auditRows(org.orgId, "org.break_glass_cleared");
    expect(rows).toHaveLength(before + 1);
    expect(rows.at(-1)?.data).toEqual({ user_id: secondOwnerId, reason: "cli" });

    expect(await clearBreakGlassOwner(db, ctx, { actor: "cli", now: NOW, reason: "cli" })).toEqual({ kind: "none" });
    expect(await auditRows(org.orgId, "org.break_glass_cleared")).toHaveLength(before + 1);
    expect(await clearBreakGlassOwner(db, MISSING, { actor: "cli", now: NOW, reason: "cli" })).toEqual({
      kind: "not_found",
    });
  });

  test("6 the other organization is never changed by calls for this one", async () => {
    const other = { orgId: org.otherOrgId };
    expect((await getMembership(db, other, org.otherOwnerId))?.break_glass).toBe(false);
    expect(await getBreakGlassUserId(db, other)).toBeNull();
    expect(await auditRows(org.otherOrgId, "org.break_glass_set")).toHaveLength(0);
    expect(await auditRows(org.otherOrgId, "org.break_glass_cleared")).toHaveLength(0);
  });

  test("6b an owner of two organizations is marked only in the organization set", async () => {
    const other = { orgId: org.otherOrgId };
    const dual = await insertUser(db, { email: `dual-owner-${randomUUID()}@x.test`, displayName: "Dual" });
    try {
      await insertMembership(db, ctx, { userId: dual.id, role: "owner" });
      await insertMembership(db, other, { userId: dual.id, role: "owner" });
      await turnTotpOn(dual.id);

      expect(await set(dual.id)).toEqual({ kind: "set", replaced: null });
      expect((await getMembership(db, ctx, dual.id))?.break_glass).toBe(true);
      expect((await getMembership(db, other, dual.id))?.break_glass).toBe(false);
      expect(await getBreakGlassUserId(db, other)).toBeNull();

      expect(await clearBreakGlassOwner(db, ctx, { actor: "cli", now: NOW, reason: "cli" })).toEqual({
        kind: "cleared",
        userId: dual.id,
      });
      expect((await getMembership(db, other, dual.id))?.break_glass).toBe(false);
      expect(await getBreakGlassUserId(db, other)).toBeNull();
      expect(await auditRows(org.otherOrgId, "org.break_glass_set")).toHaveLength(0);
      expect(await auditRows(org.otherOrgId, "org.break_glass_cleared")).toHaveLength(0);
    } finally {
      await db.deleteFrom("users").where("id", "=", dual.id).execute();
    }
  });
});
