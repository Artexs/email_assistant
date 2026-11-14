// Row builders for the metric tests. Later stages add more.
import type { DelegationDueRow } from "./m2";
import type { HiddenMoveRow, MistakeRow, RejectRow } from "./m3";
import type { MailTruthRow } from "./m1";

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
