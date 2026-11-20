import { format } from "node:util";

import { HOUR_MS } from "@ea/core";
import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { configureMailHosts, MailAuthError, resolveMailHost, type LookupAll } from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { setMailboxStatus } from "../../src/modules/mail/repo";
import type { DB } from "../../src/platform/db";
import { SoftError } from "../../src/platform/errors";

import { testDb, withRollback } from "./helpers";
import { addBox, emailCount, jobFor, mailboxRow, NOW, type Opened, openers, seed } from "./mail-jobs-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

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
