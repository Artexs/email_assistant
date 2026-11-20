import { describe, expect, test } from "bun:test";

import { aiTextFor } from "../digest/ai-text";
import {
  approvalEdit,
  renderApprovalRequest,
  renderApprovalSetRequest,
  renderDelegationAnswered,
  renderSendResult,
} from "../digest/approvals";
import { MESSAGE_MAX_CHARS, type OutMessage } from "../digest/message";
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
import { type CoreTexts, textTables } from "../texts";

import { encodeNoticeView } from "./encode";
import { type NoticeKind, noticeChannels, noticeKinds, type NoticeRenderOptions, reportMailKinds } from "./kinds";
import { pushKinds, pushPayloadSchema } from "./push";
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
  suspicious: ["link_mismatch"],
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

describe("the not_triaged view (F109 stage 15, test 9)", () => {
  const view = { emailId: id1, mailboxId: id2, sender: "ceo@corp.test" };

  test("renders the fixed phrase with the address, in English and Polish, with no button", () => {
    expect(renderNotice("not_triaged", encodeNoticeView("not_triaged", view), opts)).toEqual({
      ok: true,
      message: {
        text: "📭 Mail from ceo@corp.test is not triaged yet: the AI service is paused. It is triaged when the service is back.",
        buttons: [],
      },
    });
    expect(renderNotice("not_triaged", encodeNoticeView("not_triaged", view), { ...opts, locale: "pl" })).toEqual({
      ok: true,
      message: {
        text: "📭 Wiadomość od ceo@corp.test nie jest jeszcze posortowana: usługa AI ma przerwę. Zostanie posortowana, gdy usługa wróci.",
        buttons: [],
      },
    });
  });

  test("a bidi override in the address is removed", () => {
    const message = renderNotTriagedNotice({ sender: "ceo@\u202ecorp.test" }, textTables.en);
    expect(message.text).toContain("ceo@corp.test");
    expect(message.text).not.toContain("\u202e");
  });

  test("a subject, a name or any extra key is refused by the strict view", () => {
    expect(noticeViewSchemas.not_triaged.safeParse(view).success).toBe(true);
    for (const extra of [{ subject: "x" }, { fromName: "x" }, { summary: "x" }]) {
      expect(noticeViewSchemas.not_triaged.safeParse({ ...view, ...extra }).success).toBe(false);
    }
  });
});

describe("the sent_missing view", () => {
  const view = { address: "boss@x.test", since: new Date("2026-11-12T09:00:00Z"), now, timeZone };

  test("accepts the stored view, refuses an extra field and a missing since", () => {
    const stored = encodeNoticeView("sent_missing", view);
    expect(noticeViewSchemas.sent_missing.safeParse(stored).success).toBe(true);
    expect(noticeViewSchemas.sent_missing.safeParse({ ...stored, subject: "x" }).success).toBe(false);
    expect(noticeViewSchemas.sent_missing.safeParse({ ...stored, since: undefined }).success).toBe(false);
  });
});

describe("the mailbox_removed view (F117 stage 12, test 5)", () => {
  const render = (locale: "en" | "pl", view: unknown) => renderNotice("mailbox_removed", view, { ...opts, locale });
  const table = {
    en: {
      googleRevoked: "Mailbox removed. Its Google access is withdrawn.",
      googleFailed: "Mailbox removed. Withdraw its access at myaccount.google.com/permissions now.",
      microsoftWork: "Mailbox removed. Withdraw the app's access at myapps.microsoft.com now.",
      microsoftPersonal: "Mailbox removed. Withdraw the app's access at account.live.com/consent/Manage now.",
    },
    pl: {
      googleRevoked: "Skrzynka usunięta. Dostęp przez Google został cofnięty.",
      googleFailed: "Skrzynka usunięta. Cofnij teraz dostęp na myaccount.google.com/permissions.",
      microsoftWork: "Skrzynka usunięta. Cofnij teraz dostęp aplikacji na myapps.microsoft.com.",
      microsoftPersonal: "Skrzynka usunięta. Cofnij teraz dostęp aplikacji na account.live.com/consent/Manage.",
    },
  } as const;
  const views = {
    googleRevoked: { access: { page: "google", revoked: true } },
    googleFailed: { access: { page: "google", revoked: false } },
    microsoftWork: { access: { page: "microsoft_work", revoked: null } },
    microsoftPersonal: { access: { page: "microsoft_personal", revoked: null } },
  } as const;

  test.each(["en", "pl"] as const)("the four texts in %s, word for word", (locale) => {
    for (const key of Object.keys(views) as (keyof typeof views)[]) {
      expect(render(locale, views[key])).toEqual({ ok: true, message: { text: table[locale][key], buttons: [] } });
    }
  });

  test("a row without the access field renders today's text, and an unknown page or an extra key is refused", () => {
    expect(render("en", {})).toEqual({
      ok: true,
      message: { text: textTables.en.notices.mailboxRemoved, buttons: [] },
    });
    expect(render("pl", {})).toEqual({
      ok: true,
      message: { text: textTables.pl.notices.mailboxRemoved, buttons: [] },
    });
    expect(render("en", { access: { page: "yahoo", revoked: null } }).ok).toBe(false);
    expect(render("en", { access: { page: "google", revoked: null, token: "x" } }).ok).toBe(false);
  });

  test("the encoded view keeps the access field", () => {
    expect(encodeNoticeView("mailbox_removed", views.googleFailed as never)).toEqual(views.googleFailed);
  });
});

describe("the approval_edit view", () => {
  const view = {
    original: "📤 Send? Contract",
    outcome: "approved" as const,
    at: new Date("2026-11-20T13:05:00.000Z"),
    timeZone: "Europe/Warsaw",
  };
  const stored = encodeNoticeView("approval_edit", view);

  test("T5: renders the stored text and one status line, with no buttons", () => {
    expect(renderNotice("approval_edit", stored, opts)).toEqual({
      ok: true,
      message: { text: "📤 Send? Contract\n\n⏳ Approved 14:05, sending.", buttons: [] },
    });
  });

  test("every outcome renders; approved_held keeps Reject for its send", () => {
    for (const outcome of ["approved", "rejected", "changed", "expired"] as const) {
      expect(renderNotice("approval_edit", encodeNoticeView("approval_edit", { ...view, outcome }), opts).ok).toBe(
        true
      );
    }
    const held = renderNotice(
      "approval_edit",
      encodeNoticeView("approval_edit", { ...view, outcome: "approved_held", heldBy: "scope", actionId: id1 }),
      opts
    );
    expect(held.ok && held.message.buttons).toEqual([[{ text: "✖️ Reject", data: `ar:${id1}` }]]);
    // No heldBy: the view renders to nothing, so queueNotice refuses it.
    expect(renderNotice("approval_edit", { ...stored, outcome: "approved_held" }, opts)).toEqual({ ok: false });
  });

  test("T5: an extra field, an unknown outcome and an empty text are refused", () => {
    expect(noticeViewSchemas.approval_edit.safeParse({ ...stored, counts: { done: 1, skipped: 0 } }).success).toBe(
      false
    );
    expect(noticeViewSchemas.approval_edit.safeParse({ ...stored, outcome: "approved_set" }).success).toBe(false);
    expect(noticeViewSchemas.approval_edit.safeParse({ ...stored, original: "" }).success).toBe(false);
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

  test("an urgent view queued before F109 has no suspicious field and renders without a warning", () => {
    const old: NoticeView<"urgent"> = { ...urgentView };
    delete old.suspicious;
    const encoded = encodeNoticeView("urgent", old);
    expect("suspicious" in encoded).toBe(false);
    const rendered = renderNotice("urgent", encoded, opts);
    expect(rendered.ok && rendered.message.text).not.toContain("⚠");
    const withField = renderNotice("urgent", encodeNoticeView("urgent", urgentView), opts);
    expect(withField.ok && withField.message.text).toContain("⚠");
    expect(noticeViewSchemas.urgent.safeParse({ ...encoded, suspicious: ["bogus"] }).success).toBe(false);
  });

  test("an urgent view queued before the attachment line has no field; a view with the field prints the line", () => {
    const old: NoticeView<"urgent"> = { ...urgentView };
    expect("attachments" in old).toBe(false);
    const oldRendered = renderNotice("urgent", encodeNoticeView("urgent", old), opts);
    expect(oldRendered.ok && oldRendered.message.text).not.toContain("📎");
    const view: NoticeView<"urgent"> = {
      ...urgentView,
      attachments: { attachments: [{ name: "a.pdf", type: "application/pdf", size: 10, inline: false }], count: 1 },
    };
    const rendered = renderNotice("urgent", encodeNoticeView("urgent", view), opts);
    expect(rendered.ok && rendered.message.text).toContain("📎 1: a.pdf (10 B)");
    const encoded = encodeNoticeView("urgent", view);
    expect(noticeViewSchemas.urgent.safeParse({ ...encoded, attachments: { attachments: [], count: 0 } }).success).toBe(
      false
    );
    expect(
      noticeViewSchemas.urgent.safeParse({ ...encoded, attachments: { count: 1, attachments: [], extra: 1 } }).success
    ).toBe(false);
  });

  test("an urgent view with the why keys prints the mark; a bad key is refused", () => {
    const view: NoticeView<"urgent"> = { ...urgentView, confidence: 0.87, rule: null };
    const rendered = renderNotice("urgent", encodeNoticeView("urgent", view), opts);
    expect(rendered.ok && rendered.message.text).toContain(" · 85%");
    const ruled = renderNotice("urgent", encodeNoticeView("urgent", { ...view, rule: "vip" }), opts);
    expect(ruled.ok && ruled.message.text).toContain(" · rule: VIP sender");
    const encoded = encodeNoticeView("urgent", view);
    for (const bad of [{ confidence: 1.5 }, { confidence: "high" }, { rule: "boss@firma.test" }]) {
      expect(noticeViewSchemas.urgent.safeParse({ ...encoded, ...bad }).success).toBe(false);
    }
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

describe("the mail channel (F110 stage 20)", () => {
  const mail: NoticeRenderOptions = { channel: "mail", detail: "full", locale: "en" };

  test("exactly the report kinds have a mail renderer", () => {
    const withMail = noticeKinds.filter((kind) => noticeRenderers[kind].mail !== undefined);
    expect([...withMail].sort()).toEqual([...reportMailKinds].sort());
  });

  test("a report kind renders the text of its Telegram notice with no button, in both languages", () => {
    for (const locale of ["en", "pl"] as const) {
      for (const kind of reportMailKinds) {
        const testCase = cases.find((candidate) => candidate.kind === kind);
        if (testCase === undefined) throw new Error("no case");
        const view = stored(testCase);
        const telegram = renderNotice(kind, view, { ...opts, locale });
        const rendered = renderNotice(kind, view, { ...mail, locale });
        expect(telegram.ok && rendered.ok).toBe(true);
        if (!telegram.ok || !rendered.ok) continue;
        expect(rendered.message.text).toBe(telegram.message.text);
        expect(rendered.message.buttons).toEqual([]);
      }
    }
  });

  test("a digest row with buttons loses them in the mail", () => {
    const rendered = renderNotice("digest", { text: "x", buttons: [[{ text: "Open", data: "d" }]] }, mail);
    expect(rendered).toEqual({ ok: true, message: { text: "x", buttons: [] } });
    expect(renderNotice("digest", { text: "x", buttons: [[{ text: "Open", data: "d" }]] }, opts).ok).toBe(true);
  });

  test("every other kind answers { ok: false } for a mail row: urgent mail and approvals never go by mail", () => {
    for (const testCase of cases) {
      if ((reportMailKinds as readonly string[]).includes(testCase.kind)) continue;
      expect(renderNotice(testCase.kind, stored(testCase), mail), testCase.kind).toEqual({ ok: false });
    }
  });

  test("a view that its schema rejects gives { ok: false } for a mail row", () => {
    expect(renderNotice("digest", { text: "", buttons: [] }, mail)).toEqual({ ok: false });
  });

  test("renderNoticeEdit throws for a mail row: a card edit has no mail form", () => {
    const input = {
      original: "x",
      outcome: "approved" as const,
      at: new Date("2026-11-13T10:00:00.000Z"),
      timeZone: "Europe/Warsaw",
    };
    expect(() => renderNoticeEdit(input, mail)).toThrow("no card edit for channel mail");
  });
});

describe("the push channel (F118 stage 08)", () => {
  const push: NoticeRenderOptions = { channel: "push", detail: "full", locale: "en" };

  // Plants a CANARY string in every string field of the stored view that the strict schema still accepts (free text, names, ids).
  // A field that the schema restricts (a date, a code, a UUID) keeps its value. The planted view stays valid.
  function planted(kind: NoticeKind, view: unknown): unknown {
    const schema = noticeViewSchemas[kind];
    let current = JSON.parse(JSON.stringify(view)) as unknown;
    let n = 0;
    const paths: (string | number)[][] = [];
    const walk = (value: unknown, path: (string | number)[]): void => {
      if (typeof value === "string") paths.push(path);
      else if (Array.isArray(value)) value.forEach((item, index) => walk(item, [...path, index]));
      else if (typeof value === "object" && value !== null) {
        for (const [key, item] of Object.entries(value)) walk(item, [...path, key]);
      }
    };
    walk(current, []);
    for (const path of paths) {
      const copy = JSON.parse(JSON.stringify(current)) as Record<string | number, unknown>;
      let target = copy;
      for (const key of path.slice(0, -1)) target = target[key] as Record<string | number, unknown>;
      n += 1;
      target[path[path.length - 1] as string | number] = `CANARY${n}SUBJFROMBODY`;
      if (schema.safeParse(copy).success) current = copy;
    }
    return current;
  }

  test("1. exactly the push kinds have a push renderer; every other kind answers { ok: false } for a push row", () => {
    expect(noticeKinds.filter((kind) => noticeRenderers[kind].push !== undefined).sort()).toEqual(
      [...pushKinds].sort()
    );
    expect([...noticeChannels]).toEqual(["telegram", "mail", "push"]);
    for (const testCase of cases) {
      if ((pushKinds as readonly string[]).includes(testCase.kind)) continue;
      expect(renderNotice(testCase.kind, stored(testCase), push), testCase.kind).toEqual({ ok: false });
    }
  });

  test("2. every push kind renders exactly v, kind, count, itemId and lang, and no string of the view but the item id", () => {
    for (const kind of pushKinds) {
      const testCase = cases.find((candidate) => candidate.kind === kind);
      if (testCase === undefined) throw new Error(`no case for ${kind}`);
      const view = planted(kind, stored(testCase));
      for (const locale of ["en", "pl"] as const) {
        const rendered = renderNotice(kind, view, { ...push, locale });
        expect(rendered.ok, kind).toBe(true);
        if (!rendered.ok) continue;
        expect(rendered.message.buttons, kind).toEqual([]);
        const body = JSON.parse(rendered.message.text) as Record<string, unknown>;
        expect(Object.keys(body).sort(), kind).toEqual(["count", "itemId", "kind", "lang", "v"]);
        expect(body.kind).toBe(kind);
        expect(body.lang).toBe(locale);
        expect(body.v).toBe(1);
        // The payload passes the strict schema of the service worker once the sender has added `id`.
        expect(pushPayloadSchema.safeParse({ ...body, id: "row" }).success, kind).toBe(true);
        const { itemId, ...rest } = body;
        expect(JSON.stringify(rest), kind).not.toContain("CANARY");
        const expected = {
          approval: (view as { actionId: string }).actionId,
          send_result: (view as { actionId: string }).actionId,
          approval_set: (view as { setId: string }).setId,
          delegation_answered: (view as { delegationId: string }).delegationId,
        }[kind as string];
        expect(itemId, kind).toBe(expected ?? null);
      }
      // The planting reached the free text of the view: the view is not the clean fixture any more.
      if (["urgent", "approval", "send_result", "delegation_answered", "not_triaged", "approval_set"].includes(kind)) {
        expect(JSON.stringify(view), kind).toContain("CANARY");
      }
    }
  });

  test("3. an approval set of 3 items counts 3; an approval names its action id; the mail id of an urgent mail never goes out", () => {
    const set = { setId: id1, items: [...setItems, { ...setItems[0], n: 3 }], timeZone };
    const rendered = renderNotice("approval_set", encodeNoticeView("approval_set", set as never), push);
    expect(rendered.ok && JSON.parse(rendered.message.text)).toEqual({
      v: 1,
      kind: "approval_set",
      count: 3,
      itemId: id1,
      lang: "en",
    });
    const approval = renderNotice(
      "approval",
      encodeNoticeView("approval", { actionId: id2, view: approvalView, now, timeZone }),
      push
    );
    expect(approval.ok && JSON.parse(approval.message.text)).toEqual({
      v: 1,
      kind: "approval",
      count: 1,
      itemId: id2,
      lang: "en",
    });
    const urgent = renderNotice("urgent", encodeNoticeView("urgent", urgentView), { ...push, locale: "pl" });
    expect(urgent.ok && JSON.parse(urgent.message.text)).toEqual({
      v: 1,
      kind: "urgent",
      count: 1,
      itemId: null,
      lang: "pl",
    });
    expect(urgent.ok && urgent.message.text).not.toContain(id1);
  });

  test("4. replies_ready counts its replies, a count over the payload limit is cut, an item id over 64 characters fails the render", () => {
    const ready = (count: number) =>
      renderNotice("replies_ready", encodeNoticeView("replies_ready", { count, now, timeZone, review: true }), push);
    expect(ready(3).ok && JSON.parse((ready(3) as { message: OutMessage }).message.text).count).toBe(3);
    expect(ready(1_000_000).ok && JSON.parse((ready(1_000_000) as { message: OutMessage }).message.text).count).toBe(
      99_999
    );
    const long = renderNotice(
      "delegation_answered",
      encodeNoticeView("delegation_answered", {
        delegationId: "d".repeat(65),
        delegateName: "Anna",
        subject: null,
        receivedAt,
        now,
        timeZone,
        synthetic: false,
      }),
      push
    );
    expect(long).toEqual({ ok: false });
  });

  test("5. a view that its schema rejects gives { ok: false } for a push row, and a card edit still throws", () => {
    expect(renderNotice("urgent", { emailId: id1 }, push)).toEqual({ ok: false });
    const input = {
      original: "x",
      outcome: "approved" as const,
      at: new Date("2026-11-13T10:00:00.000Z"),
      timeZone: "Europe/Warsaw",
    };
    expect(() => renderNoticeEdit(input, push)).toThrow("no card edit for channel push");
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
