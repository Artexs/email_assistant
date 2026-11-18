import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { sentSwitchHooks } from "../../src/composition";
import { setSentSync } from "../../src/modules/mail";
import type { DB } from "../../src/platform/db";

import { insertFollowUp } from "./follow-up-fixtures";
import { testDb, withRollback } from "./helpers";
import { commandOrg, FRIDAY, type CommandOrg } from "./loops-commands-fixtures";
import { tablesHolding } from "./loops-scan-fixtures";
import { siblingMailbox } from "./mail-sent-fixtures";

// F116 stage 14 review (an owner decision): "Track my sent mail" off removes every copy of the Sent mail that a loop
// made, not only the loop row. The places that copy the body, the subject or an address of a Sent mail:
//   1. `sent_emails`           the mail itself (`deleteSentEmails`)
//   2. `sent_analyses`         no text; goes with the Sent row (cascade)
//   3. `open_loops`            subject, ask, To, Cc, counterpart (`onSentOff`: the loops that it closes; a loop that was
//                              closed before keeps them until retention, the stage 08 rule)
//   4. `actions.payload`       `quote`, `to`, `cc`, `subject` of every follow-up `create_draft` and `send` (`clearLoopSentCopies`)
//   5. `outbox.view` / `text`  the cards of the follow-ups: approval, edit, result (`clearLoopCards`)
//   6. `audit_log`, logs       ids and codes only
// The last test scans every table for planted values, so a seventh place would fail it.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

interface Marks {
  body: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  quote: string;
}

const marks = (): Marks => {
  const id = randomUUID().slice(0, 8);
  return {
    body: `BODY-${id}`,
    from: `from-${id}@sent.example.test`,
    to: `to-${id}@sent.example.test`,
    cc: `cc-${id}@sent.example.test`,
    subject: `SUBJECT-${id}`,
    quote: `QUOTE-${id}`,
  };
};
const values = (m: Marks): string[] => Object.values(m);

// One follow-up of `mailboxId` with its Sent mail, pair and cards, every Sent value planted from `m`.
async function seedFollowUp(
  trx: Transaction<DB>,
  org: CommandOrg,
  mailboxId: string,
  m: Marks,
  opts: { loopStatus?: "open" | "closed"; sendStatus?: string } = {}
) {
  const closed = opts.loopStatus === "closed";
  const made = await insertFollowUp(trx, org.ctx, mailboxId, org.userId, {
    to: [m.to],
    cc: [m.cc],
    subject: m.subject,
    quote: m.quote,
    sendStatus: opts.sendStatus ?? "awaiting_approval",
    mailboxId,
    loop: closed ? { status: "closed", close_reason: "done", closed_at: FRIDAY } : {},
  });
  const loop = await trx
    .selectFrom("open_loops")
    .select("sent_email_id")
    .where("id", "=", made.loopId)
    .executeTakeFirstOrThrow();
  await trx
    .updateTable("sent_emails")
    .set({ body_text: m.body, from_address: m.from, subject: m.subject })
    .where("id", "=", loop.sent_email_id ?? randomUUID())
    .execute();
  await trx
    .insertInto("sent_analyses")
    .values({
      org_id: org.ctx.orgId,
      mailbox_id: mailboxId,
      sent_email_id: loop.sent_email_id ?? "",
      status: "done",
      expects_reply: true,
      has_promise: false,
      prompt_version: "extractor-v1",
    })
    .execute();
  const card = async (kind: string, status: string, dedup: string, extra: Record<string, unknown> = {}) =>
    trx
      .insertInto("outbox")
      .values({
        org_id: org.ctx.orgId,
        user_id: org.userId,
        kind,
        dedup_key: `${dedup}:${made.sendId}`,
        loop_id: made.loopId,
        text: `Follow-up to ${m.to}, Cc ${m.cc}: ${m.subject} / ${m.quote}`,
        view: JSON.stringify({
          view: { kind: "follow_up", to: [m.to], cc: [m.cc], subject: m.subject, quote: m.quote },
        }),
        buttons: "[]",
        status,
        created_at: FRIDAY,
        next_attempt_at: FRIDAY,
        ...(status === "sent" ? { sent_at: FRIDAY } : {}),
        ...extra,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
  const approval = await card("approval", "sent", "approval");
  const cards = {
    approval: approval.id,
    edit: (await card("approval_edit", "sent", "approval_edit", { edit_of_outbox_id: approval.id })).id,
    result: (await card("send_result", "sent", "send_result")).id,
    pending: (await card("send_result", "pending", "send_result_pending")).id,
    sending: (await card("send_result", "sending", "send_result_sending", { locked_at: FRIDAY })).id,
    failed: (await card("send_result", "failed", "send_result_failed", { error_code: "blocked" })).id,
  };
  return { ...made, sentId: loop.sent_email_id ?? "", cards };
}

const switchOff = (trx: Transaction<DB>, org: CommandOrg, mailboxId: string) =>
  setSentSync(trx, org.ctx, mailboxId, { enabled: false, actor: "test", at: FRIDAY }, sentSwitchHooks);

const payloadOf = async (trx: Transaction<DB>, id: string) =>
  (await trx.selectFrom("actions").select("payload").where("id", "=", id).executeTakeFirstOrThrow()).payload as Record<
    string,
    unknown
  >;

describe("the Sent switch off reaches every copy of the Sent mail", () => {
  test("the payload of the follow-up draft and send loses quote, To, Cc and subject; kind and loop_id stay", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const m = marks();
      const f = await seedFollowUp(trx, org, org.mailboxId, m);
      expect(JSON.stringify(await payloadOf(trx, f.draftId))).toContain(m.quote);
      await switchOff(trx, org, org.mailboxId);
      const draft = await payloadOf(trx, f.draftId);
      const send = await payloadOf(trx, f.sendId);
      for (const payload of [draft, send]) {
        for (const key of ["quote", "to", "cc", "subject"]) expect(payload).not.toHaveProperty(key);
        expect(payload).toMatchObject({ kind: "follow_up", loop_id: f.loopId });
      }
      expect(draft).toMatchObject({ language: "en", n: 1 });
    });
  });

  test("an `applying` send and an applied one lose the copies too; the status stays", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const m = marks();
      const applying = await seedFollowUp(trx, org, org.mailboxId, m, { sendStatus: "applying" });
      const applied = await seedFollowUp(trx, org, org.mailboxId, marks(), { sendStatus: "applied" });
      await switchOff(trx, org, org.mailboxId);
      for (const f of [applying, applied]) {
        expect(await payloadOf(trx, f.sendId)).not.toHaveProperty("to");
        expect(await payloadOf(trx, f.draftId)).not.toHaveProperty("quote");
      }
      const status = await trx
        .selectFrom("actions")
        .select("status")
        .where("id", "=", applying.sendId)
        .executeTakeFirst();
      expect(status?.status).toBe("applying");
    });
  });

  test("the cards: delivered and failed ones are blank; a pending or sending one ends failed / outdated and blank", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const m = marks();
      const f = await seedFollowUp(trx, org, org.mailboxId, m);
      await switchOff(trx, org, org.mailboxId);
      const rows = await trx
        .selectFrom("outbox")
        .select(["id", "status", "error_code", "text", "view", "locked_at"])
        .where("loop_id", "=", f.loopId)
        .execute();
      expect(rows).toHaveLength(6);
      for (const row of rows) {
        expect([row.text, JSON.stringify(row.view)]).toEqual(["[removed]", "{}"]);
      }
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get(f.cards.pending)).toMatchObject({ status: "failed", error_code: "outdated", locked_at: null });
      expect(byId.get(f.cards.sending)).toMatchObject({ status: "failed", error_code: "outdated", locked_at: null });
      expect(byId.get(f.cards.approval)?.status).toBe("sent");
      expect(byId.get(f.cards.result)?.status).toBe("sent");
      expect(byId.get(f.cards.failed)).toMatchObject({ status: "failed", error_code: "blocked" });
    });
  });

  test("a loop that was closed before keeps its own texts until retention; its payload and cards are cleared", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const m = marks();
      const f = await seedFollowUp(trx, org, org.mailboxId, m, { loopStatus: "closed" });
      await switchOff(trx, org, org.mailboxId);
      const loop = await trx
        .selectFrom("open_loops")
        .select(["subject", "to_addresses"])
        .where("id", "=", f.loopId)
        .executeTakeFirstOrThrow();
      expect([loop.subject, loop.to_addresses]).toEqual([m.subject, [m.to]]);
      expect(await payloadOf(trx, f.draftId)).not.toHaveProperty("quote");
      const cards = await trx.selectFrom("outbox").select("text").where("loop_id", "=", f.loopId).execute();
      expect(cards.every((card) => card.text === "[removed]")).toBe(true);
    });
  });

  test("another mailbox of the organization and another organization keep their copies", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const sibling = await siblingMailbox(trx, org);
      const other = await commandOrg(trx);
      const mine = marks();
      const theirs = marks();
      const strangers = marks();
      await seedFollowUp(trx, org, org.mailboxId, mine);
      const kept = await seedFollowUp(trx, org, sibling.mailboxId, theirs);
      const foreign = await seedFollowUp(trx, other, other.mailboxId, strangers);
      await switchOff(trx, org, org.mailboxId);
      for (const f of [kept, foreign]) {
        expect(await payloadOf(trx, f.draftId)).toHaveProperty("quote");
        expect(await payloadOf(trx, f.sendId)).toHaveProperty("to");
        const cards = await trx
          .selectFrom("outbox")
          .select(["text", "status"])
          .where("loop_id", "=", f.loopId)
          .execute();
        expect(cards.some((card) => card.text !== "[removed]")).toBe(true);
        expect(cards.map((card) => card.status)).toContain("pending");
      }
    });
  });

  test("a scan of every table: no Sent value of the mailbox is left, except the texts of a loop that was closed before", async () => {
    await withRollback(db, async (trx) => {
      const org = await commandOrg(trx);
      const open = marks();
      const closed = marks();
      await seedFollowUp(trx, org, org.mailboxId, open);
      await seedFollowUp(trx, org, org.mailboxId, closed, { loopStatus: "closed" });
      // Before: the planted values are in the places of the list above.
      expect(await tablesHolding(trx, values(open))).toEqual(["actions", "open_loops", "outbox", "sent_emails"]);
      await switchOff(trx, org, org.mailboxId);
      expect(await tablesHolding(trx, values(open))).toEqual([]);
      // The closed loop: the Sent row, the payloads and the cards are gone; its own row waits for retention.
      expect(await tablesHolding(trx, values(closed))).toEqual(["open_loops"]);
    });
  });
});
