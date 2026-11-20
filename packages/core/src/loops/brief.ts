// The "needs you today" brief of the first digest of the day. Pure: no I/O. `loopSections` picks and
// caps the lines, `renderBrief` writes them in the language of the user. The digest renderer cuts the block with `dropLastLine`
// when a message is over 4096 characters (loop lines first from the bottom section up) and reads `shownIds` for what stayed.
import { encodeCallback } from "../digest/callback";
import { formatDayNumeric } from "../digest/local-time";
import type { OutButton } from "../digest/message";
import { cleanSubject, cutText, senderLabel, withoutEscapeRemains } from "../digest/text";
import type { CoreTexts } from "../texts";
import { HOUR_MS } from "../time";
import { markUntrustedText } from "../triage/untrusted-text";

export const BRIEF_SECTION_LINES = 5;

// The user may move a loop this many times (`MAX_LATER` of the server): the Later button goes after the last one.
export const MAX_LATER_TAPS = 3;

export const briefSectionKeys = ["urgent", "reply", "waiting", "promised", "stale"] as const;
export type BriefSectionKey = (typeof briefSectionKeys)[number];

// An incoming mail that waits for the user: urgent in the digest window, or `needs_reply` of the last 14 days.
export interface BriefMail {
  emailId: string;
  from: string | null;
  subject: string | null;
  receivedAt: Date;
}

export interface BriefLoop {
  id: string;
  kind: "waiting" | "delegated" | "promised";
  counterpart: string | null;
  subject: string | null;
  text: string | null;
  dueAt: Date;
  // The start of the wait: the Sent mail that the answer is missing for.
  sinceAt: Date;
  autoReplyOnly: boolean;
  // The usual reply time of the counterpart in days; null unless the due date comes from it. Only a count.
  usualReplyDays: number | null;
  // How many times the user moved the due date (0 to 3): at 3 the Later button goes.
  laterCount: number;
  // The Draft button shows: the mailbox is in `assist` with drafts on, no follow-up waits for a tap and fewer than two were sent.
  canDraft: boolean;
  // `would_draft`: shadow mode, the follow-up would be drafted. `approval`: a follow-up waits for the owner's tap.
  followUp: "would_draft" | "approval" | null;
}

// An open delegation (`sent`, `overdue`) with a due date by the end of the day.
export interface BriefDelegation {
  id: string;
  delegateName: string;
  subject: string | null;
  sentAt: Date;
  dueAt: Date;
  // The Done button shows: only an `overdue` or `answered` delegation closes (`closeDelegation`); a `sent` one answers "not answered yet".
  closable: boolean;
}

export interface BriefStale {
  id: string;
  subject: string | null;
}

// `rows` may be fewer than `total`: the reader cuts the rows and counts all.
export interface BriefPart<T> {
  rows: readonly T[];
  total: number;
}

export interface BriefInput {
  now: Date;
  timeZone: string;
  // `loopConsentOf` of the user. False: the lines of ⏳, 🤝 and ⌛ become counts.
  consent: boolean;
  urgent: BriefPart<BriefMail>;
  reply: BriefPart<BriefMail>;
  waitingLoops: BriefPart<BriefLoop>;
  waitingDelegations: BriefPart<BriefDelegation>;
  promised: BriefPart<BriefLoop>;
  stale: BriefPart<BriefStale>;
}

export type BriefLine =
  | { section: "urgent" | "reply"; mail: BriefMail }
  | { section: "waiting"; loop: BriefLoop }
  | { section: "waiting"; delegation: BriefDelegation }
  | { section: "promised"; loop: BriefLoop }
  | { section: "stale"; stale: BriefStale };

export interface BriefSection {
  lines: BriefLine[];
  // Lines that the cap or the 4096 cut left out: "+n more in the panel".
  more: number;
  // Lines that the consent hides: one count line, no mail data.
  hidden: number;
}

export type BriefSections = Record<BriefSectionKey, BriefSection>;

function oldestFirst<T>(rows: readonly T[], at: (row: T) => Date, id: (row: T) => string): T[] {
  return [...rows].sort((a, b) => at(a).getTime() - at(b).getTime() || (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0));
}

function section<T>(part: BriefPart<T>, line: (row: T) => BriefLine, consent: boolean, order: T[]): BriefSection {
  const total = Math.max(part.total, part.rows.length);
  if (!consent) return { lines: [], more: 0, hidden: total };
  const lines = order.slice(0, BRIEF_SECTION_LINES).map(line);
  return { lines, more: total - lines.length, hidden: 0 };
}

export function loopSections(input: BriefInput): BriefSections {
  const { consent } = input;
  const mailLine = (key: "urgent" | "reply") => (mail: BriefMail) => ({ section: key, mail }) as const;
  const mails = (part: BriefPart<BriefMail>) =>
    oldestFirst(
      part.rows,
      (row) => row.receivedAt,
      (row) => row.emailId
    );

  // ⏳: the loops and the delegations in one list, oldest due first.
  interface Waiting {
    due: Date;
    id: string;
    line: BriefLine;
  }
  const waiting: Waiting[] = [
    ...input.waitingLoops.rows.map(
      (loop): Waiting => ({ due: loop.dueAt, id: loop.id, line: { section: "waiting", loop } })
    ),
    ...input.waitingDelegations.rows.map(
      (delegation): Waiting => ({ due: delegation.dueAt, id: delegation.id, line: { section: "waiting", delegation } })
    ),
  ];
  const waitingTotal =
    Math.max(input.waitingLoops.total, input.waitingLoops.rows.length) +
    Math.max(input.waitingDelegations.total, input.waitingDelegations.rows.length);
  const waitingOrder = oldestFirst(
    waiting,
    (row) => row.due,
    (row) => row.id
  );

  return {
    urgent: section(input.urgent, mailLine("urgent"), true, mails(input.urgent)),
    reply: section(input.reply, mailLine("reply"), true, mails(input.reply)),
    waiting: consent
      ? section({ rows: waitingOrder, total: waitingTotal }, (row) => row.line, consent, waitingOrder)
      : // Delegations are not loop data: their footer line stays, so the count is of loops only.
        {
          lines: [],
          more: 0,
          hidden: Math.max(input.waitingLoops.total, input.waitingLoops.rows.length),
        },
    promised: section(
      input.promised,
      (loop) => ({ section: "promised", loop }),
      consent,
      oldestFirst(
        input.promised.rows,
        (row) => row.dueAt,
        (row) => row.id
      )
    ),
    stale: section(input.stale, (stale) => ({ section: "stale", stale }), consent, [...input.stale.rows]),
  };
}

function ageText(from: Date, now: Date, texts: CoreTexts): string {
  const ms = Math.max(0, now.getTime() - from.getTime());
  const hours = Math.floor(ms / HOUR_MS);
  if (hours < 1) return texts.brief.ageUnderHour;
  if (hours < 24) return texts.brief.ageHours(hours);
  return texts.brief.ageDays(Math.floor(hours / 24));
}

// Loop texts come from a model and from the user's own mail: no link, address, long number or color-code remains.
function loopFreeText(text: string | null, max: number): string {
  return text === null ? "" : cutText(markUntrustedText(withoutEscapeRemains(text)), max);
}

function whatOf(text: string | null, subject: string | null, texts: CoreTexts): string {
  const own = loopFreeText(text, 80);
  return own === "" ? cleanSubject(subject === null ? null : withoutEscapeRemains(subject), texts) : own;
}

function whoOf(address: string | null): string | null {
  const clean = address === null ? "" : cutText(withoutEscapeRemains(address), 60);
  return clean === "" ? null : clean;
}

export interface BriefRenderOptions {
  timeZone: string;
  now: Date;
  // The panel page that holds the rest of a section; null or absent: "+n more in the panel" without a link.
  links?: Partial<Record<BriefSectionKey, string>>;
}

function lineText(line: BriefLine, texts: CoreTexts, opts: BriefRenderOptions): string {
  const t = texts.brief;
  const day = (at: Date) => formatDayNumeric(at, opts.timeZone, texts.locale);
  if ("mail" in line) {
    const from = senderLabel(line.mail.from, texts);
    const subject = cleanSubject(line.mail.subject, texts);
    const age = ageText(line.mail.receivedAt, opts.now, texts);
    return line.section === "urgent" ? t.urgentLine(from, subject, age) : t.replyLine(from, subject, age);
  }
  if ("stale" in line) return t.staleLine(whatOf(null, line.stale.subject, texts));
  if ("delegation" in line) {
    const { delegation } = line;
    return t.waitingLine(
      whoOf(delegation.delegateName),
      day(delegation.sentAt),
      whatOf(null, delegation.subject, texts)
    );
  }
  const { loop } = line;
  if (line.section === "promised") {
    return t.promisedLine(whoOf(loop.counterpart), whatOf(loop.text, loop.subject, texts), day(loop.dueAt));
  }
  const markers = [
    ...(loop.autoReplyOnly ? [t.waitingMarker.autoReply] : []),
    ...(loop.followUp === "would_draft" ? [t.waitingMarker.wouldDraft] : []),
    ...(loop.followUp === "approval" ? [t.waitingMarker.approval] : []),
  ];
  const text = t.waitingLine(whoOf(loop.counterpart), day(loop.sinceAt), whatOf(loop.text, loop.subject, texts));
  const usual = loop.usualReplyDays === null ? [] : [t.usualReply(loop.usualReplyDays)];
  return [text, ...markers, ...usual].join(" · ");
}

const countLine = (key: BriefSectionKey, count: number, texts: CoreTexts): string => {
  const t = texts.brief;
  if (key === "waiting") return t.waitingCount(count);
  if (key === "promised") return t.promisedCount(count);
  return t.staleCount(count);
};

// The block of the brief: the title, each section (lines, "+n more", or a count line) and, once, the consent ask. No
// section → no lines at all. `ids` runs parallel to `lines`: the id of the loop (or the delegation) that a line names, else null.
// A line never holds a line break (`cutText`, `cleanSubject` and `senderLabel` end all white space to one space; a test plants breaks): a
// line number of the text is the index in `lines`.
export interface RenderedBrief {
  lines: string[];
  ids: (string | null)[];
}

function lineId(line: BriefLine): string | null {
  if ("mail" in line) return null;
  if ("stale" in line) return line.stale.id;
  if ("delegation" in line) return line.delegation.id;
  return line.loop.id;
}

export function renderBriefLines(sections: BriefSections, texts: CoreTexts, opts: BriefRenderOptions): RenderedBrief {
  const blocks: { text: string; id: string | null }[][] = [];
  let hidden = false;
  for (const key of briefSectionKeys) {
    const part = sections[key];
    const lines = part.lines.map((line) => ({ text: lineText(line, texts, opts), id: lineId(line) }));
    if (part.more > 0) lines.push({ text: texts.brief.more(part.more, opts.links?.[key] ?? null), id: null });
    if (part.hidden > 0) {
      lines.push({ text: countLine(key, part.hidden, texts), id: null });
      hidden = true;
    }
    if (lines.length > 0) blocks.push(lines);
  }
  if (blocks.length === 0) return { lines: [], ids: [] };
  const out: { text: string; id: string | null }[] = [{ text: texts.brief.title, id: null }];
  blocks.forEach((lines) => out.push({ text: "", id: null }, ...lines));
  if (hidden) out.push({ text: "", id: null }, { text: texts.brief.consentAsk, id: null });
  return { lines: out.map((row) => row.text), ids: out.map((row) => row.id) };
}

export function renderBrief(sections: BriefSections, texts: CoreTexts, opts: BriefRenderOptions): string[] {
  return renderBriefLines(sections, texts, opts).lines;
}

// The keyboard rows of the brief, one row per line that names a loop or a delegation, in the order of the text.
// `consent` is `loopConsentOf` of the user: false gives no row at all, whatever the sections hold.
// Waiting and delegated lines: Draft follow-up (only when `canDraft`), Later (not after the third), Done. Promised: Done, Drop.
// A delegation: Done (`dd:`). A ⌛ line: Reopen. Draft, Drop and Reopen are owner only (the web routes say the same): `owner` false
// leaves them out, so a member never sees a button that answers "only an owner can do this". A ⌛ line has Reopen alone: no row.
export function briefKeyboard(
  sections: BriefSections,
  texts: CoreTexts,
  opts: { consent: boolean; owner: boolean }
): OutButton[][] {
  if (!opts.consent) return [];
  const b = texts.loopTaps.buttons;
  const button = (text: string, callback: Parameters<typeof encodeCallback>[0]): OutButton => ({
    text,
    data: encodeCallback(callback),
  });
  const rows: OutButton[][] = [];
  for (const key of briefSectionKeys) {
    for (const line of sections[key].lines) {
      if ("mail" in line) continue;
      if ("stale" in line) {
        if (opts.owner) rows.push([button(b.reopen, { kind: "loop_reopen", loopId: line.stale.id })]);
      } else if ("delegation" in line) {
        if (line.delegation.closable) {
          rows.push([button(b.done, { kind: "delegation_done", delegationId: line.delegation.id })]);
        }
      } else if (line.section === "promised") {
        rows.push([
          button(b.done, { kind: "loop_done", loopId: line.loop.id }),
          ...(opts.owner ? [button(b.drop, { kind: "loop_drop", loopId: line.loop.id })] : []),
        ]);
      } else {
        const { loop } = line;
        rows.push([
          ...(loop.canDraft && opts.owner ? [button(b.draft, { kind: "loop_follow_up", loopId: loop.id })] : []),
          ...(loop.laterCount < MAX_LATER_TAPS ? [button(b.later, { kind: "loop_later", loopId: loop.id })] : []),
          button(b.done, { kind: "loop_done", loopId: loop.id }),
        ]);
      }
    }
  }
  return rows;
}

// One loop line less: the last line of the lowest section that has one moves into its "+n more". null: no line left.
export function dropLastLine(sections: BriefSections): BriefSections | null {
  for (const key of [...briefSectionKeys].reverse()) {
    const part = sections[key];
    if (part.lines.length > 0) {
      return { ...sections, [key]: { ...part, lines: part.lines.slice(0, -1), more: part.more + 1 } };
    }
  }
  return null;
}

// The loops that a line names: `surfaced` for ⏳ and 🤝 (the `surfaced_at` of the loop), `stale` for ⌛ (`stale_notified_at`).
export function shownIds(sections: BriefSections): { surfaced: string[]; stale: string[] } {
  const surfaced: string[] = [];
  const stale: string[] = [];
  for (const key of briefSectionKeys) {
    for (const line of sections[key].lines) {
      if ("loop" in line) surfaced.push(line.loop.id);
      if ("stale" in line) stale.push(line.stale.id);
    }
  }
  return { surfaced, stale };
}
