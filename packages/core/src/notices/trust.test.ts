import { describe, expect, test } from "bun:test";

import { MESSAGE_MAX_CHARS } from "../digest/message";
import { barCategories } from "../triage/metrics";
import { movingCategories, tripReasons } from "../trust";

import { encodeNoticeView, NoticeViewError } from "./encode";
import type { NoticeRenderOptions } from "./kinds";
import { renderNotice } from "./render";
import { noticeViewSchemas } from "./views";

// F110 stage 10: the two trust notice kinds (D15: category names, counts and fixed phrases only).
const mailboxId = "22222222-2222-4222-8222-222222222222";
const reportUrl = `https://app.example.test/report?mailbox=${mailboxId}`;
const settingsUrl = "https://app.example.test/settings";
const locales = ["en", "pl"] as const;

function opts(locale: "en" | "pl"): NoticeRenderOptions {
  return { channel: "telegram", detail: "full", locale };
}

function textOf(kind: "trust_report_ready" | "autonomy_paused", view: unknown, locale: "en" | "pl"): string {
  const result = renderNotice(kind, view, opts(locale));
  if (!result.ok) throw new Error(`${kind} did not render`);
  return result.message.text;
}

const ready = { mailboxId, recommended: ["info", "spam"], blocked: 1, checked: 212, reportUrl };
const paused = (reason: string, extra: object = {}) => ({
  mailboxId,
  category: "notification",
  reason,
  corrections: 2,
  settingsUrl,
  ...extra,
});

describe("trust_report_ready", () => {
  test("the English text is the one of the stage (counts, categories, link line)", () => {
    expect(textOf("trust_report_ready", ready, "en")).toBe(
      `📋 Your check is ready: I looked at 212 mails from the last 30 days.\nRecommended: Info, Spam\nReport: ${reportUrl}`
    );
  });

  test("no recommended category: 'Nothing to turn on yet.'", () => {
    const view = { ...ready, recommended: [] };
    expect(textOf("trust_report_ready", view, "en")).toContain("\nNothing to turn on yet.\n");
    expect(textOf("trust_report_ready", view, "pl")).toContain("\nNa razie nie ma nic do włączenia.\n");
    expect(textOf("trust_report_ready", view, "en")).not.toContain("Recommended");
  });

  test("the Polish text names the categories and has full diacritics", () => {
    expect(textOf("trust_report_ready", ready, "pl")).toBe(
      `📋 Sprawdzenie jest gotowe. Przejrzane wiadomości z ostatnich 30 dni: 212.\nPolecane do włączenia: Info, Spam\nRaport: ${reportUrl}`
    );
  });

  test("one mail reads '1 mail' in English", () => {
    expect(textOf("trust_report_ready", { ...ready, checked: 1 }, "en")).toContain("looked at 1 mail from");
  });

  test("reportUrl null: no link line (T4)", () => {
    for (const locale of locales) {
      const text = textOf("trust_report_ready", { ...ready, reportUrl: null }, locale);
      expect(text.split("\n")).toHaveLength(2);
      expect(text).not.toContain("http");
    }
  });

  test("every subset of categories fits one message and prints no undefined (T1)", () => {
    for (const locale of locales) {
      const text = textOf("trust_report_ready", { ...ready, recommended: [...movingCategories] }, locale);
      expect(text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
      expect(text).not.toMatch(/undefined|null|NaN/);
    }
  });

  test("an extra key fails the strict schema (T2, D15: no address)", () => {
    expect(noticeViewSchemas.trust_report_ready.safeParse({ ...ready, sender: "boss@corp.test" }).success).toBe(false);
    expect(() => encodeNoticeView("trust_report_ready", { ...ready, sender: "boss@corp.test" } as never)).toThrow(
      NoticeViewError
    );
    expect(renderNotice("trust_report_ready", { ...ready, subject: "x" }, opts("en"))).toEqual({ ok: false });
  });

  test("an unknown category, a negative count and a bad link are refused", () => {
    expect(noticeViewSchemas.trust_report_ready.safeParse({ ...ready, recommended: ["urgent"] }).success).toBe(false);
    expect(noticeViewSchemas.trust_report_ready.safeParse({ ...ready, checked: -1 }).success).toBe(false);
    expect(noticeViewSchemas.trust_report_ready.safeParse({ ...ready, reportUrl: "javascript:alert(1)" }).success).toBe(
      false
    );
    expect(noticeViewSchemas.trust_report_ready.safeParse({ ...ready, reportUrl: undefined }).success).toBe(false);
  });
});

describe("autonomy_paused", () => {
  test("the English text of each reason is the one of the stage", () => {
    const tail = `\nTurn it on again in Settings.\nSettings: ${settingsUrl}`;
    expect(textOf("autonomy_paused", paused("corrections"), "en")).toBe(
      `⏸ Automatic moves for Notification are off: you corrected 2 of them in 7 days.${tail}`
    );
    expect(textOf("autonomy_paused", paused("important_hidden"), "en")).toBe(
      `⏸ Automatic moves for Notification are off: one of them hid a mail you needed.${tail}`
    );
    expect(textOf("autonomy_paused", paused("model_switch"), "en")).toBe(
      `⏸ Automatic moves for Notification are off: the AI model changed and has no proof yet for this category.${tail}`
    );
    expect(textOf("autonomy_paused", paused("evidence_changed"), "en")).toBe(
      `⏸ Automatic moves for Notification are off: new test results no longer support them.${tail}`
    );
    expect(textOf("autonomy_paused", paused("history_fail"), "en")).toBe(
      `⏸ Automatic moves for Notification are off: the check of your last 30 days found mail you needed among them.${tail}`
    );
  });

  test("every reason, category and locale fits one message with no undefined (T1)", () => {
    for (const reason of tripReasons) {
      for (const category of barCategories) {
        for (const locale of locales) {
          const text = textOf("autonomy_paused", paused(reason, { category }), locale);
          expect(text.length).toBeGreaterThan(0);
          expect(text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
          expect(text).not.toMatch(/undefined|null|NaN|\[object/);
          expect(text.startsWith("⏸ ")).toBe(true);
          expect(text).toContain(
            locale === "en" ? "Turn it on again in Settings." : "Włącz je ponownie w Ustawieniach."
          );
        }
      }
    }
  });

  test("the Polish text differs from the English text for each reason, and reads without a count noun", () => {
    for (const reason of tripReasons) {
      expect(textOf("autonomy_paused", paused(reason), "pl")).not.toBe(textOf("autonomy_paused", paused(reason), "en"));
    }
    expect(textOf("autonomy_paused", paused("corrections", { corrections: 5 }), "pl")).toContain(
      "Liczba Twoich poprawek w ciągu 7 dni: 5."
    );
  });

  test("settingsUrl null: no link line (T4)", () => {
    for (const locale of locales) {
      const text = textOf("autonomy_paused", paused("history_fail", { settingsUrl: null }), locale);
      expect(text.split("\n")).toHaveLength(2);
      expect(text).not.toContain("http");
    }
  });

  test("an extra key and an unknown reason fail the strict schema (T2)", () => {
    expect(noticeViewSchemas.autonomy_paused.safeParse(paused("corrections", { domain: "corp.test" })).success).toBe(
      false
    );
    expect(noticeViewSchemas.autonomy_paused.safeParse(paused("bogus")).success).toBe(false);
    expect(noticeViewSchemas.autonomy_paused.safeParse(paused("corrections", { category: "delegation" })).success).toBe(
      false
    );
    expect(renderNotice("autonomy_paused", paused("corrections", { sender: "a@b.test" }), opts("pl"))).toEqual({
      ok: false,
    });
  });

  test("the text holds no field of the view that is not a category, a count or a fixed phrase (D15)", () => {
    const canary = "canary-mailbox-0000-4000-8000-000000000000";
    const text = textOf("autonomy_paused", { ...paused("corrections"), mailboxId: canary }, "en");
    expect(text).not.toContain(canary);
    const ok = textOf("trust_report_ready", { ...ready, mailboxId: canary }, "en");
    expect(ok.replace(reportUrl, "")).not.toContain(canary);
  });
});
