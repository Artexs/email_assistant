import { format } from "node:util";

import { HOUR_MS, MINUTE_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { detectNotices } from "../../src/modules/channels";
import type { AuthErrorReason } from "../../src/modules/mail";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { markSynced } from "../../src/modules/mail/repo";
import type { DB, Db } from "../../src/platform/db";

import { at, org, rows, run, setStatus, T } from "./channels-notices-helpers";
import { insertTriaged, isolateChannels } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

let errorLines: string[] = [];
let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  errorLines = [];
  logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
  errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errorLines.push(format(...args));
  });
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

describe("auth_error notices", () => {
  test("one row for the owner per episode; a new episode makes the old pending row outdated", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      const s = at(-20 * MINUTE_MS);
      await setStatus(trx, o, "auth_error", s);

      await run(trx);
      await run(trx);
      let found = await rows(trx, o.orgId, "auth_error");
      expect(found).toHaveLength(1);
      expect(found[0]?.user_id).toBe(o.ownerId);
      expect(found[0]?.dedup_key).toBe(`auth_error:${o.mailboxId}:${s.getTime()}`);
      expect(found[0]?.status).toBe("pending");

      const s2 = at(-2 * MINUTE_MS);
      await setStatus(trx, o, "active");
      await setStatus(trx, o, "auth_error", s2);
      await run(trx);
      found = await rows(trx, o.orgId, "auth_error");
      expect(found).toHaveLength(2);
      const first = found.find((r) => r.dedup_key === `auth_error:${o.mailboxId}:${s.getTime()}`);
      const second = found.find((r) => r.dedup_key === `auth_error:${o.mailboxId}:${s2.getTime()}`);
      expect(first?.status).toBe("failed");
      expect(first?.error_code).toBe("outdated");
      expect(second?.status).toBe("pending");
    });
  });

  test("a pending row becomes outdated when the mailbox is active again", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await setStatus(trx, o, "auth_error", at(-20 * MINUTE_MS));
      await run(trx);
      await setStatus(trx, o, "active");

      await run(trx);
      const found = await rows(trx, o.orgId, "auth_error");
      expect(found).toHaveLength(1);
      expect(found[0]?.status).toBe("failed");
      expect(found[0]?.error_code).toBe("outdated");
    });
  });
});

// An OAuth mailbox in `auth_error`: the provider and the reason go with the status (the table CHECK).
async function setOAuthError(
  trx: Transaction<DB>,
  mailboxId: string,
  provider: "microsoft" | "google",
  reason: AuthErrorReason | null,
  changedAt: Date
): Promise<void> {
  await trx
    .updateTable("mailboxes")
    .set({ oauth_provider: provider, status: "auth_error", auth_reason: reason, status_changed_at: changedAt })
    .where("id", "=", mailboxId)
    .execute();
}

describe("auth_error notices of an OAuth mailbox", () => {
  test("one row; the view holds the provider and the reason; the text names Reconnect, not mailbox:password", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await setOAuthError(trx, o.mailboxId, "google", "oauth_expired", at(-20 * MINUTE_MS));

      await run(trx);

      const found = await rows(trx, o.orgId, "auth_error");
      expect(found).toHaveLength(1);
      expect(found[0]?.view).toMatchObject({ oauth: { provider: "google", reason: "oauth_expired" } });
      expect(found[0]?.text).toContain("The sign-in to Google expired. Open the panel, Mailboxes, and tap Reconnect.");
      expect(found[0]?.text).not.toContain("mailbox:password");
    });
  });

  test("a password mailbox: the view has no oauth key and the text is today's", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await setStatus(trx, o, "auth_error", at(-20 * MINUTE_MS));

      await run(trx);

      const [row] = await rows(trx, o.orgId, "auth_error");
      expect(Object.keys(row?.view as object)).not.toContain("oauth");
      expect(row?.text).toContain(`run mailbox:password for mailbox ${o.mailboxId}`);
    });
  });

  test("a reason that changes after a Reconnect gives a new row and the old pending row becomes outdated", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      const s = at(-20 * MINUTE_MS);
      const s2 = at(-2 * MINUTE_MS);
      await setOAuthError(trx, o.mailboxId, "microsoft", "oauth_expired", s);
      await run(trx);
      // A Reconnect clears the reason with the status (the table CHECK).
      await trx
        .updateTable("mailboxes")
        .set({ status: "active", auth_reason: null })
        .where("id", "=", o.mailboxId)
        .execute();
      await setOAuthError(trx, o.mailboxId, "microsoft", "protocol_disabled", s2);
      await run(trx);

      const found = await rows(trx, o.orgId, "auth_error");
      expect(found).toHaveLength(2);
      const first = found.find((r) => r.dedup_key === `auth_error:${o.mailboxId}:${s.getTime()}`);
      const second = found.find((r) => r.dedup_key === `auth_error:${o.mailboxId}:${s2.getTime()}`);
      expect(first?.status).toBe("failed");
      expect(first?.error_code).toBe("outdated");
      expect(first?.view).toMatchObject({ oauth: { reason: "oauth_expired" } });
      expect(second?.status).toBe("pending");
      expect(second?.view).toMatchObject({ oauth: { provider: "microsoft", reason: "protocol_disabled" } });
      expect(second?.text).toContain("Your administrator turned off IMAP or SMTP");
    });
  });

  test("a second organization: each organization gets its own rows with its own provider and reason", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await org(trx);
      const b = await org(trx);
      await setOAuthError(trx, a.mailboxId, "google", "oauth_revoked", at(-20 * MINUTE_MS));
      await setOAuthError(trx, b.mailboxId, "microsoft", null, at(-20 * MINUTE_MS));

      await run(trx);

      const rowsA = await rows(trx, a.orgId, "auth_error");
      const rowsB = await rows(trx, b.orgId, "auth_error");
      expect(rowsA).toHaveLength(1);
      expect(rowsB).toHaveLength(1);
      expect(rowsA[0]?.view).toMatchObject({
        mailboxId: a.mailboxId,
        oauth: { provider: "google", reason: "oauth_revoked" },
      });
      expect(rowsB[0]?.view).toMatchObject({ mailboxId: b.mailboxId, oauth: { provider: "microsoft", reason: null } });
      expect(rowsA[0]?.text).toContain("Google");
      expect(rowsA[0]?.text).not.toContain("Microsoft");
      expect(rowsB[0]?.text).toContain("The sign-in to Microsoft fails.");
    });
  });
});

describe("host_blocked notices", () => {
  test("one row for the owner per episode; the view holds the address only; a new episode makes the old row outdated", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      const s = at(-20 * MINUTE_MS);
      await setStatus(trx, o, "host_blocked", s);

      await run(trx);
      await run(trx);
      let found = await rows(trx, o.orgId, "host_blocked");
      expect(found).toHaveLength(1);
      expect(found[0]?.user_id).toBe(o.ownerId);
      expect(found[0]?.dedup_key).toBe(`host_blocked:${o.mailboxId}:${s.getTime()}`);
      expect(found[0]?.mailbox_id).toBe(o.mailboxId);
      expect(found[0]?.status).toBe("pending");
      expect(found.some((r) => r.user_id === o.assistantId)).toBe(false);

      const address = (
        await trx.selectFrom("mailboxes").select("address").where("id", "=", o.mailboxId).executeTakeFirstOrThrow()
      ).address;
      expect(found[0]?.view).toEqual({
        address,
        since: s.toISOString(),
        now: T.toISOString(),
        timeZone: "Europe/Warsaw",
      });
      expect(found[0]?.text).toContain(address);
      expect(found[0]?.text).not.toContain("imap.x.test");
      expect(found[0]?.text).not.toContain("smtp.x.test");

      const s2 = at(-2 * MINUTE_MS);
      await setStatus(trx, o, "active");
      await setStatus(trx, o, "host_blocked", s2);
      await run(trx);
      found = await rows(trx, o.orgId, "host_blocked");
      expect(found).toHaveLength(2);
      const first = found.find((r) => r.dedup_key === `host_blocked:${o.mailboxId}:${s.getTime()}`);
      const second = found.find((r) => r.dedup_key === `host_blocked:${o.mailboxId}:${s2.getTime()}`);
      expect(first?.status).toBe("failed");
      expect(first?.error_code).toBe("outdated");
      expect(second?.status).toBe("pending");
    });
  });

  test("a pending row becomes outdated when the mailbox is active again", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await setStatus(trx, o, "host_blocked", at(-20 * MINUTE_MS));
      await run(trx);
      await setStatus(trx, o, "active");

      await run(trx);
      const found = await rows(trx, o.orgId, "host_blocked");
      expect(found).toHaveLength(1);
      expect(found[0]?.status).toBe("failed");
      expect(found[0]?.error_code).toBe("outdated");
    });
  });

  test("a paused mailbox and an auth_error mailbox give no host_blocked row", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await setStatus(trx, o, "paused", at(-20 * MINUTE_MS));
      await run(trx);
      expect(await rows(trx, o.orgId, "host_blocked")).toHaveLength(0);

      await setStatus(trx, o, "auth_error", at(-10 * MINUTE_MS));
      await run(trx);
      expect(await rows(trx, o.orgId, "host_blocked")).toHaveLength(0);
      expect(await rows(trx, o.orgId, "auth_error")).toHaveLength(1);
    });
  });

  test("(tenant) the rows of one organization name its own mailbox and owner only", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await org(trx);
      const b = await org(trx);
      const c = await org(trx);
      await setStatus(trx, a, "host_blocked", at(-20 * MINUTE_MS));
      // Organization C has a blocked mailbox too, but no linked chat: it gets no notice at all.
      await trx.deleteFrom("chat_links").where("org_id", "=", c.orgId).execute();
      await setStatus(trx, c, "host_blocked", at(-20 * MINUTE_MS));

      await run(trx);
      expect(await rows(trx, b.orgId, "host_blocked")).toHaveLength(0);
      expect(await rows(trx, c.orgId, "host_blocked")).toHaveLength(0);
      const found = await rows(trx, a.orgId, "host_blocked");
      expect(found).toHaveLength(1);
      expect(found[0]?.mailbox_id).toBe(a.mailboxId);
      expect(found[0]?.user_id).toBe(a.ownerId);
      const all = await trx
        .selectFrom("outbox")
        .select(["org_id", "mailbox_id"])
        .where("kind", "=", "host_blocked")
        .execute();
      expect(all).toEqual([{ org_id: a.orgId, mailbox_id: a.mailboxId }]);
    });
  });
});

describe("sync notices", () => {
  test("a late sync gives a notice only after the grace time since the start", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      const last = at(-40 * MINUTE_MS);
      await markSynced(trx, o.ctx, o.mailboxId, last);

      await run(trx, at(-5 * MINUTE_MS));
      expect(await rows(trx, o.orgId, "sync_stale")).toHaveLength(0);

      await run(trx, at(-15 * MINUTE_MS));
      await run(trx, at(-15 * MINUTE_MS));
      const found = await rows(trx, o.orgId, "sync_stale");
      expect(found).toHaveLength(1);
      expect(found[0]?.user_id).toBe(o.ownerId);
      expect(found[0]?.dedup_key).toBe(`sync_stale:${o.mailboxId}:${last.getTime()}`);
    });
  });

  test("a mailbox that never synced uses its creation time", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await trx
        .updateTable("mailboxes")
        .set({ last_synced_at: null, created_at: at(-2 * HOUR_MS) })
        .where("id", "=", o.mailboxId)
        .execute();

      await run(trx);
      const found = await rows(trx, o.orgId, "sync_stale");
      expect(found).toHaveLength(1);
      expect(found[0]?.dedup_key).toBe(`sync_stale:${o.mailboxId}:never`);
      expect(found[0]?.text).toContain("Last good sync: never.");
    });
  });

  test("a sent late notice gets one sync_ok when the sync is fresh; a pending one becomes outdated", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      const last = at(-40 * MINUTE_MS);
      await markSynced(trx, o.ctx, o.mailboxId, last);
      await run(trx);
      await trx
        .updateTable("outbox")
        .set({ status: "sent", sent_at: at(-10 * MINUTE_MS) })
        .where("org_id", "=", o.orgId)
        .where("kind", "=", "sync_stale")
        .execute();

      await markSynced(trx, o.ctx, o.mailboxId, at(-MINUTE_MS));
      await run(trx);
      await run(trx);
      const ok = await rows(trx, o.orgId, "sync_ok");
      expect(ok).toHaveLength(1);
      expect(ok[0]?.user_id).toBe(o.ownerId);
      expect(ok[0]?.dedup_key).toBe(`sync_ok:${o.mailboxId}:${last.getTime()}`);
    });

    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await markSynced(trx, o.ctx, o.mailboxId, at(-40 * MINUTE_MS));
      await run(trx);
      await markSynced(trx, o.ctx, o.mailboxId, at(-MINUTE_MS));
      await run(trx);
      const stale = await rows(trx, o.orgId, "sync_stale");
      expect(stale).toHaveLength(1);
      expect(stale[0]?.status).toBe("failed");
      expect(stale[0]?.error_code).toBe("outdated");
      expect(await rows(trx, o.orgId, "sync_ok")).toHaveLength(0);
    });
  });

  test("a mailbox that became active again gets no late notice and no sync_ok until a fresh sync", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await markSynced(trx, o.ctx, o.mailboxId, at(-2 * HOUR_MS));
      await setStatus(trx, o, "active", at(-MINUTE_MS));

      await run(trx);
      expect(await rows(trx, o.orgId, "sync_stale")).toHaveLength(0);
    });

    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await markSynced(trx, o.ctx, o.mailboxId, at(-2 * HOUR_MS));
      await run(trx);
      await trx
        .updateTable("outbox")
        .set({ status: "sent", sent_at: at(-10 * MINUTE_MS) })
        .where("org_id", "=", o.orgId)
        .where("kind", "=", "sync_stale")
        .execute();
      expect(await rows(trx, o.orgId, "sync_stale")).toHaveLength(1);

      await setStatus(trx, o, "active", at(-MINUTE_MS));
      await run(trx);
      expect(await rows(trx, o.orgId, "sync_ok")).toHaveLength(0);

      await markSynced(trx, o.ctx, o.mailboxId, T);
      await run(trx);
      expect(await rows(trx, o.orgId, "sync_ok")).toHaveLength(1);
    });
  });

  test("a paused or auth_error mailbox gets no late notice", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await markSynced(trx, o.ctx, o.mailboxId, at(-2 * HOUR_MS));
      await setStatus(trx, o, "paused");
      await run(trx);
      expect(await rows(trx, o.orgId, "sync_stale")).toHaveLength(0);

      await setStatus(trx, o, "auth_error");
      await run(trx);
      expect(await rows(trx, o.orgId, "sync_stale")).toHaveLength(0);
    });
  });
});

describe("organizations", () => {
  test("rows stay inside their organization", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await org(trx);
      const b = await org(trx);
      const emailB = await insertTriaged(trx, b.ctx, b.mailboxId, {
        category: "urgent",
        createdAt: at(-10 * MINUTE_MS),
      });

      await run(trx);
      const forB = await rows(trx, b.orgId, "urgent");
      expect(forB.map((r) => r.user_id).sort()).toEqual([b.ownerId, b.assistantId].sort());
      expect(forB.every((r) => r.email_id === emailB)).toBe(true);
      const forA = await rows(trx, a.orgId);
      expect(forA.some((r) => r.email_id === emailB)).toBe(false);
      expect(forA).toHaveLength(0);
    });
  });

  test("a view that does not render skips its event; the next organization still gets its rows", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await org(trx);
      const b = await org(trx);
      const skipped = await insertTriaged(trx, a.ctx, a.mailboxId, {
        category: "urgent",
        createdAt: at(-10 * MINUTE_MS),
      });
      await insertTriaged(trx, b.ctx, b.mailboxId, { category: "urgent", createdAt: at(-10 * MINUTE_MS) });
      await trx.updateTable("organizations").set({ timezone: "Mars/Base" }).where("id", "=", a.orgId).execute();

      await run(trx);
      expect(await rows(trx, b.orgId, "urgent")).toHaveLength(2);
      expect(await rows(trx, a.orgId)).toHaveLength(0);
      expect(errorLines.filter((line) => line.includes(`notice_skipped kind=urgent item_id=${skipped} `))).toHaveLength(
        1
      );
      expect(errorLines.filter((line) => line.includes("dropped_fields"))).toEqual([]);
      expect(errorLines.filter((line) => line.includes(b.orgId))).toHaveLength(0);
    });
  });

  test("an error of one organization is logged by id and the next organization still gets its rows", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await org(trx);
      const b = await org(trx);
      for (const o of [a, b]) {
        await insertTriaged(trx, o.ctx, o.mailboxId, { category: "urgent", createdAt: at(-10 * MINUTE_MS) });
      }
      // An infinite resume time is not a Date: the run of this organization throws before any detector queues a row.
      await trx
        .updateTable("organizations")
        .set({ resumed_at: sql`'infinity'::timestamptz` })
        .where("id", "=", a.orgId)
        .execute();

      await run(trx);
      expect(await rows(trx, b.orgId, "urgent")).toHaveLength(2);
      expect(await rows(trx, a.orgId)).toHaveLength(0);
      // One detector fails and logs by name and organization; the later detectors of the organization still run (a per-detector
      // catch): the organization no longer fails as a whole.
      expect(errorLines.length).toBeGreaterThan(0);
      for (const line of errorLines) {
        expect(line).toMatch(
          new RegExp(`^\\[channels\\] notice_detector_failed kind=[a-z-]+ org_id=${a.orgId} error=TypeError$`)
        );
      }
      expect(errorLines.some((line) => line.includes("notices_org_failed"))).toBe(false);
    });
  });
});

describe("a database error", () => {
  test("stops the tick, logs notices_failed with the error name and never the error text", async () => {
    const broken = {
      selectFrom: () => {
        throw new Error("123456:MARKER-DB-TOKEN");
      },
    } as unknown as Db;

    await detectNotices({ db: broken, now: () => T, startedAt: at(-HOUR_MS), testMail: NO_TEST_SENDERS });
    expect(errorLines).toEqual(["[channels] notices_failed error=Error"]);
  });
});
