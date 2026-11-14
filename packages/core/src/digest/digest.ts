import type { CoreTexts } from "../texts";
import type { Category, MailboxMode } from "../triage/categories";

import { categoryTag } from "./labels";
import { llmPauseLine, type LlmPause } from "./llm-pause";
import { formatClock, formatDay, localDateTime, localToInstant } from "./local-time";
import { MESSAGE_MAX_CHARS, type OutButton, type OutMessage } from "./message";
import { feedbackButtons } from "./notices";
import { cleanSubject, cutText, senderLabel } from "./text";

export const DIGEST_MAX_LINES = 15;

const SYNC_LATE_MS = 30 * 60_000;
const ACTION_CATEGORIES: readonly Category[] = ["urgent", "needs_reply", "delegation", "unsure"];
const OTHER_CATEGORIES: readonly Category[] = ["info", "notification", "spam"];
const CATEGORY_ORDER: readonly Category[] = [...ACTION_CATEGORIES, ...OTHER_CATEGORIES];

export interface DigestMailbox {
  id: string;
  address: string;
  status: "active" | "auth_error" | "paused";
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
  // The LLM pause (F100 stage 07, flag `llm_pause_line`). Set: its line is the first line of the footer.
  llmPause?: LlmPause;
  maxLines?: number;
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

function mailboxLine(input: DigestInput, mailbox: DigestMailbox, texts: CoreTexts): string {
  const { now, timeZone } = input;
  const clock = (at: Date): string => formatClock(at, timeZone, now, texts.locale);
  const sync = (at: Date | null): string => (at === null ? texts.digest.never : clock(at));
  const suffix = input.mailboxes.length > 1 ? ` · ${cutText(mailbox.address, 40)}` : "";
  const { lastSyncedAt } = mailbox;
  if (mailbox.status === "paused") {
    return `${texts.digest.mailbox.paused(clock(mailbox.statusChangedAt), sync(lastSyncedAt))}${suffix}`;
  }
  if (mailbox.status === "auth_error") {
    return `${texts.digest.mailbox.authError(clock(mailbox.statusChangedAt), sync(lastSyncedAt))}${suffix}`;
  }
  if (lastSyncedAt === null) return `${texts.digest.mailbox.neverSynced}${suffix}`;
  if (now.getTime() - lastSyncedAt.getTime() > SYNC_LATE_MS) {
    return `${texts.digest.mailbox.late(clock(lastSyncedAt))}${suffix}`;
  }
  return `${texts.digest.mailbox.ok(clock(lastSyncedAt))}${suffix}`;
}

function itemBlock(n: number, item: DigestItem, texts: CoreTexts): string[] {
  const lines = [
    `${n}. ${categoryTag(item.category, texts)} · ${senderLabel(item.from, texts)}${item.folderTag === null ? "" : ` · 📁 ${cutText(item.folderTag, 30)}`}${item.synthetic ? ` · ${texts.common.test}` : ""}`,
    cleanSubject(item.subject, texts),
  ];
  if (item.aiText !== null && item.aiText !== "") lines.push(`💬 ${cutText(item.aiText, 120)}`);
  lines.push(`→ ${item.wouldDo}`);
  return lines;
}

function renderListed(input: DigestInput, listed: readonly DigestItem[], texts: CoreTexts): OutMessage {
  const { counts } = input;
  const total = sumCounts(counts, CATEGORY_ORDER);
  const since = formatClock(input.periodStart, input.timeZone, input.now, texts.locale);
  const lines = [
    headerLine(input, texts),
    total > 0 ? texts.digest.since(since, total, sumCounts(counts, ACTION_CATEGORIES)) : texts.digest.noMail(since),
  ];
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
    const rest = Math.max(0, (counts[category] ?? 0) - listed.filter((item) => item.category === category).length);
    return rest > 0 ? [{ rest, name: texts.digest.moreName[category](rest) }] : [];
  });
  const footer: string[] = [];
  if (input.llmPause !== undefined) footer.push(llmPauseLine(input.llmPause, input.timeZone, input.now, texts));
  const more = parts.reduce((sum, part) => sum + part.rest, 0);
  if (more > 0) footer.push(texts.digest.more(more, parts.map((part) => `${part.rest} ${part.name}`).join(", ")));
  if (input.skippedTooOld > 0) footer.push(texts.digest.notProcessedOld(input.skippedTooOld));
  if (input.skippedBacklog > 0) footer.push(texts.digest.notProcessedBacklog(input.skippedBacklog));
  if (input.waiting > 0) footer.push(texts.digest.waiting(input.waiting));
  if (input.delegations !== undefined && input.delegations.open + input.delegations.overdue > 0) {
    footer.push(texts.digest.delegations(input.delegations.open, input.delegations.overdue));
  }
  if (total > 0 && input.mailboxes.length > 0 && input.mailboxes.every((mailbox) => mailbox.mode === "shadow")) {
    footer.push(texts.digest.shadow);
  }
  if (footer.length > 0) lines.push("", ...footer);

  const buttons: OutButton[][] = [];
  listed.forEach((item, index) => {
    const n = index + 1;
    const own = feedbackButtons(item.emailId, item.category, {
      right: `✅ ${n}`,
      edit: `✏️ ${n}`,
      ...(item.undoable ? { undo: `↩️ ${n}` } : {}),
    });
    if (index % 2 === 0) buttons.push(own);
    else buttons[buttons.length - 1]?.push(...own);
  });
  return { text: lines.join("\n"), buttons };
}

function cutToLimit(text: string): string {
  let end = MESSAGE_MAX_CHARS - 1;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}…`;
}

export function renderDigest(input: DigestInput, texts: CoreTexts): OutMessage {
  const listed = sortItems(input.items).slice(0, input.maxLines ?? DIGEST_MAX_LINES);
  for (;;) {
    const message = renderListed(input, listed, texts);
    if (message.text.length <= MESSAGE_MAX_CHARS) return message;
    if (listed.length === 0) return { text: cutToLimit(message.text), buttons: [] };
    listed.pop();
  }
}
