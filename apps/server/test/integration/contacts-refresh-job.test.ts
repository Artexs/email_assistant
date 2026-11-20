import type { FeatureKey } from "@ea/core";
import { DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import {
  createContactsRefreshJob,
  profileLockKey,
  refreshMailboxProfiles,
  senderFlags,
  SENT_COVERAGE_FRESH_MS,
  sentCoverage,
  type ContactsRefreshJobDeps,
} from "../../src/modules/contacts";
import { insertSentSyncState } from "../../src/modules/mail/repo";
import { setOrgFeature, upsertOrgFeature } from "../../src/modules/tenancy";
import { captureLogs, eventLines, logProblems } from "../log-capture";

import { countRows, hashOf, KEY, mailsAt, newOrg, NO_TEST, NOW, type Org, type Trx } from "./contacts-fixtures";
import { pauseOtherMailboxes, seedSenderActivity, suspendOrg } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The job `contacts.refresh`, the flag rule `senderFlags` and `sentCoverage`. The clock is fixed and the key is a test key.
const db = testDb();
afterAll(async () => {
  await db.destroy();
});

const jobOf = (trx: Trx, extra: Partial<ContactsRefreshJobDeps> = {}) =>
  createContactsRefreshJob({ db: trx, credentialsKey: KEY, testMail: NO_TEST, now: () => NOW, ...extra });

// An organization that has one mail of `anna@acme.pl` in its mailbox. The other mailboxes of the database are paused first.
async function withMail(trx: Trx, opts: { flag?: boolean } = {}): Promise<Org> {
  const org = await newOrg(trx, opts);
  await seedSenderActivity(trx, org.ctx, org.mailboxId, { address: "anna@acme.pl", mails: mailsAt([1]) });
  return org;
}

const flagOn = (trx: Trx, org: Org, flag: FeatureKey, enabled = true) =>
  setOrgFeature(trx, org.ctx, { flag, enabled, actor: "cli", now: NOW });

describe("the job contacts.refresh: gates", () => {
  test("1 a flag that is off, a suspended organization and a paused mailbox get no row; the other organization does", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const off = await withMail(trx, { flag: false });
      const suspended = await withMail(trx);
      await suspendOrg(trx, suspended.ctx.orgId);
      const paused = await withMail(trx);
      await trx.updateTable("mailboxes").set({ status: "paused" }).where("id", "=", paused.mailboxId).execute();
      const on = await withMail(trx);

      expect(await jobOf(trx).run()).toEqual({
        mailboxes: 1,
        skipped: 1,
        written: 1,
        unchanged: 0,
        zeroed: 0,
        mailboxErrors: 0,
      });
      expect(await countRows(trx, on)).toBe(1);
      for (const org of [off, suspended, paused]) expect(await countRows(trx, org)).toBe(0);
    });
  });

  test("2 a repeat run writes nothing and counts the rows as unchanged", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      await withMail(trx);
      expect((await jobOf(trx).run()).written).toBe(1);
      expect(await jobOf(trx).run()).toEqual({
        mailboxes: 1,
        skipped: 0,
        written: 0,
        unchanged: 1,
        zeroed: 0,
        mailboxErrors: 0,
      });
    });
  });

  test("3 an organization that is suspended during the run is not read: the check is per mailbox", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const boxes = [await withMail(trx), await withMail(trx)];
      // The targets come in an order that the test does not fix: the pass that runs first suspends the other organization.
      const seen: string[] = [];
      const result = await jobOf(trx, {
        refresh: async (deps, ctx, mailboxId, options) => {
          seen.push(mailboxId);
          const other = boxes.find((box) => box.mailboxId !== mailboxId);
          if (seen.length === 1 && other !== undefined) await suspendOrg(trx, other.ctx.orgId);
          return refreshMailboxProfiles(deps, ctx, mailboxId, options);
        },
      }).run();
      expect(seen).toHaveLength(1);
      expect(result.mailboxes).toBe(1);
      const rows = await Promise.all(boxes.map((box) => countRows(trx, box)));
      expect(rows.sort()).toEqual([0, 1]);
      const ran = boxes.find((box) => box.mailboxId === seen[0]);
      expect(await countRows(trx, ran as Org)).toBe(1);
    });
  });

  test("4 a lock held by another connection: the mailbox is skipped, nothing is written; then the next run writes", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const org = await withMail(trx);
      const { promise: gate, resolve: release } = Promise.withResolvers<undefined>();
      const { promise: held, resolve: locked } = Promise.withResolvers<undefined>();
      const holder = db.transaction().execute(async (other) => {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${profileLockKey(org.mailboxId)}, 0))`.execute(other);
        locked(undefined);
        await gate;
      });
      await held;
      try {
        expect(await jobOf(trx).run()).toEqual({
          mailboxes: 0,
          skipped: 1,
          written: 0,
          unchanged: 0,
          zeroed: 0,
          mailboxErrors: 0,
        });
        expect(await countRows(trx, org)).toBe(0);
      } finally {
        release(undefined);
        await holder;
      }
      expect((await jobOf(trx).run()).written).toBe(1);
      expect(await countRows(trx, org)).toBe(1);
    });
  });
});

describe("the job contacts.refresh: errors and logs", () => {
  test("5 a failing mailbox logs one error line by code and the next mailbox still gets rows", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const bad = await withMail(trx);
      const good = await withMail(trx);
      const logs = captureLogs();
      try {
        const result = await jobOf(trx, {
          refresh: async (deps, ctx, mailboxId, options) => {
            if (mailboxId === bad.mailboxId)
              throw Object.assign(new Error("connection to anna@acme.pl lost"), { code: "ECONNRESET" });
            return refreshMailboxProfiles(deps, ctx, mailboxId, options);
          },
        }).run();
        expect(result).toMatchObject({ mailboxes: 1, written: 1, mailboxErrors: 1 });
      } finally {
        logs.stop();
      }
      expect(await countRows(trx, bad)).toBe(0);
      expect(await countRows(trx, good)).toBe(1);
      const failed = eventLines(logs.lines, "contacts_refresh_mailbox_failed");
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({
        level: "error",
        org_id: bad.ctx.orgId,
        mailbox_id: bad.mailboxId,
        error: "Error",
        error_code: "ECONNRESET",
      });
      // The message of the error holds an address: no line carries it.
      expect(logs.lines.join("\n")).not.toContain("anna@acme.pl");
      // No dropped field: the line did not try to carry the message.
      expect(logProblems(logs.lines, ["anna@acme.pl"])).toEqual([]);
    });
  });

  test("6 the done line carries ids and counts; no line holds an address, a hash, a subject or an @", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const org = await withMail(trx);
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "bob@secret-corp.example",
        mails: mailsAt([2, 3]),
        sent: [{ at: new Date(NOW.getTime() - DAY_MS), to: ["carl@other.example"] }],
      });
      await trx
        .updateTable("emails")
        .set({ subject: "Salary of the CEO" })
        .where("mailbox_id", "=", org.mailboxId)
        .execute();
      const planted = [
        "anna@acme.pl",
        "bob@secret-corp.example",
        "carl@other.example",
        "secret-corp",
        "Salary of the CEO",
        hashOf(org.ctx.orgId, "anna@acme.pl"),
        hashOf(org.ctx.orgId, "bob@secret-corp.example"),
        hashOf(org.ctx.orgId, "carl@other.example"),
        KEY,
      ];
      const logs = captureLogs();
      try {
        await jobOf(trx).run();
        // A repeat run: the line again, with no row written.
        await jobOf(trx).run();
      } finally {
        logs.stop();
      }
      const done = eventLines(logs.lines, "contacts_refresh_done");
      expect(done).toHaveLength(2);
      expect(done[0]).toMatchObject({
        level: "info",
        org_id: org.ctx.orgId,
        mailbox_id: org.mailboxId,
        count: 3,
        unchanged: 0,
        zeroed: 0,
      });
      expect(done[1]).toMatchObject({ count: 0, unchanged: 3, zeroed: 0 });
      expect(typeof done[0]?.duration_ms).toBe("number");
      expect(logProblems(logs.lines, planted)).toEqual([]);
      expect(logs.lines.filter((line) => line.includes("@"))).toEqual([]);
    });
  });
});

describe("senderFlags", () => {
  test("7 suggestions and contact wait count as off unless sender_context is on", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx, { flag: false });
      expect(await senderFlags(trx, org.ctx)).toEqual({ context: false, suggestions: false, contactWait: false });
      // The two flags alone do nothing.
      await flagOn(trx, org, "sender_suggestions");
      await flagOn(trx, org, "contact_wait");
      expect(await senderFlags(trx, org.ctx)).toEqual({ context: false, suggestions: false, contactWait: false });
      await flagOn(trx, org, "sender_context");
      expect(await senderFlags(trx, org.ctx)).toEqual({ context: true, suggestions: true, contactWait: true });
      // Each one apart.
      await flagOn(trx, org, "contact_wait", false);
      expect(await senderFlags(trx, org.ctx)).toEqual({ context: true, suggestions: true, contactWait: false });
      await flagOn(trx, org, "contact_wait");
      await flagOn(trx, org, "sender_suggestions", false);
      expect(await senderFlags(trx, org.ctx)).toEqual({ context: true, suggestions: false, contactWait: true });
    });
  });

  test("8 the three flags are off by default", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx, { flag: false });
      expect(await senderFlags(trx, org.ctx)).toEqual({ context: false, suggestions: false, contactWait: false });
      const other = await newOrg(trx);
      expect(await senderFlags(trx, other.ctx)).toEqual({ context: true, suggestions: false, contactWait: false });
    });
  });

  test("9 another organization's flags do not count", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      await flagOn(trx, a, "sender_suggestions");
      expect((await senderFlags(trx, a.ctx)).suggestions).toBe(true);
      expect((await senderFlags(trx, b.ctx)).suggestions).toBe(false);
    });
  });
});

describe("sentCoverage", () => {
  const T = new Date("2026-11-01T00:00:00Z");
  // The state of the Sent sync: the flag `sent_sync`, the mailbox switch and the first pass.
  async function sentOrg(
    trx: Trx,
    opts: {
      flag: boolean;
      switchOn: boolean | null;
      firstPass: Date | null;
      lastPass?: Date | null;
      error?: "no_folder" | "folder_missing" | "failed" | null;
    }
  ): Promise<Org> {
    const org = await newOrg(trx);
    await upsertOrgFeature(trx, org.ctx, { flag: "sent_sync", enabled: opts.flag, setBy: "test", setAt: T });
    if (opts.switchOn !== null) {
      await insertSentSyncState(trx, org.ctx, org.mailboxId, { enabled: opts.switchOn });
      await trx
        .updateTable("mailbox_sent_sync")
        .set({
          first_pass_at: opts.switchOn ? opts.firstPass : null,
          last_pass_at: opts.switchOn ? (opts.lastPass === undefined ? opts.firstPass : opts.lastPass) : null,
          last_error_code: opts.error ?? null,
        })
        .where("mailbox_id", "=", org.mailboxId)
        .execute();
    }
    return org;
  }

  test("10 true only with the flag on, the switch on and a first pass", async () => {
    await withRollback(db, async (trx) => {
      const all = await sentOrg(trx, { flag: true, switchOn: true, firstPass: T });
      expect(await sentCoverage(trx, all.ctx, all.mailboxId, T)).toBe(true);
      const flagOff = await sentOrg(trx, { flag: false, switchOn: true, firstPass: T });
      expect(await sentCoverage(trx, flagOff.ctx, flagOff.mailboxId, T)).toBe(false);
      const switchOff = await sentOrg(trx, { flag: true, switchOn: false, firstPass: T });
      expect(await sentCoverage(trx, switchOff.ctx, switchOff.mailboxId, T)).toBe(false);
      const noPass = await sentOrg(trx, { flag: true, switchOn: true, firstPass: null });
      expect(await sentCoverage(trx, noPass.ctx, noPass.mailboxId, T)).toBe(false);
      const noState = await sentOrg(trx, { flag: true, switchOn: null, firstPass: null });
      expect(await sentCoverage(trx, noState.ctx, noState.mailboxId, T)).toBe(false);
    });
  });

  test("11 a first pass of another mailbox does not count", async () => {
    await withRollback(db, async (trx) => {
      const covered = await sentOrg(trx, { flag: true, switchOn: true, firstPass: T });
      const other = await sentOrg(trx, { flag: true, switchOn: null, firstPass: null });
      expect(await sentCoverage(trx, other.ctx, covered.mailboxId, T)).toBe(false);
      expect(await sentCoverage(trx, covered.ctx, other.mailboxId, T)).toBe(false);
    });
  });

  test("12 a Sent pass that ended with an error code gives no coverage, even when it is fresh", async () => {
    await withRollback(db, async (trx) => {
      for (const error of ["folder_missing", "no_folder", "failed"] as const) {
        const org = await sentOrg(trx, { flag: true, switchOn: true, firstPass: T, error });
        // `folder_missing` still sets `last_pass_at`: the pass ran at T, so only the error code shows the gap.
        await trx
          .updateTable("mailbox_sent_sync")
          .set({ last_pass_at: T })
          .where("mailbox_id", "=", org.mailboxId)
          .execute();
        expect(await sentCoverage(trx, org.ctx, org.mailboxId, T)).toBe(false);
      }
    });
  });

  test("13 a last pass older than a day gives no coverage; one at the edge does", async () => {
    await withRollback(db, async (trx) => {
      const edge = await sentOrg(trx, {
        flag: true,
        switchOn: true,
        firstPass: T,
        lastPass: new Date(T.getTime() - SENT_COVERAGE_FRESH_MS),
      });
      expect(await sentCoverage(trx, edge.ctx, edge.mailboxId, T)).toBe(true);
      const stale = await sentOrg(trx, {
        flag: true,
        switchOn: true,
        firstPass: T,
        lastPass: new Date(T.getTime() - SENT_COVERAGE_FRESH_MS - 1),
      });
      expect(await sentCoverage(trx, stale.ctx, stale.mailboxId, T)).toBe(false);
      const never = await sentOrg(trx, { flag: true, switchOn: true, firstPass: T, lastPass: null });
      expect(await sentCoverage(trx, never.ctx, never.mailboxId, T)).toBe(false);
    });
  });
});
