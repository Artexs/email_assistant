import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "pg";

import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import { adminUrl, withDatabase, worktreeDbComment } from "../../src/scripts/db-worktree-args";

import { createOrgWithMailbox, insertTriaged } from "./fixtures";
import { testDb } from "./helpers";

// The scripts print through createCliOutput: `print` to stdout, `fail` to stderr. Each test pins the
// stream of a line that no other CLI test pins by stream (db-worktree, org-status, telegram-unlink, telegram-check,
// triage-cost, triage-label, eval). The case-set runs of `eval` are in `scripts/eval-streams.test.ts`.
// Test addresses end in `@x.test`; temp files live in one folder under the OS temp dir.
const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const scriptsDir = resolve(import.meta.dir, "../../src/scripts");
const tmp = mkdtempSync(join(tmpdir(), "f103-s04-"));
// A closed port: the connection is refused at once.
const deadDb = "postgres://nobody:nobody@127.0.0.1:1/none";
const databases: string[] = [];
// The script needs these keys. CI sets the two URLs but not POSTGRES_PASSWORD, so the tests pass all three explicitly.
// The fallback is the password of the CI Postgres service (`POSTGRES_PASSWORD: postgres` in ci.yml): it is not a secret.
const migratorUrl = process.env.MIGRATOR_DATABASE_URL ?? "";
const postgresPassword = process.env.POSTGRES_PASSWORD || "postgres";
const scriptEnv = {
  DATABASE_URL: process.env.DATABASE_URL ?? "",
  MIGRATOR_DATABASE_URL: migratorUrl,
  POSTGRES_PASSWORD: postgresPassword,
};

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(
  script: string,
  args: string[],
  opts: { env?: Record<string, string>; stdin?: string; cwd?: string } = {}
): Promise<Result> {
  const proc = Bun.spawn(["bun", resolve(scriptsDir, `${script}.ts`), ...args], {
    cwd: opts.cwd ?? repoRoot,
    env: { ...process.env, ...scriptEnv, ...opts.env },
    stdin: opts.stdin === undefined ? "ignore" : new Response(opts.stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

// Every line of a stream is the script's own print, so each starts with `[name] `. A multi-line text (the usage)
// prefixes its first line only, so only the first line is checked unless `every` is set.
function expectPrefixed(text: string, name: string, every = false): void {
  const lines = text.split("\n").filter((line) => line !== "");
  expect(lines.length).toBeGreaterThan(0);
  for (const line of every ? lines : lines.slice(0, 1)) expect(line.startsWith(`[${name}] `)).toBe(true);
}

function expectOnlyStderr(result: Result, name: string, text: string): void {
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain(`[${name}] ${text}`);
  expectPrefixed(result.stderr, name);
}

// `others`: lines of the process that are not the script's own print (a child process, the table the script writes).
function expectOnlyStdout(result: Result, name: string, text: string, others = false): void {
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain(`[${name}] ${text}`);
  if (!others) expectPrefixed(result.stdout, name, true);
}

async function createOrg() {
  const suffix = randomUUID();
  return createOrganizationWithOwner(db, {
    orgName: `Stream Org ${suffix}`,
    timezone: "Europe/Warsaw",
    email: `stream-${suffix}@x.test`,
    displayName: "Owner",
  });
}

async function withAdmin<T>(url: string, run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

const admin = adminUrl(migratorUrl, postgresPassword);

afterAll(async () => {
  for (const database of databases) {
    await withAdmin(admin, (client) => client.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`));
  }
  await db.destroy();
  rmSync(tmp, { recursive: true, force: true });
});

describe("db-worktree streams", () => {
  // A new database name per test: `email_assistant_` + `name` with `-` as `_`.
  function newName(): { name: string; database: string } {
    const name = `f103s04-${randomBytes(4).toString("hex")}`;
    const database = `email_assistant_${name.replaceAll("-", "_")}`;
    databases.push(database);
    return { name, database };
  }

  // The script runs `bun run db:migrate` in its own cwd: a folder without package.json makes that step fail at once,
  // so the create path reaches `db:migrate failed` without a real migration.
  const noMigrateDir = join(tmp, "no-package");
  beforeAll(() => mkdirSync(noMigrateDir, { recursive: true }));

  test("no argument: the usage on stderr, exit 2", async () => {
    const result = await run("db-worktree", []);
    expect(result.code).toBe(2);
    expectOnlyStderr(result, "db-worktree", "usage: bun run db:worktree");
  });

  test("a missing env key: the env check line and the usage on stderr, exit 2", async () => {
    const result = await run("db-worktree", ["x"], { env: { POSTGRES_PASSWORD: "" } });
    expect(result.code).toBe(2);
    expectOnlyStderr(result, "db-worktree", "env check failed: POSTGRES_PASSWORD\n");
    expect(result.stderr).toContain("usage: bun run db:worktree");
  });

  test("a bad name: `bad name` and the usage on stderr, exit 2", async () => {
    const result = await run("db-worktree", ["Bad_Name"]);
    expect(result.code).toBe(2);
    expectOnlyStderr(result, "db-worktree", "bad name\n[db-worktree] usage: bun run db:worktree");
  });

  test("the base database: refused on stderr, exit 1", async () => {
    const { name, database } = newName();
    const base = withDatabase(migratorUrl, database);
    const result = await run("db-worktree", [name], {
      env: { DATABASE_URL: base, MIGRATOR_DATABASE_URL: base },
    });
    expect(result.code).toBe(1);
    expectOnlyStderr(result, "db-worktree", `${database} is a base database: refusing`);
  });

  test("a server that is not on loopback: refused on stderr, exit 1", async () => {
    const result = await run("db-worktree", [newName().name], {
      env: {
        DATABASE_URL: "postgres://app:pw@db.x.test:5433/base",
        MIGRATOR_DATABASE_URL: "postgres://migrator:pw@db.x.test:5433/base",
      },
    });
    expect(result.code).toBe(1);
    expectOnlyStderr(
      result,
      "db-worktree",
      "DATABASE_URL and MIGRATOR_DATABASE_URL must point at the same loopback server: refusing"
    );
  });

  test("a wrong admin password: `failed:` on stderr, exit 1", async () => {
    const result = await run("db-worktree", [newName().name], { env: { POSTGRES_PASSWORD: "not-the-password" } });
    expect(result.code).toBe(1);
    expectOnlyStderr(result, "db-worktree", "failed: ");
  });

  test("drop of a database that does not exist: `no database` on stdout, exit 0", async () => {
    const { name, database } = newName();
    const result = await run("db-worktree", [name, "--drop"]);
    expect(result.code).toBe(0);
    expectOnlyStdout(result, "db-worktree", `no database ${database}`);
  });

  // A database that the script marked: the same `COMMENT` it writes.
  async function markedDatabase(): Promise<{ name: string; database: string }> {
    const made = newName();
    await withAdmin(admin, async (client) => {
      await client.query(`CREATE DATABASE "${made.database}"`);
      await client.query(`COMMENT ON DATABASE "${made.database}" IS '${worktreeDbComment}'`);
    });
    return made;
  }

  test("create: `created` on stdout, the failed migration on stderr", async () => {
    const { name, database } = newName();
    const created = await run("db-worktree", [name], { cwd: noMigrateDir });
    // The migration step fails here by design: the stream of `created` and of `db:migrate failed` is the point.
    expect(created.code).toBe(1);
    expect(created.stdout).toContain(`[db-worktree] created ${database}\n`);
    expect(created.stderr).toContain("[db-worktree] db:migrate failed\n");
    expect(created.stdout).not.toContain("db:migrate failed");
    expect(created.stderr).not.toContain(`created ${database}`);
  });

  test("create of a database that exists: `reusing it` on stdout", async () => {
    const { name, database } = await markedDatabase();
    const reused = await run("db-worktree", [name], { cwd: noMigrateDir });
    expect(reused.stdout).toContain(`[db-worktree] database ${database} exists, reusing it\n`);
    expect(reused.stderr).not.toContain("reusing it");
    expect(reused.stderr).toContain("[db-worktree] db:migrate failed\n");
  });

  test("drop of a database that is in use: refused on stderr, exit 1", async () => {
    const { name, database } = await markedDatabase();
    // A connection to the database makes the drop fail with "in use" (the server waits 5 s for the other session first).
    await withAdmin(withDatabase(admin, database), async () => {
      const busy = await run("db-worktree", [name, "--drop"]);
      expect(busy.code).toBe(1);
      expectOnlyStderr(
        busy,
        "db-worktree",
        `database ${database} is in use: stop the server and the tests that use it`
      );
    });
  }, 20_000);

  test("drop: `dropped` on stdout, exit 0", async () => {
    const { name, database } = await markedDatabase();
    const dropped = await run("db-worktree", [name, "--drop"]);
    expect(dropped.code).toBe(0);
    expectOnlyStdout(dropped, "db-worktree", `dropped ${database}`);
  });

  test("drop also drops the test worker databases `<name>_w<n>` of the database", async () => {
    const { name, database } = await markedDatabase();
    const workers = [1, 2].map((n) => `${database}_w${n}`);
    await withAdmin(admin, async (client) => {
      for (const worker of workers) {
        await client.query(`CREATE DATABASE "${worker}"`);
        await client.query(`COMMENT ON DATABASE "${worker}" IS '${worktreeDbComment}'`);
      }
    });
    databases.push(...workers);
    const dropped = await run("db-worktree", [name, "--drop"]);
    expect(dropped.code).toBe(0);
    for (const dropping of [database, ...workers])
      expect(dropped.stdout).toContain(`[db-worktree] dropped ${dropping}\n`);
    const left = await withAdmin(admin, (client) =>
      client.query("SELECT datname FROM pg_database WHERE datname = ANY($1)", [[database, ...workers]])
    );
    expect(left.rows).toEqual([]);
  });

  test("a database without the worktree mark: create and drop refuse on stderr", async () => {
    const { name, database } = newName();
    await withAdmin(admin, (client) => client.query(`CREATE DATABASE "${database}"`));
    const create = await run("db-worktree", [name], { cwd: noMigrateDir });
    expect(create.code).toBe(1);
    expectOnlyStderr(create, "db-worktree", `database ${database} exists but `);
    expect(create.stderr).toContain("did not create it: refusing");
    const drop = await run("db-worktree", [name, "--drop"]);
    expect(drop.code).toBe(1);
    expectOnlyStderr(drop, "db-worktree", `database ${database} exists but `);
    expect(drop.stderr).toContain("did not create it: refusing");
  });
});

// The same line of several scripts, one table per line. Each row spawns the script with its own arguments; the name
// of a row is the name of the case it replaced, so the rows of one table can share a name.
describe("the same stream line of several scripts", () => {
  test.each([
    { name: "a bad --org-id: the usage on stderr, exit 2", script: "org-status", usage: "usage: bun run org:status" },
    { name: "a bad option: the usage on stderr, exit 2", script: "triage-cost", usage: "usage: bun run triage:cost" },
    { name: "a bad option: the usage on stderr, exit 2", script: "triage-label", usage: "usage: bun run triage:label" },
  ])("$name", async ({ script, usage }) => {
    const result = await run(script, ["--org-id", "nope"]);
    expect(result.code).toBe(2);
    expectOnlyStderr(result, script, usage);
  });

  const scriptArgs: { script: string; args: () => string[] }[] = [
    { script: "telegram-unlink", args: () => ["--org-id", randomUUID(), "--user-id", randomUUID()] },
    { script: "triage-cost", args: () => ["--org-id", randomUUID(), "--mailbox-id", randomUUID()] },
    { script: "triage-label", args: () => ["--org-id", randomUUID(), "--mailbox-id", randomUUID()] },
  ];

  test.each(scriptArgs)("a database that is down: `unreachable:` on stderr, exit 3", async ({ script, args }) => {
    const result = await run(script, args(), { env: { DATABASE_URL: deadDb } });
    expect(result.code).toBe(3);
    expectOnlyStderr(result, script, "unreachable: ");
  });

  test.each(scriptArgs)(
    "a missing DATABASE_URL (the config error comes out of main): `failed:` on stderr, exit 1",
    async ({ script, args }) => {
      const result = await run(script, args(), { env: { DATABASE_URL: "" } });
      expect(result.code).toBe(1);
      expectOnlyStderr(result, script, "failed: ");
    }
  );
});

describe("org-status streams", () => {
  test("an unknown org: `organization not found` on stderr, exit 1", async () => {
    const result = await run("org-status", ["--org-id", randomUUID()]);
    expect(result.code).toBe(1);
    expectOnlyStderr(result, "org-status", "organization not found");
  });

  test("a database with no organization: `no organizations` on stdout, exit 0", async () => {
    // A fresh migrated database (the script migrates it for real): the shared dev database is never empty.
    const name = `f103s04-${randomBytes(4).toString("hex")}`;
    databases.push(`email_assistant_${name.replaceAll("-", "_")}`);
    const created = await run("db-worktree", [name]);
    expect(created.code).toBe(0);
    const url = /^DATABASE_URL=(.+)$/m.exec(created.stdout)?.[1] ?? "";
    expect(url).not.toBe("");
    const result = await run("org-status", [], { env: { DATABASE_URL: url } });
    expect(result.code).toBe(0);
    expectOnlyStdout(result, "org-status", "no organizations");
  });

  test("a database that is down: `unreachable:` on stderr, exit 3", async () => {
    const result = await run("org-status", [], { env: { DATABASE_URL: deadDb } });
    expect(result.code).toBe(3);
    expectOnlyStderr(result, "org-status", "unreachable: ");
  });

  test("a missing DATABASE_URL (the config error comes out of main): `failed:` on stderr, exit 1", async () => {
    const result = await run("org-status", [], { env: { DATABASE_URL: "" } });
    expect(result.code).toBe(1);
    expectOnlyStderr(result, "org-status", "failed: ");
  });
});

describe("telegram-unlink streams", () => {
  test("a missing option: the usage on stderr, exit 2", async () => {
    const result = await run("telegram-unlink", ["--org-id", randomUUID()]);
    expect(result.code).toBe(2);
    expectOnlyStderr(result, "telegram-unlink", "usage: bun run telegram:unlink");
  });

  test("a user with no chat: `unlinked 0` on stdout, exit 0", async () => {
    const { orgId, userId } = await createOrg();
    const result = await run("telegram-unlink", ["--org-id", orgId, "--user-id", userId]);
    expect(result.code).toBe(0);
    expectOnlyStdout(result, "telegram-unlink", `unlinked 0 chat(s) of user ${userId}`);
  });
});

describe("telegram-check streams", () => {
  const token = "123456:STREAMTESTaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  let fake: ReturnType<typeof Bun.serve>;
  let failing: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    fake = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        Response.json({ ok: true, result: { id: 77, is_bot: true, first_name: "T", username: "stream_bot" } }),
    });
    failing = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({ ok: false, error_code: 401, description: "Unauthorized" }, { status: 401 }),
    });
  });
  afterAll(async () => {
    await fake.stop(true);
    await failing.stop(true);
  });

  test("a bot that answers: the bot line on stdout, exit 0", async () => {
    const result = await run("telegram-check", [], {
      env: { TELEGRAM_BOT_TOKEN: token, TELEGRAM_API_ROOT: `http://127.0.0.1:${fake.port}` },
    });
    expect(result.code).toBe(0);
    expectOnlyStdout(result, "telegram-check", "bot @stream_bot (id 77)");
  });

  test("a bot that is refused: `failed:` on stderr, exit 1", async () => {
    const result = await run("telegram-check", [], {
      env: { TELEGRAM_BOT_TOKEN: token, TELEGRAM_API_ROOT: `http://127.0.0.1:${failing.port}` },
    });
    expect(result.code).toBe(1);
    expectOnlyStderr(result, "telegram-check", "failed: ");
    expect(result.stdout + result.stderr).not.toContain(token);
  });

  test("no token: `TELEGRAM_BOT_TOKEN is not set` on stderr, exit 1", async () => {
    const result = await run("telegram-check", [], { env: { TELEGRAM_BOT_TOKEN: "" } });
    expect(result.code).toBe(1);
    expectOnlyStderr(result, "telegram-check", "TELEGRAM_BOT_TOKEN is not set");
  });

  test("a bad config key: the config error with the key names on stderr, exit 1", async () => {
    const result = await run("telegram-check", [], { env: { CREDENTIALS_KEY: "" } });
    expect(result.code).toBe(1);
    expectOnlyStderr(result, "telegram-check", "config error: missing or bad keys: CREDENTIALS_KEY");
  });
});

describe("triage-label streams", () => {
  async function seed(): Promise<{ orgId: string; mailboxId: string; emailId: string }> {
    return db.transaction().execute(async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);
      const emailId = await insertTriaged(trx, { orgId }, mailboxId, {
        category: "info",
        createdAt: new Date("2026-11-20T10:00:00Z"),
        from: "sender@x.test",
        subject: "Stream test",
      });
      return { orgId, mailboxId, emailId };
    });
  }

  test("one verdict: `feedback` on stdout, exit 0", async () => {
    const { orgId, emailId } = await seed();
    const result = await run("triage-label", ["--org-id", orgId, "--email-id", emailId, "--right"]);
    expect(result.code).toBe(0);
    expectOnlyStdout(result, "triage-label", `feedback `);
    expect(result.stdout).toContain(" verdict right\n");
  });

  test("one mail, answer `s`: the count line on stdout, exit 0", async () => {
    const { orgId, mailboxId } = await seed();
    const result = await run("triage-label", ["--org-id", orgId, "--mailbox-id", mailboxId], { stdin: "s\n" });
    expect(result.code).toBe(0);
    expectOnlyStdout(result, "triage-label", "labeled 0, skipped 1", true);
  });

  test("one mail, answer `q`: the count line on stdout, exit 0", async () => {
    const { orgId, mailboxId } = await seed();
    const result = await run("triage-label", ["--org-id", orgId, "--mailbox-id", mailboxId], { stdin: "q\n" });
    expect(result.code).toBe(0);
    expectOnlyStdout(result, "triage-label", "labeled 0, skipped 0", true);
  });

  test("a mailbox with no mail: the count line on stdout, exit 0", async () => {
    const { orgId, mailboxId } = await db.transaction().execute((trx) => createOrgWithMailbox(trx));
    const result = await run("triage-label", ["--org-id", orgId, "--mailbox-id", mailboxId]);
    expect(result.code).toBe(0);
    expectOnlyStdout(result, "triage-label", "labeled 0, skipped 0");
  });
});

describe("eval streams", () => {
  test("a bad option: the usage on stderr, exit 2", async () => {
    const result = await run("eval", ["--no-such-flag"]);
    expect(result.code).toBe(2);
    expectOnlyStderr(result, "eval", "usage: ");
  });

  test("--gap with a missing file: the read error on stderr, exit 1", async () => {
    const result = await run("eval", [
      "--gap",
      "--sim-json",
      join(tmp, "none.json"),
      "--real-json",
      join(tmp, "none.json"),
    ]);
    expect(result.code).toBe(1);
    expectOnlyStderr(result, "eval", "cannot read or parse an input file");
  });

  test("--gap with a file of the wrong shape: the input error on stderr, exit 1", async () => {
    const file = join(tmp, "wrong.json");
    writeFileSync(file, "{}");
    const result = await run("eval", ["--gap", "--sim-json", file, "--real-json", file]);
    expect(result.code).toBe(1);
    expectOnlyStderr(result, "eval", "");
    expect(result.stderr).not.toContain("cannot read or parse");
  });

  test("a provider without a key: `<KEY> is missing` on stderr, exit 1", async () => {
    const result = await run("eval", ["--provider", "gemini"], { env: { GEMINI_API_KEY: "" } });
    expect(result.code).toBe(1);
    expectOnlyStderr(result, "eval", "GEMINI_API_KEY is missing");
  });

  test("a missing config key: `config error: <key>` on stderr, exit 1", async () => {
    const result = await run("eval", ["--provider", "gemini"], { env: { CREDENTIALS_KEY: "" } });
    expect(result.code).toBe(1);
    expectOnlyStderr(result, "eval", "config error: CREDENTIALS_KEY");
  });
});

// The scripts that read the config outside their try block: a missing DATABASE_URL ends in the final `.catch` of the
// file; a database that is down ends in the `catch` of `main`. Both print `failed:` on stderr.
describe("failed lines of the database scripts", () => {
  // `unreachable`: the script follows the CLI standard (docs/cli.md), so a database that is down gives `unreachable:` and exit 3.
  const scripts: { script: string; args: () => string[]; unreachable?: true }[] = [
    {
      script: "org-create",
      args: () => ["--org-name", "Stream Org", "--email", "stream@x.test", "--display-name", "Owner"],
      unreachable: true,
    },
    { script: "org-flag", args: () => ["--org-id", randomUUID()], unreachable: true },
    { script: "org-plan", args: () => ["--org-id", randomUUID(), "--plan", "active"], unreachable: true },
    { script: "rules", args: () => ["list", "--org-id", randomUUID()], unreachable: true },
  ];

  for (const { script, args, unreachable } of scripts) {
    test(`${script}: a database that is down gives \`${unreachable ? "unreachable" : "failed"}:\` on stderr`, async () => {
      const result = await run(script, args(), { env: { DATABASE_URL: deadDb } });
      expect(result.code).toBe(unreachable ? 3 : 1);
      expectOnlyStderr(result, script, unreachable ? "unreachable: " : "failed: ");
    });

    test(`${script}: a missing DATABASE_URL gives \`failed:\` on stderr`, async () => {
      const result = await run(script, args(), { env: { DATABASE_URL: "" } });
      expect(result.code).toBe(1);
      expectOnlyStderr(result, script, "failed: ");
    });
  }
});

describe("org-plan streams", () => {
  test("no argument: the usage on stderr, exit 2", async () => {
    const result = await run("org-plan", []);
    expect(result.code).toBe(2);
    expectOnlyStderr(result, "org-plan", "usage: bun run org:plan");
  });

  test("the plan the org has: `no change` on stdout, exit 0", async () => {
    const { orgId } = await createOrganizationWithOwner(db, {
      orgName: `Stream Org ${randomUUID()}`,
      timezone: "Europe/Warsaw",
      email: `stream-${randomUUID()}@x.test`,
      displayName: "Owner",
      plan: { kind: "active" },
    });
    const result = await run("org-plan", ["--org-id", orgId, "--plan", "active"]);
    expect(result.code).toBe(0);
    expectOnlyStdout(result, "org-plan", `org ${orgId}: no change (plan active, max_mailboxes `);
  });

  test("trial days for a plan that is not a trial: the reason and the usage on stderr, exit 1", async () => {
    const { orgId } = await createOrg();
    const result = await run("org-plan", ["--org-id", orgId, "--plan", "active", "--trial-days", "5"]);
    expect(result.code).toBe(1);
    expectOnlyStderr(result, "org-plan", "bad input: trial_days_without_trial");
    expect(result.stderr).toContain("[org-plan] usage: bun run org:plan");
  });
});

describe("rules streams", () => {
  test("the rule limit: the refusal on stderr, exit 1", async () => {
    const { orgId } = await createOrg();
    await db
      .insertInto("sender_rules")
      .values(
        Array.from({ length: 1000 }, (_, index) => ({
          org_id: orgId,
          mailbox_id: null,
          pattern: `limit-${index}@x.test`,
          kind: "whitelist" as const,
        }))
      )
      .execute();
    let result: Result;
    try {
      result = await run("rules", ["add", "--org-id", orgId, "--pattern", "one-more@x.test", "--kind", "whitelist"]);
    } finally {
      // The org stays in the dev database like every org of the CLI tests; its 1000 rules do not.
      await db.deleteFrom("sender_rules").where("org_id", "=", orgId).execute();
    }
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expectOnlyStderr(result, "rules", "refused: rule limit reached (1000)");
  });
});
