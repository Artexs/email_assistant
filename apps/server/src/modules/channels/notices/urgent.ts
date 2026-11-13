import { type TenantContext } from "../../../platform/db";
import { listActionsForEmails } from "../../actions";
import { listDelegateNames } from "../../delegation";
import { getJunkFolderPath, INBOX, isSyntheticMessageId } from "../../mail";
import { listTriagedBetween } from "../../triage";
import { type LinkedChat } from "../port";

import { DbOrTrx, queue, warnSkipped, type Detector } from "./run";

export const URGENT_LOOKBACK_MS = 24 * 3_600_000;
export const URGENT_LIMIT = 200;

// D13: every linked member gets an urgent notice for mail that was triaged after the link.
async function detectUrgent(
  db: DbOrTrx,
  ctx: TenantContext,
  members: LinkedChat[],
  pausedMailboxIds: Set<string>,
  timeZone: string,
  now: Date,
  resumedAt: Date | null
): Promise<void> {
  const lookbackStart = now.getTime() - URGENT_LOOKBACK_MS;
  // S3: mail triaged before a resume gets no urgent notice.
  const sinceOf = (member: LinkedChat) => Math.max(member.linkedAt.getTime(), lookbackStart, resumedAt?.getTime() ?? 0);
  const earliest = Math.min(...members.map(sinceOf));
  const triaged = (
    await listTriagedBetween(
      db,
      ctx,
      { after: new Date(earliest - 1), until: now },
      { limit: URGENT_LIMIT, categories: ["urgent"] }
    )
  ).filter((row) => !pausedMailboxIds.has(row.mailbox_id));
  // D23: mail in the spam folder is in the digest, but it gets no urgent notice.
  const junkPaths = new Map<string, string | null>();
  const rows: typeof triaged = [];
  for (const row of triaged) {
    if (!junkPaths.has(row.mailbox_id)) junkPaths.set(row.mailbox_id, await getJunkFolderPath(db, ctx, row.mailbox_id));
    if (row.source_folder !== junkPaths.get(row.mailbox_id)) rows.push(row);
  }
  if (rows.length === 0) return;
  const actions = await listActionsForEmails(
    db,
    ctx,
    rows.map((row) => row.email_id)
  );
  const delegateIds = new Set<string>();
  for (const list of actions.values()) {
    for (const action of list) {
      if (action.delegateId !== null) delegateIds.add(action.delegateId);
    }
  }
  const names = await listDelegateNames(db, ctx, [...delegateIds]);
  for (const member of members) {
    const since = sinceOf(member);
    for (const row of rows) {
      if (row.triaged_at.getTime() < since) continue;
      try {
        const rowActions = (actions.get(row.email_id) ?? []).map(
          ({ type, status, folder, reverse, kind, delegateId }) => ({
            type,
            status,
            folder,
            reverse,
            kind,
            delegateId,
          })
        );
        const delegateNames = Object.fromEntries(
          rowActions.flatMap(({ delegateId }) => {
            const name = delegateId === null ? undefined : names.get(delegateId);
            return delegateId !== null && name !== undefined ? [[delegateId, name] as const] : [];
          })
        );
        await queue(
          db,
          ctx,
          {
            userId: member.userId,
            locale: member.locale,
            kind: "urgent",
            dedupKey: `urgent:${row.email_id}`,
            emailId: row.email_id,
            view: {
              emailId: row.email_id,
              from: row.from_address,
              subject: row.subject,
              ai: { reasonCode: row.reason_code, reason: row.reason },
              receivedAt: row.received_at,
              synthetic: isSyntheticMessageId(row.message_id_header),
              folderTag: row.source_folder === INBOX ? null : row.source_folder,
              actions: rowActions,
              delegateNames,
              stayFolder: row.folder,
              now,
              timeZone,
            },
          },
          now
        );
      } catch (error) {
        warnSkipped("urgent", row.email_id, error);
      }
    }
  }
}

export const urgentDetector: Detector = {
  name: "urgent",
  kinds: ["urgent"],
  detect: (run) =>
    detectUrgent(run.db, run.ctx, run.members, run.pausedMailboxIds, run.timeZone, run.now, run.resumedAt),
};
