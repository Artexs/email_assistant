import { format } from "node:util";

import { REPLY_CONSENT_SINCE, MINUTE_MS, HOUR_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { noDelegationHooks } from "../../src/modules/actions";
import { auditEvents, recordAudit } from "../../src/modules/audit";
import {
  createOutboxSender,
  detectNotices,
  handleCallback,
  type CallbackDeps,
  type LinkedChat,
} from "../../src/modules/channels";
import { listApprovals } from "../../src/modules/channels/approvals-read";
import { listCardsOfSend, getEditTarget } from "../../src/modules/channels/card-edits-repo";
import { createFakeChannel } from "../../src/modules/channels/fake/channel";
import { cancelPendingApprovalRequestsOfClosedSends } from "../../src/modules/channels/repo/cancel";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { setOrgFeature, upsertOrgFeature } from "../../src/modules/tenancy";
import type { Db, DB } from "../../src/platform/db";

import { addMember, insertDraftAndSend, isolateChannels, linkChat, randomChatId, renderedOf } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { markAnswered, sentSyncOn, sweepOrg, sweepReply, type SweepOrg } from "./reply-answered-fixtures";

// The review cards of the reply drafts in Telegram.
const db = testDb();
const T = new Date("2026-11-20T10:00:00Z");
const at = (offsetMs: number): Date => new Date(T.getTime() + offsetMs);

let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;
let errorLines: string[] = [];

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
  owner: LinkedChat;
  member: LinkedChat;
  deps: CallbackDeps;
}

async function consent(trx: Transaction<DB>, o: SweepOrg, userId: string, version: string): Promise<void> {
  await recordAudit(trx, o.ctx, {
    event: auditEvents.webTelegramConsent,
    actor: userId,
    data: { via: "web", version },
    at: at(-2 * HOUR_MS),
  });
}

// The owner has the reply consent (unless `consented` is false); a member is linked too.
async function team(trx: Transaction<DB>, opts: { consented?: boolean; webBaseUrl?: string } = {}): Promise<Team> {
  await isolateChannels(trx);
  const o = await sweepOrg(trx);
  const memberId = await addMember(trx, o.ctx.orgId);
  await linkChat(trx, o.ctx, o.userId, randomChatId(), at(-HOUR_MS));
  await linkChat(trx, o.ctx, memberId, randomChatId(), at(-HOUR_MS));
  if (opts.consented !== false) await consent(trx, o, o.userId, REPLY_CONSENT_SINCE);
  let tick = 0;
  const link = (userId: string, role: "owner" | "assistant"): LinkedChat => ({
    orgId: o.ctx.orgId,
    userId,
    role,
    chatId: 1,
    linkedAt: at(-HOUR_MS),
    locale: "en",
  });
  const deps: CallbackDeps = {
    db: trx,
    // Each tap is one second later: the cards of one test have different `created_at`, so their order is the order of the taps.
    now: () => new Date(T.getTime() + 1000 * tick++),
    actionsScope: { kind: "all" },
    hooks: noDelegationHooks,
    uidplus: async () => true,
    sendScope: { kind: "all" },
    ...(opts.webBaseUrl === undefined ? {} : { webBaseUrl: opts.webBaseUrl }),
  };
  return { ...o, memberId, owner: link(o.userId, "owner"), member: link(memberId, "assistant"), deps };
}

// Three open replies, oldest first. The `bodyText` of the draft is the text of the card.
async function threeReplies(trx: Transaction<DB>, o: SweepOrg) {
  const first = await sweepReply(trx, o, { createdAt: at(-3 * HOUR_MS) });
  const second = await sweepReply(trx, o, { createdAt: at(-2 * HOUR_MS) });
  const third = await sweepReply(trx, o, { createdAt: at(-HOUR_MS) });
  return [first, second, third];
}

async function cards(trx: Transaction<DB>, o: SweepOrg, userId?: string) {
  let query = trx
    .selectFrom("outbox")
    .selectAll()
    .where("org_id", "=", o.ctx.orgId)
    .where("kind", "=", "approval")
    .orderBy("created_at")
    .orderBy("id");
  if (userId !== undefined) query = query.where("user_id", "=", userId);
  return query.execute();
}

const keysOf = async (trx: Transaction<DB>, o: SweepOrg) => (await cards(trx, o)).map((row) => row.dedup_key);

describe("the review: Review, Skip, Send, Reject", () => {
  test("2. Review queues the card of the oldest send; Skip the card of the second; Skip on the last says no more replies waiting", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      const [first, second, third] = await threeReplies(trx, o);

      const started = await handleCallback(o.deps, o.owner, "rv");
      expect(started).toEqual({ answer: "" });
      expect(await keysOf(trx, o)).toEqual([`approval:${first?.sendId}:r1`]);
      const card = (await cards(trx, o))[0];
      expect(card).toMatchObject({ user_id: o.userId, kind: "approval", email_id: first?.emailId, status: "pending" });
      const message = renderedOf(card as never);
      expect(message.text).toContain("✍️ Reply to boss@x.test");
      expect(message.text).toContain("To: boss@x.test");
      expect(message.text).toContain("Thank you, I will check and reply.");
      expect(message.buttons[0]?.map((button) => button.data)).toEqual([
        `ap:${first?.sendId}`,
        `ar:${first?.sendId}`,
        `rk:${first?.sendId}`,
      ]);

      // Skip the first: its card loses the buttons (no stored text yet: only the keyboard), the second card is queued.
      const skipped = await handleCallback(o.deps, o.owner, `rk:${first?.sendId}`);
      expect(skipped.answer).toBe("");
      expect(skipped.send).toBeUndefined();
      expect(await keysOf(trx, o)).toEqual([`approval:${first?.sendId}:r1`, `approval:${second?.sendId}:r1`]);

      await handleCallback(o.deps, o.owner, `rk:${second?.sendId}`);
      const lastSkip = await handleCallback(o.deps, o.owner, `rk:${third?.sendId}`);

      expect(lastSkip.send).toEqual({ text: "No more replies waiting.", buttons: [] });
      expect(await keysOf(trx, o)).toHaveLength(3);
    });
  });

  test("2b. a skipped card shows again: the next Review gives r2 of the first send (review G6)", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      const [first] = await threeReplies(trx, o);
      await handleCallback(o.deps, o.owner, "rv");
      // The first card goes out; the owner skips it, then starts a new review.
      await trx
        .updateTable("outbox")
        .set({ status: "failed", error_code: "outdated" })
        .where("kind", "=", "approval")
        .execute();
      await handleCallback(o.deps, o.owner, `rk:${first?.sendId}`);
      await trx
        .updateTable("outbox")
        .set({ status: "failed", error_code: "outdated" })
        .where("kind", "=", "approval")
        .execute();
      await handleCallback(o.deps, o.owner, "rv");

      expect((await keysOf(trx, o)).filter((key) => key.startsWith(`approval:${first?.sendId}`))).toEqual([
        `approval:${first?.sendId}:r1`,
        `approval:${first?.sendId}:r2`,
      ]);
    });
  });

  test("2c. a second Review tap while the first card waits in the outbox does not double the card", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      await threeReplies(trx, o);

      await handleCallback(o.deps, o.owner, "rv");
      await handleCallback(o.deps, o.owner, "rv");

      expect(await cards(trx, o)).toHaveLength(1);
    });
  });

  test("3. Send on a card approves the send and queues the card of the next one; Reject does the same", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      const [first, second, third] = await threeReplies(trx, o);
      await handleCallback(o.deps, o.owner, "rv");

      const sent = await handleCallback(o.deps, o.owner, `ap:${first?.sendId}`);

      expect(sent.answer).toBe("⏳ Sending within a minute.");
      const row = await trx
        .selectFrom("actions")
        .select(["status", "approved_by", "approved_via"])
        .where("id", "=", first?.sendId as string)
        .executeTakeFirstOrThrow();
      expect(row).toMatchObject({ status: "approved", approved_by: o.userId, approved_via: "telegram" });
      expect(await keysOf(trx, o)).toEqual([`approval:${first?.sendId}:r1`, `approval:${second?.sendId}:r1`]);

      const rejected = await handleCallback(o.deps, o.owner, `ar:${second?.sendId}`);

      expect(rejected.send).toBeUndefined();
      expect((await keysOf(trx, o)).at(-1)).toBe(`approval:${third?.sendId}:r1`);
      const status = await trx
        .selectFrom("actions")
        .select("status")
        .where("id", "=", second?.sendId as string)
        .executeTakeFirstOrThrow();
      expect(status.status).toBe("rejected");

      const last = await handleCallback(o.deps, o.owner, `ap:${third?.sendId}`);
      expect(last.send).toEqual({ text: "No more replies waiting.", buttons: [] });
    });
  });

  test("3b. Send on a send that is not a reply queues no review card", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      const delegation = await insertDraftAndSend(trx, o.ctx, o.mailboxId, { createdAt: at(-HOUR_MS) });
      await sweepReply(trx, o, { createdAt: at(-30 * MINUTE_MS) });

      const result = await handleCallback(o.deps, o.owner, `ap:${delegation.sendId}`);

      expect(result.send).toBeUndefined();
      expect(await cards(trx, o)).toHaveLength(0);
    });
  });

  test("4. a member who taps Review or Skip gets the owner-only answer and no card", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      const [first] = await threeReplies(trx, o);
      await consent(trx, o, o.memberId, REPLY_CONSENT_SINCE);

      for (const data of ["rv", `rv:${first?.sendId}`, `rk:${first?.sendId}`]) {
        const result = await handleCallback(o.deps, o.member, data);
        expect(result).toEqual({ answer: "Only an owner can approve or reject a send." });
      }
      expect(await cards(trx, o)).toHaveLength(0);
    });
  });

  test("5. the approval detector queues no card for a new reply send (TG2); the generic detector never shows a reply text", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      await threeReplies(trx, o);

      await detectNotices({ db: trx, now: () => T, startedAt: at(-HOUR_MS), testMail: NO_TEST_SENDERS });

      expect(await cards(trx, o)).toHaveLength(0);
      // The `replies_ready` notice is the only thing that the owner gets.
      const kinds = await trx.selectFrom("outbox").select("kind").where("org_id", "=", o.ctx.orgId).execute();
      expect(kinds.filter((row) => row.kind === "replies_ready")).toHaveLength(1);
      expect(kinds.filter((row) => row.kind === "approval")).toHaveLength(0);
    });
  });

  test("6. a send that the owner already answered (\\Answered) is left out of the review; a closed send is skipped; no sends: no more replies", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      const [first, second, third] = await threeReplies(trx, o);
      await markAnswered(trx, o, first?.emailId as string);
      await trx
        .updateTable("actions")
        .set({ status: "rejected" })
        .where("id", "=", third?.sendId as string)
        .execute();

      await handleCallback(o.deps, o.owner, "rv");

      expect(await keysOf(trx, o)).toEqual([`approval:${second?.sendId}:r1`]);
      // Skip on a send that is closed now still finds the next one by its place in the order.
      const closed = await handleCallback(o.deps, o.owner, `rk:${third?.sendId}`);
      expect(closed.send).toEqual({ text: "No more replies waiting.", buttons: [] });
    });
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      const result = await handleCallback(o.deps, o.owner, "rv");
      expect(result.send).toEqual({ text: "No more replies waiting.", buttons: [] });
    });
  });

  test("7. the flag reply_drafts off: Review answers that the drafts are off, no card", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      await threeReplies(trx, o);
      await setOrgFeature(trx, o.ctx, { flag: "reply_drafts", enabled: false, actor: "cli", now: at(-HOUR_MS) });

      expect(await handleCallback(o.deps, o.owner, "rv")).toEqual({
        answer: "Reply drafts are switched off. Nothing was sent.",
      });
      expect(await cards(trx, o)).toHaveLength(0);
    });
  });

  test("8. a tap of another organization's owner on a send that is not theirs finds nothing", async () => {
    await withRollback(db, async (trx) => {
      const a = await team(trx);
      const [pair] = await threeReplies(trx, a);
      const b = await team(trx);

      const result = await handleCallback(b.deps, b.owner, `rk:${pair?.sendId}`);

      expect(result).toEqual({ answer: "This mail is not in your account." });
      expect(await cards(trx, b)).toHaveLength(0);
    });
  });
});

describe("what the review card shows", () => {
  test("14. the card of a reply with a gap names the gap first and has no Send button; Reject and Skip stay", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      const pair = await insertDraftAndSend(trx, o.ctx, o.mailboxId, {
        kind: "reply",
        createdAt: at(-HOUR_MS),
        from: "boss@x.test",
        to: "boss@x.test",
        replyBody: "Hello,\n\nThe price is [[the price]].",
      });

      await handleCallback(o.deps, o.owner, "rv");

      const card = renderedOf((await cards(trx, o))[0] as never);
      const lines = card.text.split("\n");
      expect(lines.findIndex((line) => line.startsWith("⚠️ Fill these: the price"))).toBeLessThan(
        lines.indexOf("Draft:")
      );
      expect(card.buttons[0]?.map((button) => button.data)).toEqual([`ar:${pair.sendId}`, `rk:${pair.sendId}`]);
    });
  });

  test("15. the card names a Reply-To that differs from the From, and the Cc of the send; a Reply-To equal to the From is left out", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      const pair = await insertDraftAndSend(trx, o.ctx, o.mailboxId, {
        kind: "reply",
        createdAt: at(-HOUR_MS),
        from: "boss@x.test",
        to: "boss@x.test",
        cc: ["cc@x.test"],
      });
      await trx
        .insertInto("email_headers")
        .values({
          email_id: pair.emailId,
          org_id: o.ctx.orgId,
          reply_to: ["Boss@X.test", "team@x.test"],
          parts_known: true,
          captured_at: at(-HOUR_MS),
        })
        .execute();

      await handleCallback(o.deps, o.owner, "rv");

      expect(renderedOf((await cards(trx, o))[0] as never).text).toContain(
        "\nTo: boss@x.test\nCc: cc@x.test\nReply-To: team@x.test\n"
      );
    });
  });

  test("16. while the Sent mail is not read the card says so, and the approvals list carries sentVisible false (ApprovalItem); with the Sent read on it does not", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      await sweepReply(trx, o, { createdAt: at(-HOUR_MS) });

      await handleCallback(o.deps, o.owner, "rv");

      const card = renderedOf((await cards(trx, o))[0] as never);
      expect(card.text).toEndWith("I cannot see your sent mail; check you did not answer already.");
      const list = await listApprovals({ db: trx as unknown as Db, sendScope: { kind: "all" } }, o.ctx, T);
      expect(list.items).toHaveLength(1);
      expect(list.items[0]?.view.sentVisible).toBe(false);
      expect(list.items[0]?.view.gaps).toEqual([]);

      // The org flag and the switch of the mailbox on, and a Sent folder that was read: the view has no `sentVisible` and the card no line.
      await sentSyncOn(trx, o.ctx, o.mailboxId);
      await trx
        .updateTable("mailboxes")
        .set({ folder_map: JSON.stringify({ drafts: "Drafts", sent: "Sent" }) })
        .where("id", "=", o.mailboxId)
        .execute();
      const again = await listApprovals({ db: trx as unknown as Db, sendScope: { kind: "all" } }, o.ctx, T);
      expect(again.items[0]?.view.sentVisible).toBeUndefined();
    });
  });
});

describe("the consent check (D16)", () => {
  test("9. an owner whose consent is older: Review gives the consent line and the panel link and no card; after the consent row, cards", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx, { consented: false, webBaseUrl: "https://app.test" });
      await consent(trx, o, o.userId, "2026-11-15.2");
      await threeReplies(trx, o);
      await upsertOrgFeature(trx, o.ctx, { flag: "approvals_page", enabled: true, setBy: "test", setAt: at(-HOUR_MS) });

      const refused = await handleCallback(o.deps, o.owner, "rv");

      expect(refused.answer).toBe("");
      expect(refused.send?.text).toBe(
        "Confirm the new Telegram terms in the panel to review here.\nOpen in panel: https://app.test/approvals"
      );
      expect(refused.send?.buttons).toEqual([]);
      expect(await cards(trx, o)).toHaveLength(0);

      // The panel button and `POST /api/telegram/consent` write the row of the new version: cards follow.
      await consent(trx, o, o.userId, REPLY_CONSENT_SINCE);
      await handleCallback(o.deps, o.owner, "rv");
      expect(await cards(trx, o)).toHaveLength(1);
    });
  });

  test("9b. no consent row at all, and a consent that an unlink withdrew, are not covered", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx, { consented: false });
      await threeReplies(trx, o);
      expect((await handleCallback(o.deps, o.owner, "rv")).send?.text).toContain("Confirm the new Telegram terms");

      await consent(trx, o, o.userId, REPLY_CONSENT_SINCE);
      await recordAudit(trx, o.ctx, {
        event: auditEvents.chatUnlinked,
        actor: o.userId,
        data: { user_id: o.userId },
        at: at(-HOUR_MS),
      });
      expect((await handleCallback(o.deps, o.owner, "rv")).send?.text).toContain("Confirm the new Telegram terms");
      expect(await cards(trx, o)).toHaveLength(0);
    });
  });

  test("9c. a Skip by an owner whose consent was withdrawn queues no card either", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx, { consented: false });
      const [first] = await threeReplies(trx, o);
      const result = await handleCallback(o.deps, o.owner, `rk:${first?.sendId}`);
      expect(result.send?.text).toContain("Confirm the new Telegram terms");
      // The tap changes nothing: no edit of the card, no change of its buttons.
      expect(result.edit).toBeUndefined();
      expect(result.keyboard).toBeUndefined();
      expect(await cards(trx, o)).toHaveLength(0);
    });
  });

  test("9d. an owner without consent who taps Send on an old card is not given the next card", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx, { consented: false });
      const [first] = await threeReplies(trx, o);

      const result = await handleCallback(o.deps, o.owner, `ap:${first?.sendId}`);

      expect(result.send?.text).toContain("Confirm the new Telegram terms");
      expect(await cards(trx, o)).toHaveLength(0);
    });
  });
});

describe("the review cards and the F102 card sync", () => {
  test("10. listCardsOfSend finds the plain card and the review cards of a send; getEditTarget names the send; a pending review card of a closed send fails", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      const [first, second] = await threeReplies(trx, o);
      await handleCallback(o.deps, o.owner, "rv");
      await trx
        .updateTable("outbox")
        .set({ status: "sent", external_message_id: "77", sent_at: at(MINUTE_MS), text: "card text" })
        .where("kind", "=", "approval")
        .execute();
      await handleCallback(o.deps, o.owner, `rk:${first?.sendId}`);
      await trx
        .updateTable("outbox")
        .set({ status: "sent", external_message_id: "78", sent_at: at(MINUTE_MS), text: "card text" })
        .where("kind", "=", "approval")
        .execute();
      await handleCallback(o.deps, o.owner, "rv");
      const all = await cards(trx, o);
      expect(all.map((row) => row.dedup_key)).toContain(`approval:${first?.sendId}:r2`);

      const found = await listCardsOfSend(trx, o.ctx, first?.sendId as string);
      expect(found.map((card) => card.id).sort()).toEqual(
        all
          .filter((row) => row.dedup_key.startsWith(`approval:${first?.sendId}`))
          .map((row) => row.id)
          .sort()
      );
      expect(found).toHaveLength(2);
      await trx
        .updateTable("outbox")
        .set({ status: "sent", external_message_id: "79", sent_at: at(MINUTE_MS), text: "card text" })
        .where("kind", "=", "approval")
        .execute();
      for (const card of all.filter((row) => row.dedup_key.startsWith(`approval:${first?.sendId}`))) {
        const target = await getEditTarget(trx, o.ctx, { targetId: card.id, userId: o.userId });
        expect(target?.sendId).toBe(first?.sendId);
      }
      // A card of another send is not found.
      expect((await listCardsOfSend(trx, o.ctx, second?.sendId as string)).map((card) => card.id)).not.toContain(
        found[0]?.id
      );

      // A review card that no sender took, of a send that still waits, stays as it is.
      await trx
        .updateTable("outbox")
        .set({ status: "pending", external_message_id: null, sent_at: null })
        .where("dedup_key", "=", `approval:${first?.sendId}:r2`)
        .execute();
      expect(await cancelPendingApprovalRequestsOfClosedSends(trx, o.ctx, { staleBefore: at(-HOUR_MS) })).toBe(0);
      // A review card that no sender took, of a send that is closed now: `failed` / `outdated`.
      await trx
        .updateTable("outbox")
        .set({ status: "pending", external_message_id: null, sent_at: null })
        .where("dedup_key", "=", `approval:${first?.sendId}:r2`)
        .execute();
      await trx
        .updateTable("actions")
        .set({ status: "rejected" })
        .where("id", "=", first?.sendId as string)
        .execute();
      const cancelled = await cancelPendingApprovalRequestsOfClosedSends(trx, o.ctx, { staleBefore: at(-HOUR_MS) });
      expect(cancelled).toBeGreaterThanOrEqual(1);
      const row = await trx
        .selectFrom("outbox")
        .select(["status", "error_code"])
        .where("dedup_key", "=", `approval:${first?.sendId}:r2`)
        .executeTakeFirstOrThrow();
      expect(row).toMatchObject({ status: "failed", error_code: "outdated" });
    });
  });

  test("11. a decision on the send in the panel edits the sent review card of the owner (card sync finds the key r<n>)", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      const [first] = await threeReplies(trx, o);
      await handleCallback(o.deps, o.owner, "rv");
      await trx
        .updateTable("outbox")
        .set({ status: "sent", external_message_id: "91", sent_at: at(MINUTE_MS), text: "✍️ Reply card" })
        .where("kind", "=", "approval")
        .execute();
      const { reject } = await import("../../src/modules/actions");

      await reject(
        {
          db: trx,
          hooks: noDelegationHooks,
          approvalHooks: (await import("../../src/modules/channels/card-edits")).cardEditHooks({
            sendScope: { kind: "all" },
          }),
          uidplus: async () => true,
        } as never,
        o.ctx,
        first?.sendId as string,
        { userId: o.userId, via: "web", now: T }
      );

      const edits = await trx
        .selectFrom("outbox")
        .selectAll()
        .where("org_id", "=", o.ctx.orgId)
        .where("kind", "=", "approval_edit")
        .execute();
      expect(edits).toHaveLength(1);
      expect(edits[0]?.dedup_key).toMatch(/^approval_edit:[0-9a-f-]{36}:rejected$/);
    });
  });

  test("12. a tap on the sent review card edits that card (the tap names its message), not another card of the send", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      const [first] = await threeReplies(trx, o);
      await handleCallback(o.deps, o.owner, "rv");
      const sendCard = (key: string, messageId: string, text: string) =>
        trx
          .updateTable("outbox")
          .set({ status: "sent", external_message_id: messageId, sent_at: at(MINUTE_MS), text })
          .where("dedup_key", "=", key)
          .execute();
      await sendCard(`approval:${first?.sendId}:r1`, "91", "✍️ Reply card one");
      // The owner skipped it and asked for the review again: the same send has a second card.
      await handleCallback(o.deps, o.owner, `rk:${first?.sendId}`);
      await trx
        .updateTable("outbox")
        .set({ status: "failed", error_code: "outdated" })
        .where("dedup_key", "like", "approval:%:r1")
        .where("status", "=", "pending")
        .execute();
      await handleCallback(o.deps, o.owner, "rv");
      await sendCard(`approval:${first?.sendId}:r2`, "92", "✍️ Reply card two");

      const skipped = await handleCallback(o.deps, o.owner, `rk:${first?.sendId}`, { messageId: 91 });

      expect(skipped.edit).toEqual({
        text: "✍️ Reply card one\n\n⏭ Skipped 11:00. The draft stays in the panel.",
        buttons: [],
      });
      const other = await handleCallback(o.deps, o.owner, `rk:${first?.sendId}`, { messageId: 92 });
      expect(other.edit?.text).toStartWith("✍️ Reply card two");
    });
  });
});

describe("the sender: review cards are not held in quiet hours", () => {
  test("13. a review card goes out at 23:00 org time; a replies_ready row of the same hour waits", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      const night = new Date("2026-11-20T22:00:00Z");
      const [first] = await threeReplies(trx, o);
      const ready = await trx
        .insertInto("outbox")
        .values({
          org_id: o.ctx.orgId,
          user_id: o.userId,
          kind: "replies_ready",
          dedup_key: `replies_ready:${o.userId}:${first?.sendId}`,
          view: JSON.stringify({ count: 3, now: night.toISOString(), timeZone: "Europe/Warsaw", review: true }),
          locale: "en",
          status: "pending",
          attempts: 0,
          created_at: night,
          next_attempt_at: night,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const nightDeps: CallbackDeps = { ...o.deps, now: () => night };
      await handleCallback(nightDeps, o.owner, "rv");
      const channel = createFakeChannel();

      await createOutboxSender({ db: trx, channel, now: () => night }).run();

      const states = await trx
        .selectFrom("outbox")
        .select(["id", "kind", "status"])
        .where("org_id", "=", o.ctx.orgId)
        .where("kind", "in", ["approval", "replies_ready"])
        .execute();
      expect(states.find((row) => row.kind === "approval")?.status).toBe("sent");
      expect(states.find((row) => row.id === ready.id)?.status).toBe("pending");
      expect(channel.sent.filter((sent) => sent.message.text.includes("Reply to"))).toHaveLength(1);
    });
  });
});

describe("review repair: other kinds, refused cards, plain cards in quiet hours", () => {
  test("TG1. a clarification send next to replies is not shown as a review card and is not a reply to skip to", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      const clarification = await insertDraftAndSend(trx, o.ctx, o.mailboxId, {
        kind: "clarification",
        to: "boss@x.test",
        createdAt: at(-4 * HOUR_MS),
      });
      const [reply] = await threeReplies(trx, o);

      await handleCallback(o.deps, o.owner, "rv");

      expect(await keysOf(trx, o)).toEqual([`approval:${reply?.sendId}:r1`]);
      const next = await handleCallback(o.deps, o.owner, `rv:${clarification.sendId}`);
      expect(next).toEqual({ answer: "" });
      expect((await keysOf(trx, o)).every((key) => !key.includes(clarification.sendId))).toBe(true);
    });
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      await insertDraftAndSend(trx, o.ctx, o.mailboxId, {
        kind: "clarification",
        to: "boss@x.test",
        createdAt: at(-HOUR_MS),
      });

      const result = await handleCallback(o.deps, o.owner, "rv");

      expect(result.send).toEqual({ text: "No more replies waiting.", buttons: [] });
      expect(await cards(trx, o)).toHaveLength(0);
    });
  });

  test("TG3. Skip on a send that is not a reply does nothing: not found, no card, the send is unchanged", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      const delegation = await insertDraftAndSend(trx, o.ctx, o.mailboxId, { createdAt: at(-2 * HOUR_MS) });
      await threeReplies(trx, o);

      const result = await handleCallback(o.deps, o.owner, `rk:${delegation.sendId}`);

      expect(result).toEqual({ answer: "This mail is not in your account." });
      expect(await cards(trx, o)).toHaveLength(0);
      const send = await trx
        .selectFrom("actions")
        .select(["status", "notified_at"])
        .where("id", "=", delegation.sendId)
        .executeTakeFirstOrThrow();
      expect(send).toMatchObject({ status: "awaiting_approval", notified_at: null });
    });
  });

  // Ten Cc addresses that together do not fit one message (the recipients of a card are never cut).
  const longCc = Array.from(
    { length: 10 },
    (_, index) => `${"a".repeat(60)}${index}@${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.test`
  );

  test("N6. a card that the renderer refuses is skipped: the next reply shows, nothing is marked, the log holds the id only", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      const bad = await insertDraftAndSend(trx, o.ctx, o.mailboxId, {
        kind: "reply",
        createdAt: at(-3 * HOUR_MS),
        from: "boss@x.test",
        to: "boss@x.test",
        cc: longCc,
      });
      const good = await sweepReply(trx, o, { createdAt: at(-2 * HOUR_MS) });
      const lines: string[] = [];
      logSpy.mockImplementation((...args: unknown[]) => {
        lines.push(format(...args));
      });

      const result = await handleCallback(o.deps, o.owner, "rv");

      expect(result).toEqual({ answer: "" });
      expect(await keysOf(trx, o)).toEqual([`approval:${good.sendId}:r1`]);
      const row = await trx
        .selectFrom("actions")
        .select(["status", "notified_at"])
        .where("id", "=", bad.sendId)
        .executeTakeFirstOrThrow();
      expect(row).toMatchObject({ status: "awaiting_approval", notified_at: null });
      const warn = [...lines, ...errorLines].filter((line) => line.includes("notice_skipped"));
      expect(warn).toHaveLength(1);
      expect(warn[0]).toContain(`item_id=${bad.sendId}`);
      expect([...lines, ...errorLines].join("\n")).not.toContain("aaaaaaaaaa");
    });
    // Only a refused card: "no more replies", and still nothing is marked.
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      const bad = await insertDraftAndSend(trx, o.ctx, o.mailboxId, {
        kind: "reply",
        createdAt: at(-3 * HOUR_MS),
        from: "boss@x.test",
        to: "boss@x.test",
        cc: longCc,
      });

      const result = await handleCallback(o.deps, o.owner, "rv");

      expect(result.send).toEqual({ text: "No more replies waiting.", buttons: [] });
      expect(await cards(trx, o)).toHaveLength(0);
      const row = await trx
        .selectFrom("actions")
        .select("notified_at")
        .where("id", "=", bad.sendId)
        .executeTakeFirstOrThrow();
      expect(row.notified_at).toBeNull();
    });
  });

  test("TG2. a plain approval card (`approval:<send>`) is held in quiet hours; only a review card (`:r<n>`) goes out", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      const night = new Date("2026-11-20T22:00:00Z");
      const pair = await insertDraftAndSend(trx, o.ctx, o.mailboxId, {
        kind: "clarification",
        to: "boss@x.test",
        createdAt: at(-HOUR_MS),
      });
      const view = {
        actionId: pair.sendId,
        now: night.toISOString(),
        timeZone: "Europe/Warsaw",
        view: {
          kind: "clarification",
          recipient: { name: null, address: "boss@x.test" },
          sender: null,
          recipientInactive: false,
          subject: "Re: x",
          dueDate: null,
          body: "Hello",
          quote: null,
          synthetic: false,
        },
      };
      await trx
        .insertInto("outbox")
        .values({
          org_id: o.ctx.orgId,
          user_id: o.userId,
          kind: "approval",
          dedup_key: `approval:${pair.sendId}`,
          email_id: pair.emailId,
          view: JSON.stringify(view),
          locale: "en",
          status: "pending",
          attempts: 0,
          created_at: night,
          next_attempt_at: night,
        })
        .execute();
      const channel = createFakeChannel();

      await createOutboxSender({ db: trx, channel, now: () => night }).run();

      const row = await trx
        .selectFrom("outbox")
        .select(["status", "next_attempt_at"])
        .where("dedup_key", "=", `approval:${pair.sendId}`)
        .executeTakeFirstOrThrow();
      expect(row.status).toBe("pending");
      expect(row.next_attempt_at.toISOString()).toBe("2026-11-21T06:00:00.000Z");
    });
  });
});
