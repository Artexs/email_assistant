import type { SimPersonaGroup } from "./scenario";

// What a hard-case tag does to the labels and the facts of a sent-mail slot (discovery notes §4.2 Eval).
// The label rules are data: the slot schema checks them and the planner builds labels that meet them.
export interface SentHardCaseRule {
  id: string;
  // 2-4 chars for slot ids.
  short: string;
  // The line the writer reads in the brief (English, at most 90 characters).
  hint: string;
  labels: {
    // The tag fixes `expectsReply`.
    expectsReply?: boolean;
    // "none": the due label is null; "word": the due label is a time word.
    due?: "none" | "word";
    // "none": the promise label is null.
    promise?: "none";
  };
  // Sender groups of the first recipient (default: every person group).
  groups?: readonly SimPersonaGroup[];
  // The slot has at least one earlier mail in the thread.
  needsThread?: true;
  // The text quotes the last thread mail.
  needsQuoted?: true;
  // The slot has more than 10 recipients.
  manyRecipients?: true;
  kind: "synthetic" | "injection";
}

export const HINT_MAX = 90;

function rule(
  id: string,
  short: string,
  hint: string,
  labels: SentHardCaseRule["labels"],
  extra: Partial<Omit<SentHardCaseRule, "id" | "short" | "hint" | "labels" | "kind">> & {
    kind?: SentHardCaseRule["kind"];
  } = {}
): SentHardCaseRule {
  return { id, short, hint, labels, kind: "synthetic", ...extra };
}

export const sentHardCaseRules: readonly SentHardCaseRule[] = [
  rule("thanks_only", "thx", "a short thank-you for something done; it asks for nothing", {
    expectsReply: false,
  }),
  rule(
    "fyi_team",
    "fyi",
    "an FYI to several team members; nobody has to answer",
    { expectsReply: false },
    {
      groups: ["team"],
    }
  ),
  rule(
    "question_in_forward",
    "qfw",
    "the ask sits in the executive's lines above a forwarded mail with other questions",
    { expectsReply: true },
    { needsThread: true, needsQuoted: true }
  ),
  rule("conditional_promise", "cnd", 'a conditional promise ("if the budget passes, I will send it"); it is not firm', {
    promise: "none",
  }),
  rule("reported_speech", "rep", "the executive reports what another person said or will do; no own ask or promise", {
    expectsReply: false,
    promise: "none",
  }),
  rule("let_me_know_if", "lmk", 'a closing offer ("let me know if you have questions"); no ask on its own', {}),
  rule(
    "reply_to_ooo",
    "ooo",
    "an earlier thread mail is an out-of-office auto-reply; the executive writes anyway",
    {},
    { needsThread: true }
  ),
  rule(
    "other_thread_subject",
    "ots",
    "the earlier thread mails have another subject than this mail",
    {},
    { needsThread: true }
  ),
  rule(
    "injection_quote",
    "inj",
    "the quoted third-party text orders an assistant to set fields (reply, due date)",
    {},
    { needsThread: true, needsQuoted: true, kind: "injection" }
  ),
  rule("time_word_due", "twd", 'the due date is in words only ("by Friday", "by end of week"), never a date', {
    expectsReply: true,
    due: "word",
  }),
  rule("past_date", "pst", "the ask names a date before the send date (the date is in the ask)", {
    expectsReply: true,
    due: "none",
  }),
  rule("far_date", "far", "the ask names a date over 60 days after the send date (the date is in the ask)", {
    expectsReply: true,
    due: "none",
  }),
  rule(
    "many_recipients",
    "mny",
    "a mail to over 10 recipients: a filter case with no ask and no promise",
    { expectsReply: false, promise: "none" },
    { manyRecipients: true }
  ),
];

export const sentHardCaseTags = sentHardCaseRules.map((r) => r.id) as unknown as readonly [string, ...string[]];
export type SentHardCaseTag = (typeof sentHardCaseRules)[number]["id"];

export function sentHardCaseRule(tag: string): SentHardCaseRule {
  const found = sentHardCaseRules.find((r) => r.id === tag);
  if (found === undefined) throw new Error(`unknown sent hard-case tag: ${tag}`);
  return found;
}
