import { format } from "node:util";

import { encodeCallback, textTables, MINUTE_MS, HOUR_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import {
  approve,
  editApproval,
  noDelegationHooks,
  reject,
  type ApprovalDeps,
  type ApprovalHooks,
  type SendScope,
} from "../../src/modules/actions";
import {
  cardEditHooks,
  ChannelError,
  createOutboxSender,
  detectNotices,
  handleCallback,
  insertOutbox,
  type CallbackDeps,
  type LinkedChat,
} from "../../src/modules/channels";
import { checkCardEdit } from "../../src/modules/channels/card-edit-check";
import { getEditTarget, newerEditSent } from "../../src/modules/channels/card-edits-repo";
import { createFakeChannel } from "../../src/modules/channels/fake/channel";
import { replaceChatLink } from "../../src/modules/channels/repo";
import { insertDefaultSettings, updateMailboxSettings } from "../../src/modules/config";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { setOrgFeature } from "../../src/modules/tenancy";
import type { DB, TenantContext } from "../../src/platform/db";
import { setLogFormat, setLogLevel } from "../../src/platform/log";

import {
  addMember,
  createOrgWithMailbox,
  insertDraftAndSend,
  insertTestEmail,
  isolateChannels,
  linkChat,
  randomChatId,
  testNoticeView,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

// A decision in any channel edits the other Telegram cards of the send, and an old edit never
// overwrites a newer state. Warsaw is UTC+1 on these dates: 13:05Z is 14:05 local.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const LINKED = new Date("2026-11-01T08:00:00Z");
const CARD_AT = new Date("2026-11-20T13:00:00Z");
const NOW = new Date("2026-11-20T13:05:00Z");
const SWITCHES = { move: true, mark_read: true, flag: true, create_draft: true, move_unsure: false };
const edits = textTables.en.approvals.edit;
const CLOCK = "14:05";

let logLines: string[] = [];
let errorLines: string[] = [];
let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;
let warnSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  setLogFormat("json");
  logLines = [];
  errorLines = [];
  logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logLines.push(format(...args));
  });
  warnSpy = spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    logLines.push(format(...args));
  });
  errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errorLines.push(format(...args));
  });
});

afterEach(() => {
  logSpy.mockRestore();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
  setLogFormat("text");
  setLogLevel("info");
});

interface World {
  trx: Transaction<DB>;
  orgId: string;
  ctx: TenantContext;
  mailboxId: string;
  u1: string;
  u2: string;
  chat1: number;
  chat2: number;
  emailId: string;
  sendId: string;
  c1: string;
  c2: string;
}

async function insertCard(
  trx: Transaction<DB>,
  w: Pick<World, "orgId" | "emailId" | "sendId">,
  userId: string,
  messageId: number,
  text: string
): Promise<string> {
  const row = await trx
    .insertInto("outbox")
    .values({
      org_id: w.orgId,
      user_id: userId,
      kind: "approval",
      dedup_key: `approval:${w.sendId}`,
      email_id: w.emailId,
      text,
      buttons: JSON.stringify([[{ text: "✅ Send", data: encodeCallback({ kind: "approve", actionId: w.sendId }) }]]),
      status: "sent",
      next_attempt_at: CARD_AT,
      created_at: CARD_AT,
      sent_at: CARD_AT,
      external_message_id: messageId,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

// Two owners with a chat each, a waiting send and its two sent cards C1 (message 501) and C2 (message 502).
async function world(trx: Transaction<DB>): Promise<World> {
  await isolateChannels(trx);
  const { orgId, userId: u1, mailboxId } = await createOrgWithMailbox(trx);
  const ctx = { orgId };
  const u2 = await addMember(trx, orgId, "owner");
  const chat1 = randomChatId();
  const chat2 = randomChatId();
  await linkChat(trx, ctx, u1, chat1, LINKED);
  await linkChat(trx, ctx, u2, chat2, LINKED);
  await insertDefaultSettings(trx, ctx, mailboxId);
  await updateMailboxSettings(trx, ctx, mailboxId, { mode: "assist", toolSwitches: SWITCHES });
  const { emailId, sendId } = await insertDraftAndSend(trx, ctx, mailboxId, {
    notifiedAt: CARD_AT,
    createdAt: CARD_AT,
  });
  const base = { orgId, emailId, sendId };
  const c1 = await insertCard(trx, base, u1, 501, "CARD-ONE");
  const c2 = await insertCard(trx, base, u2, 502, "CARD-TWO");
  return { trx, orgId, ctx, mailboxId, u1, u2, chat1, chat2, emailId, sendId, c1, c2 };
}

function depsOf(w: World, scope: SendScope = { kind: "all" }, hooks?: ApprovalHooks): ApprovalDeps {
  return {
    db: w.trx,
    hooks: noDelegationHooks,
    approvalHooks: hooks ?? cardEditHooks({ sendScope: scope }),
    uidplus: async () => true,
  };
}

function tapDeps(w: World, scope: SendScope = { kind: "all" }): CallbackDeps {
  return {
    db: w.trx,
    now: () => NOW,
    actionsScope: { kind: "all" },
    hooks: noDelegationHooks,
    uidplus: async () => true,
    sendScope: scope,
  };
}

function linkOf(w: World, userId: string): LinkedChat {
  return {
    orgId: w.orgId,
    userId,
    role: "owner",
    chatId: userId === w.u1 ? w.chat1 : w.chat2,
    linkedAt: LINKED,
    locale: "en",
  };
}

function senderOf(w: World, channel = createFakeChannel(), perUserLimit?: number) {
  let now = NOW;
  const sender = createOutboxSender({
    db: w.trx,
    channel,
    now: () => now,
    ...(perUserLimit === undefined ? {} : { perUserLimit }),
  });
  return {
    channel,
    run: async (when: Date = NOW) => {
      now = when;
      await sender.run();
    },
  };
}

async function editRows(w: World) {
  return w.trx
    .selectFrom("outbox")
    .select(["id", "user_id", "edit_of_outbox_id", "status", "error_code", "attempts", "next_attempt_at", "dedup_key"])
    .where("org_id", "=", w.orgId)
    .where("kind", "=", "approval_edit")
    .orderBy("created_at")
    .orderBy("id")
    .execute();
}

async function sendState(w: World, sendId = w.sendId) {
  return w.trx
    .selectFrom("actions")
    .select(["status", "status_reason"])
    .where("id", "=", sendId)
    .executeTakeFirstOrThrow();
}

// Puts the send into a state by hand (the checks of `actions` need the approval columns for an approved send).
async function setSend(w: World, status: string, reason: string | null = null): Promise<void> {
  const approved = ["approved", "applying", "applied"].includes(status);
  await w.trx
    .updateTable("actions")
    .set({
      status,
      status_reason: reason,
      ...(approved ? { approved_by: w.u1, approved_at: NOW, approved_via: "web" } : {}),
      ...(status === "applied" ? { applied_at: NOW } : {}),
    })
    .where("id", "=", w.sendId)
    .execute();
}

function byMessage<T extends { messageId: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.messageId - b.messageId);
}

describe("card sync: a decision edits the other cards (T1-T3)", () => {
  test("T1: a panel approval edits both cards with their message ids and no buttons", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const result = await approve(depsOf(w), w.ctx, w.sendId, { userId: w.u1, via: "web", now: NOW });
      expect(result.kind).toBe("approved");
      expect((await editRows(w)).map((row) => row.status)).toEqual(["pending", "pending"]);

      const sender = senderOf(w);
      await sender.run();

      expect(sender.channel.sent).toEqual([]);
      expect(byMessage(sender.channel.edited)).toEqual([
        { chatId: w.chat1, messageId: 501, message: { text: `CARD-ONE\n\n${edits.approved(CLOCK)}`, buttons: [] } },
        { chatId: w.chat2, messageId: 502, message: { text: `CARD-TWO\n\n${edits.approved(CLOCK)}`, buttons: [] } },
      ]);
      expect(edits.approved(CLOCK)).toBe("⏳ Approved 14:05, sending.");
      const rows = await editRows(w);
      expect(rows.map((row) => row.status)).toEqual(["sent", "sent"]);
      const ids = await trx
        .selectFrom("outbox")
        .select(["edit_of_outbox_id", "external_message_id"])
        .where("kind", "=", "approval_edit")
        .where("org_id", "=", w.orgId)
        .execute();
      expect(ids.map((row) => [row.edit_of_outbox_id, Number(row.external_message_id)]).sort()).toEqual(
        [
          [w.c1, 501],
          [w.c2, 502],
        ].sort()
      );
      // A second run edits nothing more.
      await sender.run();
      expect(sender.channel.edited).toHaveLength(2);
    });
  });

  test("T2: a Telegram approval by U1 edits C2 only (the tap edits its own card)", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const tap = await handleCallback(
        tapDeps(w),
        linkOf(w, w.u1),
        encodeCallback({ kind: "approve", actionId: w.sendId })
      );
      expect(tap.edit?.text).toBe(`CARD-ONE\n\n${edits.approved(CLOCK)}`);

      const rows = await editRows(w);
      expect(rows.map((row) => row.edit_of_outbox_id)).toEqual([w.c2]);
      const sender = senderOf(w);
      await sender.run();
      expect(sender.channel.edited.map((edit) => [edit.chatId, edit.messageId])).toEqual([[w.chat2, 502]]);
    });
  });

  test("T3: with SEND_SCOPE off the cards show approved_held and C2 keeps the Reject button", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const off: SendScope = { kind: "off" };
      await approve(depsOf(w, off), w.ctx, w.sendId, { userId: w.u1, via: "web", now: NOW });
      const sender = senderOf(w);
      await sender.run();
      const reject = [
        [
          {
            text: textTables.en.approvals.buttons.reject,
            data: encodeCallback({ kind: "reject", actionId: w.sendId }),
          },
        ],
      ];
      const held = edits.approvedHeld(CLOCK, textTables.en.approvals.held.scope);
      expect(byMessage(sender.channel.edited).map((edit) => edit.message)).toEqual([
        { text: `CARD-ONE\n\n${held}`, buttons: reject },
        { text: `CARD-TWO\n\n${held}`, buttons: reject },
      ]);
    });
  });
});

describe("card sync: an old edit never overwrites a newer state (T4)", () => {
  test("T4: U1 approves a held send in the panel, then taps Reject on C1", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const off: SendScope = { kind: "off" };
      // U1 has one notice that takes the one place of U1 in the first run: the C1 edit waits (rate limit).
      const emailId = await insertTestEmail(trx, w.ctx, w.mailboxId);
      await insertOutbox(trx, w.ctx, {
        userId: w.u1,
        kind: "urgent",
        dedupKey: "urgent:t4",
        emailId,
        view: testNoticeView("urgent", { marker: "m", emailId, at: CARD_AT }),
        locale: "en",
        createdAt: CARD_AT,
        nextAttemptAt: CARD_AT,
      });
      await approve(depsOf(w, off), w.ctx, w.sendId, { userId: w.u1, via: "web", now: NOW });
      const sender = senderOf(w, createFakeChannel(), 1);
      await sender.run();
      expect(sender.channel.edited.map((edit) => edit.messageId)).toEqual([502]);
      const waiting = (await editRows(w)).find((row) => row.edit_of_outbox_id === w.c1);
      expect(waiting?.status).toBe("pending");

      // U1 taps Reject on C1: the send is rejected; C2 gets the rejected edit; the tap edits C1 itself.
      const tap = await handleCallback(
        tapDeps(w, off),
        linkOf(w, w.u1),
        encodeCallback({ kind: "reject", actionId: w.sendId })
      );
      expect(tap.edit?.text).toBe(`CARD-ONE\n\n${edits.rejected(CLOCK)}`);
      await sender.run();

      const rows = await editRows(w);
      const c1Row = rows.find((row) => row.edit_of_outbox_id === w.c1);
      expect(c1Row).toMatchObject({ status: "failed", error_code: "stale_edit" });
      // C1 is never edited by the outbox; C2 shows the rejection at the end.
      expect(sender.channel.edited.filter((edit) => edit.messageId === 501)).toEqual([]);
      expect(sender.channel.edited.at(-1)).toEqual({
        chatId: w.chat2,
        messageId: 502,
        message: { text: `CARD-TWO\n\n${edits.rejected(CLOCK)}`, buttons: [] },
      });
      expect((await sendState(w)).status).toBe("rejected");
    });
  });
});

describe("card sync: the sender (T5, T6)", () => {
  test("T5: in the quiet hours an edit goes out in the same run; an urgent row of U1 waits", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const emailId = await insertTestEmail(trx, w.ctx, w.mailboxId);
      const urgent = await insertOutbox(trx, w.ctx, {
        userId: w.u1,
        kind: "urgent",
        dedupKey: "urgent:t5",
        emailId,
        view: testNoticeView("urgent", { marker: "m", emailId, at: CARD_AT }),
        locale: "en",
        createdAt: CARD_AT,
        nextAttemptAt: CARD_AT,
      });
      await approve(depsOf(w), w.ctx, w.sendId, { userId: w.u2, via: "web", now: NOW });
      const sender = senderOf(w);
      const late = new Date("2026-11-20T22:30:00Z");
      await sender.run(late);
      expect(sender.channel.edited.map((edit) => edit.messageId).sort()).toEqual([501, 502]);
      expect(sender.channel.sent).toEqual([]);
      const state = await trx
        .selectFrom("outbox")
        .select(["status", "next_attempt_at"])
        .where("id", "=", urgent ?? "")
        .executeTakeFirstOrThrow();
      expect(state.status).toBe("pending");
      expect(state.next_attempt_at.getTime()).toBeGreaterThan(late.getTime());
    });
  });

  test("T6: a refused edit ends failed / edit_failed and is not taken again; a soft error backs off", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await approve(depsOf(w), w.ctx, w.sendId, { userId: w.u1, via: "web", now: NOW });
      const sender = senderOf(w);
      sender.channel.failWith(new ChannelError("bad_request", "message_not_found"), 1);
      await sender.run();
      let rows = await editRows(w);
      expect(rows.map((row) => [row.status, row.error_code])).toEqual([
        ["failed", "edit_failed"],
        ["sent", null],
      ]);
      // The decision stays: Telegram never rolls it back.
      expect((await sendState(w)).status).toBe("approved");
      await sender.run(new Date(NOW.getTime() + MINUTE_MS));
      expect(sender.channel.edited).toHaveLength(1);

      // A soft error releases the row with a backoff, without a failure.
      const w2 = await world(trx);
      await approve(depsOf(w2), w2.ctx, w2.sendId, { userId: w2.u1, via: "web", now: NOW });
      const soft = senderOf(w2);
      soft.channel.failWith(new ChannelError("soft", "network"), 1);
      await soft.run();
      rows = await editRows(w2);
      expect(rows.map((row) => row.status)).toEqual(["pending", "pending"]);
      expect(rows[0]?.attempts).toBe(1);
      expect(rows[0]?.next_attempt_at.getTime()).toBeGreaterThan(NOW.getTime());
      // No log line holds the card text.
      expect([...logLines, ...errorLines].some((line) => line.includes("CARD-"))).toBe(false);
    });
  });

  test("the edit of a blocked bot fails as edit_failed too", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await approve(depsOf(w), w.ctx, w.sendId, { userId: w.u1, via: "web", now: NOW });
      const sender = senderOf(w);
      sender.channel.failWith(new ChannelError("blocked", "bot_blocked"), 2);
      await sender.run();
      expect((await editRows(w)).map((row) => [row.status, row.error_code])).toEqual([
        ["failed", "edit_failed"],
        ["failed", "edit_failed"],
      ]);
    });
  });
});

describe("card sync: an edit of a send (T7, T8)", () => {
  test("T7: a panel edit of S1 ends both cards with the changed line", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const result = await editApproval(depsOf(w), w.ctx, w.sendId, {
        userId: w.u1,
        via: "web",
        now: NOW,
        subject: "Budget 2027",
        body: "Hello Anna,\nplease send the report.",
      });
      expect(result.kind).toBe("edited");
      const sender = senderOf(w);
      await sender.run();
      expect(byMessage(sender.channel.edited).map((edit) => edit.message)).toEqual([
        { text: `CARD-ONE\n\n${edits.changed(CLOCK)}`, buttons: [] },
        { text: `CARD-TWO\n\n${edits.changed(CLOCK)}`, buttons: [] },
      ]);
      expect(edits.changed(CLOCK)).toStartWith("✏️ Changed 14:05.");
    });
  });

  test("T8: a refused edit calls no hook", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const calls: string[] = [];
      const hooks: ApprovalHooks = {
        onDecided: async (_trx, _ctx, input) => {
          calls.push(input.decision);
        },
      };
      const deps = depsOf(w, { kind: "all" }, hooks);
      const input = { userId: w.u1, via: "web" as const, now: NOW, subject: "S", body: "B" };
      // closed: an approved send; unknown id.
      await setSend(w, "approved");
      expect((await editApproval(deps, w.ctx, w.sendId, input)).kind).toBe("closed");
      expect((await editApproval(deps, w.ctx, "00000000-0000-4000-8000-000000000000", input)).kind).toBe("not_found");
      expect(calls).toEqual([]);
      await setSend(w, "awaiting_approval");
      await trx
        .updateTable("actions")
        .set({ approved_by: null, approved_at: null, approved_via: null })
        .where("id", "=", w.sendId)
        .execute();
      expect((await editApproval(deps, w.ctx, w.sendId, input)).kind).toBe("edited");
      expect(calls).toEqual(["changed"]);
    });
  });
});

describe("card sync: decisions call the hook once, with the right input", () => {
  test("approve, reject and a refused decision", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const calls: { decision: string; sendId: string; exceptUserId?: string; at: Date }[] = [];
      const hooks: ApprovalHooks = {
        onDecided: async (_trx, _ctx, input) => {
          calls.push(input);
        },
      };
      const deps = depsOf(w, { kind: "all" }, hooks);
      await reject(deps, w.ctx, w.sendId, { userId: w.u1, via: "telegram", now: NOW });
      // A second reject changes nothing and calls nothing.
      await reject(deps, w.ctx, w.sendId, { userId: w.u1, via: "telegram", now: NOW });
      expect(await approve(deps, w.ctx, w.sendId, { userId: w.u1, via: "web", now: NOW })).toEqual({
        kind: "rejected",
      });
      expect(calls).toEqual([{ decision: "rejected", sendId: w.sendId, exceptUserId: w.u1, at: NOW }]);
    });
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const calls: { decision: string; exceptUserId?: string }[] = [];
      const hooks: ApprovalHooks = {
        onDecided: async (_trx, _ctx, input) => {
          calls.push(input);
        },
      };
      await approve(depsOf(w, { kind: "all" }, hooks), w.ctx, w.sendId, { userId: w.u1, via: "web", now: NOW });
      expect(calls).toMatchObject([{ decision: "approved" }]);
      expect(calls[0]?.exceptUserId).toBeUndefined();
    });
  });

  test("a tap on a send past its limit expires it and calls the hook once with the tapper as the exception (F102 stage 18)", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await trx
        .updateTable("actions")
        .set({ notified_at: new Date(NOW.getTime() - 49 * HOUR_MS) })
        .where("id", "=", w.sendId)
        .execute();
      const calls: { decision: string; sendId: string; exceptUserId?: string; at: Date }[] = [];
      const spy: ApprovalHooks = {
        onDecided: async (_trx, _ctx, input) => {
          calls.push(input);
        },
      };
      const real = cardEditHooks({ sendScope: { kind: "all" } });
      const hooks: ApprovalHooks = {
        onDecided: async (t, c, input) => {
          await spy.onDecided(t, c, input);
          await real.onDecided(t, c, input);
        },
      };
      const deps = depsOf(w, { kind: "all" }, hooks);
      expect(await approve(deps, w.ctx, w.sendId, { userId: w.u1, via: "telegram", now: NOW })).toEqual({
        kind: "expired",
        byThisTap: true,
      });
      // The second tap finds the send closed: no second hook call.
      expect(await approve(deps, w.ctx, w.sendId, { userId: w.u2, via: "telegram", now: NOW })).toEqual({
        kind: "expired",
        byThisTap: false,
      });
      expect(calls).toEqual([{ decision: "expired", sendId: w.sendId, exceptUserId: w.u1, at: NOW }]);
      // The tapped card is the handler's own edit; the card of the other owner loses its buttons.
      expect((await editRows(w)).map((row) => [row.edit_of_outbox_id, row.dedup_key])).toEqual([
        [w.c2, `approval_edit:${w.c2}:expired`],
      ]);
      const sender = senderOf(w);
      await sender.run();
      expect(sender.channel.edited).toEqual([
        { chatId: w.chat2, messageId: 502, message: { text: `CARD-TWO\n\n${edits.expired(CLOCK)}`, buttons: [] } },
      ]);
    });
  });

  test("a decision that read its clock earlier but commits later still ends the card (review 9 N1)", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const off: SendScope = { kind: "off" };
      // The approve read the clock at t2 and committed first; its edit goes out. The reject read t1 < t2 and committed after it.
      const t2 = new Date(NOW.getTime() + 2000);
      await approve(depsOf(w, off), w.ctx, w.sendId, { userId: w.u1, via: "web", now: t2 });
      const sender = senderOf(w);
      await sender.run(t2);
      expect(sender.channel.edited).toHaveLength(2);
      await reject(depsOf(w, off), w.ctx, w.sendId, { userId: w.u1, via: "web", now: NOW });
      await sender.run(new Date(t2.getTime() + 1000));
      const rows = await editRows(w);
      expect(rows.filter((row) => row.status === "failed")).toEqual([]);
      // Both cards end with the rejection (the two rows have the same time, so their order is not fixed).
      expect(
        sender.channel.edited
          .slice(2)
          .map((edit) => edit.message.text)
          .sort()
      ).toEqual([`CARD-ONE\n\n${edits.rejected(CLOCK)}`, `CARD-TWO\n\n${edits.rejected(CLOCK)}`]);
    });
  });

  test("a failure of the card sync is logged and the decision stays", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      // A send scope that cannot be read: finding the held cause throws inside the hook, after the approval was written.
      const broken = { kind: "self", addresses: null } as unknown as SendScope;
      const result = await approve(depsOf(w, broken), w.ctx, w.sendId, { userId: w.u1, via: "web", now: NOW });
      expect(result.kind).toBe("approved");
      expect((await sendState(w)).status).toBe("approved");
      expect(await editRows(w)).toEqual([]);
      expect([...logLines, ...errorLines].some((line) => line.includes("card_edits_not_queued"))).toBe(true);
      // The transaction is alive: later statements run.
      expect((await sendState(w)).status).toBe("approved");
    });
  });
});

describe("card sync: the checks of the sender", () => {
  async function rowFor(w: World, userId: string, targetId: string, outcome: string, key: string, at = NOW) {
    const id = await insertOutbox(w.trx, w.ctx, {
      userId,
      kind: "approval_edit",
      dedupKey: key,
      emailId: w.emailId,
      editOfOutboxId: targetId,
      view: { original: "CARD", outcome, at: at.toISOString(), timeZone: "Europe/Warsaw" },
      locale: "en",
      createdAt: at,
      nextAttemptAt: at,
    });
    if (id === null) throw new Error("no row");
    return id;
  }

  async function claimed(w: World, id: string) {
    const row = await w.trx
      .selectFrom("outbox")
      .select(["id", "org_id", "user_id", "view", "created_at", "edit_of_outbox_id"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    return {
      id: row.id,
      orgId: row.org_id,
      userId: row.user_id,
      view: row.view,
      createdAt: row.created_at,
      editOfOutboxId: row.edit_of_outbox_id,
    };
  }

  test("each outcome needs its state of the send", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const cases: [string, string, string | null, boolean][] = [
        ["approved", "approved", null, true],
        ["approved", "applying", null, true],
        ["approved", "applied", null, true],
        ["approved_held", "approved", null, true],
        ["approved", "rejected", null, false],
        ["approved", "awaiting_approval", null, false],
        ["rejected", "rejected", null, true],
        ["rejected", "approved", null, false],
        ["changed", "expired", "superseded", true],
        ["changed", "expired", "timeout", false],
        ["changed", "rejected", null, false],
        ["expired", "expired", "timeout", true],
        ["expired", "approved", null, false],
      ];
      let n = 0;
      for (const [outcome, status, reason, ok] of cases) {
        n += 1;
        await setSend(w, status, reason);
        const id = await rowFor(w, w.u1, w.c1, outcome, `case:${n}`);
        const result = await checkCardEdit(trx, (await claimed(w, id)) as never);
        expect([outcome, status, reason, result.ok]).toEqual([outcome, status, reason, ok]);
        if (!result.ok) expect(result.code).toBe("stale_edit");
      }
    });
  });

  test("no target: not sent, text removed, another user's card, no pointer", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await setSend(w, "approved");
      const own = await rowFor(w, w.u1, w.c1, "approved", "own");
      expect((await checkCardEdit(trx, (await claimed(w, own)) as never)).ok).toBe(true);
      // The edit row of U1 that points at the card of U2.
      const foreignUser = await rowFor(w, w.u1, w.c2, "approved", "foreign-user");
      expect(await checkCardEdit(trx, (await claimed(w, foreignUser)) as never)).toEqual({
        ok: false,
        code: "no_target",
      });
      // Retention removed the card text.
      await trx.updateTable("outbox").set({ text: "[removed]" }).where("id", "=", w.c2).execute();
      const removed = await rowFor(w, w.u2, w.c2, "approved", "removed");
      expect(await checkCardEdit(trx, (await claimed(w, removed)) as never)).toEqual({ ok: false, code: "no_target" });
      // The card is not `sent` (it failed).
      await trx
        .updateTable("outbox")
        .set({ status: "failed", error_code: "blocked", sent_at: null })
        .where("id", "=", w.c1)
        .execute();
      expect(await checkCardEdit(trx, (await claimed(w, own)) as never)).toEqual({ ok: false, code: "no_target" });
    });
  });

  test("a newer edit of the card that went out makes the older row stale", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await setSend(w, "approved");
      const older = await rowFor(w, w.u1, w.c1, "approved", "older", new Date(NOW.getTime() - 1000));
      const newer = await rowFor(w, w.u1, w.c1, "approved_held", "newer", NOW);
      expect((await checkCardEdit(trx, (await claimed(w, older)) as never)).ok).toBe(true);
      await trx.updateTable("outbox").set({ status: "sent", sent_at: NOW }).where("id", "=", newer).execute();
      expect(await checkCardEdit(trx, (await claimed(w, older)) as never)).toEqual({ ok: false, code: "stale_edit" });
      // The newer row itself is not stale because of the older one.
      await trx.updateTable("outbox").set({ status: "sent", sent_at: NOW }).where("id", "=", older).execute();
      expect((await checkCardEdit(trx, (await claimed(w, newer)) as never)).ok).toBe(true);
    });
  });

  test("a card that was sent to a chat before the user linked another chat is not edited", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await setSend(w, "approved");
      // The user links a new chat after the card went out.
      await trx
        .updateTable("chat_links")
        .set({ linked_at: new Date(CARD_AT.getTime() + 1000) })
        .where("user_id", "=", w.u1)
        .execute();
      const id = await rowFor(w, w.u1, w.c1, "approved", "rechat");
      const sender = senderOf(w);
      await sender.run();
      expect(sender.channel.edited.filter((edit) => edit.chatId === w.chat1)).toEqual([]);
      expect(
        await trx.selectFrom("outbox").select(["status", "error_code"]).where("id", "=", id).executeTakeFirstOrThrow()
      ).toEqual({
        status: "failed",
        error_code: "no_target",
      });
    });
  });
});

describe("card sync: a second organization", () => {
  test("the readers and the writer stay inside the organization of the call", async () => {
    await withRollback(db, async (trx) => {
      const a = await world(trx);
      const bOrg = await createOrgWithMailbox(trx);
      const ctxB = { orgId: bOrg.orgId };
      // Organization B: its own send and card for its owner.
      const b = await insertDraftAndSend(trx, ctxB, bOrg.mailboxId, { notifiedAt: CARD_AT, createdAt: CARD_AT });
      const cardB = await insertCard(
        trx,
        { orgId: bOrg.orgId, emailId: b.emailId, sendId: b.sendId },
        bOrg.userId,
        700,
        "CARD-B"
      );
      await linkChat(trx, ctxB, bOrg.userId, randomChatId(), LINKED);

      // A decision in A edits no card of B and queues no row for B.
      await approve(depsOf(a), a.ctx, a.sendId, { userId: a.u1, via: "web", now: NOW });
      const rowsOfB = await trx
        .selectFrom("outbox")
        .select("id")
        .where("org_id", "=", bOrg.orgId)
        .where("kind", "=", "approval_edit")
        .execute();
      expect(rowsOfB).toEqual([]);
      expect((await editRows(a)).length).toBe(2);

      // The readers: a card and a sent edit of A are not visible with the context of B (and the other way round).
      expect(await getEditTarget(trx, ctxB, { targetId: a.c1, userId: a.u1 })).toBeUndefined();
      expect(await getEditTarget(trx, a.ctx, { targetId: cardB, userId: bOrg.userId })).toBeUndefined();
      expect((await getEditTarget(trx, a.ctx, { targetId: a.c1, userId: a.u1 }))?.messageId).toBe(501);
      await trx
        .updateTable("outbox")
        .set({ status: "sent", sent_at: NOW })
        .where("kind", "=", "approval_edit")
        .where("org_id", "=", a.orgId)
        .execute();
      const first = (await editRows(a))[0];
      if (first === undefined) throw new Error("no edit row");
      const probe = {
        id: "00000000-0000-4000-8000-000000000001",
        targetId: first.edit_of_outbox_id ?? "",
        createdAt: new Date(0),
      };
      expect(await newerEditSent(trx, a.ctx, probe)).toBe(true);
      expect(await newerEditSent(trx, ctxB, probe)).toBe(false);

      // The sender run edits the cards of A only.
      await trx
        .updateTable("outbox")
        .set({ status: "pending", sent_at: null })
        .where("kind", "=", "approval_edit")
        .where("org_id", "=", a.orgId)
        .execute();
      const sender = senderOf(a);
      await sender.run();
      expect(sender.channel.edited.map((edit) => edit.messageId).sort()).toEqual([501, 502]);
      // The card of B has its text and message id unchanged.
      expect(
        await trx
          .selectFrom("outbox")
          .select(["text", "external_message_id"])
          .where("id", "=", cardB)
          .executeTakeFirstOrThrow()
      ).toEqual({ text: "CARD-B", external_message_id: "700" });
    });
  });
});

describe("approval cards: version and panel link (T9, T10)", () => {
  const BASE = "https://ea.example.ts.net/";
  const t = textTables.en.approvals;

  async function notify(w: World, webBaseUrl?: string) {
    await detectNotices({
      db: w.trx,
      now: () => CARD_AT,
      startedAt: new Date(CARD_AT.getTime() - HOUR_MS),
      testMail: NO_TEST_SENDERS,
      ...(webBaseUrl === undefined ? {} : { webBaseUrl }),
    });
    const sender = senderOf(w);
    await sender.run(CARD_AT);
    return sender.channel.sent.filter((sent) => sent.message.text.includes(t.sendLine));
  }

  async function waitingWorld(trx: Transaction<DB>): Promise<World> {
    const w = await world(trx);
    // The cards of `world` stand for a sent request; this test wants a fresh send with no card.
    await trx.deleteFrom("outbox").where("org_id", "=", w.orgId).execute();
    await trx.updateTable("actions").set({ notified_at: null }).where("id", "=", w.sendId).execute();
    return w;
  }

  test("T9: the link needs the flag and the base URL; no double slash", async () => {
    await withRollback(db, async (trx) => {
      const w = await waitingWorld(trx);
      // Flag off: no link, even with a base URL.
      expect((await notify(w, BASE))[0]?.message.text).not.toContain(t.panelLine(""));
      expect((await notify(w, BASE)).length).toBe(0);
    });
    await withRollback(db, async (trx) => {
      const w = await waitingWorld(trx);
      await setOrgFeature(trx, w.ctx, { flag: "approvals_page", enabled: true, actor: "cli", now: CARD_AT });
      const cards = await notify(w, BASE);
      expect(cards.length).toBe(2);
      for (const card of cards) {
        expect(card.message.text).toContain(t.panelLine(`https://ea.example.ts.net/approvals?id=${w.sendId}`));
      }
    });
    await withRollback(db, async (trx) => {
      const w = await waitingWorld(trx);
      await setOrgFeature(trx, w.ctx, { flag: "approvals_page", enabled: true, actor: "cli", now: CARD_AT });
      // The base URL is empty: no link.
      const cards = await notify(w, undefined);
      expect(cards.length).toBe(2);
      for (const card of cards) expect(card.message.text).not.toContain("approvals?id=");
    });
  });

  test("T9b: a base URL that the view refuses leaves the link out; the card still goes out", async () => {
    await withRollback(db, async (trx) => {
      const w = await waitingWorld(trx);
      await setOrgFeature(trx, w.ctx, { flag: "approvals_page", enabled: true, actor: "cli", now: CARD_AT });
      const cards = await notify(w, "https://ea.example.test/a\nb");
      expect(cards.length).toBe(2);
      for (const card of cards) expect(card.message.text).not.toContain("approvals?id=");
    });
  });

  test("T10: version 2 says so; version 1 does not", async () => {
    await withRollback(db, async (trx) => {
      const w = await waitingWorld(trx);
      const v1 = await notify(w);
      expect(v1.length).toBe(2);
      for (const card of v1) expect(card.message.text).not.toContain(t.versionLine(1));
      for (const card of v1) expect(card.message.text).not.toContain("✏️ Version");
    });
    await withRollback(db, async (trx) => {
      const w = await waitingWorld(trx);
      await trx
        .updateTable("actions")
        .set((eb) => ({
          payload: eb.fn("jsonb_set", [eb.ref("payload"), eb.val("{version}"), eb.val("2"), eb.val(true)]),
        }))
        .where("type", "=", "create_draft")
        .where("email_id", "=", w.emailId)
        .execute();
      const v2 = await notify(w);
      expect(v2.length).toBe(2);
      for (const card of v2) expect(card.message.text).toContain(t.versionLine(2));
    });
  });
});

describe("card sync: review probes", () => {
  test("a real Postgres error inside the hook: the savepoint keeps the decision and the transaction alive", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const real = cardEditHooks({ sendScope: { kind: "all" } });
      // An invalid uuid makes `heldReason` raise 22P02 in a statement, inside the savepoint of the hook.
      const broken: ApprovalHooks = {
        onDecided: (t, c, input) => real.onDecided(t, c, { ...input, sendId: "not-a-uuid" }),
      };
      const result = await approve(depsOf(w, { kind: "all" }, broken), w.ctx, w.sendId, {
        userId: w.u1,
        via: "web",
        now: NOW,
      });
      expect(result.kind).toBe("approved");
      expect((await sendState(w)).status).toBe("approved");
      expect(await editRows(w)).toEqual([]);
      const line = [...logLines, ...errorLines].find((entry) => entry.includes("card_edits_not_queued"));
      expect(line).toBeDefined();
      const fields = JSON.parse(line ?? "{}") as Record<string, unknown>;
      // The test id is not a uuid, so the logger drops the `action_id` field: ids and codes only.
      expect(fields.error_code).toBe("22P02");
      expect(Object.keys(fields).sort()).toEqual(
        ["dropped_fields", "error", "error_code", "event", "kind", "level", "module", "msg", "time"].sort()
      );
      const audit = await trx
        .selectFrom("audit_log")
        .select("event")
        .where("org_id", "=", w.orgId)
        .where("action_id", "=", w.sendId)
        .execute();
      expect(audit.map((row) => row.event)).toContain("action.approved");
      expect((await sql<{ x: number }>`select 1 as x`.execute(trx)).rows[0]?.x).toBe(1);
    });
  });

  test("a held Telegram approval with two owners: the tap edits C1, one row for C2, no card edited twice", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const off: SendScope = { kind: "off" };
      const reject = [
        [
          {
            text: textTables.en.approvals.buttons.reject,
            data: encodeCallback({ kind: "reject", actionId: w.sendId }),
          },
        ],
      ];
      const held = edits.approvedHeld(CLOCK, textTables.en.approvals.held.scope);
      const tap = await handleCallback(
        tapDeps(w, off),
        linkOf(w, w.u1),
        encodeCallback({ kind: "approve", actionId: w.sendId })
      );
      expect(tap.edit?.text).toBe(`CARD-ONE\n\n${held}`);
      const rows = await trx
        .selectFrom("outbox")
        .select(["edit_of_outbox_id", "dedup_key", "view", "user_id"])
        .where("org_id", "=", w.orgId)
        .where("kind", "=", "approval_edit")
        .execute();
      expect(rows.map((row) => [row.edit_of_outbox_id, row.user_id, row.dedup_key])).toEqual([
        [w.c2, w.u2, `approval_edit:${w.c2}:approved_held`],
      ]);
      expect(rows[0]?.view).toMatchObject({ outcome: "approved_held", heldBy: "scope", actionId: w.sendId });
      const sender = senderOf(w);
      await sender.run();
      expect(sender.channel.edited).toEqual([
        { chatId: w.chat2, messageId: 502, message: { text: `CARD-TWO\n\n${held}`, buttons: reject } },
      ]);
      // U2 taps Reject on C2: the tap edits C2, the outbox edits C1 only.
      const tap2 = await handleCallback(
        tapDeps(w, off),
        linkOf(w, w.u2),
        encodeCallback({ kind: "reject", actionId: w.sendId })
      );
      expect(tap2.edit?.text).toBe(`CARD-TWO\n\n${edits.rejected(CLOCK)}`);
      await sender.run();
      expect(sender.channel.edited.slice(1)).toEqual([
        { chatId: w.chat1, messageId: 501, message: { text: `CARD-ONE\n\n${edits.rejected(CLOCK)}`, buttons: [] } },
      ]);
    });
  });

  test("queue side: a card whose text retention removed gets no edit row", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await trx
        .updateTable("outbox")
        .set({ text: "[removed]", view: JSON.stringify({}) })
        .where("id", "=", w.c2)
        .execute();
      await approve(depsOf(w), w.ctx, w.sendId, { userId: w.u1, via: "web", now: NOW });
      expect((await editRows(w)).map((row) => row.edit_of_outbox_id)).toEqual([w.c1]);
      const sender = senderOf(w);
      await sender.run();
      expect(sender.channel.edited.map((edit) => edit.messageId)).toEqual([501]);
      expect(JSON.stringify(sender.channel.edited)).not.toContain("[removed]");
    });
  });

  test("a re-link of the same chat after the card went out drops the edit as no_target", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await replaceChatLink(trx, w.ctx, {
        userId: w.u2,
        chatId: w.chat2,
        linkedAt: new Date(CARD_AT.getTime() + MINUTE_MS),
      });
      await approve(depsOf(w), w.ctx, w.sendId, { userId: w.u1, via: "web", now: NOW });
      const sender = senderOf(w);
      await sender.run();
      const rows = await editRows(w);
      expect(rows.find((row) => row.edit_of_outbox_id === w.c2)).toMatchObject({
        status: "failed",
        error_code: "no_target",
      });
      expect(sender.channel.edited.map((edit) => edit.messageId)).toEqual([501]);
    });
  });

  test("a card of another organization with the dedup key of this send gets no row", async () => {
    await withRollback(db, async (trx) => {
      const a = await world(trx);
      const bOrg = await createOrgWithMailbox(trx);
      const b = await insertDraftAndSend(trx, { orgId: bOrg.orgId }, bOrg.mailboxId, {
        notifiedAt: CARD_AT,
        createdAt: CARD_AT,
      });
      // Only possible by hand: a reader without the org filter would pick this card up.
      await insertCard(trx, { orgId: bOrg.orgId, emailId: b.emailId, sendId: a.sendId }, bOrg.userId, 777, "CARD-B");
      await approve(depsOf(a), a.ctx, a.sendId, { userId: a.u1, via: "web", now: NOW });
      expect((await editRows(a)).length).toBe(2);
      const rowsB = await trx
        .selectFrom("outbox")
        .select("id")
        .where("org_id", "=", bOrg.orgId)
        .where("kind", "=", "approval_edit")
        .execute();
      expect(rowsB).toEqual([]);
      expect([...logLines, ...errorLines].some((entry) => entry.includes("card_edits_not_queued"))).toBe(false);
    });
  });
});
