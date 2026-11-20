import { randomUUID } from "node:crypto";

import { sendPayloadFor, type DraftPayload, DAY_MS } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { noApprovalHooks, sendAgain, type ApprovalDeps } from "../../src/modules/actions";
import { SEND_SOFT_CAP_MS } from "../../src/modules/actions/constants";
import { delegationHooks } from "../../src/modules/delegation";
import { MailAuthError } from "../../src/modules/mail";
import type { DB } from "../../src/platform/db";
import { HardError, SoftError } from "../../src/platform/errors";
import { captureLogs, type CapturedLogs } from "../log-capture";

import {
  actionRow,
  copyBox,
  copyOf,
  deleteCopy,
  draftCopies,
  editCopy,
  flagOn,
  MINUTE,
  NOW,
  reverseOf,
  runSend,
  seedPair,
  tap,
  type CopyBox,
  type Edit,
} from "./copy-hash-fixtures";
import { testDb, withRollback } from "./helpers";
import { insertLoopActionPair, insertLoopRow, insertSentRow } from "./loops-fixtures";

// The copy check before the SMTP call. GreenMail holds the copies; the test edits them like a mail client.
const db = testDb();
const boxes: CopyBox[] = [];
let logs: CapturedLogs | null = null;

afterEach(async () => {
  logs?.stop();
  logs = null;
  for (const box of boxes) await box.close();
  boxes.length = 0;
});

afterAll(async () => {
  await db.destroy();
});

const approvals = (trx: Transaction<DB>): ApprovalDeps => ({
  db: trx,
  hooks: delegationHooks({ db: trx }),
  approvalHooks: noApprovalHooks,
  uidplus: async () => true,
});

// The copy results of `reply_send_checked`. The pass before a reply send writes the same event with the codes `answered`,
// `not_answered`, `newer_mail` and `original_moved`; its tests are in `replies-answered-pass.test.ts`.
const COPY_RESULTS = ["same", "changed", "missing", "no_baseline"];
const checked = (captured: CapturedLogs): unknown[] =>
  captured.lines
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return {};
      }
    })
    .filter((line) => line.event === "reply_send_checked" && COPY_RESULTS.includes(String(line.result)))
    .map((line) => line.result);

describe("the copy check: an untouched or re-saved copy sends", () => {
  test("1. a reply (flag draft_copy_check off) and a delegation (flag on): one SMTP call each, result same", async () => {
    await withRollback(db, async (trx) => {
      logs = captureLogs();
      const reply = await seedPair(trx, boxes, { kind: "reply", flag: false });
      expect((await runSend(trx, reply.box, reply.p.sendId)).status).toBe("applied");
      expect(reply.box.sender.sent).toHaveLength(1);

      const delegation = await seedPair(trx, boxes, { kind: "delegation", flag: true });
      // A re-save with no change keeps the hash: the server may re-encode the text.
      await editCopy(delegation.box, delegation.p.draftId);
      expect((await runSend(trx, delegation.box, delegation.p.sendId)).status).toBe("applied");
      expect(delegation.box.sender.sent).toHaveLength(1);
      expect(checked(logs)).toEqual(["same", "same"]);
    });
  });
});

const EDITS: { name: string; edit: Edit; delegation?: true }[] = [
  {
    name: "the body",
    edit: { text: (text) => text.replace("Prepare", "Skip").replace("Thank you", "Hello") },
    delegation: true,
  },
  { name: "an attachment added, the body the same", edit: { attachment: { filename: "offer.txt", content: "x" } } },
  { name: "To", edit: { to: ["someone-else@example.com"] }, delegation: true },
  { name: "Cc", edit: { cc: ["extra@example.com"] } },
  { name: "the Subject", edit: { subject: "A new subject" } },
];

describe("the copy check: a changed copy never sends", () => {
  for (const kind of ["reply", "delegation"] as const) {
    // A delegation shares the code of a reply: two edits of it are enough; a reply gets every edit.
    for (const { name, edit } of kind === "reply" ? EDITS : EDITS.filter((entry) => entry.delegation)) {
      test(`2/3. ${kind}: ${name} changed → draft_changed, zero SMTP calls, the copy stays`, async () => {
        await withRollback(db, async (trx) => {
          logs = captureLogs();
          const { box, p, delegation } = await seedPair(trx, boxes, { kind, flag: true });
          // The body edit must change the text: both kinds hold one of the two words.
          await editCopy(box, p.draftId, edit);
          const before = await copyOf(box, p.draftId);

          const send = await runSend(trx, box, p.sendId);

          expect(send).toMatchObject({ status: "expired", status_reason: "draft_changed", locked_at: null });
          expect(send.result_notified_at).toBeNull();
          expect(box.sender.sent).toHaveLength(0);
          expect(checked(logs)).toEqual(["changed"]);
          expect(await draftCopies(box)).toHaveLength(1);
          expect((await copyOf(box, p.draftId))?.uid).toBe(before?.uid);
          if (delegation !== null) {
            const row = await trx
              .selectFrom("delegations")
              .selectAll()
              .where("id", "=", delegation)
              .executeTakeFirstOrThrow();
            expect(row).toMatchObject({ status: "cancelled", status_reason: "draft_changed" });
          }
          // The next run ends the draft: the reverse row keeps the changed copy.
          await box.committer.run();
          expect(await draftCopies(box)).toHaveLength(1);
          expect(await reverseOf(trx, p.draftId)).toMatchObject({
            status: "applied",
            provider_result: { found: true, kept: "changed" },
          });
        });
      });
    }
  }

  test("4. the copy deleted → draft_missing, zero SMTP calls", async () => {
    await withRollback(db, async (trx) => {
      logs = captureLogs();
      const { box, p } = await seedPair(trx, boxes, { kind: "reply", flag: false });
      await deleteCopy(box, p.draftId);

      const send = await runSend(trx, box, p.sendId);

      expect(send).toMatchObject({ status: "expired", status_reason: "draft_missing" });
      expect(box.sender.sent).toHaveLength(0);
      expect(checked(logs)).toEqual(["missing"]);
    });
  });
});

async function dropBaseline(trx: Transaction<DB>, draftId: string): Promise<void> {
  const row = await actionRow(trx, draftId);
  const rest = Object.fromEntries(
    Object.entries(row.provider_result as Record<string, unknown>).filter(([key]) => key !== "copy_hash")
  );
  await trx
    .updateTable("actions")
    .set({ provider_result: JSON.stringify(rest) })
    .where("id", "=", draftId)
    .execute();
}

describe("the copy check: no baseline, and the flag", () => {
  test("5. a delegation draft without copy_hash sends as today; a reply without it ends draft_missing and its copy stays", async () => {
    await withRollback(db, async (trx) => {
      logs = captureLogs();
      const delegation = await seedPair(trx, boxes, { kind: "delegation", flag: true });
      await dropBaseline(trx, delegation.p.draftId);
      await editCopy(delegation.box, delegation.p.draftId, { text: (text) => `${text} edited` });
      expect((await runSend(trx, delegation.box, delegation.p.sendId)).status).toBe("applied");
      expect(delegation.box.sender.sent).toHaveLength(1);

      const reply = await seedPair(trx, boxes, { kind: "reply", flag: false });
      await dropBaseline(trx, reply.p.draftId);
      const send = await runSend(trx, reply.box, reply.p.sendId);
      expect(send).toMatchObject({ status: "expired", status_reason: "draft_missing" });
      expect(reply.box.sender.sent).toHaveLength(0);
      await reply.box.committer.run();
      // No baseline: the reverse row of a reply keeps the copy (the text may be the user's).
      expect(await draftCopies(reply.box)).toHaveLength(1);
      expect(await reverseOf(trx, reply.p.draftId)).toMatchObject({
        status: "applied",
        provider_result: { found: true, kept: "no_baseline" },
      });
      expect(checked(logs)).toEqual(["no_baseline", "no_baseline"]);
    });
  });

  test("6. flag off: a delegation with an edited copy sends as today; a reply with an edited copy ends draft_changed", async () => {
    await withRollback(db, async (trx) => {
      const delegation = await seedPair(trx, boxes, { kind: "delegation", flag: false });
      await editCopy(delegation.box, delegation.p.draftId, { text: (text) => `${text} edited` });
      expect((await runSend(trx, delegation.box, delegation.p.sendId)).status).toBe("applied");
      expect(delegation.box.sender.sent).toHaveLength(1);

      const reply = await seedPair(trx, boxes, { kind: "reply", flag: false });
      await editCopy(reply.box, reply.p.draftId, { text: (text) => `${text} edited` });
      expect(await runSend(trx, reply.box, reply.p.sendId)).toMatchObject({
        status: "expired",
        status_reason: "draft_changed",
      });
      expect(reply.box.sender.sent).toHaveLength(0);
    });
  });
});

describe("the copy check: an IMAP error", () => {
  function failOnce(box: CopyBox): { count: number } {
    const seen = { count: 0 };
    box.wrap.provider = (provider) =>
      new Proxy(provider, {
        get(target, prop) {
          if (prop !== "fetchContent") return Reflect.get(target, prop, target) as unknown;
          return async (...args: Parameters<typeof target.fetchContent>) => {
            seen.count += 1;
            if (seen.count === 1) throw new SoftError("IMAP fetchContent: timeout");
            return target.fetchContent(...args);
          };
        },
      });
    return seen;
  }

  test("7. a read that times out once: the send waits 5 minutes with no count, then sends on the next run", async () => {
    await withRollback(db, async (trx) => {
      const { box, p } = await seedPair(trx, boxes, { kind: "reply", flag: false });
      failOnce(box);

      const waiting = await runSend(trx, box, p.sendId);

      expect(waiting).toMatchObject({ status: "approved", attempts: 0, locked_at: null });
      expect(waiting.next_attempt_at).toEqual(new Date(NOW.getTime() + 5 * MINUTE));
      expect(box.sender.sent).toHaveLength(0);

      box.clock.now = new Date(NOW.getTime() + 6 * MINUTE);
      await box.committer.run();

      expect((await actionRow(trx, p.sendId)).status).toBe("applied");
      expect(box.sender.sent).toHaveLength(1);
    });
  });

  test("7b. the error counts against the 6 hour soft cap: past it the send fails copy_check_error with the cap mark", async () => {
    await withRollback(db, async (trx) => {
      const { box, p } = await seedPair(trx, boxes, { kind: "reply", flag: false });
      failOnce(box);
      await tap(trx, box, p.sendId);
      await trx
        .updateTable("actions")
        .set({ approved_at: new Date(NOW.getTime() - SEND_SOFT_CAP_MS - MINUTE) })
        .where("id", "=", p.sendId)
        .execute();

      await box.committer.run();

      expect(await actionRow(trx, p.sendId)).toMatchObject({
        status: "failed",
        status_reason: "copy_check_error",
        provider_result: { stage: "copy_check", cap: "soft_retry" },
      });
      expect(box.sender.sent).toHaveLength(0);
      // Nothing went out: "Send again" is offered, as for a failed SMTP call.
      const again = await sendAgain(approvals(trx), box.ctx, p.sendId, { userId: box.userId, via: "web", now: NOW });
      expect(again.kind).toBe("created");
    });
  });

  test("7c. a hard error counts: the third one fails copy_check_error (not smtp_error), no SMTP call", async () => {
    await withRollback(db, async (trx) => {
      const { box, p } = await seedPair(trx, boxes, { kind: "reply", flag: false });
      box.wrap.provider = (provider) =>
        new Proxy(provider, {
          get(target, prop) {
            if (prop !== "fetchContent") return Reflect.get(target, prop, target) as unknown;
            return async () => {
              throw new HardError("read failed");
            };
          },
        });
      await tap(trx, box, p.sendId);

      const states: unknown[] = [];
      for (let run = 0; run < 3; run += 1) {
        box.clock.now = new Date(NOW.getTime() + run * 6 * MINUTE);
        await box.committer.run();
        const row = await actionRow(trx, p.sendId);
        states.push([row.status, row.status_reason, row.attempts]);
      }

      expect(states).toEqual([
        ["approved", null, 1],
        ["approved", null, 2],
        ["failed", "copy_check_error", 3],
      ]);
      expect((await actionRow(trx, p.sendId)).provider_result).toEqual({ stage: "copy_check" });
      expect(box.sender.sent).toHaveLength(0);
    });
  });

  test("7d. a login error during the check sends the row back to approved with no count; the mailbox goes to auth_error", async () => {
    await withRollback(db, async (trx) => {
      const { box, p } = await seedPair(trx, boxes, { kind: "reply", flag: false });
      box.wrap.provider = (provider) =>
        new Proxy(provider, {
          get(target, prop) {
            if (prop !== "fetchContent") return Reflect.get(target, prop, target) as unknown;
            return async () => {
              throw new MailAuthError("login refused");
            };
          },
        });

      const waiting = await runSend(trx, box, p.sendId);

      expect(waiting).toMatchObject({ status: "approved", attempts: 0, locked_at: null, next_attempt_at: null });
      expect(box.sender.sent).toHaveLength(0);
      const mailbox = await trx
        .selectFrom("mailboxes")
        .select("status")
        .where("id", "=", box.mailboxId)
        .executeTakeFirstOrThrow();
      expect(mailbox.status).toBe("auth_error");
    });
  });
});

describe("the copy check: the folder", () => {
  test("10. the copy is looked for in the folder that the draft row stores, not in the folder_map default", async () => {
    await withRollback(db, async (trx) => {
      const { box, p } = await seedPair(trx, boxes, { kind: "reply", flag: false });
      // The copy lives in another folder now (the folder map changed after the APPEND); the row names it.
      await box.mailClient.ensureFolder("Old drafts");
      const meta = await copyOf(box, p.draftId);
      if (meta === null) throw new Error("no copy");
      const moved = await box.mailClient.transferByAppend("Drafts", meta.uid, "Old drafts");
      const row = await actionRow(trx, p.draftId);
      await trx
        .updateTable("actions")
        .set({
          provider_result: JSON.stringify({
            ...(row.provider_result as object),
            folder: "Old drafts",
            uid: moved.newUid,
          }),
        })
        .where("id", "=", p.draftId)
        .execute();

      expect((await runSend(trx, box, p.sendId)).status).toBe("applied");
      expect(box.sender.sent).toHaveLength(1);
    });
  });
});

describe("the copy check: the cards", () => {
  test("9. a send that the check closes edits its cards through the approval hooks of the committer: once, as expired", async () => {
    await withRollback(db, async (trx) => {
      const { box, p } = await seedPair(trx, boxes, { kind: "reply", flag: false });
      await editCopy(box, p.draftId, { text: (text) => `${text} edited` });

      await runSend(trx, box, p.sendId);

      expect(box.decided).toEqual([{ sendId: p.sendId, decision: "expired" }]);
    });
  });
});

describe("the copy check: a follow-up", () => {
  test("8. an edited copy → draft_changed, zero SMTP calls, the loop row unchanged, no outbox row written by the close", async () => {
    await withRollback(db, async (trx) => {
      const box = await copyBox(trx);
      boxes.push(box);
      await flagOn(trx, box, "draft_copy_check");
      const to = [`anna-${randomUUID()}@example.com`];
      const cc = [`jan-${randomUUID()}@example.com`];
      const sent = await insertSentRow(trx, box.ctx, box.mailboxId, { toAddresses: to, ccAddresses: cc, subject: "S" });
      const loopId = await insertLoopRow(trx, box.ctx, box.mailboxId, {
        sent_email_id: sent,
        message_id: "<own-1@x.test>",
        subject: "S",
        to_addresses: to,
        cc_addresses: cc,
        counterpart: to[0] ?? null,
        language: "en",
        due_at: new Date(NOW.getTime() - DAY_MS),
      });
      const draft: DraftPayload = {
        kind: "follow_up",
        loop_id: loopId,
        to,
        cc,
        language: "en",
        sent_at: "2026-11-10T09:30:00.000Z",
        subject: "S",
        quote: "Q",
        n: 1,
      };
      const ids = await insertLoopActionPair(trx, box.ctx, loopId, {
        draftStatus: "ready",
        sendStatus: "awaiting_approval",
        createdAt: new Date(NOW.getTime() - 60 * MINUTE),
        payloads: { draft, send: sendPayloadFor(draft) },
      });
      await box.committer.run();
      expect((await actionRow(trx, ids.draftId)).provider_result).toMatchObject({ copy_hash: expect.any(String) });
      const loopBefore = await trx
        .selectFrom("open_loops")
        .selectAll()
        .where("id", "=", loopId)
        .executeTakeFirstOrThrow();
      await editCopy(box, ids.draftId, { text: (text) => `${text}\n\nedited` });
      const outboxBefore = await trx.selectFrom("outbox").select("id").where("org_id", "=", box.ctx.orgId).execute();

      const send = await runSend(trx, box, ids.sendId);

      expect(send).toMatchObject({ status: "expired", status_reason: "draft_changed" });
      expect(box.sender.sent).toHaveLength(0);
      const loopAfter = await trx
        .selectFrom("open_loops")
        .selectAll()
        .where("id", "=", loopId)
        .executeTakeFirstOrThrow();
      expect(loopAfter).toEqual(loopBefore);
      expect(await trx.selectFrom("outbox").select("id").where("org_id", "=", box.ctx.orgId).execute()).toEqual(
        outboxBefore
      );
      expect(await draftCopies(box)).toHaveLength(1);
    });
  });

  test("8b. the loop lock comes first: isOpen runs before the send closes, once, for the loop of the follow-up", async () => {
    await withRollback(db, async (trx) => {
      const box = await copyBox(trx);
      boxes.push(box);
      await flagOn(trx, box, "draft_copy_check");
      const to = [`anna-${randomUUID()}@example.com`];
      const sent = await insertSentRow(trx, box.ctx, box.mailboxId, { toAddresses: to, ccAddresses: [], subject: "S" });
      const loopId = await insertLoopRow(trx, box.ctx, box.mailboxId, {
        sent_email_id: sent,
        message_id: "<own-2@x.test>",
        subject: "S",
        to_addresses: to,
        cc_addresses: [],
        counterpart: to[0] ?? null,
        language: "en",
        due_at: new Date(NOW.getTime() - DAY_MS),
      });
      const draft: DraftPayload = {
        kind: "follow_up",
        loop_id: loopId,
        to,
        cc: [],
        language: "en",
        sent_at: "2026-11-10T09:30:00.000Z",
        subject: "S",
        quote: "Q",
        n: 1,
      };
      const ids = await insertLoopActionPair(trx, box.ctx, loopId, {
        draftStatus: "ready",
        sendStatus: "awaiting_approval",
        createdAt: new Date(NOW.getTime() - 60 * MINUTE),
        payloads: { draft, send: sendPayloadFor(draft) },
      });
      await box.committer.run();
      await editCopy(box, ids.draftId, { text: (text) => `${text}\n\nedited` });
      const seen: { loopId: string; sendStatus: string }[] = [];
      box.onIsOpen.run = async (hookTrx, id) => {
        const send = await actionRow(hookTrx, ids.sendId);
        seen.push({ loopId: id, sendStatus: send.status });
      };

      await runSend(trx, box, ids.sendId);

      // One call, while the send is still `approved`: the loop lock is taken before the send row is closed.
      expect(seen).toEqual([{ loopId, sendStatus: "approved" }]);
      expect((await actionRow(trx, ids.sendId)).status_reason).toBe("draft_changed");
    });
  });
});
