import { randomUUID } from "node:crypto";

import { HOUR_MS, MINUTE_MS } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { listSendResultsToNotify, listSweepReplySends, type ApprovalHooks } from "../../src/modules/actions";
import { updateMailboxSettings } from "../../src/modules/config";
import { delegationHooks } from "../../src/modules/delegation";
import { newerMailInThread, refreshFlagsOfEmail } from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { insertInboxFolder, insertMailbox, setMailboxStatus } from "../../src/modules/mail/repo";
import { createReplySweep, SWEEP_LIMIT, SWEEP_LIST_LIMIT } from "../../src/modules/replies";
import { setOrgFeature } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";
import { captureLogs, type CapturedLogs } from "../log-capture";

import { insertDraftAndSend, insertTestEmail, insertTriaged, testCapabilities } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import {
  addThreadMail,
  markAnswered,
  SWEEP_NOW,
  SWITCHES,
  sweepOrg,
  sweepReply,
  T0,
  type SweepOrg,
} from "./reply-answered-fixtures";

// The sweep closes open reply sends whose reason to exist ended. It reads the database only.
const db = testDb();
let logs: CapturedLogs | null = null;

afterEach(() => {
  logs?.stop();
  logs = null;
});

afterAll(async () => {
  await db.destroy();
});

const NOW = SWEEP_NOW;

async function send(trx: Transaction<DB>, id: string) {
  return trx.selectFrom("actions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

function sweepOf(
  trx: Transaction<DB>,
  decided: { sendId: string; decision: string }[] = [],
  limits: { closeLimit?: number; listLimit?: number; now?: () => Date } = {}
) {
  const approvalHooks: ApprovalHooks = {
    onDecided: async (_trx, _ctx, input) => {
      decided.push({ sendId: input.sendId, decision: input.decision });
    },
  };
  return createReplySweep({
    db: trx,
    hooks: delegationHooks({ db: trx }),
    approvalHooks,
    uidplus: async () => true,
    now: limits.now ?? (() => NOW),
    ...(limits.closeLimit === undefined ? {} : { closeLimit: limits.closeLimit }),
    ...(limits.listLimit === undefined ? {} : { listLimit: limits.listLimit }),
  });
}

const run = (trx: Transaction<DB>, o: SweepOrg, decided?: { sendId: string; decision: string }[]) =>
  sweepOf(trx, decided).run({ mailboxIds: [o.mailboxId] });

describe("the sweep: answered", () => {
  test("1. email_flags.answered closes a waiting reply with no result notice, and a held approved reply with one", async () => {
    await withRollback(db, async (trx) => {
      logs = captureLogs();
      const o = await sweepOrg(trx);
      const waiting = await sweepReply(trx, o);
      const held = await sweepReply(trx, o, { status: "approved" });
      await markAnswered(trx, o, waiting.emailId);
      await markAnswered(trx, o, held.emailId);
      const decided: { sendId: string; decision: string }[] = [];

      const result = await run(trx, o, decided);

      expect(result).toMatchObject({ checked: 2, skipped: 0, closed: { answered: 2 } });
      expect(await send(trx, waiting.sendId)).toMatchObject({
        status: "expired",
        status_reason: "answered",
        result_notified_at: NOW,
      });
      expect(await send(trx, held.sendId)).toMatchObject({
        status: "expired",
        status_reason: "answered",
        result_notified_at: null,
      });
      const toTell = await listSendResultsToNotify(trx, o.ctx, { limit: 10, now: NOW, pendingCopyMaxAgeMs: 600_000 });
      expect(toTell.map((row) => row.id)).toEqual([held.sendId]);
      // The cards of both lose their buttons.
      expect(decided.map((entry) => entry.sendId).sort()).toEqual([held.sendId, waiting.sendId].sort());
      expect(decided.every((entry) => entry.decision === "expired")).toBe(true);
      // One event line per close; ids and codes only.
      const lines = logs.lines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((l) => l.event === "reply_closed");
      expect(lines.map((line) => [line.action_id, line.reason]).sort()).toEqual(
        [
          [waiting.sendId, "answered"],
          [held.sendId, "answered"],
        ].sort()
      );
      // The draft of a closed send is closed too: the copy goes through a reverse row.
      expect(
        await trx.selectFrom("actions").select("id").where("reverses_action_id", "=", waiting.draftId).execute()
      ).toHaveLength(1);
    });
  });

  test("1b. a reply of the user in the Sent rows (sent_emails, origin user) closes it; a system row does not", async () => {
    await withRollback(db, async (trx) => {
      const o = await sweepOrg(trx);
      const answered = await sweepReply(trx, o, { messageId: "<answered-one@x.test>" });
      const system = await sweepReply(trx, o, { messageId: "<system-one@x.test>" });
      const sentRow = (parent: string, origin: "user" | "system", actionId: string | null = null) =>
        trx
          .insertInto("sent_emails")
          .values({
            org_id: o.ctx.orgId,
            mailbox_id: o.mailboxId,
            dedup_key: `mid:<${randomUUID()}@x.test>:h1`,
            path: "Sent",
            uidvalidity: "7",
            uid: String(Math.floor(Math.random() * 1_000_000)),
            message_id: `<${randomUUID()}@x.test>`,
            parent_message_id: parent,
            thread_key: parent,
            to_addresses: ["boss@x.test"],
            origin,
            action_id: actionId,
            content: "headers_only",
            sent_at: new Date(T0.getTime() + HOUR_MS),
            internal_date: new Date(T0.getTime() + HOUR_MS),
          })
          .execute();
      await sentRow("<answered-one@x.test>", "user");
      // A row of a send of the system has the id of its action; it is no answer of the user.
      await sentRow("<system-one@x.test>", "system", system.draftId);

      await run(trx, o);

      expect(await send(trx, answered.sendId)).toMatchObject({ status: "expired", status_reason: "answered" });
      expect((await send(trx, system.sendId)).status).toBe("awaiting_approval");
    });
  });
});

describe("the sweep: newer mail, moved mail, suspicious mail", () => {
  test("2. a newer mail in the thread closes it; a newer automatic mail (out-of-office) leaves it open", async () => {
    await withRollback(db, async (trx) => {
      const o = await sweepOrg(trx);
      const closed = await sweepReply(trx, o);
      const open = await sweepReply(trx, o);
      await addThreadMail(trx, o.ctx, closed.emailId, { receivedAt: new Date(T0.getTime() + HOUR_MS) });
      await addThreadMail(trx, o.ctx, open.emailId, {
        receivedAt: new Date(T0.getTime() + HOUR_MS),
        autoSubmitted: "auto-replied",
      });

      const result = await run(trx, o);

      expect(result.closed.newer_mail).toBe(1);
      expect(await send(trx, closed.sendId)).toMatchObject({ status: "expired", status_reason: "newer_mail" });
      expect((await send(trx, open.sendId)).status).toBe("awaiting_approval");
    });
  });

  test("2b. an older mail drafted first and a newer mail of another category after it (stage 07 carry-over): the sweep closes the older draft", async () => {
    await withRollback(db, async (trx) => {
      const o = await sweepOrg(trx);
      const thread = `<thread-${randomUUID()}@x.test>`;
      const older = await sweepReply(trx, o, { threadKey: thread });
      // A newsletter in the same thread: no open reply, no request, so the drafter let the older draft stand.
      await insertTriaged(trx, o.ctx, o.mailboxId, {
        category: "info",
        createdAt: new Date(T0.getTime() + HOUR_MS),
        threadKey: thread,
      });

      await run(trx, o);

      expect(await send(trx, older.sendId)).toMatchObject({ status: "expired", status_reason: "newer_mail" });
    });
  });

  test("7. a later triage result with auth_fail closes it as suspicious; a clean later result does not", async () => {
    await withRollback(db, async (trx) => {
      const o = await sweepOrg(trx);
      const flagged = await sweepReply(trx, o);
      const cleared = await sweepReply(trx, o);
      const result = (emailId: string, at: Date, reasons: string[]) =>
        trx
          .insertInto("triage_results")
          .values({
            org_id: o.ctx.orgId,
            email_id: emailId,
            category: "needs_reply",
            confidence: 0.9,
            reason_code: "direct_request",
            fields: "{}",
            suspicious_reasons: reasons,
            created_at: at,
          })
          .execute();
      await result(flagged.emailId, new Date(T0.getTime() + HOUR_MS), ["auth_fail"]);
      // A flag that a later result removes is gone: the newest result decides.
      await result(cleared.emailId, new Date(T0.getTime() + HOUR_MS), ["auth_fail"]);
      await result(cleared.emailId, new Date(T0.getTime() + 2 * HOUR_MS), []);

      const swept = await run(trx, o);

      expect(swept.closed.suspicious).toBe(1);
      expect(await send(trx, flagged.sendId)).toMatchObject({ status: "expired", status_reason: "suspicious" });
      expect((await send(trx, cleared.sendId)).status).toBe("awaiting_approval");
    });
  });

  test("3. the folder of the original changed (Archive) → original_moved", async () => {
    await withRollback(db, async (trx) => {
      const o = await sweepOrg(trx);
      const moved = await sweepReply(trx, o);
      const stays = await sweepReply(trx, o);
      await trx.updateTable("emails").set({ folder: "Archive" }).where("id", "=", moved.emailId).execute();

      const result = await run(trx, o);

      expect(result.closed.original_moved).toBe(1);
      expect(await send(trx, moved.sendId)).toMatchObject({ status: "expired", status_reason: "original_moved" });
      expect((await send(trx, stays.sendId)).status).toBe("awaiting_approval");
    });
  });
});

describe("the sweep: policy, locks, tenants, limits", () => {
  test("4. the switch off, or shadow mode → policy_changed; a delegation send of the mailbox stays open", async () => {
    await withRollback(db, async (trx) => {
      const off = await sweepOrg(trx);
      const offReply = await sweepReply(trx, off);
      const delegation = await insertDraftAndSend(trx, off.ctx, off.mailboxId, { createdAt: T0 });
      await trx
        .updateTable("mailbox_settings")
        .set({ tool_switches: JSON.stringify({ ...SWITCHES, reply_drafts: false }) })
        .where("mailbox_id", "=", off.mailboxId)
        .execute();

      const first = await run(trx, off);

      expect(first.closed.policy_changed).toBe(1);
      expect(await send(trx, offReply.sendId)).toMatchObject({ status: "expired", status_reason: "policy_changed" });
      expect((await send(trx, delegation.sendId)).status).toBe("awaiting_approval");

      const shadow = await sweepOrg(trx);
      const shadowReply = await sweepReply(trx, shadow);
      await updateMailboxSettings(trx, shadow.ctx, shadow.mailboxId, { mode: "shadow" });
      await run(trx, shadow);
      expect(await send(trx, shadowReply.sendId)).toMatchObject({ status: "expired", status_reason: "policy_changed" });
    });
  });

  test("4b. the flag reply_drafts off: the sweep closes nothing (the committer holds the send, the expiry job ends it)", async () => {
    await withRollback(db, async (trx) => {
      const o = await sweepOrg(trx);
      const answered = await sweepReply(trx, o);
      await markAnswered(trx, o, answered.emailId);
      await setOrgFeature(trx, o.ctx, { flag: "reply_drafts", enabled: false, actor: "cli", now: T0 });

      const result = await run(trx, o);

      expect(result.checked).toBe(0);
      expect((await send(trx, answered.sendId)).status).toBe("awaiting_approval");
    });
  });

  test("5. an approved reply with locked_at set (the committer holds it) is untouched; an unlocked one is closed", async () => {
    await withRollback(db, async (trx) => {
      const o = await sweepOrg(trx);
      const locked = await sweepReply(trx, o, { status: "approved", lockedAt: new Date(NOW.getTime() - 1000) });
      const free = await sweepReply(trx, o, { status: "approved" });
      await markAnswered(trx, o, locked.emailId);
      await markAnswered(trx, o, free.emailId);

      const result = await run(trx, o);

      // The locked send is not even listed: the sweep looked at one send.
      expect(result).toMatchObject({ checked: 1, skipped: 0, closed: { answered: 1 } });
      expect(await send(trx, locked.sendId)).toMatchObject({ status: "approved", status_reason: null });
      expect(await send(trx, free.sendId)).toMatchObject({ status: "expired", status_reason: "answered" });
    });
  });

  test("5b. an applying reply is never closed", async () => {
    await withRollback(db, async (trx) => {
      const o = await sweepOrg(trx);
      const pair = await sweepReply(trx, o, { status: "approved" });
      await trx
        .updateTable("actions")
        .set({ status: "applying", send_started_at: T0 })
        .where("id", "=", pair.sendId)
        .execute();
      await markAnswered(trx, o, pair.emailId);

      const result = await run(trx, o);

      expect(result.checked).toBe(0);
      expect((await send(trx, pair.sendId)).status).toBe("applying");
    });
  });

  test("6. org isolation: the data of organization A never closes a send of organization B; the data of B closes it", async () => {
    await withRollback(db, async (trx) => {
      const a = await sweepOrg(trx);
      const b = await sweepOrg(trx);
      const thread = `<thread-${randomUUID()}@x.test>`;
      const messageId = `<same-${randomUUID()}@x.test>`;
      const bSend = await sweepReply(trx, b, { messageId, threadKey: thread });
      // Organization A holds a mail with the same Message-ID and thread key, answered, with a newer mail and a user reply in Sent.
      const aMail = await sweepReply(trx, a, { messageId, threadKey: thread });
      await markAnswered(trx, a, aMail.emailId);
      await addThreadMail(trx, a.ctx, aMail.emailId, { receivedAt: new Date(T0.getTime() + HOUR_MS) });
      await trx
        .insertInto("sent_emails")
        .values({
          org_id: a.ctx.orgId,
          mailbox_id: a.mailboxId,
          dedup_key: `mid:<${randomUUID()}@x.test>:h1`,
          path: "Sent",
          uidvalidity: "7",
          uid: "1",
          message_id: `<${randomUUID()}@x.test>`,
          parent_message_id: messageId,
          thread_key: thread,
          to_addresses: ["boss@x.test"],
          origin: "user",
          content: "headers_only",
          sent_at: new Date(T0.getTime() + HOUR_MS),
          internal_date: new Date(T0.getTime() + HOUR_MS),
        })
        .execute();

      // The whole run, with no mailbox filter: both organizations are swept.
      await sweepOf(trx).run();

      expect((await send(trx, aMail.sendId)).status).toBe("expired");
      expect(await send(trx, bSend.sendId)).toMatchObject({ status: "awaiting_approval", status_reason: null });

      await markAnswered(trx, b, bSend.emailId);
      await sweepOf(trx).run();
      expect(await send(trx, bSend.sendId)).toMatchObject({ status: "expired", status_reason: "answered" });
    });
  });

  test(
    "8. at most 200 closes per run, oldest first; the rest wait for the next run",
    async () => {
      await withRollback(db, async (trx) => {
        const o = await sweepOrg(trx);
        const created: string[] = [];
        for (let index = 0; index < 203; index += 1) {
          const pair = await sweepReply(trx, o, { createdAt: new Date(T0.getTime() + index * 1000) });
          await markAnswered(trx, o, pair.emailId);
          created.push(pair.sendId);
        }

        const first = await run(trx, o);

        expect(first).toMatchObject({ checked: 203, closed: { answered: 200 } });
        const states = await trx.selectFrom("actions").select(["id", "status"]).where("id", "in", created).execute();
        const open = states.filter((row) => row.status === "awaiting_approval").map((row) => row.id);
        expect(open.sort()).toEqual(created.slice(200).sort());
        const second = await run(trx, o);
        expect(second.closed.answered).toBe(3);
      });
    },
    MINUTE_MS
  );

  test("8b. the cap of closes is for the whole run, not for each mailbox", async () => {
    await withRollback(db, async (trx) => {
      const a = await sweepOrg(trx);
      const b = await sweepOrg(trx);
      for (const o of [a, b]) {
        for (let index = 0; index < 3; index += 1) {
          const pair = await sweepReply(trx, o, { createdAt: new Date(T0.getTime() + index * 1000) });
          await markAnswered(trx, o, pair.emailId);
        }
      }

      const result = await sweepOf(trx, [], { closeLimit: 4 }).run({ mailboxIds: [a.mailboxId, b.mailboxId] });

      expect(result.closed.answered).toBe(4);
    });
  });

  test("9. a send that the user rejected between the read and the close is skipped, not an error", async () => {
    await withRollback(db, async (trx) => {
      logs = captureLogs();
      const o = await sweepOrg(trx);
      const pair = await sweepReply(trx, o);
      await markAnswered(trx, o, pair.emailId);
      // `now()` runs once per close, after the sweep read its list and before the close transaction: the tap lands there.
      const sweep = createReplySweep({
        db: trx,
        hooks: delegationHooks({ db: trx }),
        approvalHooks: { onDecided: async () => undefined },
        uidplus: async () => true,
        now: () => {
          void trx.updateTable("actions").set({ status: "rejected" }).where("id", "=", pair.sendId).execute();
          return NOW;
        },
      });

      const result = await sweep.run({ mailboxIds: [o.mailboxId] });

      expect(result).toMatchObject({ mailboxErrors: 0, checked: 1, skipped: 1 });
      expect(result.closed.answered).toBe(0);
      expect((await send(trx, pair.sendId)).status).toBe("rejected");
      expect(logs.lines.some((line) => line.includes("reply_closed"))).toBe(false);
    });
  });
});

describe("newerMailInThread (D7)", () => {
  test("a mail of another mailbox, another thread or another organization does not count; the order is received_at, then id", async () => {
    await withRollback(db, async (trx) => {
      const a = await sweepOrg(trx);
      const b = await sweepOrg(trx);
      const thread = `<thread-${randomUUID()}@x.test>`;
      const first = await sweepReply(trx, a, { threadKey: thread });
      expect(await newerMailInThread(trx, a.ctx, first.emailId)).toBe(false);

      // The same thread key in another mailbox of the same organization: no.
      const sibling = randomUUID();
      await insertMailbox(trx, a.ctx, {
        id: sibling,
        address: `sibling-${sibling}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: { drafts: "Drafts" },
      });
      await insertInboxFolder(trx, a.ctx, sibling);
      await insertTestEmail(trx, a.ctx, sibling, {
        thread_key: thread,
        status: "triaged",
        received_at: new Date(T0.getTime() + HOUR_MS),
        uid: 77,
      });
      expect(await newerMailInThread(trx, a.ctx, first.emailId)).toBe(false);

      // The same thread key in another organization, and another thread of the same mailbox: no.
      await sweepReply(trx, b, { threadKey: thread, createdAt: new Date(T0.getTime() + HOUR_MS) });
      await sweepReply(trx, a, { createdAt: new Date(T0.getTime() + HOUR_MS) });
      expect(await newerMailInThread(trx, a.ctx, first.emailId)).toBe(false);

      // An older mail of the thread: not newer.
      await addThreadMail(trx, a.ctx, first.emailId, { receivedAt: new Date(T0.getTime() - HOUR_MS) });
      expect(await newerMailInThread(trx, a.ctx, first.emailId)).toBe(false);

      // An automatic mail, with parameters or in capitals: not newer. `no` is not automatic.
      await addThreadMail(trx, a.ctx, first.emailId, {
        receivedAt: new Date(T0.getTime() + HOUR_MS),
        autoSubmitted: "Auto-Generated; x=1",
      });
      expect(await newerMailInThread(trx, a.ctx, first.emailId)).toBe(false);
      await addThreadMail(trx, a.ctx, first.emailId, {
        receivedAt: new Date(T0.getTime() + HOUR_MS),
        autoSubmitted: "no",
      });
      expect(await newerMailInThread(trx, a.ctx, first.emailId)).toBe(true);
      // Another organization reading this mail finds nothing, although a newer mail exists.
      expect(await newerMailInThread(trx, b.ctx, first.emailId)).toBe(false);
    });
  });

  test("the same received_at: the mail with the higher id is newer", async () => {
    await withRollback(db, async (trx) => {
      const a = await sweepOrg(trx);
      const first = await sweepReply(trx, a, { threadKey: `<thread-${randomUUID()}@x.test>` });
      const sibling = await addThreadMail(trx, a.ctx, first.emailId, { receivedAt: T0 });
      const [low, high] = first.emailId < sibling ? [first.emailId, sibling] : [sibling, first.emailId];
      expect(await newerMailInThread(trx, a.ctx, low)).toBe(true);
      expect(await newerMailInThread(trx, a.ctx, high)).toBe(false);
    });
  });
});

describe("tenant isolation of the readers of the sweep and the pass", () => {
  test("listSweepReplySends lists only the sends of the organization and the mailbox of the call", async () => {
    await withRollback(db, async (trx) => {
      const a = await sweepOrg(trx);
      const b = await sweepOrg(trx);
      const aSend = await sweepReply(trx, a);
      const bSend = await sweepReply(trx, b);
      expect((await listSweepReplySends(trx, a.ctx, a.mailboxId, { limit: 10 })).map((row) => row.sendId)).toEqual([
        aSend.sendId,
      ]);
      // The mailbox of B under the context of A: nothing.
      expect(await listSweepReplySends(trx, a.ctx, b.mailboxId, { limit: 10 })).toEqual([]);
      expect((await listSweepReplySends(trx, b.ctx, b.mailboxId, { limit: 10 })).map((row) => row.sendId)).toEqual([
        bSend.sendId,
      ]);
    });
  });

  test("refreshFlagsOfEmail finds no mail of another organization and calls the server for none", async () => {
    await withRollback(db, async (trx) => {
      const a = await sweepOrg(trx);
      const b = await sweepOrg(trx);
      const mail = await sweepReply(trx, b);
      const provider = createFakeMailProvider();
      const result = await refreshFlagsOfEmail({ db: trx, provider, now: () => NOW }, a.ctx, mail.emailId);
      expect(result).toEqual({ kind: "not_found" });
      expect(
        await trx.selectFrom("email_flags").select("email_id").where("email_id", "=", mail.emailId).execute()
      ).toEqual([]);
    });
  });
});

describe("the sweep: the cap counts closes, mailboxes are visited by the age of their oldest open send (review B1)", () => {
  test("B1a. open sends cost no close budget: a 4th answered send behind 3 older open ones still closes (cap 3)", async () => {
    await withRollback(db, async (trx) => {
      const o = await sweepOrg(trx);
      for (let index = 0; index < 3; index += 1) {
        await sweepReply(trx, o, { createdAt: new Date(T0.getTime() + index * 1000) });
      }
      const answered = await sweepReply(trx, o, { createdAt: new Date(T0.getTime() + 10_000) });
      await markAnswered(trx, o, answered.emailId);

      const result = await sweepOf(trx, [], { closeLimit: 3 }).run({ mailboxIds: [o.mailboxId] });

      expect(result).toMatchObject({ checked: 4, closed: { answered: 1 } });
      expect((await send(trx, answered.sendId)).status).toBe("expired");
    });
  });

  test("B1b. a mailbox with many open sends does not starve a later mailbox (other organization too)", async () => {
    await withRollback(db, async (trx) => {
      const a = await sweepOrg(trx);
      const b = await sweepOrg(trx);
      // A holds the older sends, none of them closes. B holds one newer send, and it is answered.
      for (let index = 0; index < 5; index += 1) {
        await sweepReply(trx, a, { createdAt: new Date(T0.getTime() + index * 1000) });
      }
      const answered = await sweepReply(trx, b, { createdAt: new Date(T0.getTime() + HOUR_MS) });
      await markAnswered(trx, b, answered.emailId);

      const result = await sweepOf(trx, [], { closeLimit: 3 }).run({ mailboxIds: [a.mailboxId, b.mailboxId] });

      expect(result).toMatchObject({ checked: 6, closed: { answered: 1 } });
      expect((await send(trx, answered.sendId)).status).toBe("expired");
    });
  });

  test("B1c. the mailbox with the oldest open send comes first: with a cap of 1 it gets the close", async () => {
    await withRollback(db, async (trx) => {
      const older = await sweepOrg(trx);
      const newer = await sweepOrg(trx);
      const first = await sweepReply(trx, newer, { createdAt: new Date(T0.getTime() + HOUR_MS) });
      const second = await sweepReply(trx, older, { createdAt: T0 });
      await markAnswered(trx, newer, first.emailId);
      await markAnswered(trx, older, second.emailId);

      const result = await sweepOf(trx, [], { closeLimit: 1 }).run({ mailboxIds: [newer.mailboxId, older.mailboxId] });

      expect(result.closed.answered).toBe(1);
      expect((await send(trx, second.sendId)).status).toBe("expired");
      expect((await send(trx, first.sendId)).status).toBe("awaiting_approval");
    });
  });

  test("B1d. a mailbox with nothing open is not visited and costs nothing", async () => {
    await withRollback(db, async (trx) => {
      const idle = await sweepOrg(trx);
      const busy = await sweepOrg(trx);
      // The idle mailbox holds a delegation send and a reply send that is no longer open: neither makes it a target.
      await insertDraftAndSend(trx, idle.ctx, idle.mailboxId, { createdAt: T0 });
      const rejected = await sweepReply(trx, idle);
      await trx.updateTable("actions").set({ status: "rejected" }).where("id", "=", rejected.sendId).execute();
      const pair = await sweepReply(trx, busy);
      await markAnswered(trx, busy, pair.emailId);

      const result = await sweepOf(trx).run({ mailboxIds: [idle.mailboxId, busy.mailboxId] });

      expect(result).toMatchObject({ mailboxes: 1, checked: 1, closed: { answered: 1 } });
    });
  });

  test("B1e. the number of listed sends per run is bounded too, over all mailboxes", async () => {
    await withRollback(db, async (trx) => {
      const a = await sweepOrg(trx);
      const b = await sweepOrg(trx);
      for (const [o, base] of [
        [a, 0],
        [b, 100],
      ] as const) {
        for (let index = 0; index < 2; index += 1) {
          await sweepReply(trx, o, { createdAt: new Date(T0.getTime() + (base + index) * 1000) });
        }
      }
      const result = await sweepOf(trx, [], { listLimit: 3 }).run({ mailboxIds: [a.mailboxId, b.mailboxId] });
      expect(result.checked).toBe(3);
    });
  });

  test("B1g. the cap of closes holds inside one mailbox (cap 2, three answered sends: two close, the oldest first)", async () => {
    await withRollback(db, async (trx) => {
      const o = await sweepOrg(trx);
      const pairs = [];
      for (let index = 0; index < 3; index += 1) {
        const pair = await sweepReply(trx, o, { createdAt: new Date(T0.getTime() + index * 1000) });
        await markAnswered(trx, o, pair.emailId);
        pairs.push(pair);
      }
      const result = await sweepOf(trx, [], { closeLimit: 2 }).run({ mailboxIds: [o.mailboxId] });
      expect(result.closed.answered).toBe(2);
      expect((await send(trx, pairs[2]?.sendId ?? "")).status).toBe("awaiting_approval");
    });
  });

  test("B1f. the defaults are 200 closes and 1000 listed sends per run", () => {
    expect(SWEEP_LIMIT).toBe(200);
    expect(SWEEP_LIST_LIMIT).toBe(1000);
  });
});

describe("the sweep: races with a tap and with a claim (review N1, T2)", () => {
  test("N1. a tap between the list and the close: the close locks the row as approved, so the user gets a result notice", async () => {
    await withRollback(db, async (trx) => {
      const o = await sweepOrg(trx);
      const pair = await sweepReply(trx, o);
      await markAnswered(trx, o, pair.emailId);
      // `now()` runs once per close, after the list and before the close transaction: the tap lands there.
      const now = () => {
        void trx
          .updateTable("actions")
          .set({ status: "approved", approved_at: NOW, approved_by: o.userId, approved_via: "web" })
          .where("id", "=", pair.sendId)
          .execute();
        return NOW;
      };

      const result = await sweepOf(trx, [], { now }).run({ mailboxIds: [o.mailboxId] });

      expect(result.closed.answered).toBe(1);
      expect(await send(trx, pair.sendId)).toMatchObject({
        status: "expired",
        status_reason: "answered",
        result_notified_at: null,
      });
      const toTell = await listSendResultsToNotify(trx, o.ctx, { limit: 10, now: NOW, pendingCopyMaxAgeMs: 600_000 });
      expect(toTell.map((row) => row.id)).toEqual([pair.sendId]);
    });
  });

  test("T2. a committer claim between the list and the close: the close answers busy, nothing is closed, no notice", async () => {
    await withRollback(db, async (trx) => {
      logs = captureLogs();
      const o = await sweepOrg(trx);
      const pair = await sweepReply(trx, o, { status: "approved" });
      await markAnswered(trx, o, pair.emailId);
      const now = () => {
        void trx.updateTable("actions").set({ locked_at: NOW }).where("id", "=", pair.sendId).execute();
        return NOW;
      };

      const result = await sweepOf(trx, [], { now }).run({ mailboxIds: [o.mailboxId] });

      expect(result).toMatchObject({ checked: 1, skipped: 1, mailboxErrors: 0, closed: { answered: 0 } });
      expect(await send(trx, pair.sendId)).toMatchObject({ status: "approved", status_reason: null });
      expect(logs.lines.some((line) => line.includes("reply_closed"))).toBe(false);
    });
  });
});

describe("the sweep and the pass: moves, junk, spam (review N6, N7)", () => {
  test("N6. a move that the assistant made (moved_at set) does not close the reply; a move of the user does", async () => {
    await withRollback(db, async (trx) => {
      const o = await sweepOrg(trx);
      const byAssistant = await sweepReply(trx, o);
      const byUser = await sweepReply(trx, o);
      await trx
        .updateTable("emails")
        .set({ folder: "Archive", moved_at: T0 })
        .where("id", "=", byAssistant.emailId)
        .execute();
      await trx.updateTable("emails").set({ folder: "Archive" }).where("id", "=", byUser.emailId).execute();

      const result = await run(trx, o);

      expect(result.closed.original_moved).toBe(1);
      expect((await send(trx, byAssistant.sendId)).status).toBe("awaiting_approval");
      expect(await send(trx, byUser.sendId)).toMatchObject({ status: "expired", status_reason: "original_moved" });
    });
  });

  test("N7. a newer mail in the junk folder, in the trash folder, or in the spam category does not close the reply", async () => {
    await withRollback(db, async (trx) => {
      const o = await sweepOrg(trx);
      await trx
        .insertInto("mailbox_folders")
        .values({ org_id: o.ctx.orgId, mailbox_id: o.mailboxId, key: "junk", path: "Junk", role: "junk" })
        .execute();
      await trx
        .updateTable("mailboxes")
        .set({ folder_map: JSON.stringify({ drafts: "Drafts", trash: "Trash" }) })
        .where("id", "=", o.mailboxId)
        .execute();
      const junk = await sweepReply(trx, o);
      const junkSource = await sweepReply(trx, o);
      const trash = await sweepReply(trx, o);
      const spam = await sweepReply(trx, o);
      const real = await sweepReply(trx, o);
      const later = new Date(T0.getTime() + HOUR_MS);
      const inJunk = await addThreadMail(trx, o.ctx, junk.emailId, { receivedAt: later });
      await trx.updateTable("emails").set({ folder: "Junk" }).where("id", "=", inJunk).execute();
      const fromJunk = await addThreadMail(trx, o.ctx, junkSource.emailId, { receivedAt: later });
      await trx.updateTable("emails").set({ source_folder: "Junk" }).where("id", "=", fromJunk).execute();
      const inTrash = await addThreadMail(trx, o.ctx, trash.emailId, { receivedAt: later });
      await trx.updateTable("emails").set({ folder: "Trash" }).where("id", "=", inTrash).execute();
      const spamMail = await addThreadMail(trx, o.ctx, spam.emailId, { receivedAt: later });
      const triage = (emailId: string, category: string, at: Date) =>
        trx
          .insertInto("triage_results")
          .values({
            org_id: o.ctx.orgId,
            email_id: emailId,
            category,
            confidence: 0.9,
            reason_code: "direct_request",
            fields: "{}",
            suspicious_reasons: [],
            created_at: at,
          })
          .execute();
      await triage(spamMail, "spam", later);
      await addThreadMail(trx, o.ctx, real.emailId, { receivedAt: later });

      const result = await run(trx, o);

      expect(result.closed.newer_mail).toBe(1);
      for (const kept of [junk, junkSource, trash, spam])
        expect((await send(trx, kept.sendId)).status).toBe("awaiting_approval");
      expect(await send(trx, real.sendId)).toMatchObject({ status: "expired", status_reason: "newer_mail" });

      // The newest result decides: a mail that was spam and is now `needs_reply` counts.
      await triage(spamMail, "needs_reply", new Date(later.getTime() + HOUR_MS));
      await run(trx, o);
      expect(await send(trx, spam.sendId)).toMatchObject({ status: "expired", status_reason: "newer_mail" });
    });
  });
});

describe("the sweep: a paused mailbox, and a Sent row whose header is not read yet (stage 09 re-review G1, N-a)", () => {
  test("G1. a mailbox that is not active (paused) is not swept: its answered send stays open; after a resume it closes", async () => {
    await withRollback(db, async (trx) => {
      const o = await sweepOrg(trx);
      const pair = await sweepReply(trx, o);
      await markAnswered(trx, o, pair.emailId);
      await setMailboxStatus(trx, o.ctx, o.mailboxId, "paused", T0);

      const paused = await run(trx, o);

      expect(paused).toMatchObject({ mailboxes: 0, checked: 0 });
      expect((await send(trx, pair.sendId)).status).toBe("awaiting_approval");

      await setMailboxStatus(trx, o.ctx, o.mailboxId, "active", T0);
      const resumed = await run(trx, o);

      expect(resumed.closed.answered).toBe(1);
      expect(await send(trx, pair.sendId)).toMatchObject({ status: "expired", status_reason: "answered" });
    });
  });

  test("N-a. a user Sent row with content pending and no Auto-Submitted does not close the reply; once read (stored, or headers known) it does", async () => {
    await withRollback(db, async (trx) => {
      const o = await sweepOrg(trx);
      const unread = await sweepReply(trx, o, { messageId: "<unread-one@x.test>" });
      const sentRow = async (parent: string, content: "pending" | "stored", autoSubmitted: string | null) =>
        trx
          .insertInto("sent_emails")
          .values({
            org_id: o.ctx.orgId,
            mailbox_id: o.mailboxId,
            dedup_key: `mid:<${randomUUID()}@x.test>:h1`,
            path: "Sent",
            uidvalidity: "7",
            uid: String(Math.floor(Math.random() * 1_000_000)),
            message_id: `<${randomUUID()}@x.test>`,
            parent_message_id: parent,
            thread_key: parent,
            to_addresses: ["boss@x.test"],
            origin: "user",
            content,
            auto_submitted: autoSubmitted,
            sent_at: new Date(T0.getTime() + HOUR_MS),
            internal_date: new Date(T0.getTime() + HOUR_MS),
          })
          .returning("id")
          .executeTakeFirstOrThrow();
      const row = await sentRow("<unread-one@x.test>", "pending", null);

      const first = await run(trx, o);

      expect(first.closed.answered).toBe(0);
      expect((await send(trx, unread.sendId)).status).toBe("awaiting_approval");

      // The text step read the mail: no automatic header, so it is an answer.
      await trx.updateTable("sent_emails").set({ content: "stored" }).where("id", "=", row.id).execute();
      const second = await run(trx, o);

      expect(second.closed.answered).toBe(1);
      expect(await send(trx, unread.sendId)).toMatchObject({ status: "expired", status_reason: "answered" });
    });
  });

  test("N-a. a pending row with a stored `no` counts as an answer", async () => {
    await withRollback(db, async (trx) => {
      const o = await sweepOrg(trx);
      const withNo = await sweepReply(trx, o, { messageId: "<with-no@x.test>" });
      const insert = (parent: string, autoSubmitted: string) =>
        trx
          .insertInto("sent_emails")
          .values({
            org_id: o.ctx.orgId,
            mailbox_id: o.mailboxId,
            dedup_key: `mid:<${randomUUID()}@x.test>:h1`,
            path: "Sent",
            uidvalidity: "7",
            uid: String(Math.floor(Math.random() * 1_000_000)),
            message_id: `<${randomUUID()}@x.test>`,
            parent_message_id: parent,
            thread_key: parent,
            to_addresses: ["boss@x.test"],
            origin: "user",
            content: "pending",
            auto_submitted: autoSubmitted,
            sent_at: new Date(T0.getTime() + HOUR_MS),
            internal_date: new Date(T0.getTime() + HOUR_MS),
          })
          .execute();
      await insert("<with-no@x.test>", "no");

      await run(trx, o);

      expect(await send(trx, withNo.sendId)).toMatchObject({ status: "expired", status_reason: "answered" });
    });
  });
});
