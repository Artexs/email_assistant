import { randomUUID } from "node:crypto";

import { symmetricDecrypt } from "better-auth/crypto";
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { sql } from "kysely";

import { backupCodesLeft } from "../../src/platform/auth-two-factor";
import { base32Decode, secretOfUri } from "../totp";

import { testDb } from "./helpers";
import { BACKUP_CODE, NEW_PASSWORD, PASSWORD, SECRET, WRONG_PASSWORD, makeWebTwoFactorKit } from "./two-factor-helpers";
import { resetBody } from "./web-helpers";

const db = testDb();
const kit = makeWebTwoFactorKit(db);
const {
  handle,
  lockHandle,
  auth,
  secrets,
  spies,
  Client,
  createOwner,
  requestResetLink,
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
} = kit;
type Client = InstanceType<typeof Client>;

beforeAll(kit.silenceConsole);
afterEach(kit.cleanup);
afterAll(kit.close);

describe("two-factor sign-in", () => {
  test("enrolment: the plugin returns the URI and ten codes and turns on only after the first code", async () => {
    const owner = await createOwner();
    const client = new Client();
    await client.signIn(owner.email);
    const oldSession = client.jar.get("ea.session_token");

    const enabled = await client.post("/two-factor/enable", { password: PASSWORD });
    expect(enabled.status).toBe(200);
    const uri = String(enabled.json?.totpURI);
    const codes = enabled.json?.backupCodes as string[];
    expect(codes).toHaveLength(10);
    for (const code of codes) expect(code).toMatch(BACKUP_CODE);
    const secret = secretOfUri(uri);
    secrets.push(secret, uri, ...codes);

    const before = await twoFactorRow(owner.userId);
    expect(before?.verified).toBe(false);
    expect(await twoFactorFlag(owner.userId)).toBe(false);

    // Stored encrypted: neither the secret nor a backup code is in the row in plain text.
    // The URI holds the base32 form of the raw secret; the row holds the encrypted raw secret.
    const raw = base32Decode(secret).toString("utf8");
    expect(before?.secret).not.toContain(raw);
    expect(before?.secret).not.toContain(secret);
    expect(before?.secret).not.toBe(raw);
    for (const code of codes) expect(before?.backup_codes).not.toContain(code);
    expect(await symmetricDecrypt({ key: SECRET, data: before?.secret ?? "" })).toBe(raw);
    expect(JSON.parse(await symmetricDecrypt({ key: SECRET, data: before?.backup_codes ?? "" }))).toEqual(codes);

    const verified = await client.post("/two-factor/verify-totp", { code: typedCode(secret) });
    expect(verified.status).toBe(200);
    const after = await twoFactorRow(owner.userId);
    expect(after?.verified).toBe(true);
    expect(await twoFactorFlag(owner.userId)).toBe(true);
    expect(client.jar.get("ea.session_token")).not.toBe(oldSession);
    expect(await countSessions(owner.userId)).toBe(1);
  });

  test("enable refuses a wrong password and the e-mail method", async () => {
    const owner = await createOwner();
    const client = new Client();
    await client.signIn(owner.email);
    const wrong = await client.post("/two-factor/enable", { password: WRONG_PASSWORD });
    expect(wrong.status).toBe(400);
    expect(wrong.json?.code).toBe("INVALID_PASSWORD");
    expect(await twoFactorRow(owner.userId)).toBeUndefined();
    const otp = await client.post("/two-factor/enable", { password: PASSWORD, method: "otp" });
    expect(otp.status).toBe(400);
    expect(otp.json?.code).toBe("OTP_NOT_CONFIGURED");
    expect(await twoFactorRow(owner.userId)).toBeUndefined();
  });

  test("a member with TOTP gets a challenge, no session and no web.login row", async () => {
    const user = await createEnrolled();
    const before = (await loginRows(user.orgId)).length;
    const client = new Client();
    const answer = await client.signIn(user.email);
    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
    expect(client.has("ea.two_factor")).toBe(true);
    expect(client.has("ea.session_token")).toBe(false);
    // The enrolling session of createEnrolled is the only session of the user.
    expect(await countSessions(user.userId)).toBe(1);
    expect((await loginRows(user.orgId)).length).toBe(before);
  });

  test("the right code makes the session and one web.login row with second_factor totp", async () => {
    const user = await createEnrolled();
    const before = (await loginRows(user.orgId)).length;
    const client = await challenge(user);
    const code = typedCode(user.secret);
    const verified = await client.post("/two-factor/verify-totp", { code });
    expect(verified.status).toBe(200);
    expect(client.has("ea.session_token")).toBe(true);
    const session = await client.call("GET", "/get-session");
    expect((session.json?.user as { id?: string } | undefined)?.id).toBe(user.userId);
    const rows = await loginRows(user.orgId);
    expect(rows).toHaveLength(before + 1);
    expect(rows[rows.length - 1]).toEqual({ via: "web", second_factor: "totp" });
  });

  test("a backup code works once", async () => {
    const user = await createEnrolled();
    const first = await challenge(user);
    const code = user.codes[0] ?? "";
    const used = await first.post("/two-factor/verify-backup-code", { code });
    expect(used.status).toBe(200);
    expect(first.has("ea.session_token")).toBe(true);
    const rows = await loginRows(user.orgId);
    expect(rows[rows.length - 1]).toEqual({ via: "web", second_factor: "backup_code" });

    const second = await challenge(user);
    const again = await second.post("/two-factor/verify-backup-code", { code });
    expect(again.status).toBe(401);
    expect(again.json?.code).toBe("INVALID_BACKUP_CODE");
    expect(second.has("ea.session_token")).toBe(false);
  });

  test("five wrong codes end the challenge", async () => {
    const user = await createEnrolled();
    const client = await challenge(user);
    const code = wrongCode(user.secret);
    secrets.push(code);
    for (let i = 0; i < 5; i += 1) {
      const answer = await client.post("/two-factor/verify-totp", { code });
      expect(answer.status).toBe(401);
      expect(answer.json?.code).toBe("INVALID_CODE");
    }
    const sixth = await client.post("/two-factor/verify-totp", { code });
    expect(sixth.status).toBe(400);
    expect(sixth.json?.code).toBe("TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE");
    expect(client.has("ea.session_token")).toBe(false);
    // The count belongs to the account lock of the account lock.
    await sql`UPDATE auth_two_factors SET failed_verification_count = 0 WHERE user_id = ${user.userId}`.execute(db);
  });

  test("a code without a challenge or a session is refused", async () => {
    const user = await createEnrolled();
    const client = new Client();
    const answer = await client.post("/two-factor/verify-totp", { code: typedCode(user.secret) });
    expect(answer.status).toBe(401);
    expect(answer.json?.code).toBe("INVALID_TWO_FACTOR_COOKIE");
    expect(client.has("ea.session_token")).toBe(false);
  });

  test("a trusted device skips the code and writes second_factor trusted_device", async () => {
    const user = await createEnrolled();
    const first = await challenge(user);
    const verified = await first.post("/two-factor/verify-totp", { code: typedCode(user.secret), trustDevice: true });
    expect(verified.status).toBe(200);
    expect(first.has("ea.trust_device")).toBe(true);
    const trust = first.jar.get("ea.trust_device") ?? "";

    const before = (await loginRows(user.orgId)).length;
    const device = new Client();
    device.jar.set("ea.trust_device", trust);
    const answer = await device.signIn(user.email);
    expect(answer.status).toBe(200);
    expect(answer.json?.twoFactorRedirect).toBeUndefined();
    expect(device.has("ea.session_token")).toBe(true);
    const rows = await loginRows(user.orgId);
    expect(rows).toHaveLength(before + 1);
    expect(rows[rows.length - 1]).toEqual({ via: "web", second_factor: "trusted_device" });
  });

  test("a user without TOTP signs in with second_factor none", async () => {
    const owner = await createOwner();
    const client = new Client();
    expect((await client.signIn(owner.email)).status).toBe(200);
    expect(client.has("ea.session_token")).toBe(true);
    expect(await loginRows(owner.orgId)).toEqual([{ via: "web", second_factor: "none" }]);
  });

  test("a password reset does not skip the code", async () => {
    const user = await createEnrolled();
    const token = await requestResetLink(user.email);
    await auth.api.resetPassword({ body: resetBody(NEW_PASSWORD, token) });
    const client = new Client();
    const answer = await client.signIn(user.email, NEW_PASSWORD);
    expect(answer.status).toBe(200);
    expect(answer.json?.twoFactorRedirect).toBe(true);
    expect(client.has("ea.session_token")).toBe(false);
  });

  test("two parallel enrolments leave one row and no secret in the log", async () => {
    const owner = await createOwner();
    const client = new Client();
    await client.signIn(owner.email);
    const answers = await Promise.all([
      client.post("/two-factor/enable", { password: PASSWORD }),
      client.post("/two-factor/enable", { password: PASSWORD }),
    ]);
    for (const answer of answers) {
      if (answer.status === 200) {
        secrets.push(String(answer.json?.totpURI), secretOfUri(String(answer.json?.totpURI)));
        secrets.push(...(answer.json?.backupCodes as string[]));
      }
    }
    expect(answers.some((answer) => answer.status === 200)).toBe(true);
    for (const answer of answers) expect([200, 500]).toContain(answer.status);
    const count = await sql<{ n: string }>`
      SELECT count(*) AS n FROM auth_two_factors WHERE user_id = ${owner.userId}`.execute(db);
    expect(Number(count.rows[0]?.n)).toBe(1);
  });

  test("a user locked by the password lockout never reaches the code step", async () => {
    const user = await createEnrolled();
    for (let i = 0; i < 10; i += 1) {
      await new Client().signIn(user.email, WRONG_PASSWORD, lockHandle);
    }
    const client = new Client();
    const answer = await client.signIn(user.email, PASSWORD, lockHandle);
    expect(answer.status).toBe(401);
    expect(answer.json?.code).toBe("INVALID_EMAIL_OR_PASSWORD");
    expect(client.has("ea.two_factor")).toBe(false);
    await sql`DELETE FROM auth_lockouts WHERE user_id = ${user.userId}`.execute(db);
  });
});

describe("backupCodesLeft", () => {
  test("8: counts the unused codes: 10, then 9 after a backup-code sign-in", async () => {
    const user = await createEnrolled();
    expect(await backupCodesLeft(handle, user.userId)).toBe(10);
    const client = await challenge(user);
    expect((await client.post("/two-factor/verify-backup-code", { code: user.codes[0] ?? "" })).status).toBe(200);
    expect(await backupCodesLeft(handle, user.userId)).toBe(9);
  });

  test("8: a user without TOTP gives null and one log line with the user id and no code", async () => {
    const owner = await createOwner();
    const before = spies.error.mock.calls.length;
    expect(await backupCodesLeft(handle, owner.userId)).toBeNull();
    const lines = spies.error.mock.calls
      .slice(before)
      .map((call: unknown[]) => call.map((part: unknown) => String(part)).join(" "))
      .filter((line: string) => line.includes("two_factor_codes_unreadable"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(owner.userId);
    expect(lines[0]).not.toMatch(BACKUP_CODE);
  });
});

describe("two-factor enrolment edge cases", () => {
  const errorLines = (): string[] =>
    (spies.error.mock.calls as unknown[][]).map((call) => call.map((part) => String(part)).join(" "));

  // One user with a second session (jar B) and one trusted-device row; TOTP is off.
  async function plant() {
    const owner = await createOwner();
    const jarA = new Client();
    const jarB = new Client();
    await jarA.signIn(owner.email);
    await jarB.signIn(owner.email);
    await sql`
      INSERT INTO auth_verifications (identifier, value, expires_at)
      VALUES (${`trust-${randomUUID()}`}, ${owner.userId}, now() + interval '30 days')`.execute(db);
    return { ...owner, jarA, jarB };
  }

  test("D9 fail closed: a failed purge takes the enrolment back, then a retry works", async () => {
    const user = await plant();
    const context = await handle.auth.$context;
    const enabled = await user.jarA.post("/two-factor/enable", { password: PASSWORD });
    expect(enabled.status).toBe(200);
    const uri = String(enabled.json?.totpURI);
    secrets.push(uri, secretOfUri(uri), ...(enabled.json?.backupCodes as string[]));

    const failing = spyOn(context.internalAdapter, "listSessions").mockRejectedValueOnce(new Error("purge down"));
    const warnsBefore = errorLines().length;
    const failed = await user.jarA.post("/two-factor/verify-totp", { code: typedCode(secretOfUri(uri)) });
    failing.mockRestore();
    expect(failed.status).toBe(500);
    expect(await twoFactorFlag(user.userId)).toBe(false);
    expect(await twoFactorRow(user.userId)).toBeUndefined();
    expect(await trustRows(user.userId)).toHaveLength(1);
    expect((await user.jarB.call("GET", "/get-session")).json).not.toBeNull();
    expect(await auditRows(user.orgId, "web.two_factor_enabled")).toHaveLength(0);
    const rollback = errorLines()
      .slice(warnsBefore)
      .filter((line: string) => line.includes("two_factor_enrol_rollback"));
    expect(rollback).toHaveLength(1);
    expect(rollback[0]).toContain(user.userId);
    expect(rollback[0]).not.toContain("two_factor_enrol_rollback_failed");

    // The retry: a new sign-in (the 500 dropped the cookie of the enrolling device), then a full enrolment.
    const retry = new Client();
    expect((await retry.signIn(user.email)).status).toBe(200);
    const again = await retry.post("/two-factor/enable", { password: PASSWORD });
    expect(again.status).toBe(200);
    const secret = secretOfUri(String(again.json?.totpURI));
    secrets.push(secret, String(again.json?.totpURI), ...(again.json?.backupCodes as string[]));
    expect((await retry.post("/two-factor/verify-totp", { code: typedCode(secret) })).status).toBe(200);
    expect(await twoFactorFlag(user.userId)).toBe(true);
    expect(await auditRows(user.orgId, "web.two_factor_enabled")).toHaveLength(1);
    expect(await trustRows(user.userId)).toHaveLength(0);
    expect((await user.jarB.call("GET", "/get-session")).json).toBeNull();
    expect(await countSessions(user.userId)).toBe(1);
  });

  test("D9 fail closed: a failed compensation logs the failure and the answer stays a 500", async () => {
    const user = await plant();
    const context = await handle.auth.$context;
    const enabled = await user.jarA.post("/two-factor/enable", { password: PASSWORD });
    const uri = String(enabled.json?.totpURI);
    secrets.push(uri, secretOfUri(uri), ...(enabled.json?.backupCodes as string[]));

    const purge = spyOn(context.internalAdapter, "listSessions").mockRejectedValueOnce(new Error("purge down"));
    const compensation = spyOn(context.adapter, "transaction").mockRejectedValueOnce(new Error("rollback down"));
    const linesBefore = errorLines().length;
    const failed = await user.jarA.post("/two-factor/verify-totp", { code: typedCode(secretOfUri(uri)) });
    purge.mockRestore();
    compensation.mockRestore();
    expect(failed.status).toBe(500);
    const lines = errorLines()
      .slice(linesBefore)
      .filter((line: string) => line.includes("two_factor_enrol_rollback_failed"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(user.userId);
    expect(await auditRows(user.orgId, "web.two_factor_enabled")).toHaveLength(0);
  });

  test("N3: an enrolled user's session past updateAge verifying a code is not an enrolment", async () => {
    const user = await createEnrolled();
    const other = await challenge(user);
    expect((await other.post("/two-factor/verify-totp", { code: typedCode(user.secret) })).status).toBe(200);
    // updateAge is one day: a session that expires in 28 of its 30 days is refreshed by the next request.
    await sql`UPDATE auth_sessions SET expires_at = now() + interval '28 days' WHERE user_id = ${user.userId}`.execute(
      db
    );
    const answer = await user.client.post("/two-factor/verify-totp", { code: typedCode(user.secret) });
    expect(answer.status).toBe(200);
    expect(await auditRows(user.orgId, "web.two_factor_enabled")).toHaveLength(1);
    expect((await other.call("GET", "/get-session")).json).not.toBeNull();
    expect(await countSessions(user.userId)).toBe(2);
  });

  test("N5: on the backup-code path the login row comes before the backup_code_used row", async () => {
    const user = await createEnrolled();
    const client = await challenge(user);
    expect((await client.post("/two-factor/verify-backup-code", { code: user.codes[0] ?? "" })).status).toBe(200);
    const rows = await sql<{ event: string }>`
      SELECT event FROM audit_log
      WHERE org_id = ${user.orgId} AND event IN ('web.login', 'web.backup_code_used') ORDER BY id`.execute(db);
    expect(rows.rows.slice(-2).map((row) => row.event)).toEqual(["web.login", "web.backup_code_used"]);
  });
});

// The last test of the file: it checks every console line of the run above.
describe("secrets", () => {
  test("no console line holds a secret, a code or otpauth", kit.expectNoSecretInConsole);
});
