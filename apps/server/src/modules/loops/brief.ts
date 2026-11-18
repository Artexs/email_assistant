import type { BriefLoop, BriefPart, MailboxMode } from "@ea/core";
import { sql } from "kysely";

import type { TenantContext } from "../../platform/db";

import { briefLoopsOf, type BriefLoopSection } from "./list";
import type { DbOrTrx, LoopRow } from "./repo";

// Another follow-up is not drafted after this many.
const FOLLOW_UP_LIMIT = 2;

export interface LoopBrief {
  waiting: BriefPart<BriefLoop>;
  promised: BriefPart<BriefLoop>;
  stale: BriefPart<{ id: string; subject: string | null }>;
}

// The loops of the brief in the shape of the renderer. `modes`: the mode of each mailbox, for the "would draft a
// follow-up" marker of a shadow mailbox (the plan step plans nothing there). `approval`: a follow-up send of the loop waits for the owner.
export async function loadLoopBrief(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxIds: readonly string[],
  opts: {
    now: Date;
    timeZone: string;
    modes: ReadonlyMap<string, MailboxMode | "none">;
    // The mailboxes that plan a draft for a tap (`draftsAvailable`): the Draft button shows for their loops only.
    draftMailboxIds: ReadonlySet<string>;
    lock: boolean;
  }
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
    laterCount: row.later_count,
    canDraft:
      row.kind !== "promised" &&
      !waitingForTap.has(row.id) &&
      row.follow_ups_sent < FOLLOW_UP_LIMIT &&
      opts.draftMailboxIds.has(row.mailbox_id),
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

// A digest that ended `failed` (never delivered) gives its marks back, so each line is shown once: the loops that
// it named get `surfaced_at` and `stale_notified_at` null again when the mark is the time of this digest and no other digest that
// is not `failed` names the loop. A mark from another time (an earlier or a later digest) stays. `digest.at` is the creation time of
// the outbox row: `markBriefShown` wrote the same time (`queueDigest` passes `now` to both).
export async function releaseBriefMarks(
  trx: DbOrTrx,
  ctx: TenantContext,
  digest: { outboxId: string; loopIds: readonly string[]; at: Date }
): Promise<void> {
  if (digest.loopIds.length === 0) return;
  const namedElsewhere = sql<boolean>`exists (
    select 1 from outbox other
    where other.org_id = open_loops.org_id and other.kind = 'digest' and other.id <> ${digest.outboxId}::uuid
      and other.status <> 'failed'
      and jsonb_typeof(other.view->'loopIds') = 'array'
      and jsonb_exists(other.view->'loopIds', open_loops.id::text)
  )`;
  for (const column of ["surfaced_at", "stale_notified_at"] as const) {
    await trx
      .updateTable("open_loops")
      .set({ [column]: null })
      .where("org_id", "=", ctx.orgId)
      .where("id", "in", [...digest.loopIds])
      .where(column, "=", digest.at)
      .where(sql<boolean>`not ${namedElsewhere}`)
      .execute();
  }
}
