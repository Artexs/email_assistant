import {
  briefKeyboard,
  dropLastLine,
  renderBriefLines,
  shownIds,
  type BriefRenderOptions,
  type BriefSections,
} from "../loops/brief";
import type { CoreTexts } from "../texts";
import { minimalTexts } from "../texts/minimal";
import { MINUTE_MS } from "../time";
import type { Category, MailboxMode } from "../triage/categories";
import type { SenderRuleKind } from "../triage/rules";
import type { SuspiciousReason } from "../triage/suspicious";
import type { MailboxStatus } from "../web/mailboxes";

import { attachmentLine, type AttachmentLineInput } from "./attachment-line";
import { encodeCallback } from "./callback";
import { categoryTag } from "./labels";
import { llmPauseLine, type LlmPause } from "./llm-pause";
import { formatClock, formatDay, localDateTime, localToInstant } from "./local-time";
import { MESSAGE_MAX_CHARS, type OutButton, type OutMessage } from "./message";
import { feedbackButtons, suspiciousLine } from "./notices";
import { cleanSubject, cutText, senderLabel } from "./text";
import { rateText } from "./weekly";
import { aiLine, whySuffix } from "./why-line";

export const DIGEST_MAX_LINES = 15;
// Telegram allows at most 8 buttons in one keyboard row.
const MAX_ROW_BUTTONS = 8;

const SYNC_LATE_MS = 30 * MINUTE_MS;
const ACTION_CATEGORIES: readonly Category[] = ["urgent", "needs_reply", "delegation", "unsure"];
const OTHER_CATEGORIES: readonly Category[] = ["info", "notification", "spam"];
const CATEGORY_ORDER: readonly Category[] = [...ACTION_CATEGORIES, ...OTHER_CATEGORIES];

export interface DigestMailbox {
  id: string;
  address: string;
  status: MailboxStatus;
  lastSyncedAt: Date | null;
  statusChangedAt: Date;
  mode: MailboxMode | "none";
}

// No body field: the digest never gets mail bodies (ADR 0005).
export interface DigestItem {
  emailId: string;
  category: Category;
  from: string | null;
  subject: string | null;
  receivedAt: Date;
  synthetic: boolean;
  folderTag: string | null; // the source folder when it is not INBOX
  aiText: string | null;
  wouldDo: string;
  undoable: boolean;
  // Set only while the flag `suspicious_mail` is on. Absent reads as none.
  suspicious?: readonly SuspiciousReason[];
  // Set only while the flag `attachment_line` is on and the mail has an attachment to show.
  attachments?: AttachmentLineInput;
  // A draft exists or is planned for the mail (an original `create_draft` action). A flagged delegation shows "no draft" only without one.
  hasDraft?: boolean;
  // The Delegate button shows on this row: flag `delegate_button` on, an active delegate, the mailbox in `assist`
  // with drafts on, a category of the action section and no suspicion. Set by the reader; absent reads as no button.
  delegable?: boolean;
  // The Draft reply button shows on this row: a reply draft can be made for the mail now and none is open. Set by the reader.
  draftable?: boolean;
  // Set only while the flag `why_lines` is on. Absent reads as no mark: the item renders as before.
  confidence?: number | null;
  rule?: SenderRuleKind | null;
}

// The spam review line (flag `spam_review_line`): counts of mails that went to the spam folder since the last digest.
// `moved`: applied moves. `wouldMove`: logged moves of a shadow mailbox. `url`: the filtered Activity list; null: the panel text.
// Counts and a fixed URL only. Absent: no line.
export interface DigestSpamReview {
  moved: number;
  wouldMove: number;
  url: string | null;
}

export interface DigestHandled {
  handled: number;
  wouldHandle: number;
  triaged: number;
  shadowOnly: boolean;
}

// The open-loops part of a digest. Absent: today's digest, byte for byte.
export interface DigestBrief {
  // The first digest of the local day: the "needs you today" block. Null: a later digest.
  sections: BriefSections | null;
  // `loopConsentOf` of the member: false gives no loop button. The sections already hold counts only then.
  loopConsent: boolean;
  // The member is an owner: Draft, Drop and Reopen are owner only, so a member's keyboard has none of them.
  owner: boolean;
  // The mails that the 🔴 lines show: they leave the normal list.
  urgentEmailIds: readonly string[];
  links?: BriefRenderOptions["links"];
  // The count line of a later digest: waiting lines and promises due. Null: no line.
  openLoops: { waiting: number; promised: number } | null;
  // The same two counts in every digest of a brief, the first of the day too (loops and the delegations due today, with or without the
  // consent of the member): the `minimal` digest prints them. Absent: `openLoops`.
  loopCounts?: { waiting: number; promised: number };
}

export interface DigestInput {
  kind: "scheduled" | "on_demand";
  now: Date;
  timeZone: string;
  slot: { date: string; time: string; late: boolean } | null;
  periodStart: Date;
  mailboxes: readonly DigestMailbox[];
  counts: Partial<Record<Category, number>>;
  items: readonly DigestItem[];
  // `email.skipped` rows by `reason_code`: `too_old` only.
  skippedTooOld: number;
  // `reason_code` `suspended_backlog`: mail of before an account pause.
  skippedBacklog: number;
  waiting: number;
  delegations?: { open: number; overdue: number };
  // The reply drafts that wait for a review: one footer line with the count, no button. 0 or absent: no line.
  repliesReady?: number;
  // The LLM pause (flag `llm_pause_line`). Set: its line is the first line of the footer.
  llmPause?: LlmPause;
  // The handled share of the last 7 days: set only while `handled_share` is on.
  handled?: DigestHandled;
  spamReview?: DigestSpamReview;
  brief?: DigestBrief;
  maxLines?: number;
}

// What a rendered digest named: the loops of the brief that stayed in the text after the 4096 cut.
export interface DigestShown {
  surfaced: string[];
  stale: string[];
  // The line number (in the lines of the text) of each loop or delegation that a brief line names: the tap on its buttons edits
  // that line. A line of the 4096 cut that dropped is not here.
  lineOf: Record<string, number>;
}

// The facts of a digest that the `minimal` Telegram render prints: counts and the clock, never a mail or a mailbox address.
export interface DigestMinimalFacts {
  // The instant of the header: the slot time of a scheduled digest, else the time of the build.
  at: Date;
  scheduled: boolean;
  late: boolean;
  timeZone: string;
  action: Record<"urgent" | "needs_reply" | "delegation" | "unsure", number>;
  other: Record<"info" | "notification" | "spam", number>;
  // Mailboxes that are paused, have a login error, a blocked host, never synced or synced late.
  mailboxProblems: number;
  // The open loops that the brief counts; null when the digest has no brief.
  openLoops: { waiting: number; promised: number } | null;
}

export interface RenderedDigest {
  message: OutMessage;
  shown: DigestShown;
  minimal: DigestMinimalFacts;
}

function sumCounts(counts: Partial<Record<Category, number>>, list: readonly Category[]): number {
  return list.reduce((sum, category) => sum + (counts[category] ?? 0), 0);
}

function sortItems(items: readonly DigestItem[]): DigestItem[] {
  return [...items].sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
      b.receivedAt.getTime() - a.receivedAt.getTime() ||
      (a.emailId < b.emailId ? -1 : a.emailId > b.emailId ? 1 : 0)
  );
}

function headerLine(input: DigestInput, texts: CoreTexts): string {
  const { now, timeZone, slot } = input;
  if (input.kind === "scheduled" && slot !== null) {
    const day = formatDay(localToInstant(slot.date, slot.time, timeZone), timeZone, texts.locale);
    return texts.digest.header(slot.time, day, slot.late);
  }
  return texts.digest.headerNow(formatDay(now, timeZone, texts.locale), localDateTime(now, timeZone).time);
}

// The mailbox lines that are not the plain "Last sync" line.
function hasProblem(mailbox: DigestMailbox, now: Date): boolean {
  if (mailbox.status !== "active") return true;
  return mailbox.lastSyncedAt === null || now.getTime() - mailbox.lastSyncedAt.getTime() > SYNC_LATE_MS;
}

export function digestMinimalFacts(input: DigestInput): DigestMinimalFacts {
  const { timeZone, counts } = input;
  const slot = input.kind === "scheduled" ? input.slot : null;
  const openLoops = input.brief === undefined ? null : (input.brief.loopCounts ?? input.brief.openLoops);
  const countOf = (category: Category): number => counts[category] ?? 0;
  return {
    at: slot === null ? input.now : localToInstant(slot.date, slot.time, timeZone),
    scheduled: slot !== null,
    late: slot !== null && slot.late,
    timeZone,
    action: {
      urgent: countOf("urgent"),
      needs_reply: countOf("needs_reply"),
      delegation: countOf("delegation"),
      unsure: countOf("unsure"),
    },
    other: { info: countOf("info"), notification: countOf("notification"), spam: countOf("spam") },
    mailboxProblems: input.mailboxes.filter((mailbox) => hasProblem(mailbox, input.now)).length,
    openLoops,
  };
}

// The digest as text for a member who gets `minimal`: the header (the clock and the day), the counts of the two sections, the number
// of mailboxes with a problem, the open loops, and the link to the panel (`link`: the URL line, or the "Open the panel" line).
export function renderDigestMinimal(facts: DigestMinimalFacts, texts: CoreTexts, link: string): OutMessage {
  const { at, timeZone } = facts;
  const day = formatDay(at, timeZone, texts.locale);
  const lines = [
    facts.scheduled
      ? texts.digest.header(localDateTime(at, timeZone).time, day, facts.late)
      : texts.digest.headerNow(day, localDateTime(at, timeZone).time),
  ];
  const section = (title: string, counts: Partial<Record<Category, number>>): string => {
    const parts = CATEGORY_ORDER.flatMap((category) => {
      const count = counts[category] ?? 0;
      return count > 0 ? [`${count} ${texts.digest.moreName[category](count)}`] : [];
    });
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    return parts.length === 0 ? `${title} · ${total}` : `${title} · ${total}: ${parts.join(", ")}`;
  };
  lines.push(section(texts.digest.actionTitle, facts.action), section(texts.digest.otherTitle, facts.other));
  if (facts.mailboxProblems > 0) lines.push(minimalTexts(texts.locale).mailboxProblems(facts.mailboxProblems));
  const loops = facts.openLoops;
  if (loops !== null && loops.waiting + loops.promised > 0)
    lines.push(texts.brief.openLoops(loops.waiting, loops.promised));
  lines.push(link);
  return { text: lines.join("\n"), buttons: [] };
}

function mailboxLine(input: DigestInput, mailbox: DigestMailbox, texts: CoreTexts): string {
  const { now, timeZone } = input;
  const clock = (at: Date): string => formatClock(at, timeZone, now, texts.locale);
  const sync = (at: Date | null): string => (at === null ? texts.digest.never : clock(at));
  const suffix = input.mailboxes.length > 1 ? ` · ${cutText(mailbox.address, 40)}` : "";
  const { lastSyncedAt } = mailbox;
  switch (mailbox.status) {
    case "paused":
      return `${texts.digest.mailbox.paused(clock(mailbox.statusChangedAt), sync(lastSyncedAt))}${suffix}`;
    case "auth_error":
      return `${texts.digest.mailbox.authError(clock(mailbox.statusChangedAt), sync(lastSyncedAt))}${suffix}`;
    case "host_blocked":
      return `${texts.digest.mailbox.hostBlocked(clock(mailbox.statusChangedAt), sync(lastSyncedAt))}${suffix}`;
    case "active": {
      if (lastSyncedAt === null) return `${texts.digest.mailbox.neverSynced}${suffix}`;
      if (now.getTime() - lastSyncedAt.getTime() > SYNC_LATE_MS) {
        return `${texts.digest.mailbox.late(clock(lastSyncedAt))}${suffix}`;
      }
      return `${texts.digest.mailbox.ok(clock(lastSyncedAt))}${suffix}`;
    }
  }
}

function itemBlock(n: number, item: DigestItem, texts: CoreTexts): string[] {
  const lines = [
    `${n}. ${categoryTag(item.category, texts)} · ${senderLabel(item.from, texts)}${item.folderTag === null ? "" : ` · 📁 ${cutText(item.folderTag, 30)}`}${item.synthetic ? ` · ${texts.common.test}` : ""}`,
    cleanSubject(item.subject, texts),
  ];
  const attachments = item.attachments === undefined ? null : attachmentLine(item.attachments, texts.locale);
  if (attachments !== null) lines.push(attachments);
  const ai = aiLine(item.aiText, whySuffix(item, texts), 120);
  if (ai !== null) lines.push(ai);
  const warning = suspiciousLine(item.suspicious, texts);
  if (warning !== null) lines.push(warning);
  // A flagged delegation mail gets no draft: that line replaces the "would do" line.
  lines.push(
    `→ ${warning !== null && item.category === "delegation" && item.hasDraft !== true ? texts.suspicious.noDraft : item.wouldDo}`
  );
  return lines;
}

// The urgent mails that the 🔴 lines show leave the normal list: the "+n more" count must not count them again.
function removedByBrief(input: DigestInput): Partial<Record<Category, number>> {
  const ids = new Set(input.brief?.urgentEmailIds ?? []);
  const removed: Partial<Record<Category, number>> = {};
  for (const item of input.items) {
    if (ids.has(item.emailId)) removed[item.category] = (removed[item.category] ?? 0) + 1;
  }
  return removed;
}

function briefOptions(input: DigestInput): BriefRenderOptions {
  return {
    timeZone: input.timeZone,
    now: input.now,
    ...(input.brief?.links === undefined ? {} : { links: input.brief.links }),
  };
}

function renderListed(
  input: DigestInput,
  listed: readonly DigestItem[],
  briefSections: BriefSections | null,
  texts: CoreTexts,
  withSpamReview: boolean
): { message: OutMessage; lineOf: Record<string, number> } {
  const { counts } = input;
  const removed = removedByBrief(input);
  const total = sumCounts(counts, CATEGORY_ORDER);
  const since = formatClock(input.periodStart, input.timeZone, input.now, texts.locale);
  const lines = [
    headerLine(input, texts),
    total > 0 ? texts.digest.since(since, total, sumCounts(counts, ACTION_CATEGORIES)) : texts.digest.noMail(since),
  ];
  const rendered =
    briefSections === null ? { lines: [], ids: [] } : renderBriefLines(briefSections, texts, briefOptions(input));
  const block = rendered.lines;
  const lineOf: Record<string, number> = {};
  if (block.length > 0) {
    lines.splice(1, 0, "", ...block, "");
    // The brief block starts at line 2 of the text (after the header and one empty line).
    rendered.ids.forEach((id, index) => {
      if (id !== null) lineOf[id] = 2 + index;
    });
  }
  if (input.mailboxes.length === 0) lines.push(texts.digest.noMailbox);
  for (const mailbox of input.mailboxes) lines.push(mailboxLine(input, mailbox, texts));

  const sections = [
    { title: texts.digest.actionTitle, categories: ACTION_CATEGORIES },
    { title: texts.digest.otherTitle, categories: OTHER_CATEGORIES },
  ];
  listed.forEach((item, index) => {
    const section = sections.find((s) => s.categories.includes(item.category));
    const first = listed.findIndex((other) => section?.categories.includes(other.category));
    if (section !== undefined && first === index) {
      lines.push("", `${section.title} · ${sumCounts(counts, section.categories)}`);
    } else {
      lines.push("");
    }
    lines.push(...itemBlock(index + 1, item, texts));
  });

  const parts = CATEGORY_ORDER.flatMap((category) => {
    const rest = Math.max(
      0,
      (counts[category] ?? 0) - listed.filter((item) => item.category === category).length - (removed[category] ?? 0)
    );
    return rest > 0 ? [{ rest, name: texts.digest.moreName[category](rest) }] : [];
  });
  const footer: string[] = [];
  if (input.llmPause !== undefined) footer.push(llmPauseLine(input.llmPause, input.timeZone, input.now, texts));
  const more = parts.reduce((sum, part) => sum + part.rest, 0);
  if (more > 0) footer.push(texts.digest.more(more, parts.map((part) => `${part.rest} ${part.name}`).join(", ")));
  if (input.skippedTooOld > 0) footer.push(texts.digest.notProcessedOld(input.skippedTooOld));
  if (input.skippedBacklog > 0) footer.push(texts.digest.notProcessedBacklog(input.skippedBacklog));
  if (input.waiting > 0) footer.push(texts.digest.waiting(input.waiting));
  // The footer line of the delegations goes only when a ⏳ line of the first digest of the day names a delegation:
  // else a delegation due later, or a member without consent, would see no delegation at all.
  const delegationShown = input.brief?.sections?.waiting.lines.some((line) => "delegation" in line) === true;
  if (!delegationShown && input.delegations !== undefined && input.delegations.open + input.delegations.overdue > 0) {
    footer.push(texts.digest.delegations(input.delegations.open, input.delegations.overdue));
  }
  if (input.repliesReady !== undefined && input.repliesReady > 0) {
    footer.push(texts.digest.repliesReady(input.repliesReady));
  }
  const openLoops = input.brief?.openLoops ?? null;
  if (openLoops !== null && openLoops.waiting + openLoops.promised > 0) {
    footer.push(texts.brief.openLoops(openLoops.waiting, openLoops.promised));
  }
  if (total > 0 && input.mailboxes.length > 0 && input.mailboxes.every((mailbox) => mailbox.mode === "shadow")) {
    footer.push(texts.digest.shadow);
  }
  // The spam review lines come right after the shadow line; the handled share is the last footer line.
  if (withSpamReview && input.spamReview !== undefined) {
    const { moved, wouldMove, url } = input.spamReview;
    if (moved > 0) footer.push(texts.digest.spamReview.moved(moved, url));
    if (wouldMove > 0) footer.push(texts.digest.spamReview.would(wouldMove, url));
  }
  if (input.handled !== undefined && input.handled.triaged > 0) {
    const { handled, wouldHandle, triaged, shadowOnly } = input.handled;
    if (handled > 0 || !shadowOnly) footer.push(texts.digest.handled(rateText(handled, triaged, texts.common.of)));
    else footer.push(texts.digest.wouldHandle(rateText(wouldHandle, triaged, texts.common.of)));
  }
  if (footer.length > 0) lines.push("", ...footer);

  // The loop rows come first, as their lines do; then two mail rows share one keyboard line (at most 8 buttons).
  const buttons: OutButton[][] =
    briefSections === null || input.brief === undefined
      ? []
      : briefKeyboard(briefSections, texts, { consent: input.brief.loopConsent, owner: input.brief.owner });
  const mailRows: OutButton[][] = [];
  listed.forEach((item, index) => {
    const n = index + 1;
    const own = [
      ...feedbackButtons(item.emailId, item.category, {
        right: `✅ ${n}`,
        edit: `✏️ ${n}`,
        ...(item.undoable ? { undo: `↩️ ${n}` } : {}),
      }),
      ...(item.delegable === true
        ? [
            {
              text: texts.loopTaps.buttons.delegateRow(n),
              data: encodeCallback({ kind: "delegate_open", emailId: item.emailId }),
            },
          ]
        : []),
      ...(item.draftable === true
        ? [
            {
              text: texts.notices.replyDrafts.draftRow(n),
              data: encodeCallback({ kind: "reply_draft", emailId: item.emailId }),
            },
          ]
        : []),
    ];
    // Two rows share one keyboard line while that stays within the 8 buttons of Telegram; else this row starts a line.
    const last = mailRows[mailRows.length - 1];
    if (index % 2 === 0 || last === undefined || last.length + own.length > MAX_ROW_BUTTONS) mailRows.push(own);
    else last.push(...own);
  });
  buttons.push(...mailRows);
  return { message: { text: lines.join("\n"), buttons }, lineOf };
}

function cutToLimit(text: string): string {
  let end = MESSAGE_MAX_CHARS - 1;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}…`;
}

// The message and the loops of the brief that its text names (a line that the 4096 cut dropped is not named).
export function renderDigestWithBrief(input: DigestInput, texts: CoreTexts): RenderedDigest {
  const minimal = digestMinimalFacts(input);
  const urgentIds = new Set(input.brief?.urgentEmailIds ?? []);
  const listed = sortItems(input.items.filter((item) => !urgentIds.has(item.emailId))).slice(
    0,
    input.maxLines ?? DIGEST_MAX_LINES
  );
  let sections = input.brief?.sections ?? null;
  // The spam review lines go before any item row when the text is too long.
  let withSpamReview = true;
  for (;;) {
    const { message, lineOf } = renderListed(input, listed, sections, texts, withSpamReview);
    if (message.text.length <= MESSAGE_MAX_CHARS) {
      return {
        message,
        shown: sections === null ? { surfaced: [], stale: [], lineOf } : { ...shownIds(sections), lineOf },
        minimal,
      };
    }
    // The spam review lines go first, then the normal rows, then the lines of the brief from the bottom section up.
    if (withSpamReview && input.spamReview !== undefined) {
      withSpamReview = false;
      continue;
    }
    if (listed.length > 0) {
      listed.pop();
      continue;
    }
    const shorter = sections === null ? null : dropLastLine(sections);
    if (shorter !== null) {
      sections = shorter;
      continue;
    }
    return {
      message: { text: cutToLimit(message.text), buttons: [] },
      shown: { surfaced: [], stale: [], lineOf: {} },
      minimal,
    };
  }
}
