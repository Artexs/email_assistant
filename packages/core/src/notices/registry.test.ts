import { describe, expect, test } from "bun:test";

import { aiTextFor } from "../digest/ai-text";
import {
  renderApprovalRequest,
  renderApprovalSetRequest,
  renderDelegationAnswered,
  renderSendResult,
} from "../digest/approvals";
import type { OutMessage } from "../digest/message";
import {
  renderActionFailedNotice,
  renderAuthErrorNotice,
  renderSendHeldNotice,
  renderSyncOkNotice,
  renderSyncStaleNotice,
  renderUrgentNotice,
} from "../digest/notices";
import { describeActions, type WouldDoAction } from "../digest/would-do";
import { textTables } from "../texts";

import { encodeNoticeView } from "./encode";
import { MAILBOX_REMOVED_TEXT, type NoticeKind, noticeKinds, type NoticeRenderOptions } from "./kinds";
import { renderNotice, renderNoticeEdit } from "./render";
import { noticeRenderers } from "./renderers";
import { type NoticeView, noticeViewSchemas } from "./views";

const id1 = "11111111-1111-4111-8111-111111111111";
const id2 = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-11-13T10:07:33.123Z");
const receivedAt = new Date("2026-11-12T22:15:00.000Z");
const nextAt = new Date("2026-11-13T11:00:00.000Z");
const timeZone = "Europe/Warsaw";
const opts: NoticeRenderOptions = { channel: "telegram", detail: "full", locale: "en" };

const actions: WouldDoAction[] = [
  { type: "create_draft", status: "ready", folder: null, reverse: false, kind: "delegation", delegateId: id2 },
  { type: "move", status: "logged", folder: "ai_info", reverse: false, kind: null, delegateId: null },
];
const names = new Map([[id2, "Anna Nowak"]]);

const urgentView: NoticeView<"urgent"> = {
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
  now,
  timeZone,
};

const approvalView = {
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

const setItems = [
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

const sendResult = { kind: "failed", cause: "tries", code: "ETIMEDOUT", tries: 5 } as const;

interface Case {
  kind: NoticeKind;
  view: unknown;
  direct: () => OutMessage;
}

const cases: Case[] = [
  {
    kind: "digest",
    view: { text: "Digest text", buttons: [[{ text: "Open", data: "x" }]] },
    direct: () => ({ text: "Digest text", buttons: [[{ text: "Open", data: "x" }]] }),
  },
  {
    kind: "urgent",
    view: urgentView,
    direct: () =>
      renderUrgentNotice({
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
          textTables.en
        ),
        receivedAt,
        synthetic: false,
        folderTag: null,
        wouldDo: describeActions(actions, names, { stayFolder: "INBOX" }),
        now,
        timeZone,
      }),
  },
  {
    kind: "auth_error",
    view: { address: "box@example.test", mailboxId: id2, since: receivedAt, now, timeZone },
    direct: () =>
      renderAuthErrorNotice({ address: "box@example.test", mailboxId: id2, since: receivedAt, now, timeZone }),
  },
  {
    kind: "sync_stale",
    view: { address: "box@example.test", lastSyncedAt: null, now, timeZone },
    direct: () => renderSyncStaleNotice({ address: "box@example.test", lastSyncedAt: null, now, timeZone }),
  },
  {
    kind: "sync_ok",
    view: { address: "box@example.test", lastSyncedAt: receivedAt, now, timeZone },
    direct: () => renderSyncOkNotice({ address: "box@example.test", lastSyncedAt: receivedAt, now, timeZone }),
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
    direct: () =>
      renderActionFailedNotice({
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
      }),
  },
  {
    kind: "approval",
    view: { actionId: id1, view: approvalView, now, timeZone },
    direct: () => renderApprovalRequest({ actionId: id1, view: approvalView, now, timeZone }),
  },
  {
    kind: "approval_set",
    view: { setId: id1, items: setItems, timeZone },
    direct: () => renderApprovalSetRequest({ setId: id1, items: setItems, timeZone }),
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
    direct: () =>
      renderSendResult({
        actionId: id1,
        sendKind: "delegation",
        result: sendResult,
        recipient: { name: "Anna Nowak", address: "anna@example.test" },
        subject: "Contract",
        synthetic: false,
      }),
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
    direct: () =>
      renderDelegationAnswered({
        delegationId: id1,
        delegateName: "Anna Nowak",
        subject: "Contract",
        receivedAt,
        now,
        timeZone,
        synthetic: false,
      }),
  },
  { kind: "mailbox_removed", view: {}, direct: () => ({ text: MAILBOX_REMOVED_TEXT, buttons: [] }) },
  {
    kind: "send_held",
    view: { mailboxId: id1, address: "me@firma.test", limit: "mailbox_day", waiting: 2, nextAt, now, timeZone },
    direct: () =>
      renderSendHeldNotice({
        mailboxId: id1,
        address: "me@firma.test",
        limit: "mailbox_day",
        waiting: 2,
        nextAt,
        now,
        timeZone,
      }),
  },
];

// The view of a case, as the outbox row stores it.
function stored(testCase: Case): unknown {
  return encodeNoticeView(testCase.kind, testCase.view as never);
}

describe("notice registries", () => {
  test("have one entry per kind", () => {
    const kinds = [...noticeKinds].sort();
    expect(Object.keys(noticeRenderers).sort()).toEqual(kinds);
    expect(Object.keys(noticeViewSchemas).sort()).toEqual(kinds);
  });

  test("the fixture table has one case per kind", () => {
    expect(cases.map((testCase) => testCase.kind).sort()).toEqual([...noticeKinds].sort());
  });
});

describe("renderNotice", () => {
  test.each(cases)("$kind renders byte-identical to its render function", (testCase) => {
    expect(renderNotice(testCase.kind, stored(testCase), opts)).toEqual({ ok: true, message: testCase.direct() });
  });

  test("the locale does not change the en text yet", () => {
    const view = encodeNoticeView("urgent", urgentView);
    expect(renderNotice("urgent", view, { ...opts, locale: "pl" })).toEqual(renderNotice("urgent", view, opts));
  });

  test("a send_result without an address renders (unknown)", () => {
    const view = encodeNoticeView("send_result", {
      actionId: id1,
      sendKind: "delegation",
      result: sendResult,
      recipient: { name: null, address: null },
      subject: "Contract",
      synthetic: false,
    });
    const direct = renderSendResult({
      actionId: id1,
      sendKind: "delegation",
      result: sendResult,
      recipient: { name: null, address: "(unknown)" },
      subject: "Contract",
      synthetic: false,
    });
    const result = renderNotice("send_result", view, opts);
    expect(result).toEqual({ ok: true, message: direct });
    expect(direct.text).toContain("(unknown)");
  });

  test("a renderer that throws gives ok: false", () => {
    const view = { ...encodeNoticeView("urgent", urgentView), emailId: "e1" };
    expect(renderNotice("urgent", view, opts)).toEqual({ ok: false });
  });

  test("a view its schema rejects gives ok: false", () => {
    expect(renderNotice("sync_ok", { address: "x" }, opts)).toEqual({ ok: false });
  });

  test("a digest text outside 1 to 4096 characters gives ok: false", () => {
    expect(renderNotice("digest", { text: "x".repeat(4097), buttons: [] }, opts)).toEqual({ ok: false });
    expect(renderNotice("digest", { text: "", buttons: [] }, opts)).toEqual({ ok: false });
  });
});

describe("renderNoticeEdit", () => {
  test("adds the status line to the stored text", () => {
    const message = renderNoticeEdit(
      {
        original: "📤 Send 1 reminder?",
        outcome: "rejected_set",
        at: new Date("2026-11-13T10:00:00.000Z"),
        timeZone: "Europe/Warsaw",
        counts: { done: 1, skipped: 0 },
      },
      opts
    );
    expect(message.text).toBe("📤 Send 1 reminder?\n\n✖️ Skipped 11:00: 1 rejected, 0 skipped.");
  });
});
