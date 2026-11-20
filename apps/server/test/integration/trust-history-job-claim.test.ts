import { HOUR_MS, MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { MailAuthError, type MailProvider, type OAuthTokens } from "../../src/modules/mail";
import { protocolDisabled } from "../../src/modules/mail/oauth/login";
import { setMailboxStatus, updateCursor } from "../../src/modules/mail/repo";
import { setOrgFeature } from "../../src/modules/tenancy";
import { HISTORY_CURSOR_RETRIES, HISTORY_LOCK_STALE_MS, HISTORY_RETRY_MS } from "../../src/modules/trust";
import { SoftError } from "../../src/platform/errors";

import { suspendOrg } from "./fixtures";
import { testDb } from "./helpers";
import {
  advance,
  checkRows,
  HISTORY_UID_VALIDITY,
  jobOf,
  historyJobKit,
  theCheck,
  withHistoryBox,
} from "./trust-history-helpers";

// The history check job: claim, backfill, flags wait. Committed rows, a fixed clock and the in-memory mail server;
// the model is never called (the job has no client). The two-connection rules are in trust-history-job-race.test.ts.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const THIRD_ATTEMPT = 3;

const { queue, emailsOf } = historyJobKit(db);

describe("step 1: the job and its claim", () => {
  test("3. three step errors end the check as no_result / stopped; each error waits 5 minutes", async () => {
    await withHistoryBox(db, {}, async (box) => {
      await queue(box);
      const failing = jobOf(db, box, {
        openProvider: async () => {
          box.opens.count += 1;
          throw new SoftError("connection lost");
        },
      });
      for (const attempts of [1, 2]) {
        await failing.run();
        const row = await theCheck(db, box);
        expect(row.attempts).toBe(attempts);
        expect(row.status).toBe("backfilling");
        expect(row.locked_at).toBeNull();
        expect(row.next_attempt_at.getTime()).toBe(box.clock.now.getTime() + HISTORY_RETRY_MS);
        // Not due yet: this run does nothing.
        await failing.run();
        expect((await theCheck(db, box)).attempts).toBe(attempts);
        advance(box, HISTORY_RETRY_MS);
      }
      await failing.run();
      const row = await theCheck(db, box);
      expect(row.attempts).toBe(THIRD_ATTEMPT);
      expect(row.status).toBe("no_result");
      expect(row.no_result_reason).toBe("stopped");
      expect(row.finished_at?.getTime()).toBe(box.clock.now.getTime());
      expect(row.locked_at).toBeNull();
      expect(box.opens.count).toBe(THIRD_ATTEMPT);
    });
  });

  test("2. a check locked 11 minutes ago is taken again and counts one attempt; a lock of 9 minutes is left alone", async () => {
    await withHistoryBox(db, {}, async (box) => {
      const id = await queue(box);
      const lockedAt = (minutes: number) => new Date(box.clock.now.getTime() - minutes * MINUTE_MS);
      await db
        .updateTable("history_checks")
        .set({ locked_at: lockedAt(9) })
        .where("id", "=", id)
        .execute();
      await jobOf(db, box).run();
      expect(box.opens.count).toBe(0);
      expect((await theCheck(db, box)).attempts).toBe(0);

      await db
        .updateTable("history_checks")
        .set({ locked_at: lockedAt(11) })
        .where("id", "=", id)
        .execute();
      expect(HISTORY_LOCK_STALE_MS).toBe(10 * MINUTE_MS);
      await jobOf(db, box).run();
      const row = await theCheck(db, box);
      expect(row.attempts).toBe(1);
      expect(row.status).toBe("waiting_flags");
      expect(row.locked_at).toBeNull();
    });
  });

  test("a take-back that is the third attempt ends the check at once, with no mail read", async () => {
    await withHistoryBox(db, {}, async (box) => {
      const id = await queue(box);
      await db
        .updateTable("history_checks")
        .set({ attempts: 2, locked_at: new Date(box.clock.now.getTime() - 11 * MINUTE_MS), status: "backfilling" })
        .where("id", "=", id)
        .execute();
      await jobOf(db, box).run();
      const row = await theCheck(db, box);
      expect(row).toMatchObject({ status: "no_result", no_result_reason: "stopped", attempts: THIRD_ATTEMPT });
      expect(row.finished_at).not.toBeNull();
      expect(box.opens.count).toBe(0);
    });
  });

  test("4. the flag turned on for an org with one active mailbox and no check: one queued check (flag_on), no second", async () => {
    // A never synced mailbox: the check is queued and stays in the backfill step, so the row can be read.
    await withHistoryBox(db, { synced: false, flag: false }, async (box) => {
      const job = jobOf(db, box);
      await job.run();
      expect(await checkRows(db, box)).toEqual([]);

      await setOrgFeature(db, box, { flag: "trust_ladder", enabled: true, actor: box.userId, now: box.clock.now });
      await job.run();
      const rows = await checkRows(db, box);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ reason: "flag_on", status: "backfilling" });
      await job.run();
      advance(box, HISTORY_RETRY_MS);
      await job.run();
      expect(await checkRows(db, box)).toHaveLength(1);

      // A mailbox that had a check once gets no new one when the check ended.
      await db
        .updateTable("history_checks")
        .set({ status: "no_result", no_result_reason: "no_history", finished_at: box.clock.now })
        .where("mailbox_id", "=", box.mailboxId)
        .execute();
      await job.run();
      expect(await checkRows(db, box)).toHaveLength(1);
    });
  });

  test("4. no flag_on check for a suspended org or a paused mailbox", async () => {
    await withHistoryBox(db, { synced: false }, async (box) => {
      await db.transaction().execute((trx) => suspendOrg(trx, box.orgId));
      await jobOf(db, box).run();
      expect(await checkRows(db, box)).toEqual([]);
      await db.updateTable("organizations").set({ plan: "active" }).where("id", "=", box.orgId).execute();
      await setMailboxStatus(db, box, box.mailboxId, "paused");
      await jobOf(db, box).run();
      expect(await checkRows(db, box)).toEqual([]);
    });
  });

  test("4a. a refused login ends the check as no_result / auth_refused: one login, no retry", async () => {
    await withHistoryBox(db, {}, async (box) => {
      await queue(box);
      const job = jobOf(db, box, {
        openProvider: async () => {
          box.opens.count += 1;
          throw new MailAuthError("refused");
        },
      });
      await job.run();
      const row = await theCheck(db, box);
      expect(row).toMatchObject({ status: "no_result", no_result_reason: "auth_refused", attempts: 0 });
      expect(row.finished_at).not.toBeNull();
      advance(box, HOUR_MS);
      await job.run();
      expect(box.opens.count).toBe(1);
    });
  });

  test("an operator check (cli) runs with the flag off; every other reason waits for the flag", async () => {
    await withHistoryBox(db, { flag: false }, async (box) => {
      await queue(box, "connect");
      await jobOf(db, box).run();
      expect(box.opens.count).toBe(0);
      const row = await theCheck(db, box);
      expect(row).toMatchObject({ status: "queued", attempts: 0 });
      expect(row.next_attempt_at.getTime()).toBe(box.clock.now.getTime() + HISTORY_RETRY_MS);
    });
    await withHistoryBox(db, { flag: false }, async (box) => {
      await queue(box, "cli");
      await jobOf(db, box).run();
      expect((await theCheck(db, box)).status).toBe("waiting_flags");
    });
  });

  test("a suspended org waits with no attempt and no read; it goes on after the resume", async () => {
    await withHistoryBox(db, {}, async (box) => {
      await queue(box);
      await db.transaction().execute((trx) => suspendOrg(trx, box.orgId));
      await jobOf(db, box).run();
      expect(box.opens.count).toBe(0);
      expect(await theCheck(db, box)).toMatchObject({ status: "queued", attempts: 0 });
      await db.updateTable("organizations").set({ plan: "active" }).where("id", "=", box.orgId).execute();
      advance(box, HISTORY_RETRY_MS);
      await jobOf(db, box).run();
      expect((await theCheck(db, box)).status).toBe("waiting_flags");
    });
  });
});

describe("carry-over: the state of the mailbox", () => {
  test("a paused or host_blocked mailbox waits with no read and no attempt; an auth_error mailbox ends as auth_refused", async () => {
    await withHistoryBox(db, {}, async (box) => {
      await queue(box);
      for (const status of ["paused", "host_blocked"] as const) {
        await setMailboxStatus(db, box, box.mailboxId, status);
        await jobOf(db, box).run();
        expect(box.opens.count).toBe(0);
        expect(await theCheck(db, box)).toMatchObject({ status: "queued", attempts: 0 });
        advance(box, HISTORY_RETRY_MS);
      }
      await setMailboxStatus(db, box, box.mailboxId, "active");
      await jobOf(db, box).run();
      expect((await theCheck(db, box)).status).toBe("waiting_flags");
    });
    await withHistoryBox(db, {}, async (box) => {
      await queue(box);
      await setMailboxStatus(db, box, box.mailboxId, "auth_error");
      await jobOf(db, box).run();
      expect(box.opens.count).toBe(0);
      expect(await theCheck(db, box)).toMatchObject({ status: "no_result", no_result_reason: "auth_refused" });
    });
  });

  test("an OAuth mailbox opens with its access token for the backfill and for the flag refresh", async () => {
    await withHistoryBox(db, { kind: "oauth" }, async (box) => {
      await queue(box);
      const seen: string[] = [];
      const tokens: OAuthTokens = {
        accessToken: async () => "the-access-token",
        drop: () => undefined,
      };
      await jobOf(db, box, {
        oauthTokens: tokens,
        openProvider: async (opts) => {
          seen.push(opts.auth.kind === "oauth" ? `oauth:${opts.auth.accessToken}` : "password");
          return box.fake;
        },
      }).run();
      expect(seen).toEqual(["oauth:the-access-token", "oauth:the-access-token"]);
      expect((await theCheck(db, box)).status).toBe("waiting_flags");
    });
  });

  test("an OAuth mailbox with no token store is an error that counts one attempt", async () => {
    await withHistoryBox(db, { kind: "oauth" }, async (box) => {
      await queue(box);
      await jobOf(db, box).run();
      expect(await theCheck(db, box)).toMatchObject({ status: "backfilling", attempts: 1 });
    });
  });

  test("OAuth refused twice (protocol disabled) in the backfill or in the refresh ends the check as auth_refused", async () => {
    await withHistoryBox(db, { kind: "oauth" }, async (box) => {
      await queue(box);
      const tokens: OAuthTokens = { accessToken: async () => "t", drop: () => undefined };
      await jobOf(db, box, {
        oauthTokens: tokens,
        openProvider: async () => {
          throw protocolDisabled();
        },
      }).run();
      expect(await theCheck(db, box)).toMatchObject({ status: "no_result", no_result_reason: "auth_refused" });
    });
    await withHistoryBox(db, { kind: "oauth" }, async (box) => {
      await queue(box);
      const tokens: OAuthTokens = { accessToken: async () => "t", drop: () => undefined };
      let opened = 0;
      await jobOf(db, box, {
        oauthTokens: tokens,
        openProvider: async () => {
          opened += 1;
          // The backfill login passes; the refresh login is refused.
          if (opened === 2) throw protocolDisabled();
          return box.fake;
        },
      }).run();
      expect(await theCheck(db, box)).toMatchObject({ status: "no_result", no_result_reason: "auth_refused" });
    });
  });

  test("a moved cursor is a retry that costs no attempt, however often it happens", async () => {
    await withHistoryBox(db, {}, async (box) => {
      await queue(box);
      // Each of the first three runs: a regular sync moves the cursor of the mailbox between the plan and the apply of the chunk.
      let moves = 0;
      let armed = true;
      let lastUid = 5;
      const mover = Object.create(box.fake) as MailProvider;
      mover.fetchContent = async (folder, uid) => {
        const content = await box.fake.fetchContent(folder, uid);
        if (armed) {
          armed = false;
          moves += 1;
          await updateCursor(
            db,
            box,
            box.mailboxId,
            { uidValidity: HISTORY_UID_VALIDITY, lastUid },
            { uidValidity: HISTORY_UID_VALIDITY, lastUid: lastUid + 1 }
          );
          lastUid += 1;
        }
        return content;
      };
      const job = jobOf(db, box, { openProvider: async () => mover });
      for (let run = 1; run <= THIRD_ATTEMPT; run += 1) {
        armed = true;
        await job.run();
        const row = await theCheck(db, box);
        expect(row).toMatchObject({ status: "backfilling", attempts: 0 });
        expect(row.locked_at).toBeNull();
        expect(row.next_attempt_at.getTime()).toBeGreaterThan(box.clock.now.getTime());
        expect(await emailsOf(box)).toEqual([]);
        advance(box, 2 * MINUTE_MS);
      }
      expect(moves).toBe(THIRD_ATTEMPT);
      await job.run();
      expect(await theCheck(db, box)).toMatchObject({ status: "waiting_flags", attempts: 0 });
      expect(await emailsOf(box)).toHaveLength(5);
    });
  });

  test("N2. the 20th moved-cursor retry counts one attempt; the 19 before it do not", async () => {
    await withHistoryBox(db, {}, async (box) => {
      await queue(box);
      let armed = true;
      let lastUid = 5;
      const mover = Object.create(box.fake) as MailProvider;
      mover.fetchContent = async (folder, uid) => {
        const content = await box.fake.fetchContent(folder, uid);
        if (armed) {
          armed = false;
          await updateCursor(
            db,
            box,
            box.mailboxId,
            { uidValidity: HISTORY_UID_VALIDITY, lastUid },
            { uidValidity: HISTORY_UID_VALIDITY, lastUid: lastUid + 1 }
          );
          lastUid += 1;
        }
        return content;
      };
      const job = jobOf(db, box, { openProvider: async () => mover });
      for (let run = 1; run < HISTORY_CURSOR_RETRIES; run += 1) {
        armed = true;
        await job.run();
        expect((await theCheck(db, box)).attempts).toBe(0);
        advance(box, 2 * MINUTE_MS);
      }
      armed = true;
      await job.run();
      const row = await theCheck(db, box);
      expect(row).toMatchObject({ status: "backfilling", attempts: 1 });
      expect(row.next_attempt_at.getTime()).toBe(box.clock.now.getTime() + HISTORY_RETRY_MS);
    });
  });
});
