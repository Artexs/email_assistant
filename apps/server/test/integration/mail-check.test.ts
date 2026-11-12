import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { ImapFlow } from "imapflow";
import type { Transaction } from "kysely";

import {
  checkMailbox,
  connectMailbox,
  openImapProvider,
  renderSeedMessage,
  verifySmtpLogin,
  type ImapConnectOptions,
} from "../../src/modules/mail";
import { connectImapClient } from "../../src/modules/mail/imap/client";
import { probeHeaderSearch, probeSentAutosave } from "../../src/modules/mail/imap/probe";
import { appendRaw } from "../../src/modules/mail/imap/tools";
import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, Db, TenantContext } from "../../src/platform/db";

import { testDb, withRollback } from "./helpers";

// Needs the local GreenMail (bun run dev:up). Auth is off: any password logs in.
const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const checkScript = resolve(import.meta.dir, "../../src/scripts/mailbox-check.ts");
const host = process.env.TEST_IMAP_HOST ?? "127.0.0.1";
const imapPort = Number(process.env.TEST_IMAP_PORT ?? "3143");
const smtpPort = Number(process.env.TEST_SMTP_PORT ?? "3025");
// The CLI decrypts with the configured key, so the tests encrypt with it too.
const config = loadConfig();
const secrets = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION);
const fast = { sentTimeoutMs: 3000, pollMs: 500 };
// The Sent probe waits `sentTimeoutMs`, plus a few GreenMail connections.
const probeTimeoutMs = 20_000;

afterAll(async () => {
  await db.destroy();
});

function imapOptions(address: string, password: string): ImapConnectOptions {
  return { host, port: imapPort, user: address, password };
}

function seedRaw(address: string, subject: string): string {
  return renderSeedMessage({ from: address, to: [address], subject, date: new Date(), text: "Seed" });
}

/** Creates the folders on GreenMail with one seed mail each (GreenMail has no default folders). */
async function seedFolders(imap: ImapConnectOptions, folders: string[]): Promise<void> {
  for (const folder of folders) await appendRaw(imap, folder, seedRaw(imap.user, `Seed ${folder}`));
}

async function folderCounts(imap: ImapConnectOptions): Promise<Record<string, number>> {
  const client = await connectImapClient(imap);
  try {
    const counts: Record<string, number> = {};
    for (const entry of await client.list()) {
      counts[entry.path] = (await client.status(entry.path, { messages: true })).messages ?? -1;
    }
    return counts;
  } finally {
    await client.logout();
  }
}

async function countBySubject(imap: ImapConnectOptions, folder: string, subject: string): Promise<number> {
  const client = await connectImapClient(imap);
  try {
    const lock = await client.getMailboxLock(folder);
    try {
      const uids = await client.search({ subject }, { uid: true });
      return uids === false ? 0 : uids.length;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

/** Sets `\Deleted` on the seed mail: a plain EXPUNGE by the probe would delete it. */
async function markSeedDeleted(imap: ImapConnectOptions, folder: string): Promise<void> {
  const client = await connectImapClient(imap);
  try {
    const lock = await client.getMailboxLock(folder);
    try {
      expect(await client.messageFlagsAdd({ subject: `Seed ${folder}` }, ["\\Deleted"])).toBe(true);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

async function createOrg(trx: Db | Transaction<DB>, suffix = randomUUID()) {
  return createOrganizationWithOwner(trx, {
    orgName: `Check Org ${suffix}`,
    timezone: "Europe/Warsaw",
    email: `check-${suffix}@x.test`,
    displayName: "Owner",
  });
}

async function connectGreenmail(
  trx: Db | Transaction<DB>,
  ctx: TenantContext,
  folders: string[]
): Promise<{ mailboxId: string; imap: ImapConnectOptions; password: string }> {
  const address = `u-${randomUUID()}@localhost`;
  const password = `check-pw-${randomUUID()}`;
  const imap = imapOptions(address, password);
  await seedFolders(imap, folders);
  const { mailboxId } = await connectMailbox(
    { db: trx, secrets, openProvider: openImapProvider, verifySmtp: verifySmtpLogin },
    ctx,
    {
      address,
      password,
      secretKind: "password",
      imapHost: host,
      imapPort,
      smtpHost: host,
      smtpPort,
    }
  );
  return { mailboxId, imap, password };
}

describe("checkMailbox", () => {
  test("without probe: reports capabilities and folders and adds no message", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrg(trx);
      const ctx = { orgId };
      const { mailboxId, imap } = await connectGreenmail(trx, ctx, ["Drafts", "Sent"]);
      const before = await folderCounts(imap);

      const report = await checkMailbox({ db: trx, secrets }, ctx, mailboxId, { probe: false });

      expect(report.capabilities).toMatchObject({ idle: true, move: true, uidplus: true });
      expect(report.folders).toContainEqual({ path: "Drafts", specialUse: "\\Drafts" });
      expect(report.folders).toContainEqual({ path: "Sent", specialUse: "\\Sent" });
      expect(report.searchHeader).toBe("skipped");
      expect(report.sentAutosave).toBe("skipped");
      expect(await folderCounts(imap)).toEqual(before);
    });
  });

  test(
    "with probe: SEARCH HEADER works, the draft is deleted, the probe mail reaches INBOX",
    async () => {
      await withRollback(db, async (trx) => {
        const { orgId } = await createOrg(trx);
        const ctx = { orgId };
        const { mailboxId, imap } = await connectGreenmail(trx, ctx, ["Drafts", "Sent"]);
        await markSeedDeleted(imap, "Drafts");
        const before = await folderCounts(imap);

        const report = await checkMailbox({ db: trx, secrets }, ctx, mailboxId, { probe: true, ...fast });

        expect(report.capabilities).toMatchObject({ idle: true, move: true, uidplus: true });
        expect(report.searchHeader).toBe("yes");
        // GreenMail does not save SMTP mail to Sent.
        expect(report.sentAutosave).toBe("no");
        expect(report.notes.some((note) => note.startsWith("delete the probe draft"))).toBe(false);
        expect(report.notes.some((note) => /^the probe mail "EA probe \S+" is in INBOX/.test(note))).toBe(true);

        const after = await folderCounts(imap);
        expect(after.Drafts).toBe(before.Drafts);
        expect(after.Sent).toBe(before.Sent);
        // UID EXPUNGE removed only the probe, not the user's own \Deleted draft.
        expect(await countBySubject(imap, "Drafts", "Seed Drafts")).toBe(1);
        expect(await countBySubject(imap, "INBOX", "EA probe")).toBe(1);
      });
    },
    probeTimeoutMs
  );

  test(
    "a Sent probe error after a left probe draft still names both probes",
    async () => {
      await withRollback(db, async (trx) => {
        const { orgId } = await createOrg(trx);
        const ctx = { orgId };
        const { mailboxId } = await connectGreenmail(trx, ctx, ["Drafts", "Sent"]);
        // The draft is left as without UIDPLUS; the Sent search fails after the probe mail is sent.
        const deleteSpy = spyOn(ImapFlow.prototype, "messageDelete").mockResolvedValue(false);
        const noopSpy = spyOn(ImapFlow.prototype, "noop").mockRejectedValue(new Error("lost"));
        try {
          const error = await checkMailbox({ db: trx, secrets }, ctx, mailboxId, { probe: true, ...fast }).catch(
            (reason: unknown) => reason
          );
          expect(error).toBeInstanceOf(Error);
          const message = (error as Error).message;
          expect(message).toMatch(/the probe mail "EA probe \S+" may be in INBOX .*; delete it by hand/);
          expect(message).toMatch(/delete the probe draft "EA probe \S+" by hand/);
        } finally {
          deleteSpy.mockRestore();
          noopSpy.mockRestore();
        }
      });
    },
    probeTimeoutMs
  );

  test("with probe and no Drafts or Sent folder: both probes are skipped with a note", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrg(trx);
      const ctx = { orgId };
      const { mailboxId, imap } = await connectGreenmail(trx, ctx, []);

      const report = await checkMailbox({ db: trx, secrets }, ctx, mailboxId, { probe: true, ...fast });

      expect(report.searchHeader).toBe("skipped");
      expect(report.sentAutosave).toBe("skipped");
      expect(report.notes.some((note) => note.includes("\\Drafts"))).toBe(true);
      expect(report.notes.some((note) => note.includes("\\Sent"))).toBe(true);
      expect(await countBySubject(imap, "INBOX", "EA probe")).toBe(0);
    });
  });

  test("an unknown mailbox throws", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrg(trx);
      await expect(checkMailbox({ db: trx, secrets }, { orgId }, randomUUID(), { probe: false })).rejects.toThrow(
        "mailbox not found"
      );
    });
  });
});

describe("probeHeaderSearch", () => {
  test("without UIDPLUS it leaves the probe draft (no EXPUNGE)", async () => {
    const address = `u-${randomUUID()}@localhost`;
    const imap = imapOptions(address, "greenmail-test");
    await seedFolders(imap, ["Drafts"]);
    await markSeedDeleted(imap, "Drafts");
    const probeId = randomUUID();

    const result = await probeHeaderSearch(imap, "Drafts", { uidplus: false, probeId });

    expect(result).toEqual({ found: true, deleted: false });
    expect(await countBySubject(imap, "Drafts", `EA probe ${probeId}`)).toBe(1);
    expect(await countBySubject(imap, "Drafts", "Seed Drafts")).toBe(1);
  });

  test("a search error after the APPEND names the probe draft to delete by hand", async () => {
    const address = `u-${randomUUID()}@localhost`;
    const imap = imapOptions(address, "greenmail-test");
    await seedFolders(imap, ["Drafts"]);
    const probeId = randomUUID();

    const searchSpy = spyOn(ImapFlow.prototype, "search").mockRejectedValue(new Error("lost"));
    try {
      await expect(probeHeaderSearch(imap, "Drafts", { uidplus: true, probeId })).rejects.toThrow(
        `the probe draft "EA probe ${probeId}" may be in Drafts; delete it by hand`
      );
    } finally {
      searchSpy.mockRestore();
    }
    expect(await countBySubject(imap, "Drafts", `EA probe ${probeId}`)).toBe(1);
  });
});

describe("probeSentAutosave", () => {
  test("an IMAP error after the send names the probe mail to delete by hand", async () => {
    const address = `u-${randomUUID()}@localhost`;
    const password = "greenmail-test";
    const imap = imapOptions(address, password);
    const smtp = { host, port: smtpPort, user: address, password };
    const probeId = randomUUID();

    await expect(
      probeSentAutosave(imap, smtp, address, "NoSuchSent", { probeId, ...fast, searchByHeader: true })
    ).rejects.toThrow(`the probe mail "EA probe ${probeId}" may be in INBOX (and NoSuchSent); delete it by hand`);
    expect(await countBySubject(imap, "INBOX", `EA probe ${probeId}`)).toBe(1);
  });
});

describe("mailbox:check CLI", () => {
  function runCheck(args: string[]) {
    return Bun.spawn(["bun", checkScript, ...args], {
      cwd: repoRoot,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      // Bun.spawn without `env` does not see the preload's change of process.env.
      env: { ...process.env, MAIL_ALLOW_LOCAL_HOSTS: "true" },
    });
  }

  test("prints the report; the password is not in the output", async () => {
    const suffix = randomUUID();
    const { orgId, userId } = await createOrg(db, suffix);
    try {
      const { mailboxId, password } = await connectGreenmail(db, { orgId }, ["Drafts"]);
      const proc = runCheck(["--org-id", orgId, "--mailbox-id", mailboxId]);
      const [code, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      expect(stderr).toBe("");
      expect(code).toBe(0);
      expect(stdout).toContain("capabilities: IDLE=yes MOVE=yes UIDPLUS=yes CONDSTORE=");
      expect(stdout).toContain("folder Drafts \\Drafts");
      expect(stdout).toContain("search-header: skipped");
      expect(stdout).toContain("smtp-saves-sent: skipped");
      expect(stdout).not.toContain(password);
      expect(stdout).not.toContain(Buffer.from(password).toString("base64"));
    } finally {
      await db.deleteFrom("organizations").where("id", "=", orgId).execute();
      await db.deleteFrom("users").where("id", "=", userId).execute();
    }
  });

  test("bad args print the usage and exit 1", async () => {
    const proc = runCheck(["--org-id", randomUUID()]);
    expect(await proc.exited).toBe(1);
    expect(await new Response(proc.stderr).text()).toContain("usage");
  });
});
