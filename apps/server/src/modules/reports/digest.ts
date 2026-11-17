import {
  aiTextFor,
  briefSectionKeys,
  describeActions,
  handledShare,
  hasModelMark,
  isUndoable,
  loopSections,
  mailboxModes,
  renderDigestWithBrief,
  textsFor,
  type BriefInput,
  type BriefRenderOptions,
  type DigestBrief,
  type DigestItem,
  type DigestMailbox,
  type DigestShown,
  type DigestSpamReview,
  type MailboxMode,
  type OutMessage,
  type UserLocale,
} from "@ea/core";
import { z } from "zod";

import type { Db, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";
import { countSpamMoves, listActionsForEmails, listDraftTasks, listSummaries } from "../actions";
import { auditEvents, countEventsBetween } from "../audit";
import { getMailboxSettings } from "../config";
import { countOpenDelegations, listDelegateNames, listDelegateTags, listDelegationsDueBy } from "../delegation";
import { delegableCategory, delegateButtonOn, draftsAvailable, endOfLocalDay, loadLoopBrief } from "../loops";
import {
  attachmentFactsToShow,
  countWaiting,
  INBOX,
  isSyntheticMessageId,
  listMailboxes,
  type TestMailRule,
} from "../mail";
import { getOrganization, isFeatureOn } from "../tenancy";
import {
  answeredEmailIds,
  countTriagedBetween,
  listHandledRows,
  listTriagedBetween,
  listWaitingOnYou,
  suspiciousReasonsOf,
  suspiciousReasonsToShow,
} from "../triage";

import { llmPauseToShow } from "./llm-pause";
import { lastSentDigestEnd } from "./repo";

export const DIGEST_ITEM_LIMIT = 100;
export const DIGEST_MAX_PERIOD_MS = 7 * 24 * 3_600_000;
export const FIRST_DIGEST_LOOKBACK_MS = 24 * 3_600_000;
export const WAITING_WINDOW_MS = 7 * 24 * 3_600_000;
const HANDLED_WINDOW_MS = 7 * 24 * 3_600_000;
// The spam review line counts at most one day back, as far as the default range of the Activity page that it links to.
export const SPAM_REVIEW_MAX_PERIOD_MS = 24 * 3_600_000;

const modeSchema = z.enum(mailboxModes);

// The open-loops part of a scheduled digest (F116 stage 18). Absent: no brief, no count line (the digest on demand).
export interface DigestLoops {
  // The first digest of the member's local day: the brief. Later digests of the day get a count line.
  firstOfDay: boolean;
  // `loopConsentOf` of the member: false hides every loop line (D17). The channels job reads it; `reports` may not import `channels`.
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
  testMail: TestMailRule;
  loops?: DigestLoops;
  // The base URL of the panel (`WEB_BASE_URL`): the spam review line links to the Activity list with it. Unset: no link.
  panelBase?: string;
}

// What the digest named of the loops: the queue transaction marks these (`markBriefShown`).
export interface DigestBuilt {
  message: OutMessage;
  shown: DigestShown;
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

// The Activity list filtered to spam (the page reads `category` from its URL): a fixed URL, no mail data (F110 D15).
export function spamReviewUrlOf(base: string | undefined): string | null {
  return base === undefined ? null : `${base.replace(/\/+$/, "")}/activity?category=spam`;
}

// The spam review line: flag `spam_review_line`. Null: flag off. The renderer prints a line only for a count above 0.
async function loadSpamReview(
  db: Db,
  ctx: TenantContext,
  request: DigestRequest,
  mailboxes: readonly DigestMailbox[]
): Promise<DigestSpamReview | null> {
  if (!(await isFeatureOn(db, ctx, "spam_review_line"))) return null;
  const after = new Date(
    Math.max(request.periodStart.getTime(), request.periodEnd.getTime() - SPAM_REVIEW_MAX_PERIOD_MS)
  );
  const { moved, wouldMove } = await countSpamMoves(db, ctx, {
    after,
    until: request.periodEnd,
    shadowMailboxIds: mailboxes.filter((mailbox) => mailbox.mode === "shadow").map((mailbox) => mailbox.id),
  });
  return { moved, wouldMove, url: spamReviewUrlOf(request.panelBase) };
}

const BRIEF_REPLY_LINES = 5;
const BRIEF_DELEGATION_LINES = 5;

function panelLinks(base: string | undefined): BriefRenderOptions["links"] {
  if (base === undefined) return undefined;
  const root = base.replace(/\/+$/, "");
  const links: Partial<Record<(typeof briefSectionKeys)[number], string>> = {
    urgent: `${root}/activity`,
    reply: `${root}/activity`,
    waiting: `${root}/delegations?tab=waiting`,
    promised: `${root}/delegations?tab=promised`,
    stale: `${root}/delegations?tab=waiting`,
  };
  return links;
}

// The "needs you today" part of the digest. Flag `open_loops` off: nothing (today's digest). Reads only; the caller marks `shown`.
// A digest with loop lines locks the loops it names, so the caller must be in a transaction.
async function loadBrief(
  db: Db,
  ctx: TenantContext,
  request: DigestRequest & { loops: DigestLoops },
  parts: {
    timeZone: string;
    mailboxes: readonly DigestMailbox[];
    items: readonly DigestItem[];
    draftMailboxIds: ReadonlySet<string>;
  }
): Promise<DigestBrief | null> {
  if (!(await isFeatureOn(db, ctx, "open_loops"))) return null;
  const { loops } = request;
  const { timeZone, mailboxes, items, draftMailboxIds } = parts;
  const mailboxIds = mailboxes.map((mailbox) => mailbox.id);
  const modes = new Map<string, MailboxMode | "none">(mailboxes.map((mailbox) => [mailbox.id, mailbox.mode]));
  const dayEnd = endOfLocalDay(request.now, timeZone);
  // The lines that this digest shows name loops: it locks them until its transaction ends (`briefLoopsOf`).
  const lock = loops.firstOfDay && loops.loopConsent;
  const [loopBrief, delegations] = await Promise.all([
    loadLoopBrief(db, ctx, mailboxIds, { now: request.now, timeZone, modes, draftMailboxIds, lock }),
    listDelegationsDueBy(db, ctx, mailboxIds, { dueBefore: dayEnd, limit: BRIEF_DELEGATION_LINES }),
  ]);
  if (!loops.firstOfDay) {
    return {
      sections: null,
      loopConsent: loops.loopConsent,
      urgentEmailIds: [],
      openLoops: { waiting: loopBrief.waiting.total + delegations.total, promised: loopBrief.promised.total },
    };
  }
  const urgentRows = items.filter((item) => item.category === "urgent");
  const answered = await answeredEmailIds(
    db,
    ctx,
    urgentRows.map((item) => item.emailId)
  );
  const urgent = urgentRows.filter((item) => !answered.has(item.emailId));
  const reply = await listWaitingOnYou(db, ctx, mailboxIds, { now: request.now, limit: BRIEF_REPLY_LINES });
  const input: BriefInput = {
    now: request.now,
    timeZone,
    consent: loops.loopConsent,
    urgent: {
      rows: urgent.map((item) => ({
        emailId: item.emailId,
        from: item.from,
        subject: item.subject,
        receivedAt: item.receivedAt,
      })),
      total: urgent.length,
    },
    reply: {
      rows: reply.rows.map((row) => ({
        emailId: row.email_id,
        from: row.from_address,
        subject: row.subject,
        receivedAt: row.received_at,
      })),
      total: reply.total,
    },
    waitingLoops: loopBrief.waiting,
    waitingDelegations: {
      rows: delegations.rows.map((row) => ({
        id: row.id,
        delegateName: row.delegate_name,
        subject: row.subject,
        sentAt: row.sent_at,
        dueAt: row.due_at,
        closable: row.status === "overdue",
      })),
      total: delegations.total,
    },
    promised: loopBrief.promised,
    stale: loopBrief.stale,
  };
  const links = panelLinks(loops.panelBase);
  return {
    sections: loopSections(input),
    loopConsent: loops.loopConsent,
    urgentEmailIds: urgent.map((item) => item.emailId),
    openLoops: null,
    ...(links === undefined ? {} : { links }),
  };
}

export async function buildDigest(db: Db, ctx: TenantContext, request: DigestRequest): Promise<DigestBuilt> {
  const organization = await getOrganization(db, ctx);
  if (organization === undefined) throw new HardError("organization not found");

  const texts = textsFor(request.locale);
  const mailboxRows = await listMailboxes(db, ctx);
  const mailboxes: DigestMailbox[] = [];
  // The mailboxes that plan a draft for a tap: the Draft and the Delegate buttons show for their mail only (F116 stage 19).
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

  // F110 stage 16: the keys of the why line go into the items only while the flag is on.
  const whyOn = await isFeatureOn(db, ctx, "why_lines");
  const delegateTags = whyOn ? await listDelegateTags(db, ctx, [...delegateIds]) : new Map<string, string[]>();

  // F116 stage 19: the Delegate button needs the flag and an active delegate (organization), then a mailbox that drafts, a category
  // of the action section and no suspicion (row).
  const delegateOn = await delegateButtonOn(db, ctx);
  // The reasons that `delegateMail` refuses (PD-063), flag or no flag: the button is hidden for the same mails.
  const suspiciousAny = delegateOn
    ? await suspiciousReasonsOf(
        db,
        ctx,
        rows.map((row) => row.email_id)
      )
    : new Map<string, string[]>();

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
    // F110 stage 16: with the flag on, a delegation draft names the competence tags of its delegate.
    wouldDo: describeActions(
      actions.get(row.email_id) ?? [],
      names,
      { stayFolder: row.folder, ...(whyOn ? { delegateTags } : {}) },
      texts
    ),
    undoable: isUndoable(actions.get(row.email_id) ?? [], request.now),
    suspicious: suspicious.get(row.email_id) ?? [],
    ...(delegateOn &&
    draftMailboxIds.has(row.mailbox_id) &&
    delegableCategory(row.category) &&
    (suspiciousAny.get(row.email_id) ?? []).length === 0
      ? { delegable: true }
      : {}),
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
    },
    texts
  );
}
