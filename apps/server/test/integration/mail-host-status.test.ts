import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { configureMailHosts, type LookupAll } from "../../src/modules/mail";
import { markHostBlocked, recheckBlockedHosts } from "../../src/modules/mail/host-status";
import { changeMailboxStatus, setMailboxStatus } from "../../src/modules/mail/repo";
import type { DB, Db } from "../../src/platform/db";

import { createOrgWithMailbox, suspendOrg } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-14T12:00:00Z");
const BLOCKED_AT = new Date(NOW.getTime() - 3_600_000);
const PUBLIC = "93.184.216.34";

// The preload (`bunfig.toml`) allows local hosts for GreenMail. Each test sets a refusing policy; this puts the preload policy back (D19).
afterEach(() => {
  configureMailHosts({ allowLocal: true });
});

let lines: string[] = [];
let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  lines = [];
  logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.join(" "));
  });
  errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    lines.push(args.join(" "));
  });
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

interface Blocked {
  orgId: string;
  mailboxId: string;
  imap: string;
  smtp: string;
}

// A `host_blocked` mailbox with host names of its own, so that a test can tell its lookups and its log lines from other rows.
async function blockedBox(trx: Transaction<DB>, createdAtOffsetMs = 0): Promise<Blocked> {
  const { orgId, mailboxId } = await createOrgWithMailbox(trx);
  const imap = `imap-${randomUUID()}.x.test`;
  const smtp = `smtp-${randomUUID()}.x.test`;
  await trx
    .updateTable("mailboxes")
    .set({ imap_host: imap, smtp_host: smtp, created_at: new Date(NOW.getTime() + createdAtOffsetMs) })
    .where("id", "=", mailboxId)
    .execute();
  await setMailboxStatus(trx, { orgId }, mailboxId, "host_blocked", BLOCKED_AT);
  return { orgId, mailboxId, imap, smtp };
}

function answer(by: (host: string) => string | Error): { calls: string[] } {
  const calls: string[] = [];
  const lookup: LookupAll = async (host) => {
    calls.push(host);
    const result = by(host);
    if (result instanceof Error) throw result;
    return [{ address: result, family: 4 }];
  };
  configureMailHosts({ allowLocal: false, lookup });
  return { calls };
}

async function rowOf(trx: Transaction<DB>, id: string) {
  return trx
    .selectFrom("mailboxes")
    .select(["status", "status_changed_at"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
}

async function auditOf(trx: Transaction<DB>, mailboxId: string) {
  const rows = await trx
    .selectFrom("audit_log")
    .select(["actor", "event", "data", "created_at"])
    .where("event", "=", "mailbox.host_allowed")
    .execute();
  return rows.filter((row) => (row.data as { mailbox_id?: string }).mailbox_id === mailboxId);
}

function run(trx: Transaction<DB> | Db) {
  return recheckBlockedHosts({ db: trx, now: () => NOW });
}

// A db handle that fails when `shouldFail` says so, as a broken connection does. The rest goes to the real transaction.
function failing(
  trx: Transaction<DB>,
  method: "selectFrom" | "updateTable",
  shouldFail: () => boolean
): Transaction<DB> {
  return new Proxy(trx, {
    get(target, prop) {
      if (prop === method && shouldFail()) {
        return () => {
          throw new Error("boom");
        };
      }
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

describe("recheckBlockedHosts", () => {
  test("1: a blocked mailbox whose hosts pass becomes active, with no connection and no password", async () => {
    await withRollback(db, async (trx) => {
      const box = await blockedBox(trx);
      answer(() => PUBLIC);
      // The mailbox has no credentials row: the guard needs none.
      expect(
        await trx
          .selectFrom("mailbox_credentials")
          .select("mailbox_id")
          .where("mailbox_id", "=", box.mailboxId)
          .execute()
      ).toEqual([]);

      await run(trx);

      const row = await rowOf(trx, box.mailboxId);
      expect(row.status).toBe("active");
      expect(row.status_changed_at).toEqual(NOW);
      const audit = await auditOf(trx, box.mailboxId);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.actor).toBe("system");
      expect(audit[0]?.data).toEqual({ mailbox_id: box.mailboxId });
      expect(
        lines.filter((line) => line.includes("mailbox_host_allowed") && line.includes(box.mailboxId))
      ).toHaveLength(1);
      for (const line of lines) {
        for (const secret of [box.imap, box.smtp, PUBLIC]) expect(line).not.toContain(secret);
      }
    });
  });

  test("2: a repeat run changes nothing", async () => {
    await withRollback(db, async (trx) => {
      const box = await blockedBox(trx);
      answer(() => PUBLIC);
      await run(trx);
      const after = await rowOf(trx, box.mailboxId);
      lines = [];

      const again = await recheckBlockedHosts({ db: trx, now: () => new Date(NOW.getTime() + 60_000) });

      expect(await auditOf(trx, box.mailboxId)).toHaveLength(1);
      expect(await rowOf(trx, box.mailboxId)).toEqual(after);
      expect(lines.some((line) => line.includes(box.mailboxId))).toBe(false);
      expect(again.reopened).toBe(0);
    });
  });

  test("3: one refused host keeps the mailbox blocked, with no audit row and no log line", async () => {
    await withRollback(db, async (trx) => {
      const box = await blockedBox(trx);
      answer((host) => (host === box.smtp ? "10.0.0.7" : PUBLIC));

      await run(trx);

      const row = await rowOf(trx, box.mailboxId);
      expect(row.status).toBe("host_blocked");
      expect(row.status_changed_at).toEqual(BLOCKED_AT);
      expect(await auditOf(trx, box.mailboxId)).toHaveLength(0);
      expect(lines.some((line) => line.includes(box.mailboxId))).toBe(false);
    });
  });

  test("4: a failed lookup keeps the mailbox blocked and writes one warning, without host names", async () => {
    await withRollback(db, async (trx) => {
      const box = await blockedBox(trx);
      answer(() => Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }));

      await run(trx);

      expect((await rowOf(trx, box.mailboxId)).status).toBe("host_blocked");
      expect(await auditOf(trx, box.mailboxId)).toHaveLength(0);
      const mine = lines.filter((line) => line.includes(box.mailboxId));
      expect(mine).toHaveLength(1);
      expect(mine[0]).toContain("mailbox_host_check_failed");
      expect(mine[0]).toContain("reason=lookup_failed");
      expect(mine[0]).not.toContain(box.imap);
    });
  });

  test("5: a suspended organization is never checked and never changed", async () => {
    await withRollback(db, async (trx) => {
      const box = await blockedBox(trx);
      await suspendOrg(trx, box.orgId);
      const { calls } = answer(() => PUBLIC);

      await run(trx);

      expect(calls.filter((host) => host === box.imap || host === box.smtp)).toEqual([]);
      const row = await rowOf(trx, box.mailboxId);
      expect(row.status).toBe("host_blocked");
      expect(row.status_changed_at).toEqual(BLOCKED_AT);
      expect(await auditOf(trx, box.mailboxId)).toHaveLength(0);
      expect(lines.some((line) => line.includes(box.mailboxId))).toBe(false);
    });
  });

  test("6: a mailbox that another writer paused during the lookup stays paused", async () => {
    await withRollback(db, async (trx) => {
      const box = await blockedBox(trx);
      let paused = false;
      const lookup: LookupAll = async () => {
        if (!paused) {
          paused = true;
          await trx.updateTable("mailboxes").set({ status: "paused" }).where("id", "=", box.mailboxId).execute();
        }
        return [{ address: PUBLIC, family: 4 }];
      };
      configureMailHosts({ allowLocal: false, lookup });

      await run(trx);

      expect(paused).toBe(true);
      expect((await rowOf(trx, box.mailboxId)).status).toBe("paused");
      expect(await auditOf(trx, box.mailboxId)).toHaveLength(0);
      expect(lines.some((line) => line.includes("mailbox_host_allowed") && line.includes(box.mailboxId))).toBe(false);
    });
  });

  test("7: a blocked mailbox of another organization is not changed by a pass of the first", async () => {
    await withRollback(db, async (trx) => {
      const a = await blockedBox(trx);
      const b = await blockedBox(trx, 60_000);
      answer((host) => (host === b.imap ? "10.0.0.7" : PUBLIC));

      await run(trx);

      expect((await rowOf(trx, a.mailboxId)).status).toBe("active");
      const rowB = await rowOf(trx, b.mailboxId);
      expect(rowB.status).toBe("host_blocked");
      expect(rowB.status_changed_at).toEqual(BLOCKED_AT);
      expect(await auditOf(trx, b.mailboxId)).toHaveLength(0);
    });
  });

  test("8: the status change is scoped to the organization of the context", async () => {
    await withRollback(db, async (trx) => {
      const a = await blockedBox(trx);
      const b = await blockedBox(trx);

      const wrongOrg = await changeMailboxStatus(trx, { orgId: b.orgId }, a.mailboxId, {
        from: "host_blocked",
        to: "active",
        at: NOW,
      });

      expect(wrongOrg).toBe(false);
      const row = await rowOf(trx, a.mailboxId);
      expect(row.status).toBe("host_blocked");
      expect(row.status_changed_at).toEqual(BLOCKED_AT);
    });
  });

  test("9: a failure on one mailbox does not stop the others", async () => {
    await withRollback(db, async (trx) => {
      const first = await blockedBox(trx);
      const second = await blockedBox(trx, 60_000);
      let atFirst = false;
      const lookup: LookupAll = async (host) => {
        if (host === first.imap) atFirst = true;
        return [{ address: PUBLIC, family: 4 }];
      };
      configureMailHosts({ allowLocal: false, lookup });

      // The status write that follows the lookup of the first mailbox fails; the second mailbox still reopens.
      const result = await run(
        failing(trx, "updateTable", () => {
          const now = atFirst;
          atFirst = false;
          return now;
        })
      );

      expect((await rowOf(trx, first.mailboxId)).status).toBe("host_blocked");
      expect((await rowOf(trx, second.mailboxId)).status).toBe("active");
      expect(await auditOf(trx, first.mailboxId)).toHaveLength(0);
      expect(await auditOf(trx, second.mailboxId)).toHaveLength(1);
      expect(result.reopened).toBeGreaterThanOrEqual(1);
      const failed = lines.filter(
        (line) => line.includes("mailbox_host_check_failed") && line.includes(first.mailboxId)
      );
      expect(failed).toHaveLength(1);
      expect(failed[0]).not.toContain("boom");
    });
  });

  test("10: a failure to list the targets is one error line, and the call returns", async () => {
    await withRollback(db, async (trx) => {
      answer(() => PUBLIC);

      let left = 1;
      const result = await run(failing(trx, "selectFrom", () => left-- > 0));

      expect(result).toEqual({ checked: 0, reopened: 0 });
      const failed = lines.filter((line) => line.includes("mailbox_host_recheck_failed"));
      expect(failed).toHaveLength(1);
      expect(failed[0]).not.toContain("boom");
    });
  });
});

describe("recheckBlockedHosts against a newer block", () => {
  test("11: a block that begins between the read and the write keeps its status and its episode", async () => {
    await withRollback(db, async (trx) => {
      const box = await blockedBox(trx);
      const newer = new Date(NOW.getTime() - 60_000);
      // The lookup runs after the read of the row. Here a new block of the same mailbox begins: same status, newer episode.
      configureMailHosts({
        allowLocal: false,
        lookup: async () => {
          await trx
            .updateTable("mailboxes")
            .set({ status_changed_at: newer })
            .where("id", "=", box.mailboxId)
            .execute();
          return [{ address: PUBLIC, family: 4 }];
        },
      });

      const result = await run(trx);

      expect(result.reopened).toBe(0);
      const row = await rowOf(trx, box.mailboxId);
      expect(row.status).toBe("host_blocked");
      expect(row.status_changed_at).toEqual(newer);
      expect(await auditOf(trx, box.mailboxId)).toHaveLength(0);
    });
  });
});

describe("changeMailboxStatus with seenChangedAt", () => {
  test("a stamp that now() wrote, with microseconds, still matches the millisecond Date the caller read", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);
      // No `at`: the stamp comes from now(). The update then gives it a fraction below a millisecond, whatever the clock said.
      await setMailboxStatus(trx, { orgId }, mailboxId, "host_blocked");
      await sql`UPDATE mailboxes SET status_changed_at = date_trunc('milliseconds', status_changed_at) + interval '123 microseconds' WHERE id = ${mailboxId}`.execute(
        trx
      );
      const seen = (await rowOf(trx, mailboxId)).status_changed_at;

      const changed = await changeMailboxStatus(trx, { orgId }, mailboxId, {
        from: "host_blocked",
        to: "active",
        at: NOW,
        seenChangedAt: seen,
      });

      expect(changed).toBe(true);
      expect(await rowOf(trx, mailboxId)).toMatchObject({ status: "active", status_changed_at: NOW });
    });
  });
});

async function blockAuditOf(trx: Transaction<DB>, mailboxId: string) {
  const rows = await trx
    .selectFrom("audit_log")
    .select(["actor", "data", "created_at"])
    .where("event", "=", "mailbox.host_blocked")
    .execute();
  return rows.filter((row) => (row.data as { mailbox_id?: string }).mailbox_id === mailboxId);
}

describe("markHostBlocked", () => {
  test("1: an active mailbox becomes host_blocked once, with one audit row; a second call changes nothing", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);

      expect(await markHostBlocked(trx, { orgId }, mailboxId, { now: NOW, source: "sync" })).toBe(true);
      const later = new Date(NOW.getTime() + 60_000);
      expect(await markHostBlocked(trx, { orgId }, mailboxId, { now: later, source: "committer" })).toBe(false);

      const row = await rowOf(trx, mailboxId);
      expect(row.status).toBe("host_blocked");
      expect(row.status_changed_at).toEqual(NOW);
      const audit = await blockAuditOf(trx, mailboxId);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actor: "system",
        data: { mailbox_id: mailboxId, source: "sync" },
        created_at: NOW,
      });
      expect(
        lines.filter((line) => line.includes("mailbox_host_blocked") && line.includes("reason=sync"))
      ).toHaveLength(1);
      expect(lines.filter((line) => line.includes("mailbox_host_refused"))).toHaveLength(1);
    });
  });

  test("2: a paused mailbox and an auth_error mailbox keep their status, their time and no audit row", async () => {
    await withRollback(db, async (trx) => {
      for (const status of ["paused", "auth_error"] as const) {
        const { orgId, mailboxId } = await createOrgWithMailbox(trx);
        await setMailboxStatus(trx, { orgId }, mailboxId, status, BLOCKED_AT);
        lines = [];

        expect(await markHostBlocked(trx, { orgId }, mailboxId, { now: NOW, source: "sync" })).toBe(false);

        const row = await rowOf(trx, mailboxId);
        expect(row.status).toBe(status);
        expect(row.status_changed_at).toEqual(BLOCKED_AT);
        expect(await blockAuditOf(trx, mailboxId)).toEqual([]);
        expect(lines.filter((line) => line.includes("mailbox_host_refused"))).toHaveLength(1);
      }
    });
  });

  test("3: the context of another organization changes nothing", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);

      expect(await markHostBlocked(trx, { orgId: b.orgId }, a.mailboxId, { now: NOW, source: "sync" })).toBe(false);

      expect((await rowOf(trx, a.mailboxId)).status).toBe("active");
      expect(await blockAuditOf(trx, a.mailboxId)).toEqual([]);
    });
  });

  test("4: a database failure is one error line, and the call returns false", async () => {
    const stub = {
      isTransaction: false,
      transaction: () => ({
        execute: () => Promise.reject(new Error("boom")),
      }),
    } as unknown as Db;

    expect(await markHostBlocked(stub, { orgId: randomUUID() }, randomUUID(), { now: NOW, source: "sync" })).toBe(
      false
    );

    const failed = lines.filter((line) => line.includes("mailbox_host_block_failed"));
    expect(failed).toHaveLength(1);
    expect(failed[0]).not.toContain("boom");
  });
});
