import { randomUUID } from "node:crypto";

import { renderDigestWithBrief, textsFor, MINUTE_MS, DAY_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  createOutboxSender,
  detectNotices,
  insertOutbox,
  queueTrustNotice,
  scheduleDigests,
} from "../../src/modules/channels";
import { createFakeChannel } from "../../src/modules/channels/fake/channel";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { insertDigest } from "../../src/modules/reports";
import { setDigestTimes, setMemberReportChannel, setOrgFeature } from "../../src/modules/tenancy";
import type { DB, TenantContext } from "../../src/platform/db";

import {
  addMember,
  createOrgWithMailbox,
  insertTriaged,
  isolateChannels,
  linkChat,
  randomChatId,
  suspendOrg,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { seedWeek } from "./metrics-fixtures";

// The report kinds (digest, weekly_report, trust_report_ready, autonomy_paused) also go by mail to a
// member whose report channel is `mail` or `both`; the Telegram sender never claims a mail row.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;
let warnSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
  errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
  warnSpy = spyOn(console, "warn").mockImplementation((): void => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  warnSpy.mockRestore();
});

// Europe/Warsaw is UTC+1 in November: the slot 08:00 is 07:00Z.
const LINKED = new Date("2026-11-05T20:00:00Z");
const SLOT_NOW = new Date("2026-11-06T07:00:00Z");
const SLOT_KEY = "2026-11-06T08:00";

async function reportMail(trx: Transaction<DB>, ctx: TenantContext, on: boolean): Promise<void> {
  await setOrgFeature(trx, ctx, { flag: "report_mail", enabled: on, actor: "cli", now: SLOT_NOW });
}

async function channelOf(
  trx: Transaction<DB>,
  ctx: TenantContext,
  userId: string,
  channel: "telegram" | "mail" | "both",
  mailboxId: string | null
): Promise<void> {
  await setMemberReportChannel(trx, ctx, userId, { channel, mailboxId });
}

// One organization with an owner: digest times 08:00 and 16:00, a membership that began at `LINKED`, a chat link on request.
async function org(
  trx: Transaction<DB>,
  opts: { chat: boolean; channel?: "telegram" | "mail" | "both"; flag?: boolean; mailbox?: boolean; keep?: boolean }
) {
  // `keep`: a second organization of one test keeps the chat links of the first.
  if (opts.keep !== true) await isolateChannels(trx);
  const created = await createOrgWithMailbox(trx);
  const ctx = { orgId: created.orgId };
  await setDigestTimes(trx, ctx, created.userId, ["08:00", "16:00"]);
  await trx
    .updateTable("memberships")
    .set({ created_at: LINKED })
    .where("org_id", "=", created.orgId)
    .where("user_id", "=", created.userId)
    .execute();
  if (opts.chat) await linkChat(trx, ctx, created.userId, randomChatId(), LINKED);
  await channelOf(
    trx,
    ctx,
    created.userId,
    opts.channel ?? "telegram",
    opts.mailbox === false ? null : created.mailboxId
  );
  if (opts.flag !== false) await reportMail(trx, ctx, true);
  return { ctx, orgId: created.orgId, ownerId: created.userId, mailboxId: created.mailboxId };
}

const rowsOf = (trx: Transaction<DB>, orgId: string, kind?: string) => {
  let query = trx
    .selectFrom("outbox")
    .select(["user_id", "kind", "dedup_key", "channel", "mailbox_id", "digest_id", "status", "view"])
    .where("org_id", "=", orgId)
    .orderBy("dedup_key");
  if (kind !== undefined) query = query.where("kind", "=", kind);
  return query.execute();
};

const digest = (trx: Transaction<DB>, now = SLOT_NOW) =>
  scheduleDigests({ db: trx, now: () => now, testMail: NO_TEST_SENDERS });

describe("digest rows by mail (steps 1, tests 1 to 3 and 6)", () => {
  test("1: a member with `both` gets one Telegram row and one mail row per slot, for one digest", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx, { chat: true, channel: "both" });
      await digest(trx);
      const rows = await rowsOf(trx, o.orgId);
      expect(rows.map((row) => [row.dedup_key, row.channel, row.mailbox_id])).toEqual([
        [`digest:${SLOT_KEY}`, "telegram", null],
        [`digest:${SLOT_KEY}:mail`, "mail", o.mailboxId],
      ]);
      const digests = await trx.selectFrom("digests").select("id").where("org_id", "=", o.orgId).execute();
      expect(digests).toHaveLength(1);
      const digestId = digests[0]?.id ?? "";
      expect(rows.map((row) => row.digest_id)).toEqual([digestId, digestId]);
      // The Telegram row also holds the counts of the minimal level; the rest of the two views is the same.
      const { minimal, ...telegramView } = rows[0]?.view as Record<string, unknown>;
      expect(minimal).toBeDefined();
      expect(telegramView).toEqual(rows[1]?.view as Record<string, unknown>);
      // A repeat adds nothing, and the next slot adds a pair.
      await digest(trx, new Date(SLOT_NOW.getTime() + MINUTE_MS));
      expect(await rowsOf(trx, o.orgId)).toHaveLength(2);
      await digest(trx, new Date("2026-11-06T15:00:00Z"));
      expect(await rowsOf(trx, o.orgId)).toHaveLength(4);
    });
  });

  test("2: a member with `mail` and no chat gets one mail row; the first digest looks back 24 h from now", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx, { chat: false, channel: "mail" });
      await digest(trx);
      const rows = await rowsOf(trx, o.orgId);
      expect(rows.map((row) => [row.dedup_key, row.channel, row.mailbox_id, row.status])).toEqual([
        [`digest:${SLOT_KEY}:mail`, "mail", o.mailboxId, "pending"],
      ]);
      const found = await trx
        .selectFrom("digests")
        .select(["slot_key", "period_start"])
        .where("org_id", "=", o.orgId)
        .execute();
      expect(found.map((row) => row.slot_key)).toEqual([SLOT_KEY]);
      expect(found[0]?.period_start.toISOString()).toBe(new Date(SLOT_NOW.getTime() - DAY_MS).toISOString());
    });
  });

  test("a mail member does not get a slot from before the membership began", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx, { chat: false, channel: "mail" });
      await trx
        .updateTable("memberships")
        .set({ created_at: new Date("2026-11-06T07:30:00Z") })
        .where("org_id", "=", o.orgId)
        .execute();
      await digest(trx);
      expect(await rowsOf(trx, o.orgId)).toHaveLength(0);
    });
  });

  test("3: a `telegram` member gets no mail row, also with a report mailbox stored", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx, { chat: true, channel: "telegram" });
      await trx
        .updateTable("memberships")
        .set({ report_mailbox_id: o.mailboxId })
        .where("org_id", "=", o.orgId)
        .execute();
      await digest(trx);
      expect((await rowsOf(trx, o.orgId)).map((row) => [row.dedup_key, row.channel])).toEqual([
        [`digest:${SLOT_KEY}`, "telegram"],
      ]);
    });
  });

  test("a member with `mail` and a chat gets the mail row only", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx, { chat: true, channel: "mail" });
      await digest(trx);
      expect((await rowsOf(trx, o.orgId)).map((row) => [row.dedup_key, row.channel])).toEqual([
        [`digest:${SLOT_KEY}:mail`, "mail"],
      ]);
    });
  });

  test("6: with the flag off, a `mail` member with a chat gets one Telegram row and a `mail` member with no chat gets none", async () => {
    await withRollback(db, async (trx) => {
      const withChat = await org(trx, { chat: true, channel: "mail", flag: false });
      const noChat = await createOrgWithMailbox(trx);
      await setDigestTimes(trx, { orgId: noChat.orgId }, noChat.userId, ["08:00"]);
      await channelOf(trx, { orgId: noChat.orgId }, noChat.userId, "both", noChat.mailboxId);
      await trx.updateTable("memberships").set({ created_at: LINKED }).where("org_id", "=", noChat.orgId).execute();
      await digest(trx);
      expect((await rowsOf(trx, withChat.orgId)).map((row) => [row.dedup_key, row.channel])).toEqual([
        [`digest:${SLOT_KEY}`, "telegram"],
      ]);
      expect(await rowsOf(trx, noChat.orgId)).toHaveLength(0);
    });
  });

  test("a `mail` member whose report mailbox is gone: no mail row; the chat gets the digest, no chat gets none", async () => {
    await withRollback(db, async (trx) => {
      const linked = await org(trx, { chat: true, channel: "mail", mailbox: false });
      const unlinked = await org(trx, { chat: false, channel: "mail", mailbox: false, keep: true });
      await digest(trx);
      expect((await rowsOf(trx, linked.orgId)).map((row) => [row.dedup_key, row.channel])).toEqual([
        [`digest:${SLOT_KEY}`, "telegram"],
      ]);
      expect(await rowsOf(trx, unlinked.orgId)).toHaveLength(0);
    });
  });

  test("a suspended organization gets no mail digest", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx, { chat: false, channel: "mail" });
      await suspendOrg(trx, o.orgId);
      await digest(trx);
      expect(await rowsOf(trx, o.orgId)).toHaveLength(0);
    });
  });

  test("the flag of one organization does not decide for another", async () => {
    await withRollback(db, async (trx) => {
      const on = await org(trx, { chat: false, channel: "mail" });
      const off = await org(trx, { chat: false, channel: "mail", flag: false, keep: true });
      await digest(trx);
      expect((await rowsOf(trx, on.orgId)).map((row) => row.channel)).toEqual(["mail"]);
      expect(await rowsOf(trx, off.orgId)).toHaveLength(0);
    });
  });
});

describe("the digest with the loop and spam review features off", () => {
  test("the Telegram row (text, buttons, view) equals the pure renderer fixture, with none of the keys of the three features; a mail row carries the same text", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx, { chat: true, channel: "both" });
      const box = await trx
        .selectFrom("mailboxes")
        .select(["id", "address", "status", "last_synced_at", "status_changed_at"])
        .where("id", "=", o.mailboxId)
        .executeTakeFirstOrThrow();
      await digest(trx);
      const fixture = renderDigestWithBrief(
        {
          kind: "scheduled",
          now: SLOT_NOW,
          timeZone: "Europe/Warsaw",
          slot: { date: "2026-11-06", time: "08:00", late: false },
          periodStart: new Date(LINKED.getTime() - DAY_MS),
          mailboxes: [
            {
              id: box.id,
              address: box.address,
              status: box.status as "active",
              lastSyncedAt: box.last_synced_at,
              statusChangedAt: box.status_changed_at,
              mode: "none",
            },
          ],
          counts: {},
          items: [],
          skippedTooOld: 0,
          skippedBacklog: 0,
          waiting: 0,
          delegations: { open: 0, overdue: 0 },
        },
        textsFor("en")
      );
      const rows = await rowsOf(trx, o.orgId);
      expect(rows.map((row) => row.channel)).toEqual(["telegram", "mail"]);
      for (const row of rows) {
        // Exactly these keys: no `loopIds`, no `lineOf`, nothing of the spam review line. The Telegram row also holds the counts of
        // the minimal level (as stored JSON: dates are strings); the mail row renders the full text only and holds none.
        const minimal = row.channel === "telegram" ? { minimal: JSON.parse(JSON.stringify(fixture.minimal)) } : {};
        const expected: Record<string, unknown> = {
          text: fixture.message.text,
          buttons: fixture.message.buttons,
          ...minimal,
        };
        expect(row.view as Record<string, unknown>).toEqual(expected);
      }
    });
  });

  test("with open_loops and spam_review_line on, a mail row never marks a loop: only the Telegram row builds the brief", async () => {
    await withRollback(db, async (trx) => {
      const mailOnly = await org(trx, { chat: false, channel: "mail" });
      for (const flag of ["open_loops", "spam_review_line"] as const) {
        await setOrgFeature(trx, mailOnly.ctx, { flag, enabled: true, actor: "cli", now: SLOT_NOW });
      }
      await digest(trx);
      const [row] = await rowsOf(trx, mailOnly.orgId);
      expect(row?.channel).toBe("mail");
      expect(Object.keys(row?.view as object).sort()).toEqual(["buttons", "text"]);
    });
  });
});

describe("trust notices by mail (step 1, test 4)", () => {
  const view = (mailboxId: string) => ({
    mailboxId,
    recommended: ["info" as const],
    blocked: 0,
    checked: 80,
    reportUrl: null,
  });
  const now = new Date("2026-11-15T10:00:00Z");

  test("4: an owner with `both` gets two rows; an owner with `mail` and no chat gets exactly one mail row", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx, { chat: true, channel: "both" });
      const mailOnly = await addMember(trx, o.orgId, "owner");
      await channelOf(trx, o.ctx, mailOnly, "mail", o.mailboxId);
      const input = { kind: "trust_report_ready" as const, view: view(o.mailboxId), mailboxId: o.mailboxId, now };
      expect(await queueTrustNotice(trx, o.ctx, input)).toBe(3);
      expect(await queueTrustNotice(trx, o.ctx, input)).toBe(0);
      const rows = await rowsOf(trx, o.orgId, "trust_report_ready");
      const own = rows.filter((row) => row.user_id === o.ownerId);
      expect(own.map((row) => [row.dedup_key, row.channel, row.mailbox_id])).toEqual([
        [`trust_report:${o.mailboxId}`, "telegram", o.mailboxId],
        [`trust_report:${o.mailboxId}:mail`, "mail", o.mailboxId],
      ]);
      expect(rows.filter((row) => row.user_id === mailOnly).map((row) => [row.dedup_key, row.channel])).toEqual([
        [`trust_report:${o.mailboxId}:mail`, "mail"],
      ]);
    });
  });

  test("a pause by mail: the mail row has its own key, one per trip", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx, { chat: false, channel: "mail" });
      const tripId = randomUUID();
      const input = {
        kind: "autonomy_paused" as const,
        view: {
          mailboxId: o.mailboxId,
          category: "info" as const,
          reason: "corrections" as const,
          corrections: 2,
          settingsUrl: null,
        },
        mailboxId: o.mailboxId,
        tripId,
        now,
      };
      expect(await queueTrustNotice(trx, o.ctx, input)).toBe(1);
      expect(await queueTrustNotice(trx, o.ctx, input)).toBe(0);
      expect((await rowsOf(trx, o.orgId)).map((row) => [row.dedup_key, row.channel])).toEqual([
        [`autonomy_paused:${tripId}:mail`, "mail"],
      ]);
    });
  });

  test("the mail row goes to the report mailbox of the member, not to the checked mailbox", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx, { chat: false, channel: "mail" });
      const other = randomUUID();
      await trx
        .insertInto("mailboxes")
        .columns(["id", "org_id", "address", "imap_host", "imap_port", "smtp_host", "smtp_port"])
        .values({
          id: other,
          org_id: o.orgId,
          address: `other-${other}@x.test`,
          imap_host: "imap.x.test",
          imap_port: 993,
          smtp_host: "smtp.x.test",
          smtp_port: 465,
        })
        .execute();
      await queueTrustNotice(trx, o.ctx, {
        kind: "trust_report_ready",
        view: view(other),
        mailboxId: other,
        now,
      });
      const [row] = await rowsOf(trx, o.orgId);
      expect(row).toMatchObject({ channel: "mail", mailbox_id: o.mailboxId });
      expect((row?.view as { mailboxId: string }).mailboxId).toBe(other);
    });
  });

  test("a member who is not an owner gets none, and the flag off gives Telegram rows only", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx, { chat: true, channel: "both", flag: false });
      const assistant = await addMember(trx, o.orgId, "assistant");
      await linkChat(trx, o.ctx, assistant, randomChatId(), LINKED);
      await channelOf(trx, o.ctx, assistant, "both", o.mailboxId);
      const mailOnly = await addMember(trx, o.orgId, "owner");
      await channelOf(trx, o.ctx, mailOnly, "mail", o.mailboxId);
      const queued = await queueTrustNotice(trx, o.ctx, {
        kind: "trust_report_ready",
        view: view(o.mailboxId),
        mailboxId: o.mailboxId,
        now,
      });
      expect(queued).toBe(1);
      expect((await rowsOf(trx, o.orgId)).map((row) => [row.user_id, row.channel])).toEqual([[o.ownerId, "telegram"]]);
    });
  });
});

describe("weekly report by mail (step 1)", () => {
  // Monday 2026-11-23, 09:00 Warsaw: the report is for the week of 2026-11-16.
  const MONDAY = new Date("2026-11-23T08:00:00Z");

  async function weekOrg(trx: Transaction<DB>) {
    await isolateChannels(trx);
    const { orgA } = await seedWeek(trx);
    const ctx = orgA.ctx;
    await setOrgFeature(trx, ctx, { flag: "weekly_report", enabled: true, actor: "cli", now: MONDAY });
    await trx.updateTable("memberships").set({ created_at: LINKED }).where("org_id", "=", ctx.orgId).execute();
    const both = orgA.ownerId;
    await setDigestTimes(trx, ctx, both, ["09:00"]);
    await linkChat(trx, ctx, both, randomChatId(), LINKED);
    await channelOf(trx, ctx, both, "both", orgA.mailboxId);
    const mailOnly = await addMember(trx, ctx.orgId, "assistant");
    await setDigestTimes(trx, ctx, mailOnly, ["09:00"]);
    await channelOf(trx, ctx, mailOnly, "mail", orgA.mailboxId);
    return { ctx, both, mailOnly, mailboxId: orgA.mailboxId };
  }

  const tick = (trx: Transaction<DB>) =>
    detectNotices({
      db: trx,
      now: () => MONDAY,
      startedAt: new Date(MONDAY.getTime() - DAY_MS),
      testMail: NO_TEST_SENDERS,
    });

  test("with the flag on: `both` gets two rows, `mail` with no chat gets one mail row, a repeat adds none", async () => {
    await withRollback(db, async (trx) => {
      const o = await weekOrg(trx);
      await reportMail(trx, o.ctx, true);
      await tick(trx);
      const rows = await rowsOf(trx, o.ctx.orgId, "weekly_report");
      const found = rows.map((row) => `${row.user_id === o.both ? "both" : "mail"} ${row.dedup_key} ${row.channel}`);
      expect(found.sort()).toEqual([
        "both weekly_report:2026-11-16 telegram",
        "both weekly_report:2026-11-16:mail mail",
        "mail weekly_report:2026-11-16:mail mail",
      ]);
      for (const row of rows.filter((r) => r.channel === "mail")) expect(row.mailbox_id).toBe(o.mailboxId);
      await tick(trx);
      expect(await rowsOf(trx, o.ctx.orgId, "weekly_report")).toHaveLength(3);
    });
  });

  test("with the flag off: the linked member gets the Telegram row, the mail member none", async () => {
    await withRollback(db, async (trx) => {
      const o = await weekOrg(trx);
      await tick(trx);
      expect((await rowsOf(trx, o.ctx.orgId, "weekly_report")).map((row) => [row.user_id, row.channel])).toEqual([
        [o.both, "telegram"],
      ]);
    });
  });

  test("an organization with a mail member and no chat at all is visited", async () => {
    await withRollback(db, async (trx) => {
      const o = await weekOrg(trx);
      await reportMail(trx, o.ctx, true);
      await trx.deleteFrom("chat_links").where("org_id", "=", o.ctx.orgId).execute();
      // An urgent mail has nobody to notify: the other detectors do not run (they read the link times of the members).
      await insertTriaged(trx, o.ctx, o.mailboxId, {
        category: "urgent",
        createdAt: new Date(MONDAY.getTime() - MINUTE_MS),
      });
      const urgentBefore = (await rowsOf(trx, o.ctx.orgId, "urgent")).length;
      await tick(trx);
      expect(await rowsOf(trx, o.ctx.orgId, "urgent")).toHaveLength(urgentBefore);
      const found = (await rowsOf(trx, o.ctx.orgId, "weekly_report")).map(
        (row) => `${row.user_id === o.both ? "both" : "mail"} ${row.channel}`
      );
      expect(found.sort()).toEqual(["both mail", "mail mail"]);
    });
  });
});

describe("urgent and the other kinds stay on Telegram (test 5)", () => {
  test("5: an urgent mail for a `both` member gives a Telegram row only", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx, { chat: true, channel: "both" });
      const now = new Date("2026-11-06T10:00:00Z");
      const emailId = await insertTriaged(trx, o.ctx, o.mailboxId, {
        category: "urgent",
        createdAt: new Date(now.getTime() - 10 * MINUTE_MS),
      });
      await trx
        .insertInto("actions")
        .values({
          org_id: o.orgId,
          email_id: emailId,
          type: "flag",
          status: "logged",
          payload: JSON.stringify({}),
          idempotency_key: `k-${emailId}`,
        })
        .execute();
      await detectNotices({
        db: trx,
        now: () => now,
        startedAt: new Date(now.getTime() - DAY_MS),
        testMail: NO_TEST_SENDERS,
      });
      expect((await rowsOf(trx, o.orgId, "urgent")).map((row) => [row.dedup_key, row.channel])).toEqual([
        [`urgent:${emailId}`, "telegram"],
      ]);
    });
  });
});

// The 24 h expiry of a mail row moved to the report mail sender: `channels-report-mail-append.test.ts` covers it.
describe("the Telegram sender and mail rows (step 2, test 7)", () => {
  const T = new Date("2026-11-06T10:00:00Z");

  async function mailRow(
    trx: Transaction<DB>,
    o: { ctx: TenantContext; ownerId: string; mailboxId: string },
    createdAt: Date
  ) {
    const id = await insertOutbox(trx, o.ctx, {
      userId: o.ownerId,
      kind: "weekly_report",
      dedupKey: `weekly_report:x-${randomUUID()}:mail`,
      mailboxId: o.mailboxId,
      view: {},
      locale: "en",
      channel: "mail",
      createdAt,
      nextAttemptAt: createdAt,
    });
    if (id === null) throw new Error("no mail row");
    return id;
  }

  const stateOf = (trx: Transaction<DB>, id: string) =>
    trx
      .selectFrom("outbox")
      .select(["status", "attempts", "locked_at", "error_code", "external_message_id", "channel"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();

  test("7: a pending mail row and a pending Telegram row: one Telegram send, the mail row untouched", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx, { chat: true, channel: "both" });
      const mail = await mailRow(trx, o, T);
      const digestId = await insertDigest(trx, o.ctx, {
        userId: o.ownerId,
        slotKey: "2026-11-06T08:00",
        periodStart: new Date(T.getTime() - DAY_MS),
        periodEnd: T,
      });
      const telegram = await insertOutbox(trx, o.ctx, {
        userId: o.ownerId,
        kind: "digest",
        dedupKey: "digest:x-telegram",
        mailboxId: o.mailboxId,
        digestId: digestId ?? undefined,
        view: { text: "digest text", buttons: [] },
        locale: "en",
        createdAt: T,
        nextAttemptAt: T,
      });
      const channel = createFakeChannel();
      await createOutboxSender({ db: trx, channel, now: () => T }).run();
      expect(channel.sent).toHaveLength(1);
      expect(await stateOf(trx, mail)).toEqual({
        status: "pending",
        attempts: 0,
        locked_at: null,
        error_code: null,
        external_message_id: null,
        channel: "mail",
      });
      expect((await stateOf(trx, telegram ?? "")).status).toBe("sent");
      // A later run sends nothing and leaves the mail row alone.
      await createOutboxSender({ db: trx, channel, now: () => new Date(T.getTime() + MINUTE_MS) }).run();
      expect(channel.sent).toHaveLength(1);
      expect((await stateOf(trx, mail)).status).toBe("pending");
    });
  });

  test("a mail row with no chat link is not failed as `no_chat`", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx, { chat: false, channel: "mail" });
      const mail = await mailRow(trx, o, T);
      const channel = createFakeChannel();
      await createOutboxSender({ db: trx, channel, now: () => T }).run();
      expect(channel.sent).toHaveLength(0);
      expect(await stateOf(trx, mail)).toMatchObject({ status: "pending", error_code: null });
    });
  });
});
