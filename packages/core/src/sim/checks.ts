import { hasPhoneNumber, hasUnreservedAddress, hasUnreservedUrl } from "../testmail/batch";

import type { CaseText } from "./files";
import { isHtmlOnly } from "./hard-cases";
import { detectLang } from "./lang";
import type { PlanSpec } from "./plan-spec";
import type { Scenario } from "./scenario";
import type { Slot } from "./slot";
import { lengthBuckets } from "./slot";

export type CaseIssueCode =
  | "text_missing"
  | "slot_unknown"
  | "address_not_reserved"
  | "url_not_reserved"
  | "phone_number"
  | "lang_mismatch"
  | "length_out_of_bucket"
  | "html_missing"
  | "html_unexpected"
  | "text_part_unexpected"
  | "signature_missing"
  | "urgent_keyword"
  | "diacritics_missing"
  | "attachment_not_named"
  | "planted_missing"
  | "expected_points_missing"
  | "thread_count_mismatch";

// An issue names a case and a code; it never holds mail text.
export interface CaseIssue {
  id: string;
  code: CaseIssueCode;
}

export interface SpreadIssue {
  code: "length_share" | "html_share" | "lang_share";
  // Counts only: whole percents, `actual|plan`, buckets or languages separated by `/`.
  detail: string;
}

// Two cases of one batch open with the same text after the greeting line.
export interface TextBatchIssue {
  id: string;
  code: "opening_repeat";
}

const urgentKeywords = new Set([
  "pilne",
  "pilnie",
  "natychmiast",
  "asap",
  "urgent",
  "urgently",
  "immediately",
  "dringend",
]);
const MIN_DIACRITICS = 5;
const OPENING_CHARS = 40;
// Overlapping on purpose: writers need slack.
const lengthLimits = { short: { max: 60 }, medium: { min: 40, max: 200 }, long: { min: 150 } } as const;
// Buckets of the planner, without overlap, for the share of a part.
const SHORT_MAX = 60;
const MEDIUM_MAX = 180;
const LENGTH_TOLERANCE = 10;
const HTML_TOLERANCE = 5;
const LANG_TOLERANCE = 3;

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ");
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w !== "").length;
}

// The readable text of the case: the text part, else the HTML without tags.
function readable(text: CaseText): string {
  return text.body !== "" ? text.body : stripTags(text.html ?? "");
}

function allParts(text: CaseText): string[] {
  return [text.subject, text.body, text.html ?? "", ...text.thread.map((t) => t.body)];
}

function checkLength(slot: Slot, words: number): boolean {
  const limit: { min?: number; max?: number } = lengthLimits[slot.style.length];
  return (limit.min === undefined || words >= limit.min) && (limit.max === undefined || words <= limit.max);
}

export function checkCase(slot: Slot, text: CaseText, scenario: Scenario): CaseIssue[] {
  const codes: CaseIssueCode[] = [];
  const add = (code: CaseIssueCode, when: boolean) => {
    if (when) codes.push(code);
  };
  if (text.id !== slot.id) return [{ id: slot.id, code: "slot_unknown" }];

  const parts = allParts(text);
  const joined = parts.join("\n");
  const readableText = readable(text);
  const htmlOnly = isHtmlOnly(slot);

  add("address_not_reserved", parts.some(hasUnreservedAddress));
  add("url_not_reserved", parts.some(hasUnreservedUrl));
  add("phone_number", parts.some(hasPhoneNumber));

  const lang = detectLang(`${text.subject} ${readableText}`);
  add("lang_mismatch", lang !== "unknown" && lang !== slot.lang);
  add("length_out_of_bucket", !checkLength(slot, wordCount(readableText)));

  const hasHtml = text.html !== undefined;
  add("html_missing", slot.style.format === "html" && !hasHtml);
  add("html_unexpected", slot.style.format !== "html" && hasHtml);
  add("text_part_unexpected", htmlOnly && text.body !== "");

  const signature = scenario.personas.find((p) => p.key === slot.persona)?.signature ?? "";
  if (slot.style.signature && signature !== "") {
    add("signature_missing", !`${text.body}\n${text.html ?? ""}`.includes(signature));
  }

  if (slot.hardCases.includes("urgent_no_keyword")) {
    const words = joined.toLowerCase().match(/\p{L}+/gu) ?? [];
    add(
      "urgent_keyword",
      words.some((w) => urgentKeywords.has(w))
    );
  }
  if (slot.hardCases.includes("polish_diacritics")) {
    add("diacritics_missing", (joined.toLowerCase().match(/[ąćęłńóśźż]/g) ?? []).length < MIN_DIACRITICS);
  }

  const lowered = `${text.body}\n${text.html ?? ""}\n${text.thread.map((t) => t.body).join("\n")}`.toLowerCase();
  add(
    "attachment_not_named",
    slot.attachments.some((a) => !lowered.includes(a.name.toLowerCase()))
  );

  if (slot.kind === "injection") {
    const planted = text.planted ?? [];
    add("planted_missing", planted.length === 0 || planted.some((p) => !lowered.includes(p.toLowerCase())));
  }
  add("expected_points_missing", slot.category === "needs_reply" && (text.expectedPoints ?? []).length === 0);
  add("thread_count_mismatch", text.thread.length !== slot.thread.length);

  return codes.map((code) => ({ id: slot.id, code }));
}

function openingOf(body: string): string | undefined {
  const lines = body.split(/\r?\n/);
  const rest = (lines.length > 1 ? lines.slice(1).join(" ") : body).replace(/\s+/g, " ").trim().toLowerCase();
  return rest.length >= OPENING_CHARS ? rest.slice(0, OPENING_CHARS) : undefined;
}

export function checkBatch(texts: readonly CaseText[]): TextBatchIssue[] {
  const seen = new Set<string>();
  const issues: TextBatchIssue[] = [];
  for (const text of texts) {
    const opening = openingOf(text.body);
    if (opening === undefined) continue;
    if (seen.has(opening)) issues.push({ id: text.id, code: "opening_repeat" });
    seen.add(opening);
  }
  return issues;
}

function percent(count: number, total: number): number {
  return Math.round((count / total) * 100);
}

function shareDetail(actual: readonly number[], plan: readonly number[]): string {
  return `${actual.join("/")}|${plan.join("/")}`;
}

function textBucket(words: number): (typeof lengthBuckets)[number] {
  if (words <= SHORT_MAX) return "short";
  return words <= MEDIUM_MAX ? "medium" : "long";
}

// The spread of one part: the written texts against the shares of their slots (counts only, no text).
export function checkSpread(
  slots: readonly Slot[],
  texts: readonly CaseText[],
  _spec: PlanSpec,
  _scenario: Scenario
): SpreadIssue[] {
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const pairs = texts
    .filter((t) => t.dropped !== true && slotById.has(t.id))
    .map((t) => ({ text: t, slot: slotById.get(t.id) as Slot }));
  if (pairs.length === 0) return [];
  const total = pairs.length;
  const issues: SpreadIssue[] = [];

  const actualLength = lengthBuckets.map((b) =>
    percent(pairs.filter((p) => textBucket(wordCount(readable(p.text))) === b).length, total)
  );
  const planLength = lengthBuckets.map((b) => percent(pairs.filter((p) => p.slot.style.length === b).length, total));
  if (actualLength.some((v, i) => Math.abs(v - (planLength[i] as number)) > LENGTH_TOLERANCE)) {
    issues.push({ code: "length_share", detail: shareDetail(actualLength, planLength) });
  }

  const actualHtml = percent(pairs.filter((p) => p.text.html !== undefined).length, total);
  const planHtml = percent(pairs.filter((p) => p.slot.style.format === "html").length, total);
  if (Math.abs(actualHtml - planHtml) > HTML_TOLERANCE) {
    issues.push({ code: "html_share", detail: shareDetail([actualHtml], [planHtml]) });
  }

  // A text with no clear language counts as the planned one, as in the case check.
  const langs = [...new Set(pairs.map((p) => p.slot.lang))].sort();
  const actualLang = langs.map((l) =>
    percent(
      pairs.filter((p) => {
        const found = detectLang(`${p.text.subject} ${readable(p.text)}`);
        return (found === "unknown" ? p.slot.lang : found) === l;
      }).length,
      total
    )
  );
  const planLang = langs.map((l) => percent(pairs.filter((p) => p.slot.lang === l).length, total));
  if (actualLang.some((v, i) => Math.abs(v - (planLang[i] as number)) > LANG_TOLERANCE)) {
    issues.push({ code: "lang_share", detail: shareDetail(actualLang, planLang) });
  }
  return issues;
}
