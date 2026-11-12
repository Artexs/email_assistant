import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { MailAuthError, type ImapConnectOptions, type SeedMessage } from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { createMailSyncJob } from "../../src/modules/mail/jobs";
import { countSyncTargets, insertCredentials, insertMailbox, setMailboxStatus } from "../../src/modules/mail/repo";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB } from "../../src/platform/db";
import { SoftError } from "../../src/platform/errors";

import { createOrgWithMailbox, pauseOtherMailboxes, suspendOrg, testCapabilities } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-03T12:00:00Z");
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

interface Box {
  orgId: string;
  mailboxId: string;
  address: string;
}

async function addBox(trx: Transaction<DB>): Promise<Box> {
  const address = `box-${randomUUID()}@x.test`;
  const { orgId, mailboxId } = await createOrgWithMailbox(trx, { address });
  const secret = secrets.encrypt("pw", `mailbox:${mailboxId}`);
  await insertCredentials(
    trx,
    { orgId },
    { mailboxId, encryptedSecret: secret.ciphertext, secretKind: "password", keyVersion: secret.keyVersion }
  );
  return { orgId, mailboxId, address };
}

function seed(n: number): SeedMessage {
  return {
    messageId: `<m${n}@x.test>`,
    from: `sender${n}@x.test`,
    to: ["box@x.test"],
    subject: `Mail ${n}`,
    date: new Date(Date.UTC(2026, 10, 3, 8, 0, n)),
    text: `Body ${n}`,
  };
}

interface Opened {
  fakes: Map<string, FakeMailProvider>;
  opened: FakeMailProvider[];
  failures: Map<string, Error>;
  openProvider(opts: ImapConnectOptions): Promise<FakeMailProvider>;
}

// Fake providers by address. An address without a fake (other rows in the dev DB) fails like a bad login.
function openers(): Opened {
  const fakes = new Map<string, FakeMailProvider>();
  const opened: FakeMailProvider[] = [];
  const failures = new Map<string, Error>();
  return {
    fakes,
    opened,
    failures,
    async openProvider(opts) {
      const failure = failures.get(opts.user);
      if (failure) throw failure;
      const fake = fakes.get(opts.user);
      if (!fake) throw new Error("no fake for this address");
      opened.push(fake);
      return fake;
    },
  };
}

function jobFor(trx: Transaction<DB>, o: Opened) {
  return createMailSyncJob({
    db: trx,
    secrets,
    openProvider: o.openProvider,
    isOwnActionId: async () => false,
    now: () => NOW,
  });
}

async function mailboxRow(trx: Transaction<DB>, id: string) {
  return trx
    .selectFrom("mailboxes")
    .select(["status", "last_synced_at", "status_changed_at"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
}

async function emailCount(trx: Transaction<DB>, mailboxId: string): Promise<number> {
  const rows = await trx.selectFrom("emails").select("id").where("mailbox_id", "=", mailboxId).execute();
  return rows.length;
}

describe("mail sync job", () => {
  test("syncs two active mailboxes and sets last_synced_at", async () => {
    await withRollback(db, async (trx) => {
      const a = await addBox(trx);
      const b = await addBox(trx);
      const o = openers();
      for (const box of [a, b]) {
        const fake = createFakeMailProvider({ uidValidity: 7 });
        fake.deliver("INBOX", seed(1), { internalDate: new Date(NOW.getTime() - 3_600_000) });
        o.fakes.set(box.address, fake);
      }

      await jobFor(trx, o).run();

      expect(await emailCount(trx, a.mailboxId)).toBe(1);
      expect(await emailCount(trx, b.mailboxId)).toBe(1);
      expect((await mailboxRow(trx, a.mailboxId)).last_synced_at).toEqual(NOW);
      expect((await mailboxRow(trx, b.mailboxId)).last_synced_at).toEqual(NOW);
      expect(o.opened.length).toBe(2);
      expect(o.opened.every((fake) => fake.closed)).toBe(true);
    });
  });

  test("a sync folder row that the server does not list is skipped and last_synced_at is set", async () => {
    await withRollback(db, async (trx) => {
      const box = await addBox(trx);
      const o = openers();
      const fake = createFakeMailProvider({ uidValidity: 7 });
      fake.deliver("INBOX", seed(1), { internalDate: new Date(NOW.getTime() - 3_600_000) });
      o.fakes.set(box.address, fake);
      await trx
        .insertInto("mailbox_folders")
        .values({
          org_id: box.orgId,
          mailbox_id: box.mailboxId,
          key: "bills",
          path: "Rachunki",
          role: "sort",
          enabled: true,
          uidvalidity: 1,
          last_uid: 0,
        })
        .execute();

      await jobFor(trx, o).run();

      expect(await emailCount(trx, box.mailboxId)).toBe(1);
      expect((await mailboxRow(trx, box.mailboxId)).last_synced_at).toEqual(NOW);
    });
  });

  test("a login error sets auth_error and the other mailbox still syncs", async () => {
    await withRollback(db, async (trx) => {
      const bad = await addBox(trx);
      const good = await addBox(trx);
      // The bad mailbox must sort first in listSyncTargets, so the test proves that the job goes on after the error.
      await trx
        .updateTable("mailboxes")
        .set({ created_at: sql`now() + interval '1 minute'` })
        .where("id", "=", good.mailboxId)
        .execute();
      const o = openers();
      const attempts: string[] = [];
      const open = o.openProvider;
      o.openProvider = async (opts) => {
        if (opts.user === bad.address || opts.user === good.address) attempts.push(opts.user);
        return open(opts);
      };
      o.failures.set(bad.address, new MailAuthError("IMAP login failed"));
      const fake = createFakeMailProvider({ uidValidity: 7 });
      fake.deliver("INBOX", seed(1), { internalDate: new Date(NOW.getTime() - 3_600_000) });
      o.fakes.set(good.address, fake);

      await jobFor(trx, o).run();

      expect(attempts).toEqual([bad.address, good.address]);
      expect((await mailboxRow(trx, bad.mailboxId)).status).toBe("auth_error");
      expect((await mailboxRow(trx, bad.mailboxId)).status_changed_at).toEqual(NOW);
      expect((await mailboxRow(trx, bad.mailboxId)).last_synced_at).toBeNull();
      expect((await mailboxRow(trx, good.mailboxId)).status).toBe("active");
      expect(await emailCount(trx, good.mailboxId)).toBe(1);
      expect(fake.closed).toBe(true);
    });
  });

  test("a SoftError keeps the status active and last_synced_at empty, and closes the provider", async () => {
    await withRollback(db, async (trx) => {
      const box = await addBox(trx);
      const o = openers();
      const fake = createFakeMailProvider({ uidValidity: 7 });
      fake.failOn("folderStatus", new SoftError("connection lost"));
      o.fakes.set(box.address, fake);

      await jobFor(trx, o).run();

      const row = await mailboxRow(trx, box.mailboxId);
      expect(row.status).toBe("active");
      expect(row.last_synced_at).toBeNull();
      expect(fake.closed).toBe(true);
    });
  });

  test("a paused mailbox is not opened", async () => {
    await withRollback(db, async (trx) => {
      const box = await addBox(trx);
      await setMailboxStatus(trx, { orgId: box.orgId }, box.mailboxId, "paused");
      const o = openers();
      o.fakes.set(box.address, createFakeMailProvider({ uidValidity: 7 }));

      await jobFor(trx, o).run();

      expect(o.opened.length).toBe(0);
      expect((await mailboxRow(trx, box.mailboxId)).last_synced_at).toBeNull();
    });
  });

  test("a folder that fails 3 runs in a row gives one error line; a success resets the count", async () => {
    await withRollback(db, async (trx) => {
      const box = await addBox(trx);
      await trx
        .insertInto("mailbox_folders")
        .values({
          org_id: box.orgId,
          mailbox_id: box.mailboxId,
          key: "offers",
          path: "Oferty",
          role: "sort",
          uidvalidity: 1,
          last_uid: 0,
        })
        .execute();
      const fake = createFakeMailProvider({ uidValidity: 7 });
      fake.deliver("Oferty", seed(1), { internalDate: new Date(NOW.getTime() - 3_600_000) });
      let broken = true;
      const flaky: FakeMailProvider = {
        ...fake,
        fetchAbove: async (folder, lastUid) => {
          if (broken && folder === "Oferty") throw new SoftError("lost connection");
          return fake.fetchAbove(folder, lastUid);
        },
      };
      const o = openers();
      o.fakes.set(box.address, flaky);
      const job = jobFor(trx, o);

      const error = spyOn(console, "error").mockImplementation(() => undefined);
      const info = spyOn(console, "log").mockImplementation(() => undefined);
      try {
        const errorLines = () =>
          error.mock.calls.map((call) => call.join(" ")).filter((line) => line.includes("failed 3 runs in a row"));
        const runs: boolean[] = [true, true, true, true, false, true, true, true];
        const linesAfterRun: number[] = [];
        for (const fails of runs) {
          broken = fails;
          await job.run();
          linesAfterRun.push(errorLines().length);
        }
        // Lines after each run: the 3rd failure gives one, the 4th none, a success resets, the 3rd failure after it gives one.
        expect(linesAfterRun).toEqual([0, 0, 1, 1, 1, 1, 1, 2]);
        expect(errorLines()[0]).toContain(`sync ${box.mailboxId} folder offers: failed 3 runs in a row`);
        expect((await mailboxRow(trx, box.mailboxId)).last_synced_at).toEqual(NOW);
        expect(info.mock.calls.some((call) => call.join(" ").includes(`synced ${box.mailboxId}: folders `))).toBe(true);
      } finally {
        error.mockRestore();
        info.mockRestore();
      }
    });
  });
});

describe("suspended organizations", () => {
  test("a sync run opens the provider of the active organization only", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const a = await addBox(trx);
      const b = await addBox(trx);
      await suspendOrg(trx, b.orgId);
      const o = openers();
      for (const box of [a, b]) {
        const fake = createFakeMailProvider({ uidValidity: 7 });
        fake.deliver("INBOX", seed(1), { internalDate: new Date(NOW.getTime() - 3_600_000) });
        o.fakes.set(box.address, fake);
      }

      await jobFor(trx, o).run();

      expect(o.opened).toHaveLength(1);
      expect(o.opened[0]).toBe(o.fakes.get(a.address) as FakeMailProvider);
      expect((await mailboxRow(trx, a.mailboxId)).last_synced_at).toEqual(NOW);
      expect((await mailboxRow(trx, b.mailboxId)).last_synced_at).toBeNull();
      expect(await emailCount(trx, b.mailboxId)).toBe(0);
    });
  });

  test("countSyncTargets counts active mailboxes of organizations that are not suspended", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const a = await addBox(trx);
      const b = await addBox(trx);
      // A second mailbox of A, paused.
      const pausedId = randomUUID();
      await insertMailbox(
        trx,
        { orgId: a.orgId },
        {
          id: pausedId,
          address: `paused-${randomUUID()}@x.test`,
          imapHost: "imap.x.test",
          imapPort: 993,
          smtpHost: "smtp.x.test",
          smtpPort: 465,
          capabilities: testCapabilities,
          folderMap: {},
        }
      );
      await setMailboxStatus(trx, { orgId: a.orgId }, pausedId, "paused", NOW);
      await suspendOrg(trx, b.orgId);
      expect(await countSyncTargets(trx)).toEqual({ mailboxes: 1, organizations: 1 });
    });
  });
});
