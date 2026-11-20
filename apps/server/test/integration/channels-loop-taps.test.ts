import { encodeCallback, type OutMessage, MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { handleCallback } from "../../src/modules/channels";
import { draftFollowUp } from "../../src/modules/loops";
import type { DB } from "../../src/platform/db";

import { ready } from "./channels-digest-brief-fixtures";
import { briefLoop, dataOf, deliverDigest, linkOf, MESSAGE_AT, tapDeps } from "./channels-loop-taps-fixtures";
import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { actionsOfLoop, loopOf } from "./loops-commands-fixtures";

// The taps on the loop lines of the brief. Every test runs in a transaction that is rolled back.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const tap = (trx: Transaction<DB>, link: ReturnType<typeof linkOf>, data: string, messageId?: number) =>
  handleCallback(tapDeps(trx), link, data, { messageId });
const lf = (loopId: string) => encodeCallback({ kind: "loop_follow_up", loopId });
const ll = (loopId: string) => encodeCallback({ kind: "loop_later", loopId });
const lc = (loopId: string) => encodeCallback({ kind: "loop_done", loopId });
const lx = (loopId: string) => encodeCallback({ kind: "loop_drop", loopId });
const lr = (loopId: string) => encodeCallback({ kind: "loop_reopen", loopId });

describe("the keyboard of the brief lines", () => {
  test("a waiting line has Draft, Later and Done; a promised line has Done and Drop; one row per line", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const waiting = await briefLoop(trx, org);
      const promised = await briefLoop(trx, org, { kind: "promised", text: "send the numbers" });
      const { message } = await deliverDigest(trx);
      const rows = message.buttons.map((row) => row.map((button) => button.data));
      expect(rows).toContainEqual([lf(waiting.id), ll(waiting.id), lc(waiting.id)]);
      expect(rows).toContainEqual([lc(promised.id), lx(promised.id)]);
      expect(message.buttons.flat().map((button) => button.text)).toEqual([
        "📝 Draft follow-up",
        "⏰ Later",
        "✓ Done",
        "✓ Done",
        "✖️ Drop",
      ]);
    });
  });

  test("no Draft button in shadow mode", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      await trx
        .updateTable("mailbox_settings")
        .set({ mode: "shadow" })
        .where("mailbox_id", "=", org.mailboxId)
        .execute();
      const loop = await briefLoop(trx, org);
      const { message } = await deliverDigest(trx);
      expect(dataOf(message)).toEqual([ll(loop.id), lc(loop.id)]);
    });
  });

  test("no Later button after the third use", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const loop = await briefLoop(trx, org, { later_count: 3 });
      const { message } = await deliverDigest(trx);
      expect(dataOf(message)).toEqual([lf(loop.id), lc(loop.id)]);
    });
  });

  test("the ⌛ line has Reopen; an uncovered user gets no loop button at all", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const stale = await briefLoop(trx, org, {
        status: "closed",
        close_reason: "stale",
        closed_at: new Date("2026-11-19T09:00:00Z"),
      });
      const { message } = await deliverDigest(trx);
      expect(dataOf(message)).toEqual([lr(stale.id)]);
    });
    await withRollback(db, async (trx) => {
      const org = await ready(trx, { consent: false });
      await briefLoop(trx, org);
      await briefLoop(trx, org, { kind: "promised" });
      const { message } = await deliverDigest(trx);
      expect(message.text).toContain("Confirm the new Telegram terms");
      expect(message.buttons).toEqual([]);
    });
  });
});

describe("the Draft button of a waiting line", () => {
  test("no Draft button while a follow-up waits for a tap, and none after two follow-ups", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const waiting = await briefLoop(trx, org);
      const twice = await briefLoop(trx, org, {
        follow_ups_sent: 2,
        last_follow_up_at: new Date("2026-11-01T09:00:00Z"),
      });
      const open = await briefLoop(trx, org);
      const planned = await draftFollowUp({ db: trx, now: () => MESSAGE_AT }, org.ctx, {
        loopId: waiting.id,
        userId: org.userId,
        via: "cli",
      });
      expect(planned.kind).toBe("planned");
      const { message } = await deliverDigest(trx);
      expect(message.text).toContain("follow-up waits for your approval");
      const rows = message.buttons.map((row) => row.map((button) => button.data));
      expect(rows).toContainEqual([ll(waiting.id), lc(waiting.id)]);
      expect(rows).toContainEqual([ll(twice.id), lc(twice.id)]);
      expect(rows).toContainEqual([lf(open.id), ll(open.id), lc(open.id)]);
    });
  });
});

describe("a tap on Draft follow-up", () => {
  test("T4 an owner taps lf on a waiting loop in assist: a follow-up pair, the toast, only the Draft button goes", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const loop = await briefLoop(trx, org);
      const { messageId, message } = await deliverDigest(trx);
      const result = await tap(trx, linkOf(org), lf(loop.id), messageId);
      expect(result.answer).toBe("Follow-up drafted. Check the card.");
      const actions = await actionsOfLoop(trx, loop.id);
      expect(actions.map((action) => action.type)).toEqual(["create_draft", "send"]);
      expect(actions.map((action) => action.idempotency_key)).toEqual([
        `${loop.id}:create_draft:follow_up:1:1`,
        `${loop.id}:send:follow_up:1:1`,
      ]);
      expect(result.edit?.text).toBe(message.text);
      expect(result.edit && dataOf(result.edit)).toEqual([ll(loop.id), lc(loop.id)]);
      // A second tap does not plan a second pair.
      const again = await tap(trx, linkOf(org), lf(loop.id), messageId);
      expect(again.answer).toBe("A follow-up already waits for your approval.");
      expect(await actionsOfLoop(trx, loop.id)).toHaveLength(2);
    });
  });
});

const outboxOf = (trx: Transaction<DB>, orgId: string) =>
  trx
    .selectFrom("outbox")
    .select(["text", "buttons", "view"])
    .where("org_id", "=", orgId)
    .where("kind", "=", "digest")
    .executeTakeFirstOrThrow();

describe("the edit of the tapped line", () => {
  test("Done marks only the tapped line and drops only its buttons; the edit is stored, so the next tap starts from it", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const waiting = await briefLoop(trx, org);
      const promised = await briefLoop(trx, org, { kind: "promised" });
      const { messageId, message } = await deliverDigest(trx);

      const done = await tap(trx, linkOf(org), lc(waiting.id), messageId);
      expect(done.answer).toBe("Done.");
      expect((await loopOf(trx, waiting.id)).close_reason).toBe("done");
      const lines = message.text.split("\n");
      const marked = done.edit?.text.split("\n") ?? [];
      expect(marked).toHaveLength(lines.length);
      expect(marked.filter((line, i) => line !== lines[i])).toEqual([`✓ ${lines.find((l) => l.startsWith("⏳"))}`]);
      expect(done.edit && dataOf(done.edit)).toEqual([lc(promised.id), lx(promised.id)]);

      // The other line: its edit keeps the first mark (the stored row follows the chat).
      const drop = await tap(trx, linkOf(org), lx(promised.id), messageId);
      expect(drop.answer).toBe("Dropped.");
      const text = drop.edit?.text ?? "";
      expect(text).toContain("✓ ⏳ No answer from anna@example.test");
      expect(text).toContain("✖️ 🤝 You promised anna@example.test");
      expect(drop.edit?.buttons).toEqual([]);
      const stored = await outboxOf(trx, org.ctx.orgId);
      expect(stored.text).toBe(text);
      expect(stored.buttons).toEqual([]);
    });
  });

  test("Later marks the line ⏰ and says the new date; Reopen marks the ⌛ line ↩️", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const waiting = await briefLoop(trx, org);
      const stale = await briefLoop(trx, org, {
        status: "closed",
        close_reason: "stale",
        closed_at: new Date("2026-11-19T09:00:00Z"),
      });
      const { messageId } = await deliverDigest(trx);
      const later = await tap(trx, linkOf(org), ll(waiting.id), messageId);
      // Friday 20.11 plus 3 working days: Wednesday 25.11, at 17:00 Warsaw time.
      expect(later.answer).toBe("Moved to Wed 25.11.");
      expect((await loopOf(trx, waiting.id)).due_at).toEqual(new Date("2026-11-25T16:00:00Z"));
      expect(later.edit?.text).toContain("⏰ ⏳ No answer from anna@example.test");
      const reopen = await tap(trx, linkOf(org), lr(stale.id), messageId);
      expect(reopen.answer).toBe("Reopened.");
      expect((await loopOf(trx, stale.id)).status).toBe("open");
      expect(reopen.edit?.text).toContain("↩️ ⌛ Closed without an answer: Offer Q1");
      expect(reopen.edit?.buttons).toEqual([]);
    });
  });

  test("Later on a loop that was moved three times: only the Later button goes, Draft and Done stay (review 19 TG3)", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const loop = await briefLoop(trx, org);
      const { messageId, message } = await deliverDigest(trx);
      expect(dataOf(message)).toEqual([lf(loop.id), ll(loop.id), lc(loop.id)]);
      // The client still shows Later, but the loop was moved three times elsewhere.
      await trx.updateTable("open_loops").set({ later_count: 3 }).where("id", "=", loop.id).execute();
      const result = await tap(trx, linkOf(org), ll(loop.id), messageId);
      expect(result.answer).toBe("This loop was moved 3 times already.");
      expect(result.edit?.text).toBe(message.text);
      expect(result.edit && dataOf(result.edit)).toEqual([lf(loop.id), lc(loop.id)]);
    });
  });

  test("a stale button that is tapped again does not mark the line twice", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const loop = await briefLoop(trx, org);
      const { messageId } = await deliverDigest(trx);
      const first = await tap(trx, linkOf(org), ll(loop.id), messageId);
      expect(first.edit?.text).toContain("⏰ ⏳ No answer");
      // A client that still shows the old keyboard taps Later again.
      const second = await tap(trx, linkOf(org), ll(loop.id), messageId);
      expect(second.answer).toMatch(/^Moved to /);
      expect(second.edit?.text).toBe(first.edit?.text);
    });
  });

  test("a tap with no message, or from another message, still acts and edits nothing", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const first = await briefLoop(trx, org);
      const second = await briefLoop(trx, org);
      const { messageId, message } = await deliverDigest(trx);
      const noMessage = await tap(trx, linkOf(org), lc(first.id));
      expect(noMessage).toEqual({ answer: "Done." });
      const other = await tap(trx, linkOf(org), lc(second.id), messageId + 1);
      expect(other).toEqual({ answer: "Done." });
      expect((await outboxOf(trx, org.ctx.orgId)).text).toBe(message.text);
    });
  });

  test("the message id of another user's digest is not edited: the stored row of that user stays", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const loop = await briefLoop(trx, org);
      const { messageId, message } = await deliverDigest(trx);
      const member = linkOf(org, { userId: org.memberId, role: "assistant" });
      const result = await tap(trx, member, lc(loop.id), messageId);
      expect(result).toEqual({ answer: "Done." });
      expect((await outboxOf(trx, org.ctx.orgId)).text).toBe(message.text);
    });
  });

  test("a message of another chat (sent before the link) is not edited", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const loop = await briefLoop(trx, org);
      const { messageId } = await deliverDigest(trx);
      const relinked = linkOf(org, { linkedAt: new Date(MESSAGE_AT.getTime() + MINUTE_MS) });
      const result = await tap(trx, relinked, lc(loop.id), messageId);
      expect(result).toEqual({ answer: "Done." });
    });
  });

  test("a loop that was closed elsewhere answers 'closed already' and its buttons go; a cleared digest keeps its text", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const first = await briefLoop(trx, org);
      const second = await briefLoop(trx, org);
      const third = await briefLoop(trx, org);
      const { messageId, message } = await deliverDigest(trx);
      await trx
        .updateTable("open_loops")
        .set({ status: "closed", close_reason: "replied", closed_at: MESSAGE_AT })
        .where("id", "=", first.id)
        .execute();
      const already = await tap(trx, linkOf(org), lc(first.id), messageId);
      expect(already.answer).toBe("This loop is closed already.");
      expect(already.edit?.text).toBe(message.text);
      // The brief lists loops with equal dates by id: compare as sets.
      expect([...dataOf(already.edit as OutMessage)].sort()).toEqual(
        [lf(second.id), ll(second.id), lc(second.id), lf(third.id), ll(third.id), lc(third.id)].sort()
      );
      // Retention, the Sent switch or an erase blanked the stored message: the chat keeps its old text, so the tap edits
      // the keyboard only. The blank marker must never replace the text of the chat message.
      await trx
        .updateTable("outbox")
        .set({ text: "[removed]", view: JSON.stringify({}) })
        .where("org_id", "=", org.ctx.orgId)
        .execute();
      const cleared = await tap(trx, linkOf(org), lc(second.id), messageId);
      expect(cleared.answer).toBe("Done.");
      expect(cleared.edit).toBeUndefined();
      expect(cleared.keyboard?.flat().map((button) => button.data)).toEqual([lf(third.id), ll(third.id), lc(third.id)]);
      const stored = await outboxOf(trx, org.ctx.orgId);
      expect(stored.text).toBe("[removed]");
      expect(stored.buttons).toEqual(JSON.parse(JSON.stringify(cleared.keyboard ?? [])));
    });
  });

  test("the digest of a loop of another organization: the tap answers like an unknown id", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const other = await createOrgWithMailbox(trx);
      const foreign = await briefLoop(trx, { ...org, ctx: { orgId: other.orgId }, mailboxId: other.mailboxId });
      const unknown = await tap(trx, linkOf(org), lc("0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"));
      const answer = await tap(trx, linkOf(org), lc(foreign.id));
      expect(answer).toEqual(unknown);
      expect(answer.answer).toBe("This item is not in your account.");
      expect((await loopOf(trx, foreign.id)).status).toBe("open");
    });
  });
});
