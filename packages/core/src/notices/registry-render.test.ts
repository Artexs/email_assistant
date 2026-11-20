import { describe, expect, test } from "bun:test";

import { renderSendResult } from "../digest/approvals";
import { MESSAGE_MAX_CHARS } from "../digest/message";
import { textTables } from "../texts";

import { encodeNoticeView } from "./encode";
import { noticeKinds } from "./kinds";
import { id1, opts, urgentView, sendResult, cases, stored } from "./registry.test-helper";
import { renderNotice, renderNoticeEdit } from "./render";
import { noticeRenderers } from "./renderers";
import { type NoticeView, noticeViewSchemas } from "./views";

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
