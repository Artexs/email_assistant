import { randomUUID } from "node:crypto";
import { format } from "node:util";

import { textTables, HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { type Transaction } from "kysely";

import { handleCallback, insertOutbox } from "../../src/modules/channels";
import { setOrgFeature } from "../../src/modules/tenancy";
import { type DB } from "../../src/platform/db";

import { T, NOT_FOUND, setup, ORIGINAL, approvalSetup, queueFor, sendRow } from "./channels-callbacks-helpers";
import { insertDraftAndSend } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("approval taps", () => {
  test("(1)(2) an owner approves; the second owner sees already approved", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx);
      const { sendId, emailId } = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, { notifiedAt: T, createdAt: T });
      await queueFor(trx, s.ctx, s.o1, "approval", sendId, emailId);

      const first = await handleCallback(s.deps, s.owner1, `ap:${sendId}`);
      expect(first.answer).toBe(textTables.en.bot.taps.approved);
      expect(first.edit).toEqual({ text: `${ORIGINAL}\n\n⏳ Approved 11:00, sending.`, buttons: [] });
      expect(await sendRow(trx, sendId)).toMatchObject({
        status: "approved",
        approved_by: s.o1,
        approved_via: "telegram",
      });

      const second = await handleCallback(s.deps, s.owner2, `ap:${sendId}`);
      expect(second.answer).toBe("Already approved 11:00.");
      expect(second.edit).toBeUndefined();
    });
  });

  test("(3) an assistant cannot approve, reject or resend; the row is unchanged", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx);
      const { sendId } = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, { notifiedAt: T, createdAt: T });
      for (const kind of ["ap", "ar", "as", "rs", "ag"]) {
        const result = await handleCallback(s.deps, s.assistantLink, `${kind}:${sendId}`);
        expect(result).toEqual({ answer: textTables.en.bot.taps.ownerOnly });
      }
      expect(await sendRow(trx, sendId)).toMatchObject({ status: "awaiting_approval", approved_by: null });
    });
  });

  test("(3b) a tap logs tap_received with the kind, the user id and the id of its variant; a refused role logs nothing", async () => {
    const lines: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(format(...args)));
    try {
      await withRollback(db, async (trx) => {
        const s = await approvalSetup(trx);
        const [actionId, setId, delegationId] = [randomUUID(), randomUUID(), randomUUID()];

        await handleCallback(s.deps, s.owner1, `ap:${actionId}`);
        await handleCallback(s.deps, s.owner1, `as:${setId}`);
        await handleCallback(s.deps, s.assistantLink, `dd:${delegationId}`);
        await handleCallback(s.deps, s.assistantLink, `ap:${actionId}`);

        expect(lines).toEqual([
          `[channels] tap_received kind=approve user_id=${s.o1} action_id=${actionId}`,
          `[channels] tap_received kind=approve_set user_id=${s.o1} approval_set_id=${setId}`,
          `[channels] tap_received kind=delegation_done user_id=${s.assistantLink.userId} delegation_id=${delegationId}`,
        ]);
      });
    } finally {
      logSpy.mockRestore();
    }
  });

  test("(4) another organization's send and an unknown id give the not-found text", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx);
      const other = await insertDraftAndSend(trx, { orgId: s.b.orgId }, s.b.mailboxId, { notifiedAt: T, createdAt: T });
      for (const id of [other.sendId, randomUUID()]) {
        for (const kind of ["ap", "ar", "ag"]) {
          const result = await handleCallback(s.deps, s.owner1, `${kind}:${id}`);
          expect(result).toEqual({ answer: NOT_FOUND });
        }
      }
      expect(await sendRow(trx, other.sendId)).toMatchObject({ status: "awaiting_approval" });
    });
  });

  test("(5) scope off: approved but held; the edit keeps Reject; Reject then works", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx, { sendScope: () => ({ kind: "off" }) });
      const { sendId, emailId } = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, { notifiedAt: T, createdAt: T });
      await queueFor(trx, s.ctx, s.o1, "approval", sendId, emailId);

      const tap = await handleCallback(s.deps, s.owner1, `ap:${sendId}`);
      expect(tap.answer).toBe(textTables.en.bot.taps.approvedHeld);
      expect(tap.edit?.buttons).toEqual([[{ text: "✖️ Reject", data: `ar:${sendId}` }]]);
      expect(tap.edit?.text).toContain("Sending is held by SEND_SCOPE");
      expect(await sendRow(trx, sendId)).toMatchObject({ status: "approved" });

      const rejected = await handleCallback(s.deps, s.owner1, `ar:${sendId}`);
      expect(rejected.answer).toBe(textTables.en.bot.taps.rejectedNow);
      expect(await sendRow(trx, sendId)).toMatchObject({ status: "rejected" });
    });
  });

  test("(5g) a held approval at the minimal level: the edit of the tap has no Reject button (the level of the member now)", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx, { sendScope: () => ({ kind: "off" }) });
      await setOrgFeature(trx, s.ctx, { flag: "telegram_minimal", enabled: true, actor: "cli", now: T });
      await trx
        .updateTable("memberships")
        .set({ telegram_detail: "minimal" })
        .where("org_id", "=", s.a.orgId)
        .where("user_id", "=", s.o1)
        .execute();
      const { sendId, emailId } = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, { notifiedAt: T, createdAt: T });
      await queueFor(trx, s.ctx, s.o1, "approval", sendId, emailId);

      const tap = await handleCallback(s.deps, s.owner1, `ap:${sendId}`);

      expect(tap.answer).toBe(textTables.en.bot.taps.approvedHeld);
      expect(tap.edit?.buttons).toEqual([]);
      expect(tap.edit?.text).toContain("Sending is held by SEND_SCOPE");
    });
  });

  // A card that went out at `full` (the stored text has no panel link) and a member who is at `minimal` now: the edit has no button
  // and adds the panel link of the send, so the member can still reject a held send in the panel (owner decision of 2026-11-19).
  const BASE = "https://ea.example.ts.net";
  async function minimalMember(trx: Transaction<DB>, s: Awaited<ReturnType<typeof approvalSetup>>): Promise<void> {
    await setOrgFeature(trx, s.ctx, { flag: "telegram_minimal", enabled: true, actor: "cli", now: T });
    await trx
      .updateTable("memberships")
      .set({ telegram_detail: "minimal" })
      .where("org_id", "=", s.a.orgId)
      .where("user_id", "=", s.o1)
      .execute();
  }

  test("(5g2) a card sent at full, the member at minimal now: the edit has no button and ends with the panel link of the send", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx, { sendScope: () => ({ kind: "off" }) });
      await minimalMember(trx, s);
      const { sendId, emailId } = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, { notifiedAt: T, createdAt: T });
      await queueFor(trx, s.ctx, s.o1, "approval", sendId, emailId);

      const tap = await handleCallback({ ...s.deps, webBaseUrl: BASE }, s.owner1, `ap:${sendId}`);

      expect(tap.edit?.buttons).toEqual([]);
      expect(tap.edit?.text.startsWith(`${ORIGINAL}\n\n`)).toBe(true);
      expect(tap.edit?.text.endsWith(`\n${BASE}/approvals?id=${sendId}`)).toBe(true);
    });
  });

  test("(5g3) the stored card has the link already: the edit holds it once; without a base URL the line is Open the panel", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx);
      await minimalMember(trx, s);
      const one = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, { notifiedAt: T, createdAt: T });
      const link = `${BASE}/approvals?id=${one.sendId}`;
      await queueFor(trx, s.ctx, s.o1, "approval", one.sendId, one.emailId, `📤 Card\n${link}`);
      const tap = await handleCallback({ ...s.deps, webBaseUrl: BASE }, s.owner1, `ap:${one.sendId}`);
      expect(tap.edit?.text.split(link)).toHaveLength(2);

      const two = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, { notifiedAt: T, createdAt: T });
      await queueFor(trx, s.ctx, s.o1, "approval", two.sendId, two.emailId);
      const plain = await handleCallback(s.deps, s.owner1, `ap:${two.sendId}`);
      expect(plain.edit?.text.endsWith("\nOpen the panel")).toBe(true);
    });
  });

  test("(5g4) at full, or with the flag off, the edit has no link line (the text of before)", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx);
      const { sendId, emailId } = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, { notifiedAt: T, createdAt: T });
      await queueFor(trx, s.ctx, s.o1, "approval", sendId, emailId);
      const tap = await handleCallback({ ...s.deps, webBaseUrl: BASE }, s.owner1, `ap:${sendId}`);
      expect(tap.edit).toEqual({ text: `${ORIGINAL}\n\n⏳ Approved 11:00, sending.`, buttons: [] });
    });
  });

  test("(5e) a tap on a card that was never sent answers and gives no edit", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx);
      const { sendId, emailId } = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, { notifiedAt: T, createdAt: T });
      await insertOutbox(trx, s.ctx, {
        userId: s.o1,
        kind: "approval",
        dedupKey: `approval:${sendId}`,
        emailId,
        view: {},
        locale: "en",
        createdAt: T,
        nextAttemptAt: T,
      });

      const tap = await handleCallback(s.deps, s.owner1, `ap:${sendId}`);
      expect(tap.answer).toBe(textTables.en.bot.taps.approved);
      expect(tap.edit).toBeUndefined();
      expect(await sendRow(trx, sendId)).toMatchObject({ status: "approved" });
    });
  });

  test("(5f) the edit keeps the stored card bytes and adds the status line", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx);
      const { sendId, emailId } = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, { notifiedAt: T, createdAt: T });
      await queueFor(trx, s.ctx, s.o1, "approval", sendId, emailId, "📤 Send? Card");

      const tap = await handleCallback(s.deps, s.owner1, `ap:${sendId}`);
      expect(tap.edit?.text.startsWith("📤 Send? Card\n\n")).toBe(true);
    });
  });

  test("(5a) a paused, auth_error or host_blocked mailbox holds the send and names the cause", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx);
      const one = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, { notifiedAt: T, createdAt: T });
      const two = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, { notifiedAt: T, createdAt: T });
      const three = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, { notifiedAt: T, createdAt: T });
      for (const id of [one, two, three]) await queueFor(trx, s.ctx, s.o1, "approval", id.sendId, id.emailId);

      await trx.updateTable("mailboxes").set({ status: "paused" }).where("id", "=", s.a.mailboxId).execute();
      const paused = await handleCallback(s.deps, s.owner1, `ap:${one.sendId}`);
      expect(paused.answer).toBe(textTables.en.bot.taps.approvedPaused);
      expect(paused.edit?.text).toContain("The mailbox is paused, so the send waits");
      expect(paused.edit?.buttons).toEqual([[{ text: "✖️ Reject", data: `ar:${one.sendId}` }]]);

      await trx.updateTable("mailboxes").set({ status: "auth_error" }).where("id", "=", s.a.mailboxId).execute();
      const broken = await handleCallback(s.deps, s.owner1, `ap:${two.sendId}`);
      expect(broken.answer).toBe(textTables.en.bot.taps.approvedAuthError);

      await trx.updateTable("mailboxes").set({ status: "host_blocked" }).where("id", "=", s.a.mailboxId).execute();
      const blocked = await handleCallback(s.deps, s.owner1, `ap:${three.sendId}`);
      expect(blocked.answer).toBe(textTables.en.bot.taps.approvedHostBlocked);
      expect(blocked.edit?.text).toContain("The mail server is not allowed, so the send waits");
    });
  });

  test("(5b) a tap after 48 h expires the send; nobody approved it", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx);
      const { sendId, emailId } = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, {
        notifiedAt: new Date(T.getTime() - 49 * HOUR_MS),
        createdAt: T,
      });
      await queueFor(trx, s.ctx, s.o1, "approval", sendId, emailId);

      const tap = await handleCallback(s.deps, s.owner1, `ap:${sendId}`);
      expect(tap.answer).toBe(textTables.en.bot.taps.expired);
      expect(tap.edit).toEqual({ text: `${ORIGINAL}\n\n⌛ Expired 11:00. The mail was not sent.`, buttons: [] });
      expect(await sendRow(trx, sendId)).toMatchObject({
        status: "expired",
        status_reason: "timeout",
        approved_by: null,
      });
    });
  });

  test("(5c) a tap on an already expired send only answers; the message is not edited again", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx);
      const { sendId, emailId } = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, {
        sendStatus: "expired",
        notifiedAt: new Date(T.getTime() - 49 * HOUR_MS),
        createdAt: T,
      });
      await queueFor(trx, s.ctx, s.o1, "approval", sendId, emailId);

      const tap = await handleCallback(s.deps, s.owner1, `ap:${sendId}`);
      expect(tap).toEqual({ answer: textTables.en.bot.taps.expired });
    });
  });

  test("(5d) a draft that is not in Drafts yet: the tap answers and changes nothing", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx);
      const { sendId, emailId } = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, {
        draftStatus: "ready",
        notifiedAt: T,
        createdAt: T,
      });
      await queueFor(trx, s.ctx, s.o1, "approval", sendId, emailId);

      const tap = await handleCallback(s.deps, s.owner1, `ap:${sendId}`);
      expect(tap).toEqual({ answer: textTables.en.bot.taps.draftNotReady });
      expect(await sendRow(trx, sendId)).toMatchObject({ status: "awaiting_approval", approved_by: null });
    });
  });

  test("(5e) a reply with a gap and a reply while the flag is off: the tap answers and changes nothing", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx);
      const { sendId, emailId } = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, {
        kind: "reply",
        replyBody: "Tak [[godzina]]",
        notifiedAt: T,
        createdAt: T,
      });
      await queueFor(trx, s.ctx, s.o1, "approval", sendId, emailId);

      expect(await handleCallback(s.deps, s.owner1, `ap:${sendId}`)).toEqual({
        answer: textTables.en.bot.taps.featureOff,
      });
      await setOrgFeature(trx, s.ctx, { flag: "reply_drafts", enabled: true, actor: "cli", now: T });
      expect(await handleCallback(s.deps, s.owner1, `ap:${sendId}`)).toEqual({
        answer: textTables.en.bot.taps.hasGaps,
      });
      expect(await sendRow(trx, sendId)).toMatchObject({ status: "awaiting_approval", approved_by: null });
    });
  });

  test("(10) forged data is not valid", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx);
      const result = await handleCallback(s.deps, s.owner1, "ap:nope");
      expect(result).toEqual({ answer: "This button is not valid any more." });
    });
  });

  test("(11) the S2 and S3 taps still work", async () => {
    await withRollback(db, async (trx) => {
      const { info, link, deps } = await setup(trx);
      expect((await handleCallback(deps, link, `fr:i:${info}`)).answer).toBe("✅ Saved: Info is right.");
      expect((await handleCallback(deps, link, `fu:${info}`)).answer).toBe(textTables.en.answers.undo.nothing);
    });
  });
});
