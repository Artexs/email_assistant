import { randomUUID } from "node:crypto";

import { DAY_MS, HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { analyzeSent } from "../../src/modules/loops";
import { listSentCandidates } from "../../src/modules/loops/analysis-repo";
import { writeSentSwitch } from "../../src/modules/mail/repo";
import { configureFeatures, upsertOrgFeature } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";

import { testDb, withRollback } from "./helpers";
import { analysisOf, depsOf, fakeExtractor, loopsOrg, NOW, RUN_AT, sentMail, WED } from "./loops-analyze-fixtures";
import { insertAnalysisRow } from "./loops-fixtures";
import { ago, newOrg, type Org, siblingMailbox } from "./mail-sent-fixtures";

// The gates and the candidates of the Sent analysis (step 1): the flags, the switch, which rows are read
// and in which order, and the code filters. The tests run without `app.org_id`: only the `org_id` filter of each query
// stands between an organization and the rows of another one.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const run = (trx: Trx, org: Org, fake = fakeExtractor(), at = RUN_AT) =>
  analyzeSent(depsOf(trx, fake), org.ctx, org.mailboxId, { now: at, limit: 20 });

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
      const old = await sentMail(trx, org, { sentAt: new Date(RUN_AT.getTime() - 15 * DAY_MS) });
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
        .set({ next_attempt_at: ago(HOUR_MS), expects_reply: null, has_promise: null, prompt_version: null })
        .where("sent_email_id", "=", due)
        .execute();
      await trx
        .updateTable("sent_analyses")
        .set({ next_attempt_at: new Date(RUN_AT.getTime() + HOUR_MS), expects_reply: null })
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
      const id = await sentMail(trx, org, { sentAt: new Date(RUN_AT.getTime() - 16 * DAY_MS) });
      await insertAnalysisRow(trx, org.ctx, org.mailboxId, id, { status: "pending" });
      await trx
        .updateTable("sent_analyses")
        .set({ next_attempt_at: ago(HOUR_MS), expects_reply: null })
        .where("sent_email_id", "=", id)
        .execute();
      const fake = fakeExtractor();
      await run(trx, org, fake);
      expect(await analysisOf(trx, id)).toMatchObject({ status: "skipped", skip_reason: "too_old" });
      expect(fake.requests).toHaveLength(0);
    });
  });
});
