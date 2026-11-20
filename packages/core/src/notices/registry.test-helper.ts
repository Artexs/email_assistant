import { aiTextFor } from "../digest/ai-text";
import {
  approvalEdit,
  renderApprovalRequest,
  renderApprovalSetRequest,
  renderDelegationAnswered,
  renderSendResult,
} from "../digest/approvals";
import { type OutMessage } from "../digest/message";
import {
  renderActionFailedNotice,
  renderAuthErrorNotice,
  renderAutonomyPausedNotice,
  renderHostBlockedNotice,
  renderLoopConsentNotice,
  renderRepliesReadyNotice,
  renderReplyPromptNotice,
  renderReplyResultNotice,
  renderNotTriagedNotice,
  renderSendHeldNotice,
  renderSentMissingNotice,
  renderSyncOkNotice,
  renderSyncStaleNotice,
  renderTrustReportReadyNotice,
  renderUrgentNotice,
} from "../digest/notices";
import { renderWeeklyReport } from "../digest/weekly";
import { describeActions, type WouldDoAction } from "../digest/would-do";
import { weekStatsExample } from "../metrics/fixtures";
import { type CoreTexts } from "../texts";

import { encodeNoticeView } from "./encode";
import { type NoticeKind, type NoticeRenderOptions } from "./kinds";
import { type NoticeView } from "./views";

export const id1 = "11111111-1111-4111-8111-111111111111";

export const id2 = "22222222-2222-4222-8222-222222222222";

export const now = new Date("2026-11-13T10:07:33.123Z");

export const receivedAt = new Date("2026-11-12T22:15:00.000Z");

export const nextAt = new Date("2026-11-13T11:00:00.000Z");

export const timeZone = "Europe/Warsaw";

export const opts: NoticeRenderOptions = { channel: "telegram", detail: "full", locale: "en" };

export const actions: WouldDoAction[] = [
  { type: "create_draft", status: "ready", folder: null, reverse: false, kind: "delegation", delegateId: id2 },
  { type: "move", status: "logged", folder: "ai_info", reverse: false, kind: null, delegateId: null },
];

export const names = new Map([[id2, "Anna Nowak"]]);

export const urgentView: NoticeView<"urgent"> = {
  emailId: id1,
  from: "boss@example.test",
  subject: "Contract",
  ai: { reasonCode: "llm", reason: "Deadline today" },
  receivedAt,
  synthetic: false,
  folderTag: null,
  actions,
  delegateNames: { [id2]: "Anna Nowak" },
  stayFolder: "INBOX",
  suspicious: ["link_mismatch"],
  now,
  timeZone,
};

export const approvalView = {
  kind: "delegation" as const,
  recipient: { name: "Anna Nowak", address: "anna@example.test" },
  sender: { label: "Boss <boss@example.test>", external: false },
  recipientInactive: false,
  subject: "Contract",
  dueDate: null,
  body: "Please send the contract.",
  quote: null,
  synthetic: false,
};

export const setItems = [
  {
    n: 1,
    delegateName: "Anna",
    address: "anna@example.test",
    subject: "Contract",
    dueAt: now,
    reminder: 1 as const,
    task: "Send it",
  },
  {
    n: 2,
    delegateName: "Piotr",
    address: "piotr@example.test",
    subject: null,
    dueAt: null,
    reminder: 2 as const,
    task: "Call back",
  },
];

export const sendResult = { kind: "failed", cause: "tries", code: "ETIMEDOUT", tries: 5 } as const;

export interface Case {
  kind: NoticeKind;
  view: unknown;
  // Renders with the given texts.
  direct: (texts: CoreTexts) => OutMessage;
}

export const cases: Case[] = [
  {
    kind: "digest",
    view: { text: "Digest text", buttons: [[{ text: "Open", data: "x" }]] },
    direct: () => ({ text: "Digest text", buttons: [[{ text: "Open", data: "x" }]] }),
  },
  {
    kind: "urgent",
    view: urgentView,
    direct: (texts) =>
      renderUrgentNotice(
        {
          emailId: id1,
          from: "boss@example.test",
          subject: "Contract",
          aiText: aiTextFor(
            {
              category: "urgent",
              reasonCode: "llm",
              reason: "Deadline today",
              summary: null,
              modelCategory: null,
              confidence: 0.91,
            },
            texts
          ),
          receivedAt,
          synthetic: false,
          folderTag: null,
          wouldDo: describeActions(actions, names, { stayFolder: "INBOX" }, texts),
          suspicious: ["link_mismatch"],
          now,
          timeZone,
        },
        texts
      ),
  },
  {
    kind: "auth_error",
    view: { address: "box@example.test", mailboxId: id2, since: receivedAt, now, timeZone },
    direct: (texts) =>
      renderAuthErrorNotice({ address: "box@example.test", mailboxId: id2, since: receivedAt, now, timeZone }, texts),
  },
  {
    kind: "sync_stale",
    view: { address: "box@example.test", lastSyncedAt: null, now, timeZone },
    direct: (texts) => renderSyncStaleNotice({ address: "box@example.test", lastSyncedAt: null, now, timeZone }, texts),
  },
  {
    kind: "sync_ok",
    view: { address: "box@example.test", lastSyncedAt: receivedAt, now, timeZone },
    direct: (texts) =>
      renderSyncOkNotice({ address: "box@example.test", lastSyncedAt: receivedAt, now, timeZone }, texts),
  },
  {
    kind: "action_failed",
    view: {
      actionType: "move",
      reverse: false,
      reason: "other",
      folderName: "ai_info",
      sourceFolder: "INBOX",
      currentFolder: "INBOX",
      from: "boss@example.test",
      subject: "Contract",
      synthetic: false,
      attempts: 3,
    },
    direct: (texts) =>
      renderActionFailedNotice(
        {
          actionType: "move",
          reverse: false,
          reason: "other",
          folderName: "ai_info",
          sourceFolder: "INBOX",
          currentFolder: "INBOX",
          from: "boss@example.test",
          subject: "Contract",
          synthetic: false,
          attempts: 3,
        },
        texts
      ),
  },
  {
    kind: "approval",
    view: { actionId: id1, view: approvalView, now, timeZone },
    direct: (texts) => renderApprovalRequest({ actionId: id1, view: approvalView, now, timeZone }, texts),
  },
  {
    kind: "approval_set",
    view: { setId: id1, items: setItems, timeZone },
    direct: (texts) => renderApprovalSetRequest({ setId: id1, items: setItems, timeZone }, texts),
  },
  {
    kind: "send_result",
    view: {
      actionId: id1,
      sendKind: "delegation",
      result: sendResult,
      recipient: { name: "Anna Nowak", address: "anna@example.test" },
      subject: "Contract",
      synthetic: false,
    },
    direct: (texts) =>
      renderSendResult(
        {
          actionId: id1,
          sendKind: "delegation",
          result: sendResult,
          recipient: { name: "Anna Nowak", address: "anna@example.test" },
          subject: "Contract",
          synthetic: false,
        },
        texts
      ),
  },
  {
    kind: "delegation_answered",
    view: {
      delegationId: id1,
      delegateName: "Anna Nowak",
      subject: "Contract",
      receivedAt,
      now,
      timeZone,
      synthetic: false,
    },
    direct: (texts) =>
      renderDelegationAnswered(
        {
          delegationId: id1,
          delegateName: "Anna Nowak",
          subject: "Contract",
          receivedAt,
          now,
          timeZone,
          synthetic: false,
        },
        texts
      ),
  },
  { kind: "mailbox_removed", view: {}, direct: (texts) => ({ text: texts.notices.mailboxRemoved, buttons: [] }) },
  {
    kind: "send_held",
    view: { mailboxId: id1, address: "me@firma.test", limit: "mailbox_day", waiting: 2, nextAt, now, timeZone },
    direct: (texts) =>
      renderSendHeldNotice(
        {
          mailboxId: id1,
          address: "me@firma.test",
          limit: "mailbox_day",
          waiting: 2,
          nextAt,
          now,
          timeZone,
        },
        texts
      ),
  },
  {
    kind: "weekly_report",
    view: { week: weekStatsExample(), timeZone, answeredWaiting: 2 },
    direct: (texts) => renderWeeklyReport({ week: weekStatsExample(), timeZone, answeredWaiting: 2 }, texts),
  },
  {
    kind: "host_blocked",
    view: { address: "box@example.test", since: receivedAt, now, timeZone },
    direct: (texts) =>
      renderHostBlockedNotice({ address: "box@example.test", since: receivedAt, now, timeZone }, texts),
  },
  {
    kind: "sent_missing",
    view: { address: "box@example.test", since: receivedAt, now, timeZone },
    direct: (texts) =>
      renderSentMissingNotice({ address: "box@example.test", since: receivedAt, now, timeZone }, texts),
  },
  {
    kind: "loop_consent",
    view: { about: "approval" },
    direct: (texts) => renderLoopConsentNotice({ about: "approval" }, texts),
  },
  {
    kind: "replies_ready",
    view: { count: 3, now, timeZone, review: true },
    direct: (texts) => renderRepliesReadyNotice({ count: 3, now, timeZone, review: true }, texts),
  },
  { kind: "reply_prompt", view: { emailId: id1 }, direct: (texts) => renderReplyPromptNotice(texts) },
  {
    kind: "reply_result",
    view: { emailId: id1, reason: "answered" },
    direct: (texts) => renderReplyResultNotice({ reason: "answered" }, texts),
  },
  {
    kind: "trust_report_ready",
    view: {
      mailboxId: id2,
      recommended: ["info", "spam"],
      blocked: 1,
      checked: 212,
      reportUrl: "https://app.example.test/report?mailbox=22222222-2222-4222-8222-222222222222",
    },
    direct: (texts) =>
      renderTrustReportReadyNotice(
        {
          checked: 212,
          recommended: ["info", "spam"],
          reportUrl: "https://app.example.test/report?mailbox=22222222-2222-4222-8222-222222222222",
        },
        texts
      ),
  },
  {
    kind: "autonomy_paused",
    view: { mailboxId: id2, category: "info", reason: "corrections", corrections: 2, settingsUrl: null },
    direct: (texts) =>
      renderAutonomyPausedNotice({ category: "info", reason: "corrections", corrections: 2, settingsUrl: null }, texts),
  },
  {
    kind: "approval_edit",
    view: { original: "📤 Send? Contract", outcome: "approved", at: now, timeZone },
    direct: (texts) => approvalEdit({ original: "📤 Send? Contract", outcome: "approved", at: now, timeZone }, texts),
  },
  {
    kind: "not_triaged",
    view: { emailId: id1, mailboxId: id2, sender: "ceo@corp.test" },
    direct: (texts) => renderNotTriagedNotice({ sender: "ceo@corp.test" }, texts),
  },
];

// The view of a case, as the outbox row stores it.
export function stored(testCase: Case): unknown {
  return encodeNoticeView(testCase.kind, testCase.view as never);
}
