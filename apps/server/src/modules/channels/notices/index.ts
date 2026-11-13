import { type NoticeKind } from "@ea/core";

import { describeError } from "../../../platform/errors";
import { listMailboxes } from "../../mail";
import { getOrganization } from "../../tenancy";
import { type LinkedChat } from "../port";
import { listLinkedChats } from "../repo";

import { actionFailedDetector } from "./action-failed";
import { approvalDetector } from "./approval";
import { approvalSetDetector } from "./approval-set";
import { authErrorDetector } from "./auth-error";
import { delegationAnsweredDetector } from "./delegation-answered";
import { log, type Detector, type NoticeDeps, type OrgRun } from "./run";
import { sendResultDetector } from "./send-result";
import { SYNC_LATE_MS, syncDetector } from "./sync";
import { urgentDetector } from "./urgent";

export { queueMailboxRemovedNotices } from "./mailbox-removed";
export { SYNC_LATE_MS };
export type { NoticeDeps };

// The run order of one organization. Auth errors and syncs run one after the other for all mailboxes; that changes
// no row, because each row has its own dedup key and the same created_at.
export const detectors: readonly Detector[] = [
  urgentDetector,
  actionFailedDetector,
  authErrorDetector,
  syncDetector,
  approvalDetector,
  approvalSetDetector,
  sendResultDetector,
  delegationAnsweredDetector,
];

// Kinds that a producer outside the detector list queues.
export const queuedBy = {
  digest: "channels/digest-job.ts",
  mailbox_removed: "channels/notices/mailbox-removed.ts",
} as const satisfies Partial<Record<NoticeKind, string>>;

async function detectForOrg(deps: NoticeDeps, orgId: string, members: LinkedChat[], now: Date): Promise<void> {
  const { db } = deps;
  const ctx = { orgId };
  const organization = await getOrganization(db, ctx);
  if (organization === undefined) throw new Error("organization not found");
  const mailboxes = await listMailboxes(db, ctx);
  const run: OrgRun = {
    deps,
    db,
    ctx,
    now,
    timeZone: organization.timezone,
    resumedAt: organization.resumed_at,
    members,
    owners: members.filter((member) => member.role === "owner"),
    mailboxes,
    pausedMailboxIds: new Set(mailboxes.filter((mailbox) => mailbox.status === "paused").map((mailbox) => mailbox.id)),
  };
  for (const detector of detectors) await detector.detect(run);
}

// Never throws. One organization that fails does not stop the next one.
export async function detectNotices(deps: NoticeDeps): Promise<void> {
  try {
    const now = deps.now();
    const byOrg = new Map<string, LinkedChat[]>();
    for (const link of await listLinkedChats(deps.db, { includeSuspended: false })) {
      byOrg.set(link.orgId, [...(byOrg.get(link.orgId) ?? []), link]);
    }
    for (const [orgId, members] of byOrg) {
      try {
        await detectForOrg(deps, orgId, members, now);
      } catch (error) {
        log.error(`notices for org ${orgId} failed: ${describeError(error)}`);
      }
    }
  } catch (error) {
    log.error(`notices failed: ${describeError(error)}`);
  }
}
