import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

import { MailAuthError, type MailProvider, type OAuthTokens } from "../../src/modules/mail";
import { protocolDisabled } from "../../src/modules/mail/oauth/login";
import { setMailboxStatus, updateCursor } from "../../src/modules/mail/repo";
import { setOrgFeature } from "../../src/modules/tenancy";
import {
  HISTORY_FLAGS_WAIT_MS,
  HISTORY_LOCK_STALE_MS,
  HISTORY_RETRY_MS,
  HISTORY_WINDOW_DAYS,
  queueHistoryCheck,
} from "../../src/modules/trust";
import { SoftError } from "../../src/platform/errors";

import { insertTestEmail, suspendOrg } from "./fixtures";
import { testDb } from "./helpers";
import {
  advance,
  checkRows,
  HISTORY_UID_VALIDITY,
  jobOf,
  MINUTE_MS,
  RUNNING_KEY,
  theCheck,
  withHistoryBox,
  type HistoryBox,
} from "./trust-history-helpers";

// The history check job (F110 stage 06): claim, backfill, flags wait. Committed rows, a fixed clock and the in-memory mail server;
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
      advance(box, 60 * MINUTE_MS);
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
});

describe("step 2: the backfill step", () => {
  test("5. an INBOX with 5 mails: waiting_flags, 5 history rows, the key, the window and the time set; no triage row", async () => {
    await withHistoryBox(db, {}, async (box) => {
      const id = await queue(box);
      await jobOf(db, box).run();
      const row = await theCheck(db, box);
      expect(row.status).toBe("waiting_flags");
      expect(row.key as unknown).toEqual(RUNNING_KEY);
      expect(row.window_start?.getTime()).toBe(box.clock.now.getTime() - HISTORY_WINDOW_DAYS * 86_400_000);
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
      expect(await emailsOf(box)).toHaveLength(5);
      const windowStart = crashed.window_start?.getTime();

      hooks.afterBackfill = () => undefined;
      advance(box, HISTORY_RETRY_MS);
      await job.run();
      const row = await theCheck(db, box);
      expect(row.status).toBe("waiting_flags");
      // The window start of the first claim is kept on the repeat.
      expect(row.window_start?.getTime()).toBe(windowStart);
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
      // N1: `refreshFlags` covers `skipped` mail.
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
          received_at: new Date(doneAt.getTime() - 40 * 86_400_000),
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
      for (const mail of mails) await flagRow(mail.id, new Date(doneAt.getTime() - 86_400_000));
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

  test("a classifying check is not claimed by this job: the classify step is a later stage", async () => {
    await withHistoryBox(db, {}, async (box) => {
      const id = await queue(box);
      await db.updateTable("history_checks").set({ status: "classifying" }).where("id", "=", id).execute();
      await jobOf(db, box).run();
      expect(box.opens.count).toBe(0);
      expect(await theCheck(db, box)).toMatchObject({ status: "classifying", attempts: 0 });
      expect((await theCheck(db, box)).locked_at).toBeNull();
    });
  });
});

describe("the job makes no model call and writes no triage row", () => {
  const dir = resolve(import.meta.dir, "../../src/modules/trust");
  const files = ["history-job.ts", "history-queue.ts"];

  test("its sources name no model client and no triage_results table", () => {
    for (const file of files) {
      const source = readFileSync(resolve(dir, file), "utf8");
      expect(source, file).not.toMatch(/triage_results|LlmClient|generate\(|llm\.|recordLlmCall/);
    }
  });

  test("the job has no model client in its deps: the log of a full run holds no llm.call row", async () => {
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
