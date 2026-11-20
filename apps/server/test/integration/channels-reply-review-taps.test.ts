import { format } from "node:util";

import { REPLY_CONSENT_SINCE, MINUTE_MS, HOUR_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { auditEvents, recordAudit } from "../../src/modules/audit";
import { detectNotices, handleCallback } from "../../src/modules/channels";
import { listApprovals } from "../../src/modules/channels/approvals-read";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { setOrgFeature, upsertOrgFeature } from "../../src/modules/tenancy";
import type { Db } from "../../src/platform/db";

import { at, cards, consent, keysOf, T, team, threeReplies } from "./channels-reply-review-helpers";
import { insertDraftAndSend, renderedOf } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { markAnswered, sentSyncOn, sweepReply } from "./reply-answered-fixtures";

// The review cards of the reply drafts in Telegram.
const db = testDb();

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
