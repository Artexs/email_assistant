import { MINUTE_MS, HOUR_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { ChannelError, createOutboxSender, insertOutbox, type OutboxKind } from "../../src/modules/channels";
import { createFakeChannel } from "../../src/modules/channels/fake/channel";
import { insertDigest } from "../../src/modules/reports";
import { upsertOrgFeature } from "../../src/modules/tenancy";
import type { DB, Db, TenantContext } from "../../src/platform/db";
import { setLogFormat, setLogLevel } from "../../src/platform/log";

import {
  addMember,
  createOrgWithMailbox,
  insertTestEmail,
  isolateChannels,
  linkChat,
  randomChatId,
  suspendOrg,
  testNoticeView,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const T = new Date("2026-11-06T10:00:00Z");
const SECRET = "secret body text";

function at(offsetMs: number): Date {
  return new Date(T.getTime() + offsetMs);
}

const SECOND = 1000;

let logLines: string[] = [];
let errorLines: string[] = [];
let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  setLogFormat("json");
  logLines = [];
  errorLines = [];
  logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logLines.push(args.join(" "));
  });
  errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errorLines.push(args.join(" "));
  });
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  setLogFormat("text");
  setLogLevel("info");
});

function allLines(): string[] {
  return [...logLines, ...errorLines];
}

const BASE_KEYS = ["time", "level", "module", "event", "msg"];
const UUID_LOWER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// A fake bot token: it passes the value rule of the logger, so only a correct field list keeps it out of a line.
const CANARY = "123456:MARKER-TOKEN";

interface LoggedEvent {
  level: string;
  fields: Record<string, unknown>;
}

// The `channels` event lines of one name: the level and the fields after the base keys. A dropped field shows as
// `dropped_fields`, so an exact match on `fields` also proves that every value passed the logger.
function eventsOf(event: string): LoggedEvent[] {
  return allLines().flatMap((line) => {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (parsed.module !== "channels" || parsed.event !== event) return [];
    const fields = Object.fromEntries(Object.entries(parsed).filter(([key]) => !BASE_KEYS.includes(key)));
    const outboxId = fields.outbox_id;
    if (outboxId !== undefined) expect(outboxId).toMatch(UUID_LOWER);
    return [{ level: String(parsed.level), fields }];
  });
}

function expectEvent(event: string, level: string, fields: Record<string, unknown>): void {
  expect(eventsOf(event)).toEqual([{ level, fields }]);
}

interface Tenant {
  ctx: TenantContext;
  userId: string;
  mailboxId: string;
  chatId: number;
}

async function tenant(trx: Transaction<DB>): Promise<Tenant> {
  const created = await createOrgWithMailbox(trx);
  const ctx = { orgId: created.orgId };
  const chatId = randomChatId();
  await linkChat(trx, ctx, created.userId, chatId, T);
  return { ctx, userId: created.userId, mailboxId: created.mailboxId, chatId };
}

let counter = 0;

async function addRow(
  trx: Transaction<DB>,
  t: Tenant,
  opts: {
    kind?: OutboxKind;
    createdAt?: Date;
    nextAttemptAt?: Date;
    userId?: string;
    digestId?: string;
    marker?: string;
    locale?: "pl" | "en";
    view?: Record<string, unknown>;
  } = {}
): Promise<string> {
  counter += 1;
  const kind = opts.kind ?? "urgent";
  // An `urgent` or approval row needs its e-mail (check constraint of the table).
  const emailId =
    kind === "urgent" || kind === "approval" || kind === "approval_set"
      ? await insertTestEmail(trx, t.ctx, t.mailboxId)
      : undefined;
  const id = await insertOutbox(trx, t.ctx, {
    userId: opts.userId ?? t.userId,
    kind,
    dedupKey: `sender:${counter}`,
    mailboxId: t.mailboxId,
    digestId: opts.digestId,
    emailId,
    view:
      opts.view ??
      testNoticeView(kind as "urgent" | "digest" | "approval" | "approval_set", {
        marker: opts.marker ?? `${SECRET} ${counter}`,
        emailId,
        at: T,
      }),
    locale: opts.locale ?? "en",
    createdAt: opts.createdAt ?? T,
    nextAttemptAt: opts.nextAttemptAt ?? T,
  });
  if (!id) throw new Error("insert returned null");
  return id;
}

async function rowState(trx: Transaction<DB>, id: string) {
  return trx
    .selectFrom("outbox")
    .select(["status", "attempts", "next_attempt_at", "locked_at", "external_message_id", "error_code"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
}

async function storedMessage(trx: Transaction<DB>, id: string) {
  return trx.selectFrom("outbox").select(["text", "buttons"]).where("id", "=", id).executeTakeFirstOrThrow();
}

function senderFor(trx: Transaction<DB>, channel = createFakeChannel()) {
  let now = T;
  const sender = createOutboxSender({ db: trx, channel, now: () => now });
  return {
    channel,
    run: async (when: Date) => {
      now = when;
      await sender.run();
    },
  };
}

describe("outbox sender", () => {
  test("sends an urgent row once to the chat of the member", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t);
      const s = senderFor(trx);
      await s.run(T);
      expect(s.channel.sent).toHaveLength(1);
      expect(s.channel.sent[0]?.chatId).toBe(t.chatId);
      expect(s.channel.sent[0]?.message.text).toContain(SECRET);
      expect(s.channel.sent[0]?.message.buttons[0]?.[0]?.text).toBe("✅ Right");
      const row = await rowState(trx, id);
      expect(row.status).toBe("sent");
      expect(Number(row.external_message_id)).toBe(1000);
      expect(allLines().some((line) => line.includes(SECRET))).toBe(false);
      await s.run(at(MINUTE_MS));
      expect(s.channel.sent).toHaveLength(1);
    });
  });

  test("a suspended organization's rows wait, approval rows too; the active one is sent in the same run", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await tenant(trx);
      const b = await tenant(trx);
      const rowA = await addRow(trx, a);
      const waiting = [
        await addRow(trx, b),
        await addRow(trx, b, { kind: "approval" }),
        await addRow(trx, b, { kind: "approval_set" }),
      ];
      // A row that a crashed run left in `sending` is not taken back either.
      const stale = await addRow(trx, b);
      await trx
        .updateTable("outbox")
        .set({ status: "sending", locked_at: at(-HOUR_MS) })
        .where("id", "=", stale)
        .execute();
      await suspendOrg(trx, b.ctx.orgId);

      const s = senderFor(trx);
      await s.run(T);

      expect(s.channel.sent).toHaveLength(1);
      expect(s.channel.sent[0]?.chatId).toBe(a.chatId);
      expect((await rowState(trx, rowA)).status).toBe("sent");
      for (const id of waiting) {
        expect(await rowState(trx, id)).toMatchObject({ status: "pending", locked_at: null, attempts: 0 });
      }
      expect(await rowState(trx, stale)).toMatchObject({ status: "sending", locked_at: at(-HOUR_MS) });
    });
  });

  test("a digest row marks its digest as sent", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const digestId = await insertDigest(trx, t.ctx, {
        userId: t.userId,
        slotKey: "2026-11-06T08:00",
        periodStart: at(-8 * HOUR_MS),
        periodEnd: T,
      });
      if (!digestId) throw new Error("no digest");
      const id = await addRow(trx, t, { kind: "digest", digestId });
      const s = senderFor(trx);
      await s.run(T);
      expect((await rowState(trx, id)).status).toBe("sent");
      const digest = await trx
        .selectFrom("digests")
        .select("sent_at")
        .where("id", "=", digestId)
        .executeTakeFirstOrThrow();
      expect(digest.sent_at?.toISOString()).toBe(T.toISOString());
    });
  });

  test("a notice waits for the end of the quiet hours; a digest goes out", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const night = new Date("2026-11-06T21:30:00Z");
      const urgent = await addRow(trx, t, { kind: "urgent" });
      const digestId = await insertDigest(trx, t.ctx, {
        userId: t.userId,
        slotKey: "2026-11-06T22:00",
        periodStart: T,
        periodEnd: night,
      });
      if (!digestId) throw new Error("no digest");
      const digest = await addRow(trx, t, { kind: "digest", digestId });
      const s = senderFor(trx);
      await s.run(night);
      const urgentRow = await rowState(trx, urgent);
      expect(urgentRow.status).toBe("pending");
      expect(urgentRow.next_attempt_at.toISOString()).toBe("2026-11-07T06:00:00.000Z");
      expect(urgentRow.attempts).toBe(0);
      expect((await rowState(trx, digest)).status).toBe("sent");
      expect(s.channel.sent).toHaveLength(1);
    });
  });

  test("rate_limited pauses the sender and releases all claimed rows", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const ids = [
        await addRow(trx, t, { createdAt: at(-3 * SECOND) }),
        await addRow(trx, t, { createdAt: at(-2 * SECOND) }),
        await addRow(trx, t, { createdAt: at(-1 * SECOND) }),
      ];
      const s = senderFor(trx);
      s.channel.failWith(new ChannelError("rate_limited", "telegram_429", 7000), 1);
      await s.run(T);
      expect(s.channel.sent).toHaveLength(0);
      for (const id of ids) {
        const row = await rowState(trx, id);
        expect(row.status).toBe("pending");
        expect(row.attempts).toBe(0);
        expect(row.next_attempt_at.toISOString()).toBe(at(7 * SECOND).toISOString());
      }
      // The fixed `now` makes the wait exact: the old text printed seconds, the event holds milliseconds.
      expectEvent("outbox_rate_limited", "warn", { outbox_id: ids[0], wait_ms: 7000 });
      const due = await addRow(trx, t, { nextAttemptAt: at(1 * SECOND) });
      await s.run(at(1 * SECOND));
      expect(s.channel.sent).toHaveLength(0);
      expect((await rowState(trx, due)).status).toBe("pending");
      await s.run(at(8 * SECOND));
      await s.run(at(8 * SECOND));
      expect(s.channel.sent).toHaveLength(4);
    });
  });

  test("soft errors back off", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t);
      const s = senderFor(trx);
      s.channel.failWith(new ChannelError("soft", "telegram_502"));
      await s.run(T);
      let row = await rowState(trx, id);
      expect(row.status).toBe("pending");
      expect(row.attempts).toBe(1);
      expect(row.next_attempt_at.toISOString()).toBe(at(30 * SECOND).toISOString());
      await s.run(at(31 * SECOND));
      row = await rowState(trx, id);
      expect(row.attempts).toBe(2);
      expect(row.next_attempt_at.toISOString()).toBe(at(91 * SECOND).toISOString());
      expect(s.channel.sent).toHaveLength(0);
    });
  });

  test("config error pauses for 10 minutes and logs once", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t);
      const s = senderFor(trx);
      s.channel.failWith(new ChannelError("config", "telegram_401"), 1);
      await s.run(T);
      const due = await addRow(trx, t, { nextAttemptAt: at(5 * MINUTE_MS) });
      await s.run(at(5 * MINUTE_MS));
      expect(s.channel.sent).toHaveLength(0);
      expect((await rowState(trx, due)).status).toBe("pending");
      expectEvent("outbox_token_rejected", "error", { outbox_id: id });
      expect((await rowState(trx, id)).attempts).toBe(0);
      await s.run(at(11 * MINUTE_MS));
      expect(s.channel.sent).toHaveLength(2);
      expect((await rowState(trx, id)).status).toBe("sent");
    });
  });

  test("blocked fails the row and the run goes on", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const first = await addRow(trx, t, { createdAt: at(-2 * SECOND) });
      const second = await addRow(trx, t, { createdAt: at(-1 * SECOND) });
      const s = senderFor(trx);
      s.channel.failWith(new ChannelError("blocked", "telegram_403"), 1);
      await s.run(T);
      const row = await rowState(trx, first);
      expect(row.status).toBe("failed");
      expect(row.error_code).toBe("blocked");
      expect((await rowState(trx, second)).status).toBe("sent");
    });
  });

  test("bad_request fails the row", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t);
      const s = senderFor(trx);
      s.channel.failWith(new ChannelError("bad_request", "telegram_400"), 1);
      await s.run(T);
      const row = await rowState(trx, id);
      expect(row.status).toBe("failed");
      expect(row.error_code).toBe("bad_request");
    });
  });

  test("other errors count and fail the row at the fifth", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const last = await addRow(trx, t);
      await trx.updateTable("outbox").set({ attempts: 4 }).where("id", "=", last).execute();
      const s = senderFor(trx);
      s.channel.failWith(new ChannelError("other", "telegram_418"), 1);
      await s.run(T);
      const failed = await rowState(trx, last);
      expect(failed.status).toBe("failed");
      expect(failed.error_code).toBe("too_many_errors");

      const fresh = await addRow(trx, t);
      s.channel.failWith(new ChannelError("other", "telegram_418"), 1);
      await s.run(T);
      const row = await rowState(trx, fresh);
      expect(row.status).toBe("pending");
      expect(row.attempts).toBe(1);
    });
  });

  test("a row older than 24 hours expires", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t, { createdAt: at(-25 * HOUR_MS) });
      const s = senderFor(trx);
      await s.run(T);
      const row = await rowState(trx, id);
      expect(row.status).toBe("failed");
      expect(row.error_code).toBe("expired");
      expect(s.channel.sent).toHaveLength(0);
    });
  });

  test("a member without a chat link fails with no_chat", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const other = await addMember(trx, t.ctx.orgId);
      const id = await addRow(trx, t, { userId: other });
      const s = senderFor(trx);
      await s.run(T);
      const row = await rowState(trx, id);
      expect(row.status).toBe("failed");
      expect(row.error_code).toBe("no_chat");
    });
  });

  test("a member gets at most 3 messages per run", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const ids: string[] = [];
      for (let i = 0; i < 5; i += 1) ids.push(await addRow(trx, t, { createdAt: at((i - 10) * SECOND) }));
      const s = senderFor(trx);
      await s.run(T);
      expect(s.channel.sent).toHaveLength(3);
      for (const id of ids.slice(3)) {
        const row = await rowState(trx, id);
        expect(row.status).toBe("pending");
        expect(row.attempts).toBe(0);
      }
      await s.run(T);
      expect(s.channel.sent).toHaveLength(5);
    });
  });

  test("a stale sending row is sent again with a warning", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t);
      await trx
        .updateTable("outbox")
        .set({ status: "sending", locked_at: at(-6 * MINUTE_MS) })
        .where("id", "=", id)
        .execute();
      const s = senderFor(trx);
      await s.run(T);
      expect((await rowState(trx, id)).status).toBe("sent");
      expectEvent("outbox_resent_after_stale", "warn", { outbox_id: id });
    });
  });

  test("rows of two organizations go to their own chats", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await tenant(trx);
      const b = await tenant(trx);
      await addRow(trx, a);
      await addRow(trx, b);
      const s = senderFor(trx);
      await s.run(T);
      expect(s.channel.sent.map((item) => item.chatId).sort()).toEqual([a.chatId, b.chatId].sort());
    });
  });

  test("a lost claim after the send gives a warning and the run goes on", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const first = await addRow(trx, t, { createdAt: at(-2 * SECOND) });
      const second = await addRow(trx, t, { createdAt: at(-1 * SECOND) });
      const s = senderFor(trx);
      let calls = 0;
      s.channel.onSend = async () => {
        calls += 1;
        if (calls === 1) {
          await trx
            .updateTable("outbox")
            .set({ locked_at: at(1 * SECOND) })
            .where("id", "=", first)
            .execute();
        }
      };
      await s.run(T);
      expectEvent("outbox_claim_lost", "warn", { outbox_id: first });
      expect((await rowState(trx, first)).status).toBe("sending");
      expect((await rowState(trx, second)).status).toBe("sent");
    });
  });
});

describe("outbox sender, rows without text (F088)", () => {
  test("renders the row from its view; the stored text is the sent text; the log has no mail text", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t, { marker: "MARKER-F088" });
      const s = senderFor(trx);
      await s.run(T);
      expect(s.channel.sent).toHaveLength(1);
      const message = s.channel.sent[0]?.message;
      expect(message?.text).toContain("MARKER-F088");
      expect((await rowState(trx, id)).status).toBe("sent");
      const stored = await storedMessage(trx, id);
      expect(stored.text).toBe(message?.text ?? null);
      expect(stored.buttons as unknown).toEqual(message?.buttons ?? []);
      expect(allLines().some((line) => line.includes("MARKER-F088"))).toBe(false);
    });
  });

  test("a view the renderer rejects fails as bad_view and logs ids only", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t, { view: {} });
      const s = senderFor(trx);
      await s.run(T);
      expect(s.channel.sent).toHaveLength(0);
      const row = await rowState(trx, id);
      expect(row.status).toBe("failed");
      expect(row.error_code).toBe("bad_view");
      expectEvent("outbox_bad_view", "error", { outbox_id: id, kind: "urgent" });
    });
  });

  test("a row with a text is sent with its stored text and buttons", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t, { view: {} });
      // A row from before the migration: the text is stored, the view is empty.
      await trx
        .updateTable("outbox")
        .set({ text: `${SECRET} old`, buttons: JSON.stringify([[{ text: "OK", data: "ok:old" }]]) })
        .where("id", "=", id)
        .execute();
      const before = await storedMessage(trx, id);
      const s = senderFor(trx);
      await s.run(T);
      expect(s.channel.sent[0]?.message).toEqual({ text: before.text as string, buttons: before.buttons as never });
      expect(await storedMessage(trx, id)).toEqual(before);
    });
  });

  test("a stale sending row without text is rendered and sent again with a warning", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t, { marker: "MARKER-F088" });
      await trx
        .updateTable("outbox")
        .set({ status: "sending", locked_at: at(-6 * MINUTE_MS) })
        .where("id", "=", id)
        .execute();
      const s = senderFor(trx);
      await s.run(T);
      expect((await rowState(trx, id)).status).toBe("sent");
      expectEvent("outbox_resent_after_stale", "warn", { outbox_id: id });
      expect((await storedMessage(trx, id)).text).toBe(s.channel.sent[0]?.message.text ?? null);
    });
  });

  test("the pl row renders Polish text and the en row English text", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      await addRow(trx, t, { locale: "pl", marker: "same" });
      await addRow(trx, t, { locale: "en", marker: "same" });
      const s = senderFor(trx);
      await s.run(T);
      expect(s.channel.sent).toHaveLength(2);
      // The claim order of two rows with one creation time is not fixed: match each text by its title.
      const texts = s.channel.sent.map((sent) => sent.message.text);
      expect(texts.filter((text) => text.startsWith("🔴 Pilna wiadomość"))).toHaveLength(1);
      expect(texts.filter((text) => text.startsWith("🔴 Urgent mail"))).toHaveLength(1);
    });
  });

  test("the quiet hours hold a row without text; it is rendered after them", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const night = new Date("2026-11-06T21:30:00Z");
      const id = await addRow(trx, t);
      const s = senderFor(trx);
      await s.run(night);
      const held = await rowState(trx, id);
      expect(held.status).toBe("pending");
      expect(held.next_attempt_at.toISOString()).toBe("2026-11-07T06:00:00.000Z");
      expect((await storedMessage(trx, id)).text).toBeNull();
      expect(s.channel.sent).toHaveLength(0);
      await s.run(new Date("2026-11-07T06:00:00Z"));
      expect((await rowState(trx, id)).status).toBe("sent");
      expect(s.channel.sent).toHaveLength(1);
      expect((await storedMessage(trx, id)).text).toBe(s.channel.sent[0]?.message.text ?? null);
    });
  });
});

describe("outbox sender log events", () => {
  test("a sent row writes outbox_sent with its kind", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t);
      await senderFor(trx).run(T);
      expectEvent("outbox_sent", "info", { outbox_id: id, kind: "urgent" });
    });
  });

  test("an expired row writes outbox_expired", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t, { createdAt: at(-25 * HOUR_MS) });
      await senderFor(trx).run(T);
      expectEvent("outbox_expired", "warn", { outbox_id: id });
    });
  });

  test("a member without a chat writes outbox_no_chat", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const other = await addMember(trx, t.ctx.orgId);
      const id = await addRow(trx, t, { userId: other });
      await senderFor(trx).run(T);
      expectEvent("outbox_no_chat", "warn", { outbox_id: id });
    });
  });

  test("a blocked bot writes outbox_bot_blocked", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t);
      const s = senderFor(trx);
      s.channel.failWith(new ChannelError("blocked", "telegram_403"), 1);
      await s.run(T);
      expectEvent("outbox_bot_blocked", "warn", { outbox_id: id });
    });
  });

  test("a refused message writes outbox_refused with the code", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t);
      const s = senderFor(trx);
      s.channel.failWith(new ChannelError("bad_request", "telegram_400"), 1);
      await s.run(T);
      expectEvent("outbox_refused", "error", { outbox_id: id, code: "telegram_400" });
    });
  });

  test("another channel error writes outbox_failed with the code", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t);
      const s = senderFor(trx);
      s.channel.failWith(new ChannelError("other", "telegram_418"), 1);
      await s.run(T);
      expectEvent("outbox_failed", "error", { outbox_id: id, code: "telegram_418" });
    });
  });

  test("a soft error writes outbox_paused with the code and the wait in milliseconds", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t);
      const s = senderFor(trx);
      s.channel.failWith(new ChannelError("soft", "telegram_502"), 1);
      await s.run(T);
      expectEvent("outbox_paused", "warn", { outbox_id: id, code: "telegram_502", wait_ms: 30_000 });
    });
  });

  test("a failure that is no channel error writes outbox_failed with the error name and code, never its message", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t);
      const s = senderFor(trx);
      s.channel.onSend = () => Promise.reject(Object.assign(new Error(CANARY), { code: "ECONNRESET" }));
      await s.run(T);
      expectEvent("outbox_failed", "error", { outbox_id: id, error: "Error", error_code: "ECONNRESET" });
      expect(allLines().some((line) => line.includes("MARKER"))).toBe(false);
    });
  });

  test("a failure with a value-rule-safe description writes no description", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t);
      const s = senderFor(trx);
      s.channel.onSend = () => Promise.reject(Object.assign(new Error("x"), { description: "MARKER-DESC" }));
      await s.run(T);
      expectEvent("outbox_failed", "error", { outbox_id: id, error: "Error" });
      expect(allLines().some((line) => line.includes("MARKER"))).toBe(false);
    });
  });

  test("a failed claim writes outbox_claim_failed with the error name only", async () => {
    const broken = new Proxy(
      {},
      {
        get() {
          throw new Error(CANARY);
        },
      }
    ) as unknown as Db;
    const sender = createOutboxSender({ db: broken, channel: createFakeChannel(), now: () => T });
    await sender.run();
    expectEvent("outbox_claim_failed", "error", { error: "Error" });
    expect(allLines().some((line) => line.includes("MARKER"))).toBe(false);
  });

  test("a failed database call writes outbox_db_failed with the row id and the error name only", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t);
      // The claim reads through `with`; only the later release (`updateTable`) fails.
      const flaky = new Proxy(trx, {
        get(target, property) {
          if (property === "updateTable") throw new Error(CANARY);
          const value: unknown = Reflect.get(target, property);
          return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      });
      const channel = createFakeChannel();
      channel.failWith(new ChannelError("soft", "telegram_502"), 1);
      await createOutboxSender({ db: flaky, channel, now: () => T }).run();
      expectEvent("outbox_db_failed", "error", { outbox_id: id, error: "Error" });
      expect(allLines().some((line) => line.includes("MARKER"))).toBe(false);
    });
  });
});

// The quiet hours of each member. 2026-11-06 is CET (UTC+1): local time is UTC + 1 h.
describe("outbox sender: own quiet hours", () => {
  const LOCAL_2230 = new Date("2026-11-06T21:30:00Z");
  const LOCAL_1200 = new Date("2026-11-06T11:00:00Z");

  async function setHours(trx: Transaction<DB>, t: Tenant, userId: string, start: string | null, end: string | null) {
    await trx
      .updateTable("memberships")
      .set({ quiet_start: start, quiet_end: end })
      .where("org_id", "=", t.ctx.orgId)
      .where("user_id", "=", userId)
      .execute();
  }

  async function flagOn(trx: Transaction<DB>, t: Tenant, enabled = true) {
    await upsertOrgFeature(trx, t.ctx, { flag: "user_quiet_hours", enabled, setBy: t.userId, setAt: T });
  }

  // The owner has the hours 23:00–06:00; a second member has none of their own.
  async function twoMembers(trx: Transaction<DB>) {
    await isolateChannels(trx);
    const t = await tenant(trx);
    const otherId = await addMember(trx, t.ctx.orgId);
    await linkChat(trx, t.ctx, otherId, randomChatId(), T);
    await setHours(trx, t, t.userId, "23:00", "06:00");
    return { t, otherId };
  }

  test("5. at 22:30 the member with 23:00–06:00 gets the urgent row; the member with the default waits until 07:00", async () => {
    await withRollback(db, async (trx) => {
      const { t, otherId } = await twoMembers(trx);
      await flagOn(trx, t);
      const own = await addRow(trx, t, { userId: t.userId });
      const other = await addRow(trx, t, { userId: otherId });
      const s = senderFor(trx);
      await s.run(LOCAL_2230);
      expect((await rowState(trx, own)).status).toBe("sent");
      const waiting = await rowState(trx, other);
      expect(waiting.status).toBe("pending");
      expect(waiting.next_attempt_at.toISOString()).toBe("2026-11-07T06:00:00.000Z");
      expect(s.channel.sent).toHaveLength(1);
      expect(s.channel.sent[0]?.chatId).toBe(t.chatId);
    });
  });

  test("a row waits until the end of the own hours, not of the default ones (day hours 09:00–17:00)", async () => {
    await withRollback(db, async (trx) => {
      const { t, otherId } = await twoMembers(trx);
      await flagOn(trx, t);
      await setHours(trx, t, t.userId, "09:00", "17:00");
      const own = await addRow(trx, t, { userId: t.userId });
      const other = await addRow(trx, t, { userId: otherId });
      const s = senderFor(trx);
      await s.run(LOCAL_1200);
      const held = await rowState(trx, own);
      expect(held.status).toBe("pending");
      expect(held.next_attempt_at.toISOString()).toBe("2026-11-06T16:00:00.000Z");
      expect((await rowState(trx, other)).status).toBe("sent");
    });
  });

  test("equal start and end: no quiet hours, a notice goes out at 03:00 local", async () => {
    await withRollback(db, async (trx) => {
      const { t, otherId } = await twoMembers(trx);
      await flagOn(trx, t);
      await setHours(trx, t, otherId, "10:00", "10:00");
      const night = new Date("2026-11-06T02:00:00Z");
      const earlier = new Date(night.getTime() - HOUR_MS);
      const row = await addRow(trx, t, { userId: otherId, createdAt: earlier, nextAttemptAt: earlier });
      const s = senderFor(trx);
      await s.run(night);
      expect((await rowState(trx, row)).status).toBe("sent");
    });
  });

  test("the flag off: every member has the default hours, own hours are ignored", async () => {
    await withRollback(db, async (trx) => {
      const { t } = await twoMembers(trx);
      await flagOn(trx, t, false);
      const own = await addRow(trx, t, { userId: t.userId });
      const s = senderFor(trx);
      await s.run(LOCAL_2230);
      const held = await rowState(trx, own);
      expect(held.status).toBe("pending");
      expect(held.next_attempt_at.toISOString()).toBe("2026-11-07T06:00:00.000Z");
    });
  });

  test("a digest is not held by the own hours; an own-hours member's row inside them waits", async () => {
    await withRollback(db, async (trx) => {
      const { t } = await twoMembers(trx);
      await flagOn(trx, t);
      const inside = new Date("2026-11-06T22:30:00Z"); // 23:30 local: inside 23:00–06:00
      const digestId = await insertDigest(trx, t.ctx, {
        userId: t.userId,
        slotKey: "2026-11-06T23:30",
        periodStart: T,
        periodEnd: inside,
      });
      if (!digestId) throw new Error("no digest");
      const digest = await addRow(trx, t, { kind: "digest", digestId });
      const urgent = await addRow(trx, t);
      await senderFor(trx).run(inside);
      expect((await rowState(trx, digest)).status).toBe("sent");
      const held = await rowState(trx, urgent);
      expect(held.status).toBe("pending");
      expect(held.next_attempt_at.toISOString()).toBe("2026-11-07T05:00:00.000Z");
    });
  });

  test("one query reads the hours of the whole batch, not one per row", async () => {
    await withRollback(db, async (trx) => {
      const { t, otherId } = await twoMembers(trx);
      await flagOn(trx, t);
      for (let i = 0; i < 4; i += 1) await addRow(trx, t, { userId: i % 2 === 0 ? t.userId : otherId });
      let reads = 0;
      const counting = trx.withPlugin({
        transformQuery: ({ node }) => {
          if (node.kind === "SelectQueryNode" && JSON.stringify(node).includes('"quiet_start"')) reads += 1;
          return node;
        },
        transformResult: async ({ result }) => result,
      });
      await createOutboxSender({ db: counting, channel: createFakeChannel(), now: () => LOCAL_2230 }).run();
      expect(reads).toBe(1);
    });
  });

  // Review fix: a hold never ends in the past.
  test("an end time in the New York spring gap: the row waits until the change (07:00Z), not a past time; each tick keeps it", async () => {
    await withRollback(db, async (trx) => {
      const { t } = await twoMembers(trx);
      await trx
        .updateTable("organizations")
        .set({ timezone: "America/New_York" })
        .where("id", "=", t.ctx.orgId)
        .execute();
      await flagOn(trx, t);
      await setHours(trx, t, t.userId, "00:00", "02:00");
      const first = new Date("2026-03-08T06:05:00Z"); // 01:05 EST
      const row = await addRow(trx, t, {
        userId: t.userId,
        createdAt: new Date(first.getTime() - HOUR_MS),
        nextAttemptAt: new Date(first.getTime() - HOUR_MS),
      });
      const s = senderFor(trx);
      for (const minutes of [0, 1, 2]) {
        await s.run(new Date(first.getTime() + minutes * MINUTE_MS));
        const held = await rowState(trx, row);
        expect(held.status).toBe("pending");
        expect(held.next_attempt_at.toISOString()).toBe("2026-03-08T07:00:00.000Z");
      }
      expect(s.channel.sent).toHaveLength(0);
    });
  });

  test("a row is never put back with a time less than one minute ahead", async () => {
    await withRollback(db, async (trx) => {
      const { t } = await twoMembers(trx);
      await flagOn(trx, t);
      // Own hours 23:00–06:00; now is 05:59:30 local (04:59:30Z): the hours end in 30 seconds.
      const now = new Date("2026-11-07T04:59:30Z");
      const row = await addRow(trx, t, {
        userId: t.userId,
        createdAt: new Date(now.getTime() - HOUR_MS),
        nextAttemptAt: new Date(now.getTime() - HOUR_MS),
      });
      await senderFor(trx).run(now);
      const held = await rowState(trx, row);
      expect(held.status).toBe("pending");
      expect(held.next_attempt_at.toISOString()).toBe("2026-11-07T05:00:30.000Z");
    });
  });

  // A flag must never leak from one organization to another (the cache is per organization).
  test.each([true, false])(
    "two organizations in one batch, the flag on in the %s one first: each keeps its own flag",
    async (onFirst) => {
      await withRollback(db, async (trx) => {
        await isolateChannels(trx);
        const first = await tenant(trx);
        const second = await tenant(trx);
        for (const [t, on] of [
          [first, onFirst],
          [second, !onFirst],
        ] as const) {
          await setHours(trx, t, t.userId, "23:00", "06:00");
          await flagOn(trx, t, on);
        }
        const rowFirst = await addRow(trx, first, {
          createdAt: new Date(LOCAL_2230.getTime() - 3 * SECOND),
          nextAttemptAt: new Date(LOCAL_2230.getTime() - HOUR_MS),
        });
        const rowSecond = await addRow(trx, second, {
          createdAt: new Date(LOCAL_2230.getTime() - 2 * SECOND),
          nextAttemptAt: new Date(LOCAL_2230.getTime() - HOUR_MS),
        });
        await senderFor(trx).run(LOCAL_2230);
        // 22:30 local: own hours 23:00–06:00 let the row go; the default hours hold it.
        expect((await rowState(trx, rowFirst)).status).toBe(onFirst ? "sent" : "pending");
        expect((await rowState(trx, rowSecond)).status).toBe(onFirst ? "pending" : "sent");
      });
    }
  );

  test("a user in two organizations has the hours of the organization of the row", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await tenant(trx);
      const b = await tenant(trx);
      // The user of `a` is a member of `b` too, with other hours; both organizations have the flag on.
      await trx
        .insertInto("memberships")
        .values({ org_id: b.ctx.orgId, user_id: a.userId, role: "assistant" })
        .execute();
      await trx
        .insertInto("chat_links")
        .values({
          org_id: b.ctx.orgId,
          user_id: a.userId,
          channel: "telegram",
          external_chat_id: randomChatId(),
          linked_at: T,
        })
        .execute();
      await flagOn(trx, a);
      await flagOn(trx, b);
      await setHours(trx, a, a.userId, "23:00", "06:00");
      await setHours(trx, b, a.userId, "08:00", "09:00");
      const rowA = await addRow(trx, a, {
        userId: a.userId,
        createdAt: new Date(LOCAL_2230.getTime() - HOUR_MS),
        nextAttemptAt: new Date(LOCAL_2230.getTime() - HOUR_MS),
      });
      await senderFor(trx).run(LOCAL_2230);
      // Hours of `a` (23:00–06:00) at 22:30: not quiet. The hours of `b` (08:00–09:00) would not hold it either, so use 23:30.
      expect((await rowState(trx, rowA)).status).toBe("sent");
      const later = new Date("2026-11-06T22:30:00Z"); // 23:30 local
      const rowA2 = await addRow(trx, a, {
        userId: a.userId,
        createdAt: new Date(later.getTime() - HOUR_MS),
        nextAttemptAt: new Date(later.getTime() - HOUR_MS),
      });
      await senderFor(trx).run(later);
      // Inside the hours of `a`: held, whatever the hours of `b` say.
      expect((await rowState(trx, rowA2)).status).toBe("pending");
    });
  });
});
