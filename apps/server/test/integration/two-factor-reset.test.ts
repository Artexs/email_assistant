import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { sql } from "kysely";

import { auditEvents } from "../../src/modules/audit";
import { listBreakGlassOrgIdsOfUser, resetTwoFactor, setBreakGlassOwner } from "../../src/modules/tenancy";
import { insertMembership, lockOrganization, setBreakGlassFlag } from "../../src/modules/tenancy/repo";
import { holdsToken } from "../totp";

import { testDb } from "./helpers";
import { makeTwoFactorKit, PASSWORD } from "./two-factor-helpers";

const db = testDb();
const kit = makeTwoFactorKit(db);
const NOW = new Date("2026-11-20T10:00:00Z");

let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;
let warnSpy: ReturnType<typeof spyOn>;

beforeAll(() => {
  logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
  errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
  warnSpy = spyOn(console, "warn").mockImplementation((): void => undefined);
});

afterEach(async () => {
  await kit.cleanup();
});

afterAll(async () => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  warnSpy.mockRestore();
  await kit.handle.close();
  await db.destroy();
});

const reset = (orgId: string, userId: string) => resetTwoFactor(db, { orgId }, { userId, actor: "cli", now: NOW });

async function state(userId: string, orgId: string) {
  const one = async <T>(query: ReturnType<typeof sql<T>>) => (await query.execute(db)).rows[0];
  return {
    rows: Number(
      (await one(sql<{ n: string }>`SELECT count(*) AS n FROM auth_two_factors WHERE user_id = ${userId}`))?.n
    ),
    flag: (await one(sql<{ f: boolean }>`SELECT two_factor_enabled AS f FROM users WHERE id = ${userId}`))?.f,
    sessions: Number(
      (await one(sql<{ n: string }>`SELECT count(*) AS n FROM auth_sessions WHERE user_id = ${userId}`))?.n
    ),
    trust: Number(
      (await one(sql<{ n: string }>`SELECT count(*) AS n FROM auth_verifications WHERE value = ${userId}`))?.n
    ),
    breakGlass: (
      await one(
        sql<{ b: boolean }>`SELECT break_glass AS b FROM memberships WHERE org_id = ${orgId} AND user_id = ${userId}`
      )
    )?.b,
    resetRows: await auditRows(orgId, auditEvents.webTwoFactorReset),
    clearedRows: await auditRows(orgId, auditEvents.orgBreakGlassCleared),
  };
}

// The rows of one user only (no organization audit rows).
async function userState(userId: string, orgId: string) {
  const { rows, flag, sessions, trust, breakGlass } = await state(userId, orgId);
  return { rows, flag, sessions, trust, breakGlass };
}

async function auditRows(orgId: string, event: string) {
  const result = await sql<{ actor: string; data: Record<string, unknown> }>`
    SELECT actor, data FROM audit_log WHERE org_id = ${orgId} AND event = ${event} ORDER BY id`.execute(db);
  return result.rows;
}

// An enrolled owner with two sessions, a trusted device and the break-glass mark.
async function createFullOwner() {
  const user = await kit.createEnrolled();
  const second = new kit.Client();
  const challenged = await second.signIn(user.email);
  expect(challenged.json?.twoFactorRedirect).toBe(true);
  const verified = await second.post("/two-factor/verify-totp", {
    code: kit.typedCode(user.secret),
    trustDevice: true,
  });
  expect(verified.status).toBe(200);
  const marked = await setBreakGlassOwner(db, { orgId: user.orgId }, { userId: user.userId, actor: "cli", now: NOW });
  expect(marked.kind).toBe("set");
  return { ...user, second };
}

describe("resetTwoFactor", () => {
  test("1-3. the reset ends the second factor, the sessions, the trust and the mark; a repeat run is safe", async () => {
    const user = await createFullOwner();
    // A bystander in another organization: two sessions, a trust row, the second factor and the mark.
    const bystander = await createFullOwner();
    const bystanderBefore = await state(bystander.userId, bystander.orgId);
    expect(bystanderBefore).toMatchObject({ rows: 1, flag: true, sessions: 2, breakGlass: true });
    expect(bystanderBefore.trust).toBeGreaterThan(0);
    const before = await state(user.userId, user.orgId);
    expect(before).toMatchObject({ rows: 1, flag: true, sessions: 2, breakGlass: true });
    expect(before.trust).toBeGreaterThan(0);

    const first = await reset(user.orgId, user.userId);
    expect(first).toEqual({ kind: "reset", hadTwoFactor: true, sessionsEnded: 2, breakGlassCleared: [user.orgId] });
    const after = await state(user.userId, user.orgId);
    expect(after).toMatchObject({ rows: 0, flag: false, sessions: 0, trust: 0, breakGlass: false });
    expect(after.resetRows).toEqual([{ actor: "cli", data: { via: "cli", sessions_ended: 2 } }]);
    expect(after.clearedRows).toEqual([{ actor: "cli", data: { user_id: user.userId, reason: "two_factor_reset" } }]);

    // 2. A password sign-in gives a session at once; the old cookies are dead.
    const fresh = new kit.Client();
    const signedIn = await fresh.signIn(user.email);
    expect(signedIn.status).toBe(200);
    expect(signedIn.json?.twoFactorRedirect).toBeUndefined();
    expect(fresh.jar.has("ea.session_token")).toBe(true);
    expect((await user.client.call("GET", "/get-session")).json).toBeNull();
    expect((await user.second.call("GET", "/get-session")).json).toBeNull();

    // 3. The repeat run ends the one new session and writes one more audit row.
    const again = await reset(user.orgId, user.userId);
    expect(again).toEqual({ kind: "reset", hadTwoFactor: false, sessionsEnded: 1, breakGlassCleared: [] });
    const third = await reset(user.orgId, user.userId);
    expect(third).toEqual({ kind: "reset", hadTwoFactor: false, sessionsEnded: 0, breakGlassCleared: [] });
    const last = await state(user.userId, user.orgId);
    expect(last.resetRows.map((row) => row.data)).toEqual([
      { via: "cli", sessions_ended: 2 },
      { via: "cli", sessions_ended: 1 },
      { via: "cli", sessions_ended: 0 },
    ]);
    expect(last.clearedRows).toHaveLength(1);
    expect(last).toMatchObject({ rows: 0, flag: false, sessions: 0, trust: 0, breakGlass: false });
    expect(await state(bystander.userId, bystander.orgId)).toEqual(bystanderBefore);
  });

  test("1b. a user with the mark in two organizations: both marks clear, the audit rows are flat, a bystander is untouched", async () => {
    const user = await createFullOwner(); // the mark in organization A
    const orgB = await kit.createOwner();
    await insertMembership(db, { orgId: orgB.orgId }, { userId: user.userId, role: "owner" });
    const marked = await setBreakGlassOwner(db, { orgId: orgB.orgId }, { userId: user.userId, actor: "cli", now: NOW });
    expect(marked.kind).toBe("set");
    const bystander = await createFullOwner();
    const bystanderBefore = await state(bystander.userId, bystander.orgId);
    const ownerBBefore = await userState(orgB.userId, orgB.orgId);

    // The list holds only the organizations of this user, not the bystander's.
    expect(await listBreakGlassOrgIdsOfUser(db, user.userId)).toEqual([user.orgId, orgB.orgId].sort());

    const result = await reset(user.orgId, user.userId);
    expect(result).toEqual({
      kind: "reset",
      hadTwoFactor: true,
      sessionsEnded: 2,
      breakGlassCleared: [user.orgId, orgB.orgId].sort(),
    });
    expect(await listBreakGlassOrgIdsOfUser(db, user.userId)).toEqual([]);
    for (const orgId of [user.orgId, orgB.orgId]) {
      expect(await auditRows(orgId, auditEvents.orgBreakGlassCleared)).toEqual([
        { actor: "cli", data: { user_id: user.userId, reason: "two_factor_reset" } },
      ]);
    }
    // One reset row, in the organization the operator named.
    expect(await auditRows(user.orgId, auditEvents.webTwoFactorReset)).toHaveLength(1);
    expect(await auditRows(orgB.orgId, auditEvents.webTwoFactorReset)).toHaveLength(0);
    expect(await state(bystander.userId, bystander.orgId)).toEqual(bystanderBefore);
    expect(await userState(orgB.userId, orgB.orgId)).toEqual(ownerBBefore);
  });

  test("1c. the mark moves to another user while the reset waits on the lock: the other mark stays", async () => {
    const user = await createFullOwner();
    const other = await kit.createEnrolled(); // V: a member of the organization of U, no mark yet
    await insertMembership(db, { orgId: user.orgId }, { userId: other.userId, role: "owner" });

    // Deterministic: transaction A holds the organization lock and moves the mark U → V (what the break-glass
    // replace does). The reset has already read the list (it reads committed rows), so it waits on the lock.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const mover = db.transaction().execute(async (trx) => {
      await lockOrganization(trx, { orgId: user.orgId });
      await setBreakGlassFlag(trx, { orgId: user.orgId }, user.userId, false);
      await setBreakGlassFlag(trx, { orgId: user.orgId }, other.userId, true);
      locked();
      await gate;
    });
    await isLocked;
    const resetting = reset(user.orgId, user.userId);
    // Wait until a backend waits on a lock (the reset on the organization row), up to 10 s.
    for (let i = 0; i < 200; i++) {
      const waiting = await sql<{ n: string }>`
        SELECT count(*) AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%from "organizations"%'`.execute(
        db
      );
      if (Number(waiting.rows[0]?.n) > 0) break;
      await Bun.sleep(50);
    }
    release();
    await mover;
    const result = await resetting;

    expect(result).toEqual({ kind: "reset", hadTwoFactor: true, sessionsEnded: 2, breakGlassCleared: [] });
    expect((await state(other.userId, user.orgId)).breakGlass).toBe(true);
    expect((await state(user.userId, user.orgId)).breakGlass).toBe(false);
    // No cleared row names V, and no other row is written.
    expect(await auditRows(user.orgId, auditEvents.orgBreakGlassCleared)).toEqual([]);
    expect(await auditRows(user.orgId, auditEvents.webTwoFactorReset)).toHaveLength(1);
  });

  test("4a. a mixed state: the flag on and an unverified row; both go", async () => {
    const owner = await kit.createOwner();
    const client = new kit.Client();
    await client.signIn(owner.email);
    expect((await client.post("/two-factor/enable", { password: PASSWORD })).status).toBe(200);
    await sql`UPDATE users SET two_factor_enabled = true WHERE id = ${owner.userId}`.execute(db);
    const before = await state(owner.userId, owner.orgId);
    expect(before).toMatchObject({ rows: 1, flag: true });
    expect((await sql`SELECT verified FROM auth_two_factors WHERE user_id = ${owner.userId}`.execute(db)).rows).toEqual(
      [{ verified: false }]
    );

    const result = await reset(owner.orgId, owner.userId);
    expect(result).toMatchObject({ kind: "reset", hadTwoFactor: true });
    expect(await state(owner.userId, owner.orgId)).toMatchObject({ rows: 0, flag: false });
  });

  test("4b. a mixed state: the flag off and a verified row; the row goes and enrolment works again", async () => {
    const user = await kit.createEnrolled();
    await sql`UPDATE users SET two_factor_enabled = false WHERE id = ${user.userId}`.execute(db);
    expect(await state(user.userId, user.orgId)).toMatchObject({ rows: 1, flag: false });

    const result = await reset(user.orgId, user.userId);
    expect(result).toMatchObject({ kind: "reset", hadTwoFactor: true });
    expect(await state(user.userId, user.orgId)).toMatchObject({ rows: 0, flag: false });

    const client = new kit.Client();
    expect((await client.signIn(user.email)).status).toBe(200);
    expect((await client.post("/two-factor/enable", { password: PASSWORD })).status).toBe(200);
  });

  test("5. a user who is not a member of the organization: not_member, nothing changes", async () => {
    const member = await kit.createEnrolled();
    const stranger = await kit.createEnrolled();
    const before = await state(stranger.userId, stranger.orgId);

    expect(await reset(member.orgId, stranger.userId)).toEqual({ kind: "not_member" });
    expect(await state(stranger.userId, stranger.orgId)).toEqual(before);
    expect(await state(member.userId, member.orgId)).toMatchObject({ rows: 1, flag: true });
    expect((await stranger.client.call("GET", "/get-session")).json).not.toBeNull();
  });

  test("6. one transaction: a throw after the call rolls back every write", async () => {
    const user = await createFullOwner();
    const before = await state(user.userId, user.orgId);

    await expect(
      db.transaction().execute(async (trx) => {
        const result = await resetTwoFactor(
          trx,
          { orgId: user.orgId },
          { userId: user.userId, actor: "cli", now: NOW }
        );
        expect(result).toMatchObject({ kind: "reset", sessionsEnded: 2 });
        throw new Error("rollback probe");
      })
    ).rejects.toThrow("rollback probe");

    expect(await state(user.userId, user.orgId)).toEqual(before);
    expect((await user.client.call("GET", "/get-session")).json).not.toBeNull();
  });

  test("7. no console line holds an address, a secret or a code", () => {
    const lines = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls].map((call) =>
      (call as unknown[]).map((part) => String(part)).join(" ")
    );
    expect(kit.emails.length).toBeGreaterThan(0);
    expect(kit.secrets.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(holdsToken(line, "otpauth")).toBe(false);
      for (const email of kit.emails) expect(line.includes(email)).toBe(false);
      for (const secret of kit.secrets) expect(holdsToken(line, secret)).toBe(false);
    }
    expect(lines.some((line) => line.includes("two_factor_reset"))).toBe(true);
  });
});
