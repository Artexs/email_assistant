import { afterAll, describe, expect, test } from "bun:test";

import {
  applySend,
  approve,
  countClaimable,
  createCommitterJob,
  noApprovalHooks,
  noDelegationHooks,
} from "../../src/modules/actions";
import { insertCredentials } from "../../src/modules/mail/repo";
import { HardError, SoftError } from "../../src/platform/errors";

import {
  NOW,
  at,
  DELEGATION_ID,
  secrets,
  setup,
  recordingHooks,
  depsOf,
  claimWhere,
  claimOne,
  pair,
  row,
  reverses,
  applyOnce,
} from "./actions-send-helpers";
import { pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("applySend: crashes and the recovery of an applying send", () => {
  test("(15) a crash after the 250 never sends again: the recovery ends outcome_unknown", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks, calls } = recordingHooks();
      const p = await pair(trx, s);
      const afterSend = () => {
        throw new Error("crash");
      };

      await expect(applyOnce(trx, s, p.sendId, NOW, { afterSend })).rejects.toThrow("crash");
      const crashed = await row(trx, p.sendId);
      expect(crashed.status).toBe("applying");
      expect(crashed.outgoing_message_id).not.toBeNull();
      expect(crashed.locked_at).not.toBeNull();
      expect(s.sender.sent).toHaveLength(1);

      const time = at(11);
      const claimed = await claimOne(trx, s, p.sendId, time);
      expect(claimed.status).toBe("applying");
      expect(await applySend(depsOf(s, trx, time, { hooks, sender: null }), s.ctx, claimed, s.fake)).toEqual({
        kind: "failed",
        reason: "outcome_unknown",
      });

      expect(await row(trx, p.sendId)).toMatchObject({
        status: "failed",
        status_reason: "outcome_unknown",
        last_error: "crash_in_applying",
        provider_result: { stage: "unknown", recovered: true },
        result_notified_at: null,
      });
      expect(calls.cancelled).toEqual([{ delegationId: DELEGATION_ID, reason: "outcome_unknown", at: time }]);
      expect(s.sender.sent).toHaveLength(1);
    });
  });

  test("(16) a copy in Sent proves the send: the recovery ends applied", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks, calls } = recordingHooks();
      const p = await pair(trx, s);
      const afterSend = () => {
        throw new Error("crash");
      };
      await expect(applyOnce(trx, s, p.sendId, NOW, { afterSend })).rejects.toThrow("crash");
      await s.fake.appendMessage("Sent", p.draftRaw, ["\\Seen"], NOW);

      const time = at(11);
      const claimed = await claimOne(trx, s, p.sendId, time);
      expect(await applySend(depsOf(s, trx, time, { hooks }), s.ctx, claimed, s.fake)).toEqual({ kind: "applied" });

      const send = await row(trx, p.sendId);
      expect(send.status).toBe("applied");
      expect(send.provider_result).toMatchObject({ recovered: true, sent_copy: "found" });
      expect(calls.sent).toHaveLength(1);
      expect(calls.sent[0]?.sentMessageId).toBe(send.outgoing_message_id as string);
      expect(s.sender.sent).toHaveLength(1);
      expect(await reverses(trx, p.draftId)).toHaveLength(1);
    });
  });

  test("(17) a crash before the SMTP call also ends outcome_unknown: a notice, not a resend", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      const beforeSend = () => {
        throw new Error("crash");
      };
      await expect(applyOnce(trx, s, p.sendId, NOW, { beforeSend })).rejects.toThrow("crash");
      expect((await row(trx, p.sendId)).status).toBe("applying");

      const time = at(11);
      const claimed = await claimOne(trx, s, p.sendId, time);
      expect(await applySend(depsOf(s, trx, time), s.ctx, claimed, s.fake)).toEqual({
        kind: "failed",
        reason: "outcome_unknown",
      });
      expect(s.sender.calls).toEqual([]);
    });
  });

  test("(18) two approval taps and one committer run send once", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const s = await setup(trx);
      const secret = secrets.encrypt("pw", `mailbox:${s.mailboxId}`);
      await insertCredentials(trx, s.ctx, {
        mailboxId: s.mailboxId,
        encryptedSecret: secret.ciphertext,
        secretKind: "password",
        keyVersion: secret.keyVersion,
      });
      const p = await pair(trx, s, { sendStatus: "awaiting_approval", notifiedAt: at(-5) });
      const input = { userId: s.userId, via: "telegram" as const, now: NOW };
      const approvals = {
        db: trx,
        hooks: noDelegationHooks,
        approvalHooks: noApprovalHooks,
        uidplus: async () => true,
      };

      expect(await approve(approvals, s.ctx, p.sendId, input)).toEqual({ kind: "approved" });
      expect((await approve(approvals, s.ctx, p.sendId, input)).kind).toBe("already_approved");
      const job = createCommitterJob({
        db: trx,
        secrets,
        openProvider: async () => s.fake,
        openSender: async () => s.sender,
        scope: { kind: "all" },
        sendScope: { kind: "all" },
        now: () => NOW,
      });
      await job.run();
      await job.run();

      expect(s.sender.sent).toHaveLength(1);
      expect((await row(trx, p.sendId)).status).toBe("applied");
    });
  });

  test("(19) an expired or rejected send is never claimed", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await pair(trx, s, { sendStatus: "expired" });
      await pair(trx, s, { sendStatus: "rejected", messageId: "<r@x.test>" });

      expect(await claimWhere(trx, s, NOW)).toEqual([]);
      const counts = await countClaimable(trx, s.ctx, s.mailboxId, {
        now: NOW,
        staleBefore: at(-10),
        filter: { mailbox: { kind: "all" }, send: { kind: "all" } },
      });
      expect(counts.sending).toBe(0);
    });
  });

  test("(23) an error inside the recovery keeps the row applying and never resends", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks } = recordingHooks();
      const p = await pair(trx, s);
      const afterSend = () => {
        throw new Error("crash");
      };
      await expect(applyOnce(trx, s, p.sendId, NOW, { afterSend })).rejects.toThrow("crash");

      s.fake.failOn("searchSinceIn", new HardError("down"), 3);
      let time = at(11);
      expect(await applyOnce(trx, s, p.sendId, time, { hooks })).toEqual({ kind: "retry", soft: false });
      expect(await row(trx, p.sendId)).toMatchObject({ status: "applying", locked_at: null, attempts: 1 });

      time = at(17);
      expect(await applyOnce(trx, s, p.sendId, time, { hooks })).toEqual({ kind: "retry", soft: false });
      expect(await row(trx, p.sendId)).toMatchObject({ status: "applying", attempts: 2 });
      time = at(23);
      expect(await applyOnce(trx, s, p.sendId, time, { hooks })).toEqual({ kind: "failed", reason: "outcome_unknown" });
      expect(await row(trx, p.sendId)).toMatchObject({
        status: "failed",
        status_reason: "outcome_unknown",
        attempts: 3,
      });
      expect(s.sender.sent).toHaveLength(1);
    });
  });

  test("(23b) a soft error inside the recovery keeps the row applying with no count", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      const afterSend = () => {
        throw new Error("crash");
      };
      await expect(applyOnce(trx, s, p.sendId, NOW, { afterSend })).rejects.toThrow("crash");

      s.fake.failOn("searchSinceIn", new SoftError("slow"));
      expect(await applyOnce(trx, s, p.sendId, at(11))).toEqual({ kind: "retry", soft: true });

      expect(await row(trx, p.sendId)).toMatchObject({ status: "applying", attempts: 0, locked_at: null });
      expect(s.sender.sent).toHaveLength(1);
    });
  });
});
