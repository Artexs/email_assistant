import { describeError } from "../../../platform/errors";
import { listMailboxes } from "../../mail";
import { getOrganization } from "../../tenancy";
import { type LinkedChat } from "../port";
import { listLinkedChats } from "../repo";

import { detectActionFailed } from "./action-failed";
import { detectApprovals } from "./approval";
import { detectApprovalSets } from "./approval-set";
import { detectAuthError } from "./auth-error";
import { detectDelegationAnswered } from "./delegation-answered";
import { NoticeDeps, log } from "./run";
import { detectSendResults } from "./send-result";
import { detectSync, SYNC_LATE_MS } from "./sync";
import { detectUrgent } from "./urgent";

export { queueMailboxRemovedNotices } from "./mailbox-removed";
export { SYNC_LATE_MS };
export type { NoticeDeps };

async function detectForOrg(deps: NoticeDeps, orgId: string, members: LinkedChat[], now: Date): Promise<void> {
  const { db } = deps;
  const ctx = { orgId };
  const organization = await getOrganization(db, ctx);
  if (organization === undefined) throw new Error("organization not found");
  const timeZone = organization.timezone;
  const mailboxes = await listMailboxes(db, ctx);
  const owners = members.filter((member) => member.role === "owner");

  const pausedIds = new Set(mailboxes.filter((mailbox) => mailbox.status === "paused").map((mailbox) => mailbox.id));
  await detectUrgent(db, ctx, members, pausedIds, timeZone, now, organization.resumed_at);
  await detectActionFailed(db, ctx, owners, now);
  for (const mailbox of mailboxes) {
    await detectAuthError(db, ctx, owners, mailbox, timeZone, now);
    await detectSync(deps, ctx, members, owners, mailbox, timeZone, now, organization.resumed_at);
  }
  await detectApprovals(db, ctx, owners, timeZone, now);
  await detectApprovalSets(db, ctx, owners, timeZone, now);
  await detectSendResults(db, ctx, owners, now);
  await detectDelegationAnswered(db, ctx, members, timeZone, now);
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
