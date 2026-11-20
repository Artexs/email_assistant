import { format } from "node:util";

import { MINUTE_MS, DAY_MS } from "@ea/core";
import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { SmtpSendError } from "../../src/modules/mail";
import type { DB, Db } from "../../src/platform/db";
import { HardError } from "../../src/platform/errors";
import { logFormatFromEnv, setLogFormat, setLogLevel } from "../../src/platform/log";

import {
  NOW,
  CREATED,
  at,
  DELEGATION_ID,
  type Setup,
  setup,
  recordingHooks,
  claimWhere,
  pair,
  row,
  reverses,
  applyOnce,
  smtp,
} from "./actions-send-helpers";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

afterEach(() => {
  setLogLevel("info");
  setLogFormat(logFormatFromEnv(process.env));
});

async function auditOf(trx: Db | Transaction<DB>, actionId: string) {
  const rows = await trx
    .selectFrom("audit_log")
    .selectAll()
    .where("action_id", "=", actionId)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  for (const entry of rows) {
    expect(entry.action_id).not.toBeNull();
    expect(entry.email_id).not.toBeNull();
  }
  return rows;
}

async function sentFolderCount(s: Setup): Promise<number> {
  return (await s.fake.searchSinceIn("Sent", new Date(CREATED.getTime() - DAY_MS))).length;
}

describe("applySend", () => {
  test("(1) the happy path: one send of the draft's bytes, applied at once, the Sent copy, the reverse row", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks, calls } = recordingHooks();
      const p = await pair(trx, s);

      expect(await applyOnce(trx, s, p.sendId, NOW, { hooks })).toEqual({ kind: "applied" });

      const payload = (await row(trx, p.sendId)).payload as { to: string[] };
      expect(s.sender.sent).toHaveLength(1);
      expect(s.sender.sent[0]?.envelope).toEqual({ from: s.address, to: payload.to });
      expect(s.sender.sent[0]?.raw.equals(p.draftRaw)).toBe(true);

      const send = await row(trx, p.sendId);
      expect(send.status).toBe("applied");
      expect(send.locked_at).toBeNull();
      expect(send.result_notified_at).toBeNull();
      expect(send.outgoing_message_id).toMatch(new RegExp(`^<ea-${p.draftId}@`));
      expect(send.provider_result).toEqual({
        response: "250 2.0.0 Ok: queued as FAKE",
        accepted: 1,
        message_id: send.outgoing_message_id,
        sent_copy: "appended",
      });
      expect((await auditOf(trx, p.sendId)).map((entry) => entry.event)).toEqual(["action.applying", "action.applied"]);
      expect(calls.sent).toEqual([
        {
          delegationId: DELEGATION_ID,
          sentMessageId: send.outgoing_message_id as string,
          sentAt: NOW,
          dueAtWhenNull: new Date(NOW.getTime() + 3 * DAY_MS),
        },
      ]);
      expect(calls.reminders).toEqual([]);
      expect(calls.cancelled).toEqual([]);

      const reverse = await reverses(trx, p.draftId);
      expect(reverse).toHaveLength(1);
      expect(reverse[0]).toMatchObject({
        type: "create_draft",
        status: "ready",
        payload: { kind: "delegation", folder: "Drafts", uid: 1, reason: "sent" },
      });

      const [uid] = await s.fake.searchSinceIn("Sent", new Date(CREATED.getTime() - DAY_MS));
      const copy = await s.fake.fetchMetaIn("Sent", uid as number);
      expect(copy?.actionId).toBe(p.draftId);
      expect(copy?.flags).toContain("\\Seen");
      expect(await sentFolderCount(s)).toBe(1);
    });
  });

  test("(1b) a crash before the Sent copy leaves the row applied with sent_copy pending, one send", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      const beforeSentCopy = () => {
        throw new Error("crash");
      };

      await expect(applyOnce(trx, s, p.sendId, NOW, { beforeSentCopy })).rejects.toThrow("crash");

      const send = await row(trx, p.sendId);
      expect(send.status).toBe("applied");
      expect(send.provider_result).toMatchObject({ sent_copy: "pending" });
      expect(s.sender.sent).toHaveLength(1);
      expect(await sentFolderCount(s)).toBe(0);
    });
  });

  test("(2) a copy already in Sent is found, no second APPEND", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      await s.fake.appendMessage("Sent", p.draftRaw, ["\\Seen"], NOW);
      const appends = s.fake.calls.filter((call) => call === "appendMessage").length;

      expect(await applyOnce(trx, s, p.sendId)).toEqual({ kind: "applied" });

      expect((await row(trx, p.sendId)).provider_result).toMatchObject({ sent_copy: "found" });
      expect(s.fake.calls.filter((call) => call === "appendMessage").length).toBe(appends);
      expect(await sentFolderCount(s)).toBe(1);
    });
  });

  test("(3) a failed Sent APPEND leaves the row applied with sent_copy failed and an audit row", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      s.fake.failOn("appendMessage", new HardError("no"));

      expect(await applyOnce(trx, s, p.sendId)).toEqual({ kind: "applied" });

      const send = await row(trx, p.sendId);
      expect(send.status).toBe("applied");
      expect(send.provider_result).toMatchObject({ sent_copy: "failed" });
      const events = (await auditOf(trx, p.sendId)).map((entry) => entry.event);
      expect(events).toEqual(["action.applying", "action.applied", "action.sent_copy_failed"]);
      expect(s.sender.sent).toHaveLength(1);
    });
  });

  test("(4) a soft connect error retries after 5 min with no count and no second send before then", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      s.sender.failNext(smtp("connect", "ECONNECTION", null, false, true));

      expect(await applyOnce(trx, s, p.sendId)).toEqual({ kind: "retry", soft: true });

      const send = await row(trx, p.sendId);
      expect(send).toMatchObject({ status: "approved", attempts: 0, last_error: "smtp_ECONNECTION", locked_at: null });
      expect(send.next_attempt_at).toEqual(at(5));
      expect(await claimWhere(trx, s, at(1))).toEqual([]);
      expect(s.sender.sent).toHaveLength(0);

      expect(await applyOnce(trx, s, p.sendId, at(6))).toEqual({ kind: "applied" });
      expect(s.sender.sent).toHaveLength(1);
    });
  });

  test("(4b) soft errors retry every 5 min until 6 h after the tap, then the send fails as smtp_error with Send again", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks, calls } = recordingHooks();
      const p = await pair(trx, s);
      // The tap is at(-1). A scripted soft envelope error repeats on every try.
      s.sender.failNext(smtp("envelope", "EENVELOPE", 450, false, true), 100);

      const beforeCap = at(-1 + 6 * 60 - 5);
      expect(await applyOnce(trx, s, p.sendId, beforeCap, { hooks })).toEqual({ kind: "retry", soft: true });
      expect(await row(trx, p.sendId)).toMatchObject({ status: "approved", attempts: 0, locked_at: null });
      expect((await row(trx, p.sendId)).next_attempt_at).toEqual(new Date(beforeCap.getTime() + 5 * MINUTE_MS));

      const atCap = at(-1 + 6 * 60);
      expect(await applyOnce(trx, s, p.sendId, atCap, { hooks })).toEqual({ kind: "failed", reason: "smtp_error" });

      expect(await row(trx, p.sendId)).toMatchObject({
        status: "failed",
        status_reason: "smtp_error",
        attempts: 0,
        last_error: "smtp_450",
        result_notified_at: null,
        provider_result: { stage: "envelope", response_code: 450, code: "EENVELOPE", cap: "soft_retry" },
      });
      expect(s.sender.sent).toHaveLength(0);
      expect(calls.cancelled).toEqual([{ delegationId: DELEGATION_ID, reason: "send_failed", at: atCap }]);
      const failed = (await auditOf(trx, p.sendId)).find((entry) => entry.event === "action.failed");
      expect(failed).toMatchObject({
        reason_code: "smtp_error",
        data: { stage: "envelope", response_code: 450, cap: "soft_retry" },
      });
      // The row is gone from the claim queue: no retry after the cap.
      expect(await claimWhere(trx, s, at(-1 + 6 * 60 + 10))).toEqual([]);
    });
  });

  test("(4c) the cap does not touch a retry with a count: a hard error after 7 h counts a try and retries", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      s.sender.failNext(smtp("connect", "ETLS", null, false, false));

      const late = at(7 * 60);
      expect(await applyOnce(trx, s, p.sendId, late)).toEqual({ kind: "retry", soft: false });

      const send = await row(trx, p.sendId);
      expect(send).toMatchObject({ status: "approved", attempts: 1, locked_at: null });
      expect(send.next_attempt_at).toEqual(new Date(late.getTime() + 5 * MINUTE_MS));
    });
  });

  test("(4d) a 4xx after the content past the cap fails with the content text, not the cap text", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      s.sender.failNext(smtp("content", "EMESSAGE", 451, false, true));

      expect(await applyOnce(trx, s, p.sendId, at(7 * 60))).toEqual({ kind: "failed", reason: "smtp_error" });

      const send = await row(trx, p.sendId);
      expect(send.provider_result).toEqual({ stage: "content", response_code: 451, code: "EMESSAGE" });
      expect(s.sender.calls.filter((call) => call === "send")).toHaveLength(1);
    });
  });

  test("(5) a permanent envelope error fails the send as smtp_rejected and keeps the draft", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks, calls } = recordingHooks();
      const p = await pair(trx, s);
      s.sender.failNext(smtp("envelope", "EENVELOPE", 550, true, false));

      expect(await applyOnce(trx, s, p.sendId, NOW, { hooks })).toEqual({ kind: "failed", reason: "smtp_rejected" });

      expect(await row(trx, p.sendId)).toMatchObject({
        status: "failed",
        status_reason: "smtp_rejected",
        last_error: "smtp_550",
        provider_result: { stage: "envelope", response_code: 550, code: "EENVELOPE" },
        result_notified_at: null,
        locked_at: null,
      });
      expect(calls.cancelled).toEqual([{ delegationId: DELEGATION_ID, reason: "send_failed", at: NOW }]);
      expect(await reverses(trx, p.draftId)).toEqual([]);
      expect(await s.fake.fetchMetaIn("Drafts", 1)).not.toBeNull();
      const failed = (await auditOf(trx, p.sendId)).find((entry) => entry.event === "action.failed");
      expect(failed).toMatchObject({ reason_code: "smtp_rejected", data: { stage: "envelope", response_code: 550 } });
    });
  });

  test("(5b) the log lines of a refused send and of a soft retry hold the stage and the code, never the SMTP reply", async () => {
    const lines: string[] = [];
    const spies = [spyOn(console, "log"), spyOn(console, "error")];
    for (const spy of spies) spy.mockImplementation((...args: unknown[]) => void lines.push(format(...args)));
    setLogFormat("json");
    setLogLevel("debug");
    try {
      await withRollback(db, async (trx) => {
        const s = await setup(trx);
        const reply = new Error("550 5.1.1 MARKER-SMTP rcpt-marker@x.test unknown");
        const p = await pair(trx, s);
        s.sender.failNext(new SmtpSendError("envelope", "EENVELOPE", 451, false, true, { cause: reply }));
        await applyOnce(trx, s, p.sendId);
        s.sender.failNext(new SmtpSendError("envelope", "EENVELOPE", 550, true, false, { cause: reply }));
        await applyOnce(trx, s, p.sendId, at(6));
      });
    } finally {
      for (const spy of spies) spy.mockRestore();
    }

    const entries = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries.map((entry) => entry.event)).toEqual(["send_retry", "send_failed"]);
    expect(entries[0]).toMatchObject({ send_stage: "envelope", code: 451 });
    expect(entries[1]).toMatchObject({ reason: "smtp_rejected", send_stage: "envelope", code: 550 });
    for (const line of lines) {
      expect(line).not.toContain("MARKER");
      expect(line).not.toContain("rcpt-marker");
    }
  });

  test("(6) a 4xx after the content fails at once as smtp_error, no retry", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      s.sender.failNext(smtp("content", "EMESSAGE", 451, false, true));

      expect(await applyOnce(trx, s, p.sendId)).toEqual({ kind: "failed", reason: "smtp_error" });

      expect(await row(trx, p.sendId)).toMatchObject({
        status: "failed",
        status_reason: "smtp_error",
        attempts: 0,
        provider_result: { stage: "content", response_code: 451, code: "EMESSAGE" },
      });
      expect(s.sender.calls.filter((call) => call === "send")).toHaveLength(1);
    });
  });

  test("(6b) an unknown error before the content counts three tries, then fails as smtp_error", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      s.sender.failNext(smtp("envelope", "EPROTOCOL", null, false, false), 3);

      expect(await applyOnce(trx, s, p.sendId, NOW)).toEqual({ kind: "retry", soft: false });
      expect(await row(trx, p.sendId)).toMatchObject({ status: "approved", attempts: 1 });
      expect(await applyOnce(trx, s, p.sendId, at(6))).toEqual({ kind: "retry", soft: false });
      expect(await row(trx, p.sendId)).toMatchObject({ status: "approved", attempts: 2 });
      expect(await applyOnce(trx, s, p.sendId, at(12))).toEqual({ kind: "failed", reason: "smtp_error" });

      expect(await row(trx, p.sendId)).toMatchObject({
        status: "failed",
        status_reason: "smtp_error",
        attempts: 3,
        provider_result: { stage: "envelope", response_code: null, code: "EPROTOCOL" },
      });
      expect(s.sender.sent).toHaveLength(0);
    });
  });

  test("(6c) ETLS and a permanent login error are hard retries", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const one = await pair(trx, s);
      s.sender.failNext(smtp("connect", "ETLS", null, false, false));
      expect(await applyOnce(trx, s, one.sendId)).toEqual({ kind: "retry", soft: false });
      expect(await row(trx, one.sendId)).toMatchObject({ status: "approved", attempts: 1 });

      const two = await pair(trx, s, { messageId: "<other@x.test>" });
      s.sender.failNext(smtp("login", "EPROTOCOL", 554, true, false));
      expect(await applyOnce(trx, s, two.sendId)).toEqual({ kind: "retry", soft: false });
      expect(await row(trx, two.sendId)).toMatchObject({ status: "approved", attempts: 1, last_error: "smtp_554" });
    });
  });

  test("(6d) a compose error three times fails with stage compose and sends nothing", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await pair(trx, s);
      const compose = async (): Promise<Buffer> => {
        throw new Error("boom");
      };

      expect(await applyOnce(trx, s, p.sendId, NOW, { compose })).toEqual({ kind: "retry", soft: false });
      expect(await applyOnce(trx, s, p.sendId, at(6), { compose })).toEqual({ kind: "retry", soft: false });
      expect(await applyOnce(trx, s, p.sendId, at(12), { compose })).toEqual({ kind: "failed", reason: "smtp_error" });

      expect(await row(trx, p.sendId)).toMatchObject({
        status: "failed",
        status_reason: "smtp_error",
        attempts: 3,
        provider_result: { stage: "compose" },
      });
      expect(s.sender.calls).toEqual([]);
    });
  });
});
