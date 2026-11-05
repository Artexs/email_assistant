import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  auditMailbox,
  connectMailbox,
  openImapProvider,
  seedMailbox,
  syncMailbox,
  verifySmtpLogin,
  type ImapConnectOptions,
} from "../../src/modules/mail";
import { connectImapClient } from "../../src/modules/mail/imap/client";
import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, Db, TenantContext } from "../../src/platform/db";

import { testDb, withRollback } from "./helpers";

// Needs the local GreenMail (bun run dev:up). Auth is off: any password logs in.
const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const seedScript = resolve(import.meta.dir, "../../src/scripts/mailbox-seed.ts");
const auditScript = resolve(import.meta.dir, "../../src/scripts/mailbox-audit.ts");
const host = process.env.TEST_IMAP_HOST ?? "127.0.0.1";
const imapPort = Number(process.env.TEST_IMAP_PORT ?? "3143");
const smtpPort = Number(process.env.TEST_SMTP_PORT ?? "3025");
// The CLIs decrypt with the configured key, so the tests encrypt with it too.
const config = loadConfig();
const secrets = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION);

afterAll(async () => {
  await db.destroy();
});

async function createOrg(trx: Db | Transaction<DB>) {
  const suffix = randomUUID();
  return createOrganizationWithOwner(trx, {
    orgName: `Seed Org ${suffix}`,
    timezone: "Europe/Warsaw",
    email: `seed-${suffix}@x.test`,
    displayName: "Owner",
  });
}

async function connectGreenmail(
  trx: Db | Transaction<DB>,
  ctx: TenantContext
): Promise<{ mailboxId: string; address: string; imap: ImapConnectOptions }> {
  const address = `u-${randomUUID()}@localhost`;
  const password = `seed-pw-${randomUUID()}`;
  const { mailboxId } = await connectMailbox(
    { db: trx, secrets, openProvider: openImapProvider, verifySmtp: verifySmtpLogin },
    ctx,
    { address, password, secretKind: "password", imapHost: host, imapPort, smtpHost: host, smtpPort }
  );
  return { mailboxId, address, imap: { host, port: imapPort, user: address, password } };
}

async function inboxMessageIds(imap: ImapConnectOptions): Promise<string[]> {
  const client = await connectImapClient(imap);
  try {
    if (!(await client.list()).some((entry) => entry.path === "INBOX")) return [];
    const lock = await client.getMailboxLock("INBOX");
    try {
      const ids: string[] = [];
      if (client.mailbox && client.mailbox.exists === 0) return ids;
      for await (const message of client.fetch("1:*", { envelope: true })) {
        ids.push(message.envelope?.messageId ?? "");
      }
      return ids;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

async function run(script: string, args: string[], env: Record<string, string>) {
  const proc = Bun.spawn(["bun", script, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
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

describe("seedMailbox", () => {
  test("refuses when TEST_MAILBOX_ADDRESS is missing or differs, and opens no connection", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrg(trx);
      const ctx = { orgId };
      const { mailboxId, imap } = await connectGreenmail(trx, ctx);

      await expect(
        seedMailbox({ db: trx, secrets }, ctx, mailboxId, { count: 1, testAddress: undefined })
      ).rejects.toThrow("TEST_MAILBOX_ADDRESS is not set");
      await expect(
        seedMailbox({ db: trx, secrets }, ctx, mailboxId, { count: 1, testAddress: "other@localhost" })
      ).rejects.toThrow("not the test mailbox");
      expect(await inboxMessageIds(imap)).toEqual([]);
    });
  });

  test("refuses the messages path with a wrong address, and appends nothing", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrg(trx);
      const ctx = { orgId };
      const { mailboxId, address, imap } = await connectGreenmail(trx, ctx);
      const messages = [{ from: address, to: [address], subject: "Seed", date: new Date(), text: "Seed" }];

      await expect(
        seedMailbox({ db: trx, secrets }, ctx, mailboxId, { count: 0, testAddress: "other@localhost", messages })
      ).rejects.toThrow("not the test mailbox");
      expect(await inboxMessageIds(imap)).toEqual([]);
    });
  });

  test("with the right address (any letter case) it appends the mails with distinct Message-IDs", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrg(trx);
      const ctx = { orgId };
      const { mailboxId, address, imap } = await connectGreenmail(trx, ctx);

      const appended = await seedMailbox({ db: trx, secrets }, ctx, mailboxId, {
        count: 3,
        testAddress: address.toUpperCase(),
      });

      expect(appended).toBe(3);
      const ids = await inboxMessageIds(imap);
      expect(ids).toHaveLength(3);
      expect(new Set(ids).size).toBe(3);
      for (const id of ids) expect(id).toMatch(/^<seed-[0-9a-f-]+@ea-seed\.test>$/);
    });
  });
});

describe("auditMailbox", () => {
  test("shows seeded mail as missing before the sync and a clean result after it", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrg(trx);
      const ctx = { orgId };
      const { mailboxId, address } = await connectGreenmail(trx, ctx);
      const since = new Date(Date.now() - 3_600_000);
      await seedMailbox({ db: trx, secrets }, ctx, mailboxId, { count: 2, testAddress: address });

      expect(await auditMailbox({ db: trx, secrets }, ctx, mailboxId, since)).toEqual({
        inbox: 2,
        stored: 0,
        missing: 2,
        duplicates: 0,
      });

      const provider = await openImapProvider({ host, port: imapPort, user: address, password: "any" });
      try {
        await syncMailbox(
          { db: trx, provider, isOwnActionId: async () => false, now: () => new Date() },
          ctx,
          mailboxId
        );
      } finally {
        await provider.close();
      }

      expect(await auditMailbox({ db: trx, secrets }, ctx, mailboxId, since)).toEqual({
        inbox: 2,
        stored: 2,
        missing: 0,
        duplicates: 0,
      });
    });
  });
});

describe("mailbox:seed and mailbox:audit CLI", () => {
  test("seed exits 1 for a wrong or missing test address, and 0 with the right one; audit exits 2, then 0", async () => {
    const { orgId, userId } = await createOrg(db);
    try {
      const { mailboxId, address, imap } = await connectGreenmail(db, { orgId });
      const args = ["--org-id", orgId, "--mailbox-id", mailboxId];

      const wrong = await run(seedScript, args, { TEST_MAILBOX_ADDRESS: "other@localhost" });
      expect(wrong.code).toBe(1);
      expect(wrong.stderr).toContain("seed refused");
      const missing = await run(seedScript, args, { TEST_MAILBOX_ADDRESS: "" });
      expect(missing.code).toBe(1);
      expect(missing.stderr).toContain("TEST_MAILBOX_ADDRESS is not set: seed refused");
      expect(await inboxMessageIds(imap)).toEqual([]);

      const right = await run(seedScript, [...args, "--count", "3"], { TEST_MAILBOX_ADDRESS: address });
      expect(right.stderr).toBe("");
      expect(right.code).toBe(0);
      expect(right.stdout).toContain("appended 3");
      expect(new Set(await inboxMessageIds(imap)).size).toBe(3);

      const since = new Date(Date.now() - 3_600_000).toISOString();
      const lost = await run(auditScript, [...args, "--since", since], {});
      expect(lost.code).toBe(2);
      expect(lost.stdout).toContain("inbox=3 stored=0 missing=3 duplicates=0");

      const provider = await openImapProvider(imap);
      try {
        await syncMailbox(
          { db, provider, isOwnActionId: async () => false, now: () => new Date() },
          { orgId },
          mailboxId
        );
      } finally {
        await provider.close();
      }
      const clean = await run(auditScript, [...args, "--since", since], {});
      expect(clean.code).toBe(0);
      expect(clean.stdout).toContain("inbox=3 stored=3 missing=0 duplicates=0");

      const bad = await run(auditScript, args, {});
      expect(bad.code).toBe(1);
      expect(bad.stderr).toContain("usage");
    } finally {
      await db.deleteFrom("organizations").where("id", "=", orgId).execute();
      await db.deleteFrom("users").where("id", "=", userId).execute();
    }
  });
});
