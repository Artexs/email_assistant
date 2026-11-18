import {
  DELEGATION_DEFAULT_FILTER,
  DELEGATION_PAGE_SIZE,
  delegationItemSchema,
  z,
  type DelegationFilter,
  type DelegationItem,
  type DelegationList,
} from "@ea/core";

import type { Db, TenantContext } from "../../platform/db";

import { listDelegationPage, type DelegationPageCursor, type DelegationPageRow, type DelegationStatus } from "./repo";

// The states of each filter (`docs/capabilities/delegation.md`).
const FILTER_STATUSES: Record<DelegationFilter, readonly DelegationStatus[]> = {
  open: ["drafted", "sent"],
  overdue: ["overdue"],
  answered: ["answered"],
  closed: ["done", "cancelled"],
};

// The same form as the cursor of `GET /api/activity` (it sits in `reports`, a layer above this module): base64url of
// `<created_at with microseconds>|<id>`. The key is checked as text before it reaches the database.
const KEY_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const TEXT_PATTERN = /^[A-Za-z0-9_-]+$/;
const uuidSchema = z.uuid();

export function encodeDelegationCursor(cursor: DelegationPageCursor): string {
  return Buffer.from(`${cursor.createdAtKey}|${cursor.id}`, "utf8").toString("base64url");
}

export function decodeDelegationCursor(text: string): DelegationPageCursor | null {
  if (!TEXT_PATTERN.test(text)) return null;
  const parts = Buffer.from(text, "base64url").toString("utf8").split("|");
  if (parts.length !== 2) return null;
  const [createdAtKey, id] = parts as [string, string];
  if (!uuidSchema.safeParse(id).success || !KEY_PATTERN.test(createdAtKey)) return null;
  const date = new Date(createdAtKey);
  // JS rolls a date that does not exist over (02-30 becomes 03-02) and accepts year 0000; Postgres refuses both.
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() < 1 ||
    date.toISOString().slice(0, 19) !== createdAtKey.slice(0, 19)
  ) {
    return null;
  }
  return { createdAtKey, id };
}

// Retention replaces the task text of a closed delegation with this marker (`clearDelegationTasks`).
const TASK_REMOVED = "[removed]";

function toItem(row: DelegationPageRow): DelegationItem {
  return delegationItemSchema.parse({
    kind: "delegation",
    id: row.id,
    status: row.status,
    delegate: { id: row.delegate_id, name: row.delegate_name, email: row.delegate_email, active: row.delegate_active },
    task: row.task_summary === TASK_REMOVED ? null : row.task_summary,
    subject: row.subject,
    dueAt: row.due_at?.toISOString() ?? null,
    sentAt: row.sent_at?.toISOString() ?? null,
    answeredAt: row.answered_at?.toISOString() ?? null,
    remindersSent: row.reminders_sent,
    reminderWaiting: row.reminder_waiting,
    sendId: row.status === "drafted" ? row.send_action_id : null,
  });
}

// One page of the delegation list. `cursor` comes from `decodeDelegationCursor`. `next` is set when more rows follow.
export async function listDelegationItems(
  db: Db,
  ctx: TenantContext,
  query: { filter?: DelegationFilter; cursor?: DelegationPageCursor; limit?: number }
): Promise<DelegationList> {
  const limit = query.limit ?? DELEGATION_PAGE_SIZE;
  const rows = await listDelegationPage(db, ctx, {
    statuses: FILTER_STATUSES[query.filter ?? DELEGATION_DEFAULT_FILTER],
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    limit: limit + 1,
  });
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const next =
    rows.length > limit && last !== undefined
      ? encodeDelegationCursor({ createdAtKey: last.created_at_key, id: last.id })
      : null;
  return { items: page.map(toItem), next };
}
