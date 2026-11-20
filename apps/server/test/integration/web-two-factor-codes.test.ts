import { MINUTE_MS } from "@ea/core";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { setBreakGlassOwner } from "../../src/modules/tenancy";
import type { AuthHandle } from "../../src/platform/auth";
import { totpCode } from "../totp";

import { testDb } from "./helpers";
import { PASSWORD, WRONG_PASSWORD, makeWebTwoFactorKit, type Enrolment } from "./two-factor-helpers";

const db = testDb();
const kit = makeWebTwoFactorKit(db);
const {
  keepHandle,
  auth,
  secrets,
  Client,
  createOwner,
  createEnrolled,
  challenge,
  typedCode,
  wrongCode,
  twoFactorRow,
  twoFactorFlag,
  auditRows,
} = kit;
type Client = InstanceType<typeof Client>;

beforeAll(kit.silenceConsole);
afterEach(kit.cleanup);
afterAll(kit.close);

// Turning TOTP off and new backup codes need a code, not only the password.
describe("F128: a code for turn off and new codes", () => {
  const disable = (user: Enrolment, body: Record<string, unknown>, via?: AuthHandle) =>
    user.client.post("/two-factor/disable", body, via);
  const newCodes = (user: Enrolment, body: Record<string, unknown>) =>
    user.client.post("/two-factor/generate-backup-codes", body);
  const unchanged = async (user: Enrolment, before: { backup_codes: string }) => {
    expect(await twoFactorFlag(user.userId)).toBe(true);
    expect((await twoFactorRow(user.userId))?.backup_codes).toBe(before.backup_codes);
    expect(await auditRows(user.orgId, "web.two_factor_disabled")).toHaveLength(0);
    expect(await auditRows(user.orgId, "web.backup_codes_generated")).toHaveLength(0);
  };
  const refusals = async (user: Enrolment) =>
    (await auditRows(user.orgId, "web.two_factor_refused")).map((row) => row.data);

  test("1: the right password and no code is refused on both paths and changes nothing", async () => {
    const user = await createEnrolled();
    const before = await twoFactorRow(user.userId);
    if (!before) throw new Error("no row");
    for (const body of [
      { password: PASSWORD },
      { password: PASSWORD, code: "  " },
      { password: PASSWORD, code: 123456 },
    ]) {
      const off = await disable(user, body);
      expect(off.status).toBe(400);
      expect(off.json?.code).toBe("TWO_FACTOR_CODE_REQUIRED");
      const made = await newCodes(user, body);
      expect(made.status).toBe(400);
      expect(made.json?.code).toBe("TWO_FACTOR_CODE_REQUIRED");
    }
    await unchanged(user, before);
    expect(await refusals(user)).toEqual(
      Array.from({ length: 3 }, () => [
        { via: "web", action: "disable", reason: "missing" },
        { via: "web", action: "backup_codes", reason: "missing" },
      ]).flat()
    );
  });

  test("2: the right password and a right app code turn it off", async () => {
    const user = await createEnrolled();
    const off = await disable(user, { password: PASSWORD, code: typedCode(user.secret) });
    expect(off.status).toBe(200);
    expect(await twoFactorFlag(user.userId)).toBe(false);
    expect(await twoFactorRow(user.userId)).toBeUndefined();
    expect(await auditRows(user.orgId, "web.two_factor_disabled")).toHaveLength(1);
    expect(await refusals(user)).toEqual([]);
  });

  test("3: the right password and a right app code make ten new codes, the old ones stop", async () => {
    const user = await createEnrolled();
    const made = await newCodes(user, { password: PASSWORD, code: typedCode(user.secret) });
    expect(made.status).toBe(200);
    const fresh = made.json?.backupCodes as string[];
    expect(fresh).toHaveLength(10);
    secrets.push(...fresh);
    expect(await auditRows(user.orgId, "web.backup_codes_generated")).toHaveLength(1);
    const view = (await auth.api.viewBackupCodes({ body: { userId: user.userId } })) as { backupCodes: string[] };
    expect(view.backupCodes).toEqual(fresh);
  });

  test("4: a wrong code is refused with the plugin error and changes nothing", async () => {
    const user = await createEnrolled();
    const before = await twoFactorRow(user.userId);
    if (!before) throw new Error("no row");
    const code = wrongCode(user.secret);
    secrets.push(code);
    const off = await disable(user, { password: PASSWORD, code });
    expect(off.status).toBe(401);
    expect(off.json?.code).toBe("INVALID_CODE");
    const made = await newCodes(user, { password: PASSWORD, code });
    expect(made.status).toBe(401);
    expect(made.json?.code).toBe("INVALID_CODE");
    const backup = await disable(user, { password: PASSWORD, code: "abcde-12345" });
    expect(backup.status).toBe(401);
    expect(backup.json?.code).toBe("INVALID_BACKUP_CODE");
    await unchanged(user, before);
    expect((await twoFactorRow(user.userId))?.failed_verification_count).toBe(3);
    expect(await refusals(user)).toEqual([
      { via: "web", action: "disable", reason: "wrong" },
      { via: "web", action: "backup_codes", reason: "wrong" },
      { via: "web", action: "disable", reason: "wrong" },
    ]);
  });

  test("5: an expired app code is refused", async () => {
    const user = await createEnrolled();
    const before = await twoFactorRow(user.userId);
    if (!before) throw new Error("no row");
    const old = totpCode(user.secret, Date.now() - 300_000);
    secrets.push(old);
    const off = await disable(user, { password: PASSWORD, code: old });
    expect(off.status).toBe(401);
    expect(off.json?.code).toBe("INVALID_CODE");
    await unchanged(user, before);
  });

  test("6: a backup code works once: it is used up and a used one is refused", async () => {
    const user = await createEnrolled();
    const [first = "", second = ""] = user.codes;
    // The code is used up by the plugin's own verify; the gate then sees it as used.
    expect((await user.client.post("/two-factor/verify-backup-code", { code: first })).status).toBe(200);
    const used = await disable(user, { password: PASSWORD, code: first });
    expect(used.status).toBe(401);
    expect(used.json?.code).toBe("INVALID_BACKUP_CODE");
    expect(await twoFactorFlag(user.userId)).toBe(true);
    const before = await auditRows(user.orgId, "web.backup_code_used");
    const made = await newCodes(user, { password: PASSWORD, code: second });
    expect(made.status).toBe(200);
    secrets.push(...(made.json?.backupCodes as string[]));
    expect(await auditRows(user.orgId, "web.backup_code_used")).toHaveLength(before.length + 1);
    // The new set replaced the old one, so the second code is gone too.
    const again = await disable(user, { password: PASSWORD, code: second });
    expect(again.status).toBe(401);
    expect(await twoFactorFlag(user.userId)).toBe(true);
  });

  test("7: a backup code turns it off and is used up first", async () => {
    const user = await createEnrolled();
    const off = await disable(user, { password: PASSWORD, code: user.codes[0] ?? "" });
    expect(off.status).toBe(200);
    expect(await twoFactorFlag(user.userId)).toBe(false);
    expect(await auditRows(user.orgId, "web.backup_code_used")).toHaveLength(1);
    expect(await auditRows(user.orgId, "web.two_factor_disabled")).toHaveLength(1);
  });

  test("8: a wrong password with a right code is refused and uses up no code", async () => {
    const user = await createEnrolled();
    const before = await twoFactorRow(user.userId);
    if (!before) throw new Error("no row");
    for (const post of [disable, newCodes]) {
      const refused = await post(user, { password: WRONG_PASSWORD, code: user.codes[0] ?? "" });
      expect(refused.status).toBe(400);
      expect(refused.json?.code).toBe("INVALID_PASSWORD");
    }
    const wrongPasswordTotp = await disable(user, { password: WRONG_PASSWORD, code: wrongCode(user.secret) });
    expect(wrongPasswordTotp.json?.code).toBe("INVALID_PASSWORD");
    await unchanged(user, before);
    expect(await auditRows(user.orgId, "web.backup_code_used")).toHaveLength(0);
    expect(await refusals(user)).toEqual([]);
    expect((await twoFactorRow(user.userId))?.failed_verification_count).toBe(0);
  });

  test("9: ten wrong codes lock the account for the plugin's time, one lock row; a right code is then refused", async () => {
    const user = await createEnrolled();
    const code = wrongCode(user.secret);
    secrets.push(code);
    for (let i = 0; i < 10; i += 1) expect((await disable(user, { password: PASSWORD, code })).status).toBe(401);
    const row = await sql<{ locked_until: Date; failed_verification_count: number }>`
      SELECT locked_until, failed_verification_count FROM auth_two_factors WHERE user_id = ${user.userId}`.execute(db);
    const lockedUntil = row.rows[0]?.locked_until;
    expect(row.rows[0]?.failed_verification_count).toBe(10);
    const wait = (lockedUntil?.getTime() ?? 0) - Date.now();
    expect(wait).toBeGreaterThan(14 * MINUTE_MS);
    expect(wait).toBeLessThanOrEqual(15 * MINUTE_MS);
    const locks = await auditRows(user.orgId, "web.two_factor_locked");
    expect(locks).toHaveLength(1);
    expect(locks[0]?.data).toEqual({ via: "web", locked_until: lockedUntil?.toISOString() });

    const blocked = await disable(user, { password: PASSWORD, code: typedCode(user.secret) });
    expect(blocked.status).toBe(429);
    expect(blocked.json?.code).toBe("ACCOUNT_TEMPORARILY_LOCKED");
    expect((await newCodes(user, { password: PASSWORD, code: typedCode(user.secret) })).status).toBe(429);
    expect(await twoFactorFlag(user.userId)).toBe(true);
    // The sign-in code step shares the lock.
    const signIn = await challenge(user);
    const step = await signIn.post("/two-factor/verify-totp", { code: typedCode(user.secret) });
    expect(step.json?.code).toBe("ACCOUNT_TEMPORARILY_LOCKED");
    expect(await auditRows(user.orgId, "web.two_factor_locked")).toHaveLength(1);
    const reasons = (await refusals(user)).map((data) => data.reason);
    expect(reasons.filter((reason) => reason === "wrong")).toHaveLength(10);
    expect(reasons.filter((reason) => reason === "locked")).toHaveLength(2);

    await sql`UPDATE auth_two_factors SET locked_until = now() - interval '1 minute' WHERE user_id = ${user.userId}`.execute(
      db
    );
    expect((await disable(user, { password: PASSWORD, code: typedCode(user.secret) })).status).toBe(200);
    expect(await twoFactorFlag(user.userId)).toBe(false);
  });

  test("14: 15 parallel wrong codes: at most 10 are counted, the rest meet the lock, one lock row", async () => {
    const user = await createEnrolled();
    secrets.push("000000");
    const answers = await Promise.all(
      Array.from({ length: 15 }, () => disable(user, { password: PASSWORD, code: "000000" }))
    );
    const wrong = answers.filter((answer) => answer.status === 401);
    const locked = answers.filter((answer) => answer.status === 429);
    expect(wrong.length).toBeLessThanOrEqual(10);
    expect(wrong.length + locked.length).toBe(15);
    for (const answer of wrong) expect(answer.json?.code).toBe("INVALID_CODE");
    for (const answer of locked) expect(answer.json?.code).toBe("ACCOUNT_TEMPORARILY_LOCKED");
    expect((await twoFactorRow(user.userId))?.failed_verification_count).toBe(10);
    expect(await auditRows(user.orgId, "web.two_factor_locked")).toHaveLength(1);
    expect(await twoFactorFlag(user.userId)).toBe(true);
  });

  test("15: a failure that is not a wrong code gives the try back", async () => {
    const user = await createEnrolled();
    await sql`UPDATE auth_two_factors SET backup_codes = 'not-readable' WHERE user_id = ${user.userId}`.execute(db);
    const answer = await disable(user, { password: PASSWORD, code: "abcde-12345" });
    expect(answer.status).toBeGreaterThanOrEqual(500);
    expect((await twoFactorRow(user.userId))?.failed_verification_count).toBe(0);
    expect(await twoFactorFlag(user.userId)).toBe(true);
    expect(await refusals(user)).toEqual([]);
  });

  test("10: a right code clears the count of wrong codes", async () => {
    const user = await createEnrolled();
    const code = wrongCode(user.secret);
    secrets.push(code);
    for (let i = 0; i < 3; i += 1) await newCodes(user, { password: PASSWORD, code });
    expect((await twoFactorRow(user.userId))?.failed_verification_count).toBe(3);
    const made = await newCodes(user, { password: PASSWORD, code: typedCode(user.secret) });
    expect(made.status).toBe(200);
    secrets.push(...(made.json?.backupCodes as string[]));
    expect((await twoFactorRow(user.userId))?.failed_verification_count).toBe(0);
  });

  test("11: the break-glass owner is refused before any code is checked", async () => {
    const user = await createEnrolled();
    await setBreakGlassOwner(db, { orgId: user.orgId }, { userId: user.userId, actor: "cli", now: new Date() });
    const answer = await disable(user, { password: PASSWORD, code: user.codes[0] ?? "" }, keepHandle);
    expect(answer.status).toBe(403);
    expect(answer.json?.code).toBe("BREAK_GLASS_NEEDS_TWO_FACTOR");
    expect(await auditRows(user.orgId, "web.backup_code_used")).toHaveLength(0);
    // New codes stay allowed for the owner, with a code.
    const made = await user.client.post(
      "/two-factor/generate-backup-codes",
      { password: PASSWORD, code: typedCode(user.secret) },
      keepHandle
    );
    expect(made.status).toBe(200);
    secrets.push(...(made.json?.backupCodes as string[]));
  });

  test("12: a session of a user without TOTP (an SSO session has the same state) is not asked for a code", async () => {
    const owner = await createOwner();
    const client = new Client();
    expect((await client.signIn(owner.email)).status).toBe(200);
    const off = await client.post("/two-factor/disable", { password: PASSWORD });
    expect(off.status).toBe(200);
    const made = await client.post("/two-factor/generate-backup-codes", { password: PASSWORD });
    expect(made.status).toBe(400);
    expect(made.json?.code).toBe("TWO_FACTOR_NOT_ENABLED");
    expect(await auditRows(owner.orgId, "web.two_factor_refused")).toHaveLength(0);
  });

  test("13: no refusal row holds a code or a secret", async () => {
    const user = await createEnrolled();
    const code = wrongCode(user.secret);
    secrets.push(code);
    await disable(user, { password: PASSWORD, code });
    await disable(user, { password: PASSWORD });
    const text = JSON.stringify(await auditRows(user.orgId, "web.two_factor_refused"));
    for (const secret of [code, user.secret, ...user.codes]) expect(text).not.toContain(secret);
  });
});
