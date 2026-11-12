import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { INBOX, openImapProvider } from "../../src/modules/mail";
import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import { insertMembership, insertUser } from "../../src/modules/tenancy/repo";
import { createAuth } from "../../src/platform/auth";

import { testDb } from "./helpers";

const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const script = resolve(import.meta.dir, "../../src/scripts/web-invite.ts");

const BASE_URL = "http://127.0.0.1:8080";
const PASSWORD = "correct-horse-battery-staple";

const orgIds: string[] = [];
const userIds: string[] = [];

afterEach(async () => {
  if (userIds.length > 0) {
    await sql`DELETE FROM auth_verifications WHERE value IN (${sql.join(userIds)})`.execute(db);
  }
  for (const orgId of orgIds) {
    await db.deleteFrom("organizations").where("id", "=", orgId).execute();
  }
  if (userIds.length > 0) {
    await db.deleteFrom("users").where("id", "in", userIds).execute();
  }
  orgIds.length = 0;
  userIds.length = 0;
});

afterAll(async () => {
  await db.destroy();
});

async function createOwner() {
  const email = `web-invite-${randomUUID()}@x.test`;
  const { orgId, userId } = await createOrganizationWithOwner(db, {
    orgName: "Web invite",
    timezone: "Europe/Warsaw",
    email,
    displayName: "Owner",
  });
  orgIds.push(orgId);
  userIds.push(userId);
  return { email, orgId, userId };
}

async function runInvite(args: string[], env: Record<string, string>) {
  const proc = Bun.spawn(["bun", script, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  return {
    code,
    stdout: await new Response(proc.stdout).text(),
    stderr: await new Response(proc.stderr).text(),
  };
}

const webEnv = {
  WEB_BASE_URL: BASE_URL,
  WEB_AUTH_SECRET: "x".repeat(40),
  AUTH_SMTP_HOST: "",
  AUTH_SMTP_PORT: "",
  AUTH_SMTP_SECURITY: "",
  AUTH_SMTP_USER: "",
  AUTH_SMTP_PASSWORD: "",
  AUTH_MAIL_FROM: "",
};
const mailEnv = {
  ...webEnv,
  AUTH_SMTP_HOST: process.env.TEST_IMAP_HOST ?? "127.0.0.1",
  AUTH_SMTP_PORT: process.env.TEST_SMTP_PORT ?? "3025",
  AUTH_SMTP_USER: "auth",
  AUTH_SMTP_PASSWORD: "greenmail-test",
  AUTH_MAIL_FROM: "noreply@x.test",
};

type Result = Awaited<ReturnType<typeof runInvite>>;

// Test 9: only the printed link block holds the link; no line holds the address.
function expectNoLeak(result: Result, email: string, printed: boolean) {
  const lines = `${result.stdout}\n${result.stderr}`.split("\n");
  const linkLines = lines.filter((line) => line.includes("reset-password/"));
  expect(linkLines).toHaveLength(printed ? 1 : 0);
  expect(lines.filter((line) => line.includes(email))).toEqual([]);
}

async function inboxSubjects(email: string): Promise<(string | null)[]> {
  const inbox = await openImapProvider({
    host: process.env.TEST_IMAP_HOST ?? "127.0.0.1",
    port: Number(process.env.TEST_IMAP_PORT ?? "3143"),
    user: email,
    password: "greenmail-test",
  });
  try {
    return (await inbox.fetchAbove(INBOX, 0)).map((meta) => meta.subject);
  } finally {
    await inbox.close();
  }
}

describe("web:invite CLI", () => {
  test("prints a real one-time link and no address", async () => {
    const { email, orgId, userId } = await createOwner();

    const result = await runInvite(["--org-id", orgId], webEnv);

    expect(result.code).toBe(0);
    const lines = result.stdout.split("\n");
    expect(lines[0]).toBe("Open this link within 24 hours:");
    const url = lines[1] ?? "";
    expect(url.startsWith(`${BASE_URL}/api/auth/reset-password/`)).toBe(true);
    expect(url.endsWith("?callbackURL=http%3A%2F%2F127.0.0.1%3A8080%2Fsetup")).toBe(true);
    expect(lines[2]).toContain("replaces it");
    expect(result.stdout).not.toContain(email);
    expect(result.stderr).not.toContain("@");
    expect(lines.slice(3).join("\n")).not.toContain(url);
    expect(result.stdout).toContain(`invite link made for user ${userId}`);

    const token = new URL(url).pathname.split("/").pop() ?? "";
    const handle = createAuth({
      databaseUrl: process.env.DATABASE_URL ?? "",
      baseUrl: BASE_URL,
      secret: webEnv.WEB_AUTH_SECRET,
      trustedOrigins: [],
      onEvent: async () => undefined,
      resetLinkTtlSeconds: 86_400,
    });
    try {
      await handle.auth.api.resetPassword({ body: { newPassword: PASSWORD, token } });
      const { response } = await handle.auth.api.signInEmail({
        body: { email, password: PASSWORD },
        returnHeaders: true,
      });
      expect(response.user.id).toBe(userId);
    } finally {
      await handle.close();
    }
  });

  test("an empty WEB_BASE_URL fails with the web-is-off message", async () => {
    const { orgId } = await createOwner();

    const result = await runInvite(["--org-id", orgId], { WEB_BASE_URL: "", WEB_AUTH_SECRET: "" });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("WEB_BASE_URL is empty: the web is off");
    expect(result.stdout).toBe("");
  });

  test("two members and no --user-id fail; --user-id picks one; a stranger fails", async () => {
    const { orgId } = await createOwner();
    const second = await insertUser(db, { email: `web-invite-${randomUUID()}@x.test`, displayName: "Second" });
    userIds.push(second.id);
    await insertMembership(db, { orgId }, { userId: second.id, role: "assistant" });

    const ambiguous = await runInvite(["--org-id", orgId], webEnv);
    expect(ambiguous.code).toBe(1);
    expect(ambiguous.stderr).toContain("pass --user-id");
    expect(ambiguous.stdout).toBe("");

    const picked = await runInvite(["--org-id", orgId, "--user-id", second.id], webEnv);
    expect(picked.code).toBe(0);
    expect(picked.stdout).toContain(`invite link made for user ${second.id}`);

    const stranger = await runInvite(["--org-id", orgId, "--user-id", randomUUID()], webEnv);
    expect(stranger.code).toBe(1);
    expect(stranger.stderr).toContain("user is not a member of this organization");
  });

  test("a bad argument prints the usage", async () => {
    const result = await runInvite(["--org-id", "nope"], webEnv);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("usage: bun run web:invite --org-id <uuid> [--user-id <uuid>]");
  });

  test("with the sender on, the link goes by mail and not to stdout", async () => {
    const { email, orgId } = await createOwner();

    const result = await runInvite(["--org-id", orgId], mailEnv);

    expect(result.code).toBe(0);
    expectNoLeak(result, email, false);
    expect(await inboxSubjects(email)).toHaveLength(1);
  });

  test("--print prints the link with the sender on and sends no mail", async () => {
    const { email, orgId } = await createOwner();

    const result = await runInvite(["--org-id", orgId, "--print"], mailEnv);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`${BASE_URL}/api/auth/reset-password/`);
    expectNoLeak(result, email, true);
    expect(await inboxSubjects(email)).toEqual([]);
  });
});
