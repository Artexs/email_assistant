import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { getMailboxSettings } from "../../src/modules/config";
import {
  buildFolderMap,
  connectMailbox,
  MailAuthError,
  MailboxExistsError,
  MailboxLimitError,
  type ConnectDeps,
  type ConnectInput,
  type MailFolder,
} from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import {
  findMailboxIdByAddress,
  getMailbox,
  insertMailbox,
  lockMailboxLimit,
  setMailboxStatus,
} from "../../src/modules/mail/repo";
import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, Db } from "../../src/platform/db";
import { SoftError } from "../../src/platform/errors";

import { testDb, withRollback } from "./helpers";

// A promise that never settles: the deadline must end the check.
const hang = <T = never>(): Promise<T> => new Promise<T>(() => undefined);

const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const connectScript = resolve(import.meta.dir, "../../src/scripts/mailbox-connect.ts");
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

afterAll(async () => {
  await db.destroy();
});

const serverFolders: MailFolder[] = [
  { path: "INBOX", specialUse: null },
  { path: "Kopie robocze", specialUse: "\\Drafts" },
  { path: "Wysłane", specialUse: "\\Sent" },
  { path: "Kosz", specialUse: "\\Trash" },
  { path: "Spam", specialUse: "\\Junk" },
];

function fakeWithFolders(): FakeMailProvider {
  const fake = createFakeMailProvider({ capabilities: { condstore: false } });
  const serverInfo = fake.serverInfo.bind(fake);
  fake.serverInfo = async () => ({ ...(await serverInfo()), folders: serverFolders });
  return fake;
}

function input(password: string): ConnectInput {
  return {
    address: `box-${randomUUID()}@x.test`,
    password,
    secretKind: "app_password",
    imapHost: "imap.x.test",
    imapPort: 993,
    smtpHost: "smtp.x.test",
    smtpPort: 465,
  };
}

async function createOrg(trx: Db | Transaction<DB>, suffix = randomUUID()) {
  return createOrganizationWithOwner(trx, {
    orgName: `Connect Org ${suffix}`,
    timezone: "Europe/Warsaw",
    email: `connect-${suffix}@x.test`,
    displayName: "Owner",
  });
}

async function countMailboxes(trx: Transaction<DB>, orgId: string): Promise<number> {
  const rows = await trx.selectFrom("mailboxes").select("id").where("org_id", "=", orgId).execute();
  return rows.length;
}

function expectNoPlainText(stored: string, password: string): void {
  expect(stored).not.toContain(password);
  expect(stored).not.toContain(Buffer.from(password).toString("base64"));
  expect(stored).not.toContain(Buffer.from(password).toString("hex"));
}

describe("buildFolderMap", () => {
  test("maps the special-use folders and adds the AI folders", () => {
    expect(buildFolderMap(serverFolders)).toEqual({
      drafts: "Kopie robocze",
      sent: "Wysłane",
      trash: "Kosz",
      junk: "Spam",
      ai_spam: "AI/Spam",
      ai_info: "AI/Info",
      ai_notifications: "AI/Notifications",
      ai_manual: "AI/Manual",
    });
  });

  test("a missing special-use folder leaves its key out; the first folder wins", () => {
    const map = buildFolderMap([
      { path: "Drafts", specialUse: "\\Drafts" },
      { path: "Drafts2", specialUse: "\\Drafts" },
      { path: "Archive", specialUse: "\\Archive" },
    ]);
    expect(map.drafts).toBe("Drafts");
    expect(Object.keys(map).sort()).toEqual(["ai_info", "ai_manual", "ai_notifications", "ai_spam", "drafts"]);
  });
});

describe("connectMailbox", () => {
  test("stores the mailbox, the encrypted password and the default settings", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrg(trx);
      const ctx = { orgId };
      const password = `pw-${randomUUID()}`;
      const fake = fakeWithFolders();
      const smtpCalls: unknown[] = [];
      const deps: ConnectDeps = {
        db: trx,
        secrets,
        openProvider: async () => fake,
        verifySmtp: async (opts) => {
          smtpCalls.push(opts);
        },
      };
      const data = input(password);

      const { mailboxId, info } = await connectMailbox(deps, ctx, data);

      expect(fake.closed).toBe(true);
      expect(smtpCalls).toEqual([{ host: "smtp.x.test", port: 465, user: data.address, password }]);

      const raw = await trx
        .selectFrom("mailbox_credentials")
        .select(["encrypted_secret", "key_version", "secret_kind"])
        .where("mailbox_id", "=", mailboxId)
        .executeTakeFirstOrThrow();
      expectNoPlainText(raw.encrypted_secret, password);
      expect(raw.secret_kind).toBe("app_password");
      expect(
        secrets.decrypt({ ciphertext: raw.encrypted_secret, keyVersion: raw.key_version }, `mailbox:${mailboxId}`)
      ).toBe(password);

      const mailbox = await getMailbox(trx, ctx, mailboxId);
      expect(mailbox?.address).toBe(data.address);
      expect(mailbox?.status).toBe("active");
      expect(mailbox?.capabilities).toEqual(info.capabilities);
      expect(mailbox?.capabilities).toMatchObject({ condstore: false, move: true });
      expect(mailbox?.folder_map).toEqual(buildFolderMap(serverFolders));
      expect(JSON.stringify(mailbox)).not.toContain(password);

      const folders = await trx
        .selectFrom("mailbox_folders")
        .select(["key", "path", "role", "enabled", "uidvalidity", "last_uid"])
        .where("mailbox_id", "=", mailboxId)
        .execute();
      expect(folders).toEqual([
        { key: "inbox", path: "INBOX", role: "inbox", enabled: true, uidvalidity: null, last_uid: null },
      ]);

      const settings = await getMailboxSettings(trx, ctx, mailboxId);
      expect(settings?.mode).toBe("shadow");
      expect(settings?.tool_switches).toEqual({});
      expect(settings?.category_policy).toEqual({});
    });
  });

  test("an IMAP login error writes no row and does not try SMTP", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrg(trx);
      let smtpCalled = false;
      const deps: ConnectDeps = {
        db: trx,
        secrets,
        openProvider: () => Promise.reject(new MailAuthError("IMAP login failed")),
        verifySmtp: async () => {
          smtpCalled = true;
        },
      };
      await expect(connectMailbox(deps, { orgId }, input("pw-imap-bad"))).rejects.toBeInstanceOf(MailAuthError);
      expect(smtpCalled).toBe(false);
      expect(await countMailboxes(trx, orgId)).toBe(0);
    });
  });

  test("an SMTP error writes no row and the IMAP provider is closed", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrg(trx);
      const fake = fakeWithFolders();
      const deps: ConnectDeps = {
        db: trx,
        secrets,
        openProvider: async () => fake,
        verifySmtp: () => Promise.reject(new SoftError("SMTP verify: connection error ECONNREFUSED")),
      };
      await expect(connectMailbox(deps, { orgId }, input("pw-smtp-bad"))).rejects.toBeInstanceOf(SoftError);
      expect(fake.closed).toBe(true);
      expect(await countMailboxes(trx, orgId)).toBe(0);
    });
  });

  test("a serverInfo error closes the provider and writes no row", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrg(trx);
      const fake = fakeWithFolders();
      fake.failOn("serverInfo", new SoftError("lost"));
      const deps: ConnectDeps = {
        db: trx,
        secrets,
        openProvider: async () => fake,
        verifySmtp: () => Promise.resolve(),
      };
      await expect(connectMailbox(deps, { orgId }, input("pw-x"))).rejects.toBeInstanceOf(SoftError);
      expect(fake.closed).toBe(true);
      expect(await countMailboxes(trx, orgId)).toBe(0);
    });
  });

  test("bad input is rejected before any login", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrg(trx);
      let opened = false;
      const deps: ConnectDeps = {
        db: trx,
        secrets,
        openProvider: async () => {
          opened = true;
          return fakeWithFolders();
        },
        verifySmtp: () => Promise.resolve(),
      };
      await expect(connectMailbox(deps, { orgId }, { ...input("pw"), address: "not-an-address" })).rejects.toThrow();
      await expect(connectMailbox(deps, { orgId }, { ...input("pw"), imapPort: 70_000 })).rejects.toThrow();
      await expect(connectMailbox(deps, { orgId }, { ...input("pw"), password: "" })).rejects.toThrow();
      expect(opened).toBe(false);
    });
  });
});

describe("connectMailbox: duplicates, audit, timeouts", () => {
  function depsFor(trx: Db | Transaction<DB>, extra: Partial<ConnectDeps> = {}) {
    const calls = { open: 0, openOpts: [] as unknown[], smtpOpts: [] as unknown[] };
    const deps: ConnectDeps = {
      db: trx,
      secrets,
      openProvider: async (opts) => {
        calls.open += 1;
        calls.openOpts.push(opts);
        return fakeWithFolders();
      },
      verifySmtp: async (opts) => {
        calls.smtpOpts.push(opts);
      },
      ...extra,
    };
    return { deps, calls };
  }

  async function seedMailbox(trx: Db | Transaction<DB>, orgId: string, address: string): Promise<string> {
    const id = randomUUID();
    await insertMailbox(
      trx,
      { orgId },
      {
        id,
        address,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: (await fakeWithFolders().serverInfo()).capabilities,
        folderMap: buildFolderMap(serverFolders),
      }
    );
    return id;
  }

  test("a duplicate address (any case) is refused before any login", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrg(trx);
      const suffix = randomUUID();
      await seedMailbox(trx, orgId, `A-${suffix}@X.test`);
      const { deps, calls } = depsFor(trx);
      const data = { ...input("pw"), address: `a-${suffix}@x.test` };
      await expect(connectMailbox(deps, { orgId }, data)).rejects.toBeInstanceOf(MailboxExistsError);
      expect(calls.open).toBe(0);
    });
  });

  test("the same address in another organization connects", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrg(trx);
      const b = await createOrg(trx);
      const address = `shared-${randomUUID()}@x.test`;
      await seedMailbox(trx, a.orgId, address);
      const { deps } = depsFor(trx);
      const { mailboxId } = await connectMailbox(deps, { orgId: b.orgId }, { ...input("pw"), address });
      expect(await getMailbox(trx, { orgId: b.orgId }, mailboxId)).toBeDefined();
    });
  });

  test("a mailbox that appears during the login becomes MailboxExistsError (unique index)", async () => {
    const { orgId, userId } = await createOrg(db);
    try {
      const address = `race-${randomUUID()}@x.test`;
      const { deps } = depsFor(db, {
        openProvider: async () => {
          await seedMailbox(db, orgId, address);
          return fakeWithFolders();
        },
      });
      const error = await connectMailbox(deps, { orgId }, { ...input("pw"), address }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(MailboxExistsError);
      expect((error as { cause?: { code?: string } }).cause?.code).toBe("23505");
      const rows = await db.selectFrom("mailboxes").select("id").where("org_id", "=", orgId).execute();
      expect(rows).toHaveLength(1);
    } finally {
      await db.deleteFrom("organizations").where("id", "=", orgId).execute();
      await db.deleteFrom("users").where("id", "=", userId).execute();
    }
  });

  test("a connect writes one mailbox.connected row without the address", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, userId } = await createOrg(trx);
      const { deps } = depsFor(trx);
      const first = await connectMailbox(deps, { orgId }, input("pw"));
      const second = await connectMailbox(deps, { orgId }, input("pw"), { actor: userId, via: "web" });
      const rows = await trx
        .selectFrom("audit_log")
        .select(["actor", "data"])
        .where("org_id", "=", orgId)
        .where("event", "=", "mailbox.connected")
        .orderBy("id")
        .execute();
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ actor: "system", data: { mailbox_id: first.mailboxId, via: "cli" } });
      expect(rows[1]).toEqual({ actor: userId, data: { mailbox_id: second.mailboxId, via: "web" } });
      expect(Object.keys(rows[1]?.data as object)).not.toContain("address");
    });
  });

  test("the timeouts reach the openers; without them both are undefined", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrg(trx);
      const withT = depsFor(trx, { timeouts: { socketMs: 20_000, deadlineMs: 25_000 } });
      await connectMailbox(withT.deps, { orgId }, input("pw"));
      expect(withT.calls.openOpts[0]).toMatchObject({ connectionTimeoutMs: 20_000 });
      expect(withT.calls.smtpOpts[0]).toMatchObject({ timeoutMs: 20_000 });
      const bare = depsFor(trx);
      await connectMailbox(bare.deps, { orgId }, input("pw"));
      expect((bare.calls.openOpts[0] as { connectionTimeoutMs?: number }).connectionTimeoutMs).toBeUndefined();
      expect((bare.calls.smtpOpts[0] as { timeoutMs?: number }).timeoutMs).toBeUndefined();
    });
  });

  test("the deadline ends a hanging IMAP or SMTP check with a SoftError; no row is written", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrg(trx);
      const timeouts = { socketMs: 20_000, deadlineMs: 50 };
      const hangImap = depsFor(trx, { timeouts, openProvider: () => hang() });
      const hangSmtp = depsFor(trx, { timeouts, verifySmtp: () => hang() });
      for (const { deps } of [hangImap, hangSmtp]) {
        const started = Date.now();
        const error = await connectMailbox(deps, { orgId }, input("pw")).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(SoftError);
        expect((error as SoftError).message).toBe("mail check timed out");
        expect(Date.now() - started).toBeLessThan(1_000);
      }
      expect(await countMailboxes(trx, orgId)).toBe(0);
    });
  });

  test("findMailboxIdByAddress filters by organization", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrg(trx);
      const b = await createOrg(trx);
      const address = `tenant-${randomUUID()}@x.test`;
      const id = await seedMailbox(trx, a.orgId, address);
      expect(await findMailboxIdByAddress(trx, { orgId: a.orgId }, address.toUpperCase())).toBe(id);
      expect(await findMailboxIdByAddress(trx, { orgId: b.orgId }, address)).toBeUndefined();
    });
  });
});

// Needs the local GreenMail (bun run dev:up). Auth is off: any password logs in.
describe("mailbox:connect CLI", () => {
  const imapHost = process.env.TEST_IMAP_HOST ?? "127.0.0.1";
  const imapPort = process.env.TEST_IMAP_PORT ?? "3143";
  const smtpPort = process.env.TEST_SMTP_PORT ?? "3025";

  function runConnect(args: string[], stdin?: string) {
    return Bun.spawn(["bun", connectScript, ...args], {
      cwd: repoRoot,
      stdin: stdin === undefined ? "ignore" : new Response(stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  test("connects a GreenMail mailbox; the password is not in the output or the DB row", async () => {
    const suffix = randomUUID();
    const password = `cli-pw-${randomUUID()}`;
    const { orgId, userId } = await createOrg(db, suffix);
    try {
      const proc = runConnect(
        [
          "--org-id",
          orgId,
          "--address",
          `u-${suffix}@localhost`,
          "--imap-host",
          imapHost,
          "--imap-port",
          imapPort,
          "--smtp-host",
          imapHost,
          "--smtp-port",
          smtpPort,
        ],
        `${password}\n`
      );
      const [code, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      expect(stderr).toBe("");
      expect(code).toBe(0);
      expect(stdout).toContain("MOVE=yes");
      expect(stdout).toContain("UIDPLUS=yes");
      expectNoPlainText(stdout, password);
      expectNoPlainText(stderr, password);

      const mailboxId = /\[mailbox-connect\] connected mailbox (\S+)/.exec(stdout)?.[1] ?? "";
      const raw = await db
        .selectFrom("mailbox_credentials")
        .select("encrypted_secret")
        .where("org_id", "=", orgId)
        .where("mailbox_id", "=", mailboxId)
        .executeTakeFirstOrThrow();
      expectNoPlainText(raw.encrypted_secret, password);
    } finally {
      await db.deleteFrom("organizations").where("id", "=", orgId).execute();
      await db.deleteFrom("users").where("id", "=", userId).execute();
    }
  });

  test("a duplicate address exits 1 before any login", async () => {
    const suffix = randomUUID();
    const { orgId, userId } = await createOrg(db, suffix);
    try {
      await insertMailbox(
        db,
        { orgId },
        {
          id: randomUUID(),
          address: "dup@x.test",
          imapHost: "imap.x.test",
          imapPort: 993,
          smtpHost: "smtp.x.test",
          smtpPort: 465,
          capabilities: (await fakeWithFolders().serverInfo()).capabilities,
          folderMap: buildFolderMap(serverFolders),
        }
      );
      const proc = runConnect(["--org-id", orgId, "--address", "DUP@x.test"], "x");
      const [code, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      expect(code).toBe(1);
      expect(`${stdout}${stderr}`).toContain("mailbox with this address already exists");
    } finally {
      await db.deleteFrom("organizations").where("id", "=", orgId).execute();
      await db.deleteFrom("users").where("id", "=", userId).execute();
    }
  });

  test("no password on stdin prints the usage and exits 1", async () => {
    const proc = runConnect(["--org-id", randomUUID(), "--address", "u@localhost"]);
    expect(await proc.exited).toBe(1);
    expect(await new Response(proc.stderr).text()).toContain("usage");
  });
});

describe("connectMailbox: mailbox limit", () => {
  function depsFor(trx: Db | Transaction<DB>, extra: Partial<ConnectDeps> = {}) {
    const calls = { open: 0, smtp: 0 };
    const deps: ConnectDeps = {
      db: trx,
      secrets,
      openProvider: async () => {
        calls.open += 1;
        return fakeWithFolders();
      },
      verifySmtp: async () => {
        calls.smtp += 1;
      },
      ...extra,
    };
    return { deps, calls };
  }

  async function seedMailbox(trx: Db | Transaction<DB>, orgId: string, status?: "paused"): Promise<void> {
    const id = randomUUID();
    await insertMailbox(
      trx,
      { orgId },
      {
        id,
        address: `seed-${randomUUID()}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: (await fakeWithFolders().serverInfo()).capabilities,
        folderMap: {},
      }
    );
    if (status !== undefined) await setMailboxStatus(trx, { orgId }, id, status, new Date());
  }

  const setMax = (trx: Db | Transaction<DB>, orgId: string, max: number) =>
    trx.updateTable("organizations").set({ max_mailboxes: max }).where("id", "=", orgId).execute();

  test("a mailbox above max_mailboxes is refused before any login", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrg(trx);
      await setMax(trx, orgId, 1);
      await seedMailbox(trx, orgId);
      const { deps, calls } = depsFor(trx);
      const error = await connectMailbox(deps, { orgId }, input("pw")).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(MailboxLimitError);
      expect((error as MailboxLimitError).max).toBe(1);
      expect(calls).toEqual({ open: 0, smtp: 0 });
    });
  });

  test("max_mailboxes = 2 allows the second connect and refuses the third", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrg(trx);
      await setMax(trx, orgId, 2);
      await seedMailbox(trx, orgId);
      const { deps } = depsFor(trx);
      await connectMailbox(deps, { orgId }, input("pw"));
      await expect(connectMailbox(deps, { orgId }, input("pw"))).rejects.toBeInstanceOf(MailboxLimitError);
      expect(await countMailboxes(trx, orgId)).toBe(2);
    });
  });

  test("a paused mailbox counts", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrg(trx);
      await setMax(trx, orgId, 1);
      await seedMailbox(trx, orgId, "paused");
      const { deps, calls } = depsFor(trx);
      await expect(connectMailbox(deps, { orgId }, input("pw"))).rejects.toBeInstanceOf(MailboxLimitError);
      expect(calls.open).toBe(0);
    });
  });

  test("max_mailboxes = 0 refuses before any login", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrg(trx);
      await setMax(trx, orgId, 0);
      const { deps, calls } = depsFor(trx);
      const error = await connectMailbox(deps, { orgId }, input("pw")).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(MailboxLimitError);
      expect((error as MailboxLimitError).max).toBe(0);
      expect(calls).toEqual({ open: 0, smtp: 0 });
    });
  });

  test("lockMailboxLimit refuses to run outside a transaction", async () => {
    await expect(lockMailboxLimit(db, { orgId: randomUUID() })).rejects.toThrow("needs a transaction");
  });

  test("two connects at once with max_mailboxes = 1 give one success and one MailboxLimitError", async () => {
    const { orgId, userId } = await createOrg(db);
    try {
      await setMax(db, orgId, 1);
      // Both logins wait here until both connects reached them: both passed the pre-check, none inserted yet.
      let opened = 0;
      let release: () => void = () => undefined;
      const barrier = new Promise<void>((resolveBarrier) => {
        release = resolveBarrier;
      });
      const { deps } = depsFor(db, {
        openProvider: async () => {
          opened += 1;
          if (opened === 2) release();
          await barrier;
          return fakeWithFolders();
        },
      });
      const results = await Promise.allSettled([
        connectMailbox(deps, { orgId }, input("pw-a")),
        connectMailbox(deps, { orgId }, input("pw-b")),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toBeInstanceOf(MailboxLimitError);
      const rows = await db.selectFrom("mailboxes").select("id").where("org_id", "=", orgId).execute();
      expect(rows).toHaveLength(1);
      const audit = await db
        .selectFrom("audit_log")
        .select("id")
        .where("org_id", "=", orgId)
        .where("event", "=", "mailbox.connected")
        .execute();
      expect(audit).toHaveLength(1);
    } finally {
      await db.deleteFrom("organizations").where("id", "=", orgId).execute();
      await db.deleteFrom("users").where("id", "=", userId).execute();
    }
  });
});
