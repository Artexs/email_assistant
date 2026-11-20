import { randomBytes } from "node:crypto";

import { DAY_MS } from "@ea/core";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { clearBreakGlassOwner, isBreakGlassOwner, setBreakGlassOwner } from "../../src/modules/tenancy";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import { createApp } from "../../src/platform/http";
import { webDeps } from "../../src/web";
import { secretOfUri } from "../totp";

import { testDb } from "./helpers";
import { BASE_URL, PASSWORD, SECRET, WRONG_PASSWORD, makeWebTwoFactorKit, type Enrolment } from "./two-factor-helpers";

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
  countSessions,
  loginRows,
  auditRows,
  trustRows,
  enrol,
} = kit;
type Client = InstanceType<typeof Client>;

beforeAll(kit.silenceConsole);
afterEach(kit.cleanup);
afterAll(kit.close);

describe("two-factor events", () => {
  test("1, 1a: enrolment writes one two_factor_enabled row, no login row, and ends the other sessions", async () => {
    const owner = await createOwner();
    const jarA = new Client();
    const jarB = new Client();
    await jarA.signIn(owner.email);
    await jarB.signIn(owner.email);
    expect(await countSessions(owner.userId)).toBe(2);
    const loginsBefore = (await loginRows(owner.orgId)).length;
    await enrol(jarA);
    const enabled = await auditRows(owner.orgId, "web.two_factor_enabled");
    expect(enabled).toHaveLength(1);
    expect(enabled[0]?.data).toEqual({ via: "web" });
    expect(enabled[0]?.actor).toBe(owner.userId);
    expect((await loginRows(owner.orgId)).length).toBe(loginsBefore);
    expect((await jarB.call("GET", "/get-session")).json).toBeNull();
    expect(await countSessions(owner.userId)).toBe(1);
    const mine = await jarA.call("GET", "/get-session");
    expect((mine.json?.user as { id?: string } | undefined)?.id).toBe(owner.userId);
  });

  test("2: a code check of a user who already has TOTP writes no new enabled row", async () => {
    const user = await createEnrolled();
    expect(await auditRows(user.orgId, "web.two_factor_enabled")).toHaveLength(1);
    const checked = await user.client.post("/two-factor/verify-totp", { code: typedCode(user.secret) });
    expect(checked.status).toBe(200);
    expect(await auditRows(user.orgId, "web.two_factor_enabled")).toHaveLength(1);
  });

  test("3: enrolling again ends an old trusted device", async () => {
    const user = await createEnrolled();
    const jarA = await challenge(user);
    expect(
      (await jarA.post("/two-factor/verify-totp", { code: typedCode(user.secret), trustDevice: true })).status
    ).toBe(200);
    const trust = jarA.jar.get("ea.trust_device") ?? "";
    expect(trust).not.toBe("");

    const jarB = await challenge(user);
    expect((await jarB.post("/two-factor/verify-backup-code", { code: user.codes[0] ?? "" })).status).toBe(200);
    expect((await jarB.post("/two-factor/disable", { password: PASSWORD, code: typedCode(user.secret) })).status).toBe(
      200
    );
    const again = await jarB.post("/two-factor/enable", { password: PASSWORD });
    expect(again.status).toBe(200);
    const secret = secretOfUri(String(again.json?.totpURI));
    secrets.push(secret, String(again.json?.totpURI), ...(again.json?.backupCodes as string[]));
    // The device of jar A is still trusted before the second enrolment.
    const rows = await trustRows(user.userId);
    expect(rows).toHaveLength(1);
    const days = ((rows[0]?.expires_at.getTime() ?? 0) - Date.now()) / DAY_MS;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);

    expect((await jarB.post("/two-factor/verify-totp", { code: typedCode(secret) })).status).toBe(200);
    expect(await trustRows(user.userId)).toHaveLength(0);

    const old = new Client();
    old.jar.set("ea.trust_device", trust);
    const answer = await old.signIn(user.email);
    expect(answer.status).toBe(200);
    expect(answer.json?.twoFactorRedirect).toBe(true);
    expect(old.has("ea.session_token")).toBe(false);
  });

  test("4: a backup-code sign-in writes web.login and one backup_code_used", async () => {
    const user = await createEnrolled();
    const client = await challenge(user);
    const before = (await auditRows(user.orgId, "web.backup_code_used")).length;
    expect((await client.post("/two-factor/verify-backup-code", { code: user.codes[0] ?? "" })).status).toBe(200);
    const logins = await loginRows(user.orgId);
    expect(logins[logins.length - 1]).toEqual({ via: "web", second_factor: "backup_code" });
    const used = await auditRows(user.orgId, "web.backup_code_used");
    expect(used).toHaveLength(before + 1);
    expect(used[used.length - 1]?.data).toEqual({ via: "web" });
    expect(used[used.length - 1]?.actor).toBe(user.userId);
  });

  test("4a: a signed-in user checks a backup code: one row, no login row", async () => {
    const user = await createEnrolled();
    const loginsBefore = (await loginRows(user.orgId)).length;
    const view = (await auth.api.viewBackupCodes({ body: { userId: user.userId } })) as { backupCodes: string[] };
    expect(view.backupCodes).toHaveLength(10);
    const answer = await user.client.post("/two-factor/verify-backup-code", { code: user.codes[1] ?? "" });
    expect(answer.status).toBe(200);
    const used = await auditRows(user.orgId, "web.backup_code_used");
    expect(used).toHaveLength(1);
    expect(used[0]?.actor).toBe(user.userId);
    expect((await loginRows(user.orgId)).length).toBe(loginsBefore);
    const after = (await auth.api.viewBackupCodes({ body: { userId: user.userId } })) as { backupCodes: string[] };
    expect(after.backupCodes).toHaveLength(9);
  });

  test("4b: disableSession is refused with and without a session", async () => {
    const user = await createEnrolled();
    const client = await challenge(user);
    const refused = await client.post("/two-factor/verify-backup-code", {
      code: user.codes[0] ?? "",
      disableSession: true,
    });
    expect(refused.status).toBe(400);
    expect(refused.json?.code).toBe("DISABLE_SESSION_REFUSED");
    expect(client.has("ea.session_token")).toBe(false);
    const withSession = await user.client.post("/two-factor/verify-backup-code", {
      code: user.codes[0] ?? "",
      disableSession: true,
    });
    expect(withSession.status).toBe(400);
    expect(withSession.json?.code).toBe("DISABLE_SESSION_REFUSED");
    const view = (await auth.api.viewBackupCodes({ body: { userId: user.userId } })) as { backupCodes: string[] };
    expect(view.backupCodes).toHaveLength(10);
    expect(await auditRows(user.orgId, "web.backup_code_used")).toHaveLength(0);
  });

  test("5: disable writes one row; a wrong password writes none", async () => {
    const user = await createEnrolled();
    const wrong = await user.client.post("/two-factor/disable", { password: WRONG_PASSWORD });
    expect(wrong.status).toBe(400);
    expect(wrong.json?.code).toBe("INVALID_PASSWORD");
    expect(await auditRows(user.orgId, "web.two_factor_disabled")).toHaveLength(0);
    expect(
      (await user.client.post("/two-factor/disable", { password: PASSWORD, code: typedCode(user.secret) })).status
    ).toBe(200);
    const rows = await auditRows(user.orgId, "web.two_factor_disabled");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.data).toEqual({ via: "web" });
    expect(rows[0]?.actor).toBe(user.userId);
  });

  describe("F105 stage 06: the break-glass owner keeps TOTP", () => {
    const mark = async (user: Enrolment) => {
      await setBreakGlassOwner(db, { orgId: user.orgId }, { userId: user.userId, actor: "cli", now: new Date() });
    };

    test("1, 2: the marked owner cannot turn TOTP off; after the mark is cleared the same call works", async () => {
      const user = await createEnrolled();
      await mark(user);
      expect(await isBreakGlassOwner(db, user.userId)).toBe(true);
      const refused = await user.client.post("/two-factor/disable", { password: PASSWORD }, keepHandle);
      expect(refused.status).toBe(403);
      expect(refused.json?.code).toBe("BREAK_GLASS_NEEDS_TWO_FACTOR");
      expect(await twoFactorFlag(user.userId)).toBe(true);
      expect(await twoFactorRow(user.userId)).toBeDefined();
      expect(await auditRows(user.orgId, "web.two_factor_disabled")).toHaveLength(0);
      await clearBreakGlassOwner(db, { orgId: user.orgId }, { actor: "cli", now: new Date(), reason: "cli" });
      expect(
        (
          await user.client.post(
            "/two-factor/disable",
            { password: PASSWORD, code: typedCode(user.secret) },
            keepHandle
          )
        ).status
      ).toBe(200);
      expect(await twoFactorFlag(user.userId)).toBe(false);
      expect(await twoFactorRow(user.userId)).toBeUndefined();
    });

    test("3: a handle without keepsTwoFactor lets a marked user turn TOTP off", async () => {
      const user = await createEnrolled();
      await mark(user);
      expect(await isBreakGlassOwner(db, user.userId)).toBe(true);
      expect(
        (await user.client.post("/two-factor/disable", { password: PASSWORD, code: typedCode(user.secret) })).status
      ).toBe(200);
      expect(await twoFactorFlag(user.userId)).toBe(false);
    });

    test("4: with a session two days old the marked owner still gets 403; after the clear it gets 200", async () => {
      const user = await createEnrolled();
      await mark(user);
      expect(await isBreakGlassOwner(db, user.userId)).toBe(true);
      await sql`UPDATE auth_sessions SET created_at = now() - interval '2 days' WHERE user_id = ${user.userId}`.execute(
        db
      );
      const refused = await user.client.post("/two-factor/disable", { password: PASSWORD }, keepHandle);
      expect(refused.status).toBe(403);
      expect(refused.json?.code).toBe("BREAK_GLASS_NEEDS_TWO_FACTOR");
      expect(await twoFactorFlag(user.userId)).toBe(true);
      await clearBreakGlassOwner(db, { orgId: user.orgId }, { actor: "cli", now: new Date(), reason: "cli" });
      const allowed = await user.client.post(
        "/two-factor/disable",
        { password: PASSWORD, code: typedCode(user.secret) },
        keepHandle
      );
      expect(allowed.status).toBe(200);
      expect(await twoFactorFlag(user.userId)).toBe(false);
    });

    test("5: no session cookie gets 401 and nothing changes", async () => {
      const user = await createEnrolled();
      await mark(user);
      const answer = await new Client().post("/two-factor/disable", { password: PASSWORD }, keepHandle);
      expect(answer.status).toBe(401);
      expect(await twoFactorFlag(user.userId)).toBe(true);
      expect(await twoFactorRow(user.userId)).toBeDefined();
      expect(await auditRows(user.orgId, "web.two_factor_disabled")).toHaveLength(0);
    });

    test("6: a failed session read in the hook does not let the disable through", async () => {
      const user = await createEnrolled();
      await mark(user);
      // The first read (the hook's) fails once; Better Auth's own later read would work.
      const context = await keepHandle.auth.$context;
      const original = context.internalAdapter.findSession;
      let failed = 0;
      context.internalAdapter.findSession = (async (...args: Parameters<typeof original>) => {
        if (failed === 0) {
          failed += 1;
          throw new Error("session read failed (test)");
        }
        return original(...args);
      }) as typeof original;
      try {
        const answer = await user.client.post("/two-factor/disable", { password: PASSWORD }, keepHandle);
        expect(failed).toBe(1);
        expect(answer.status).toBeGreaterThanOrEqual(400);
      } finally {
        context.internalAdapter.findSession = original;
      }
      expect(await twoFactorFlag(user.userId)).toBe(true);
      expect(await twoFactorRow(user.userId)).toBeDefined();
      expect(await auditRows(user.orgId, "web.two_factor_disabled")).toHaveLength(0);
    });

    test("7: the production web wiring (webDeps) refuses the marked owner", async () => {
      const user = await createEnrolled();
      await mark(user);
      const web = webDeps(
        loadConfig({
          ...process.env,
          WEB_BASE_URL: BASE_URL,
          WEB_AUTH_SECRET: SECRET,
          WEB_DIST: "/nonexistent/dist",
        }),
        db,
        {
          secrets: createSecretBox(randomBytes(32).toString("base64"), 1),
          actionsScope: { kind: "off" },
          sendScope: { kind: "off" },
          botUsername: null,
        }
      );
      if (web === null) throw new Error("webDeps returned null");
      try {
        const app = createApp({ checkDb: async () => true, web });
        const cookie = [...user.client.jar].map(([name, value]) => `${name}=${value}`).join("; ");
        const refused = await app.request("/api/auth/two-factor/disable", {
          method: "POST",
          headers: { origin: BASE_URL, "content-type": "application/json", cookie },
          body: JSON.stringify({ password: PASSWORD }),
        });
        expect(refused.status).toBe(403);
        expect(((await refused.json()) as { code?: string }).code).toBe("BREAK_GLASS_NEEDS_TWO_FACTOR");
        expect(await twoFactorFlag(user.userId)).toBe(true);
      } finally {
        await web.close();
      }
    });
  });

  test("6: new backup codes write one row and the old codes stop working", async () => {
    const user = await createEnrolled();
    const made = await user.client.post("/two-factor/generate-backup-codes", {
      password: PASSWORD,
      code: typedCode(user.secret),
    });
    expect(made.status).toBe(200);
    const fresh = made.json?.backupCodes as string[];
    expect(fresh).toHaveLength(10);
    secrets.push(...fresh);
    const rows = await auditRows(user.orgId, "web.backup_codes_generated");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.data).toEqual({ via: "web" });
    const client = await challenge(user);
    const old = await client.post("/two-factor/verify-backup-code", { code: user.codes[0] ?? "" });
    expect(old.status).toBe(401);
    expect(old.json?.code).toBe("INVALID_BACKUP_CODE");
  });

  test("7, 8: ten wrong codes write one lock row; an expired lock clears", async () => {
    const user = await createEnrolled();
    const code = wrongCode(user.secret);
    secrets.push(code);
    let last: { status: number; json: Record<string, unknown> | null } | undefined;
    for (let round = 0; round < 2; round += 1) {
      const client = await challenge(user);
      for (let i = 0; i < 5; i += 1) last = await client.post("/two-factor/verify-totp", { code });
    }
    expect(last?.status).toBe(401);
    expect(last?.json?.code).toBe("INVALID_CODE");
    const row = await sql<{ locked_until: Date }>`
      SELECT locked_until FROM auth_two_factors WHERE user_id = ${user.userId}`.execute(db);
    const lockedUntil = row.rows[0]?.locked_until;
    expect(lockedUntil && lockedUntil.getTime() > Date.now()).toBe(true);
    const locks = await auditRows(user.orgId, "web.two_factor_locked");
    expect(locks).toHaveLength(1);
    expect(locks[0]?.data).toEqual({ via: "web", locked_until: lockedUntil?.toISOString() });

    const blocked = await challenge(user);
    const refused = await blocked.post("/two-factor/verify-totp", { code: typedCode(user.secret) });
    expect(refused.status).toBe(429);
    expect(refused.json?.code).toBe("ACCOUNT_TEMPORARILY_LOCKED");
    expect(await auditRows(user.orgId, "web.two_factor_locked")).toHaveLength(1);

    await sql`UPDATE auth_two_factors SET locked_until = now() - interval '1 minute' WHERE user_id = ${user.userId}`.execute(
      db
    );
    const again = await challenge(user);
    const ok = await again.post("/two-factor/verify-totp", { code: typedCode(user.secret) });
    expect(ok.status).toBe(200);
    expect(again.has("ea.session_token")).toBe(true);
    expect(await auditRows(user.orgId, "web.two_factor_locked")).toHaveLength(1);
  });

  test("9: every 2FA audit row holds only via, second_factor, locked_until, action and reason", async () => {
    const user = await createEnrolled();
    await user.client.post("/two-factor/disable", { password: PASSWORD });
    await user.client.post("/two-factor/generate-backup-codes", { password: PASSWORD, code: typedCode(user.secret) });
    const result = await sql<{ data: Record<string, unknown> }>`
      SELECT data FROM audit_log WHERE org_id = ${user.orgId} AND event IN ('web.login', 'web.two_factor_enabled', 'web.two_factor_disabled', 'web.backup_codes_generated', 'web.backup_code_used', 'web.two_factor_locked', 'web.two_factor_refused')`.execute(
      db
    );
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      for (const key of Object.keys(row.data))
        expect(["via", "second_factor", "locked_until", "action", "reason"]).toContain(key);
    }
  });
});

// The last test of the file: it checks every console line of the run above.
describe("secrets", () => {
  test("events: no console line holds a secret, a code or otpauth", kit.expectNoSecretInConsole);
});
