import { type NoticeKind } from "@ea/core";

import { errorFields } from "../../../platform/errors";
import { listMailboxes } from "../../mail";
import { getOrganization } from "../../tenancy";
import { type LinkedChat } from "../port";
import { listReportMembers, type ReportMember } from "../report-members";

import { actionFailedDetector } from "./action-failed";
import { approvalDetector } from "./approval";
import { approvalSetDetector } from "./approval-set";
import { authErrorDetector } from "./auth-error";
import { delegationAnsweredDetector } from "./delegation-answered";
import { followUpClosedDetector } from "./follow-up-closed";
import { hostBlockedDetector } from "./host-blocked";
import { notTriagedDetector } from "./not-triaged";
import { log, type Detector, type NoticeDeps, type OrgRun } from "./run";
import { sendHeldDetector } from "./send-held";
import { sendResultDetector } from "./send-result";
import { sentMissingDetector } from "./sent-missing";
import { SYNC_LATE_MS, syncDetector } from "./sync";
import { urgentDetector } from "./urgent";
import { weeklyReportDetector } from "./weekly-report";

export { queueMailboxRemovedNotices } from "./mailbox-removed";
export { queueTrustNotice, trustReportUrlOf, trustSettingsUrlOf, type TrustNoticeInput } from "./trust";
export { SYNC_LATE_MS };
export type { NoticeDeps };

// The run order of one organization. Auth errors and syncs run one after the other for all mailboxes; that changes
// no row, because each row has its own dedup key and the same created_at.
export const detectors: readonly Detector[] = [
  urgentDetector,
  actionFailedDetector,
  authErrorDetector,
  hostBlockedDetector,
  sentMissingDetector,
  syncDetector,
  approvalDetector,
  approvalSetDetector,
  sendResultDetector,
  followUpClosedDetector,
  sendHeldDetector,
  delegationAnsweredDetector,
  weeklyReportDetector,
  notTriagedDetector,
];

// The detectors that also serve an organization with no linked chat (F110 stage 19).
export const mailOnlyDetectors: readonly Detector[] = [weeklyReportDetector];

// Kinds that a producer outside the detector list queues.
export const queuedBy = {
  digest: "channels/digest-job.ts",
  mailbox_removed: "channels/notices/mailbox-removed.ts",
  approval_edit: "channels/card-edits.ts",
  // The one line for an owner whose consent does not cover open-loop data: queued by the approval and send-result detectors.
  loop_consent: "channels/notices/loop-consent.ts",
  // F110: the trust module calls `queueTrustNotice` inside its own transaction (history check end, re-gate, tripwire).
  trust_report_ready: "trust (through channels/notices/trust.ts)",
  autonomy_paused: "trust (through channels/notices/trust.ts)",
} as const satisfies Partial<Record<NoticeKind, string>>;

async function detectForOrg(
  deps: NoticeDeps,
  orgId: string,
  members: LinkedChat[],
  reportMembers: ReportMember[],
  now: Date
): Promise<void> {
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
    reportMembers,
    mailboxes,
    pausedMailboxIds: new Set(mailboxes.filter((mailbox) => mailbox.status === "paused").map((mailbox) => mailbox.id)),
  };
  // An organization with no linked chat (only report-mail members) runs the weekly report only: the other detectors read the
  // link times of the members and have nobody to notify. One detector that fails (a view that does not render, a database
  // error) does not stop the later ones of the organization.
  for (const detector of members.length === 0 ? mailOnlyDetectors : detectors) {
    try {
      await detector.detect(run);
    } catch (error) {
      log.error("notice_detector_failed", { kind: detector.name, org_id: orgId, ...errorFields(error) });
    }
  }
}

// Never throws. One organization that fails does not stop the next one.
export async function detectNotices(deps: NoticeDeps): Promise<void> {
  try {
    const now = deps.now();
    // Every organization with a linked chat is visited. An organization with only report-mail members (no chat) is visited too,
    // for the weekly report only: with the flag `report_mail` off that detector queues nothing for them (F110 stage 19).
    const byOrg = new Map<string, { links: LinkedChat[]; members: ReportMember[] }>();
    for (const member of await listReportMembers(deps.db, { includeSuspended: false })) {
      const entry = byOrg.get(member.orgId) ?? { links: [], members: [] };
      entry.members.push(member);
      if (member.chat !== null) {
        entry.links.push({
          orgId: member.orgId,
          userId: member.userId,
          role: member.role,
          chatId: member.chat.chatId,
          linkedAt: member.chat.linkedAt,
          locale: member.locale,
        });
      }
      byOrg.set(member.orgId, entry);
    }
    for (const [orgId, { links, members }] of byOrg) {
      try {
        await detectForOrg(deps, orgId, links, members, now);
      } catch (error) {
        log.error("notices_org_failed", { org_id: orgId, ...errorFields(error) });
      }
    }
  } catch (error) {
    log.error("notices_failed", { ...errorFields(error) });
  }
}
