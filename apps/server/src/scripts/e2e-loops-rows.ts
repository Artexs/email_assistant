import { randomUUID } from "node:crypto";

import { sendPayloadFor, type DraftPayload } from "@ea/core";
import type { Transaction } from "kysely";

import { endOfLocalDay } from "../modules/loops";
import type { Db, DB, TenantContext } from "../platform/db";

import { insertAction, inTransaction } from "./e2e-activity-rows";
import { seedDelegation } from "./e2e-delegations-rows";
import {
  E2E_DELEGATIONS,
  E2E_LOOPS,
  E2E_LOOPS_DELEGATE,
  E2E_LOOPS_DELEGATIONS,
  E2E_TIMEZONE,
  type E2eLoopPlan,
  type LoopsSeedIds,
} from "./e2e-seed-args";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// The due date of a plan: days from the seed time, or one hour before the end of the local day (inside "Due today" at any hour).
function dueOf(plan: E2eLoopPlan, now: Date): Date {
  if (plan.dueInDays === "today") return new Date(endOfLocalDay(now, E2E_TIMEZONE).getTime() - HOUR);
  return new Date(now.getTime() + plan.dueInDays * DAY);
}

// One loop row with the texts stored (the Sent mail that opened it is not seeded: the follow-up quote is empty). The loops of a spec
// are the only rows of their organization: nothing here reads the mail tables.
async function seedLoop(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  plan: E2eLoopPlan,
  delegateId: string,
  index: number,
  now: Date
): Promise<string> {
  const closed = plan.closed !== undefined;
  const waitFrom = new Date(now.getTime() - (index + 3) * DAY);
  const row = await trx
    .insertInto("open_loops")
    .values({
      org_id: ctx.orgId,
      mailbox_id: mailboxId,
      kind: plan.kind,
      status: closed ? "closed" : "open",
      close_reason: plan.closed ?? null,
      closed_at: closed ? new Date(now.getTime() - DAY) : null,
      thread_key: `<e2e-loop-${randomUUID()}@e2e.test>`,
      message_id: `<e2e-loop-${randomUUID()}@e2e.test>`,
      subject: plan.subject,
      to_addresses: [plan.counterpart],
      cc_addresses: [],
      counterpart: plan.counterpart,
      delegate_id: plan.kind === "delegated" ? delegateId : null,
      text: plan.text,
      language: "en",
      due_at: dueOf(plan, now),
      due_source: plan.kind === "promised" ? "stated" : "default",
      wait_from_at: waitFrom,
      later_count: plan.laterCount ?? 0,
      follow_ups_sent: plan.followUpsSent ?? 0,
      last_follow_up_at: plan.followUpsSent === undefined ? null : new Date(now.getTime() - DAY),
      auto_reply_at: plan.autoReply === true ? new Date(now.getTime() - HOUR) : null,
      // The newest first: the list orders by the due date, so the ties keep the seed order.
      created_at: new Date(now.getTime() - index * MINUTE),
      updated_at: new Date(now.getTime() - index * MINUTE),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

// The follow-up of a loop as the chaser or a tap plans it: an applied `create_draft` and a `send` that waits for an approval, both
// anchored on the loop (`email_id` null). The approval notice job leaves a notified action alone; no chat is linked, so no card is queued.
async function seedFollowUpPair(
  trx: Transaction<DB>,
  ctx: TenantContext,
  loopId: string,
  plan: E2eLoopPlan,
  now: Date
): Promise<string> {
  const draft: DraftPayload = {
    kind: "follow_up",
    loop_id: loopId,
    to: [plan.counterpart],
    cc: [],
    language: "en",
    sent_at: new Date(now.getTime() - 4 * DAY).toISOString(),
    subject: plan.subject,
    quote: null,
    n: 1,
  };
  const draftId = await insertAction(trx, ctx, {
    emailId: null,
    loopId,
    type: "create_draft",
    status: "applied",
    payload: { ...draft },
    createdAt: new Date(now.getTime() - 2 * MINUTE),
  });
  return insertAction(trx, ctx, {
    emailId: null,
    loopId,
    type: "send",
    status: "awaiting_approval",
    payload: { ...sendPayloadFor(draft) },
    createdAt: new Date(now.getTime() - MINUTE),
    dependsOnActionId: draftId,
    notifiedAt: now,
  });
}

// One loop for each kind and state of the page (see `E2E_LOOPS`), one active delegate for the delegated loops, and two F102
// delegations for the Delegated tab.
export async function seedLoopsRows(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  ownerId: string,
  now: Date
): Promise<LoopsSeedIds> {
  return inTransaction(db, async (trx) => {
    const delegate = await trx
      .insertInto("delegates")
      .values({
        org_id: ctx.orgId,
        name: E2E_LOOPS_DELEGATE.name,
        email: E2E_LOOPS_DELEGATE.email,
        competence_tags: [],
        active: true,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const loopIds = {} as LoopsSeedIds["loopIds"];
    const sends = new Map<string, string>();
    let index = 0;
    for (const key of Object.keys(E2E_LOOPS) as (keyof typeof E2E_LOOPS)[]) {
      const plan: E2eLoopPlan = E2E_LOOPS[key];
      loopIds[key] = await seedLoop(trx, ctx, mailboxId, plan, delegate.id, index, now);
      if (plan.pair === true) sends.set(key, await seedFollowUpPair(trx, ctx, loopIds[key], plan, now));
      index += 1;
    }
    for (const [offset, key] of E2E_LOOPS_DELEGATIONS.entries()) {
      await seedDelegation(trx, ctx, mailboxId, E2E_DELEGATIONS[key], offset, now, ownerId);
    }
    const sendOf = (key: string): string => {
      const id = sends.get(key);
      if (id === undefined) throw new Error(`no follow-up send for ${key}`);
      return id;
    };
    return {
      loopIds,
      pendingSendId: sendOf("waitPending"),
      s11ClosedSendId: sendOf("s11Closed"),
      s11DroppedSendId: sendOf("s11Dropped"),
    };
  });
}
