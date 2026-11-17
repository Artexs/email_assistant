import { MAX_LATER_TAPS, type LoopItem, type LoopReason } from "@ea/core";

import type { TenantContext } from "../../platform/db";
import { listDelegateNames } from "../delegation";

import { WAITING_STATUSES } from "./follow-up-draft";
import type { DbOrTrx, LoopKind, LoopRow } from "./repo";

// The page items of `GET /api/loops` (the panel reads them; no job does). One read per table for the whole page: the
// names of the delegates and the follow-up sends that still wait.

const REASON_OF: Record<LoopKind, LoopReason> = {
  waiting: "asked_no_answer",
  promised: "promised",
  delegated: "forwarded_to_delegate",
};

// The oldest follow-up send of each loop that waits for a tap or is on its way out. Only the sends of `ctx`.
async function waitingSendsOf(
  db: DbOrTrx,
  ctx: TenantContext,
  loopIds: readonly string[]
): Promise<Map<string, string>> {
  if (loopIds.length === 0) return new Map();
  const rows = await db
    .selectFrom("actions")
    .select(["id", "loop_id"])
    .where("org_id", "=", ctx.orgId)
    .where("loop_id", "in", [...loopIds])
    .where("type", "=", "send")
    .where("status", "in", WAITING_STATUSES)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .execute();
  const byLoop = new Map<string, string>();
  // Newest first in the query: the last row of a loop that the loop sets is its oldest one.
  for (const row of rows) if (row.loop_id !== null) byLoop.set(row.loop_id, row.id);
  return byLoop;
}

export async function loopItemsOf(db: DbOrTrx, ctx: TenantContext, rows: readonly LoopRow[]): Promise<LoopItem[]> {
  const names = await listDelegateNames(
    db,
    ctx,
    rows.flatMap((row) => (row.delegate_id === null ? [] : [row.delegate_id]))
  );
  const sends = await waitingSendsOf(
    db,
    ctx,
    rows.map((row) => row.id)
  );
  return rows.map((row) => {
    const sendId = sends.get(row.id) ?? null;
    return {
      kind: row.kind,
      id: row.id,
      status: row.status,
      closeReason: row.close_reason,
      counterpart: row.counterpart,
      delegate: row.delegate_id === null ? null : { id: row.delegate_id, name: names.get(row.delegate_id) ?? "" },
      text: row.text,
      subject: row.subject,
      dueAt: row.due_at.toISOString(),
      dueSource: row.due_source,
      sentAt: row.wait_from_at.toISOString(),
      laterLeft: Math.max(0, MAX_LATER_TAPS - row.later_count),
      followUpsSent: row.follow_ups_sent,
      followUpWaiting: sendId !== null,
      sendId,
      matchedBySubject: row.close_reason === "replied_subject",
      autoReplyOnly: row.status === "open" && row.auto_reply_at !== null,
      reason: REASON_OF[row.kind],
    };
  });
}
