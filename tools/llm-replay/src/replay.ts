import { categories, type Category, reasonCodes, type TriageAnalysis } from "@ea/core";

import type { DemoSeed } from "../../../apps/server/src/modules/lab";

type DemoRow = Record<string, unknown>;

/** What the production classifier schema accepts (`buildTriageAnalysisSchema`). */
export type ClassifierAnswer = TriageAnalysis;

export interface ReplayEntry {
  key: string;
  /** `fields.delegate_id` is null here: the server writes the id that the prompt lists for `delegateName`. */
  answer: ClassifierAnswer;
  delegateName: string | null;
}

export interface ReplayTable {
  entries: ReadonlyMap<string, ReplayEntry>;
  /** Keys that two seed mails answer differently: they have no entry. */
  dropped: number;
  /** Seed mails whose newest result is not a classifier answer (hard rule, `triage_error`, `llm_blocked`): no entry. */
  ruleRows: number;
}

export type ReplayMissReason = "no_mail_block" | "no_entry" | "delegate_missing";

export type ReplayResult = { status: 200; body: ClassifierAnswer } | { status: 500; reason: ReplayMissReason };

const ADDRESS_IN_ANGLES = /<([^<>]*)>\s*$/;
const MAIL_BLOCK = "The email to classify:\n<<<EMAIL_DATA ";
const DELEGATES_HEADER = "Delegates (from the user's settings, not from the email):";
const DELEGATE_LINE = /^- ([^\s:]+): (.*?)(?: \([^()]*\))?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const REASON_MAX = 300;
const SUMMARY_MAX = 600;
const TASK_MAX = 300;
const CLARIFICATION_MAX = 200;

/** Lower-case trimmed address (the part in angle brackets, when there is one), a newline, the trimmed subject. */
export function replayKey(from: string | null, subject: string | null): string {
  const raw = (from ?? "").trim();
  const address = (ADDRESS_IN_ANGLES.exec(raw)?.[1] ?? raw).trim().toLowerCase();
  return `${address}\n${(subject ?? "").trim()}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const textOf = (value: unknown): string | null => (typeof value === "string" ? value : null);

const timeOf = (value: unknown): number => {
  const time = typeof value === "string" || value instanceof Date ? new Date(value).getTime() : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
};

const isReasonCode = (value: unknown): value is (typeof reasonCodes)[number] =>
  typeof value === "string" && (reasonCodes as readonly string[]).includes(value);

const isModelCategory = (value: unknown): value is Category =>
  typeof value === "string" && value !== "unsure" && (categories as readonly string[]).includes(value);

function newestBy(rows: readonly DemoRow[], emailId: unknown, extra: (row: DemoRow) => boolean = () => true) {
  let newest: DemoRow | undefined;
  for (const row of rows) {
    if (row.email_id !== emailId || !extra(row)) continue;
    if (newest === undefined || timeOf(row.created_at) >= timeOf(newest.created_at)) newest = row;
  }
  return newest;
}

function limited(value: unknown, max: number): string | null {
  const text = textOf(value);
  return text === null ? null : text.slice(0, max);
}

// The classifier answer of one mail, or null when its newest result row is not a classifier answer.
function answerOf(result: DemoRow, summary: string | null): ClassifierAnswer | null {
  if (!isReasonCode(result.reason_code)) return null;
  const fields = isRecord(result.fields) ? result.fields : {};
  // The stored category is the final one (the threshold can make it `unsure`); the model's own is in `model_category`.
  const category = [fields.model_category, result.category].find(isModelCategory);
  const confidence = Number(result.confidence);
  if (category === undefined || !(confidence >= 0 && confidence <= 1)) return null;
  const dueDate = textOf(fields.due_date);
  const language = fields.language;
  return {
    category,
    confidence,
    reason_code: result.reason_code,
    reason: limited(result.reason, REASON_MAX) ?? "",
    summary: summary === null ? null : summary.slice(0, SUMMARY_MAX),
    fields: {
      due_date: dueDate !== null && ISO_DATE.test(dueDate) ? dueDate : null,
      language: language === "pl" || language === "en" ? language : "other",
      delegate_id: null,
      task: limited(fields.task, TASK_MAX),
      clarification: limited(fields.clarification, CLARIFICATION_MAX),
    },
  };
}

/**
 * One entry per seed mail with a classifier answer. The answer is the newest `triage_results` row of the mail, with
 * its summary from the mail's `save_summary` action and its delegate from `fields.delegate_id` or the `delegations`
 * row. A key with two different answers has no entry.
 */
export function buildReplayTable(seed: DemoSeed): ReplayTable {
  const { emails, triage_results: results, actions, delegates, delegations } = seed.tables;
  const entries = new Map<string, ReplayEntry>();
  const droppedKeys = new Set<string>();
  let ruleRows = 0;
  for (const email of emails) {
    const result = newestBy(results, email.id);
    if (result === undefined) continue;
    const summaryAction = newestBy(actions, email.id, (row) => row.type === "save_summary");
    const payload = isRecord(summaryAction?.payload) ? summaryAction.payload : {};
    const answer = answerOf(result, textOf(payload.summary));
    if (answer === null) {
      ruleRows += 1;
      continue;
    }
    const fields = isRecord(result.fields) ? result.fields : {};
    const delegateId = textOf(fields.delegate_id) ?? textOf(newestBy(delegations, email.id)?.delegate_id);
    const delegateName = textOf(delegates.find((row) => row.id === delegateId)?.name);
    const key = replayKey(textOf(email.from_address), textOf(email.subject));
    const entry: ReplayEntry = { key, answer, delegateName };
    const known = entries.get(key);
    if (droppedKeys.has(key)) continue;
    if (known === undefined) {
      entries.set(key, entry);
    } else if (JSON.stringify(known) !== JSON.stringify(entry)) {
      entries.delete(key);
      droppedKeys.add(key);
    }
  }
  return { entries, dropped: droppedKeys.size, ruleRows };
}

// `From:` and `Subject:` of the mail to classify: the data block after the last marker, never the thread context.
function requestKey(input: string): string | null {
  const start = input.lastIndexOf(MAIL_BLOCK);
  if (start < 0) return null;
  const lines = input.slice(start + MAIL_BLOCK.length).split("\n");
  const from = lines.find((line) => line.startsWith("From: "));
  const subject = lines.find((line) => line.startsWith("Subject: "));
  if (from === undefined || subject === undefined) return null;
  const fromText = from.slice("From: ".length);
  const subjectText = subject.slice("Subject: ".length);
  return replayKey(fromText === "(unknown)" ? null : fromText, subjectText === "(no subject)" ? null : subjectText);
}

// The id of the delegate with this name in the Delegates section of the prompt.
function delegateIdIn(input: string, name: string): string | null {
  const lines = input.split("\n");
  const header = lines.indexOf(DELEGATES_HEADER);
  if (header < 0) return null;
  for (const line of lines.slice(header + 1)) {
    if (line === "") return null;
    const match = DELEGATE_LINE.exec(line);
    if (match !== null && match[2] === name) return match[1] ?? null;
  }
  return null;
}

/** The classifier answer for a Responses API request body, or why there is none. Pure. */
export function replayAnswer(table: ReplayTable, requestBody: unknown): ReplayResult {
  const input = isRecord(requestBody) ? textOf(requestBody.input) : null;
  const key = input === null ? null : requestKey(input);
  if (input === null || key === null) return { status: 500, reason: "no_mail_block" };
  const entry = table.entries.get(key);
  if (entry === undefined) return { status: 500, reason: "no_entry" };
  if (entry.delegateName === null) return { status: 200, body: entry.answer };
  const delegateId = delegateIdIn(input, entry.delegateName);
  if (delegateId === null) return { status: 500, reason: "delegate_missing" };
  return { status: 200, body: { ...entry.answer, fields: { ...entry.answer.fields, delegate_id: delegateId } } };
}
