import { describe, expect, test } from "bun:test";

import { renderNotTriagedNotice } from "../digest/notices";
import { weekStatsExample } from "../metrics/fixtures";
import { textTables } from "../texts";

import { encodeNoticeView } from "./encode";
import { id1, id2, now, timeZone, opts } from "./registry.test-helper";
import { renderNotice } from "./render";
import { noticeRenderers } from "./renderers";
import { noticeViewSchemas } from "./views";

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
