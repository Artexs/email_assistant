import { randomBytes, randomUUID } from "node:crypto";
import { format } from "node:util";

import { HOUR_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import {
  configureMailHosts,
  MailAuthError,
  resolveMailHost,
  type ImapConnectOptions,
  type LookupAll,
  type SeedMessage,
} from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { createMailSyncJob, type MailSyncJobDeps } from "../../src/modules/mail/jobs";
import {
  countSyncTargets,
  getSentSyncState,
  insertCredentials,
  insertMailbox,
  lockSentSyncState,
  setFolderMapEntry,
  setMailboxStatus,
  writeSentSwitch,
} from "../../src/modules/mail/repo";
import { CursorMovedError } from "../../src/modules/mail/sync";
import { configureFeatures, upsertOrgFeature } from "../../src/modules/tenancy";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB } from "../../src/platform/db";
import { HardError, SoftError } from "../../src/platform/errors";

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

function jobFor(trx: Transaction<DB>, o: Opened, sentOriginOf: MailSyncJobDeps["sentOriginOf"] = async () => null) {
  return createMailSyncJob({
    db: trx,
    secrets,
    openProvider: o.openProvider,
    isOwnActionId: async () => false,
    sentOriginOf,
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
        fake.deliver("INBOX", seed(1), { internalDate: new Date(NOW.getTime() - HOUR_MS) });
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
      fake.deliver("INBOX", seed(1), { internalDate: new Date(NOW.getTime() - HOUR_MS) });
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
      fake.deliver("INBOX", seed(1), { internalDate: new Date(NOW.getTime() - HOUR_MS) });
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
      fake.deliver("Oferty", seed(1), { internalDate: new Date(NOW.getTime() - HOUR_MS) });
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
          error.mock.calls.map((call) => format(...call)).filter((line) => line.includes("sync_folder_failing"));
        const runs: boolean[] = [true, true, true, true, false, true, true, true];
        const linesAfterRun: number[] = [];
        for (const fails of runs) {
          broken = fails;
          await job.run();
          linesAfterRun.push(errorLines().length);
        }
        // Lines after each run: the 3rd failure gives one, the 4th none, a success resets, the 3rd failure after it gives one.
        expect(linesAfterRun).toEqual([0, 0, 1, 1, 1, 1, 1, 2]);
        expect(errorLines()[0]).toBe(
          `[mail] sync_folder_failing org_id=${box.orgId} mailbox_id=${box.mailboxId} folder_key=offers failed_runs=3`
        );
        expect((await mailboxRow(trx, box.mailboxId)).last_synced_at).toEqual(NOW);
        expect(
          info.mock.calls.some((call) =>
            format(...call).startsWith(`[mail] sync_done org_id=${box.orgId} mailbox_id=${box.mailboxId} folder_count=`)
          )
        ).toBe(true);
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
        fake.deliver("INBOX", seed(1), { internalDate: new Date(NOW.getTime() - HOUR_MS) });
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

  describe("the host re-check at the start of a run", () => {
    // The preload (`bunfig.toml`) allows local hosts for GreenMail: put that policy back after each test.
    afterEach(() => {
      configureMailHosts({ allowLocal: true });
    });

    function lookupAnswering(address: string): LookupAll {
      return async () => [{ address, family: 4 }];
    }

    function deliverOne(o: Opened, box: Box): FakeMailProvider {
      const fake = createFakeMailProvider({ uidValidity: 7 });
      fake.deliver("INBOX", seed(1), { internalDate: new Date(NOW.getTime() - HOUR_MS) });
      o.fakes.set(box.address, fake);
      return fake;
    }

    test("a blocked mailbox whose hosts now pass is active again, and the same run syncs it", async () => {
      await withRollback(db, async (trx) => {
        const box = await addBox(trx);
        await setMailboxStatus(
          trx,
          { orgId: box.orgId },
          box.mailboxId,
          "host_blocked",
          new Date(NOW.getTime() - HOUR_MS)
        );
        const o = openers();
        deliverOne(o, box);
        configureMailHosts({ allowLocal: false, lookup: lookupAnswering("93.184.216.34") });

        await jobFor(trx, o).run();

        const row = await mailboxRow(trx, box.mailboxId);
        expect(row.status).toBe("active");
        expect(row.status_changed_at).toEqual(NOW);
        expect(row.last_synced_at).toEqual(NOW);
        expect(o.opened).toHaveLength(1);
      });
    });

    test("a blocked mailbox whose host the guard still refuses stays blocked and is not opened", async () => {
      await withRollback(db, async (trx) => {
        const box = await addBox(trx);
        await setMailboxStatus(
          trx,
          { orgId: box.orgId },
          box.mailboxId,
          "host_blocked",
          new Date(NOW.getTime() - HOUR_MS)
        );
        const o = openers();
        deliverOne(o, box);
        configureMailHosts({ allowLocal: false, lookup: lookupAnswering("10.0.0.7") });

        await jobFor(trx, o).run();

        const row = await mailboxRow(trx, box.mailboxId);
        expect(row.status).toBe("host_blocked");
        expect(row.last_synced_at).toBeNull();
        expect(o.opened).toHaveLength(0);
      });
    });

    test("an active mailbox syncs as before: the re-check lists no row and the fake opener calls no guard", async () => {
      await withRollback(db, async (trx) => {
        const box = await addBox(trx);
        const o = openers();
        deliverOne(o, box);
        configureMailHosts({ allowLocal: false, lookup: lookupAnswering("10.0.0.7") });

        await jobFor(trx, o).run();

        expect((await mailboxRow(trx, box.mailboxId)).last_synced_at).toEqual(NOW);
        expect(o.opened).toHaveLength(1);
        expect((await mailboxRow(trx, box.mailboxId)).status).toBe("active");
      });
    });

    test("a re-check that fails does not stop the sync of the active mailboxes", async () => {
      await withRollback(db, async (trx) => {
        const box = await addBox(trx);
        const o = openers();
        deliverOne(o, box);
        // The first read of the run (the list of blocked mailboxes) fails; the sync list works.
        let failedOnce = false;
        const flaky = new Proxy(trx, {
          get(target, prop) {
            if (prop === "selectFrom" && !failedOnce) {
              failedOnce = true;
              return () => {
                throw new Error("boom");
              };
            }
            const value = Reflect.get(target, prop, target) as unknown;
            return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
          },
        });
        const errors = spyOn(console, "error").mockImplementation(() => undefined);
        try {
          await jobFor(flaky, o).run();
        } finally {
          errors.mockRestore();
        }

        expect(failedOnce).toBe(true);
        expect((await mailboxRow(trx, box.mailboxId)).last_synced_at).toEqual(NOW);
        expect(o.opened).toHaveLength(1);
      });
    });

    test("a suspended organization keeps its blocked mailbox: no guard call, no change", async () => {
      await withRollback(db, async (trx) => {
        const box = await addBox(trx);
        await setMailboxStatus(
          trx,
          { orgId: box.orgId },
          box.mailboxId,
          "host_blocked",
          new Date(NOW.getTime() - HOUR_MS)
        );
        await suspendOrg(trx, box.orgId);
        const o = openers();
        deliverOne(o, box);
        configureMailHosts({ allowLocal: false, lookup: lookupAnswering("93.184.216.34") });

        await jobFor(trx, o).run();

        const row = await mailboxRow(trx, box.mailboxId);
        expect(row.status).toBe("host_blocked");
        expect(row.last_synced_at).toBeNull();
        expect(o.opened).toHaveLength(0);
      });
    });
  });
});

describe("the way in: a refused host blocks the mailbox", () => {
  afterEach(() => {
    configureMailHosts({ allowLocal: true });
  });

  // `imap.x.test` is refused when it is in `refused`; any other host is public.
  function lookupFor(refused: ReadonlySet<string>): LookupAll {
    return async (host) => [{ address: refused.has(host) ? "10.0.0.7" : "93.184.216.34", family: 4 }];
  }

  // The opener resolves the host first, as the real opener does, only for the addresses in `users`.
  function guarded(o: Opened, users: ReadonlySet<string>): void {
    const open = o.openProvider;
    o.openProvider = async (opts) => {
      if (users.has(opts.user)) await resolveMailHost(opts.host);
      return open(opts);
    };
  }

  async function hostBlockedAudit(trx: Transaction<DB>, mailboxId: string) {
    const rows = await trx
      .selectFrom("audit_log")
      .select(["actor", "data"])
      .where("event", "=", "mailbox.host_blocked")
      .execute();
    return rows.filter((row) => (row.data as { mailbox_id?: string }).mailbox_id === mailboxId);
  }

  function capture(): { lines: string[]; restore(): void } {
    const lines: string[] = [];
    const spies = (["log", "warn", "error"] as const).map((name) =>
      spyOn(console, name).mockImplementation((...args: unknown[]) => {
        lines.push(format(...args));
      })
    );
    return {
      lines,
      restore() {
        for (const spy of spies) spy.mockRestore();
      },
    };
  }

  test("a refused host blocks the mailbox once; the other mailbox syncs; a second run changes nothing", async () => {
    await withRollback(db, async (trx) => {
      const bad = await addBox(trx);
      const good = await addBox(trx);
      // The bad mailbox sorts first, so the test proves that the job goes on after the block.
      await trx
        .updateTable("mailboxes")
        .set({ created_at: sql`now() + interval '1 minute'` })
        .where("id", "=", good.mailboxId)
        .execute();
      const o = openers();
      guarded(o, new Set([bad.address]));
      const badFake = createFakeMailProvider({ uidValidity: 7 });
      o.fakes.set(bad.address, badFake);
      const fake = createFakeMailProvider({ uidValidity: 7 });
      fake.deliver("INBOX", seed(1), { internalDate: new Date(NOW.getTime() - HOUR_MS) });
      o.fakes.set(good.address, fake);
      configureMailHosts({ allowLocal: false, lookup: lookupFor(new Set(["imap.x.test"])) });
      const log = capture();
      try {
        await jobFor(trx, o).run();

        const row = await mailboxRow(trx, bad.mailboxId);
        expect(row.status).toBe("host_blocked");
        expect(row.status_changed_at).toEqual(NOW);
        expect(row.last_synced_at).toBeNull();
        expect(await hostBlockedAudit(trx, bad.mailboxId)).toEqual([
          { actor: "system", data: { mailbox_id: bad.mailboxId, source: "sync" } },
        ]);
        expect((await mailboxRow(trx, good.mailboxId)).status).toBe("active");
        expect(await emailCount(trx, good.mailboxId)).toBe(1);
        expect(
          log.lines.filter((line) => line.includes("mailbox_host_blocked") && line.includes("reason=sync"))
        ).toHaveLength(1);
        expect(log.lines.some((line) => line.includes(`sync ${bad.mailboxId} failed`))).toBe(false);

        // The second run: the mailbox is not a sync target, the re-check sees `refused`.
        await jobFor(trx, o).run();

        expect(o.opened).not.toContain(badFake);
        const again = await mailboxRow(trx, bad.mailboxId);
        expect(again.status).toBe("host_blocked");
        expect(again.status_changed_at).toEqual(NOW);
        expect(await hostBlockedAudit(trx, bad.mailboxId)).toHaveLength(1);
        expect(log.lines.some((line) => line.includes("imap.x.test") || line.includes("10.0.0.7"))).toBe(false);
      } finally {
        log.restore();
      }
    });
  });

  test("a lookup failure keeps the mailbox active, with no audit row", async () => {
    await withRollback(db, async (trx) => {
      const bad = await addBox(trx);
      const o = openers();
      guarded(o, new Set([bad.address]));
      o.fakes.set(bad.address, createFakeMailProvider({ uidValidity: 7 }));
      configureMailHosts({
        allowLocal: false,
        lookup: async () => {
          throw Object.assign(new Error("lookup failed"), { code: "ENOTFOUND" });
        },
      });
      const log = capture();
      try {
        await jobFor(trx, o).run();

        expect((await mailboxRow(trx, bad.mailboxId)).status).toBe("active");
        expect(await hostBlockedAudit(trx, bad.mailboxId)).toEqual([]);
        expect(log.lines).toContain(
          `[mail] sync_soft_error org_id=${bad.orgId} mailbox_id=${bad.mailboxId} error=MailHostLookupError error_code=ENOTFOUND`
        );
      } finally {
        log.restore();
      }
    });
  });

  test("another error from the opener does not block the mailbox", async () => {
    await withRollback(db, async (trx) => {
      const bad = await addBox(trx);
      const o = openers();
      o.failures.set(bad.address, new Error("something else"));
      const log = capture();
      try {
        await jobFor(trx, o).run();

        expect((await mailboxRow(trx, bad.mailboxId)).status).toBe("active");
        expect(await hostBlockedAudit(trx, bad.mailboxId)).toEqual([]);
        expect(log.lines).toContain(`[mail] sync_failed org_id=${bad.orgId} mailbox_id=${bad.mailboxId} error=Error`);
      } finally {
        log.restore();
      }
    });
  });
});

// The Sent pass in the sync run (ADR 0029).
describe("the Sent pass in the sync job", () => {
  const CANARY = "canary-detail-9f3a@secret.test";
  const SENT_SUBJECT = "Sent subject canary-5c1d";
  const UUID_LOWER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  beforeEach(() => {
    configureFeatures({ off: [] });
  });

  // Every console call as one string (util.format shows the fields of an error object that is logged raw).
  function captureConsole() {
    const lines: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      spyOn(console, method).mockImplementation((...args: unknown[]) => void lines.push(format(...args)))
    );
    return {
      lines,
      restore: () => spies.forEach((spy) => spy.mockRestore()),
    };
  }

  async function enableSent(
    trx: Transaction<DB>,
    box: Box,
    opts: { flag?: boolean; switchOn?: boolean } = {}
  ): Promise<void> {
    const ctx = { orgId: box.orgId };
    if (opts.flag !== false) {
      await upsertOrgFeature(trx, ctx, { flag: "sent_sync", enabled: true, setBy: "test", setAt: NOW });
    }
    if (opts.switchOn !== false) {
      await writeSentSwitch(trx, ctx, box.mailboxId, { enabled: true, at: new Date(NOW.getTime() - HOUR_MS) });
    }
    await setFolderMapEntry(trx, ctx, box.mailboxId, "sent", "Sent");
  }

  function sentSeed(n: number, extra: Partial<SeedMessage> = {}): SeedMessage {
    return {
      messageId: `<sent${n}@x.test>`,
      from: "me@corp.test",
      to: [`to${n}@x.test`],
      subject: SENT_SUBJECT,
      date: new Date(NOW.getTime() - HOUR_MS),
      text: "Sent body canary-77aa",
      ...extra,
    };
  }

  async function fakeWithMail(box: Box, o: Opened, sent: boolean): Promise<FakeMailProvider> {
    const fake = createFakeMailProvider({ uidValidity: 7 });
    fake.deliver("INBOX", seed(1), { internalDate: new Date(NOW.getTime() - HOUR_MS) });
    if (sent) fake.deliver("Sent", sentSeed(1), { internalDate: new Date(NOW.getTime() - HOUR_MS) });
    o.fakes.set(box.address, fake);
    return fake;
  }

  async function sentRows(trx: Transaction<DB>, mailboxId: string) {
    return trx
      .selectFrom("sent_emails")
      .select(["uid", "content", "body_text"])
      .where("mailbox_id", "=", mailboxId)
      .execute();
  }

  test("1: flag and switch on: the INBOX mail goes to emails, the Sent mail to sent_emails, and the log holds ids and counts", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      await enableSent(trx, box);
      const o = openers();
      const fake = await fakeWithMail(box, o, true);

      const capture = captureConsole();
      try {
        await jobFor(trx, o).run();
      } finally {
        capture.restore();
      }

      // The Sent pass runs after the INBOX sync, never before it.
      const folders = fake.folderCalls.map((call) => call.folder);
      expect(folders.indexOf("INBOX")).toBeGreaterThanOrEqual(0);
      expect(folders.indexOf("Sent")).toBeGreaterThan(folders.lastIndexOf("INBOX"));
      expect(await emailCount(trx, box.mailboxId)).toBe(1);
      expect(await sentRows(trx, box.mailboxId)).toEqual([
        { uid: expect.anything(), content: "stored", body_text: "Sent body canary-77aa" },
      ]);
      expect((await mailboxRow(trx, box.mailboxId)).last_synced_at).toEqual(NOW);
      const state = await getSentSyncState(trx, { orgId: box.orgId }, box.mailboxId);
      expect(state?.lastPassAt).toEqual(NOW);
      expect(state?.lastErrorCode).toBeNull();

      const done = capture.lines.filter((line) => line.includes("sent_sync_done"));
      expect(done).toHaveLength(1);
      expect(done[0]).toContain(box.mailboxId);
      expect(done[0]).toMatch(/ status=done /);
      expect(done[0]).toMatch(/ duration_ms=\d+$/);
      expect(capture.lines.filter((line) => line.includes("sent_texts_done"))).toHaveLength(1);
      expect(box.mailboxId).toMatch(UUID_LOWER);
      const all = capture.lines.join("\n");
      for (const secret of [SENT_SUBJECT, "canary-77aa", "to1@x.test", "me@corp.test", box.address, "Sent"]) {
        expect(all).not.toContain(secret);
      }
    });
  });

  test("1b: a Sent fetchContent that never returns: the run ends near the budget, the log says budget, the connection closes, no error code", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      await enableSent(trx, box);
      const o = openers();
      const fake = await fakeWithMail(box, o, true);
      let contentCalls = 0;
      const inboxContent = fake.fetchContent.bind(fake);
      fake.fetchContent = (folder, uid) => {
        if (folder !== "Sent") return inboxContent(folder, uid);
        contentCalls += 1;
        return new Promise(() => undefined);
      };

      const capture = captureConsole();
      const started = performance.now();
      try {
        await createMailSyncJob({
          db: trx,
          secrets,
          openProvider: o.openProvider,
          isOwnActionId: async () => false,
          sentOriginOf: async () => null,
          now: () => NOW,
          sentBudgetMs: 50,
        }).run();
      } finally {
        capture.restore();
      }

      expect(performance.now() - started).toBeLessThan(2_000);
      expect(contentCalls).toBe(1);
      expect(fake.closed).toBe(true);
      const done = capture.lines.filter((line) => line.includes("sent_sync_done"));
      expect(done).toHaveLength(1);
      expect(done[0]).toMatch(/ status=budget /);
      // The budget is 50 ms: the pass took at least that long (a late start or a constant 0 fails here).
      expect(Number(/ duration_ms=(\d+)$/.exec(done[0] ?? "")?.[1])).toBeGreaterThanOrEqual(40);
      expect(capture.lines.filter((line) => line.includes("sent_sync_failed"))).toEqual([]);
      const state = await getSentSyncState(trx, { orgId: box.orgId }, box.mailboxId);
      expect(state?.lastPassAt).toEqual(NOW);
      expect(state?.lastErrorCode).toBeNull();
    });
  });

  test("2: flag off, or switch off: no sent row, no read of the Sent folder, no sent log line", async () => {
    for (const opts of [{ flag: false }, { switchOn: false }]) {
      await withRollback(db, async (trx) => {
        await pauseOtherMailboxes(trx);
        const box = await addBox(trx);
        await enableSent(trx, box, opts);
        const o = openers();
        const fake = await fakeWithMail(box, o, true);

        const capture = captureConsole();
        try {
          await jobFor(trx, o).run();
        } finally {
          capture.restore();
        }

        expect(await emailCount(trx, box.mailboxId)).toBe(1);
        expect(await sentRows(trx, box.mailboxId)).toEqual([]);
        expect(fake.folderCalls.filter((call) => call.folder === "Sent")).toEqual([]);
        expect(capture.lines.filter((line) => line.includes("sent_"))).toEqual([]);
      });
    }
  });

  test("2b: when the INBOX sync fails, the Sent pass does not run", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      await enableSent(trx, box);
      const o = openers();
      const fake = await fakeWithMail(box, o, true);
      fake.failOn("folderStatus", new CursorMovedError("cursor moved"));

      const capture = captureConsole();
      try {
        await jobFor(trx, o).run();
      } finally {
        capture.restore();
      }

      expect((await mailboxRow(trx, box.mailboxId)).last_synced_at).toBeNull();
      expect(fake.folderCalls.filter((call) => call.folder === "Sent")).toEqual([]);
      expect(await sentRows(trx, box.mailboxId)).toEqual([]);
      expect(capture.lines.filter((line) => line.includes("sent_"))).toEqual([]);
    });
  });

  test("3: a Sent pass that throws is caught; the INBOX mail is stored, the error is marked and logged with fields only", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const first = await addBox(trx);
      const second = await addBox(trx);
      // The failing mailbox syncs first: the test shows that the run goes on with the next mailbox.
      await trx
        .updateTable("mailboxes")
        .set({ created_at: sql`now() + interval '1 minute'` })
        .where("id", "=", second.mailboxId)
        .execute();
      await enableSent(trx, first);
      const o = openers();
      const fake = createFakeMailProvider({ uidValidity: 7 });
      fake.deliver("INBOX", seed(1), { internalDate: new Date(NOW.getTime() - HOUR_MS) });
      fake.deliver("Sent", sentSeed(1, { headers: { "X-EA-Action-Id": randomUUID() } }), {
        internalDate: new Date(NOW.getTime() - HOUR_MS),
      });
      o.fakes.set(first.address, fake);
      const other = createFakeMailProvider({ uidValidity: 7 });
      other.deliver("INBOX", seed(2), { internalDate: new Date(NOW.getTime() - HOUR_MS) });
      o.fakes.set(second.address, other);
      // A database-like error: a code, and a detail that holds mail data.
      const failure = Object.assign(new HardError(`check failed for ${CANARY}`), {
        code: "23514",
        detail: `Failing row contains (${CANARY}, ${SENT_SUBJECT})`,
      });

      const capture = captureConsole();
      try {
        await jobFor(trx, o, async () => {
          throw failure;
        }).run();
      } finally {
        capture.restore();
      }

      expect(await emailCount(trx, first.mailboxId)).toBe(1);
      expect(await emailCount(trx, second.mailboxId)).toBe(1);
      expect((await mailboxRow(trx, first.mailboxId)).last_synced_at).toEqual(NOW);
      expect((await mailboxRow(trx, first.mailboxId)).status).toBe("active");
      expect(await sentRows(trx, first.mailboxId)).toEqual([]);
      const state = await getSentSyncState(trx, { orgId: first.orgId }, first.mailboxId);
      expect(state?.lastErrorCode).toBe("failed");
      expect(state?.lastPassAt).toEqual(NOW);
      expect(fake.closed).toBe(true);

      const failed = capture.lines.filter((line) => line.includes("sent_sync_failed"));
      expect(failed).toHaveLength(1);
      expect(failed[0]).toContain(first.mailboxId);
      expect(failed[0]).toContain("23514");
      expect(capture.lines.filter((line) => line.includes("sent_sync_done"))).toEqual([]);
      const all = capture.lines.join("\n");
      for (const secret of [CANARY, SENT_SUBJECT, "Failing row", "check failed"]) expect(all).not.toContain(secret);
    });
  });

  test("4: a login error in the Sent pass is only logged: the status stays active", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      await enableSent(trx, box);
      const o = openers();
      const fake = await fakeWithMail(box, o, false);
      fake.deliver("Sent", sentSeed(1, { headers: { "X-EA-Action-Id": randomUUID() } }), {
        internalDate: new Date(NOW.getTime() - HOUR_MS),
      });

      const capture = captureConsole();
      try {
        await jobFor(trx, o, async () => {
          throw new MailAuthError(`login failed for ${CANARY}`);
        }).run();
      } finally {
        capture.restore();
      }

      const row = await mailboxRow(trx, box.mailboxId);
      expect(row.status).toBe("active");
      expect(row.last_synced_at).toEqual(NOW);
      expect(capture.lines.filter((line) => line.includes("sent_sync_failed"))).toHaveLength(1);
      expect(capture.lines.join("\n")).not.toContain(CANARY);
    });
  });

  test("5: when marking the failure fails too, the run goes on and logs sent_sync_mark_failed without the detail", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      await enableSent(trx, box);
      const o = openers();
      await fakeWithMail(box, o, true);
      // Every write to the state row fails with a detail that holds mail data.
      const broken = new Proxy(trx, {
        get(target, prop) {
          if (prop === "updateTable") {
            return (table: string) => {
              if (table === "mailbox_sent_sync") {
                throw Object.assign(new Error(`write failed ${CANARY}`), { code: "23514", detail: CANARY });
              }
              return (target.updateTable as (name: string) => unknown)(table);
            };
          }
          const value: unknown = Reflect.get(target, prop, target);
          return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      });
      const job = createMailSyncJob({
        db: broken,
        secrets,
        openProvider: o.openProvider,
        isOwnActionId: async () => false,
        sentOriginOf: async () => null,
        now: () => NOW,
      });

      const capture = captureConsole();
      try {
        await job.run();
      } finally {
        capture.restore();
      }

      expect(await emailCount(trx, box.mailboxId)).toBe(1);
      expect((await mailboxRow(trx, box.mailboxId)).last_synced_at).toEqual(NOW);
      expect(capture.lines.filter((line) => line.includes("sent_sync_failed"))).toHaveLength(1);
      expect(capture.lines.filter((line) => line.includes("sent_sync_mark_failed"))).toHaveLength(1);
      expect(capture.lines.join("\n")).not.toContain(CANARY);
    });
  });

  // This test commits its data: a row lock only blocks a second connection.
  test("6: no IMAP call of the Sent pass runs inside a lock of the state row", async () => {
    const created = await db.transaction().execute(async (trx) => {
      const box = await addBox(trx);
      await enableSent(trx, box);
      return box;
    });
    try {
      const o = openers();
      const real = createFakeMailProvider({ uidValidity: 7 });
      real.deliver("INBOX", seed(1), { internalDate: new Date(NOW.getTime() - HOUR_MS) });
      real.deliver("Sent", sentSeed(1), { internalDate: new Date(NOW.getTime() - HOUR_MS) });
      // Before each call on the Sent folder, a second connection asks for the state row lock. A held lock times out.
      const probes: boolean[] = [];
      const probe = async (): Promise<void> => {
        try {
          await db.transaction().execute(async (other) => {
            await sql`set local lock_timeout = '400ms'`.execute(other);
            await lockSentSyncState(other, { orgId: created.orgId }, created.mailboxId);
          });
          probes.push(true);
        } catch {
          probes.push(false);
        }
      };
      const sentOnly = async (folder: string): Promise<void> => {
        if (folder === "Sent") await probe();
      };
      const probing: FakeMailProvider = {
        ...real,
        folderStatus: async (folder) => {
          await sentOnly(folder);
          return real.folderStatus(folder);
        },
        fetchAbove: async (folder, uid) => {
          await sentOnly(folder);
          return real.fetchAbove(folder, uid);
        },
        searchSinceIn: async (folder, since) => {
          await sentOnly(folder);
          return real.searchSinceIn(folder, since);
        },
        fetchContent: async (folder, uid) => {
          await sentOnly(folder);
          return real.fetchContent(folder, uid);
        },
        fetchByUidsIn: async (folder, uids) => {
          await sentOnly(folder);
          return real.fetchByUidsIn(folder, uids);
        },
      };
      o.fakes.set(created.address, probing);
      const job = createMailSyncJob({
        db,
        secrets,
        openProvider: o.openProvider,
        isOwnActionId: async () => false,
        sentOriginOf: async () => null,
        now: () => NOW,
      });

      const capture = captureConsole();
      try {
        await job.run();
      } finally {
        capture.restore();
      }

      const rows = await db
        .selectFrom("sent_emails")
        .select("content")
        .where("mailbox_id", "=", created.mailboxId)
        .execute();
      expect(rows).toEqual([{ content: "stored" }]);
      // folderStatus, the since search, and the text fetch.
      expect(probes.length).toBeGreaterThanOrEqual(3);
      expect(probes.every(Boolean)).toBe(true);
    } finally {
      await db.deleteFrom("organizations").where("id", "=", created.orgId).execute();
    }
  });
});

// Every line of the sync job is an event with ids, codes and counts. A server reply, an address or a subject never reaches a line.
describe("mail sync job: log lines are events without server text", () => {
  const MARKER = "MARKER-ADDR@x.test";
  const MARKER_SUBJECT = "MARKER-SUBJECT canary-1b7e";

  function captureLines(): { lines: string[]; restore(): void } {
    const lines: string[] = [];
    const spies = (["log", "warn", "error"] as const).map((name) =>
      spyOn(console, name).mockImplementation((...args: unknown[]) => void lines.push(format(...args)))
    );
    return { lines, restore: () => spies.forEach((spy) => spy.mockRestore()) };
  }

  async function runWith(
    trx: Transaction<DB>,
    box: Box,
    prepare: (o: Opened) => void,
    makeJob: (o: Opened) => { run(): Promise<void> } = (o) => jobFor(trx, o)
  ): Promise<string[]> {
    const o = openers();
    prepare(o);
    const capture = captureLines();
    try {
      await makeJob(o).run();
    } finally {
      capture.restore();
    }
    // The canary check reads every captured line, also a line without the ids (a free-text line next to an event).
    expect(capture.lines.join("\n")).not.toContain("MARKER");
    const mine = `org_id=${box.orgId} mailbox_id=${box.mailboxId}`;
    return capture.lines.filter((line) => line.includes(mine));
  }

  const withMail = (box: Box) => (o: Opened) => {
    const fake = createFakeMailProvider({ uidValidity: 7 });
    fake.deliver("INBOX", { ...seed(1), subject: MARKER_SUBJECT }, { internalDate: new Date(NOW.getTime() - HOUR_MS) });
    o.fakes.set(box.address, fake);
  };

  test("a good run writes sync_done with the folder count and the four sums, and no subject", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);

      const lines = await runWith(trx, box, withMail(box));

      expect(lines).toContain(
        `[mail] sync_done org_id=${box.orgId} mailbox_id=${box.mailboxId} folder_count=1 fetched=1 stored=1 uid_updated=0 returned=0`
      );
      expect(lines.join("\n")).not.toContain("MARKER");
    });
  });

  test("a SoftError with an address in its text writes sync_soft_error with the error name only", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);

      const lines = await runWith(trx, box, (o) => {
        const fake = createFakeMailProvider({ uidValidity: 7 });
        fake.failOn("folderStatus", new SoftError(`connection lost for ${MARKER}`));
        o.fakes.set(box.address, fake);
      });

      expect(lines).toEqual([`[mail] sync_soft_error org_id=${box.orgId} mailbox_id=${box.mailboxId} error=SoftError`]);
    });
  });

  test("a failure that is not soft writes sync_failed; an address in its code is dropped, never logged", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const mine = `[mail] sync_failed org_id=${box.orgId} mailbox_id=${box.mailboxId}`;

      const plain = await runWith(trx, box, (o) => {
        o.failures.set(box.address, new Error(`NO [AUTHENTICATIONFAILED] ${MARKER}`));
      });
      expect(plain).toEqual([`${mine} error=Error`]);

      const coded = await runWith(trx, box, (o) => {
        o.failures.set(box.address, Object.assign(new Error(`NO ${MARKER}`), { code: MARKER }));
      });
      expect(coded).toEqual([`${mine} error=Error dropped_fields=1`]);

      const known = await runWith(trx, box, (o) => {
        o.failures.set(box.address, Object.assign(new Error(`NO ${MARKER}`), { code: "ECONNRESET" }));
      });
      expect(known).toEqual([`${mine} error=Error error_code=ECONNRESET`]);
    });
  });

  test("a login error writes sync_auth_error and sets the status", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);

      const lines = await runWith(trx, box, (o) => {
        o.failures.set(box.address, new MailAuthError(`login failed for ${MARKER}`));
      });

      expect(lines).toEqual([`[mail] sync_auth_error org_id=${box.orgId} mailbox_id=${box.mailboxId}`]);
      expect((await mailboxRow(trx, box.mailboxId)).status).toBe("auth_error");
    });
  });

  test("a login error whose status write fails writes sync_auth_error_save_failed without the database text", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const broken = new Proxy(trx, {
        get(target, prop) {
          if (prop === "updateTable") {
            return (table: string) => {
              if (table === "mailboxes") {
                throw Object.assign(new Error(`write failed ${MARKER}`), { code: "23514", detail: MARKER });
              }
              return (target.updateTable as (name: string) => unknown)(table);
            };
          }
          const value: unknown = Reflect.get(target, prop, target);
          return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      });

      const lines = await runWith(
        trx,
        box,
        (o) => o.failures.set(box.address, new MailAuthError(`login failed for ${MARKER}`)),
        (o) =>
          createMailSyncJob({
            db: broken,
            secrets,
            openProvider: o.openProvider,
            isOwnActionId: async () => false,
            sentOriginOf: async () => null,
            now: () => NOW,
          })
      );

      expect(lines).toEqual([
        `[mail] sync_auth_error_save_failed org_id=${box.orgId} mailbox_id=${box.mailboxId} error=Error error_code=23514`,
      ]);
    });
  });

  test("a close that rejects with an address writes imap_close_failed with the error name only", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);

      const lines = await runWith(trx, box, (o) => {
        withMail(box)(o);
        const fake = o.fakes.get(box.address) as FakeMailProvider;
        o.fakes.set(box.address, {
          ...fake,
          close: async () => {
            throw Object.assign(new Error(`close failed ${MARKER}`), { code: "EPIPE" });
          },
        });
      });

      expect(lines).toContain(
        `[mail] imap_close_failed org_id=${box.orgId} mailbox_id=${box.mailboxId} error=Error error_code=EPIPE`
      );
      expect(lines.join("\n")).not.toContain("MARKER");
    });
  });

  test("a folder that fails three runs in a row writes sync_folder_failing with the folder key and the count", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      await trx
        .insertInto("mailbox_folders")
        .values({
          org_id: box.orgId,
          mailbox_id: box.mailboxId,
          key: "offers",
          path: "Oferty",
          role: "sort",
          enabled: true,
          uidvalidity: 1,
          last_uid: 0,
        })
        .execute();
      const o = openers();
      const fake = createFakeMailProvider({ uidValidity: 7 });
      await fake.ensureFolder("Oferty");
      o.fakes.set(box.address, {
        ...fake,
        fetchAbove: async (folder, lastUid) => {
          if (folder === "Oferty") throw new SoftError(`lost connection ${MARKER}`);
          return fake.fetchAbove(folder, lastUid);
        },
      });
      const job = jobFor(trx, o);
      const capture = captureLines();
      try {
        await job.run();
        await job.run();
        await job.run();
      } finally {
        capture.restore();
      }

      const mine = capture.lines.filter((line) => line.includes(box.mailboxId));
      expect(mine.filter((line) => line.includes("sync_folder_failing"))).toEqual([
        `[mail] sync_folder_failing org_id=${box.orgId} mailbox_id=${box.mailboxId} folder_key=offers failed_runs=3`,
      ]);
      expect(mine.filter((line) => line.includes("sync_folder_soft_error"))).toHaveLength(3);
      expect(capture.lines.join("\n")).not.toContain("MARKER");
    });
  });
});
