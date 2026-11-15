import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { doneLoop, draftFollowUp, oneLineSubject, reopenLoop, type DraftFollowUpResult } from "../../src/modules/loops";
import type { DB } from "../../src/platform/db";
import { captureLogs, eventLines, logProblems } from "../log-capture";

import { insertTriaged } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import {
  actionsOfLoop,
  ANNA,
  auditOf,
  commandLoop,
  commandOrg,
  FRIDAY,
  JAN,
  loopOf,
  type CommandOrg,
} from "./loops-commands-fixtures";

// F116 stage 14, step 1: `draftFollowUp`. The races of the same rules are in `loops-commands-race.test.ts`.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const tap = (trx: Transaction<DB>, org: CommandOrg, loopId: string, over: { userId?: string; now?: Date } = {}) =>
  draftFollowUp({ db: trx, now: () => over.now ?? FRIDAY }, org.ctx, {
    loopId,
    userId: over.userId ?? org.userId,
    via: "telegram",
  });

const payloadOf = (row: { payload: unknown }): Record<string, unknown> => row.payload as Record<string, unknown>;

describe("draftFollowUp: the pair", () => {
  test("T1 a waiting loop in assist: a draft and a send on the loop, recipients of the loop, one audit row each", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const loop = await commandLoop(trx, org);
      const result = await tap(trx, org, loop.id);
      const rows = await actionsOfLoop(trx, loop.id);
      expect(rows.map((row) => `${row.type}:${row.status}`)).toEqual(["create_draft:ready", "send:awaiting_approval"]);
      expect(rows.every((row) => row.email_id === null && row.loop_id === loop.id)).toBe(true);
      const send = rows.find((row) => row.type === "send");
      expect(result).toEqual({ kind: "planned", sendId: send?.id ?? "" });
      const draft = rows.find((row) => row.type === "create_draft");
      expect(payloadOf(draft ?? { payload: null })).toMatchObject({
        kind: "follow_up",
        loop_id: loop.id,
        to: [ANNA],
        cc: [JAN],
        subject: "Offer Q1",
        n: 1,
        language: "en",
      });
      expect(payloadOf(send ?? { payload: null })).toEqual({
        kind: "follow_up",
        to: [ANNA],
        cc: [JAN],
        loop_id: loop.id,
      });
      expect(rows.map((row) => row.idempotency_key).sort()).toEqual([
        `${loop.id}:create_draft:follow_up:1:1`,
        `${loop.id}:send:follow_up:1:1`,
      ]);
      const planned = await auditOf(trx, org.ctx.orgId, "action.planned");
      expect(planned).toHaveLength(2);
      for (const row of planned) {
        expect(row.actor).toBe(org.userId);
        expect(row.email_id).toBeNull();
        expect(row.data).toMatchObject({ loop_id: loop.id, via: "telegram" });
      }
      // The loop itself does not change: the counters move when the mail goes out.
      const after = await loopOf(trx, loop.id);
      expect([after.status, after.follow_ups_sent]).toEqual(["open", 0]);
    });
  });

  test("T2 the same tap again: waiting with the send, no second pair", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const loop = await commandLoop(trx, org);
      const first = await tap(trx, org, loop.id);
      expect(await tap(trx, org, loop.id)).toEqual({
        kind: "waiting",
        sendId: first.kind === "planned" ? first.sendId : "",
      });
      expect(await actionsOfLoop(trx, loop.id)).toHaveLength(2);
    });
  });

  test("T3 shadow mode: would_draft, no action, one loop.would_draft row", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx, { mode: "shadow" });
      const loop = await commandLoop(trx, org);
      expect(await tap(trx, org, loop.id)).toEqual({ kind: "would_draft" });
      expect(await actionsOfLoop(trx, loop.id)).toEqual([]);
      const rows = await auditOf(trx, org.ctx.orgId, "loop.would_draft");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.data).toEqual({ loop_id: loop.id, kind: "waiting", via: "telegram" });
    });
  });

  test("assist with the draft switch off: drafts_off, nothing written", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx, { createDraft: false });
      const loop = await commandLoop(trx, org);
      expect(await tap(trx, org, loop.id)).toEqual({ kind: "drafts_off" });
      expect(await actionsOfLoop(trx, loop.id)).toEqual([]);
    });
  });

  test("a mailbox with no settings row has no drafts", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      await trx.deleteFrom("mailbox_settings").where("mailbox_id", "=", org.mailboxId).execute();
      const loop = await commandLoop(trx, org);
      expect(await tap(trx, org, loop.id)).toEqual({ kind: "drafts_off" });
    });
  });

  test("T4 a thread with a suspicious mail: suspicious, whatever the reason; a clean newest result does not block", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const loop = await commandLoop(trx, org);
      await insertTriaged(trx, org.ctx, org.mailboxId, {
        category: "info",
        createdAt: FRIDAY,
        threadKey: loop.threadKey,
        suspiciousReasons: ["lookalike_domain"],
      });
      expect(await tap(trx, org, loop.id)).toEqual({ kind: "suspicious" });
      expect(await actionsOfLoop(trx, loop.id)).toEqual([]);
      const other = await commandLoop(trx, org);
      await insertTriaged(trx, org.ctx, org.mailboxId, {
        category: "info",
        createdAt: FRIDAY,
        threadKey: other.threadKey,
        suspiciousReasons: [],
      });
      expect((await tap(trx, org, other.id)).kind).toBe("planned");
    });
  });
});

describe("draftFollowUp: the limits", () => {
  const WORKING = [
    // [last follow-up, now, answer]: three working days after the last one, in Warsaw time.
    ["Tue 09:00 -> Fri 09:00 (3 working days, to the minute)", "2026-11-17T08:00:00Z", "planned"],
    ["Tue 09:01 -> Fri 09:00 (one minute short)", "2026-11-17T08:01:00Z", "too_soon"],
    ["Wed 09:00 -> Fri 09:00 (2 working days)", "2026-11-18T08:00:00Z", "too_soon"],
    ["Mon 09:00 -> Fri 09:00 (4 working days)", "2026-11-16T08:00:00Z", "planned"],
  ] as const;
  for (const [label, last, expected] of WORKING) {
    test(`T5 the second follow-up: ${label}`, async () => {
      await withRollback(db, async (trx) => {
        const org = await commandOrg(trx);
        const loop = await commandLoop(trx, org, { follow_ups_sent: 1, last_follow_up_at: new Date(last) });
        const result = await tap(trx, org, loop.id);
        expect(result.kind).toBe(expected);
        if (expected === "planned") {
          const draft = (await actionsOfLoop(trx, loop.id)).find((row) => row.type === "create_draft");
          expect(payloadOf(draft ?? { payload: null }).n).toBe(2);
          expect(draft?.idempotency_key).toBe(`${loop.id}:create_draft:follow_up:2:1`);
        }
      });
    });
  }

  test("T5b two follow-ups sent: limit_reached", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const loop = await commandLoop(trx, org, {
        follow_ups_sent: 2,
        last_follow_up_at: new Date("2026-11-10T08:00:00Z"),
      });
      expect(await tap(trx, org, loop.id)).toEqual({ kind: "limit_reached" });
    });
  });

  test("a weekend between the two follow-ups counts no days", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      // Thursday 09:00 Warsaw, now Monday 09:00: only Friday and Monday count, two working days.
      const loop = await commandLoop(trx, org, {
        follow_ups_sent: 1,
        last_follow_up_at: new Date("2026-11-19T08:00:00Z"),
      });
      expect((await tap(trx, org, loop.id, { now: new Date("2026-11-23T08:00:00Z") })).kind).toBe("too_soon");
      expect((await tap(trx, org, loop.id, { now: new Date("2026-11-24T08:00:00Z") })).kind).toBe("planned");
    });
  });
});

describe("draftFollowUp: who and which loop", () => {
  test("T6 an assistant is not allowed; a stranger is not allowed; nothing is written", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const loop = await commandLoop(trx, org);
      expect(await tap(trx, org, loop.id, { userId: org.memberId })).toEqual({ kind: "not_allowed" });
      expect(await tap(trx, org, loop.id, { userId: randomUUID() })).toEqual({ kind: "not_allowed" });
      expect(await actionsOfLoop(trx, loop.id)).toEqual([]);
    });
  });

  test("the flag off, a loop of another organization, an unknown id", async () => {
    await withRollback(db, async (trx) => {
      const off = await commandOrg(trx, { loopsFlag: false });
      const offLoop = await commandLoop(trx, off);
      expect(await tap(trx, off, offLoop.id)).toEqual({ kind: "feature_off" });
      const org = await commandOrg(trx);
      const loop = await commandLoop(trx, org);
      const other = await commandOrg(trx);
      expect(await tap(trx, other, loop.id)).toEqual({ kind: "not_found" });
      expect(await tap(trx, org, randomUUID())).toEqual({ kind: "not_found" });
    });
  });

  test("a closed loop answers closed; a promised loop is not allowed", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const closed = await commandLoop(trx, org, {
        status: "closed",
        close_reason: "done",
        closed_at: FRIDAY,
      });
      const promised = await commandLoop(trx, org, { kind: "promised" });
      expect(await tap(trx, org, closed.id)).toEqual({ kind: "closed" });
      expect(await tap(trx, org, promised.id)).toEqual({ kind: "not_allowed" });
      expect(await actionsOfLoop(trx, closed.id)).toEqual([]);
      expect(await actionsOfLoop(trx, promised.id)).toEqual([]);
    });
  });
});

describe("draftFollowUp: recipients", () => {
  test("T7 a delegated loop writes to the counterpart only, no Cc, in the draft and in the send", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const loop = await commandLoop(trx, org, {
        kind: "delegated",
        // The counterpart is not the first address: a fallback to `to_addresses[0]` would write to the wrong person.
        to_addresses: ["extra@example.test", ANNA],
        cc_addresses: [JAN],
        counterpart: ANNA,
      });
      expect((await tap(trx, org, loop.id)).kind).toBe("planned");
      for (const row of await actionsOfLoop(trx, loop.id)) {
        expect(payloadOf(row).to).toEqual([ANNA]);
        expect(payloadOf(row).cc ?? []).toEqual([]);
      }
    });
  });

  test("B1 a delegated loop whose counterpart a data erase cleared gives not_allowed and no row, never the other To address", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      // The state that the erase writes: the counterpart is null, the delegate address is removed from To, the client stays.
      const loop = await commandLoop(trx, org, {
        kind: "delegated",
        to_addresses: ["client-x@example.test"],
        cc_addresses: [],
        counterpart: null,
        subject: null,
        text: null,
        texts_cleared_at: FRIDAY,
      });
      expect(await tap(trx, org, loop.id)).toEqual({ kind: "not_allowed" });
      expect(await actionsOfLoop(trx, loop.id)).toEqual([]);
    });
  });

  test("T8 the text of the opening mail is gone (retention): quote is null", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const loop = await commandLoop(trx, org);
      await trx
        .updateTable("sent_emails")
        .set({ content: "gone", body_text: null })
        .where("id", "=", loop.sentId)
        .execute();
      expect((await tap(trx, org, loop.id)).kind).toBe("planned");
      const draft = (await actionsOfLoop(trx, loop.id)).find((row) => row.type === "create_draft");
      expect(payloadOf(draft ?? { payload: null }).quote).toBeNull();
    });
  });

  test("T8c a restart by a later own mail: the quote is still the opening mail", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const loop = await commandLoop(trx, org);
      const later = await trx
        .insertInto("sent_emails")
        .values({
          org_id: org.ctx.orgId,
          mailbox_id: org.mailboxId,
          dedup_key: `mid:<${randomUUID()}@x.test>:h1`,
          path: "Sent",
          uidvalidity: "7",
          uid: "2",
          message_id: `<${randomUUID()}@x.test>`,
          thread_key: loop.threadKey,
          to_addresses: [ANNA],
          body_text: "A later note that must not be quoted",
          origin: "user",
          content: "stored",
          sent_at: new Date("2026-11-19T08:00:00Z"),
          internal_date: new Date("2026-11-19T08:00:00Z"),
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx.updateTable("open_loops").set({ last_sent_email_id: later.id }).where("id", "=", loop.id).execute();
      expect((await tap(trx, org, loop.id)).kind).toBe("planned");
      const draft = (await actionsOfLoop(trx, loop.id)).find((row) => row.type === "create_draft");
      expect(payloadOf(draft ?? { payload: null }).quote).toBe("Can you send the numbers by Friday?");
      expect(payloadOf(draft ?? { payload: null }).sent_at).toBe("2026-11-10T10:00:00.000Z");
    });
  });
});

describe("draftFollowUp: a new tap after a closed follow-up", () => {
  const closedOnes = ["rejected", "expired", "failed"] as const;
  for (const status of closedOnes) {
    test(`T8b a ${status} follow-up, then a tap: a new pair with k 2, the loop unchanged`, async () => {
      await withRollback(db, async (trx) => {
        const org = await commandOrg(trx);
        const loop = await commandLoop(trx, org);
        const first = await tap(trx, org, loop.id);
        const before = await loopOf(trx, loop.id);
        const failedExtra = status === "failed" ? { last_error: "x" } : {};
        await trx
          .updateTable("actions")
          .set({ status, ...failedExtra })
          .where("id", "=", first.kind === "planned" ? first.sendId : "")
          .execute();
        const second = await tap(trx, org, loop.id);
        expect(second.kind).toBe("planned");
        const keys = (await actionsOfLoop(trx, loop.id)).map((row) => row.idempotency_key).sort();
        expect(keys).toEqual([
          `${loop.id}:create_draft:follow_up:1:1`,
          `${loop.id}:create_draft:follow_up:1:2`,
          `${loop.id}:send:follow_up:1:1`,
          `${loop.id}:send:follow_up:1:2`,
        ]);
        const after = await loopOf(trx, loop.id);
        expect(after.updated_at.getTime()).toBe(before.updated_at.getTime());
        expect([after.follow_ups_sent, after.status]).toEqual([0, "open"]);
      });
    });
  }

  test("Done ends the follow-up, Reopen opens the loop, the next tap plans a new pair with k 2", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const loop = await commandLoop(trx, org);
      expect((await tap(trx, org, loop.id)).kind).toBe("planned");
      const deps = { db: trx, now: () => FRIDAY };
      const input = { loopId: loop.id, userId: org.userId, via: "web" as const };
      expect(await doneLoop(deps, org.ctx, input)).toEqual({ kind: "ok" });
      expect(await reopenLoop(deps, org.ctx, input)).toEqual({ kind: "ok" });
      expect((await tap(trx, org, loop.id)).kind).toBe("planned");
      const keys = (await actionsOfLoop(trx, loop.id)).map((row) => row.idempotency_key).sort();
      expect(keys).toEqual([
        `${loop.id}:create_draft:follow_up:1:1`,
        `${loop.id}:create_draft:follow_up:1:2`,
        `${loop.id}:send:follow_up:1:1`,
        `${loop.id}:send:follow_up:1:2`,
      ]);
    });
  });

  for (const status of ["approved", "applying"] as const) {
    test(`a ${status} send still waits: the tap answers waiting`, async () => {
      await withRollback(db, async (trx) => {
        const org = await commandOrg(trx);
        const loop = await commandLoop(trx, org);
        const first = await tap(trx, org, loop.id);
        await trx
          .updateTable("actions")
          .set({ status, approved_at: FRIDAY, approved_by: org.userId, approved_via: "telegram" })
          .where("id", "=", first.kind === "planned" ? first.sendId : "")
          .execute();
        expect(await tap(trx, org, loop.id)).toMatchObject({ kind: "waiting" });
        expect(await actionsOfLoop(trx, loop.id)).toHaveLength(2);
      });
    });
  }
});

describe("draftFollowUp: the text of the loop is data", () => {
  const SUBJECTS = [
    ["CR LF and a Bcc header", "Offer\r\nBcc: evil@x.test"],
    ["LF only", "Offer\nBcc: evil@x.test"],
    ["CR only", "Offer\rBcc: evil@x.test"],
    ["line separator U+2028 and paragraph U+2029", "Offer\u2028Bcc: evil@x.test\u2029X"],
    ["next line U+0085 and vertical tab", "Offer\u0085Bcc: evil@x.test\u000bX"],
    ["bidi and zero width marks", "Offer\u202eBcc\u200b: evil@x.test"],
    ["the encoded form is only text", "=?utf-8?q?Offer=0D=0ABcc=3A_evil=40x=2Etest?="],
  ] as const;
  for (const [label, subject] of SUBJECTS) {
    test(`the subject has one line: ${label}`, async () => {
      await withRollback(db, async (trx) => {
        const org = await commandOrg(trx);
        const loop = await commandLoop(trx, org, { subject });
        expect((await tap(trx, org, loop.id)).kind).toBe("planned");
        const draft = (await actionsOfLoop(trx, loop.id)).find((row) => row.type === "create_draft");
        const written = String(payloadOf(draft ?? { payload: null }).subject);
        // eslint-disable-next-line no-control-regex -- the point is to find them
        expect(written).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e]/);
        expect(written.length).toBeLessThanOrEqual(300);
      });
    });
  }

  test("the cut at 300 never splits a surrogate pair (the table caps the subject too, so the cut is a second guard)", () => {
    expect(oneLineSubject(`${"a".repeat(299)}😀${"b".repeat(100)}`)).toBe("a".repeat(299));
    expect(oneLineSubject(`${"a".repeat(298)}😀`)).toBe(`${"a".repeat(298)}😀`);
    expect(oneLineSubject(null)).toBe("");
  });

  const ADDRESSES = [
    ["a display name", "Anna <anna@example.test>"],
    ["a zero width character", "anna\u200b@example.test"],
    ["a soft hyphen", "an\u00adna@example.test"],
    ["a Cyrillic look-alike with a header line", "\u0430nna@example.test\r\nBcc: evil@x.test"],
    ["a space", "anna @example.test"],
    ["no domain", "anna"],
  ] as const;
  for (const [label, address] of ADDRESSES) {
    test(`an address that is not a plain address gives not_allowed and no row: ${label}`, async () => {
      await withRollback(db, async (trx) => {
        const org = await commandOrg(trx);
        const loop = await commandLoop(trx, org, { to_addresses: [address], counterpart: address });
        expect(await tap(trx, org, loop.id)).toEqual({ kind: "not_allowed" });
        expect(await actionsOfLoop(trx, loop.id)).toEqual([]);
      });
    });
  }

  test("a loop with no recipient (a DSR erase) gives not_allowed and no row", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const loop = await commandLoop(trx, org, { to_addresses: [], cc_addresses: [], counterpart: null });
      expect(await tap(trx, org, loop.id)).toEqual({ kind: "not_allowed" });
      expect(await actionsOfLoop(trx, loop.id)).toEqual([]);
    });
  });
});

describe("draftFollowUp: a key that exists with no waiting send", () => {
  test("the failure is a rolled-back transaction: a committed call leaves no new row", async () => {
    const org = await db.transaction().execute((trx) => commandOrg(trx));
    try {
      const loop = await db.transaction().execute(async (trx) => {
        const made = await commandLoop(trx, org);
        await trx
          .insertInto("actions")
          .values({
            org_id: org.ctx.orgId,
            loop_id: made.id,
            email_id: null,
            type: "create_draft",
            status: "ready",
            payload: "{}",
            idempotency_key: `${made.id}:create_draft:follow_up:1:1`,
          })
          .execute();
        return made;
      });
      await expect(
        draftFollowUp({ db, now: () => FRIDAY }, org.ctx, { loopId: loop.id, userId: org.userId, via: "web" })
      ).rejects.toThrow("the follow-up keys exist after the loop lock");
      const rows = await actionsOfLoop(db, loop.id);
      expect(rows.map((row) => row.type)).toEqual(["create_draft"]);
      expect(await auditOf(db, org.ctx.orgId, "action.planned")).toEqual([]);
    } finally {
      await db.deleteFrom("organizations").where("id", "=", org.ctx.orgId).execute();
      await db.deleteFrom("users").where("id", "in", [org.userId, org.memberId]).execute();
    }
  });
});

describe("draftFollowUp: logs", () => {
  test("a log line has ids and codes only; the loop text, the subject and the addresses are not in it", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const secret = "Confidential reorganisation";
      const loop = await commandLoop(trx, org, { subject: secret, text: secret });
      const logs = captureLogs();
      let result: DraftFollowUpResult;
      try {
        result = await tap(trx, org, loop.id);
        const lines = eventLines(logs.lines, "loop_command");
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatchObject({ command: "follow_up", kind: "planned", via: "telegram", loop_id: loop.id });
        expect(logProblems(logs.lines, [secret, ANNA, JAN])).toEqual([]);
      } finally {
        logs.stop();
      }
      expect(result.kind).toBe("planned");
    });
  });
});
