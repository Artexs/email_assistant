import { afterAll, describe, expect, test } from "bun:test";

import { checkLlmErrors, checkSyncLag, checkUrgentLatency } from "../../src/modules/operator";

import { addMember, insertTriaged, linkChat, randomChatId, resumeOrg, suspendOrg } from "./fixtures";
import { testDb } from "./helpers";
import {
  cfg,
  noTestMail,
  at,
  NOW,
  STARTED,
  makeInRollback,
  setMailbox,
  orgWithMailbox,
  urgentOrg,
  urgentMail,
  sentNotice,
  urgent,
} from "./slo-checks-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const inRollback = makeInRollback(db);

describe("urgent latency", () => {
  test("6. urgent mail received 09:45 with no notice: firing, 15 minutes", async () => {
    await inRollback(async (trx) => {
      const org = await urgentOrg(trx);
      const emailId = await urgentMail(trx, org, { receivedAt: at("09:45") });
      const reading = await urgent(trx);
      expect(reading.check).toEqual({
        kind: "slo_urgent_latency",
        state: "firing",
        facts: { mails: 1, max_wait_min: 15 },
      });
      expect(reading.ids).toEqual([emailId]);
    });
  });

  test("6b. a wait of exactly 10 minutes is not late", async () => {
    await inRollback(async (trx) => {
      const org = await urgentOrg(trx);
      await urgentMail(trx, org, { receivedAt: at("09:50") });
      expect((await urgent(trx)).check.state).toBe("clear");
    });
  });

  test("6c. mail of a suspended organization, mail of another category and mail re-triaged away are not counted", async () => {
    await inRollback(async (trx) => {
      const org = await urgentOrg(trx);
      await urgentMail(trx, org, { receivedAt: at("09:00") });
      await suspendOrg(trx, org.orgId);
      expect((await urgent(trx)).check.state).toBe("clear");
      const other = await urgentOrg(trx);
      await insertTriaged(trx, { orgId: other.orgId }, other.mailboxId, {
        category: "needs_reply",
        createdAt: at("09:00"),
      });
      expect((await urgent(trx)).check.state).toBe("clear");
      const changed = await urgentMail(trx, other, { receivedAt: at("09:00") });
      expect((await urgent(trx)).check.state).toBe("firing");
      await trx
        .insertInto("triage_results")
        .values({
          org_id: other.orgId,
          email_id: changed,
          category: "info",
          confidence: 0.9,
          reason_code: "direct_request",
          created_at: at("09:30"),
        })
        .execute();
      expect((await urgent(trx)).check.state).toBe("clear");
    });
  });

  test("7. quiet hours count by send time: 2 minutes before 22:00 and 9 after 07:00 make 11", async () => {
    await inRollback(async (trx) => {
      const org = await urgentOrg(trx);
      await setMailbox(trx, org.mailboxId, { status_changed_at: at("08:00", "2026-11-18") });
      await urgentMail(trx, org, { receivedAt: at("20:58", "2026-11-19") });
      const started = at("00:00", "2026-11-19");
      expect((await urgent(trx, at("21:30", "2026-11-19"), started)).check.state).toBe("clear");
      const reading = await urgent(trx, at("06:09"), started);
      expect(reading.check.state).toBe("firing");
      expect(reading.check.facts.max_wait_min).toBe(11);
      // 06:05Z is 07:05 local: 2 + 5 = 7 minutes.
      expect((await urgent(trx, at("06:05"), started)).check.state).toBe("clear");
    });
  });

  test("8. a notice 20 minutes after the mail is late for 1 h; later it is clear", async () => {
    await inRollback(async (trx) => {
      const org = await urgentOrg(trx);
      const late = await urgentMail(trx, org, { receivedAt: at("09:00") });
      await sentNotice(trx, org, late, at("09:20"));
      const old = await urgentMail(trx, org, { receivedAt: at("08:30") });
      await sentNotice(trx, org, old, at("08:50"));
      const reading = await urgent(trx);
      expect(reading.check.state).toBe("firing");
      expect(reading.check.facts).toEqual({ mails: 1, max_wait_min: 20 });
      expect(reading.ids).toEqual([late]);
    });
  });

  test("8b. a late notice stops counting 1 h after its send: 09:00 counts, 08:59 does not", async () => {
    await inRollback(async (trx) => {
      const org = await urgentOrg(trx);
      const mail = await urgentMail(trx, org, { receivedAt: at("08:30") });
      await sentNotice(trx, org, mail, at("09:00"));
      expect((await urgent(trx)).check.state).toBe("firing");
      await trx.deleteFrom("outbox").where("email_id", "=", mail).execute();
      await sentNotice(trx, org, mail, at("08:59"));
      expect((await urgent(trx)).check.state).toBe("clear");
    });
  });

  test("8c. a notice that is not sent, or not an urgent notice, is no notice", async () => {
    await inRollback(async (trx) => {
      const org = await urgentOrg(trx);
      const mail = await urgentMail(trx, org, { receivedAt: at("09:30") });
      await sentNotice(trx, org, mail, at("09:31"), { status: "pending" });
      await sentNotice(trx, org, mail, at("09:32"), { kind: "approval" });
      const reading = await urgent(trx);
      expect(reading.check.state).toBe("firing");
      expect(reading.check.facts).toEqual({ mails: 1, max_wait_min: 30 });
    });
  });

  test("8d. mail received before the 24 h window is not counted", async () => {
    await inRollback(async (trx) => {
      const org = await urgentOrg(trx);
      await setMailbox(trx, org.mailboxId, { status_changed_at: at("08:00", "2026-11-17") });
      await urgentMail(trx, org, { receivedAt: at("09:00", "2026-11-18") });
      expect((await urgent(trx)).check.state).toBe("clear");
    });
  });

  test("9a. no linked chat: clear", async () => {
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      await urgentMail(trx, org, { receivedAt: at("09:00") });
      expect((await urgent(trx)).check.state).toBe("clear");
    });
  });

  test("9b. mail in the junk folder: clear; the same mail in the inbox: firing", async () => {
    await inRollback(async (trx) => {
      const org = await urgentOrg(trx);
      await trx
        .insertInto("mailbox_folders")
        .values({ org_id: org.orgId, mailbox_id: org.mailboxId, key: "junk", path: "Spam", role: "junk" })
        .execute();
      const spam = await urgentMail(trx, org, { receivedAt: at("09:00"), sourceFolder: "Spam" });
      expect((await urgent(trx)).check.state).toBe("clear");
      await trx.updateTable("emails").set({ source_folder: "INBOX" }).where("id", "=", spam).execute();
      expect((await urgent(trx)).check.state).toBe("firing");
    });
  });

  test("9c. mail triaged before the chat was linked: clear", async () => {
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      await linkChat(trx, { orgId: org.orgId }, org.userId, randomChatId(), at("09:30"));
      await urgentMail(trx, org, { receivedAt: at("09:00"), triagedAt: at("09:01") });
      expect((await urgent(trx)).check.state).toBe("clear");
      await urgentMail(trx, org, { receivedAt: at("09:00"), triagedAt: at("09:31") });
      expect((await urgent(trx)).check.state).toBe("firing");
    });
  });

  test("9c2. the earliest link of two members counts: mail triaged between the two links is covered", async () => {
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      const second = await addMember(trx, org.orgId);
      await linkChat(trx, { orgId: org.orgId }, second, randomChatId(), at("09:30"));
      await linkChat(trx, { orgId: org.orgId }, org.userId, randomChatId(), at("08:30"));
      await urgentMail(trx, org, { receivedAt: at("09:00") });
      // MIN(linked_at) = 08:30, so the mail triaged at 09:00 is covered; the later link (09:30) would exclude it.
      expect((await urgent(trx)).check.state).toBe("firing");
    });
  });

  test("8f. the first sent notice of a mail counts, not the last: two notices at 09:20 and 09:40 make a wait of 20", async () => {
    await inRollback(async (trx) => {
      const org = await urgentOrg(trx);
      const second = await addMember(trx, org.orgId);
      const mail = await urgentMail(trx, org, { receivedAt: at("09:00") });
      await sentNotice(trx, org, mail, at("09:40"), { userId: second });
      await sentNotice(trx, org, mail, at("09:20"));
      const reading = await urgent(trx);
      expect(reading.check.state).toBe("firing");
      expect(reading.check.facts).toEqual({ mails: 1, max_wait_min: 20 });
    });
  });

  test("9i. a time zone that Intl does not know skips that organization with one warning; the others still count", async () => {
    await inRollback(async (trx) => {
      const bad = await urgentOrg(trx);
      await urgentMail(trx, bad, { receivedAt: at("09:00") });
      await urgentMail(trx, bad, { receivedAt: at("09:01") });
      await trx.updateTable("organizations").set({ timezone: "Mars/Olympus" }).where("id", "=", bad.orgId).execute();
      const warnings: { event: string; fields: unknown }[] = [];
      const logger = { warn: (event: string, fields?: unknown) => void warnings.push({ event, fields }) };
      expect((await checkUrgentLatency(trx, NOW, cfg, STARTED, noTestMail, logger)).check.state).toBe("clear");
      expect(warnings).toEqual([{ event: "slo_urgent_zone_bad", fields: { org_id: bad.orgId } }]);
      const good = await urgentOrg(trx);
      const goodMail = await urgentMail(trx, good, { receivedAt: at("09:00") });
      warnings.length = 0;
      const reading = await checkUrgentLatency(trx, NOW, cfg, STARTED, noTestMail, logger);
      expect(reading.check.state).toBe("firing");
      expect(reading.ids).toEqual([goodMail]);
      expect(warnings).toHaveLength(1);
    });
  });

  test("9d. a mailbox that became active at 09:55 starts the wait at 09:55: clear", async () => {
    await inRollback(async (trx) => {
      const org = await urgentOrg(trx);
      await urgentMail(trx, org, { receivedAt: at("09:00") });
      await setMailbox(trx, org.mailboxId, { status_changed_at: at("09:55") });
      expect((await urgent(trx)).check.state).toBe("clear");
      await setMailbox(trx, org.mailboxId, { status_changed_at: at("09:40") });
      const reading = await urgent(trx);
      expect(reading.check.state).toBe("firing");
      expect(reading.check.facts.max_wait_min).toBe(20);
    });
  });

  test("9e. a paused mailbox is not counted", async () => {
    await inRollback(async (trx) => {
      const org = await urgentOrg(trx);
      await urgentMail(trx, org, { receivedAt: at("09:00") });
      await setMailbox(trx, org.mailboxId, { status: "paused" });
      expect((await urgent(trx)).check.state).toBe("clear");
    });
  });

  test("9f. mail triaged before an organization resume is not counted", async () => {
    await inRollback(async (trx) => {
      const org = await urgentOrg(trx);
      await urgentMail(trx, org, { receivedAt: at("09:00"), triagedAt: at("09:01") });
      await resumeOrg(trx, org.orgId, at("09:30"));
      expect((await urgent(trx)).check.state).toBe("clear");
    });
  });

  test("9g. mail triaged after an organization resume waits from the resume, not from the receive time", async () => {
    await inRollback(async (trx) => {
      const org = await urgentOrg(trx);
      await urgentMail(trx, org, { receivedAt: at("09:00"), triagedAt: at("09:58") });
      await resumeOrg(trx, org.orgId, at("09:55"));
      expect((await urgent(trx)).check.state).toBe("clear");
      await resumeOrg(trx, org.orgId, at("09:40"));
      const reading = await urgent(trx);
      expect(reading.check.state).toBe("firing");
      expect(reading.check.facts.max_wait_min).toBe(20);
    });
  });

  test("9h. test mail and backfilled mail are not counted", async () => {
    await inRollback(async (trx) => {
      const org = await urgentOrg(trx);
      const mail = await urgentMail(trx, org, { receivedAt: at("09:00"), from: "tester@x.test" });
      const rule = { senders: ["tester@x.test"] };
      expect((await checkUrgentLatency(trx, NOW, cfg, STARTED, rule)).check.state).toBe("clear");
      expect((await checkUrgentLatency(trx, NOW, cfg, STARTED, noTestMail)).check.state).toBe("firing");
      await trx
        .updateTable("emails")
        .set({ backfilled_at: at("09:30") })
        .where("id", "=", mail)
        .execute();
      expect((await urgent(trx)).check.state).toBe("clear");
    });
  });

  test("5b. within 10 minutes of the start: between", async () => {
    await inRollback(async (trx) => {
      const org = await urgentOrg(trx);
      await urgentMail(trx, org, { receivedAt: at("09:00") });
      expect((await urgent(trx, NOW, at("09:55"))).check.state).toBe("between");
    });
  });

  test("a reading holds no address, no subject and only UUIDs and numbers", async () => {
    await inRollback(async (trx) => {
      const org = await urgentOrg(trx);
      await urgentMail(trx, org, {
        receivedAt: at("09:00"),
        subject: "Secret subject of the mail",
        from: "secret-sender@x.test",
      });
      const readings = [
        await urgent(trx),
        await checkSyncLag(trx, NOW, cfg, STARTED),
        await checkLlmErrors(trx, NOW, cfg),
      ];
      await setMailbox(trx, org.mailboxId, { last_synced_at: at("09:00") });
      readings.push(await checkSyncLag(trx, NOW, cfg, STARTED));
      const address = (
        await trx.selectFrom("mailboxes").select("address").where("id", "=", org.mailboxId).executeTakeFirstOrThrow()
      ).address;
      expect(readings.map((reading) => reading.check.state)).toContain("firing");
      for (const reading of readings) {
        const text = JSON.stringify(reading);
        expect(text).not.toContain("Secret subject");
        expect(text).not.toContain("secret-sender");
        expect(text).not.toContain(address);
        expect(text).not.toContain("@");
        expect(Object.keys(reading).sort()).toEqual(["check", "ids"]);
        expect(Object.keys(reading.check).sort()).toEqual(["facts", "kind", "state"]);
        for (const value of Object.values(reading.check.facts)) expect(typeof value).toBe("number");
        for (const id of reading.ids)
          expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      }
    });
  });
});
