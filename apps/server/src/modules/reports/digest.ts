import {
  aiTextFor,
  describeActions,
  handledShare,
  hasModelMark,
  isUndoable,
  mailboxModes,
  renderDigestWithBrief,
  textsFor,
  type DigestItem,
  type DigestMinimalFacts,
  type DigestMailbox,
  type DigestShown,
  type MembershipRole,
  type OutMessage,
  type UserLocale,
  DAY_MS,
} from "@ea/core";
import { z } from "zod";

import type { Db, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";
import { listActionsForEmails, listDraftTasks, listSummaries } from "../actions";
import { auditEvents, countEventsBetween } from "../audit";
import { getMailboxSettings } from "../config";
import { countOpenDelegations, listDelegateNames, listDelegateTags } from "../delegation";
import { delegableCategory, delegateButtonOn, draftsAvailable } from "../loops";
import {
  attachmentFactsToShow,
  countWaiting,
  INBOX,
  isSyntheticMessageId,
  listMailboxes,
  type TestMailRule,
} from "../mail";
import { draftableMails } from "../replies";
import { getOrganization, isFeatureOn } from "../tenancy";
import {
  countTriagedBetween,
  listHandledRows,
  listTriagedBetween,
  suspiciousReasonsOf,
  suspiciousReasonsToShow,
} from "../triage";

import { loadBrief, loadSpamReview } from "./digest-brief";
import { llmPauseToShow } from "./llm-pause";
import { lastSentDigestEnd } from "./repo";

export { spamReviewUrlOf, SPAM_REVIEW_MAX_PERIOD_MS } from "./digest-brief";

export const DIGEST_ITEM_LIMIT = 100;
export const DIGEST_MAX_PERIOD_MS = 7 * DAY_MS;
export const FIRST_DIGEST_LOOKBACK_MS = DAY_MS;
export const WAITING_WINDOW_MS = 7 * DAY_MS;
const HANDLED_WINDOW_MS = 7 * DAY_MS;

const modeSchema = z.enum(mailboxModes);

// The open-loops part of a scheduled digest. Absent: no brief, no count line (the digest on demand).
export interface DigestLoops {
  // The first digest of the member's local day: the brief. Later digests of the day get a count line.
  firstOfDay: boolean;
  // `loopConsentOf` of the member: false hides every loop line. The channels job reads it; `reports` may not import `channels`.
  loopConsent: boolean;
  // The base URL of the panel: the "+n more in the panel" lines link to it.
  panelBase?: string;
}

export interface DigestRequest {
  kind: "scheduled" | "on_demand";
  periodStart: Date;
  periodEnd: Date;
  slot: { date: string; time: string; late: boolean } | null;
  now: Date;
  locale: UserLocale;
  // The role of the member that gets the digest. Draft, Drop, Reopen and Delegate are owner only: a member gets no such button and no
  // ⌛ line (its one button is Reopen), so the line stays for an owner.
  role: MembershipRole;
  testMail: TestMailRule;
  loops?: DigestLoops;
  // The open reply drafts of the organization that an owner may review: one footer line with the count. The channels job
  // reads it (`reports` may not import `channels`); absent or 0: no line.
  repliesReady?: number;
  // The "Draft reply" button may show on the rows: the member is an owner whose Telegram consent covers reply data (the channels job
  // reads it: `reports` may not import `channels`). The rows still need a draft that can be made now (`draftableMails`).
  replyDrafts?: boolean;
  // The base URL of the panel (`WEB_BASE_URL`): the spam review line links to the Activity list with it. Unset: no link.
  panelBase?: string;
}

// What the digest named of the loops: the queue transaction marks these (`markBriefShown`).
export interface DigestBuilt {
  message: OutMessage;
  shown: DigestShown;
  // The counts and the clock of the `minimal` Telegram render. The Telegram row stores them in its view.
  minimal: DigestMinimalFacts;
}

// A digest that failed (never sent) does not move the start, so the next sent digest covers its mail.
export async function digestPeriodStart(
  db: Db,
  ctx: TenantContext,
  member: { userId: string; linkedAt: Date },
  now: Date
): Promise<Date> {
  const lastEnd = await lastSentDigestEnd(db, ctx, member.userId);
  const start = lastEnd ?? new Date(member.linkedAt.getTime() - FIRST_DIGEST_LOOKBACK_MS);
  const oldest = now.getTime() - DIGEST_MAX_PERIOD_MS;
  return new Date(Math.min(Math.max(start.getTime(), oldest), now.getTime()));
}

// The digest is the same for every member of the organization; only the period depends on the member.
export async function buildDigestMessage(db: Db, ctx: TenantContext, request: DigestRequest): Promise<OutMessage> {
  return (await buildDigest(db, ctx, request)).message;
}

export async function buildDigest(db: Db, ctx: TenantContext, request: DigestRequest): Promise<DigestBuilt> {
  const organization = await getOrganization(db, ctx);
  if (organization === undefined) throw new HardError("organization not found");

  const texts = textsFor(request.locale);
  const mailboxRows = await listMailboxes(db, ctx);
  const mailboxes: DigestMailbox[] = [];
  // The mailboxes that plan a draft for a tap: the Draft and the Delegate buttons show for their mail only.
  const draftMailboxIds = new Set<string>();
  for (const row of mailboxRows) {
    const settings = await getMailboxSettings(db, ctx, row.id);
    if (draftsAvailable(settings)) draftMailboxIds.add(row.id);
    mailboxes.push({
      id: row.id,
      address: row.address,
      status: row.status,
      lastSyncedAt: row.last_synced_at,
      statusChangedAt: row.status_changed_at,
      mode: settings === undefined ? "none" : modeSchema.parse(settings.mode),
    });
  }

  const range = { after: request.periodStart, until: request.periodEnd };
  const rows = await listTriagedBetween(db, ctx, range, { limit: DIGEST_ITEM_LIMIT });
  const counts = await countTriagedBetween(db, ctx, range);

  const actions = await listActionsForEmails(
    db,
    ctx,
    rows.map((row) => row.email_id),
    request.now
  );
  const summaries = await listSummaries(
    db,
    ctx,
    rows.filter((row) => row.category === "info").map((row) => row.email_id)
  );

  const delegateIds = new Set<string>();
  for (const list of actions.values()) {
    for (const action of list) {
      if (action.delegateId !== null) delegateIds.add(action.delegateId);
    }
  }
  const names = await listDelegateNames(db, ctx, [...delegateIds]);
  const tasks = await listDraftTasks(
    db,
    ctx,
    rows.filter((row) => row.category === "delegation").map((row) => row.email_id)
  );
  const delegations = await countOpenDelegations(db, ctx);
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

  // The keys of the why line go into the items only while the flag is on.
  const whyOn = await isFeatureOn(db, ctx, "why_lines");
  const delegateTags = whyOn ? await listDelegateTags(db, ctx, [...delegateIds]) : new Map<string, string[]>();

  // The Delegate button needs the flag and an active delegate (organization), then a mailbox that drafts, a category
  // of the action section and no suspicion (row).
  const delegateOn = await delegateButtonOn(db, ctx);
  // The reasons that `delegateMail` refuses, flag or no flag: the button is hidden for the same mails.
  const suspiciousAny = delegateOn
    ? await suspiciousReasonsOf(
        db,
        ctx,
        rows.map((row) => row.email_id)
      )
    : new Map<string, string[]>();

  // The Draft reply button: an owner with the consent, a mail of the two categories that a reply answers, and no open reply draft.
  const draftable =
    request.replyDrafts === true && request.role === "owner"
      ? await draftableMails(
          db,
          ctx,
          rows.filter((row) => row.category === "needs_reply" || row.category === "urgent").map((row) => row.email_id),
          { now: request.now }
        )
      : new Set<string>();

  const items: DigestItem[] = rows.map((row) => ({
    emailId: row.email_id,
    category: row.category,
    from: row.from_address,
    subject: row.subject,
    receivedAt: row.received_at,
    synthetic: isSyntheticMessageId(row.message_id_header),
    folderTag: row.source_folder === INBOX ? null : row.source_folder,
    aiText: aiTextFor(
      {
        category: row.category,
        reasonCode: row.reason_code,
        reason: row.reason,
        summary: summaries.get(row.email_id) ?? null,
        modelCategory: row.model_category,
        confidence: row.confidence,
        task: tasks.get(row.email_id) ?? null,
      },
      texts
    ),
    // With the flag on, a delegation draft names the competence tags of its delegate.
    wouldDo: describeActions(
      actions.get(row.email_id) ?? [],
      names,
      { stayFolder: row.folder, ...(whyOn ? { delegateTags } : {}) },
      texts
    ),
    undoable: isUndoable(actions.get(row.email_id) ?? [], request.now),
    suspicious: suspicious.get(row.email_id) ?? [],
    ...(delegateOn &&
    request.role === "owner" &&
    draftMailboxIds.has(row.mailbox_id) &&
    delegableCategory(row.category) &&
    (suspiciousAny.get(row.email_id) ?? []).length === 0
      ? { delegable: true }
      : {}),
    ...(draftable.has(row.email_id) ? { draftable: true } : {}),
    ...(attachmentFacts.has(row.email_id) ? { attachments: attachmentFacts.get(row.email_id) } : {}),
    hasDraft: (actions.get(row.email_id) ?? []).some((action) => action.type === "create_draft" && !action.reverse),
    ...(whyOn
      ? {
          // No model mark for a result that no model made (a rule, an error): confidence 1 or 0 there is not a measure.
          confidence: hasModelMark(row.reason_code) ? row.confidence : null,
          rule: row.rule,
        }
      : {}),
  }));

  const skippedTooOld = await countEventsBetween(db, ctx, auditEvents.emailSkipped, range, { reasonCode: "too_old" });
  const skippedBacklog = await countEventsBetween(db, ctx, auditEvents.emailSkipped, range, {
    reasonCode: "suspended_backlog",
  });
  const waiting = await countWaiting(db, ctx, { receivedSince: new Date(request.now.getTime() - WAITING_WINDOW_MS) });
  const llmPause = await llmPauseToShow(db, ctx, request.now);
  // The handled share of the last 7 days, behind the flag `handled_share`.
  const handled = (await isFeatureOn(db, ctx, "handled_share"))
    ? handledShare(
        await listHandledRows(db, ctx, {
          range: { start: new Date(request.now.getTime() - HANDLED_WINDOW_MS), end: request.now },
          mailboxId: null,
          testMail: request.testMail,
        })
      )
    : null;

  const spamReview = await loadSpamReview(db, ctx, request, mailboxes);

  const brief =
    request.loops === undefined
      ? null
      : await loadBrief(
          db,
          ctx,
          { ...request, loops: request.loops },
          {
            timeZone: organization.timezone,
            mailboxes,
            items,
            draftMailboxIds,
          }
        );

  return renderDigestWithBrief(
    {
      kind: request.kind,
      now: request.now,
      timeZone: organization.timezone,
      slot: request.slot,
      periodStart: request.periodStart,
      mailboxes,
      counts,
      items,
      skippedTooOld,
      skippedBacklog,
      waiting,
      delegations,
      ...(llmPause === null ? {} : { llmPause }),
      ...(handled === null
        ? {}
        : { handled: { ...handled, shadowOnly: mailboxes.every((mailbox) => mailbox.mode === "shadow") } }),
      ...(spamReview === null ? {} : { spamReview }),
      ...(brief === null ? {} : { brief }),
      ...(request.repliesReady === undefined || request.repliesReady <= 0
        ? {}
        : { repliesReady: request.repliesReady }),
    },
    texts
  );
}
