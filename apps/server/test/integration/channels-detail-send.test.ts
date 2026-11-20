// The detail level of a Telegram message is chosen at send time: the flag `telegram_minimal`, the lock of the organization and the
// level of the member decide (`effectiveDetail`), and the sender writes the level of the send to `outbox.detail`. Every test runs
// in a transaction that is rolled back.
import { randomUUID } from "node:crypto";

import { MINUTE_MS, HOUR_MS, DAY_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { noDelegationHooks } from "../../src/modules/actions";
import {
  createOutboxSender,
  createReportMailSender,
  digestNowMessage,
  queueCardEdits,
  queueNotice,
  telegramDetailOf,
  type CommandDeps,
  type LinkedChat,
  type ReportMailbox,
} from "../../src/modules/channels";
import { createDetailGate, detailOfUser, detailsOf } from "../../src/modules/channels/detail";
import { createFakeChannel } from "../../src/modules/channels/fake/channel";
import { insertDefaultSettings } from "../../src/modules/config";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { markSynced } from "../../src/modules/mail/repo";
import { setMemberReportChannel, setOrgFeature } from "../../src/modules/tenancy";
import type { DB, TenantContext } from "../../src/platform/db";

import {
  addMember,
  createOrgWithMailbox,
  insertDraftAndSend,
  insertTestEmail,
  insertTriaged,
  isolateChannels,
  linkChat,
  randomChatId,
  testNoticeView,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();
afterAll(async () => {
  await db.destroy();
});

let spies: ReturnType<typeof spyOn>[] = [];
beforeEach(() => {
  spies = [
    spyOn(console, "log").mockImplementation((): void => undefined),
    spyOn(console, "error").mockImplementation((): void => undefined),
    spyOn(console, "warn").mockImplementation((): void => undefined),
  ];
});
afterEach(() => {
  for (const spy of spies) spy.mockRestore();
});

// 11:00 in Europe/Warsaw (UTC+1): outside the default quiet hours.
const T = new Date("2026-11-20T10:00:00Z");
const BASE = "https://ea.example.ts.net";
// A planted string: it is in the subject of every mail here and must not appear in a `minimal` text.
const CANARY = "CANARY-SUBJECT-91c3";

interface World {
  ctx: TenantContext;
  orgId: string;
  mailboxId: string;
  userId: string;
  chatId: number;
}

type Level = "full" | "minimal";

// One organization with a synced mailbox and an owner with a chat link. `flag` is the flag `telegram_minimal`.
async function world(
  trx: Transaction<DB>,
  opts: { flag?: boolean; member?: Level; locked?: boolean } = {}
): Promise<World> {
  await isolateChannels(trx);
  const created = await createOrgWithMailbox(trx);
  const ctx = { orgId: created.orgId };
  await insertDefaultSettings(trx, ctx, created.mailboxId);
  await markSynced(trx, ctx, created.mailboxId, new Date(T.getTime() - 5 * MINUTE_MS));
  const chatId = randomChatId();
  await linkChat(trx, ctx, created.userId, chatId, new Date(T.getTime() - 30 * DAY_MS));
  if (opts.flag ?? true)
    await setOrgFeature(trx, ctx, { flag: "telegram_minimal", enabled: true, actor: "cli", now: T });
  const w = { ctx, orgId: created.orgId, mailboxId: created.mailboxId, userId: created.userId, chatId };
  await setMember(trx, w, w.userId, opts.member ?? "full");
  if (opts.locked === true) await setLock(trx, w, true);
  return w;
}

async function setMember(trx: Transaction<DB>, w: World, userId: string, level: Level): Promise<void> {
  await trx
    .updateTable("memberships")
    .set({ telegram_detail: level })
    .where("org_id", "=", w.orgId)
    .where("user_id", "=", userId)
    .execute();
}

async function setLock(trx: Transaction<DB>, w: World, locked: boolean): Promise<void> {
  await trx.updateTable("organizations").set({ telegram_minimal_locked: locked }).where("id", "=", w.orgId).execute();
}

async function queueUrgent(trx: Transaction<DB>, w: World, userId = w.userId): Promise<string> {
  const emailId = await insertTestEmail(trx, w.ctx, w.mailboxId);
  const id = await queueNotice(trx, w.ctx, {
    userId,
    locale: "en",
    kind: "urgent",
    dedupKey: `urgent:${randomUUID()}`,
    emailId,
    mailboxId: w.mailboxId,
    view: testNoticeView("urgent", { marker: CANARY, emailId, at: T }) as never,
    eventAt: T,
    now: T,
  });
  if (id === null) throw new Error("no row");
  return id;
}

const rowOf = (trx: Transaction<DB>, id: string) =>
  trx
    .selectFrom("outbox")
    .select(["status", "detail", "text", "buttons", "error_code"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();

function sender(trx: Transaction<DB>, withBase = true) {
  const channel = createFakeChannel();
  return {
    channel,
    run: () =>
      createOutboxSender({
        db: trx,
        channel,
        now: () => T,
        ...(withBase ? { webBaseUrl: BASE } : {}),
      }).run(),
  };
}

describe("the Telegram sender reads the level at send time", () => {
  test("1. queued at full, the member set to minimal before the send: no subject, no keyboard, detail minimal", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx, { member: "full" });
      const id = await queueUrgent(trx, w);
      expect((await rowOf(trx, id)).detail).toBe("full");
      await setMember(trx, w, w.userId, "minimal");

      const s = sender(trx);
      await s.run();

      expect(s.channel.sent).toHaveLength(1);
      const message = s.channel.sent[0]?.message;
      expect(message?.text).not.toContain(CANARY);
      expect(message?.text).not.toContain("@");
      expect(message?.text).toContain(`${BASE}/activity?category=urgent`);
      expect(message?.buttons).toEqual([]);
      const row = await rowOf(trx, id);
      expect(row.status).toBe("sent");
      expect(row.detail).toBe("minimal");
      expect(row.text).toBe(message?.text ?? "");
      expect(row.buttons).toEqual([]);
    });
  });

  test("2. queued at minimal, the member set to full before the send: the full text with the keyboard, detail full", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx, { member: "minimal" });
      const id = await queueUrgent(trx, w);
      expect((await rowOf(trx, id)).detail).toBe("minimal");
      await setMember(trx, w, w.userId, "full");

      const s = sender(trx);
      await s.run();

      const message = s.channel.sent[0]?.message;
      expect(message?.text).toContain(CANARY);
      expect(message?.buttons.length).toBeGreaterThan(0);
      expect((await rowOf(trx, id)).detail).toBe("full");
    });
  });

  test("3. flag off, member minimal: the full text, as before the setting", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx, { flag: false, member: "minimal" });
      const id = await queueUrgent(trx, w);
      expect((await rowOf(trx, id)).detail).toBe("full");

      const s = sender(trx);
      await s.run();

      expect(s.channel.sent[0]?.message.text).toContain(CANARY);
      expect(s.channel.sent[0]?.message.buttons.length).toBeGreaterThan(0);
      expect((await rowOf(trx, id)).detail).toBe("full");
    });
  });

  test("4. organization locked, member full: minimal; unlocked before the send: full again (the member value stayed)", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx, { member: "full", locked: true });
      const id = await queueUrgent(trx, w);
      expect((await rowOf(trx, id)).detail).toBe("minimal");
      const s = sender(trx);
      await s.run();
      expect(s.channel.sent[0]?.message.text).not.toContain(CANARY);
      expect((await rowOf(trx, id)).detail).toBe("minimal");

      const second = await queueUrgent(trx, w);
      await setLock(trx, w, false);
      await s.run();
      expect(s.channel.sent[1]?.message.text).toContain(CANARY);
      expect((await rowOf(trx, second)).detail).toBe("full");
    });
  });

  test("5. without a base URL the minimal text says Open the panel and holds no address", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx, { member: "minimal" });
      await queueUrgent(trx, w);
      const s = sender(trx, false);
      await s.run();
      const text = s.channel.sent[0]?.message.text ?? "";
      expect(text).toContain("Open the panel");
      expect(text).not.toContain("http");
    });
  });

  test("6. one batch, two members: each message has the level of its own member", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx, { member: "full" });
      const other = await addMember(trx, w.orgId, "owner");
      const otherChat = randomChatId();
      await linkChat(trx, w.ctx, other, otherChat, new Date(T.getTime() - 30 * DAY_MS));
      await setMember(trx, w, other, "minimal");
      const first = await queueUrgent(trx, w);
      const second = await queueUrgent(trx, w, other);

      const s = sender(trx);
      await s.run();

      const byChat = new Map(s.channel.sent.map((sent) => [sent.chatId, sent.message]));
      expect(byChat.get(w.chatId)?.text).toContain(CANARY);
      expect(byChat.get(otherChat)?.text).not.toContain(CANARY);
      expect((await rowOf(trx, first)).detail).toBe("full");
      expect((await rowOf(trx, second)).detail).toBe("minimal");
    });
  });

  test("7. a row that has a stored text goes as it is and keeps its level (queued before send-time rendering)", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx, { member: "minimal" });
      const id = await queueUrgent(trx, w);
      await trx
        .updateTable("outbox")
        .set({ text: `old text ${CANARY}`, detail: "full" })
        .where("id", "=", id)
        .execute();
      const s = sender(trx);
      await s.run();
      expect(s.channel.sent[0]?.message.text).toBe(`old text ${CANARY}`);
      expect((await rowOf(trx, id)).detail).toBe("full");
    });
  });
});

describe("an approval card and its edit", () => {
  test("8. a card sent at minimal, then approved in the panel: the edit is the minimal text plus the status line, no button", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx, { member: "minimal" });
      const { emailId, sendId } = await insertDraftAndSend(trx, w.ctx, w.mailboxId, {
        sendStatus: "awaiting_approval",
      });
      const cardId = await queueNotice(trx, w.ctx, {
        userId: w.userId,
        locale: "en",
        kind: "approval",
        dedupKey: `approval:${sendId}`,
        emailId,
        mailboxId: w.mailboxId,
        view: {
          ...testNoticeView("approval", { marker: CANARY, emailId, at: T }),
          actionId: sendId,
        } as never,
        eventAt: T,
        now: T,
      });
      const s = sender(trx);
      await s.run();
      const card = s.channel.sent[0]?.message;
      expect(card?.text).not.toContain(CANARY);
      expect(card?.buttons).toEqual([]);

      // The decision in the panel: the send is approved by the member.
      await trx
        .updateTable("actions")
        .set({ status: "approved", approved_by: w.userId, approved_at: T })
        .where("id", "=", sendId)
        .execute();
      const later = new Date(T.getTime() + MINUTE_MS);
      const queued = await queueCardEdits(trx, w.ctx, { sendId, outcome: "approved", at: later });
      expect(queued.queued).toBe(1);
      await createOutboxSender({ db: trx, channel: s.channel, now: () => later, webBaseUrl: BASE }).run();

      expect(s.channel.edited).toHaveLength(1);
      const edit = s.channel.edited[0]?.message;
      expect(edit?.text.startsWith(card?.text ?? "?")).toBe(true);
      expect(edit?.text.length).toBeGreaterThan(card?.text.length ?? 0);
      expect(edit?.text).not.toContain(CANARY);
      expect(edit?.buttons).toEqual([]);
      const edits = await trx
        .selectFrom("outbox")
        .select(["status", "detail"])
        .where("kind", "=", "approval_edit")
        .where("edit_of_outbox_id", "=", cardId)
        .execute();
      expect(edits).toEqual([{ status: "sent", detail: "minimal" }]);
    });
  });
});

describe("a held card at the edit", () => {
  test("8b. the edit of a held send has the Reject button at full and none at minimal, with the level of the member at send time", async () => {
    await withRollback(db, async (trx) => {
      const buttonsOfEdit = async (member: Level): Promise<number> => {
        const w = await world(trx, { member: "full" });
        const { emailId, sendId } = await insertDraftAndSend(trx, w.ctx, w.mailboxId, {
          sendStatus: "awaiting_approval",
        });
        await queueNotice(trx, w.ctx, {
          userId: w.userId,
          locale: "en",
          kind: "approval",
          dedupKey: `approval:${sendId}`,
          emailId,
          mailboxId: w.mailboxId,
          view: { ...testNoticeView("approval", { marker: CANARY, emailId, at: T }), actionId: sendId } as never,
          eventAt: T,
          now: T,
        });
        const s = sender(trx);
        await s.run();
        await trx
          .updateTable("actions")
          .set({ status: "approved", approved_by: w.userId, approved_at: T })
          .where("id", "=", sendId)
          .execute();
        const later = new Date(T.getTime() + MINUTE_MS);
        await queueCardEdits(trx, w.ctx, { sendId, outcome: "approved_held", heldBy: "paused", at: later });
        await setMember(trx, w, w.userId, member);
        await createOutboxSender({ db: trx, channel: s.channel, now: () => later, webBaseUrl: BASE }).run();
        return s.channel.edited[0]?.message.buttons.flat().length ?? -1;
      };
      expect(await buttonsOfEdit("full")).toBeGreaterThan(0);
      expect(await buttonsOfEdit("minimal")).toBe(0);
    });
  });
});

describe("the direct answers", () => {
  function depsAt(trx: Transaction<DB>): CommandDeps {
    return {
      db: trx,
      now: () => T,
      llmDailyCap: 300,
      triageScope: "all",
      actionsScope: { kind: "off" },
      llm: { provider: "gemini", classifierModel: "gemini-3.5-flash-lite" },
      hooks: noDelegationHooks,
      uidplus: async () => true,
      sendScope: { kind: "off" },
      testMail: NO_TEST_SENDERS,
      operatorContact: null,
      syncEveryMin: 2,
      webBaseUrl: BASE,
    };
  }
  const linkOf = (w: World): LinkedChat => ({
    orgId: w.orgId,
    userId: w.userId,
    role: "owner",
    chatId: w.chatId,
    linkedAt: new Date(T.getTime() - 30 * DAY_MS),
    locale: "en",
  });

  test("9. /digest with the flag on and a minimal member is the minimal digest; with the flag off, or at full, the full digest", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx, { member: "minimal" });
      await insertTriaged(trx, w.ctx, w.mailboxId, {
        category: "urgent",
        createdAt: new Date(T.getTime() - HOUR_MS),
        subject: CANARY,
        from: "marker-sender@mail.test",
      });
      expect(await telegramDetailOf(depsAt(trx), linkOf(w))).toBe("minimal");
      const minimal = await digestNowMessage(depsAt(trx), linkOf(w));
      expect(minimal.text).not.toContain(CANARY);
      expect(minimal.buttons).toEqual([]);
      expect(minimal.text).toContain(`${BASE}/activity`);

      await setMember(trx, w, w.userId, "full");
      expect(await telegramDetailOf(depsAt(trx), linkOf(w))).toBe("full");
      expect((await digestNowMessage(depsAt(trx), linkOf(w))).text).toContain(CANARY);

      await setMember(trx, w, w.userId, "minimal");
      await setOrgFeature(trx, w.ctx, { flag: "telegram_minimal", enabled: false, actor: "cli", now: T });
      expect(await telegramDetailOf(depsAt(trx), linkOf(w))).toBe("full");
      expect((await digestNowMessage(depsAt(trx), linkOf(w))).text).toContain(CANARY);
    });
  });
});

describe("the mail channel", () => {
  test("10. a report mail row of a minimal member is full: the row says full and the mail holds the full text", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx, { member: "minimal" });
      await setOrgFeature(trx, w.ctx, { flag: "report_mail", enabled: true, actor: "cli", now: T });
      await setMemberReportChannel(trx, w.ctx, w.userId, { channel: "mail", mailboxId: w.mailboxId });
      const id = await queueNotice(trx, w.ctx, {
        userId: w.userId,
        locale: "en",
        kind: "trust_report_ready",
        dedupKey: `trust_report_ready:${randomUUID()}:mail`,
        mailboxId: w.mailboxId,
        view: {
          mailboxId: w.mailboxId,
          recommended: ["info"],
          blocked: 0,
          checked: 40,
          reportUrl: `${BASE}/report?mailbox=${w.mailboxId}`,
        },
        channel: "mail",
        now: T,
      });
      if (id === null) throw new Error("no row");
      expect((await rowOf(trx, id)).detail).toBe("full");

      const appended: string[] = [];
      const mailbox: ReportMailbox = {
        append: async (_ctx, _mailboxId, message) => {
          appended.push(JSON.stringify(message));
          return "appended";
        },
      };
      await createReportMailSender({ db: trx, mailbox, now: () => T, webBaseUrl: BASE }).run();
      const row = await rowOf(trx, id);
      expect({ status: row.status, detail: row.detail }).toEqual({ status: "sent", detail: "full" });
      expect(appended).toHaveLength(1);
    });
  });
});

describe("the readers", () => {
  test("11. detailsOf and the gate give the level per user and organization; a user without a membership reads minimal", async () => {
    await withRollback(db, async (trx) => {
      const a = await world(trx, { member: "full" });
      const b = await world(trx, { member: "minimal" });
      // The same user is a member of both organizations; the second organization has the flag off.
      await trx.insertInto("memberships").values({ org_id: b.orgId, user_id: a.userId, role: "assistant" }).execute();
      await setOrgFeature(trx, b.ctx, { flag: "telegram_minimal", enabled: false, actor: "cli", now: T });
      await setMember(trx, b, a.userId, "minimal");
      const second = await addMember(trx, a.orgId, "assistant");
      await setMember(trx, a, second, "minimal");
      const stranger = randomUUID();

      expect(Object.fromEntries(await detailsOf(trx, a.ctx, [a.userId, second, stranger]))).toEqual({
        [a.userId]: "full",
        [second]: "minimal",
        [stranger]: "minimal",
      });
      // The flag of the other organization is off: everyone reads full there, also the member of level minimal.
      expect(await detailOfUser(trx, b.ctx, a.userId)).toBe("full");
      expect(await detailOfUser(trx, b.ctx, b.userId)).toBe("full");
      expect((await detailsOf(trx, a.ctx, [])).size).toBe(0);

      const gate = createDetailGate({
        db: trx,
        claimed: [
          { orgId: a.orgId, userId: a.userId },
          { orgId: a.orgId, userId: second },
          { orgId: b.orgId, userId: a.userId },
          { orgId: a.orgId, userId: stranger },
        ],
      });
      expect(await gate.detailOf({ orgId: a.orgId, userId: a.userId })).toBe("full");
      expect(await gate.detailOf({ orgId: a.orgId, userId: second })).toBe("minimal");
      expect(await gate.detailOf({ orgId: b.orgId, userId: a.userId })).toBe("full");
      expect(await gate.detailOf({ orgId: a.orgId, userId: stranger })).toBe("minimal");
    });
  });

  test("11b. one user in two organizations that both have the flag on: each organization gives its own level", async () => {
    await withRollback(db, async (trx) => {
      const a = await world(trx, { member: "full" });
      const c = await world(trx, { member: "minimal" });
      await trx
        .insertInto("memberships")
        .values({ org_id: c.orgId, user_id: a.userId, role: "assistant", telegram_detail: "minimal" })
        .execute();
      const claimed = [
        { orgId: a.orgId, userId: a.userId },
        { orgId: c.orgId, userId: a.userId },
      ];
      const gate = createDetailGate({ db: trx, claimed });
      expect(await gate.detailOf({ orgId: a.orgId, userId: a.userId })).toBe("full");
      expect(await gate.detailOf({ orgId: c.orgId, userId: a.userId })).toBe("minimal");
      // The lock of one organization does not reach the other.
      await setLock(trx, c, true);
      await setMember(trx, c, a.userId, "full");
      const locked = createDetailGate({ db: trx, claimed });
      expect(await locked.detailOf({ orgId: a.orgId, userId: a.userId })).toBe("full");
      expect(await locked.detailOf({ orgId: c.orgId, userId: a.userId })).toBe("minimal");
    });
  });

  test("12. the gate reads the members once per batch, and not at all while the flag is off", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx, { member: "minimal" });
      const claimed = [{ orgId: w.orgId, userId: w.userId }];
      const queries: string[] = [];
      const counting = trx.withPlugin({
        transformQuery: (args) => {
          queries.push(args.node.kind);
          return args.node;
        },
        transformResult: async (args) => args.result,
      });
      const gate = createDetailGate({ db: counting, claimed });
      await gate.detailOf(claimed[0] as { orgId: string; userId: string });
      await gate.detailOf(claimed[0] as { orgId: string; userId: string });
      await gate.detailOf(claimed[0] as { orgId: string; userId: string });
      // One flag read (cached) and one member read: two selects for three rows.
      expect(queries).toHaveLength(2);

      await setOrgFeature(trx, w.ctx, { flag: "telegram_minimal", enabled: false, actor: "cli", now: T });
      const quiet: string[] = [];
      const offGate = createDetailGate({
        db: trx.withPlugin({
          transformQuery: (args) => {
            quiet.push(args.node.kind);
            return args.node;
          },
          transformResult: async (args) => args.result,
        }),
        claimed,
      });
      expect(await offGate.detailOf(claimed[0] as { orgId: string; userId: string })).toBe("full");
      // Only the flag read: no member query.
      expect(quiet).toHaveLength(1);
    });
  });
});
