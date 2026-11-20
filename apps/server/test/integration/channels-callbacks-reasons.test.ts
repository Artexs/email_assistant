import { randomUUID } from "node:crypto";

import { textTables, DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { type Transaction } from "kysely";

import { handleCallback } from "../../src/modules/channels";
import { configureFeatures, setOrgFeature } from "../../src/modules/tenancy";
import { type DB } from "../../src/platform/db";

import { T, ORIGINAL, approvalSetup, queueFor } from "./channels-callbacks-helpers";
import { insertDraftAndSend } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("approval taps", () => {
  describe("reason and mistake taps (F100 stage 14)", () => {
    const flagOn = (trx: Transaction<DB>, orgId: string) =>
      setOrgFeature(trx, { orgId }, { flag: "mistake_capture", enabled: true, actor: "cli", now: T });
    const reasonRows = (trx: Transaction<DB>, actionId: string, kind: string) =>
      trx
        .selectFrom("action_feedback")
        .selectAll()
        .where("action_id", "=", actionId)
        .where("kind", "=", kind)
        .execute();

    async function rejectedSend(trx: Transaction<DB>, s: Awaited<ReturnType<typeof approvalSetup>>) {
      const sent = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, { notifiedAt: T, createdAt: T });
      await queueFor(trx, s.ctx, s.o1, "approval", sent.sendId, sent.emailId);
      return sent;
    }

    async function appliedSend(trx: Transaction<DB>, s: Awaited<ReturnType<typeof approvalSetup>>, ageMs: number) {
      const sent = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, {
        sendStatus: "applied",
        approved: { userId: s.o1, at: T },
        createdAt: T,
      });
      await trx
        .updateTable("actions")
        .set({ applied_at: new Date(T.getTime() - ageMs) })
        .where("id", "=", sent.sendId)
        .execute();
      await queueFor(trx, s.ctx, s.o1, "send_result", sent.sendId, sent.emailId, "✅ Sent to x · Hello");
      return sent;
    }

    test("1. flag on: a reject offers three buttons; a reason tap writes one row and ends the card with the reason", async () => {
      await withRollback(db, async (trx) => {
        const s = await approvalSetup(trx);
        await flagOn(trx, s.a.orgId);
        const { sendId } = await rejectedSend(trx, s);

        const reject = await handleCallback(s.deps, s.owner1, `ar:${sendId}`);
        expect(reject.edit?.text).toBe(`${ORIGINAL}\n\n✖️ Rejected 11:00.`);
        expect(reject.edit?.buttons).toEqual([
          [
            { text: "✖️ Wrong person", data: `rw:p:${sendId}` },
            { text: "✖️ Wrong content", data: `rw:c:${sendId}` },
            { text: "Not needed", data: `rw:n:${sendId}` },
          ],
        ]);

        const tap = await handleCallback(s.deps, s.owner1, `rw:p:${sendId}`);
        expect(tap.answer).toBe("Noted: wrong person.");
        expect(tap.edit).toEqual({ text: `${ORIGINAL}\n\n✖️ Rejected. Reason: wrong person.`, buttons: [] });
        const rows = await reasonRows(trx, sendId, "reject_reason");
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ reason: "wrong_person", user_id: s.o1, via: "telegram" });

        // A later reason replaces the earlier one.
        await handleCallback(s.deps, s.owner1, `rw:n:${sendId}`);
        expect(await reasonRows(trx, sendId, "reject_reason")).toMatchObject([{ reason: "not_needed" }]);
      });
    });

    test("1b. flag off: the reject edit has no buttons", async () => {
      await withRollback(db, async (trx) => {
        const s = await approvalSetup(trx);
        const { sendId } = await rejectedSend(trx, s);
        const reject = await handleCallback(s.deps, s.owner1, `ar:${sendId}`);
        expect(reject.edit).toEqual({ text: `${ORIGINAL}\n\n✖️ Rejected 11:00.`, buttons: [] });
      });
    });

    test("1c. a reason tap on a send that is not rejected, and on a foreign id", async () => {
      await withRollback(db, async (trx) => {
        const s = await approvalSetup(trx);
        await flagOn(trx, s.a.orgId);
        const { sendId } = await rejectedSend(trx, s);
        const waiting = await handleCallback(s.deps, s.owner1, `rw:p:${sendId}`);
        expect(waiting).toEqual({ answer: "This send is not rejected." });
        const foreign = await handleCallback(s.deps, s.owner1, `rw:p:${randomUUID()}`);
        expect(foreign).toEqual({ answer: textTables.en.bot.taps.notFound });
        expect(await reasonRows(trx, sendId, "reject_reason")).toHaveLength(0);
      });
    });

    test("2. an assistant gets the owner-only answer and no row", async () => {
      await withRollback(db, async (trx) => {
        const s = await approvalSetup(trx);
        await flagOn(trx, s.a.orgId);
        const { sendId } = await rejectedSend(trx, s);
        await handleCallback(s.deps, s.owner1, `ar:${sendId}`);
        const applied = await appliedSend(trx, s, DAY_MS);
        for (const data of [`rw:p:${sendId}`, `mk:${applied.sendId}`]) {
          expect(await handleCallback(s.deps, s.assistantLink, data)).toEqual({
            answer: textTables.en.bot.taps.ownerOnly,
          });
        }
        const rows = await trx.selectFrom("action_feedback").selectAll().execute();
        expect(rows.filter((row) => row.org_id === s.a.orgId)).toHaveLength(0);
      });
    });

    test("3. a mistake tap on a send of yesterday writes one row; a second tap says already marked", async () => {
      await withRollback(db, async (trx) => {
        const s = await approvalSetup(trx);
        await flagOn(trx, s.a.orgId);
        const { sendId } = await appliedSend(trx, s, DAY_MS);
        const first = await handleCallback(s.deps, s.owner1, `mk:${sendId}`);
        expect(first.answer).toBe("⚠️ Noted as a mistake.");
        expect(first.edit?.text.endsWith("⚠️ Marked as a mistake 11:00.")).toBe(true);
        expect(first.edit?.buttons).toEqual([]);
        expect(await reasonRows(trx, sendId, "mistake")).toHaveLength(1);
        expect(await handleCallback(s.deps, s.owner1, `mk:${sendId}`)).toEqual({ answer: "Already marked." });
        expect(await reasonRows(trx, sendId, "mistake")).toHaveLength(1);
      });
    });

    test("3b. too late after 7 days; not sent for a rejected send", async () => {
      await withRollback(db, async (trx) => {
        const s = await approvalSetup(trx);
        await flagOn(trx, s.a.orgId);
        const old = await appliedSend(trx, s, 8 * DAY_MS);
        expect((await handleCallback(s.deps, s.owner1, `mk:${old.sendId}`)).answer).toBe(
          "Too late: a mistake can be marked within 7 days of the send."
        );
        const { sendId } = await rejectedSend(trx, s);
        await handleCallback(s.deps, s.owner1, `ar:${sendId}`);
        expect((await handleCallback(s.deps, s.owner1, `mk:${sendId}`)).answer).toBe("This mail was not sent.");
        expect(await trx.selectFrom("action_feedback").selectAll().where("org_id", "=", s.a.orgId).execute()).toEqual(
          []
        );
      });
    });

    test("3c. the flag off, or in FEATURES_OFF: both taps answer that the button is off and write nothing", async () => {
      await withRollback(db, async (trx) => {
        const s = await approvalSetup(trx);
        const { sendId } = await rejectedSend(trx, s);
        await handleCallback(s.deps, s.owner1, `ar:${sendId}`);
        const applied = await appliedSend(trx, s, DAY_MS);
        const off = { answer: "This button is off now." };
        expect(await handleCallback(s.deps, s.owner1, `rw:p:${sendId}`)).toEqual(off);
        expect(await handleCallback(s.deps, s.owner1, `mk:${applied.sendId}`)).toEqual(off);

        await flagOn(trx, s.a.orgId);
        configureFeatures({ off: ["mistake_capture"] });
        try {
          expect(await handleCallback(s.deps, s.owner1, `rw:p:${sendId}`)).toEqual(off);
          expect(await handleCallback(s.deps, s.owner1, `mk:${applied.sendId}`)).toEqual(off);
        } finally {
          configureFeatures({ off: [] });
        }
        expect(await trx.selectFrom("action_feedback").selectAll().where("org_id", "=", s.a.orgId).execute()).toEqual(
          []
        );
      });
    });
  });
});
