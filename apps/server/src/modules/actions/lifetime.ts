import { sendPayloadSchema } from "@ea/core";

import { APPROVAL_TTL_MS, REPLY_TTL_MS, UNNOTIFIED_TTL_MS } from "./constants";

// The fields of a send that its time limit reads. `SendRow` has them all.
export interface LifetimeRow {
  status: string;
  created_at: Date;
  notified_at: Date | null;
  approved_at: Date | null;
}

// The `kind` of a send payload; retention can clear the payload, then the kind is unknown and the old rules apply.
export function sendKindOf(payload: Record<string, unknown>): string | undefined {
  const parsed = sendPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data.kind : undefined;
}

// The one rule for the end of an approval. The tap (`approveRow`), the expiry job (its SQL repeats this rule in
// `listExpiredApprovals`), the `expiresAt` of `ApprovalItem` and the claim of an `approved` send all read the same limits.
// `awaiting_approval`: a reply ends 7 days after `created_at`, whatever `notified_at`; any other kind ends 48 h after the owner
// was told, or 7 days after it was planned when no owner was told. `approved` (held): 48 h after the tap, for every kind.
// Any other status has no limit: null.
export function approvalExpiresAt(kind: string | undefined, row: LifetimeRow): Date | null {
  if (row.status === "approved") return new Date((row.approved_at ?? row.created_at).getTime() + APPROVAL_TTL_MS);
  if (row.status !== "awaiting_approval") return null;
  if (kind === "reply") return new Date(row.created_at.getTime() + REPLY_TTL_MS);
  return row.notified_at === null
    ? new Date(row.created_at.getTime() + UNNOTIFIED_TTL_MS)
    : new Date(row.notified_at.getTime() + APPROVAL_TTL_MS);
}

// The reason of an `awaiting_approval` send that passed its limit. A reply never ends as `not_notified`.
export function approvalExpiryReason(kind: string | undefined, row: LifetimeRow): "timeout" | "not_notified" {
  return kind === "reply" || row.notified_at !== null ? "timeout" : "not_notified";
}
