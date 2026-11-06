import type { Category, MailboxMode } from "../triage/categories";

import { categoryTag } from "./labels";
import { formatClock, formatDay, localDateTime, localToInstant } from "./local-time";
import { MESSAGE_MAX_CHARS, type OutButton, type OutMessage } from "./message";
import { feedbackButtons } from "./notices";
import { cleanSubject, cutText, senderLabel } from "./text";

export const DIGEST_MAX_LINES = 15;

const SYNC_LATE_MS = 30 * 60_000;
const ACTION_CATEGORIES: readonly Category[] = ["urgent", "needs_reply", "delegation", "unsure"];
const OTHER_CATEGORIES: readonly Category[] = ["info", "notification", "spam"];
const CATEGORY_ORDER: readonly Category[] = [...ACTION_CATEGORIES, ...OTHER_CATEGORIES];
const MORE_NAMES: Record<Category, string> = {
  urgent: "urgent",
  needs_reply: "reply",
  delegation: "delegate",
  unsure: "unsure",
  info: "info",
  notification: "notification",
  spam: "spam",
};

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
  aiText: string | null;
  wouldDo: string;
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
  skippedTooOld: number;
  waiting: number;
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

function headerLine(input: DigestInput): string {
  const { now, timeZone, slot } = input;
  if (input.kind === "scheduled" && slot !== null) {
    const day = formatDay(localToInstant(slot.date, slot.time, timeZone), timeZone);
    return `📬 Digest ${slot.time} · ${day}${slot.late ? " (late)" : ""}`;
  }
  return `📬 Digest now · ${formatDay(now, timeZone)} ${localDateTime(now, timeZone).time}`;
}

function mailboxLine(input: DigestInput, mailbox: DigestMailbox): string {
  const { now, timeZone } = input;
  const clock = (at: Date): string => formatClock(at, timeZone, now);
  const sync = (at: Date | null): string => (at === null ? "never" : clock(at));
  const suffix = input.mailboxes.length > 1 ? ` · ${cutText(mailbox.address, 40)}` : "";
  const { lastSyncedAt } = mailbox;
  if (mailbox.status === "paused") {
    return `⏸ Paused since ${clock(mailbox.statusChangedAt)} · last sync ${sync(lastSyncedAt)}${suffix}`;
  }
  if (mailbox.status === "auth_error") {
    return `❌ Login error since ${clock(mailbox.statusChangedAt)} · last sync ${sync(lastSyncedAt)}${suffix}`;
  }
  if (lastSyncedAt === null) return `⚠️ Last sync: never${suffix}`;
  if (now.getTime() - lastSyncedAt.getTime() > SYNC_LATE_MS)
    return `⚠️ Last sync ${clock(lastSyncedAt)} (late)${suffix}`;
  return `🔄 Last sync ${clock(lastSyncedAt)}${suffix}`;
}

function itemBlock(n: number, item: DigestItem): string[] {
  const lines = [
    `${n}. ${categoryTag(item.category)} · ${senderLabel(item.from)}${item.synthetic ? " · 🧪 test" : ""}`,
    cleanSubject(item.subject),
  ];
  if (item.aiText !== null && item.aiText !== "") lines.push(`💬 ${cutText(item.aiText, 120)}`);
  lines.push(`→ ${item.wouldDo}`);
  return lines;
}

function renderListed(input: DigestInput, listed: readonly DigestItem[]): OutMessage {
  const { counts } = input;
  const total = sumCounts(counts, CATEGORY_ORDER);
  const since = formatClock(input.periodStart, input.timeZone, input.now);
  const lines = [
    headerLine(input),
    total > 0
      ? `Since ${since}: ${total} ${total === 1 ? "mail" : "mails"}, ${sumCounts(counts, ACTION_CATEGORIES)} need action`
      : `No new mail since ${since}.`,
  ];
  if (input.mailboxes.length === 0) lines.push("Last sync: no mailbox connected");
  for (const mailbox of input.mailboxes) lines.push(mailboxLine(input, mailbox));

  const sections = [
    { title: "NEEDS ACTION", categories: ACTION_CATEGORIES },
    { title: "OTHER MAIL", categories: OTHER_CATEGORIES },
  ];
  listed.forEach((item, index) => {
    const section = sections.find((s) => s.categories.includes(item.category));
    const first = listed.findIndex((other) => section?.categories.includes(other.category));
    if (section !== undefined && first === index) {
      lines.push("", `${section.title} · ${sumCounts(counts, section.categories)}`);
    } else {
      lines.push("");
    }
    lines.push(...itemBlock(index + 1, item));
  });

  const parts = CATEGORY_ORDER.flatMap((category) => {
    const rest = Math.max(0, (counts[category] ?? 0) - listed.filter((item) => item.category === category).length);
    return rest > 0 ? [{ rest, name: MORE_NAMES[category] }] : [];
  });
  const footer: string[] = [];
  const more = parts.reduce((sum, part) => sum + part.rest, 0);
  if (more > 0) footer.push(`+${more} more: ${parts.map((part) => `${part.rest} ${part.name}`).join(", ")}`);
  if (input.skippedTooOld > 0) footer.push(`📭 Not processed (older than 7 days): ${input.skippedTooOld}`);
  if (input.waiting > 0) footer.push(`⏳ Waiting for triage: ${input.waiting}`);
  if (total > 0 && input.mailboxes.length > 0 && input.mailboxes.every((mailbox) => mailbox.mode === "shadow")) {
    footer.push("Shadow mode: the system changed nothing in your mailbox.");
  }
  if (footer.length > 0) lines.push("", ...footer);

  const buttons: OutButton[][] = [];
  listed.forEach((item, index) => {
    const n = index + 1;
    const own = feedbackButtons(item.emailId, item.category, { right: `✅ ${n}`, edit: `✏️ ${n}` });
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

export function renderDigest(input: DigestInput): OutMessage {
  const listed = sortItems(input.items).slice(0, input.maxLines ?? DIGEST_MAX_LINES);
  for (;;) {
    const message = renderListed(input, listed);
    if (message.text.length <= MESSAGE_MAX_CHARS) return message;
    if (listed.length === 0) return { text: cutToLimit(message.text), buttons: [] };
    listed.pop();
  }
}
