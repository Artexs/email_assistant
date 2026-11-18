import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { listSendResultsToNotify, listSweepReplySends, type ApprovalHooks } from "../../src/modules/actions";
import { updateMailboxSettings } from "../../src/modules/config";
import { delegationHooks } from "../../src/modules/delegation";
import { newerMailInThread, refreshFlagsOfEmail } from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { createReplySweep, SWEEP_LIMIT } from "../../src/modules/replies";
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

const HOUR = 3_600_000;

// F115 stage 09, step 2: the sweep closes open reply sends whose reason to exist ended. It reads the database only.
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

function sweepOf(trx: Transaction<DB>, decided: { sendId: string; decision: string }[] = []) {
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
    now: () => NOW,
  });
}

const run = (trx: Transaction<DB>, o: SweepOrg, decided?: { sendId: string; decision: string }[]) =>
  sweepOf(trx, decided).run({ mailboxId: o.mailboxId });

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
            sent_at: new Date(T0.getTime() + HOUR),
            internal_date: new Date(T0.getTime() + HOUR),
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
      await addThreadMail(trx, o.ctx, closed.emailId, { receivedAt: new Date(T0.getTime() + HOUR) });
      await addThreadMail(trx, o.ctx, open.emailId, {
        receivedAt: new Date(T0.getTime() + HOUR),
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
        createdAt: new Date(T0.getTime() + HOUR),
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
      await result(flagged.emailId, new Date(T0.getTime() + HOUR), ["auth_fail"]);
      // A flag that a later result removes is gone: the newest result decides.
      await result(cleared.emailId, new Date(T0.getTime() + HOUR), ["auth_fail"]);
      await result(cleared.emailId, new Date(T0.getTime() + 2 * HOUR), []);

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

      await run(trx, o);

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

      await run(trx, o);

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
      await addThreadMail(trx, a.ctx, aMail.emailId, { receivedAt: new Date(T0.getTime() + HOUR) });
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
          sent_at: new Date(T0.getTime() + HOUR),
          internal_date: new Date(T0.getTime() + HOUR),
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

  test("8. at most 200 sends per run, oldest first; the rest wait for the next run", async () => {
    await withRollback(db, async (trx) => {
      const o = await sweepOrg(trx);
      const created: string[] = [];
      for (let index = 0; index < SWEEP_LIMIT + 3; index += 1) {
        const pair = await sweepReply(trx, o, { createdAt: new Date(T0.getTime() + index * 1000) });
        await markAnswered(trx, o, pair.emailId);
        created.push(pair.sendId);
      }

      const first = await run(trx, o);

      expect(first).toMatchObject({ checked: SWEEP_LIMIT, closed: { answered: SWEEP_LIMIT } });
      const states = await trx.selectFrom("actions").select(["id", "status"]).where("id", "in", created).execute();
      const open = states.filter((row) => row.status === "awaiting_approval").map((row) => row.id);
      expect(open.sort()).toEqual(created.slice(SWEEP_LIMIT).sort());
      const second = await run(trx, o);
      expect(second.closed.answered).toBe(3);
    });
  }, 60_000);

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

      const result = await sweep.run({ mailboxId: o.mailboxId });

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
        received_at: new Date(T0.getTime() + HOUR),
        uid: 77,
      });
      expect(await newerMailInThread(trx, a.ctx, first.emailId)).toBe(false);

      // The same thread key in another organization, and another thread of the same mailbox: no.
      await sweepReply(trx, b, { threadKey: thread, createdAt: new Date(T0.getTime() + HOUR) });
      await sweepReply(trx, a, { createdAt: new Date(T0.getTime() + HOUR) });
      expect(await newerMailInThread(trx, a.ctx, first.emailId)).toBe(false);

      // An older mail of the thread: not newer.
      await addThreadMail(trx, a.ctx, first.emailId, { receivedAt: new Date(T0.getTime() - HOUR) });
      expect(await newerMailInThread(trx, a.ctx, first.emailId)).toBe(false);

      // An automatic mail, with parameters or in capitals: not newer. `no` is not automatic.
      await addThreadMail(trx, a.ctx, first.emailId, {
        receivedAt: new Date(T0.getTime() + HOUR),
        autoSubmitted: "Auto-Generated; x=1",
      });
      expect(await newerMailInThread(trx, a.ctx, first.emailId)).toBe(false);
      await addThreadMail(trx, a.ctx, first.emailId, {
        receivedAt: new Date(T0.getTime() + HOUR),
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
