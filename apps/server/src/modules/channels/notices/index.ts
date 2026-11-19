import { pushKinds, type NoticeKind } from "@ea/core";

import { errorFields } from "../../../platform/errors";
import { listMailboxes } from "../../mail";
import { getOrganization, isFeatureOn } from "../../tenancy";
import { type NoticeRecipient } from "../notice-fan-out";
import { listPushOnlyMembers, type PushOnlyMember } from "../push";
import { listReportMembers, type ReportMember } from "../report-members";

import { actionFailedDetector } from "./action-failed";
import { approvalDetector } from "./approval";
import { approvalSetDetector } from "./approval-set";
import { authErrorDetector } from "./auth-error";
import { delegationAnsweredDetector } from "./delegation-answered";
import { followUpClosedDetector } from "./follow-up-closed";
import { hostBlockedDetector } from "./host-blocked";
import { notTriagedDetector } from "./not-triaged";
import { repliesReadyDetector } from "./replies-ready";
import { replyResultsDetector } from "./reply-results";
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
  repliesReadyDetector,
  replyResultsDetector,
  sendResultDetector,
  followUpClosedDetector,
  sendHeldDetector,
  delegationAnsweredDetector,
  weeklyReportDetector,
  notTriagedDetector,
];

// The detectors that also serve an organization with no linked chat.
export const mailOnlyDetectors: readonly Detector[] = [weeklyReportDetector];

// Kinds that a producer outside the detector list queues.
export const queuedBy = {
  digest: "channels/digest-job.ts",
  mailbox_removed: "channels/notices/mailbox-removed.ts",
  approval_edit: "channels/card-edits.ts",
  // The one line for an owner whose consent does not cover open-loop data: queued by the approval and send-result detectors.
  loop_consent: "channels/notices/loop-consent.ts",
  // The question after a Redraft tap is queued by the tap code. `replies_ready` and `reply_result` have their own detectors.
  reply_prompt: "channels/reply-redraft.ts",
  // The trust module calls `queueTrustNotice` inside its own transaction (history check end, re-gate, tripwire).
  trust_report_ready: "trust (through channels/notices/trust.ts)",
  autonomy_paused: "trust (through channels/notices/trust.ts)",
} as const satisfies Partial<Record<NoticeKind, string>>;

// A detector that queues push kinds only (and queues something): its kinds all have a push renderer. A detector with another
// kind (a Telegram card, a report) or none (`follow-up-closed` edits cards) never sees a push-only member.
export function servesPushOnly(detector: Detector): boolean {
  const push: readonly NoticeKind[] = pushKinds;
  return detector.kinds.length > 0 && detector.kinds.every((kind) => push.includes(kind));
}

const byUserId = (a: NoticeRecipient, b: NoticeRecipient) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);

async function detectForOrg(
  deps: NoticeDeps,
  orgId: string,
  chats: NoticeRecipient[],
  pushOnly: NoticeRecipient[],
  reportMembers: ReportMember[],
  now: Date
): Promise<void> {
  const { db } = deps;
  const ctx = { orgId };
  const organization = await getOrganization(db, ctx);
  if (organization === undefined) throw new Error("organization not found");
  const mailboxes = await listMailboxes(db, ctx);
  const everyone = [...chats, ...pushOnly].sort(byUserId);
  const run: OrgRun = {
    deps,
    db,
    ctx,
    now,
    timeZone: organization.timezone,
    resumedAt: organization.resumed_at,
    members: chats,
    owners: chats.filter((member) => member.role === "owner"),
    reportMembers,
    mailboxes,
    pausedMailboxIds: new Set(mailboxes.filter((mailbox) => mailbox.status === "paused").map((mailbox) => mailbox.id)),
  };
  // An organization with no recipient (only report-mail members) runs the weekly report only: the other detectors read the
  // link times of the members and have nobody to notify. An organization with push-only members and no chat runs the detectors
  // of push kinds as well. One detector that fails (a view that does not render, a database error) does not stop the later ones
  // of the organization.
  const list =
    chats.length > 0
      ? detectors
      : everyone.length === 0
        ? mailOnlyDetectors
        : detectors.filter((detector) => mailOnlyDetectors.includes(detector) || servesPushOnly(detector));
  for (const detector of list) {
    // A push-only member takes part in the detectors of push kinds only.
    const members = servesPushOnly(detector) ? everyone : chats;
    try {
      await detector.detect({ ...run, members, owners: members.filter((member) => member.role === "owner") });
    } catch (error) {
      log.error("notice_detector_failed", { kind: detector.name, org_id: orgId, ...errorFields(error) });
    }
  }
}

const recipientOfPushOnly = (member: PushOnlyMember): NoticeRecipient => ({
  userId: member.userId,
  role: member.role,
  locale: member.locale,
  since: member.since,
  hasChat: false,
});

// Never throws. One organization that fails does not stop the next one.
export async function detectNotices(deps: NoticeDeps): Promise<void> {
  try {
    const now = deps.now();
    // Every organization with a linked chat is visited. An organization with only report-mail members (no chat) is visited too,
    // for the weekly report only: with the flag `report_mail` off that detector queues nothing for them. An organization whose
    // only recipients are push-only members (a live device, no chat, the flag `web_push` on) is visited for the push kinds.
    const byOrg = new Map<string, { chats: NoticeRecipient[]; pushOnly: NoticeRecipient[]; members: ReportMember[] }>();
    const entryOf = (orgId: string) => {
      const entry = byOrg.get(orgId) ?? { chats: [], pushOnly: [], members: [] };
      byOrg.set(orgId, entry);
      return entry;
    };
    for (const member of await listReportMembers(deps.db, { includeSuspended: false })) {
      const entry = entryOf(member.orgId);
      entry.members.push(member);
      if (member.chat !== null) {
        entry.chats.push({
          userId: member.userId,
          role: member.role,
          locale: member.locale,
          since: member.chat.linkedAt,
          hasChat: true,
        });
      }
    }
    const flagByOrg = new Map<string, boolean>();
    for (const member of await listPushOnlyMembers(deps.db, { now })) {
      let flagOn = flagByOrg.get(member.orgId);
      if (flagOn === undefined) {
        flagOn = await isFeatureOn(deps.db, { orgId: member.orgId }, "web_push");
        flagByOrg.set(member.orgId, flagOn);
      }
      if (flagOn) entryOf(member.orgId).pushOnly.push(recipientOfPushOnly(member));
    }
    for (const [orgId, { chats, pushOnly, members }] of byOrg) {
      try {
        await detectForOrg(deps, orgId, chats, pushOnly, members, now);
      } catch (error) {
        log.error("notices_org_failed", { org_id: orgId, ...errorFields(error) });
      }
    }
  } catch (error) {
    log.error("notices_failed", { ...errorFields(error) });
  }
}
