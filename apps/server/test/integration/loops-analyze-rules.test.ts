import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { analyzeSent } from "../../src/modules/loops";
import { listSentCandidates } from "../../src/modules/loops/analysis-repo";
import { applyRules } from "../../src/modules/loops/analyze-rules";
import { writeSentSwitch } from "../../src/modules/mail/repo";
import { configureFeatures, upsertOrgFeature } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";

import { insertDelegate, insertDelegation, insertDraftAndSend } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import {
  analysisOf,
  ASK,
  depsOf,
  fakeExtractor,
  FRI,
  loopsOrg,
  NOW,
  RUN_AT,
  sentMail,
  WED,
} from "./loops-analyze-fixtures";
import { insertAnalysisRow, insertLoopRow } from "./loops-fixtures";
import { ago, DAY, HOUR, newOrg, type Org, siblingMailbox } from "./mail-sent-fixtures";

// The Sent analysis without the model (F116 stage 12, step 1): the flags, the candidates, the promise rule, the thread
// rule, the delegation rule and the code filters. The tests run without `app.org_id`: only the `org_id` filter of each
// query stands between an organization and the rows of another one.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const run = (trx: Trx, org: Org, fake = fakeExtractor(), at = RUN_AT) =>
  analyzeSent(depsOf(trx, fake), org.ctx, org.mailboxId, { now: at, limit: 20 });

// An open delegation (`sent`, `overdue`, ...) of the mailbox for an incoming mail of the thread.
async function delegationInThread(trx: Trx, org: Org, threadKey: string, status = "sent"): Promise<void> {
  const delegateId = await insertDelegate(trx, org.ctx);
  const { emailId, draftId, sendId } = await insertDraftAndSend(trx, org.ctx, org.mailboxId, { delegateId });
  await trx.updateTable("emails").set({ thread_key: threadKey }).where("id", "=", emailId).execute();
  await insertDelegation(trx, org.ctx, {
    mailboxId: org.mailboxId,
    emailId,
    delegateId,
    draftActionId: draftId,
    sendActionId: sendId,
    status,
  });
}

async function loopRow(trx: Trx, id: string) {
  return trx.selectFrom("open_loops").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

describe("the gates", () => {
  test("T1: the flag open_loops off writes no row and makes no call", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx, { loopsFlag: false });
      const id = await sentMail(trx, org);
      const fake = fakeExtractor();
      const out = await run(trx, org, fake);
      expect(out.analysed).toBe(0);
      expect(await analysisOf(trx, id)).toBeUndefined();
      expect(fake.requests).toHaveLength(0);
    });
  });

  test("T1: the flag sent_sync off, or the switch off, writes no row", async () => {
    await withRollback(db, async (trx) => {
      const noSync = await newOrg(trx, { flag: false });
      await upsertOrgFeature(trx, noSync.ctx, { flag: "open_loops", enabled: true, setBy: "test", setAt: NOW });
      const idA = await sentMail(trx, noSync);
      const switchedOff = await loopsOrg(trx);
      await writeSentSwitch(trx, switchedOff.ctx, switchedOff.mailboxId, { enabled: false });
      const idB = await sentMail(trx, switchedOff);
      const fake = fakeExtractor();
      await run(trx, noSync, fake);
      await run(trx, switchedOff, fake);
      expect(await analysisOf(trx, idA)).toBeUndefined();
      expect(await analysisOf(trx, idB)).toBeUndefined();
      expect(fake.requests).toHaveLength(0);
    });
  });

  test("the process kill list stops the analysis", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const id = await sentMail(trx, org);
      configureFeatures({ off: ["open_loops"] });
      try {
        await run(trx, org);
      } finally {
        configureFeatures({ off: [] });
      }
      expect(await analysisOf(trx, id)).toBeUndefined();
    });
  });
});

describe("the candidates", () => {
  test("a pending text, a system row and a row over 14 days old get no row; a stored row does", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const pending = await sentMail(trx, org, { content: "pending" });
      const old = await sentMail(trx, org, { sentAt: new Date(RUN_AT.getTime() - 15 * DAY) });
      const stored = await sentMail(trx, org);
      const fake = fakeExtractor();
      const out = await run(trx, org, fake);
      expect(out.analysed).toBe(1);
      expect(await analysisOf(trx, pending)).toBeUndefined();
      expect(await analysisOf(trx, old)).toBeUndefined();
      expect((await analysisOf(trx, stored))?.status).toBe("done");
    });
  });

  test("T4c: a pending row waits and is analysed after its text is stored", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const id = await sentMail(trx, org, { content: "pending" });
      const fake = fakeExtractor();
      await run(trx, org, fake);
      expect(await analysisOf(trx, id)).toBeUndefined();
      expect(fake.requests).toHaveLength(0);
      await trx
        .updateTable("sent_emails")
        .set({ content: "stored", body_text: "Can you send the numbers?" })
        .where("id", "=", id)
        .execute();
      await run(trx, org, fake);
      expect((await analysisOf(trx, id))?.status).toBe("done");
      expect(fake.requests).toHaveLength(1);
    });
  });

  test("headers_only and gone rows are skipped no_text with no call", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const headers = await sentMail(trx, org, { content: "headers_only" });
      const gone = await sentMail(trx, org, { content: "gone" });
      const fake = fakeExtractor();
      await run(trx, org, fake);
      for (const id of [headers, gone]) {
        expect(await analysisOf(trx, id)).toMatchObject({ status: "skipped", skip_reason: "no_text" });
      }
      expect(fake.requests).toHaveLength(0);
    });
  });

  test("T2: a list mail is skipped list with no call; the other code filters give their reason", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const list = await sentMail(trx, org, { listId: "<news.example.test>" });
      const auto = await sentMail(trx, org, { autoSubmitted: "auto-replied" });
      const calendar = await sentMail(trx, org, { hasCalendar: true });
      const many = await sentMail(trx, org, { to: Array.from({ length: 11 }, (_, i) => `p${i}@example.test`) });
      const own = await sentMail(trx, org, { to: [`${org.mailboxId}@x.test`] });
      const mailbox = await trx
        .selectFrom("mailboxes")
        .select("address")
        .where("id", "=", org.mailboxId)
        .executeTakeFirstOrThrow();
      await trx
        .updateTable("sent_emails")
        .set({ to_addresses: [mailbox.address.toUpperCase()] })
        .where("id", "=", own)
        .execute();
      const fake = fakeExtractor();
      await run(trx, org, fake);
      const reasons = await Promise.all([list, auto, calendar, many, own].map((id) => analysisOf(trx, id)));
      expect(reasons.map((row) => row?.skip_reason)).toEqual(["list", "auto", "calendar", "too_many", "own_only"]);
      expect(reasons.every((row) => row?.status === "skipped")).toBe(true);
      expect(fake.requests).toHaveLength(0);
    });
  });

  test("a system row (a follow-up that the product sent) is not a candidate", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const id = await sentMail(trx, org, { content: "headers_only" });
      await trx
        .updateTable("sent_emails")
        .set({ origin: "system", action_id: randomUUID() })
        .where("id", "=", id)
        .execute();
      const fake = fakeExtractor();
      const out = await run(trx, org, fake);
      expect(out.analysed).toBe(0);
      expect(await analysisOf(trx, id)).toBeUndefined();
    });
  });

  test("a run takes the 20 oldest rows first", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const ids: string[] = [];
      for (let i = 0; i < 22; i += 1) {
        ids.push(
          await sentMail(trx, org, { sentAt: new Date(WED.getTime() + i * 60_000), listId: "<l.example.test>" })
        );
      }
      const out = await run(trx, org);
      expect(out.analysed).toBe(20);
      expect(await analysisOf(trx, ids[19] as string)).toBeDefined();
      expect(await analysisOf(trx, ids[20] as string)).toBeUndefined();
      expect((await run(trx, org)).analysed).toBe(2);
    });
  });

  test("the rows of the mailbox only, and of the organization only", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const sibling = await siblingMailbox(trx, org);
      const other = await loopsOrg(trx);
      const mine = await sentMail(trx, org, { listId: "<l.example.test>" });
      const sameOrg = await sentMail(trx, sibling, { listId: "<l.example.test>" });
      const foreign = await sentMail(trx, other, { listId: "<l.example.test>" });
      const out = await run(trx, org);
      expect(out.analysed).toBe(1);
      expect(await analysisOf(trx, mine)).toBeDefined();
      expect(await analysisOf(trx, sameOrg)).toBeUndefined();
      expect(await analysisOf(trx, foreign)).toBeUndefined();
      // A mailbox id of another organization with the context of this one finds nothing.
      const crossed = await analyzeSent(depsOf(trx, fakeExtractor()), org.ctx, other.mailboxId, {
        now: RUN_AT,
        limit: 20,
      });
      expect(crossed.analysed).toBe(0);
      expect(await analysisOf(trx, foreign)).toBeUndefined();
    });
  });

  test("the candidate reader filters the organization itself: a mailbox id of another organization gives nothing", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const other = await loopsOrg(trx);
      await sentMail(trx, other);
      const opts = { now: RUN_AT, limit: 20, testOnly: null };
      expect(await listSentCandidates(trx, org.ctx, other.mailboxId, opts)).toHaveLength(0);
      expect(await listSentCandidates(trx, other.ctx, other.mailboxId, opts)).toHaveLength(1);
    });
  });

  test("a due retry (pending, time passed) is a candidate; one that is not due is not", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const due = await sentMail(trx, org);
      const later = await sentMail(trx, org);
      await insertAnalysisRow(trx, org.ctx, org.mailboxId, due, { status: "pending" });
      await insertAnalysisRow(trx, org.ctx, org.mailboxId, later, { status: "pending" });
      await trx
        .updateTable("sent_analyses")
        .set({ next_attempt_at: ago(HOUR), expects_reply: null, has_promise: null, prompt_version: null })
        .where("sent_email_id", "=", due)
        .execute();
      await trx
        .updateTable("sent_analyses")
        .set({ next_attempt_at: new Date(RUN_AT.getTime() + HOUR), expects_reply: null })
        .where("sent_email_id", "=", later)
        .execute();
      const fake = fakeExtractor();
      await run(trx, org, fake);
      expect((await analysisOf(trx, due))?.status).toBe("done");
      expect((await analysisOf(trx, later))?.status).toBe("pending");
      expect(fake.requests).toHaveLength(1);
    });
  });

  test("a pending retry that is now over 14 days old is skipped too_old", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const id = await sentMail(trx, org, { sentAt: new Date(RUN_AT.getTime() - 16 * DAY) });
      await insertAnalysisRow(trx, org.ctx, org.mailboxId, id, { status: "pending" });
      await trx
        .updateTable("sent_analyses")
        .set({ next_attempt_at: ago(HOUR), expects_reply: null })
        .where("sent_email_id", "=", id)
        .execute();
      const fake = fakeExtractor();
      await run(trx, org, fake);
      expect(await analysisOf(trx, id)).toMatchObject({ status: "skipped", skip_reason: "too_old" });
      expect(fake.requests).toHaveLength(0);
    });
  });
});

describe("the rules with the switch off", () => {
  test("the rules write nothing when the switch went off after the candidates were read", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const promise = await insertLoopRow(trx, org.ctx, org.mailboxId, {
        kind: "promised",
        counterpart: "anna@example.test",
        wait_from_at: new Date("2026-11-16T10:00:00Z"),
      });
      const id = await sentMail(trx, org, { to: ["anna@example.test"], listId: "<l.example.test>" });
      const [row] = await listSentCandidates(trx, org.ctx, org.mailboxId, { now: RUN_AT, limit: 20, testOnly: null });
      await writeSentSwitch(trx, org.ctx, org.mailboxId, { enabled: false });
      const env = {
        mailboxId: org.mailboxId,
        ownAddresses: [],
        timeZone: "Europe/Warsaw",
        waitDays: 3,
        delegates: [],
        now: RUN_AT,
      };
      expect(await applyRules(trx, org.ctx, env, row as NonNullable<typeof row>)).toEqual({ kind: "off" });
      expect(await analysisOf(trx, id)).toBeUndefined();
      expect((await loopRow(trx, promise)).status).toBe("open");
    });
  });
});

describe("the thread rule", () => {
  test("T3: a mail to the person of a waiting loop in its thread restarts the wait with no call", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const thread = "<thread-t3@x.test>";
      const loop = await insertLoopRow(trx, org.ctx, org.mailboxId, {
        thread_key: thread,
        to_addresses: ["anna@example.test"],
        counterpart: "anna@example.test",
        wait_from_at: new Date("2026-11-16T10:00:00Z"),
        due_at: new Date("2026-11-19T16:00:00Z"),
      });
      const surfaced = new Date("2026-11-17T08:00:00Z");
      await trx.updateTable("open_loops").set({ surfaced_at: surfaced }).where("id", "=", loop).execute();
      const row = await sentMail(trx, org, { threadKey: thread, to: ["anna@example.test"], sentAt: WED });
      const fake = fakeExtractor();
      const out = await run(trx, org, fake);
      expect(out.restarted).toBe(1);
      expect(fake.requests).toHaveLength(0);
      expect(await analysisOf(trx, row)).toMatchObject({ status: "skipped", skip_reason: "thread_restart" });
      const after = await loopRow(trx, loop);
      // Wednesday 10:00 + 3 working days = Monday 2026-11-23, 17:00 in Warsaw.
      expect(after.due_at.toISOString()).toBe("2026-11-23T16:00:00.000Z");
      expect(after.wait_from_at.toISOString()).toBe(WED.toISOString());
      expect(after.last_sent_email_id).toBe(row);
      expect(after.status).toBe("open");
      expect(after.surfaced_at?.toISOString()).toBe(surfaced.toISOString());
    });
  });

  test("T3: the same mail to another person only is a side note: no restart, one call", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const thread = "<thread-t3b@x.test>";
      const loop = await insertLoopRow(trx, org.ctx, org.mailboxId, {
        thread_key: thread,
        to_addresses: ["anna@example.test"],
        cc_addresses: ["carl@example.test"],
        wait_from_at: new Date("2026-11-16T10:00:00Z"),
        due_at: new Date("2026-11-19T16:00:00Z"),
      });
      const before = await loopRow(trx, loop);
      const row = await sentMail(trx, org, { threadKey: thread, to: ["bob@example.test"], sentAt: WED });
      const fake = fakeExtractor({ ...ASK, expects_reply: false, ask: null });
      const out = await run(trx, org, fake);
      expect(out.restarted).toBe(0);
      expect(fake.requests).toHaveLength(1);
      expect((await analysisOf(trx, row))?.status).toBe("done");
      expect(await loopRow(trx, loop)).toEqual(before);
    });
  });

  test("the thread rule runs before the skip filters: a headers_only mail still restarts the wait", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const thread = "<thread-headers@x.test>";
      const loop = await insertLoopRow(trx, org.ctx, org.mailboxId, {
        thread_key: thread,
        wait_from_at: new Date("2026-11-16T10:00:00Z"),
      });
      const row = await sentMail(trx, org, { threadKey: thread, to: ["counterpart@x.test"], content: "headers_only" });
      await run(trx, org);
      expect((await analysisOf(trx, row))?.skip_reason).toBe("thread_restart");
      expect((await loopRow(trx, loop)).last_sent_email_id).toBe(row);
    });
  });

  test("a Cc person of the loop counts as an overlap, in any letter case", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const thread = "<thread-cc@x.test>";
      const loop = await insertLoopRow(trx, org.ctx, org.mailboxId, {
        thread_key: thread,
        to_addresses: ["anna@example.test"],
        cc_addresses: ["Carl@Example.test"],
        wait_from_at: new Date("2026-11-16T10:00:00Z"),
      });
      await sentMail(trx, org, { threadKey: thread, to: ["bob@example.test"], cc: ["carl@example.test"] });
      const out = await run(trx, org);
      expect(out.restarted).toBe(1);
      expect((await loopRow(trx, loop)).last_sent_email_id).not.toBeNull();
    });
  });

  test("the wait is at least 3 working days; a longer loop_wait_days of the mailbox is used", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const thread = "<thread-wait@x.test>";
      const loop = await insertLoopRow(trx, org.ctx, org.mailboxId, {
        thread_key: thread,
        wait_from_at: new Date("2026-11-16T10:00:00Z"),
      });
      await trx
        .updateTable("mailbox_settings")
        .set({ loop_wait_days: 1 })
        .where("mailbox_id", "=", org.mailboxId)
        .execute();
      await sentMail(trx, org, { threadKey: thread, to: ["counterpart@x.test"], sentAt: WED });
      await run(trx, org);
      expect((await loopRow(trx, loop)).due_at.toISOString()).toBe("2026-11-23T16:00:00.000Z");
      await trx
        .updateTable("mailbox_settings")
        .set({ loop_wait_days: 5 })
        .where("mailbox_id", "=", org.mailboxId)
        .execute();
      await sentMail(trx, org, { threadKey: thread, to: ["counterpart@x.test"], sentAt: FRI });
      await run(trx, org);
      // Friday 2026-11-20 + 5 working days = Friday 2026-11-27, 17:00 in Warsaw.
      expect((await loopRow(trx, loop)).due_at.toISOString()).toBe("2026-11-27T16:00:00.000Z");
    });
  });

  test("an older mail than the wait, a closed loop and a promised loop are not restarted", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const thread = "<thread-no@x.test>";
      const newer = await insertLoopRow(trx, org.ctx, org.mailboxId, {
        thread_key: thread,
        wait_from_at: new Date("2026-11-19T10:00:00Z"),
      });
      const closed = await insertLoopRow(trx, org.ctx, org.mailboxId, {
        thread_key: thread,
        status: "closed",
        close_reason: "replied",
        closed_at: ago(DAY),
        wait_from_at: new Date("2026-11-16T10:00:00Z"),
      });
      const promised = await insertLoopRow(trx, org.ctx, org.mailboxId, {
        thread_key: thread,
        kind: "promised",
        counterpart: "zoe@example.test",
        wait_from_at: new Date("2026-11-16T10:00:00Z"),
      });
      const before = [await loopRow(trx, newer), await loopRow(trx, closed), await loopRow(trx, promised)];
      const fake = fakeExtractor({ ...ASK, expects_reply: false, ask: null });
      await sentMail(trx, org, { threadKey: thread, to: ["counterpart@x.test"], sentAt: WED });
      const out = await run(trx, org, fake);
      expect(out.restarted).toBe(0);
      expect(fake.requests).toHaveLength(1);
      expect([await loopRow(trx, newer), await loopRow(trx, closed), await loopRow(trx, promised)]).toEqual(before);
    });
  });

  test("a loop of another organization in the same thread key is not restarted", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const other = await loopsOrg(trx);
      const thread = "<thread-shared@x.test>";
      const foreign = await insertLoopRow(trx, other.ctx, other.mailboxId, {
        thread_key: thread,
        to_addresses: ["anna@example.test"],
        wait_from_at: new Date("2026-11-16T10:00:00Z"),
      });
      const before = await loopRow(trx, foreign);
      await sentMail(trx, org, { threadKey: thread, to: ["anna@example.test"] });
      const out = await run(trx, org);
      expect(out.restarted).toBe(0);
      expect(await loopRow(trx, foreign)).toEqual(before);
    });
  });
});

describe("the promise rule", () => {
  test("T4: a later mail to the counterpart of a promise in another thread closes it later_reply; the row goes on", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const promise = await insertLoopRow(trx, org.ctx, org.mailboxId, {
        kind: "promised",
        counterpart: "Anna@Example.test",
        wait_from_at: new Date("2026-11-16T10:00:00Z"),
      });
      const row = await sentMail(trx, org, { to: ["bob@example.test"], cc: ["anna@example.test"] });
      const fake = fakeExtractor({ ...ASK, expects_reply: false, ask: null });
      const out = await run(trx, org, fake);
      expect(out.promisesClosed).toBe(1);
      expect(await loopRow(trx, promise)).toMatchObject({ status: "closed", close_reason: "later_reply" });
      // The row is analysed as before: one call.
      expect(fake.requests).toHaveLength(1);
      expect((await analysisOf(trx, row))?.status).toBe("done");
      const audit = await trx
        .selectFrom("audit_log")
        .select("data")
        .where("org_id", "=", org.ctx.orgId)
        .where("event", "=", "loop.closed")
        .execute();
      expect(audit).toHaveLength(1);
      expect(JSON.stringify(audit)).not.toContain("example.test");
    });
  });

  test("the promise rule runs before the skip rules: a list or no_text row still closes it", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const promise = await insertLoopRow(trx, org.ctx, org.mailboxId, {
        kind: "promised",
        counterpart: "anna@example.test",
        wait_from_at: new Date("2026-11-16T10:00:00Z"),
      });
      const row = await sentMail(trx, org, { to: ["anna@example.test"], content: "headers_only" });
      await run(trx, org);
      expect(await loopRow(trx, promise)).toMatchObject({ status: "closed", close_reason: "later_reply" });
      expect(await analysisOf(trx, row)).toMatchObject({ skip_reason: "no_text" });
    });
  });

  test("a mail to someone else, an older mail, a waiting loop and another mailbox leave the promise open", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const sibling = await siblingMailbox(trx, org);
      const base = { counterpart: "anna@example.test", wait_from_at: new Date("2026-11-19T10:00:00Z") };
      const newer = await insertLoopRow(trx, org.ctx, org.mailboxId, { kind: "promised", ...base });
      const waiting = await insertLoopRow(trx, org.ctx, org.mailboxId, { kind: "waiting", ...base });
      const otherBox = await insertLoopRow(trx, sibling.ctx, sibling.mailboxId, {
        kind: "promised",
        counterpart: "anna@example.test",
        wait_from_at: new Date("2026-11-16T10:00:00Z"),
      });
      const strangers = await insertLoopRow(trx, org.ctx, org.mailboxId, {
        kind: "promised",
        counterpart: "zoe@example.test",
        wait_from_at: new Date("2026-11-16T10:00:00Z"),
      });
      const before = [newer, waiting, otherBox, strangers].map((id) => loopRow(trx, id));
      const snapshot = await Promise.all(before);
      await sentMail(trx, org, { to: ["anna@example.test"], sentAt: WED, listId: "<l.example.test>" });
      const out = await run(trx, org);
      expect(out.promisesClosed).toBe(0);
      expect(await Promise.all([newer, waiting, otherBox, strangers].map((id) => loopRow(trx, id)))).toEqual(snapshot);
    });
  });

  test("a promise of another organization with the same counterpart address stays open", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const other = await loopsOrg(trx);
      const foreign = await insertLoopRow(trx, other.ctx, other.mailboxId, {
        kind: "promised",
        counterpart: "anna@example.test",
        wait_from_at: new Date("2026-11-16T10:00:00Z"),
      });
      const before = await loopRow(trx, foreign);
      await sentMail(trx, org, { to: ["anna@example.test"], listId: "<l.example.test>" });
      await run(trx, org);
      expect(await loopRow(trx, foreign)).toEqual(before);
    });
  });
});

describe("the delegation rule", () => {
  test("T4b: a mail in the thread of an open delegation is skipped delegation_thread with no call", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const thread = "<thread-del@x.test>";
      await delegationInThread(trx, org, thread, "sent");
      const overdueThread = "<thread-del2@x.test>";
      await delegationInThread(trx, org, overdueThread, "overdue");
      const a = await sentMail(trx, org, { threadKey: thread });
      const b = await sentMail(trx, org, { threadKey: overdueThread });
      const fake = fakeExtractor();
      await run(trx, org, fake);
      for (const id of [a, b]) {
        expect(await analysisOf(trx, id)).toMatchObject({ status: "skipped", skip_reason: "delegation_thread" });
      }
      expect(fake.requests).toHaveLength(0);
    });
  });

  test("a finished delegation, a delegation of another mailbox or organization does not hide the thread", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const sibling = await siblingMailbox(trx, org);
      const other = await loopsOrg(trx);
      const done = "<thread-done@x.test>";
      const sib = "<thread-sib@x.test>";
      const foreign = "<thread-foreign@x.test>";
      await delegationInThread(trx, org, done, "answered");
      await delegationInThread(trx, sibling, sib, "sent");
      await delegationInThread(trx, other, foreign, "sent");
      const ids = [
        await sentMail(trx, org, { threadKey: done }),
        await sentMail(trx, org, { threadKey: sib }),
        await sentMail(trx, org, { threadKey: foreign }),
      ];
      const fake = fakeExtractor();
      await run(trx, org, fake);
      for (const id of ids) expect((await analysisOf(trx, id))?.status).toBe("done");
      expect(fake.requests).toHaveLength(3);
    });
  });

  test("the thread rule comes before the delegation rule", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const thread = "<thread-both@x.test>";
      await delegationInThread(trx, org, thread, "sent");
      await insertLoopRow(trx, org.ctx, org.mailboxId, {
        thread_key: thread,
        wait_from_at: new Date("2026-11-16T10:00:00Z"),
      });
      const row = await sentMail(trx, org, { threadKey: thread, to: ["counterpart@x.test"] });
      await run(trx, org);
      expect((await analysisOf(trx, row))?.skip_reason).toBe("thread_restart");
    });
  });
});
