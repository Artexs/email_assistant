// The follow-up card, the consent gate and the one choke point of the gate. Every test runs in a transaction that is rolled back.
// The other parts of these cards are in `follow-up-cards-results.test.ts`, `follow-up-cards-closed.test.ts`, `follow-up-cards-races.test.ts` and `follow-up-cards-refused.test.ts`.
import { format } from "node:util";

import { MINUTE_MS, HOUR_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { auditEvents, recordAudit } from "../../src/modules/audit";
import { loopConsentOf } from "../../src/modules/channels";

import { addMember, createOrgWithMailbox } from "./fixtures";
import { at, world, run, outbox, users } from "./follow-up-cards-helpers";
import { CURRENT_CONSENT, consentRow, insertFollowUp, unlinkRow } from "./follow-up-fixtures";
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

describe("T4 the approval card of a follow-up and the consent gate", () => {
  test("one card per owner whose consent covers loop data; the others get one fixed line, a member nothing", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const f = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {
        to: ["anna@example.test"],
        cc: ["jan@example.test", "ewa@example.test"],
        subject: "Offer Q1",
      });
      await run(trx);

      const cards = await outbox(trx, w.orgId, "approval");
      expect(users(cards)).toEqual([w.owner, w.owner2].sort());
      for (const card of cards) {
        expect(card.loop_id).toBe(f.loopId);
        expect(card.email_id).toBeNull();
        expect(card.dedup_key).toBe(`approval:${f.sendId}`);
        expect(card.text).toContain("📝 Follow-up\nTo: anna@example.test\nCc: jan@example.test, ewa@example.test");
        expect(card.text).toContain("Follow-up 1 of 2");
        expect(card.text).toContain(`Open in panel: https://panel.example.test/approvals?id=${f.sendId}`);
        expect(card.buttons.flat().map((button) => button.data)).toEqual([`ap:${f.sendId}`, `ar:${f.sendId}`]);
      }

      // The owner with an old consent and the owner with no consent row get the same one line: no recipient, no subject, no text.
      const lines = await outbox(trx, w.orgId, "loop_consent");
      expect(users(lines)).toEqual([w.oldOwner, w.noConsentOwner].sort());
      for (const line of lines) {
        expect(line.text).toBe(
          "A follow-up waits for your approval in the panel.\nOpen in panel: https://panel.example.test/approvals"
        );
        expect(line.view).toEqual({ about: "approval", panelUrl: "https://panel.example.test/approvals" });
        expect(line.loop_id).toBeNull();
        expect(line.email_id).toBeNull();
        expect(line.dedup_key).toMatch(/^loop_consent:approval:2026-11-20$/);
      }
      // No notice of any kind went to the member, and no outbox row holds the recipient for a withheld owner.
      expect((await outbox(trx, w.orgId)).filter((row) => row.user_id === w.member)).toEqual([]);
      for (const user of [w.oldOwner, w.noConsentOwner]) {
        const own = (await outbox(trx, w.orgId)).filter((row) => row.user_id === user);
        expect(JSON.stringify(own)).not.toContain("anna@example.test");
        expect(JSON.stringify(own)).not.toContain("Offer Q1");
      }
      // The send is marked: a second run queues nothing.
      const before = (await outbox(trx, w.orgId)).length;
      await run(trx);
      expect((await outbox(trx, w.orgId)).length).toBe(before);
    });
  });

  test("ten follow-ups in a day give an uncovered owner one line", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      for (let i = 0; i < 10; i += 1) await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {});
      await run(trx);
      expect((await outbox(trx, w.orgId, "loop_consent")).filter((row) => row.user_id === w.oldOwner)).toHaveLength(1);
      expect((await outbox(trx, w.orgId, "approval")).filter((row) => row.user_id === w.owner)).toHaveLength(10);
    });
  });

  test("the line has no panel link when the panel page is off or the base URL is unset", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {});
      await run(trx, null);
      for (const line of await outbox(trx, w.orgId, "loop_consent")) {
        expect(line.text).toBe("A follow-up waits for your approval in the panel.");
        expect(line.view).toEqual({ about: "approval" });
      }
    });
  });

  test("a withdrawn consent: a consent older than the last unlink does not count, a newer one does", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await unlinkRow(trx, w.orgId, w.owner2, at(-30 * MINUTE_MS)); // owner2 unlinked after the consent at -1 h
      await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {});
      await run(trx);
      expect(users(await outbox(trx, w.orgId, "approval"))).toEqual([w.owner]);
      expect(users(await outbox(trx, w.orgId, "loop_consent"))).toEqual(
        [w.oldOwner, w.noConsentOwner, w.owner2].sort()
      );
    });
  });

  test("a follow-up whose recipients cannot fit a card: no card, the panel keeps it, the next detector still runs", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const long = Array.from({ length: 10 }, (_, i) => `${"x".repeat(240)}${i}@example.test`);
      const f = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, { to: long.slice(0, 5), cc: long.slice(5) });
      // A later detector of the same organization (an expired send result) still gets its row.
      const ended = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {
        sendStatus: "expired",
        notifiedAt: at(-HOUR_MS),
      });
      await trx.updateTable("actions").set({ status_reason: "timeout" }).where("id", "=", ended.sendId).execute();
      await run(trx);
      expect(await outbox(trx, w.orgId, "approval")).toEqual(
        // The long one gives no card; the ended one was notified already.
        []
      );
      const left = await trx
        .selectFrom("actions")
        .select("notified_at")
        .where("id", "=", f.sendId)
        .executeTakeFirstOrThrow();
      expect(left.notified_at).toBeNull();
      expect(await outbox(trx, w.orgId, "send_result")).not.toHaveLength(0);
    });
  });

  test("a draft that names another loop than its send gets no card: the owner never sees text that the loop did not make", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const f = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {});
      const other = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, { sendStatus: "rejected" });
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify({ ...f.draftPayload, loop_id: other.loopId }) })
        .where(
          "id",
          "=",
          (
            await trx
              .selectFrom("actions")
              .select("depends_on_action_id")
              .where("id", "=", f.sendId)
              .executeTakeFirstOrThrow()
          ).depends_on_action_id ?? ""
        )
        .execute();
      await run(trx);
      expect(
        (await outbox(trx, w.orgId, "approval")).filter((row) => row.dedup_key === `approval:${f.sendId}`)
      ).toEqual([]);
      const row = await trx
        .selectFrom("actions")
        .select("notified_at")
        .where("id", "=", f.sendId)
        .executeTakeFirstOrThrow();
      expect(row.notified_at).toBeNull();
    });
  });

  test("a mail send keeps going to every owner: the gate is for loop data only", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const { insertDraftAndSend } = await import("./fixtures");
      const mail = await insertDraftAndSend(trx, w.ctx, w.mailboxId, { createdAt: at(-HOUR_MS) });
      await run(trx);
      const cards = await outbox(trx, w.orgId, "approval");
      expect(users(cards)).toEqual([w.owner, w.owner2, w.oldOwner, w.noConsentOwner].sort());
      expect(cards.every((card) => card.email_id === mail.emailId && card.loop_id === null)).toBe(true);
      expect(await outbox(trx, w.orgId, "loop_consent")).toEqual([]);
    });
  });
});

describe("loopConsentOf: the one choke point of the gate", () => {
  test("border: the current version covers, the version before does not, a garbage or future version does not", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const ids = [w.owner, w.oldOwner, w.noConsentOwner, w.member];
      expect([...(await loopConsentOf(trx, w.ctx, ids))].sort()).toEqual([w.owner, w.member].sort());
      expect(await loopConsentOf(trx, w.ctx, [])).toEqual(new Set());
      const other = await addMember(trx, w.orgId, "owner");
      for (const version of ["garbage", "", "2026-11-15.", "2026-11-15.x", "20261115", "2026-11-14"]) {
        await consentRow(trx, w.orgId, other, version, at(-10 * MINUTE_MS));
        expect((await loopConsentOf(trx, w.ctx, [other])).has(other)).toBe(false);
      }
      await consentRow(trx, w.orgId, other, "2026-11-16", at(-5 * MINUTE_MS));
      expect((await loopConsentOf(trx, w.ctx, [other])).has(other)).toBe(true);
    });
  });

  test("border: a consent row at the exact time of the unlink row does not count; one millisecond later does", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const user = await addMember(trx, w.orgId, "owner");
      await consentRow(trx, w.orgId, user, CURRENT_CONSENT, at(-10 * MINUTE_MS));
      expect((await loopConsentOf(trx, w.ctx, [user])).has(user)).toBe(true);
      await unlinkRow(trx, w.orgId, user, at(-10 * MINUTE_MS));
      expect((await loopConsentOf(trx, w.ctx, [user])).has(user)).toBe(false);
      await consentRow(trx, w.orgId, user, CURRENT_CONSENT, at(-10 * MINUTE_MS + 1));
      expect((await loopConsentOf(trx, w.ctx, [user])).has(user)).toBe(true);
      // A later unlink withdraws it again; an unlink of another user does not.
      await unlinkRow(trx, w.orgId, w.owner, at(-5 * MINUTE_MS));
      expect((await loopConsentOf(trx, w.ctx, [user])).has(user)).toBe(true);
      await unlinkRow(trx, w.orgId, user, at(-5 * MINUTE_MS));
      expect((await loopConsentOf(trx, w.ctx, [user])).has(user)).toBe(false);
    });
  });

  test("only a chat.unlinked row withdraws: another audit event with the same user id, newer than the consent, does not", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      for (const event of [auditEvents.orgMemberAdded, auditEvents.chatLinked, auditEvents.webTelegramConsent]) {
        await recordAudit(
          trx,
          { orgId: w.orgId },
          { event, actor: "cli", data: { user_id: w.owner, role: "owner" }, at: at(-5 * MINUTE_MS) }
        );
      }
      expect((await loopConsentOf(trx, w.ctx, [w.owner])).has(w.owner)).toBe(true);
      await unlinkRow(trx, w.orgId, w.owner, at(-4 * MINUTE_MS));
      expect((await loopConsentOf(trx, w.ctx, [w.owner])).has(w.owner)).toBe(false);
    });
  });

  test("an unlink row of another organization withdraws nothing here", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const other = await createOrgWithMailbox(trx);
      await unlinkRow(trx, other.orgId, w.owner, at(-1 * MINUTE_MS));
      expect((await loopConsentOf(trx, w.ctx, [w.owner])).has(w.owner)).toBe(true);
      expect((await loopConsentOf(trx, { orgId: other.orgId }, [w.owner])).has(w.owner)).toBe(false);
    });
  });

  test("a real unlink (the service) withdraws the consent", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const { unlinkUser } = await import("../../src/modules/channels");
      expect((await loopConsentOf(trx, w.ctx, [w.owner])).has(w.owner)).toBe(true);
      expect(await unlinkUser(trx, w.ctx, w.owner, at(0), { actor: w.owner })).toBe(1);
      expect((await loopConsentOf(trx, w.ctx, [w.owner])).has(w.owner)).toBe(false);
    });
  });
});
