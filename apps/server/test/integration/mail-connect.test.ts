import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { getMailboxSettings } from "../../src/modules/config";
import {
  buildFolderMap,
  connectMailbox,
  MailAuthError,
  type ConnectDeps,
  type ConnectInput,
  type MailFolder,
} from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { getMailbox } from "../../src/modules/mail/repo";
import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, Db } from "../../src/platform/db";
import { SoftError } from "../../src/platform/errors";

import { testDb, withRollback } from "./helpers";

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

  test("no password on stdin prints the usage and exits 1", async () => {
    const proc = runConnect(["--org-id", randomUUID(), "--address", "u@localhost"]);
    expect(await proc.exited).toBe(1);
    expect(await new Response(proc.stderr).text()).toContain("usage");
  });
});
