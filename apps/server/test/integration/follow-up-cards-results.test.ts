// The result notice and the failure notice of a follow-up, and the notice of a send held by a limit. Every test runs in a transaction that is rolled back.
// The shared world of these tests is in `follow-up-cards-helpers.ts`.
import { format } from "node:util";

import { MINUTE_MS, HOUR_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { at, world, run, outbox, users } from "./follow-up-cards-helpers";
import { insertFollowUp } from "./follow-up-fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();
afterAll(async () => {
  await db.destroy();
});

// The notice code logs and warns about rows it skips; these tests read the output.
let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;
let warnSpy: ReturnType<typeof spyOn>;
let warnings: string[] = [];
beforeEach(() => {
  warnings = [];
  logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
  errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    warnings.push(format(...args));
  });
  warnSpy = spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(format(...args));
  });
});
afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  warnSpy.mockRestore();
});

describe("T8 the result notice of a follow-up", () => {
  test("an applied follow-up: one send_result per covered owner with the loop id and no mail id; the others get the result line", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const f = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {
        to: ["anna@example.test"],
        sendStatus: "applied",
        notifiedAt: at(-HOUR_MS),
        send: { provider_result: JSON.stringify({ sent_copy: "appended" }), applied_at: at(-10 * MINUTE_MS) },
      });
      await run(trx);
      const results = await outbox(trx, w.orgId, "send_result");
      expect(users(results)).toEqual([w.owner, w.owner2].sort());
      for (const row of results) {
        expect(row.loop_id).toBe(f.loopId);
        expect(row.email_id).toBeNull();
        expect(row.text).toBe("✅ Follow-up sent to anna@example.test");
        expect(row.buttons).toEqual([]);
      }
      const lines = await outbox(trx, w.orgId, "loop_consent");
      expect(users(lines)).toEqual([w.oldOwner, w.noConsentOwner].sort());
      expect(lines.every((line) => line.text?.startsWith("A follow-up has a new result in the panel."))).toBe(true);
      expect(JSON.stringify(lines)).not.toContain("anna@example.test");
      const mark = await trx
        .selectFrom("actions")
        .select("result_notified_at")
        .where("id", "=", f.sendId)
        .executeTakeFirstOrThrow();
      expect(mark.result_notified_at).not.toBeNull();
    });
  });

  test("a rejected and an expired follow-up end in a result too", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const rejected = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {
        sendStatus: "rejected",
        notifiedAt: at(-HOUR_MS),
      });
      const expired = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {
        sendStatus: "expired",
        notifiedAt: at(-HOUR_MS),
      });
      await trx.updateTable("actions").set({ status_reason: "loop_closed" }).where("id", "=", expired.sendId).execute();
      await run(trx);
      const texts = (await outbox(trx, w.orgId, "send_result"))
        .filter((row) => row.user_id === w.owner)
        .map((row) => row.dedup_key);
      expect(texts.sort()).toEqual([`send_result:${rejected.sendId}`, `send_result:${expired.sendId}`].sort());
      const expiredRow = (await outbox(trx, w.orgId, "send_result")).find(
        (row) => row.dedup_key === `send_result:${expired.sendId}` && row.user_id === w.owner
      );
      expect(expiredRow?.text).toBe("⌛ Follow-up not sent: the open loop was closed.");
    });
  });

  test("an edited Drafts copy ends a follow-up as draft_changed: one result row per owner with the loop id and no mail id", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const changed = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {
        sendStatus: "expired",
        notifiedAt: at(-HOUR_MS),
      });
      await trx
        .updateTable("actions")
        .set({ status_reason: "draft_changed" })
        .where("id", "=", changed.sendId)
        .execute();

      await run(trx);

      const row = (await outbox(trx, w.orgId, "send_result")).find(
        (found) => found.dedup_key === `send_result:${changed.sendId}` && found.user_id === w.owner
      );
      expect(row?.text).toBe("✏️ Follow-up not sent: you edited this draft in your mail client. Send it from there.");
      expect(row?.loop_id).not.toBeNull();
      expect(row?.email_id).toBeNull();
    });
  });
});

describe("T3b a failed follow-up: one fixed action_failed notice, no recipient, no text", () => {
  test("a failure at SMTP gives one row per owner with the loop id and the fixed text; a failed mail send keeps its result line", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const f = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {
        to: ["secret-anna@example.test"],
        subject: "SECRET-SUBJECT",
        sendStatus: "failed",
        notifiedAt: at(-HOUR_MS),
        send: { status_reason: "smtp_error", attempts: 3 },
      });
      const unknown = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {
        sendStatus: "failed",
        notifiedAt: at(-HOUR_MS),
        send: { status_reason: "outcome_unknown" },
      });
      const { insertDraftAndSend } = await import("./fixtures");
      const mail = await insertDraftAndSend(trx, w.ctx, w.mailboxId, {
        sendStatus: "failed",
        notifiedAt: at(-HOUR_MS),
      });
      await run(trx);

      const failed = (await outbox(trx, w.orgId, "action_failed")).filter((row) => row.loop_id !== null);
      // Two follow-ups, four owners; the member and nobody else is left out.
      expect(failed).toHaveLength(8);
      expect(users(failed.filter((row) => row.dedup_key === `action_failed:${f.sendId}`))).toEqual(
        [w.owner, w.owner2, w.oldOwner, w.noConsentOwner].sort()
      );
      for (const row of failed) {
        expect(row.email_id).toBeNull();
        expect(row.buttons).toEqual([]);
      }
      const texts = (id: string) => [
        ...new Set(failed.filter((row) => row.dedup_key === `action_failed:${id}`).map((row) => row.text)),
      ];
      expect(texts(f.sendId)).toEqual([
        "⚠️ A follow-up could not be sent. Nothing went out.\nOpen in panel: https://panel.example.test/approvals",
      ]);
      expect(texts(unknown.sendId)).toEqual([
        "⚠️ A follow-up may have been sent: the connection broke after the text went out. Check your Sent folder before you write another.\nOpen in panel: https://panel.example.test/approvals",
      ]);
      // Neither the recipient nor the subject is in any stored row, and a failed follow-up gets no result line.
      expect(JSON.stringify(failed)).not.toContain("secret-anna@example.test");
      expect(JSON.stringify(failed)).not.toContain("SECRET-SUBJECT");
      expect((await outbox(trx, w.orgId, "send_result")).filter((row) => row.loop_id !== null)).toEqual([]);
      // The result detector never even tried it: no skipped-notice warning for a failed follow-up.
      expect(warnings.filter((line) => line.includes("notice_skipped kind=send_result"))).toEqual([]);
      // The mail send is told by its result line, once, with the Send again button; the follow-up marks keep a rerun quiet.
      expect((await outbox(trx, w.orgId, "send_result")).filter((row) => row.email_id === mail.emailId)).toHaveLength(
        4
      );
      const total = (await outbox(trx, w.orgId)).length;
      await run(trx);
      expect((await outbox(trx, w.orgId)).length).toBe(total);
    });
  });

  test("with no linked owner nothing is queued or marked, so the notice comes when an owner links", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const f = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {
        sendStatus: "failed",
        notifiedAt: at(-HOUR_MS),
      });
      // Only the assistant keeps a chat: the organization is visited, but it has no owner to tell.
      await trx.deleteFrom("chat_links").where("org_id", "=", w.orgId).where("user_id", "<>", w.member).execute();
      await run(trx);
      const mark = await trx
        .selectFrom("actions")
        .select("result_notified_at")
        .where("id", "=", f.sendId)
        .executeTakeFirstOrThrow();
      expect(mark.result_notified_at).toBeNull();
    });
  });
});

describe("a send held by a limit (G13)", () => {
  test("approved follow-ups held by a limit give one fixed send_held line per owner and day; the mail hold keeps its own", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const held = { last_error: "send_limit:mailbox_hour", next_attempt_at: at(HOUR_MS) };
      await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, { sendStatus: "approved", send: held });
      await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, { sendStatus: "approved", send: held });
      await run(trx);
      const rows = await outbox(trx, w.orgId, "send_held");
      expect(users(rows)).toEqual([w.owner, w.owner2, w.oldOwner, w.noConsentOwner].sort());
      for (const row of rows) {
        expect(row.dedup_key).toBe(`send_held_follow_up:${w.mailboxId}:2026-11-20`);
        expect(row.text?.split("\n")[0]).toBe(
          "⏸ A follow-up waits: the hourly send limit of this mailbox is reached."
        );
        expect(row.text).toContain("2 waiting");
        expect(row.text).toContain("Open in panel: https://panel.example.test/approvals");
        expect(row.text).not.toContain("@");
      }
      await run(trx);
      expect(await outbox(trx, w.orgId, "send_held")).toHaveLength(4);
      // When the hold ends, a notice that no sender took yet is cancelled.
      await trx
        .updateTable("actions")
        .set({ next_attempt_at: at(-MINUTE_MS) })
        .where("org_id", "=", w.orgId)
        .execute();
      await run(trx);
      expect((await outbox(trx, w.orgId, "send_held")).every((row) => row.status === "failed")).toBe(true);
    });
  });
});
