import { format } from "node:util";

import { REPLY_CONSENT_SINCE, renderNotice } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { auditEvents, recordAudit } from "../../src/modules/audit";
import { createOutboxSender, detectNotices, scheduleDigests } from "../../src/modules/channels";
import { createFakeChannel } from "../../src/modules/channels/fake/channel";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { setDigestTimes, setOrgFeature, upsertOrgFeature } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";

import { addMember, isolateChannels, linkChat, randomChatId, renderedOf } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { markAnswered, sweepOrg, sweepReply, type SweepOrg } from "./reply-answered-fixtures";

// F115 stage 12, step 1: the notice `replies_ready`. Clock: 2026-11-20 10:00Z = 11:00 in Europe/Warsaw (CET).
const db = testDb();
const T = new Date("2026-11-20T10:00:00Z");
const MINUTE = 60_000;
const HOUR = 3_600_000;
const at = (offsetMs: number): Date => new Date(T.getTime() + offsetMs);

let errorLines: string[] = [];
let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  errorLines = [];
  logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
  errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errorLines.push(format(...args));
  });
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

afterAll(async () => {
  await db.destroy();
});

interface Team extends SweepOrg {
  memberId: string;
}

// The owner (and a member) are linked an hour before T. The org has the flag `reply_drafts` and a mailbox in `assist` with the switch on.
async function team(trx: Transaction<DB>, opts: { consent?: boolean } = {}): Promise<Team> {
  await isolateChannels(trx);
  const o = await sweepOrg(trx);
  const memberId = await addMember(trx, o.ctx.orgId);
  await linkChat(trx, o.ctx, o.userId, randomChatId(), at(-HOUR));
  await linkChat(trx, o.ctx, memberId, randomChatId(), at(-HOUR));
  if (opts.consent === true) await consent(trx, o, o.userId);
  return { ...o, memberId };
}

// The Telegram consent of the user covers reply data: the newest `web.telegram_consent` row holds the reply version.
async function consent(trx: Transaction<DB>, o: SweepOrg, userId: string): Promise<void> {
  await recordAudit(trx, o.ctx, {
    event: auditEvents.webTelegramConsent,
    actor: userId,
    data: { via: "web", version: REPLY_CONSENT_SINCE },
    at: at(-2 * HOUR),
  });
}

const run = (trx: Transaction<DB>, now: Date) =>
  detectNotices({ db: trx, now: () => now, startedAt: at(-HOUR), testMail: NO_TEST_SENDERS });

async function readyRows(trx: Transaction<DB>, o: SweepOrg) {
  return trx
    .selectFrom("outbox")
    .selectAll()
    .where("org_id", "=", o.ctx.orgId)
    .where("kind", "=", "replies_ready")
    .orderBy("created_at")
    .orderBy("user_id")
    .execute();
}

const countOf = (row: { view: unknown }): number => (row.view as { count: number }).count;

// A reply send whose draft was applied `createdAt` ago. `sweepReply` makes the pair (draft `applied`, send `awaiting_approval`).
const reply = (trx: Transaction<DB>, o: SweepOrg, createdAt: Date) => sweepReply(trx, o, { createdAt });

describe("replies_ready: who gets it, and the count", () => {
  test("1. two new drafts give one row for the owner with count 2; a member gets none; the counted sends are marked notified", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx, { consent: true });
      const a = await reply(trx, o, at(-30 * MINUTE));
      const b = await reply(trx, o, at(-20 * MINUTE));

      await run(trx, T);

      const rows = await readyRows(trx, o);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        user_id: o.userId,
        status: "pending",
        dedup_key: `replies_ready:${o.userId}:${a.sendId}`,
      });
      expect(countOf(rows[0] as { view: unknown })).toBe(2);
      const sends = await trx
        .selectFrom("actions")
        .select(["id", "notified_at"])
        .where("id", "in", [a.sendId, b.sendId])
        .execute();
      for (const send of sends) expect(send.notified_at?.getTime()).toBe(T.getTime());
      // The run again at the same time queues nothing new.
      await run(trx, T);
      expect(await readyRows(trx, o)).toHaveLength(1);
    });
  });

  test("1b. the owner with the reply consent gets the Review button; an owner without it gets the count, the consent line and no button", async () => {
    await withRollback(db, async (trx) => {
      const covered = await team(trx, { consent: true });
      await reply(trx, covered, at(-HOUR));
      await run(trx, T);
      const withReview = renderedOf((await readyRows(trx, covered))[0] as never);
      expect(withReview.buttons).toEqual([[{ text: "📝 Review", data: "rv" }]]);
      expect(withReview.text).not.toContain("Confirm the new Telegram terms");
    });
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      await reply(trx, o, at(-HOUR));
      await run(trx, T);
      const message = renderedOf((await readyRows(trx, o))[0] as never);
      expect(message.buttons).toEqual([]);
      expect(message.text).toContain("Confirm the new Telegram terms in the panel to review here.");
      // No text of the mail or draft, no address.
      expect(message.text).not.toContain("@");
      expect(message.text).not.toContain("Thank you");
    });
  });

  test("2. a third draft one hour later queues nothing; two hours and one minute after the first row it queues count 3", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx, { consent: true });
      await reply(trx, o, at(-30 * MINUTE));
      await reply(trx, o, at(-20 * MINUTE));
      await run(trx, T);
      expect(await readyRows(trx, o)).toHaveLength(1);
      // The first row goes out at once: from now on only the gap holds back the next row.
      await createOutboxSender({ db: trx, channel: createFakeChannel(), now: () => T }).run();
      expect((await readyRows(trx, o))[0]?.status).toBe("sent");

      const third = await reply(trx, o, at(HOUR));
      await run(trx, at(HOUR));
      expect(await readyRows(trx, o)).toHaveLength(1);
      // 1 h 59 min after the queue time of the first row: still no row.
      await run(trx, at(2 * HOUR - MINUTE));
      expect(await readyRows(trx, o)).toHaveLength(1);

      // 2 h 1 min after it: the row for the third draft, count 3 (the first two are still open).
      await run(trx, at(2 * HOUR + MINUTE));
      const rows = await readyRows(trx, o);
      expect(rows).toHaveLength(2);
      expect(rows.map(countOf)).toEqual([2, 3]);
      expect(rows[1]?.dedup_key).toBe(`replies_ready:${o.userId}:${third.sendId}`);
    });
  });

  test("2b. a draft of an answered mail is not counted; if it is the only new one, no row; a suspicious mail is left out too", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx, { consent: true });
      const answered = await reply(trx, o, at(-30 * MINUTE));
      await markAnswered(trx, o, answered.emailId);

      await run(trx, T);
      expect(await readyRows(trx, o)).toHaveLength(0);

      const open = await reply(trx, o, at(-20 * MINUTE));
      const flagged = await reply(trx, o, at(-10 * MINUTE));
      // The newest triage result of the mail decides: it names a reason.
      await trx
        .insertInto("triage_results")
        .values({
          org_id: o.ctx.orgId,
          email_id: flagged.emailId,
          category: "needs_reply",
          confidence: 0.9,
          reason_code: "direct_request",
          fields: "{}",
          suspicious_reasons: ["auth_fail"],
          created_at: at(-5 * MINUTE),
        })
        .execute();

      await run(trx, T);
      const rows = await readyRows(trx, o);
      expect(rows).toHaveLength(1);
      expect(countOf(rows[0] as { view: unknown })).toBe(1);
      expect(rows[0]?.dedup_key).toBe(`replies_ready:${o.userId}:${open.sendId}`);
    });
  });

  test("2c. the flag reply_drafts off: no row and the sends stay unnotified", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx, { consent: true });
      const pair = await reply(trx, o, at(-HOUR));
      await setOrgFeature(trx, o.ctx, { flag: "reply_drafts", enabled: false, actor: "cli", now: at(-HOUR) });

      await run(trx, T);

      expect(await readyRows(trx, o)).toHaveLength(0);
      const send = await trx
        .selectFrom("actions")
        .select("notified_at")
        .where("id", "=", pair.sendId)
        .executeTakeFirstOrThrow();
      expect(send.notified_at).toBeNull();
    });
  });

  test("2d. a notice that no sender took yet (quiet hours hold it) is not doubled, whatever the clock says", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx, { consent: true });
      await reply(trx, o, at(-HOUR));
      await run(trx, T);
      await reply(trx, o, at(3 * HOUR));
      await run(trx, at(3 * HOUR));
      expect(await readyRows(trx, o)).toHaveLength(1);
    });
  });

  test("2e. the panel link is in the view when WEB_BASE_URL is set and the flag approvals_page is on; else it is left out", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx, { consent: true });
      await reply(trx, o, at(-HOUR));
      const withBase = (now: Date) =>
        detectNotices({
          db: trx,
          now: () => now,
          startedAt: at(-HOUR),
          testMail: NO_TEST_SENDERS,
          webBaseUrl: "https://app.test/",
        });

      await withBase(T);
      expect((await readyRows(trx, o))[0]?.view).not.toHaveProperty("panelUrl");

      await trx
        .updateTable("outbox")
        .set({ status: "failed", error_code: "outdated" })
        .where("kind", "=", "replies_ready")
        .execute();
      await reply(trx, o, at(3 * HOUR));
      await upsertOrgFeature(trx, o.ctx, { flag: "approvals_page", enabled: true, setBy: "test", setAt: at(-HOUR) });
      await withBase(at(3 * HOUR));

      const rows = await readyRows(trx, o);
      expect((rows[1]?.view as { panelUrl?: string }).panelUrl).toBe("https://app.test/approvals");
      expect(renderedOf(rows[1] as never).text).toContain("Open in panel: https://app.test/approvals");
    });
  });
});

describe("replies_ready: the sender (quiet hours) and the text", () => {
  test("3. a draft at 23:00 org time: the row waits until 07:00 and goes out then", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx, { consent: true });
      const night = new Date("2026-11-20T22:00:00Z");
      await reply(trx, o, night);
      await run(trx, night);
      const channel = createFakeChannel();
      const sender = (when: Date) => createOutboxSender({ db: trx, channel, now: () => when }).run();

      await sender(night);

      const held = (await readyRows(trx, o))[0];
      expect(held?.status).toBe("pending");
      expect(held?.next_attempt_at.toISOString()).toBe("2026-11-21T06:00:00.000Z");
      expect(channel.sent).toHaveLength(0);

      await sender(new Date("2026-11-21T06:00:00Z"));

      expect((await readyRows(trx, o))[0]?.status).toBe("sent");
      // Other notices of the organization (a sync that is late) may go out too: look at the reply notice.
      const ready = channel.sent.filter((sent) => sent.message.text.startsWith("✍️"));
      expect(ready).toHaveLength(1);
      expect(ready[0]?.message.buttons).toEqual([[{ text: "📝 Review", data: "rv" }]]);
    });
  });

  test("4. render pl and en with count 1, 3 and 5 (the Polish plural forms)", async () => {
    const view = (count: number) => ({ count, now: T.toISOString(), timeZone: "Europe/Warsaw", review: true });
    const text = (locale: "pl" | "en", count: number) => {
      const rendered = renderNotice("replies_ready", view(count), { channel: "telegram", detail: "full", locale });
      if (!rendered.ok) throw new Error("does not render");
      return rendered.message.text;
    };
    expect([1, 3, 5].map((count) => text("en", count))).toEqual([
      "✍️ 1 reply draft is ready (11:00).",
      "✍️ 3 reply drafts are ready (11:00).",
      "✍️ 5 reply drafts are ready (11:00).",
    ]);
    expect([1, 3, 5].map((count) => text("pl", count))).toEqual([
      "✍️ Gotowy jest 1 szkic odpowiedzi (11:00).",
      "✍️ Gotowe są 3 szkice odpowiedzi (11:00).",
      "✍️ Gotowych jest 5 szkiców odpowiedzi (11:00).",
    ]);
  });
});

describe("the digest line (stage 12)", () => {
  test("a scheduled digest of an owner has one line with the count; a member has none", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx, { consent: true });
      await reply(trx, o, at(-HOUR));
      await reply(trx, o, at(-HOUR + MINUTE));
      // The slot 16:00 local (15:00Z) is after the link of both users (09:00Z).
      for (const userId of [o.userId, o.memberId]) await setDigestTimes(trx, o.ctx, userId, ["16:00"]);
      await scheduleDigests({ db: trx, now: () => new Date("2026-11-20T15:10:00Z"), testMail: NO_TEST_SENDERS });

      const digests = await trx
        .selectFrom("outbox")
        .selectAll()
        .where("org_id", "=", o.ctx.orgId)
        .where("kind", "=", "digest")
        .execute();
      const textOf = (userId: string) => {
        const row = digests.find((digest) => digest.user_id === userId);
        return row === undefined ? "" : renderedOf(row).text;
      };
      expect(textOf(o.userId)).toContain("📝 2 replies ready");
      expect(textOf(o.memberId)).not.toContain("📝");
    });
  });
});
