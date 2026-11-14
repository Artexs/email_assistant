import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { ImapFlow } from "imapflow";
import type { Transaction } from "kysely";

import {
  checkMailbox,
  configureMailHosts,
  connectMailbox,
  inspectMailbox,
  openImapProvider,
  renderSeedMessage,
  setMailboxStatus,
  verifySmtpLogin,
  type ImapConnectOptions,
  type LookupAll,
} from "../../src/modules/mail";
import { connectImapClient } from "../../src/modules/mail/imap/client";
import { probeHeaderSearch, probeSentAutosave } from "../../src/modules/mail/imap/probe";
import { appendRaw } from "../../src/modules/mail/imap/tools";
import { insertCredentials, insertMailbox } from "../../src/modules/mail/repo";
import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, Db, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, testCapabilities } from "./fixtures";
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

describe("inspectMailbox", () => {
  // The preload (`bunfig.toml`) allows local hosts for GreenMail: put that policy back after each test.
  afterEach(() => {
    configureMailHosts({ allowLocal: true });
  });

  const opts = { probe: false };

  // Records the names it gets, and answers one address per name.
  function recordingLookup(answers: Record<string, string>): { lookup: LookupAll; names: string[] } {
    const names: string[] = [];
    const lookup: LookupAll = async (name) => {
      names.push(name);
      return [{ address: answers[name] as string, family: 4 }];
    };
    return { lookup, names };
  }

  test("1: a refused IMAP host and an allowed SMTP host give no report and no connection", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);
      const { lookup, names } = recordingLookup({ "imap.x.test": "10.0.0.7", "smtp.x.test": "93.184.216.34" });
      configureMailHosts({ allowLocal: false, lookup });

      const inspection = await inspectMailbox({ db: trx, secrets }, { orgId }, mailboxId, opts);

      expect(inspection).toMatchObject({ status: "active", hosts: { imap: "refused", smtp: "allowed" }, report: null });
      // A connect would resolve a host again: two names mean no connect attempt.
      expect(names).toEqual(["imap.x.test", "smtp.x.test"]);
    });
  });

  test("2: a host_blocked mailbox shows its status and time, and the row stays as it was", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);
      const at = new Date("2026-11-14T11:00:00Z");
      await setMailboxStatus(trx, { orgId }, mailboxId, "host_blocked", at);
      const before = await trx
        .selectFrom("mailboxes")
        .selectAll()
        .where("id", "=", mailboxId)
        .executeTakeFirstOrThrow();
      configureMailHosts({
        allowLocal: false,
        lookup: recordingLookup({ "imap.x.test": "10.0.0.7", "smtp.x.test": "10.0.0.7" }).lookup,
      });

      const inspection = await inspectMailbox({ db: trx, secrets }, { orgId }, mailboxId, opts);

      expect(inspection).toMatchObject({
        status: "host_blocked",
        hosts: { imap: "refused", smtp: "refused" },
        report: null,
      });
      expect(inspection.statusChangedAt).toEqual(at);
      const after = await trx.selectFrom("mailboxes").selectAll().where("id", "=", mailboxId).executeTakeFirstOrThrow();
      expect(after).toEqual(before);
    });
  });

  test("3: a failed lookup gives lookup_failed for both hosts and no report", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);
      configureMailHosts({
        allowLocal: false,
        lookup: async () => {
          throw new Error("ENOTFOUND");
        },
      });

      const inspection = await inspectMailbox({ db: trx, secrets }, { orgId }, mailboxId, opts);

      expect(inspection).toMatchObject({ hosts: { imap: "lookup_failed", smtp: "lookup_failed" }, report: null });
    });
  });

  test("4: an unknown mailbox id throws", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrgWithMailbox(trx);

      await expect(inspectMailbox({ db: trx, secrets }, { orgId }, randomUUID(), opts)).rejects.toThrow(
        "mailbox not found"
      );
    });
  });
});

describe("mailbox:check CLI", () => {
  function runCheck(args: string[], env: Record<string, string> = { MAIL_ALLOW_LOCAL_HOSTS: "true" }) {
    return Bun.spawn(["bun", checkScript, ...args], {
      cwd: repoRoot,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      // Bun.spawn without `env` does not see the preload's change of process.env.
      env: { ...process.env, ...env },
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
      expect(stdout).toContain("status: active since ");
      expect(stdout).toContain("imap-host: allowed");
      expect(stdout).toContain("smtp-host: allowed");
      expect(stdout.indexOf("smtp-host: allowed")).toBeLessThan(stdout.indexOf("capabilities:"));
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

  test("a host that the guard refuses: exit 2, no connection, no host name", async () => {
    const suffix = randomUUID();
    const { orgId, userId } = await createOrg(db, suffix);
    try {
      const mailboxId = randomUUID();
      const address = `u-${suffix}@localhost`;
      await insertMailbox(
        db,
        { orgId },
        {
          id: mailboxId,
          address,
          imapHost: "127.0.0.1",
          imapPort: imapPort,
          smtpHost: "127.0.0.1",
          smtpPort: smtpPort,
          capabilities: testCapabilities,
          folderMap: {},
        }
      );
      const secret = secrets.encrypt("check-pw", `mailbox:${mailboxId}`);
      await insertCredentials(
        db,
        { orgId },
        { mailboxId, encryptedSecret: secret.ciphertext, secretKind: "password", keyVersion: secret.keyVersion }
      );

      const proc = runCheck(["--org-id", orgId, "--mailbox-id", mailboxId], { MAIL_ALLOW_LOCAL_HOSTS: "false" });
      const [code, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      expect(stderr).toBe("");
      expect(code).toBe(2);
      expect(stdout).toContain("status: active since ");
      expect(stdout).toContain("imap-host: refused");
      expect(stdout).toContain("smtp-host: refused");
      expect(stdout).toContain("the host guard refuses a mail server of this mailbox: no connection");
      expect(stdout).not.toContain("capabilities:");
      expect(stdout).not.toContain("127.0.0.1");
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
