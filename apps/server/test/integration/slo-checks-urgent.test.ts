import { MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { recordLlmCall } from "../../src/modules/audit";
import { checkLlmErrors, checkSyncLag, checkUrgentLatency } from "../../src/modules/operator";
import { upsertOrgFeature } from "../../src/modules/tenancy";
import { loadConfig, sloThresholds } from "../../src/platform/config";
import type { DB } from "../../src/platform/db";

import {
  addMember,
  createOrgWithMailbox,
  insertTriaged,
  linkChat,
  randomChatId,
  resumeOrg,
  suspendOrg,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The three service-level checks that read the database. They read every organization that is not
// `suspended` and return numbers and UUIDs only.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

// The defaults of the SLO keys; the env of the machine must not change them.
const cfg = sloThresholds(
  loadConfig({
    DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/x",
    CREDENTIALS_KEY: Buffer.alloc(32).toString("base64"),
  })
);
const noTestMail = { senders: [] };

const at = (time: string, date = "2026-11-20"): Date => new Date(`${date}T${time}:00Z`);
const NOW = at("10:00");
const STARTED = at("08:00");

// Other tests and the dev data leave organizations in the DB. The checks read all of them, so the test hides them first;
// the rollback undoes it.
async function inRollback(fn: (trx: Trx) => Promise<void>): Promise<void> {
  await withRollback(db, async (trx) => {
    await trx.updateTable("organizations").set({ plan: "suspended" }).execute();
    await fn(trx);
  });
}

async function setMailbox(
  trx: Trx,
  mailboxId: string,
  columns: { last_synced_at?: Date | null; status_changed_at?: Date; created_at?: Date; status?: string }
): Promise<void> {
  await trx.updateTable("mailboxes").set(columns).where("id", "=", mailboxId).execute();
}

// An organization with one mailbox that has a sign of life at 08:00 only.
async function orgWithMailbox(trx: Trx) {
  const org = await createOrgWithMailbox(trx);
  await setMailbox(trx, org.mailboxId, {
    last_synced_at: null,
    status_changed_at: at("08:00"),
    created_at: at("08:00"),
  });
  return org;
}

describe("sync lag", () => {
  test("1. last sync 09:44, status change 08:00: firing, 16 minutes", async () => {
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      await setMailbox(trx, org.mailboxId, { last_synced_at: at("09:44") });
      const reading = await checkSyncLag(trx, NOW, cfg, STARTED);
      expect(reading.check).toEqual({
        kind: "slo_sync_lag",
        state: "firing",
        facts: { mailboxes: 1, max_lag_min: 16 },
      });
      expect(reading.ids).toEqual([org.mailboxId]);
    });
  });

  test("1b. a lag of exactly 15 minutes is not late", async () => {
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      await setMailbox(trx, org.mailboxId, { last_synced_at: at("09:45") });
      expect((await checkSyncLag(trx, NOW, cfg, STARTED)).check.state).toBe("clear");
    });
  });

  test("2. a status change at 09:50 gives the sync time: clear", async () => {
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      await setMailbox(trx, org.mailboxId, { last_synced_at: at("09:44"), status_changed_at: at("09:50") });
      expect((await checkSyncLag(trx, NOW, cfg, STARTED)).check.state).toBe("clear");
    });
  });

  test("2b. an organization resume at 09:50 gives the sync time: clear", async () => {
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      await setMailbox(trx, org.mailboxId, { last_synced_at: at("09:44") });
      await resumeOrg(trx, org.orgId, at("09:50"));
      expect((await checkSyncLag(trx, NOW, cfg, STARTED)).check.state).toBe("clear");
      await resumeOrg(trx, org.orgId, at("09:30"));
      expect((await checkSyncLag(trx, NOW, cfg, STARTED)).check.state).toBe("firing");
    });
  });

  test("2c. a paused mailbox is not late", async () => {
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      await setMailbox(trx, org.mailboxId, { last_synced_at: at("09:00"), status: "paused" });
      expect((await checkSyncLag(trx, NOW, cfg, STARTED)).check.state).toBe("clear");
    });
  });

  test("3. a lagging mailbox of a suspended organization only: clear", async () => {
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      await setMailbox(trx, org.mailboxId, { last_synced_at: at("09:00") });
      await suspendOrg(trx, org.orgId);
      const reading = await checkSyncLag(trx, NOW, cfg, STARTED);
      expect(reading.check.state).toBe("clear");
      expect(reading.ids).toEqual([]);
    });
  });

  test("4. never synced: created 09:50 is clear, created 09:40 is firing", async () => {
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      await setMailbox(trx, org.mailboxId, { created_at: at("09:50") });
      expect((await checkSyncLag(trx, NOW, cfg, STARTED)).check.state).toBe("clear");
      await setMailbox(trx, org.mailboxId, { created_at: at("09:40") });
      const reading = await checkSyncLag(trx, NOW, cfg, STARTED);
      expect(reading.check.state).toBe("firing");
      expect(reading.check.facts.max_lag_min).toBe(20);
    });
  });

  test("5. within 10 minutes of the start: between, also with a clear DB", async () => {
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      await setMailbox(trx, org.mailboxId, { last_synced_at: at("09:44") });
      expect((await checkSyncLag(trx, NOW, cfg, at("09:55"))).check.state).toBe("between");
      expect((await checkSyncLag(trx, NOW, cfg, at("09:50"))).check.state).toBe("firing");
      await setMailbox(trx, org.mailboxId, { last_synced_at: at("09:59") });
      expect((await checkSyncLag(trx, NOW, cfg, at("09:55"))).check.state).toBe("between");
    });
  });

  test("shows at most 5 mailbox ids, sorted (the oldest lag belongs to the largest id)", async () => {
    await inRollback(async (trx) => {
      const mailboxIds: string[] = [];
      for (let i = 0; i < 7; i += 1) mailboxIds.push((await orgWithMailbox(trx)).mailboxId);
      mailboxIds.sort();
      // The query orders by lag, oldest first: that is the reverse of the id order here.
      for (const [index, mailboxId] of mailboxIds.entries()) {
        await setMailbox(trx, mailboxId, { last_synced_at: new Date(at("09:00").getTime() - index * MINUTE_MS) });
      }
      const reading = await checkSyncLag(trx, NOW, cfg, STARTED);
      expect(reading.check.facts.mailboxes).toBe(7);
      expect(reading.ids).toEqual(mailboxIds.slice(0, 5));
    });
  });
});

// An organization with a linked chat since 2026-11-01 (before every mail of the tests).
async function urgentOrg(trx: Trx) {
  const org = await orgWithMailbox(trx);
  await linkChat(trx, { orgId: org.orgId }, org.userId, randomChatId(), at("08:00", "2026-11-01"));
  return org;
}

async function urgentMail(
  trx: Trx,
  org: { orgId: string; mailboxId: string },
  opts: { receivedAt: Date; triagedAt?: Date; sourceFolder?: string; subject?: string; from?: string }
): Promise<string> {
  const emailId = await insertTriaged(trx, { orgId: org.orgId }, org.mailboxId, {
    category: "urgent",
    createdAt: opts.triagedAt ?? opts.receivedAt,
    receivedAt: opts.receivedAt,
    subject: opts.subject ?? null,
    from: opts.from ?? null,
  });
  if (opts.sourceFolder !== undefined) {
    await trx.updateTable("emails").set({ source_folder: opts.sourceFolder }).where("id", "=", emailId).execute();
  }
  return emailId;
}

async function sentNotice(
  trx: Trx,
  org: { orgId: string; userId: string },
  emailId: string,
  sentAt: Date,
  opts: { kind?: string; status?: string; userId?: string; key?: string } = {}
) {
  await trx
    .insertInto("outbox")
    .values({
      org_id: org.orgId,
      user_id: opts.userId ?? org.userId,
      kind: opts.kind ?? "urgent",
      dedup_key: `${opts.kind ?? "urgent"}:${emailId}${opts.key === undefined ? "" : `:${opts.key}`}`,
      email_id: emailId,
      text: "Urgent",
      buttons: "[]",
      status: opts.status ?? "sent",
      created_at: sentAt,
      next_attempt_at: sentAt,
      sent_at: (opts.status ?? "sent") === "sent" ? sentAt : null,
    })
    .execute();
}

const urgent = (trx: Trx, now: Date = NOW, startedAt: Date = STARTED) =>
  checkUrgentLatency(trx, now, cfg, startedAt, noTestMail);

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

async function llmCalls(trx: Trx, org: { orgId: string; mailboxId: string }, outcomes: string[], time: Date) {
  for (const outcome of outcomes) {
    await recordLlmCall(
      trx,
      { orgId: org.orgId },
      {
        mailboxId: org.mailboxId,
        role: "classifier",
        promptVersion: "v1",
        model: "test-model",
        endpoint: "standard",
        provider: "openai" as const,
        outcome,
        tokensIn: null,
        tokensOut: null,
        latencyMs: 10,
        at: time,
      }
    );
  }
}

const okCalls = (count: number): string[] => Array.from({ length: count }, () => "ok");
const failCalls = (count: number): string[] => Array.from({ length: count }, () => "http_500");

describe("LLM errors", () => {
  test("10. 2 failed of 10 calls: firing; 3 of 4: clear (too few calls); 3 of 20: between", async () => {
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      await llmCalls(trx, org, [...okCalls(8), ...failCalls(2)], at("09:50"));
      const reading = await checkLlmErrors(trx, NOW, cfg);
      expect(reading.check).toEqual({
        kind: "slo_llm_errors",
        state: "firing",
        facts: { calls: 10, failed: 2, pct: 20, quota_orgs: 0 },
      });
      expect(reading.ids).toEqual([]);
    });
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      await llmCalls(trx, org, [...okCalls(1), ...failCalls(3)], at("09:50"));
      expect((await checkLlmErrors(trx, NOW, cfg)).check.state).toBe("clear");
    });
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      await llmCalls(trx, org, [...okCalls(17), ...failCalls(3)], at("09:50"));
      const reading = await checkLlmErrors(trx, NOW, cfg);
      expect(reading.check.state).toBe("between");
      expect(reading.check.facts.pct).toBe(15);
    });
  });

  test("10b. 10 percent (the clear percent) is between; 5 percent is clear", async () => {
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      await llmCalls(trx, org, [...okCalls(18), ...failCalls(2)], at("09:50"));
      expect((await checkLlmErrors(trx, NOW, cfg)).check.state).toBe("between");
    });
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      await llmCalls(trx, org, [...okCalls(19), ...failCalls(1)], at("09:50"));
      expect((await checkLlmErrors(trx, NOW, cfg)).check.state).toBe("clear");
    });
  });

  test("10c. calls before the window and calls of a suspended organization are not counted", async () => {
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      const other = await orgWithMailbox(trx);
      await llmCalls(trx, org, failCalls(10), at("09:29"));
      await llmCalls(trx, other, failCalls(10), at("09:50"));
      await suspendOrg(trx, other.orgId);
      // An audit row of another event is no call.
      await trx
        .insertInto("audit_log")
        .values({
          org_id: org.orgId,
          actor: "system",
          event: "email.triaged",
          reason_code: "x",
          created_at: at("09:50"),
        })
        .execute();
      const reading = await checkLlmErrors(trx, NOW, cfg);
      expect(reading.check.state).toBe("clear");
      expect(reading.check.facts.calls).toBe(0);
      await llmCalls(trx, org, okCalls(5), at("09:30"));
      expect((await checkLlmErrors(trx, NOW, cfg)).check.facts.calls).toBe(5);
    });
  });

  test("11. the newest call of one organization is a spent quota: firing, one quota organization", async () => {
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      const other = await orgWithMailbox(trx);
      await llmCalls(trx, other, ["http_429_quota"], at("07:00"));
      await llmCalls(trx, org, ["http_429_quota"], at("09:30"));
      const reading = await checkLlmErrors(trx, NOW, cfg);
      expect(reading.check.state).toBe("firing");
      expect(reading.check.facts.quota_orgs).toBe(1);
      expect(reading.ids).toEqual([org.orgId]);
    });
  });

  test("11b. a quota call of a suspended organization, or one followed by an ok call, is no quota pause", async () => {
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      const other = await orgWithMailbox(trx);
      await llmCalls(trx, other, ["http_429_quota"], at("09:30"));
      await suspendOrg(trx, other.orgId);
      await llmCalls(trx, org, ["http_429_quota"], at("09:30"));
      await llmCalls(trx, org, ["ok"], at("09:40"));
      const reading = await checkLlmErrors(trx, NOW, cfg);
      expect(reading.check.facts.quota_orgs).toBe(0);
      expect(reading.check.state).toBe("clear");
    });
  });
});

// With `user_quiet_hours` on, the wait leaves out the own quiet hours of the user of the notice.
// 2026-11-19 is CET (UTC+1): local time is UTC + 1 h.
describe("urgent latency with own quiet hours", () => {
  const LONG_NIGHT = { quiet_start: "21:00", quiet_end: "08:00" };
  const DAY_BEFORE = "2026-11-19";

  async function setHours(trx: Trx, orgId: string, userId: string, hours: typeof LONG_NIGHT | null) {
    await trx
      .updateTable("memberships")
      .set(hours ?? { quiet_start: null, quiet_end: null })
      .where("org_id", "=", orgId)
      .where("user_id", "=", userId)
      .execute();
  }

  async function flag(trx: Trx, org: { orgId: string; userId: string }, enabled: boolean) {
    await upsertOrgFeature(
      trx,
      { orgId: org.orgId },
      { flag: "user_quiet_hours", enabled, setBy: org.userId, setAt: NOW }
    );
  }

  // Urgent mail at 21:30 local (20:30Z the day before NOW), on an organization whose mailbox changed before it.
  async function lateMail(trx: Trx) {
    const org = await urgentOrg(trx);
    await setMailbox(trx, org.mailboxId, { status_changed_at: at("08:00", "2026-11-18") });
    const emailId = await urgentMail(trx, org, { receivedAt: at("20:30", DAY_BEFORE) });
    return { org, emailId };
  }

  const NOW_0730 = at("07:30", "2026-11-20");
  const started = at("00:00", DAY_BEFORE);
  const check = (trx: Trx) => checkUrgentLatency(trx, NOW_0730, cfg, started, noTestMail);

  test("6. hours 21:00–08:00 and a notice at 08:00 local: 0 minutes late, clear; the flag off: 90 minutes, firing", async () => {
    await inRollback(async (trx) => {
      const { org, emailId } = await lateMail(trx);
      await setHours(trx, org.orgId, org.userId, LONG_NIGHT);
      await sentNotice(trx, org, emailId, at("07:00", "2026-11-20"));
      await flag(trx, org, true);
      expect((await check(trx)).check).toEqual({
        kind: "slo_urgent_latency",
        state: "clear",
        facts: { mails: 0, max_wait_min: 0 },
      });
      await flag(trx, org, false);
      const off = await check(trx);
      expect(off.check.state).toBe("firing");
      expect(off.check.facts).toEqual({ mails: 1, max_wait_min: 90 });
    });
  });

  test("6b. two pending rows (users 21:00–08:00 and no quiet hours), no sent row, now 08:30 local: the larger wait counts", async () => {
    await inRollback(async (trx) => {
      const { org, emailId } = await lateMail(trx);
      await setHours(trx, org.orgId, org.userId, LONG_NIGHT);
      const otherId = await addMember(trx, org.orgId);
      // Equal times: this user has no quiet hours, so the whole wait counts. The user in quiet hours must not hide it.
      await setHours(trx, org.orgId, otherId, { quiet_start: "10:00", quiet_end: "10:00" });
      await flag(trx, org, true);
      await sentNotice(trx, org, emailId, at("20:31", DAY_BEFORE), { status: "pending" });
      await sentNotice(trx, org, emailId, at("20:31", DAY_BEFORE), {
        status: "pending",
        userId: otherId,
        key: "other",
      });
      const reading = await check(trx);
      // Own hours of the first user: 08:00 to 08:30 is 30 minutes. The second user has no quiet hours: 21:30 to 08:30 is 660.
      expect(reading.check.state).toBe("firing");
      expect(reading.check.facts).toEqual({ mails: 1, max_wait_min: 660 });
      // The flag off: both users have the default hours, 30 + 90 = 120.
      await flag(trx, org, false);
      expect((await check(trx)).check.facts).toEqual({ mails: 1, max_wait_min: 120 });
    });
  });

  test("6b2. a user in quiet hours alone does not raise an alarm; the user without quiet hours who waits does", async () => {
    await inRollback(async (trx) => {
      const { org, emailId } = await lateMail(trx);
      await setHours(trx, org.orgId, org.userId, LONG_NIGHT);
      await flag(trx, org, true);
      await sentNotice(trx, org, emailId, at("20:31", DAY_BEFORE), { status: "pending" });
      // Now 07:30Z is 08:30 local: 21:00–08:00 leaves 30 minutes, a firing wait over the 10 minute limit.
      expect((await check(trx)).check.facts).toEqual({ mails: 1, max_wait_min: 30 });
      // At 07:05Z (08:05 local) it leaves 5 minutes: clear.
      const early = await checkUrgentLatency(trx, at("07:05", "2026-11-20"), cfg, started, noTestMail);
      expect(early.check.state).toBe("clear");
    });
  });

  test("6c. the user of the sent row gives the hours, not another member's pending row", async () => {
    await inRollback(async (trx) => {
      const { org, emailId } = await lateMail(trx);
      const otherId = await addMember(trx, org.orgId);
      await setHours(trx, org.orgId, otherId, LONG_NIGHT);
      await flag(trx, org, true);
      // The owner (default hours) got the notice at 08:00 local; the other member has a pending row with long hours.
      await sentNotice(trx, org, emailId, at("07:00", "2026-11-20"));
      await sentNotice(trx, org, emailId, at("20:31", DAY_BEFORE), {
        status: "pending",
        userId: otherId,
        key: "other",
      });
      expect((await check(trx)).check.facts).toEqual({ mails: 1, max_wait_min: 90 });
    });
  });

  test("6d. no outbox row yet: the default hours count, also with the flag on", async () => {
    await inRollback(async (trx) => {
      const { org } = await lateMail(trx);
      await setHours(trx, org.orgId, org.userId, LONG_NIGHT);
      await flag(trx, org, true);
      expect((await check(trx)).check.facts).toEqual({ mails: 1, max_wait_min: 120 });
    });
  });

  test("6e. two sent notices of two users: the first sent one gives the hours, not the last", async () => {
    await inRollback(async (trx) => {
      const { org, emailId } = await lateMail(trx);
      const otherId = await addMember(trx, org.orgId);
      await setHours(trx, org.orgId, otherId, LONG_NIGHT);
      await flag(trx, org, true);
      // The owner (default hours) got the first notice at 08:00 local; the other member (21:00–08:00) got a later one.
      await sentNotice(trx, org, emailId, at("07:00", "2026-11-20"));
      await sentNotice(trx, org, emailId, at("07:20", "2026-11-20"), { userId: otherId, key: "other" });
      expect((await check(trx)).check.facts).toEqual({ mails: 1, max_wait_min: 90 });
    });
  });

  test("6f. a user of two organizations: the pending row takes the hours of its own organization only", async () => {
    await inRollback(async (trx) => {
      const { org, emailId } = await lateMail(trx);
      const elsewhere = await createOrgWithMailbox(trx);
      // The same user is a member of another organization with other hours (default).
      await trx
        .insertInto("memberships")
        .values({ org_id: elsewhere.orgId, user_id: org.userId, role: "assistant" })
        .execute();
      await setHours(trx, org.orgId, org.userId, LONG_NIGHT);
      await flag(trx, org, true);
      await sentNotice(trx, org, emailId, at("20:31", DAY_BEFORE), { status: "pending" });
      // Own hours of this organization: 30 minutes. A join that ignores the organization would add the default hours (120).
      expect((await check(trx)).check.facts).toEqual({ mails: 1, max_wait_min: 30 });
    });
  });

  test.each([true, false])(
    "6g. two organizations in one reading, the flag on in the %s one first: the flag of each counts for its own mail",
    async (onFirst) => {
      await inRollback(async (trx) => {
        const make = async (receivedAt: Date, on: boolean) => {
          const org = await urgentOrg(trx);
          await setMailbox(trx, org.mailboxId, { status_changed_at: at("08:00", "2026-11-18") });
          const emailId = await urgentMail(trx, org, { receivedAt });
          await setHours(trx, org.orgId, org.userId, LONG_NIGHT);
          await sentNotice(trx, org, emailId, at("07:00", "2026-11-20"));
          await flag(trx, org, on);
          return emailId;
        };
        // The mail that was received first is read first: its flag is the one that a leaking cache would copy.
        const first = await make(at("20:30", DAY_BEFORE), onFirst);
        const second = await make(at("20:31", DAY_BEFORE), !onFirst);
        const reading = await check(trx);
        // Flag on: own hours 21:00–08:00 leave 0 minutes. Flag off: the default hours leave a firing wait.
        expect(reading.ids).toEqual([onFirst ? second : first]);
        expect(reading.check.facts.mails).toBe(1);
      });
    }
  );

  test("6h. a database error of the flag read fails the reading; it is not a bad time zone", async () => {
    await inRollback(async (trx) => {
      const { org, emailId } = await lateMail(trx);
      await sentNotice(trx, org, emailId, at("07:00", "2026-11-20"));
      const flaky = new Proxy(trx, {
        get(target, property) {
          if (property === "selectFrom") {
            return (table: string) => {
              if (table === "org_features") throw new Error("database down");
              return (target.selectFrom as (t: string) => unknown)(table);
            };
          }
          const value: unknown = Reflect.get(target, property);
          return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      });
      const warnings: string[] = [];
      await expect(
        checkUrgentLatency(flaky, NOW_0730, cfg, started, noTestMail, { warn: (event) => void warnings.push(event) })
      ).rejects.toThrow("database down");
      expect(warnings).toEqual([]);
    });
  });
});
