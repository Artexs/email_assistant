import { DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { setMailboxStatus, updateCursor } from "../../src/modules/mail/repo";
import { HISTORY_RETRY_MS, HISTORY_WINDOW_DAYS } from "../../src/modules/trust";

import { testDb } from "./helpers";
import {
  advance,
  HISTORY_UID_VALIDITY,
  jobOf,
  historyJobKit,
  RUNNING_KEY,
  seedMail,
  theCheck,
  withHistoryBox,
} from "./trust-history-helpers";

// The history check job: claim, backfill, flags wait. Committed rows, a fixed clock and the in-memory mail server;
// the model is never called (the job has no client). The two-connection rules are in trust-history-job-race.test.ts.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const { queue, emailsOf } = historyJobKit(db);

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
