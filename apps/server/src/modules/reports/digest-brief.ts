import {
  briefSectionKeys,
  DAY_MS,
  loopSections,
  type BriefInput,
  type BriefRenderOptions,
  type DigestBrief,
  type DigestItem,
  type DigestMailbox,
  type DigestSpamReview,
  type MailboxMode,
} from "@ea/core";

import type { Db, TenantContext } from "../../platform/db";
import { countSpamMoves } from "../actions";
import { listDelegationsDueBy } from "../delegation";
import { endOfLocalDay, loadLoopBrief } from "../loops";
import { isFeatureOn } from "../tenancy";
import { answeredEmailIds, listWaitingOnYou } from "../triage";

import type { DigestLoops, DigestRequest } from "./digest";

// The spam review line counts at most one day back, as far as the default range of the Activity page that it links to.
export const SPAM_REVIEW_MAX_PERIOD_MS = DAY_MS;

// The Activity list filtered to spam (the page reads `category` from its URL): a fixed URL, no mail data.
export function spamReviewUrlOf(base: string | undefined): string | null {
  return base === undefined ? null : `${base.replace(/\/+$/, "")}/activity?category=spam`;
}

// The spam review line: flag `spam_review_line`. Null: flag off. The renderer prints a line only for a count above 0.
export async function loadSpamReview(
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
export async function loadBrief(
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
  const loopCounts = { waiting: loopBrief.waiting.total + delegations.total, promised: loopBrief.promised.total };
  if (!loops.firstOfDay) {
    return {
      sections: null,
      loopConsent: loops.loopConsent,
      owner: request.role === "owner",
      urgentEmailIds: [],
      openLoops: loopCounts,
      loopCounts,
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
    // A ⌛ line has one button, Reopen, which only an owner may tap: a member's digest does not show it and does not mark it.
    stale: request.role === "owner" ? loopBrief.stale : { rows: [], total: 0 },
  };
  const links = panelLinks(loops.panelBase);
  return {
    sections: loopSections(input),
    loopConsent: loops.loopConsent,
    owner: request.role === "owner",
    urgentEmailIds: urgent.map((item) => item.emailId),
    openLoops: null,
    loopCounts,
    ...(links === undefined ? {} : { links }),
  };
}
