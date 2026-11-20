import { DAY_MS, MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { refreshFlags, refreshFlagsOfMailbox } from "../../src/modules/mail";
import { setMailboxStatus } from "../../src/modules/mail/repo";
import { HISTORY_FLAGS_WAIT_MS, HISTORY_RETRY_MS } from "../../src/modules/trust";
import { SoftError } from "../../src/platform/errors";

import { insertTestEmail, suspendOrg } from "./fixtures";
import { testDb } from "./helpers";
import { addMailbox } from "./trust-fixtures";
import {
  advance,
  jobOf,
  historyJobKit,
  historySecrets,
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

const { queue } = historyJobKit(db);

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
