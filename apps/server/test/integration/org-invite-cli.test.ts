import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { INBOX, openImapProvider } from "../../src/modules/mail";

import { testDb } from "./helpers";

const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const script = resolve(import.meta.dir, "../../src/scripts/org-invite.ts");

const BASE_URL = "http://127.0.0.1:8080";
const DAY_S = 86_400;
const smtpPort = process.env.TEST_SMTP_PORT ?? "3025";
const imapPort = Number(process.env.TEST_IMAP_PORT ?? "3143");
const mailHost = process.env.TEST_IMAP_HOST ?? "127.0.0.1";

const orgNames: string[] = [];
const emails: string[] = [];

afterEach(async () => {
  for (const email of emails) {
    const user = await db.selectFrom("users").select("id").where("email", "=", email).executeTakeFirst();
    if (user) await sql`DELETE FROM auth_verifications WHERE value = ${user.id}`.execute(db);
  }
  for (const name of orgNames) {
    await db.deleteFrom("organizations").where("name", "=", name).execute();
  }
  for (const email of emails) {
    await db.deleteFrom("users").where("email", "=", email).execute();
  }
  orgNames.length = 0;
  emails.length = 0;
});

afterAll(async () => {
  await db.destroy();
});

const noMailEnv = {
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
  ...noMailEnv,
  AUTH_SMTP_HOST: mailHost,
  AUTH_SMTP_PORT: smtpPort,
  AUTH_SMTP_USER: "auth",
  AUTH_SMTP_PASSWORD: "greenmail-test",
  AUTH_MAIL_FROM: "noreply@x.test",
};

function newTarget() {
  const orgName = `Invite ${randomUUID()}`;
  const email = `org-invite-${randomUUID()}@x.test`;
  orgNames.push(orgName);
  emails.push(email);
  return { orgName, email };
}

function argsFor(target: { orgName: string; email: string }, extra: string[] = []) {
  return ["--org-name", target.orgName, "--email", target.email, "--display-name", "Owner", ...extra];
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

type Result = Awaited<ReturnType<typeof runInvite>>;

// Test 9: only the printed link block holds the link; no line holds the address.
function expectNoLeak(result: Result, email: string, printed: boolean) {
  const lines = `${result.stdout}\n${result.stderr}`.split("\n");
  const linkLines = lines.filter((line) => line.includes("reset-password/"));
  expect(linkLines).toHaveLength(printed ? 1 : 0);
  expect(lines.filter((line) => line.includes(email))).toEqual([]);
}

async function inboxSubjects(email: string): Promise<(string | null)[]> {
  const inbox = await openImapProvider({ host: mailHost, port: imapPort, user: email, password: "greenmail-test" });
  try {
    return (await inbox.fetchAbove(INBOX, 0)).map((meta) => meta.subject);
  } finally {
    await inbox.close();
  }
}

async function findOrg(orgName: string) {
  return db.selectFrom("organizations").selectAll().where("name", "=", orgName).executeTakeFirst();
}

describe("org:invite CLI", () => {
  test("prints one link, creates a trial organization with a polish owner and a 24 h link", async () => {
    const target = newTarget();
    const before = Date.now();

    const result = await runInvite(argsFor(target), noMailEnv);

    expect(result.code).toBe(0);
    const links = result.stdout.split("\n").filter((line) => line.includes("reset-password/"));
    expect(links).toHaveLength(1);
    expect(links[0]).toContain(`${BASE_URL}/api/auth/reset-password/`);
    expect(links[0]).toContain("callbackURL=");
    expect(links[0]).toContain("%2Fsetup");
    expectNoLeak(result, target.email, true);

    const org = await findOrg(target.orgName);
    expect(org?.plan).toBe("trial");
    const expected = before + 30 * DAY_S * 1000;
    expect(Math.abs((org?.trial_ends_at?.getTime() ?? 0) - expected)).toBeLessThan(3_600_000);

    const user = await db.selectFrom("users").selectAll().where("email", "=", target.email).executeTakeFirstOrThrow();
    expect(user.locale).toBe("pl");
    const membership = await db
      .selectFrom("memberships")
      .select("role")
      .where("user_id", "=", user.id)
      .where("org_id", "=", org?.id ?? "")
      .executeTakeFirst();
    expect(membership?.role).toBe("owner");

    const { rows } = await sql<{ ttl: number }>`
      SELECT extract(epoch FROM expires_at - created_at)::float8 AS ttl FROM auth_verifications WHERE value = ${user.id}
    `.execute(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ttl).toBeGreaterThan(DAY_S - 5);
    expect(rows[0]?.ttl).toBeLessThan(DAY_S + 5);
  });

  test("with the sender on, the link goes by mail and not to stdout", async () => {
    const target = newTarget();

    const result = await runInvite(argsFor(target, ["--lang", "en"]), mailEnv);

    expect(result.code).toBe(0);
    expectNoLeak(result, target.email, false);
    expect(await inboxSubjects(target.email)).toEqual(["Your Email Assistant account"]);
    const user = await db.selectFrom("users").select("locale").where("email", "=", target.email).executeTakeFirst();
    expect(user?.locale).toBe("en");
  });

  test("--print prints the link even with the sender on", async () => {
    const target = newTarget();

    const result = await runInvite(argsFor(target, ["--print"]), mailEnv);

    expect(result.code).toBe(0);
    expectNoLeak(result, target.email, true);
    expect(await inboxSubjects(target.email)).toEqual([]);
  });

  test("an address that exists fails and creates no organization", async () => {
    const first = newTarget();
    const firstRun = await runInvite(argsFor(first), noMailEnv);
    expect(firstRun.code).toBe(0);
    expectNoLeak(firstRun, first.email, true);
    const second = { orgName: `Invite ${randomUUID()}`, email: first.email };
    orgNames.push(second.orgName);

    const result = await runInvite(argsFor(second), noMailEnv);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("user with this email already exists");
    expect(await findOrg(second.orgName)).toBeUndefined();
    expectNoLeak(result, first.email, false);
  });

  test("a mail failure exits 1, names web:invite with the new organization id, and keeps the organization", async () => {
    const target = newTarget();

    const result = await runInvite(argsFor(target), { ...mailEnv, AUTH_SMTP_PORT: "1" });

    expect(result.code).toBe(1);
    const org = await findOrg(target.orgName);
    expect(org).toBeDefined();
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain("invite mail failed (");
    expect(output).toContain(`web:invite --org-id ${org?.id}`);
    expectNoLeak(result, target.email, false);
  });

  test("an empty WEB_BASE_URL fails and creates nothing", async () => {
    const target = newTarget();

    const result = await runInvite(argsFor(target), { ...noMailEnv, WEB_BASE_URL: "" });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("WEB_BASE_URL is empty: the web is off");
    expect(await findOrg(target.orgName)).toBeUndefined();
    expectNoLeak(result, target.email, false);
  });
});
