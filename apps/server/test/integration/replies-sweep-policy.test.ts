import { randomUUID } from "node:crypto";

import { HOUR_MS, MINUTE_MS } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { listSweepReplySends } from "../../src/modules/actions";
import { updateMailboxSettings } from "../../src/modules/config";
import { delegationHooks } from "../../src/modules/delegation";
import { refreshFlagsOfEmail } from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { createReplySweep, SWEEP_LIMIT, SWEEP_LIST_LIMIT } from "../../src/modules/replies";
import { setOrgFeature } from "../../src/modules/tenancy";
import { captureLogs, type CapturedLogs } from "../log-capture";

import { insertDraftAndSend } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { NOW, send, sweepOf, run } from "./replies-sweep-helpers";
import { addThreadMail, markAnswered, SWITCHES, sweepOrg, sweepReply, T0 } from "./reply-answered-fixtures";

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
