import { describe, expect, test } from "bun:test";

import { aiTextFor } from "../digest/ai-text";
import {
  renderApprovalRequest,
  renderApprovalSetRequest,
  renderDelegationAnswered,
  renderSendResult,
} from "../digest/approvals";
import { MESSAGE_MAX_CHARS, type OutMessage } from "../digest/message";
import {
  renderActionFailedNotice,
  renderAuthErrorNotice,
  renderHostBlockedNotice,
  renderSendHeldNotice,
  renderSyncOkNotice,
  renderSyncStaleNotice,
  renderUrgentNotice,
} from "../digest/notices";
import { renderWeeklyReport } from "../digest/weekly";
import { describeActions, type WouldDoAction } from "../digest/would-do";
import { weekStatsExample } from "../metrics/fixtures";
import { type CoreTexts, textTables } from "../texts";

import { encodeNoticeView } from "./encode";
import { type NoticeKind, noticeKinds, type NoticeRenderOptions } from "./kinds";
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
  // Renders with the given texts.
  direct: (texts: CoreTexts) => OutMessage;
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

describe("the weekly report view", () => {
  const view = { week: weekStatsExample(), timeZone, answeredWaiting: 0 };

  test("accepts the stored view and refuses an extra key", () => {
    expect(noticeViewSchemas.weekly_report.safeParse(view).success).toBe(true);
    expect(noticeViewSchemas.weekly_report.safeParse({ ...view, subject: "x" }).success).toBe(false);
    expect(noticeViewSchemas.weekly_report.safeParse({ ...view, answeredWaiting: -1 }).success).toBe(false);
  });

  test("refuses a week with a subject field", () => {
    expect(noticeViewSchemas.weekly_report.safeParse({ ...view, week: { ...view.week, subject: "x" } }).success).toBe(
      false
    );
  });

  test("has a renderer", () => {
    expect(noticeRenderers.weekly_report.schema).toBe(noticeViewSchemas.weekly_report);
  });
});

describe("renderNotice", () => {
  test.each(cases)("$kind renders byte-identical to its render function", (testCase) => {
    expect(renderNotice(testCase.kind, stored(testCase), opts)).toEqual({
      ok: true,
      message: testCase.direct(textTables.en),
    });
  });

  // The digest kind stores its finished text and buttons, so its render ignores the locale.
  test.each(cases.filter((testCase) => testCase.kind !== "digest"))(
    "$kind: the Polish render differs from the English render",
    (testCase) => {
      const view = stored(testCase);
      const pl = renderNotice(testCase.kind, view, { ...opts, locale: "pl" });
      const en = renderNotice(testCase.kind, view, { ...opts, locale: "en" });
      expect(pl.ok).toBe(true);
      expect(pl).not.toEqual(en);
      expect(en).toEqual({ ok: true, message: testCase.direct(textTables.en) });
    }
  );

  test.each(cases.filter((testCase) => testCase.kind === "digest"))(
    "the digest kind prints its stored text for both locales",
    (testCase) => {
      const view = stored(testCase);
      expect(renderNotice("digest", view, { ...opts, locale: "pl" })).toEqual(
        renderNotice("digest", view, { ...opts, locale: "en" })
      );
    }
  );

  test.each(cases)("$kind: the Polish texts fit one message", (testCase) => {
    const message = testCase.direct(textTables.pl);
    expect(message.text.length).toBeGreaterThan(0);
    expect(message.text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
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
    const direct = renderSendResult(
      {
        actionId: id1,
        sendKind: "delegation",
        result: sendResult,
        recipient: { name: null, address: "(unknown)" },
        subject: "Contract",
        synthetic: false,
      },
      textTables.en
    );
    const result = renderNotice("send_result", view, opts);
    expect(result).toEqual({ ok: true, message: direct });
    expect(direct.text).toContain("(unknown)");
  });

  test("a send_result accepts a view without mistakeButton (an old row) and with it", () => {
    const old = {
      actionId: id1,
      sendKind: "delegation",
      result: sendResult,
      recipient: { name: "Anna Nowak", address: "anna@example.test" },
      subject: "Contract",
      synthetic: false,
    };
    expect(noticeViewSchemas.send_result.safeParse(old).success).toBe(true);
    expect(noticeViewSchemas.send_result.safeParse({ ...old, mistakeButton: true }).success).toBe(true);
    expect(noticeViewSchemas.send_result.safeParse({ ...old, mistakeButton: "yes" }).success).toBe(false);
    const sent = { kind: "sent", sentCopy: "appended", draftRemoved: true };
    const withButton = renderNotice("send_result", { ...old, result: sent, mistakeButton: true }, opts);
    expect(withButton.ok && withButton.message.buttons).toEqual([
      [{ text: "⚠️ This was a mistake", data: `mk:${id1}` }],
    ]);
    const without = renderNotice("send_result", { ...old, result: sent }, opts);
    expect(without.ok && without.message.buttons).toEqual([]);
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

  test("the Polish status line differs from the English one", () => {
    const input = {
      original: "📤 Send 1 reminder?",
      outcome: "approved" as const,
      at: new Date("2026-11-13T10:00:00.000Z"),
      timeZone: "Europe/Warsaw",
    };
    const pl = renderNoticeEdit(input, { ...opts, locale: "pl" });
    expect(pl.text).not.toEqual(renderNoticeEdit(input, { ...opts, locale: "en" }).text);
    expect(pl.text.startsWith(input.original)).toBe(true);
  });
});
