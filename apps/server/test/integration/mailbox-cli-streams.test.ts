import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { insertDefaultSettings } from "../../src/modules/config";
import {
  connectMailbox,
  openImapProvider,
  syncMailbox,
  verifySmtpLogin,
  type ImapConnectOptions,
} from "../../src/modules/mail";
import { ensureSyncFolders } from "../../src/modules/mail/folders";
import { connectImapClient } from "../../src/modules/mail/imap/client";
import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, Db, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox } from "./fixtures";
import { testDb } from "./helpers";

// The mailbox CLIs print to the operator's terminal through createCliOutput: `print` to stdout, `fail` to stderr.
// Each test here pins the stream of lines that no other CLI test pins by stream. Needs the local GreenMail
// (bun run dev:up) for the cases that log in to a mail server. Auth is off there: any password logs in.
const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const scriptsDir = resolve(import.meta.dir, "../../src/scripts");
const host = process.env.TEST_IMAP_HOST ?? "127.0.0.1";
const imapPort = Number(process.env.TEST_IMAP_PORT ?? "3143");
const smtpPort = Number(process.env.TEST_SMTP_PORT ?? "3025");
const config = loadConfig();
const secrets = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION);
// A closed port: the connection is refused at once.
const deadDb = "postgres://nobody:nobody@127.0.0.1:1/none";

afterAll(async () => {
  await db.destroy();
});

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(
  script: string,
  args: string[],
  opts: { env?: Record<string, string>; stdin?: string } = {}
): Promise<Result> {
  const proc = Bun.spawn(["bun", resolve(scriptsDir, `${script}.ts`), ...args], {
    cwd: repoRoot,
    env: { ...process.env, MAIL_ALLOW_LOCAL_HOSTS: "true", ...opts.env },
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

// A stream carries the `[name] ` prefix of the script. A multi-line text (the usage) prefixes its first line only,
// so `every` is for streams where each line is its own print.
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

// `moduleLogs`: the module code that the script calls logs to stdout too, so not every line is the script's own.
function expectOnlyStdout(result: Result, name: string, text: string, moduleLogs = false): void {
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain(`[${name}] ${text}`);
  if (!moduleLogs) expectPrefixed(result.stdout, name, true);
}

async function createOrg(trx: Db | Transaction<DB>) {
  const suffix = randomUUID();
  return createOrganizationWithOwner(trx, {
    orgName: `Stream Org ${suffix}`,
    timezone: "Europe/Warsaw",
    email: `stream-${suffix}@x.test`,
    displayName: "Owner",
  });
}

async function connectGreenmail(
  ctx: TenantContext
): Promise<{ mailboxId: string; address: string; password: string; imap: ImapConnectOptions }> {
  const address = `u-${randomUUID()}@localhost`;
  const password = `stream-pw-${randomUUID()}`;
  const { mailboxId } = await connectMailbox(
    { db, secrets, openProvider: openImapProvider, verifySmtp: verifySmtpLogin },
    ctx,
    { address, password, secretKind: "password", imapHost: host, imapPort, smtpHost: host, smtpPort }
  );
  return { mailboxId, address, password, imap: { host, port: imapPort, user: address, password } };
}

async function syncOnce(orgId: string, mailboxId: string, imap: ImapConnectOptions): Promise<void> {
  const provider = await openImapProvider(imap);
  try {
    await syncMailbox({ db, provider, isOwnActionId: async () => false, now: () => new Date() }, { orgId }, mailboxId);
  } finally {
    await provider.close();
  }
}

async function createServerFolder(imap: ImapConnectOptions, path: string): Promise<void> {
  const client = await connectImapClient(imap);
  try {
    await client.mailboxCreate(path);
  } finally {
    await client.logout();
  }
}

async function removeOrg(orgId: string, userId: string): Promise<void> {
  await db.deleteFrom("organizations").where("id", "=", orgId).execute();
  await db.deleteFrom("users").where("id", "=", userId).execute();
}

describe("usage goes to stderr", () => {
  for (const name of [
    "mailbox-audit",
    "mailbox-backfill",
    "mailbox-probe-move",
    "mailbox-probe-send",
    "mailbox-rescan",
    "mailbox-settings",
  ]) {
    test(name, async () => {
      const result = await run(name, []);
      expect(result.code).toBe(1);
      expectOnlyStderr(result, name, "usage");
    });
  }
});

describe("a database that is down: `failed:` goes to stderr, nothing to stdout", () => {
  const id = randomUUID();
  const args = ["--org-id", id, "--mailbox-id", id];
  const cases: [string, string[], { stdin?: string; env?: Record<string, string> }][] = [
    ["mailbox-audit", [...args, "--since", "2026-11-01T00:00:00Z"], {}],
    ["mailbox-backfill", args, {}],
    ["mailbox-check", args, {}],
    ["mailbox-rescan", args, {}],
    ["mailbox-seed", args, { env: { TEST_MAILBOX_ADDRESS: "a@localhost" } }],
    ["mailbox-settings", ["show", ...args], {}],
    ["mailbox-password", args, { stdin: "secret\n" }],
    ["mailbox-connect", ["--org-id", id, "--address", "a@localhost"], { stdin: "secret\n" }],
  ];
  for (const [name, scriptArgs, opts] of cases) {
    test(name, async () => {
      const result = await run(name, scriptArgs, { ...opts, env: { ...opts.env, DATABASE_URL: deadDb } });
      expect(result.code).toBe(1);
      expectOnlyStderr(result, name, "failed:");
    });
  }
});

describe("mailbox:password", () => {
  test("a bad key in the config: `config error` goes to stderr", async () => {
    const id = randomUUID();
    const result = await run("mailbox-password", ["--org-id", id, "--mailbox-id", id], {
      stdin: "secret\n",
      env: { CREDENTIALS_KEY: "short" },
    });
    expect(result.code).toBe(1);
    expectOnlyStderr(result, "mailbox-password", "config error");
  });

  test("an unknown mailbox goes to stderr; a known one prints `password updated` to stdout", async () => {
    const { orgId, userId } = await createOrg(db);
    try {
      const { mailboxId, password } = await connectGreenmail({ orgId });
      const args = ["--org-id", orgId, "--mailbox-id", mailboxId];

      const ok = await run("mailbox-password", args, { stdin: `${password}\n` });
      expect(ok.code).toBe(0);
      expectOnlyStdout(ok, "mailbox-password", `password updated for mailbox ${mailboxId}; status `);

      const unknown = await run("mailbox-password", ["--org-id", orgId, "--mailbox-id", randomUUID()], {
        stdin: `${password}\n`,
      });
      expect(unknown.code).toBe(1);
      expect(unknown.stdout).toBe("");
      expectPrefixed(unknown.stderr, "mailbox-password");
    } finally {
      await removeOrg(orgId, userId);
    }
  }, 30_000);
});

describe("mailbox:connect", () => {
  test("a bad address: `invalid input` and the usage go to stderr", async () => {
    const { orgId, userId } = await createOrg(db);
    try {
      const result = await run(
        "mailbox-connect",
        ["--org-id", orgId, "--address", "not-an-address", "--imap-host", host, "--smtp-host", host],
        { stdin: "secret\n" }
      );
      expect(result.code).toBe(1);
      expectOnlyStderr(result, "mailbox-connect", "invalid input: address");
      expect(result.stderr).toContain("usage");
    } finally {
      await removeOrg(orgId, userId);
    }
  });

  test("an org at its mailbox limit: the refusal goes to stderr", async () => {
    const { orgId, userId } = await createOrg(db);
    try {
      await db.updateTable("organizations").set({ max_mailboxes: 0 }).where("id", "=", orgId).execute();
      const result = await run(
        "mailbox-connect",
        ["--org-id", orgId, "--address", `u-${randomUUID()}@localhost`, "--imap-host", host, "--smtp-host", host],
        { stdin: "secret\n" }
      );
      expect(result.code).toBe(1);
      expectOnlyStderr(result, "mailbox-connect", "mailbox limit reached (max 0)");
    } finally {
      await removeOrg(orgId, userId);
    }
  });

  test("a duplicate address goes to stderr", async () => {
    const { orgId, userId } = await createOrg(db);
    try {
      const { address } = await connectGreenmail({ orgId });
      const result = await run(
        "mailbox-connect",
        ["--org-id", orgId, "--address", address, "--imap-host", host, "--smtp-host", host],
        { stdin: "secret\n" }
      );
      expect(result.code).toBe(1);
      expectOnlyStderr(result, "mailbox-connect", "mailbox with this address already exists");
    } finally {
      await removeOrg(orgId, userId);
    }
  }, 30_000);

  test("a mail server that refuses the connection: `failed:` goes to stderr", async () => {
    const { orgId, userId } = await createOrg(db);
    try {
      const result = await run(
        "mailbox-connect",
        [
          "--org-id",
          orgId,
          "--address",
          `u-${randomUUID()}@localhost`,
          "--imap-host",
          host,
          "--imap-port",
          "1",
          "--smtp-host",
          host,
          "--smtp-port",
          "1",
        ],
        { stdin: "secret\n" }
      );
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expectPrefixed(result.stderr, "mailbox-connect");
    } finally {
      await removeOrg(orgId, userId);
    }
  }, 30_000);
});

describe("mailbox:probe-move and mailbox:probe-send", () => {
  const args = (address: string, extra: string[] = []) => [
    "--host",
    host,
    "--port",
    String(imapPort),
    "--address",
    address,
    ...extra,
  ];

  test("a wrong test address: `failed:` goes to stderr, stdout stays empty", async () => {
    const address = `u-${randomUUID()}@localhost`;
    const env = { TEST_MAILBOX_ADDRESS: "other@localhost" };
    const move = await run("mailbox-probe-move", args(address), { stdin: "pw\n", env });
    expect(move.code).toBe(1);
    expectOnlyStderr(move, "mailbox-probe-move", "failed:");

    const send = await run(
      "mailbox-probe-send",
      args(address, ["--smtp-host", host, "--smtp-port", String(smtpPort), "--to", address]),
      {
        stdin: "pw\n",
        env,
      }
    );
    expect(send.code).toBe(1);
    expectOnlyStderr(send, "mailbox-probe-send", "failed:");
  }, 30_000);

  test("probe-send refuses a recipient that is not a test address: stderr", async () => {
    const address = `u-${randomUUID()}@localhost`;
    const result = await run(
      "mailbox-probe-send",
      args(address, ["--smtp-host", host, "--smtp-port", String(smtpPort), "--to", "someone@elsewhere.test"]),
      { stdin: "pw\n", env: { TEST_MAILBOX_ADDRESS: address, SEND_TEST_ADDRESSES: "" } }
    );
    expect(result.code).toBe(1);
    expectOnlyStderr(result, "mailbox-probe-send", "refused: --to is not a test address");
  });

  test("the report lines of a probe go to stdout, stderr stays empty", async () => {
    const address = `u-${randomUUID()}@localhost`;
    const env = { TEST_MAILBOX_ADDRESS: address };
    const move = await run("mailbox-probe-move", args(address), { stdin: "pw\n", env });
    expect(move.code).toBe(0);
    expect(move.stderr).toBe("");
    expectPrefixed(move.stdout, "mailbox-probe-move", true);

    // A closed SMTP port: the probe reports the failed send and stops before its long waits for the copy and the mail.
    const send = await run(
      "mailbox-probe-send",
      args(address, ["--smtp-host", host, "--smtp-port", "1", "--to", address]),
      {
        stdin: "pw\n",
        env,
      }
    );
    expect(send.code).toBe(0);
    expect(send.stderr).toBe("");
    expectPrefixed(send.stdout, "mailbox-probe-send", true);
  }, 60_000);
});

describe("mailbox:rescan", () => {
  test("an unknown mailbox goes to stderr; a synced one prints to stdout", async () => {
    const { orgId, userId } = await createOrg(db);
    try {
      const { mailboxId, imap } = await connectGreenmail({ orgId });
      const args = ["--org-id", orgId, "--mailbox-id", mailboxId];

      const unknown = await run("mailbox-rescan", ["--org-id", orgId, "--mailbox-id", randomUUID()]);
      expect(unknown.code).toBe(1);
      expectOnlyStderr(unknown, "mailbox-rescan", "no mailbox changed: unknown mailbox, or it was never synced");

      await syncOnce(orgId, mailboxId, imap);
      const ok = await run("mailbox-rescan", args);
      expect(ok.code).toBe(0);
      expectOnlyStdout(ok, "mailbox-rescan", "rescan forced for every synced folder");
    } finally {
      await removeOrg(orgId, userId);
    }
  }, 30_000);
});

describe("mailbox:audit", () => {
  test("the folder lines go to stdout, stderr stays empty", async () => {
    const { orgId, userId } = await createOrg(db);
    try {
      const { mailboxId, imap } = await connectGreenmail({ orgId });
      const ctx = { orgId };
      await ensureSyncFolders(
        db,
        ctx,
        mailboxId,
        [
          { key: "offers", path: "Oferty", role: "sort" },
          { key: "social", path: "Spolecznosc", role: "sort" },
        ],
        new Date()
      );
      await createServerFolder(imap, "Spolecznosc");
      const result = await run("mailbox-audit", [
        "--org-id",
        orgId,
        "--mailbox-id",
        mailboxId,
        "--since",
        new Date(Date.now() - 3_600_000).toISOString(),
      ]);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("[mailbox-audit] inbox=0 stored=0 missing=0 duplicates=0 cross=0");
      expect(result.stdout).toContain("[mailbox-audit] folder=offers not on the server");
      expect(result.stdout).toContain("[mailbox-audit] folder=social mail=0 stored=0 missing=0 duplicates=0 cross=0");
      expectPrefixed(result.stdout, "mailbox-audit", true);
    } finally {
      await removeOrg(orgId, userId);
    }
  }, 30_000);
});

describe("mailbox:backfill", () => {
  test("the result lines go to stdout, stderr stays empty", async () => {
    const { orgId, userId } = await createOrg(db);
    try {
      const { mailboxId, imap } = await connectGreenmail({ orgId });
      await syncOnce(orgId, mailboxId, imap);
      const result = await run("mailbox-backfill", ["--org-id", orgId, "--mailbox-id", mailboxId]);
      expect(result.code).toBe(0);
      expectOnlyStdout(result, "mailbox-backfill", `backfill ${mailboxId}: fetched `, true);
      expect(result.stdout).toContain("[mailbox-backfill] re-queued ");
    } finally {
      await removeOrg(orgId, userId);
    }
  }, 30_000);
});

describe("mailbox:settings", () => {
  async function box() {
    return db.transaction().execute(async (trx) => {
      const created = await createOrgWithMailbox(trx);
      await insertDefaultSettings(trx, { orgId: created.orgId }, created.mailboxId);
      return created;
    });
  }

  test("show, mode, sync-folder and expire-ready print to stdout; a missing mailbox fails on stderr", async () => {
    const created = await box();
    try {
      const args = ["--org-id", created.orgId, "--mailbox-id", created.mailboxId];

      const show = await run("mailbox-settings", ["show", ...args]);
      expect(show.code).toBe(0);
      expectOnlyStdout(show, "mailbox-settings", "mode: shadow");
      expect(show.stdout).toContain("[mailbox-settings] sync folder inbox: on, role inbox");

      // No MOVE and no UIDPLUS: `mode assist` warns.
      await db
        .updateTable("mailboxes")
        .set({ capabilities: JSON.stringify({ move: false, uidplus: false }) })
        .where("id", "=", created.mailboxId)
        .execute();
      const assist = await run("mailbox-settings", ["mode", ...args, "--mode", "assist"]);
      expect(assist.code).toBe(0);
      expectOnlyStdout(assist, "mailbox-settings", "mode: shadow -> assist");
      expect(assist.stdout).toContain("[mailbox-settings] warning: moves not supported: moves stay log only");

      const same = await run("mailbox-settings", ["mode", ...args, "--mode", "assist"]);
      expect(same.code).toBe(0);
      expectOnlyStdout(same, "mailbox-settings", "no change");

      const shadow = await run("mailbox-settings", ["mode", ...args, "--mode", "shadow"]);
      expect(shadow.code).toBe(0);
      expectOnlyStdout(shadow, "mailbox-settings", "expired 0 ready actions and sends");

      const expire = await run("mailbox-settings", ["expire-ready", ...args]);
      expect(expire.code).toBe(0);
      expectOnlyStdout(expire, "mailbox-settings", "expired 0 ready actions");
      expect(expire.stdout).toContain("[mailbox-settings] ready mailbox actions left: 0");

      const missing = await run("mailbox-settings", ["show", "--org-id", created.orgId, "--mailbox-id", randomUUID()]);
      expect(missing.code).toBe(1);
      expect(missing.stdout).toBe("");
      expectPrefixed(missing.stderr, "mailbox-settings");
    } finally {
      await removeOrg(created.orgId, created.userId);
    }
  }, 60_000);
});
