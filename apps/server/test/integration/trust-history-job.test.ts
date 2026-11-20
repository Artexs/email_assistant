import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { HOUR_MS, DAY_MS, MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import {
  MailAuthError,
  refreshFlags,
  refreshFlagsOfMailbox,
  type MailProvider,
  type OAuthTokens,
} from "../../src/modules/mail";
import { protocolDisabled } from "../../src/modules/mail/oauth/login";
import { setMailboxStatus, updateCursor } from "../../src/modules/mail/repo";
import { setOrgFeature } from "../../src/modules/tenancy";
import {
  HISTORY_CURSOR_RETRIES,
  HISTORY_FLAGS_WAIT_MS,
  HISTORY_LOCK_STALE_MS,
  HISTORY_RETRY_MS,
  HISTORY_WINDOW_DAYS,
  queueHistoryCheck,
} from "../../src/modules/trust";
import { SoftError } from "../../src/platform/errors";

import { insertTestEmail, suspendOrg } from "./fixtures";
import { testDb } from "./helpers";
import { addMailbox } from "./trust-fixtures";
import {
  advance,
  checkRows,
  HISTORY_UID_VALIDITY,
  jobOf,
  historySecrets,
  RUNNING_KEY,
  seedMail,
  theCheck,
  withHistoryBox,
  type HistoryBox,
} from "./trust-history-helpers";

// The history check job: claim, backfill, flags wait. Committed rows, a fixed clock and the in-memory mail server;
// the model is never called (the job has no client). The two-connection rules are in trust-history-job-race.test.ts.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const THIRD_ATTEMPT = 3;

async function queue(box: HistoryBox, reason: "connect" | "cli" | "flag_on" = "connect"): Promise<string> {
  const id = await queueHistoryCheck(db, box, box.mailboxId, reason);
  if (id === null) throw new Error("check not queued");
  return id;
}

const emailsOf = (box: HistoryBox) =>
  db
    .selectFrom("emails")
    .select(["id", "status", "skip_reason", "backfilled_at"])
    .where("mailbox_id", "=", box.mailboxId)
    .execute();

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

describe("step 2: the backfill step", () => {
  test("5. an INBOX with 5 mails: waiting_flags, 5 history rows, the key, the window and the time set; no triage row", async () => {
    await withHistoryBox(db, {}, async (box) => {
      const id = await queue(box);
      await jobOf(db, box).run();
      const row = await theCheck(db, box);
      expect(row.status).toBe("waiting_flags");
      expect(row.key as unknown).toEqual(RUNNING_KEY);
      expect(row.window_start?.getTime()).toBe(box.clock.now.getTime() - HISTORY_WINDOW_DAYS * DAY_MS);
      expect(row.backfill_done_at?.getTime()).toBe(box.clock.now.getTime());
      expect(row.locked_at).toBeNull();
      expect(row.attempts).toBe(0);
      const mails = await emailsOf(box);
      expect(mails).toHaveLength(5);
      for (const mail of mails) {
        expect(mail.status).toBe("skipped");
        expect(mail.skip_reason).toBe("history_check");
        expect(mail.backfilled_at).not.toBeNull();
      }
      // History mail goes to history_check_items (the classify stage), never to triage_results.
      const triage = await db
        .selectFrom("triage_results")
        .innerJoin("emails", "emails.id", "triage_results.email_id")
        .select("triage_results.email_id")
        .where("emails.mailbox_id", "=", box.mailboxId)
        .execute();
      expect(triage).toEqual([]);
      const items = await db.selectFrom("history_check_items").select("email_id").where("check_id", "=", id).execute();
      expect(items).toEqual([]);
    });
  });

  test("6. a crash between the backfill and the status write: the next run ends in waiting_flags with no second mail", async () => {
    await withHistoryBox(db, {}, async (box) => {
      await queue(box);
      const hooks: { afterBackfill: () => void } = {
        afterBackfill: () => {
          throw new Error("crash");
        },
      };
      const job = jobOf(db, box, { hooks });
      await job.run();
      const crashed = await theCheck(db, box);
      expect(crashed).toMatchObject({ status: "backfilling", attempts: 1 });
      expect(crashed.backfill_done_at).toBeNull();
      // The window is written with the end of the backfill: a crashed read leaves none.
      expect(crashed.window_start).toBeNull();
      expect(await emailsOf(box)).toHaveLength(5);

      hooks.afterBackfill = () => undefined;
      advance(box, HISTORY_RETRY_MS);
      await job.run();
      const row = await theCheck(db, box);
      expect(row.status).toBe("waiting_flags");
      // The window of the repeat is the window of its own read.
      expect(row.window_start?.getTime()).toBe(box.clock.now.getTime() - HISTORY_WINDOW_DAYS * DAY_MS);
      expect(await emailsOf(box)).toHaveLength(5);
      const headers = await db
        .selectFrom("email_headers")
        .innerJoin("emails", "emails.id", "email_headers.email_id")
        .select("email_headers.email_id")
        .where("emails.mailbox_id", "=", box.mailboxId)
        .execute();
      expect(headers.length).toBeLessThanOrEqual(5);
    });
  });

  test("N1. a check that waited 10 days (paused mailbox) has the window of its read: 30 days back from the read, not from the first claim", async () => {
    await withHistoryBox(db, {}, async (box) => {
      // A mail that is 25 days old now is 35 days old when the mailbox resumes: outside the window of the read.
      const oldUid = box.fake.deliver("INBOX", seedMail(6, box.clock.now), {
        internalDate: new Date(box.clock.now.getTime() - 25 * DAY_MS),
      });
      await updateCursor(
        db,
        box,
        box.mailboxId,
        { uidValidity: HISTORY_UID_VALIDITY, lastUid: 5 },
        { uidValidity: HISTORY_UID_VALIDITY, lastUid: oldUid }
      );
      await queue(box);
      await setMailboxStatus(db, box, box.mailboxId, "paused");
      const job = jobOf(db, box);
      await job.run();
      const waiting = await theCheck(db, box);
      expect(waiting).toMatchObject({ status: "queued", attempts: 0 });
      expect(waiting.window_start).toBeNull();

      advance(box, 10 * DAY_MS);
      await setMailboxStatus(db, box, box.mailboxId, "active");
      await job.run();
      const row = await theCheck(db, box);
      expect(row.status).toBe("waiting_flags");
      expect(row.window_start?.getTime()).toBe(box.clock.now.getTime() - HISTORY_WINDOW_DAYS * DAY_MS);
      // The backfill and the window agree: the mail that is 35 days old is in neither.
      const uids = (await emailsOf(box)).length;
      expect(uids).toBe(5);
      const stored = await db
        .selectFrom("emails")
        .select("uid")
        .where("mailbox_id", "=", box.mailboxId)
        .where("uid", "=", String(oldUid))
        .execute();
      expect(stored).toEqual([]);
    });
  });

  test("N1. a mailbox that never synced has no window until the backfill reads it", async () => {
    await withHistoryBox(db, { synced: false }, async (box) => {
      await queue(box);
      await jobOf(db, box).run();
      expect((await theCheck(db, box)).window_start).toBeNull();
    });
  });

  test("7. an empty INBOX ends as no_result / no_history", async () => {
    await withHistoryBox(db, { mails: 0 }, async (box) => {
      await queue(box);
      await jobOf(db, box).run();
      const row = await theCheck(db, box);
      expect(row).toMatchObject({ status: "no_result", no_result_reason: "no_history" });
      expect(row.finished_at).not.toBeNull();
    });
  });

  test("a mailbox that never synced waits 5 minutes with no attempt and no login", async () => {
    await withHistoryBox(db, { synced: false }, async (box) => {
      await queue(box);
      await jobOf(db, box).run();
      expect(box.opens.count).toBe(0);
      const row = await theCheck(db, box);
      expect(row).toMatchObject({ status: "backfilling", attempts: 0 });
      expect(row.next_attempt_at.getTime()).toBe(box.clock.now.getTime() + HISTORY_RETRY_MS);
    });
  });

  test("a UIDVALIDITY change ends as no_result / uidvalidity", async () => {
    await withHistoryBox(db, {}, async (box) => {
      await queue(box);
      box.fake.resetUidValidity(HISTORY_UID_VALIDITY + 1);
      await jobOf(db, box).run();
      expect(await theCheck(db, box)).toMatchObject({
        status: "no_result",
        no_result_reason: "uidvalidity",
        attempts: 0,
      });
    });
  });
});

describe("step 3: the flags wait", () => {
  test("8. the flags of the history mail are read by the backfill step's own refresh; the next run passes to classifying", async () => {
    await withHistoryBox(db, {}, async (box) => {
      await queue(box);
      box.fake.setFlags("INBOX", 1, { add: ["\\Answered"] });
      box.fake.setFlags("INBOX", 2, { add: ["\\Flagged"] });
      const job = jobOf(db, box);
      await job.run();
      expect((await theCheck(db, box)).status).toBe("waiting_flags");
      // `refreshFlags` covers `skipped` mail.
      const flags = await db
        .selectFrom("email_flags")
        .innerJoin("emails", "emails.id", "email_flags.email_id")
        .select(["emails.uid", "email_flags.answered", "email_flags.flagged"])
        .where("emails.mailbox_id", "=", box.mailboxId)
        .orderBy("emails.uid")
        .execute();
      expect(flags).toHaveLength(5);
      expect(flags.filter((f) => f.answered).map((f) => Number(f.uid))).toEqual([1]);
      expect(flags.filter((f) => f.flagged).map((f) => Number(f.uid))).toEqual([2]);

      await job.run();
      const row = await theCheck(db, box);
      expect(row.status).toBe("classifying");
      expect(row.locked_at).toBeNull();
      expect(row.attempts).toBe(0);
    });
  });

  test("9. a refresh that fails: waiting at 19 minutes, classifying at 21 minutes", async () => {
    await withHistoryBox(db, {}, async (box) => {
      await queue(box);
      box.fake.failOn("fetchFlagsIn", new SoftError("flags lost"));
      const job = jobOf(db, box);
      await job.run();
      const waiting = await theCheck(db, box);
      // The failed refresh is not a failed step.
      expect(waiting).toMatchObject({ status: "waiting_flags", attempts: 0 });
      const doneAt = waiting.backfill_done_at?.getTime() ?? 0;
      expect(doneAt).toBe(box.clock.now.getTime());

      // The waiting step does not read flags itself: every poll (1 minute) finds the mail without a fresh row.
      for (let minute = 1; minute <= 19; minute += 1) {
        box.clock.now = new Date(doneAt + minute * MINUTE_MS);
        await job.run();
        expect((await theCheck(db, box)).status).toBe("waiting_flags");
      }
      expect((await theCheck(db, box)).attempts).toBe(0);

      box.clock.now = new Date(doneAt + HISTORY_FLAGS_WAIT_MS + MINUTE_MS);
      await job.run();
      expect((await theCheck(db, box)).status).toBe("classifying");
    });
  });

  test("a flag row older than the backfill keeps the check waiting until a read is newer; mail outside the window or INBOX does not count", async () => {
    await withHistoryBox(db, {}, async (box) => {
      await queue(box);
      box.fake.failOn("fetchFlagsIn", new SoftError("flags lost"));
      const job = jobOf(db, box);
      await job.run();
      const doneAt = box.clock.now;
      // Two mails that the check does not judge: older than the window, and in another folder. Neither has a flag row.
      await db.transaction().execute(async (trx) => {
        await insertTestEmail(trx, box, box.mailboxId, {
          folder: "INBOX",
          uid: 901,
          received_at: new Date(doneAt.getTime() - 40 * DAY_MS),
        });
        await insertTestEmail(trx, box, box.mailboxId, { folder: "Archive", uid: 902, received_at: doneAt });
      });
      const mails = await db
        .selectFrom("emails")
        .select(["id", "uid"])
        .where("mailbox_id", "=", box.mailboxId)
        .where("uid", "<", "900")
        .execute();
      expect(mails).toHaveLength(5);
      const flagRow = (emailId: string, checkedAt: Date) =>
        db
          .insertInto("email_flags")
          .values({
            email_id: emailId,
            org_id: box.orgId,
            seen: false,
            answered: false,
            flagged: false,
            checked_at: checkedAt,
          })
          .execute();
      // Every mail of the window has a row, but from before the backfill: the flags are not known yet.
      for (const mail of mails) await flagRow(mail.id, new Date(doneAt.getTime() - DAY_MS));
      advance(box, 2 * MINUTE_MS);
      await job.run();
      expect((await theCheck(db, box)).status).toBe("waiting_flags");
      // The sync job reads the flags a minute after the backfill: every row is newer, the wait ends.
      await db
        .updateTable("email_flags")
        .set({ checked_at: new Date(doneAt.getTime() + MINUTE_MS) })
        .where(
          "email_id",
          "in",
          mails.map((mail) => mail.id)
        )
        .execute();
      advance(box, MINUTE_MS);
      await job.run();
      expect((await theCheck(db, box)).status).toBe("classifying");
    });
  });

  test("N5. live mail that arrives after the backfill does not hold the flags wait", async () => {
    await withHistoryBox(db, {}, async (box) => {
      await queue(box);
      const job = jobOf(db, box);
      await job.run();
      const doneAt = (await theCheck(db, box)).backfill_done_at;
      expect(doneAt).not.toBeNull();
      // A new INBOX mail after the backfill: the sync stores it and refreshes its flags later, within 10 minutes.
      await db.transaction().execute(async (trx) => {
        await insertTestEmail(trx, box, box.mailboxId, {
          folder: "INBOX",
          uid: 910,
          received_at: new Date(box.clock.now.getTime() + MINUTE_MS),
        });
      });
      advance(box, 2 * MINUTE_MS);
      await job.run();
      expect((await theCheck(db, box)).status).toBe("classifying");
    });
  });

  test("TG2. the INBOX mail of another mailbox of the organization does not hold the flags wait", async () => {
    await withHistoryBox(db, {}, async (box) => {
      await queue(box);
      const job = jobOf(db, box);
      await job.run();
      const second = await db.transaction().execute((trx) => addMailbox(trx, box));
      // Paused: the flag_on queue makes no check for it, so the organization has the one check of the first mailbox.
      await setMailboxStatus(db, box, second, "paused");
      await db.transaction().execute(async (trx) => {
        await insertTestEmail(trx, box, second, {
          folder: "INBOX",
          uid: 920,
          received_at: new Date(box.clock.now.getTime() - DAY_MS),
        });
      });
      advance(box, MINUTE_MS);
      await job.run();
      expect((await theCheck(db, box)).status).toBe("classifying");
    });
  });

  test("a suspended org waits in the flags step too: no step before the resume", async () => {
    await withHistoryBox(db, {}, async (box) => {
      await queue(box);
      await jobOf(db, box).run();
      expect((await theCheck(db, box)).status).toBe("waiting_flags");
      await db.transaction().execute((trx) => suspendOrg(trx, box.orgId));
      await jobOf(db, box).run();
      expect((await theCheck(db, box)).status).toBe("waiting_flags");
      await db.updateTable("organizations").set({ plan: "active" }).where("id", "=", box.orgId).execute();
      advance(box, HISTORY_RETRY_MS);
      await jobOf(db, box).run();
      expect((await theCheck(db, box)).status).toBe("classifying");
    });
  });
});

describe("TG4. refreshFlagsOfMailbox closes its connection", () => {
  const depsOf = (box: HistoryBox) => ({
    db,
    secrets: historySecrets,
    isOwnActionId: async () => false,
    openProvider: async () => box.fake,
  });

  test("after a read and after a failed read", async () => {
    await withHistoryBox(db, {}, async (box) => {
      await jobOf(db, box).run();
      await refreshFlagsOfMailbox(depsOf(box), box, box.mailboxId, () => box.clock.now);
      expect(box.fake.closed).toBe(true);
    });
    await withHistoryBox(db, {}, async (box) => {
      box.fake.failOn("fetchFlagsIn", new SoftError("flags lost"));
      await db.transaction().execute(async (trx) => {
        await insertTestEmail(trx, box, box.mailboxId, { folder: "INBOX", uid: 930, received_at: box.clock.now });
      });
      await expect(refreshFlagsOfMailbox(depsOf(box), box, box.mailboxId, () => box.clock.now)).rejects.toBeInstanceOf(
        SoftError
      );
      expect(box.fake.closed).toBe(true);
    });
  });
});

describe("N6. the history flag refresh leaves gone mail to the regular refresh", () => {
  test("mail that the server no longer returns gets no checked_at from the history refresh, and does from the regular one", async () => {
    await withHistoryBox(db, {}, async (box) => {
      const goneId = await db
        .transaction()
        .execute((trx) =>
          insertTestEmail(trx, box, box.mailboxId, { folder: "INBOX", uid: 931, received_at: box.clock.now })
        );
      const flagsOf = () =>
        db.selectFrom("email_flags").select("checked_at").where("email_id", "=", goneId).executeTakeFirst();
      const deps = {
        db,
        secrets: historySecrets,
        isOwnActionId: async () => false,
        openProvider: async () => box.fake,
      };
      const result = await refreshFlagsOfMailbox(deps, box, box.mailboxId, () => box.clock.now);
      expect(result.gone.map((target) => target.emailId)).toEqual([goneId]);
      expect(await flagsOf()).toBeUndefined();
      // The regular refresh (the sync job's own) still marks it as tried: its move finder reads the gone mail of its run.
      const regular = await refreshFlags({ db, provider: box.fake, now: () => box.clock.now }, box, box.mailboxId);
      expect(regular.gone.map((target) => target.emailId)).toEqual([goneId]);
      expect((await flagsOf())?.checked_at).toEqual(box.clock.now);
    });
  });
});

describe("TG6. the queue side reaches no triage code and no model client, also through its imports", () => {
  const srcRoot = resolve(import.meta.dir, "../../src");

  // The files that a start file imports, found through relative imports (`from "./x"`, `from "../mail"`), with `index.ts` and `.ts` resolved.
  function reachable(starts: string[]): Set<string> {
    const seen = new Set<string>();
    const queue = [...starts];
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/(?:from|import)\s*\(?\s*"(\.[^"]+)"/g)) {
        const base = resolve(file, "..", match[1] as string);
        for (const candidate of [`${base}.ts`, resolve(base, "index.ts")]) {
          if (existsSync(candidate)) queue.push(candidate);
        }
      }
    }
    return seen;
  }

  test("no file of the closure is in the triage module, and none calls a model or records a model call", () => {
    // `history-classify.ts` (the classify step) is the one trust file that reaches the model, through `classifyStored`.
    const closure = reachable(
      ["modules/trust/history-queue.ts", "modules/trust/history-items.ts"].map((file) => resolve(srcRoot, file))
    );
    expect(closure.size).toBeGreaterThan(5);
    expect([...closure].filter((file) => file.includes("/modules/triage/"))).toEqual([]);
    // The model client and the call record live in platform/llm and audit; nothing else of the closure may use them.
    const callers = [...closure]
      .filter((file) => !file.includes("/platform/llm/") && !file.includes("/modules/audit/"))
      .filter((file) => /createLlmClient\(|\.generate\(\{|recordLlmCall\(/.test(readFileSync(file, "utf8")));
    expect(callers).toEqual([]);
  });
});

describe("only the classify step calls the model, and no trust file writes a triage row", () => {
  const dir = resolve(import.meta.dir, "../../src/modules/trust");

  test("no trust source names the triage_results table or calls the client directly; recordLlmCall only in the classify step", () => {
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))) {
      const source = readFileSync(resolve(dir, file), "utf8");
      expect(source, file).not.toMatch(/triage_results|generate\(|createLlmClient\(|insertTriageResult/);
      if (file !== "history-classify.ts") expect(source, file).not.toMatch(/recordLlmCall/);
    }
  });

  test("the backfill and flags steps record no llm.call row (the default client of the helper throws)", async () => {
    await withHistoryBox(db, {}, async (box) => {
      await queue(box);
      const job = jobOf(db, box);
      await job.run();
      await job.run();
      const calls = await db
        .selectFrom("audit_log")
        .select("id")
        .where("org_id", "=", box.orgId)
        .where("event", "=", "llm.call")
        .execute();
      expect(calls).toEqual([]);
    });
  });
});
