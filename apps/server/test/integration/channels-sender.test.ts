import { encodeNoticeView, type NoticeView } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { ChannelError, createOutboxSender, insertOutbox, type OutboxKind } from "../../src/modules/channels";
import { createFakeChannel } from "../../src/modules/channels/fake/channel";
import { insertDigest } from "../../src/modules/reports";
import type { DB, TenantContext } from "../../src/platform/db";

import {
  addMember,
  createOrgWithMailbox,
  insertTestEmail,
  isolateChannels,
  linkChat,
  randomChatId,
  suspendOrg,
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
const MINUTE = 60_000;
const HOUR = 3_600_000;

let logLines: string[] = [];
let errorLines: string[] = [];
let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
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
});

function allLines(): string[] {
  return [...logLines, ...errorLines];
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
  opts: { kind?: OutboxKind; createdAt?: Date; nextAttemptAt?: Date; userId?: string; digestId?: string } = {}
): Promise<string> {
  counter += 1;
  const kind = opts.kind ?? "urgent";
  const id = await insertOutbox(trx, t.ctx, {
    userId: opts.userId ?? t.userId,
    kind,
    dedupKey: `sender:${counter}`,
    mailboxId: t.mailboxId,
    digestId: opts.digestId,
    // An `urgent` or approval row needs its e-mail (check constraint of the table).
    emailId:
      kind === "urgent" || kind === "approval" || kind === "approval_set"
        ? await insertTestEmail(trx, t.ctx, t.mailboxId)
        : undefined,
    message: { text: `${SECRET} ${counter}`, buttons: [[{ text: "OK", data: `ok:${counter}` }]] },
    view: {},
    locale: "en",
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

// A row that holds facts only (stage 05 makes the queue write these): the text and the buttons are cleared by hand.
async function addFactsRow(
  trx: Transaction<DB>,
  t: Tenant,
  opts: { subject?: string; locale?: "pl" | "en"; view?: Record<string, unknown> } = {}
): Promise<string> {
  const id = await addRow(trx, t, { kind: "urgent" });
  const { email_id: emailId } = await trx
    .selectFrom("outbox")
    .select("email_id")
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
  if (!emailId) throw new Error("no email id");
  const view: NoticeView<"urgent"> = {
    emailId,
    from: "boss@example.test",
    subject: opts.subject ?? "Contract",
    ai: { reasonCode: "llm", reason: "Deadline today" },
    receivedAt: new Date("2026-11-06T08:15:00Z"),
    synthetic: false,
    folderTag: null,
    actions: [],
    delegateNames: {},
    stayFolder: "INBOX",
    now: T,
    timeZone: "Europe/Warsaw",
  };
  await trx
    .updateTable("outbox")
    .set({
      text: null,
      buttons: "[]",
      view: JSON.stringify(opts.view ?? encodeNoticeView("urgent", view)),
      locale: opts.locale ?? "en",
    })
    .where("id", "=", id)
    .execute();
  return id;
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
      expect(s.channel.sent[0]?.message.text).toStartWith(SECRET);
      expect(s.channel.sent[0]?.message.buttons[0]?.[0]?.text).toBe("OK");
      const row = await rowState(trx, id);
      expect(row.status).toBe("sent");
      expect(Number(row.external_message_id)).toBe(1000);
      expect(allLines().some((line) => line.includes(SECRET))).toBe(false);
      await s.run(at(MINUTE));
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
        .set({ status: "sending", locked_at: at(-HOUR) })
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
      expect(await rowState(trx, stale)).toMatchObject({ status: "sending", locked_at: at(-HOUR) });
    });
  });

  test("a digest row marks its digest as sent", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const digestId = await insertDigest(trx, t.ctx, {
        userId: t.userId,
        slotKey: "2026-11-06T08:00",
        periodStart: at(-8 * HOUR),
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
      const due = await addRow(trx, t, { nextAttemptAt: at(5 * MINUTE) });
      await s.run(at(5 * MINUTE));
      expect(s.channel.sent).toHaveLength(0);
      expect((await rowState(trx, due)).status).toBe("pending");
      expect(errorLines.filter((line) => line.includes("401"))).toHaveLength(1);
      expect((await rowState(trx, id)).attempts).toBe(0);
      await s.run(at(11 * MINUTE));
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
      const id = await addRow(trx, t, { createdAt: at(-25 * HOUR) });
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
        .set({ status: "sending", locked_at: at(-6 * MINUTE) })
        .where("id", "=", id)
        .execute();
      const s = senderFor(trx);
      await s.run(T);
      expect((await rowState(trx, id)).status).toBe("sent");
      expect(errorLines.filter((line) => line.includes("sent again after a stale send"))).toHaveLength(1);
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
      expect(errorLines.filter((line) => line.includes("lost the claim after the send"))).toHaveLength(1);
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
      const id = await addFactsRow(trx, t, { subject: "MARKER-F088" });
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
      const id = await addFactsRow(trx, t, { view: {} });
      const s = senderFor(trx);
      await s.run(T);
      expect(s.channel.sent).toHaveLength(0);
      const row = await rowState(trx, id);
      expect(row.status).toBe("failed");
      expect(row.error_code).toBe("bad_view");
      expect(allLines().filter((line) => line.includes("bad view (urgent)") && line.includes(id))).toHaveLength(1);
    });
  });

  test("a row with a text is sent with its stored text and buttons", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t);
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
      const id = await addFactsRow(trx, t, { subject: "MARKER-F088" });
      await trx
        .updateTable("outbox")
        .set({ status: "sending", locked_at: at(-6 * MINUTE) })
        .where("id", "=", id)
        .execute();
      const s = senderFor(trx);
      await s.run(T);
      expect((await rowState(trx, id)).status).toBe("sent");
      expect(errorLines.filter((line) => line.includes("sent again after a stale send"))).toHaveLength(1);
      expect((await storedMessage(trx, id)).text).toBe(s.channel.sent[0]?.message.text ?? null);
    });
  });

  test("the pl row renders the same text as the en row (D16, until E7-T1)", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      await addFactsRow(trx, t, { locale: "pl" });
      await addFactsRow(trx, t, { locale: "en" });
      const s = senderFor(trx);
      await s.run(T);
      expect(s.channel.sent).toHaveLength(2);
      expect(s.channel.sent[0]?.message.text).toBe(s.channel.sent[1]?.message.text as string);
    });
  });

  test("the quiet hours hold a row without text; it is rendered after them", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const night = new Date("2026-11-06T21:30:00Z");
      const id = await addFactsRow(trx, t);
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
