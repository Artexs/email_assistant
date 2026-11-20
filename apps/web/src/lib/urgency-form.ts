import {
  localDateTime,
  URGENCY_MAX_ITEMS,
  URGENCY_NUL_MESSAGE,
  urgencyProfileSchema,
  type UrgencyProfile,
} from "@ea/core/web";

import type { TextKey } from "../i18n";

// The form state of the urgency card. The keywords of a topic are one comma-separated text in the field.
export interface TopicDraft {
  label: string;
  keywords: string;
}
export interface DeadlineDraft {
  label: string;
  due: string;
}
export interface UrgencyDraft {
  topics: TopicDraft[];
  deadlines: DeadlineDraft[];
}

export function draftFromProfile(profile: UrgencyProfile | null): UrgencyDraft {
  if (profile === null) return { topics: [], deadlines: [] };
  return {
    topics: profile.topics.map((topic) => ({ label: topic.label, keywords: topic.keywords.join(", ") })),
    deadlines: profile.deadlines.map((deadline) => ({ label: deadline.label, due: deadline.due })),
  };
}

// The keywords as the schema wants them: split on commas, trimmed, empty pieces dropped.
export function splitKeywords(text: string): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const piece of text.split(",")) {
    const keyword = piece.trim();
    const key = keyword.toLowerCase();
    if (keyword.length === 0 || seen.has(key)) continue;
    seen.add(key);
    keywords.push(keyword);
  }
  return keywords;
}

export interface UrgencyError {
  key: TextKey;
  // The 1-based position of the topic or deadline; 0 when the error is about a list.
  n: number;
}

export type UrgencyResult =
  // `null`: an empty draft. The server stores an empty profile as null, so the card sends null.
  { ok: true; profile: UrgencyProfile | null } | { ok: false; error: UrgencyError };

// The same schema as the server (`urgencyProfileSchema`): the card sends nothing that the server would refuse.
export function profileFromDraft(draft: UrgencyDraft): UrgencyResult {
  const parsed = urgencyProfileSchema.safeParse({
    topics: draft.topics.map((topic) => ({ label: topic.label, keywords: splitKeywords(topic.keywords) })),
    deadlines: draft.deadlines.map((deadline) => ({ label: deadline.label, due: deadline.due })),
  });
  if (!parsed.success) return { ok: false, error: errorOf(parsed.error.issues[0] ?? { path: [], message: "" }) };
  const { topics, deadlines } = parsed.data;
  return { ok: true, profile: topics.length === 0 && deadlines.length === 0 ? null : parsed.data };
}

function errorOf({ path, message }: { path: readonly PropertyKey[]; message: string }): UrgencyError {
  const nul = message === URGENCY_NUL_MESSAGE;
  const [list, index, field, keywordIndex] = path;
  const n = typeof index === "number" ? index + 1 : 0;
  if (list === "topics") {
    // `topics.<i>.keywords` is too many keywords; `topics.<i>.keywords.<j>` is one keyword with a bad length.
    if (nul && (field === "keywords" || field === "label")) return { key: "urg_err_topic_nul", n };
    if (field === "keywords")
      return { key: keywordIndex === undefined ? "urg_err_keywords_many" : "urg_err_keyword", n };
    if (field === "label") return { key: "urg_err_topic_label", n };
    return { key: "urg_err_topics_many", n: 0 };
  }
  if (list === "deadlines") {
    if (nul && field === "label") return { key: "urg_err_deadline_nul", n };
    if (field === "label") return { key: "urg_err_deadline_label", n };
    if (field === "due") return { key: "urg_err_deadline_date", n };
    return { key: "urg_err_deadlines_many", n: 0 };
  }
  return { key: "error_generic", n: 0 };
}

export function canAddTopic(draft: UrgencyDraft): boolean {
  return draft.topics.length < URGENCY_MAX_ITEMS;
}

export function canAddDeadline(draft: UrgencyDraft): boolean {
  return draft.deadlines.length < URGENCY_MAX_ITEMS;
}

// A deadline has ended when its date is before the local date of the organization today. The classifier still reads a
// deadline of yesterday (window today−1 … today+30, `deadlinesInWindow`); the card marks it as ended from its first day past.
export function isEnded(due: string, now: Date, timeZone: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(due) && due < localDateTime(now, timeZone).date;
}
