import { hasModelMark, DAY_MS } from "@ea/core";

import { type TenantContext } from "../../../platform/db";
import { listActionsForEmails } from "../../actions";
import { getMailboxSettings } from "../../config";
import { listDelegateNames } from "../../delegation";
import { delegateButtonOn, draftsAvailable } from "../../loops";
import { attachmentFactsToShow, getJunkFolderPath, INBOX, isSyntheticMessageId } from "../../mail";
import { draftableMails } from "../../replies";
import { isFeatureOn } from "../../tenancy";
import { listTriagedBetween, suspiciousReasonsOf, suspiciousReasonsToShow } from "../../triage";
import { replyConsentOf } from "../consent";
import { type NoticeRecipient } from "../notice-fan-out";

import { DbOrTrx, queue, warnSkipped, type Detector } from "./run";

export const URGENT_LOOKBACK_MS = DAY_MS;
export const URGENT_LIMIT = 200;

// Every recipient gets an urgent notice for mail that was triaged after the link (a push-only recipient: after the first device).
async function detectUrgent(
  db: DbOrTrx,
  ctx: TenantContext,
  members: NoticeRecipient[],
  pausedMailboxIds: Set<string>,
  timeZone: string,
  now: Date,
  resumedAt: Date | null
): Promise<void> {
  const lookbackStart = now.getTime() - URGENT_LOOKBACK_MS;
  // Mail triaged before a resume gets no urgent notice.
  const sinceOf = (member: NoticeRecipient) =>
    Math.max(member.since.getTime(), lookbackStart, resumedAt?.getTime() ?? 0);
  const earliest = Math.min(...members.map(sinceOf));
  const triaged = (
    await listTriagedBetween(
      db,
      ctx,
      { after: new Date(earliest - 1), until: now },
      { limit: URGENT_LIMIT, categories: ["urgent"] }
    )
  ).filter((row) => !pausedMailboxIds.has(row.mailbox_id));
  // Mail in the spam folder is in the digest, but it gets no urgent notice.
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
    rows.map((row) => row.email_id),
    now
  );
  const suspicious = await suspiciousReasonsToShow(
    db,
    ctx,
    rows.map((row) => row.email_id)
  );
  const attachmentFacts = await attachmentFactsToShow(
    db,
    ctx,
    rows.map((row) => row.email_id)
  );
  // The keys of the why line go into the view only while the flag is on.
  const whyOn = await isFeatureOn(db, ctx, "why_lines");
  const delegateIds = new Set<string>();
  for (const list of actions.values()) {
    for (const action of list) {
      if (action.delegateId !== null) delegateIds.add(action.delegateId);
    }
  }
  const names = await listDelegateNames(db, ctx, [...delegateIds]);
  // The Delegate button: the flag and an active delegate (once), then a mailbox that drafts (per mailbox) and no
  // suspicion (per mail).
  const delegateOn = await delegateButtonOn(db, ctx);
  const drafting = new Map<string, boolean>();
  // The reasons that `delegateMail` refuses, flag or no flag: the button is hidden for the same mails.
  const suspiciousAny = delegateOn
    ? await suspiciousReasonsOf(
        db,
        ctx,
        rows.map((row) => row.email_id)
      )
    : new Map<string, string[]>();
  if (delegateOn) {
    for (const mailboxId of new Set(rows.map((row) => row.mailbox_id))) {
      drafting.set(mailboxId, draftsAvailable(await getMailboxSettings(db, ctx, mailboxId)));
    }
  }
  // The Draft reply button: an owner whose consent covers reply data, and a mail that a reply draft can be made for now.
  const owners = members.filter((member) => member.role === "owner");
  const draftOwners =
    owners.length > 0
      ? await replyConsentOf(
          db,
          ctx,
          owners.map((owner) => owner.userId)
        )
      : new Set<string>();
  const draftable =
    draftOwners.size > 0
      ? await draftableMails(
          db,
          ctx,
          rows.map((row) => row.email_id),
          { now }
        )
      : new Set<string>();
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
        const flagged = suspicious.get(row.email_id) ?? [];
        const attachmentFact = attachmentFacts.get(row.email_id);
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
            eventAt: row.triaged_at,
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
              // Only a flagged mail gets the field: a view without it also renders in the code from before the field existed (rollback).
              ...(flagged.length > 0 ? { suspicious: flagged } : {}),
              // The same rule for the attachment line: no field with the flag off or without an attachment to show.
              ...(attachmentFact === undefined ? {} : { attachments: attachmentFact }),
              // The same rule for the why line: no keys with the flag off. A rule result carries no model mark.
              ...(whyOn ? { confidence: hasModelMark(row.reason_code) ? row.confidence : null, rule: row.rule } : {}),
              // The Delegate button: no field unless it shows, so a view without it renders as before.
              ...(delegateOn &&
              member.role === "owner" &&
              drafting.get(row.mailbox_id) === true &&
              (suspiciousAny.get(row.email_id) ?? []).length === 0
                ? { delegable: true as const }
                : {}),
              // The Draft reply button: no field unless it shows.
              ...(draftOwners.has(member.userId) && draftable.has(row.email_id) ? { draftable: true as const } : {}),
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
