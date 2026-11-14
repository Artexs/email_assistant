// Row builders for the metric tests. Later stages add more.
import type { WeekStats } from "../web/stats";

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

// The numbers of the seeded week of the server tests (stage 12 step 1 case 1): all mailboxes, one auto category.
export function weekStatsExample(overrides: Partial<WeekStats> = {}): WeekStats {
  const mailboxId = "00000000-0000-4000-8000-000000000001";
  const row = {
    mailboxId,
    auto: false,
    kept: 12,
    precision: 0.5,
    recall: 0.5,
    wilsonLower: 0.3,
    decision: "no-go",
  } as const;
  return {
    weekStart: "2026-11-16",
    mailboxId: null,
    m1: {
      important: 5,
      misses: 1,
      missesBySource: { correction: 1, review: 0, moved_back: 0, answered_check: 0 },
      sample: { labelled: 1, important: 1, misses: 0, missRateUpper: null },
    },
    m2: { due: 2, closedOnTime: 1, surfacedOnTime: 2, pending: 0 },
    m3: { hiddenImportant: 2, wrongPerson: 1, wrongContent: 0, sentMistake: 1, total: 4, notNeeded: 0, noReason: 1 },
    m4: { triaged: 9, handled: 3, wouldHandle: 0 },
    m5: { urgent: 2, noticed: 1, withoutNotice: 1, quietHours: 1, p90Minutes: 3 },
    m7: {
      llmUsdWeek: 0.2,
      llmCalls: 10,
      unpricedCalls: 0,
      mailboxes: 1,
      hostingUsdMonth: 5,
      backupUsdMonth: 0.5,
      perMailboxMonthUsd: 0.4112,
      targetUsd: 5,
    },
    m8: [
      { ...row, category: "urgent" },
      { ...row, category: "needs_reply" },
      { ...row, category: "info" },
      { ...row, category: "notification", auto: true, kept: 41, precision: 0.97, wilsonLower: 0.874, decision: "go" },
      { ...row, category: "spam" },
    ],
    ...overrides,
  };
}
