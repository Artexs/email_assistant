import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  connectMailbox,
  MailAuthError,
  updateMailboxPassword,
  type ConnectDeps,
  type MailboxStatus,
} from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { getMailbox, setMailboxStatus } from "../../src/modules/mail/repo";
import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB } from "../../src/platform/db";
import { HardError } from "../../src/platform/errors";

import { testDb, withRollback } from "./helpers";

const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const script = resolve(import.meta.dir, "../../src/scripts/mailbox-password.ts");
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);
const now = new Date("2026-11-06T10:00:00.000Z");
const earlier = new Date("2026-11-01T10:00:00.000Z");

afterAll(async () => {
  await db.destroy();
});

interface Overrides {
  openProvider?: ConnectDeps["openProvider"];
  verifySmtp?: ConnectDeps["verifySmtp"];
}

async function setup(trx: Transaction<DB>, status: MailboxStatus) {
  const suffix = randomUUID();
  const { orgId } = await createOrganizationWithOwner(trx, {
    orgName: `Password Org ${suffix}`,
    timezone: "Europe/Warsaw",
    email: `password-${suffix}@x.test`,
    displayName: "Owner",
  });
  const ctx = { orgId };
  const baseDeps: ConnectDeps = {
    db: trx,
    secrets,
    openProvider: async () => createFakeMailProvider(),
    verifySmtp: () => Promise.resolve(),
  };
  const { mailboxId } = await connectMailbox(baseDeps, ctx, {
    address: `box-${suffix}@x.test`,
    password: "old-pass",
    secretKind: "password",
    imapHost: "imap.x.test",
    imapPort: 993,
    smtpHost: "smtp.x.test",
    smtpPort: 465,
  });
  await setMailboxStatus(trx, ctx, mailboxId, status, earlier);
  const deps = (overrides: Overrides = {}): ConnectDeps => ({ ...baseDeps, ...overrides });
  return { ctx, mailboxId, deps };
}

async function storedSecret(trx: Transaction<DB>, mailboxId: string) {
  const row = await trx
    .selectFrom("mailbox_credentials")
    .select(["encrypted_secret", "key_version", "secret_kind"])
    .where("mailbox_id", "=", mailboxId)
    .executeTakeFirstOrThrow();
  return {
    password: secrets.decrypt(
      { ciphertext: row.encrypted_secret, keyVersion: row.key_version },
      `mailbox:${mailboxId}`
    ),
    kind: row.secret_kind,
  };
}

async function auditRows(trx: Transaction<DB>, orgId: string) {
  return trx
    .selectFrom("audit_log")
    .select(["actor", "data"])
    .where("org_id", "=", orgId)
    .where("event", "=", "mailbox.password_changed")
    .execute();
}

describe("updateMailboxPassword", () => {
  test("auth_error becomes active; the new password is stored; one audit row", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, mailboxId, deps } = await setup(trx, "auth_error");
      const result = await updateMailboxPassword(deps(), ctx, { mailboxId, password: "new-pass", now });
      expect(result).toEqual({ status: "active", reactivated: true });
      expect((await storedSecret(trx, mailboxId)).password).toBe("new-pass");
      const mailbox = await getMailbox(trx, ctx, mailboxId);
      expect(mailbox?.status).toBe("active");
      expect(mailbox?.status_changed_at.toISOString()).toBe(now.toISOString());
      const rows = await auditRows(trx, ctx.orgId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.data).toEqual({ mailbox_id: mailboxId, reactivated: true });
    });
  });

  test("an IMAP login error stores nothing", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, mailboxId, deps } = await setup(trx, "auth_error");
      const fail = deps({ openProvider: () => Promise.reject(new MailAuthError("IMAP login failed")) });
      await expect(updateMailboxPassword(fail, ctx, { mailboxId, password: "new-pass", now })).rejects.toBeInstanceOf(
        MailAuthError
      );
      expect((await storedSecret(trx, mailboxId)).password).toBe("old-pass");
      expect((await getMailbox(trx, ctx, mailboxId))?.status).toBe("auth_error");
      expect(await auditRows(trx, ctx.orgId)).toHaveLength(0);
    });
  });

  test("an SMTP login error stores nothing", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, mailboxId, deps } = await setup(trx, "auth_error");
      const fail = deps({ verifySmtp: () => Promise.reject(new MailAuthError("SMTP login failed")) });
      await expect(updateMailboxPassword(fail, ctx, { mailboxId, password: "new-pass", now })).rejects.toThrow(
        "SMTP login failed"
      );
      expect((await storedSecret(trx, mailboxId)).password).toBe("old-pass");
      expect((await getMailbox(trx, ctx, mailboxId))?.status).toBe("auth_error");
      expect(await auditRows(trx, ctx.orgId)).toHaveLength(0);
    });
  });

  test("a paused mailbox stays paused", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, mailboxId, deps } = await setup(trx, "paused");
      const result = await updateMailboxPassword(deps(), ctx, { mailboxId, password: "new-pass", now });
      expect(result).toEqual({ status: "paused", reactivated: false });
      expect((await storedSecret(trx, mailboxId)).password).toBe("new-pass");
      expect((await getMailbox(trx, ctx, mailboxId))?.status).toBe("paused");
    });
  });

  test("an active mailbox keeps status_changed_at", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, mailboxId, deps } = await setup(trx, "active");
      const before = (await getMailbox(trx, ctx, mailboxId))?.status_changed_at;
      const result = await updateMailboxPassword(deps(), ctx, { mailboxId, password: "new-pass", now });
      expect(result).toEqual({ status: "active", reactivated: false });
      const mailbox = await getMailbox(trx, ctx, mailboxId);
      expect(mailbox?.status_changed_at.toISOString()).toBe(before?.toISOString());
      expect((await auditRows(trx, ctx.orgId))[0]?.data).toEqual({ mailbox_id: mailboxId, reactivated: false });
    });
  });

  test("another organization gets mailbox not found and nothing changes", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, mailboxId, deps } = await setup(trx, "auth_error");
      const other = await setup(trx, "active");
      const error = await updateMailboxPassword(deps(), other.ctx, { mailboxId, password: "new-pass", now }).catch(
        (e: unknown) => e
      );
      expect(error).toBeInstanceOf(HardError);
      expect((error as HardError).message).toBe("mailbox not found");
      expect((await storedSecret(trx, mailboxId)).password).toBe("old-pass");
      expect((await getMailbox(trx, ctx, mailboxId))?.status).toBe("auth_error");
      expect(await auditRows(trx, ctx.orgId)).toHaveLength(0);
    });
  });

  test("secret kind: kept when not given, stored when given", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, mailboxId, deps } = await setup(trx, "active");
      await updateMailboxPassword(deps(), ctx, { mailboxId, password: "pass-2", now });
      expect((await storedSecret(trx, mailboxId)).kind).toBe("password");
      await updateMailboxPassword(deps(), ctx, { mailboxId, password: "pass-3", secretKind: "app_password", now });
      const stored = await storedSecret(trx, mailboxId);
      expect(stored).toEqual({ password: "pass-3", kind: "app_password" });
    });
  });
});

describe("mailbox:password CLI", () => {
  test("no arguments and no stdin prints the usage and exits 1", async () => {
    const proc = Bun.spawn(["bun", script], { cwd: repoRoot, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    expect(await proc.exited).toBe(1);
    expect(await new Response(proc.stderr).text()).toContain("usage");
  });
});
