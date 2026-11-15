import type { BriefLoop, BriefPart, MailboxMode } from "@ea/core";

import type { TenantContext } from "../../platform/db";

import { briefLoopsOf, type BriefLoopSection } from "./list";
import type { DbOrTrx, LoopRow } from "./repo";

// Another follow-up is not drafted after this many (D12).
const FOLLOW_UP_LIMIT = 2;

export interface LoopBrief {
  waiting: BriefPart<BriefLoop>;
  promised: BriefPart<BriefLoop>;
  stale: BriefPart<{ id: string; subject: string | null }>;
}

// The loops of the brief in the shape of the renderer (F116 stage 18). `modes`: the mode of each mailbox, for the "would draft a
// follow-up" marker of a shadow mailbox (stage 15 plans nothing there). `approval`: a follow-up send of the loop waits for the owner.
export async function loadLoopBrief(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxIds: readonly string[],
  opts: { now: Date; timeZone: string; modes: ReadonlyMap<string, MailboxMode | "none">; lock: boolean }
): Promise<LoopBrief> {
  const brief = await briefLoopsOf(db, ctx, mailboxIds, {
    now: opts.now,
    timeZone: opts.timeZone,
    lock: opts.lock,
  });
  const waitingIds = brief.waiting.rows.map((row) => row.id);
  const awaiting =
    waitingIds.length === 0
      ? []
      : await db
          .selectFrom("actions")
          .select("loop_id")
          .distinct()
          .where("org_id", "=", ctx.orgId)
          .where("loop_id", "in", waitingIds)
          .where("type", "=", "send")
          .where("status", "=", "awaiting_approval")
          .execute();
  const waitingForTap = new Set(awaiting.map((row) => row.loop_id));
  const toLoop = (row: LoopRow): BriefLoop => ({
    id: row.id,
    kind: row.kind,
    counterpart: row.counterpart,
    subject: row.subject,
    text: row.text,
    dueAt: row.due_at,
    sinceAt: row.wait_from_at,
    autoReplyOnly: row.auto_reply_at !== null,
    followUp: waitingForTap.has(row.id)
      ? "approval"
      : opts.modes.get(row.mailbox_id) === "shadow" &&
          row.kind === "delegated" &&
          row.due_at.getTime() <= opts.now.getTime() &&
          row.follow_ups_sent < FOLLOW_UP_LIMIT
        ? "would_draft"
        : null,
  });
  const part = (section: BriefLoopSection): BriefPart<BriefLoop> => ({
    rows: section.rows.map(toLoop),
    total: section.total,
  });
  return {
    waiting: part(brief.waiting),
    promised: part(brief.promised),
    stale: {
      rows: brief.stale.rows.map((row) => ({ id: row.id, subject: row.subject })),
      total: brief.stale.total,
    },
  };
}

// The queue transaction of the digest marks what the text named: `surfaced_at` of a loop line (the first time only) and
// `stale_notified_at` of a ⌛ line (once). A loop that a concurrent digest marked keeps its first time.
export async function markBriefShown(
  trx: DbOrTrx,
  ctx: TenantContext,
  shown: { surfaced: readonly string[]; stale: readonly string[]; at: Date }
): Promise<void> {
  if (shown.surfaced.length > 0) {
    await trx
      .updateTable("open_loops")
      .set({ surfaced_at: shown.at })
      .where("org_id", "=", ctx.orgId)
      .where("id", "in", [...shown.surfaced])
      .where("surfaced_at", "is", null)
      .execute();
  }
  if (shown.stale.length > 0) {
    await trx
      .updateTable("open_loops")
      .set({ stale_notified_at: shown.at })
      .where("org_id", "=", ctx.orgId)
      .where("id", "in", [...shown.stale])
      .where("stale_notified_at", "is", null)
      .where("status", "=", "closed")
      .execute();
  }
}
