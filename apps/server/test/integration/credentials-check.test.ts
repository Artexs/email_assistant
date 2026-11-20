import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { countDecryptableCredentials } from "../../src/modules/mail";
import { encodeOAuthSecret } from "../../src/modules/mail/oauth/secret-store";
import { insertCredentials, type CredentialKind } from "../../src/modules/mail/repo";
import { createSecretBox, type SecretBox } from "../../src/platform/crypto";
import { createDb, type DB } from "../../src/platform/db";

import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// `countDecryptableCredentials` and `bun run credentials:check` (the restore runs it before the server starts).
// The library tests run in a transaction that rolls back, after it hides the rows of other tests. The script tests need committed
// rows and read every row of the database, so each one compares with a run before the rows exist (other tests leave rows with other keys).
const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const script = resolve(import.meta.dir, "../../src/scripts/credentials-check.ts");
const RESULT_LINE = /^\[credentials-check\] credentials ok=(\d+) failed=(\d+)$/;

const RIGHT_KEY = randomBytes(32).toString("base64");
const OTHER_KEY = randomBytes(32).toString("base64");
const right = createSecretBox(RIGHT_KEY, 1);
const other = createSecretBox(OTHER_KEY, 1);
const rightV2 = createSecretBox(RIGHT_KEY, 2);

afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

async function inRollback(fn: (trx: Trx) => Promise<void>): Promise<void> {
  await withRollback(db, async (trx) => {
    await trx.deleteFrom("mailbox_credentials").execute();
    await fn(trx);
  });
}

async function put(
  trx: Trx,
  box: { orgId: string; mailboxId: string },
  secrets: SecretBox,
  plain: string,
  kind: CredentialKind,
  opts: { aadId?: string } = {}
): Promise<void> {
  const sealed = secrets.encrypt(plain, `mailbox:${opts.aadId ?? box.mailboxId}`);
  await insertCredentials(
    trx,
    { orgId: box.orgId },
    { mailboxId: box.mailboxId, encryptedSecret: sealed.ciphertext, secretKind: kind, keyVersion: sealed.keyVersion }
  );
}

// One organization and one mailbox per row keep the helper simple.
async function seed(
  trx: Trx,
  rows: { secrets: SecretBox; plain: string; kind: CredentialKind; wrongAad?: boolean }[]
): Promise<string[]> {
  const ids: string[] = [];
  for (const row of rows) {
    const made = await createOrgWithMailbox(trx);
    await put(trx, { orgId: made.orgId, mailboxId: made.mailboxId }, row.secrets, row.plain, row.kind, {
      aadId: row.wrongAad === true ? randomUUID() : undefined,
    });
    ids.push(made.mailboxId);
  }
  return ids;
}

const oauthPlain = (token: string): string =>
  encodeOAuthSecret({ v: 1, provider: "google", refreshToken: token, tenantId: null, scopes: ["mail"] });

describe("countDecryptableCredentials", () => {
  test("1. a row with the right key and a row with another key give ok=1 failed=1", async () => {
    await inRollback(async (trx) => {
      await seed(trx, [
        { secrets: right, plain: "pw-right", kind: "password" },
        { secrets: other, plain: "pw-other", kind: "password" },
      ]);
      expect(await countDecryptableCredentials(trx, right)).toEqual({ ok: 1, failed: 1 });
    });
  });

  test("2. no rows give ok=0 failed=0", async () => {
    await inRollback(async (trx) => {
      expect(await countDecryptableCredentials(trx, right)).toEqual({ ok: 0, failed: 0 });
    });
  });

  test("4. an OAuth row and an app password row with the right key count in ok", async () => {
    await inRollback(async (trx) => {
      await seed(trx, [
        { secrets: right, plain: oauthPlain("refresh-1"), kind: "oauth" },
        { secrets: right, plain: "app-pw", kind: "app_password" },
        { secrets: right, plain: "pw", kind: "password" },
      ]);
      expect(await countDecryptableCredentials(trx, right)).toEqual({ ok: 3, failed: 0 });
    });
  });

  test("an OAuth row that opens but holds no OAuth secret, and an OAuth row with another key, count in failed", async () => {
    await inRollback(async (trx) => {
      await seed(trx, [
        { secrets: right, plain: "not json", kind: "oauth" },
        { secrets: right, plain: JSON.stringify({ v: 2 }), kind: "oauth" },
        { secrets: other, plain: oauthPlain("refresh-2"), kind: "oauth" },
        { secrets: right, plain: oauthPlain("refresh-3"), kind: "oauth" },
      ]);
      expect(await countDecryptableCredentials(trx, right)).toEqual({ ok: 1, failed: 3 });
    });
  });

  test("a row with another key version and a row sealed for another mailbox (AAD) count in failed", async () => {
    await inRollback(async (trx) => {
      await seed(trx, [
        { secrets: rightV2, plain: "pw-v2", kind: "password" },
        { secrets: right, plain: "pw-moved", kind: "password", wrongAad: true },
        { secrets: right, plain: "pw-fine", kind: "password" },
      ]);
      expect(await countDecryptableCredentials(trx, right)).toEqual({ ok: 1, failed: 2 });
    });
  });

  test("every page is read: five rows with page size 2 give the same counts as one page", async () => {
    await inRollback(async (trx) => {
      await seed(trx, [
        { secrets: right, plain: "a", kind: "password" },
        { secrets: other, plain: "b", kind: "password" },
        { secrets: right, plain: "c", kind: "password" },
        { secrets: other, plain: "d", kind: "password" },
        { secrets: right, plain: "e", kind: "password" },
      ]);
      const whole = await countDecryptableCredentials(trx, right);
      expect(whole).toEqual({ ok: 3, failed: 2 });
      for (const pageSize of [1, 2, 5, 6]) {
        expect(await countDecryptableCredentials(trx, right, { pageSize }), `page ${pageSize}`).toEqual(whole);
      }
    });
  });

  test("a database error is thrown, never counted as ok=0 failed=0", async () => {
    const dead = createDb("postgres://nobody:nobody@127.0.0.1:1/none");
    try {
      await expect(countDecryptableCredentials(dead, right)).rejects.toBeDefined();
    } finally {
      await dead.destroy();
    }
  });
});

// ---- the script -------------------------------------------------------------------------------------------------------------

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

// CI style: the child gets only the variables listed here, and Bun reads no .env file.
async function runScript(env: Record<string, string>): Promise<Result> {
  const proc = Bun.spawn(["bun", "--no-env-file", script], {
    cwd: repoRoot,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    stdin: "ignore",
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

const databaseUrl = process.env.DATABASE_URL ?? "";
const scriptEnv = (): Record<string, string> => ({
  DATABASE_URL: databaseUrl,
  CREDENTIALS_KEY: RIGHT_KEY,
  CREDENTIALS_KEY_VERSION: "1",
});

function counts(result: Result): { ok: number; failed: number } {
  const match = RESULT_LINE.exec(result.stdout.trim());
  expect(match, result.stdout).not.toBeNull();
  return { ok: Number(match?.[1]), failed: Number(match?.[2]) };
}

describe("bun run credentials:check", () => {
  const planted = {
    orgIds: [] as string[],
    mailboxIds: [] as string[],
    addresses: [] as string[],
    ciphertexts: [] as string[],
    plains: [`plant-pw-right-${randomUUID()}`, `plant-pw-other-${randomUUID()}`],
  };
  let before: { ok: number; failed: number };

  beforeAll(async () => {
    before = counts(await runScript(scriptEnv()));
    const rows = [
      { secrets: right, plain: planted.plains[0] ?? "" },
      { secrets: other, plain: planted.plains[1] ?? "" },
    ];
    for (const row of rows) {
      const address = `plant-${randomUUID()}@x.test`;
      const made = await db.transaction().execute(async (trx) => {
        const org = await createOrgWithMailbox(trx, { address });
        await put(trx, { orgId: org.orgId, mailboxId: org.mailboxId }, row.secrets, row.plain, "password");
        return org;
      });
      planted.orgIds.push(made.orgId);
      planted.mailboxIds.push(made.mailboxId);
      planted.addresses.push(address);
      const stored = await db
        .selectFrom("mailbox_credentials")
        .select("encrypted_secret")
        .where("mailbox_id", "=", made.mailboxId)
        .executeTakeFirstOrThrow();
      planted.ciphertexts.push(stored.encrypted_secret);
    }
  });

  afterAll(async () => {
    for (const orgId of planted.orgIds) {
      await db.deleteFrom("organizations").where("id", "=", orgId).execute();
    }
  });

  test("3. prints one result line with the new counts, exits 0, and prints no part of a secret, key, address or id", async () => {
    const result = await runScript(scriptEnv());
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    const after = counts(result);
    expect(after.ok).toBe(before.ok + 1);
    expect(after.failed).toBe(before.failed + 1);

    const database = new URL(databaseUrl);
    const canaries = [
      ...planted.plains,
      ...planted.ciphertexts,
      ...planted.mailboxIds,
      ...planted.orgIds,
      ...planted.addresses,
      RIGHT_KEY,
      OTHER_KEY,
      database.password,
      database.hostname,
    ].filter((value) => value !== "");
    expect(canaries.length).toBeGreaterThan(10);
    const output = `${result.stdout}${result.stderr}`;
    for (const canary of canaries) expect(output.includes(canary), canary.slice(0, 6)).toBe(false);
    // Not even a piece of a ciphertext or a password.
    for (const piece of [planted.plains[0], planted.ciphertexts[0]]) {
      expect(output.includes((piece ?? "").slice(0, 8))).toBe(false);
    }
  });

  test("a failed run exits 1, prints only the error name, and prints no key and no database password", async () => {
    const dead = "postgres://nobody:dead-db-secret-7@127.0.0.1:1/none";
    const down = await runScript({ ...scriptEnv(), DATABASE_URL: dead });
    expect(down.code).toBe(1);
    expect(down.stdout).toBe("");
    expect(down.stderr).toMatch(/^\[credentials-check\] failed: \w+( \w+)?\n$/);

    const badKey = await runScript({ ...scriptEnv(), CREDENTIALS_KEY: "not-a-key-leak-canary" });
    expect(badKey.code).toBe(1);
    expect(badKey.stdout).toBe("");
    expect(badKey.stderr).toMatch(/^\[credentials-check\] failed: \w+\n$/);

    const missing = await runScript({ DATABASE_URL: databaseUrl });
    expect(missing.code).toBe(1);
    expect(missing.stdout).toBe("");

    for (const result of [down, badKey, missing]) {
      const output = `${result.stdout}${result.stderr}`;
      for (const secret of ["dead-db-secret-7", "not-a-key-leak-canary", RIGHT_KEY, new URL(databaseUrl).password]) {
        if (secret !== "") expect(output.includes(secret)).toBe(false);
      }
    }
  });

  test("an argument is refused with the usage and exit 2", async () => {
    const proc = Bun.spawn(["bun", "--no-env-file", script, "extra"], {
      cwd: repoRoot,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...scriptEnv() },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain("usage: bun run credentials:check");
  });

  // The agreement between the real script and `deploy/restore.sh`: restore.sh runs in a temp layout, its `docker` stub runs the real
  // script for `credentials:check` and answers the other calls with fixed text. The planted row with another key makes `failed` at
  // least 1, so restore.sh must stop before the server starts and name the same count that the library reads.
  test("restore.sh reads the result line of the real script: it stops before `up` and names the failed count", async () => {
    const root = mkdtempSync(join(tmpdir(), "restore-creds-"));
    try {
      const stubs = join(root, "stubs");
      mkdirSync(stubs);
      mkdirSync(join(root, "deploy"));
      copyFileSync(resolve(repoRoot, "deploy/restore.sh"), join(root, "deploy/restore.sh"));
      copyFileSync(resolve(repoRoot, "deploy/compose-lib.sh"), join(root, "deploy/compose-lib.sh"));
      // A split-env host: the passwords are in deploy/db.env, and `.env` holds none of them.
      writeFileSync(join(root, "deploy", "db.env"), "POSTGRES_PASSWORD=unused\nMIGRATOR_PASSWORD=m\nAPP_PASSWORD=a\n");
      writeFileSync(join(root, ".env"), "LOG_LEVEL=info\n");
      const dockerStub = join(stubs, "docker");
      writeFileSync(
        dockerStub,
        `#!/usr/bin/env bash
echo "$*" >>"${root}/calls.log"
cat >/dev/null
if [[ "$*" == *" config "* ]]; then printf '%s' '{"name":"x","services":{}}'; exit 0; fi
if [[ "$*" == *pg_tables* ]]; then echo 0; exit 0; fi
if [[ "$*" == *"from organizations"* ]]; then printf 'organizations 1\\nusers 1\\nmailboxes 1\\nemails 1\\n'; exit 0; fi
if [[ "$*" == *credentials:check* ]]; then exec bun --no-env-file "${script}"; fi
exit 0
`
      );
      chmodSync(dockerStub, 0o755);
      const proc = Bun.spawn(["bash", join(root, "deploy/restore.sh"), "--target", "new-host", "--stdin"], {
        cwd: root,
        env: { PATH: `${stubs}:${process.env.PATH ?? ""}`, HOME: root, ...scriptEnv() },
        stdin: new Response("PLAIN-DUMP"),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const now = await countDecryptableCredentials(db, right);
      expect(now.failed).toBeGreaterThanOrEqual(1);
      expect(code).toBe(1);
      expect(stdout).toContain(`[credentials-check] credentials ok=${now.ok} failed=${now.failed}`);
      expect(stderr).toContain(`restore: ${now.failed} mailbox secrets do not open with this CREDENTIALS_KEY`);
      expect(stderr).toContain("restore failed at credentials");
      expect(stdout).not.toContain("restore ok");
      const calls = await Bun.file(join(root, "calls.log")).text();
      expect(calls).not.toContain("up -d --no-build --wait");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
