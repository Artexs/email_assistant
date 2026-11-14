// Row builders for the metric tests. Later stages add more.
import type { MailTruthRow } from "./m1";
import type { DelegationDueRow } from "./m2";
import type { HiddenMoveRow, MistakeRow, RejectRow } from "./m3";
import type { HandledRow } from "./m4";
import type { UrgentNoticeRow } from "./m5";
import type { LlmCallRow } from "./m7";
import type { GateRow } from "./m8";

let counter = 0;
const nextId = (prefix: string): string => {
  counter += 1;
  return `${prefix}-${counter}`;
};

export function truthRow(overrides: Partial<MailTruthRow> = {}): MailTruthRow {
  return {
    emailId: nextId("mail"),
    predicted: "info",
    truth: null,
    truthSource: null,
    wrongOnly: false,
    ...overrides,
  };
}

export function delegationRow(overrides: Partial<DelegationDueRow> = {}): DelegationDueRow {
  return {
    id: nextId("delegation"),
    sentAt: new Date("2026-11-10T09:00:00Z"),
    dueAt: null,
    answeredAt: null,
    doneAt: null,
    overdueAt: null,
    cancelled: false,
    ...overrides,
  };
}

export function hiddenMoveRow(overrides: Partial<HiddenMoveRow> = {}): HiddenMoveRow {
  return {
    emailId: nextId("mail"),
    appliedAt: new Date("2026-11-17T10:00:00Z"),
    folder: "ai_info",
    truth: null,
    vip: false,
    whitelisted: false,
    ...overrides,
  };
}

export function rejectRow(overrides: Partial<RejectRow> = {}): RejectRow {
  return { actionId: nextId("action"), rejectedAt: new Date("2026-11-17T10:00:00Z"), reason: null, ...overrides };
}

export function mistakeRow(overrides: Partial<MistakeRow> = {}): MistakeRow {
  return { actionId: nextId("action"), sentAt: new Date("2026-11-17T10:00:00Z"), ...overrides };
}

export function handledRow(overrides: Partial<HandledRow> = {}): HandledRow {
  return {
    emailId: nextId("mail"),
    category: "info",
    mailboxActionApplied: false,
    mailboxActionUndone: false,
    mailboxActionLogged: false,
    wrongWithin7Days: false,
    delegationSendApplied: false,
    delegationCancelled: false,
    ...overrides,
  };
}

export function urgentRow(overrides: Partial<UrgentNoticeRow> = {}): UrgentNoticeRow {
  return {
    emailId: nextId("mail"),
    receivedAt: new Date("2026-11-17T09:00:00Z"),
    noticeAt: null,
    ...overrides,
  };
}

export function llmCallRow(overrides: Partial<LlmCallRow> = {}): LlmCallRow {
  return {
    mailboxId: null,
    model: "gpt-6-luna",
    tokensIn: 1036,
    tokensOut: 80,
    at: new Date("2026-11-17T10:00:00Z"),
    ...overrides,
  };
}

export function gateRow(overrides: Partial<GateRow> = {}): GateRow {
  return {
    mailboxId: "00000000-0000-4000-8000-000000000001",
    category: "info",
    auto: true,
    kept: 41,
    precision: 0.97,
    recall: 0.8,
    decision: "go",
    ...overrides,
  };
}
