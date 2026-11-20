import { describe, expect, test } from "bun:test";

import { MESSAGE_MAX_CHARS } from "../digest/message";
import { movingCategories, tripReasons } from "../trust";

import { encodeNoticeView, NoticeViewError } from "./encode";
import type { NoticeRenderOptions } from "./kinds";
import { renderNotice } from "./render";
import { noticeViewSchemas, trustReportUrlSchema, trustSettingsUrlSchema } from "./views";

// The two trust notice kinds (category names, counts and fixed phrases only).
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
      `📋 Sprawdzanie poczty z ostatnich 30 dni zakończone. Przejrzane wiadomości: 212.\nPolecane do włączenia: Info, Spam\nRaport: ${reportUrl}`
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
    const tail = `\nTurn them on again in Settings.\nSettings: ${settingsUrl}`;
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
      for (const category of movingCategories) {
        for (const locale of locales) {
          const text = textOf("autonomy_paused", paused(reason, { category }), locale);
          expect(text.length).toBeGreaterThan(0);
          expect(text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
          expect(text).not.toMatch(/undefined|null|NaN|\[object/);
          expect(text.startsWith("⏸ ")).toBe(true);
          expect(text).toContain(
            locale === "en" ? "Turn them on again in Settings." : "Włącz je ponownie w Ustawieniach."
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
      "poprawiono 5 z tych przeniesień."
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
    // Trips count `move` actions: only the moving categories can be paused (a text "Automatic moves for Urgent" would be wrong).
    for (const category of ["urgent", "needs_reply", "unsure", "delegation"]) {
      expect(noticeViewSchemas.autonomy_paused.safeParse(paused("corrections", { category })).success).toBe(false);
    }
    expect(renderNotice("autonomy_paused", paused("corrections", { sender: "a@b.test" }), opts("pl"))).toEqual({
      ok: false,
    });
  });

  test("the text holds no field of the view that is not a category, a count or a fixed phrase (D15)", () => {
    const canary = "99999999-9999-4999-8999-999999999999";
    const text = textOf("autonomy_paused", { ...paused("corrections"), mailboxId: canary }, "en");
    expect(text).not.toContain(canary);
    const ok = textOf("trust_report_ready", { ...ready, mailboxId: canary, reportUrl: null }, "en");
    expect(ok).not.toContain(canary);
  });
});

// A review fix: every text is pinned in en and pl, and the links are strict.
describe("pinned texts", () => {
  const plPrefix = "⏸ Automatyczne przenoszenie wiadomości z kategorii „Powiadomienie” zostało wstrzymane";
  const plTail = `\nWłącz je ponownie w Ustawieniach.\nUstawienia: ${settingsUrl}`;
  const enPrefix = "⏸ Automatic moves for Notification are off";
  const enTail = `\nTurn them on again in Settings.\nSettings: ${settingsUrl}`;
  const exact: [string, string, string][] = [
    ["corrections", "you corrected 2 of them in 7 days.", "w ciągu 7 dni poprawiono 2 z tych przeniesień."],
    [
      "important_hidden",
      "one of them hid a mail you needed.",
      "jedno z przeniesień ukryło wiadomość, która była Ci potrzebna.",
    ],
    [
      "model_switch",
      "the AI model changed and has no proof yet for this category.",
      "zmienił się model AI, a nowy model nie ma jeszcze potwierdzonych wyników dla tej kategorii.",
    ],
    ["evidence_changed", "new test results no longer support them.", "nowe wyniki testów już go nie uzasadniają."],
    [
      "history_fail",
      "the check of your last 30 days found mail you needed among them.",
      "sprawdzenie poczty z ostatnich 30 dni wykryło wśród przeniesionych wiadomości takie, które były Ci potrzebne.",
    ],
  ];

  test.each(exact)("%s: exact en and pl text", (reason, en, pl) => {
    expect(textOf("autonomy_paused", paused(reason), "en")).toBe(`${enPrefix}: ${en}${enTail}`);
    expect(textOf("autonomy_paused", paused(reason), "pl")).toBe(`${plPrefix}: ${pl}${plTail}`);
  });

  test("the Polish category name is quoted", () => {
    expect(textOf("autonomy_paused", paused("history_fail", { category: "notification" }), "pl")).toContain(
      "z kategorii „Powiadomienie” zostało"
    );
  });

  test("ready: exact pl text with no category, and the checked counts 0 and 1 in en", () => {
    expect(textOf("trust_report_ready", { ...ready, recommended: [], reportUrl: null }, "pl")).toBe(
      "📋 Sprawdzanie poczty z ostatnich 30 dni zakończone. Przejrzane wiadomości: 212.\nNa razie nie ma nic do włączenia."
    );
    expect(textOf("trust_report_ready", { ...ready, checked: 0, reportUrl: null }, "en")).toContain(
      "looked at 0 mails"
    );
    expect(textOf("trust_report_ready", { ...ready, checked: 1, reportUrl: null }, "en")).toContain(
      "looked at 1 mail from"
    );
  });
});

describe("the links of a trust notice (TG1)", () => {
  const good = (value: string) =>
    noticeViewSchemas.trust_report_ready.safeParse({ ...ready, reportUrl: value }).success;
  // The link schema alone: the view check of the mailbox id must not be the only guard.
  const schemaGood = (value: string) => trustReportUrlSchema.safeParse(value).success;
  const goodSettings = (value: string) =>
    noticeViewSchemas.autonomy_paused.safeParse(paused("corrections", { settingsUrl: value })).success;

  test("the two real forms pass, http too", () => {
    expect(good(reportUrl)).toBe(true);
    expect(good(`http://localhost:8081/report?mailbox=${mailboxId}`)).toBe(true);
    expect(goodSettings(settingsUrl)).toBe(true);
    expect(goodSettings("http://localhost:8081/settings")).toBe(true);
  });

  const host = "https://app.example.test";
  const bad: [string, string][] = [
    ["userinfo", `https://user:pw@app.example.test/report?mailbox=${mailboxId}`],
    ["user only", `https://app.test@evil.test/report?mailbox=${mailboxId}`],
    ["NUL", `${host}/report?mailbox=${mailboxId}\u0000`],
    ["BEL", `${host}/report?mailbox=${mailboxId}\u0007`],
    ["ESC", `${host}/rep\u001bort?mailbox=${mailboxId}`],
    ["right-to-left override", `${host}/report?mailbox=${mailboxId}\u202e`],
    ["isolate", `${host}/report?mailbox=${mailboxId}\u2066`],
    ["zero width space", `${host}/re\u200bport?mailbox=${mailboxId}`],
    ["address in the query", `${host}/report?mailbox=${mailboxId}&to=boss@corp.test`],
    ["other query", `${host}/report?mailbox=boss@corp.test`],
    ["no query", `${host}/report`],
    ["fragment", `${host}/report?mailbox=${mailboxId}#boss@corp.test`],
    ["other path", `${host}/approvals?mailbox=${mailboxId}`],
    ["upper case scheme", `HTTPS://app.example.test/report?mailbox=${mailboxId}`],
    ["javascript", "javascript:alert(1)"],
    ["data", "data:text/html,x"],
    ["too long", `https://${"a".repeat(300)}.test/report?mailbox=${mailboxId}`],
  ];

  test.each(bad)("report link refused: %s", (_name, value) => {
    expect(good(value)).toBe(false);
    expect(schemaGood(value)).toBe(false);
  });

  test.each([
    ["zero width space in the host", `https://app\u200b.example.test/report?mailbox=${mailboxId}`],
    ["right-to-left override in the host", `https://app\u202e.example.test/report?mailbox=${mailboxId}`],
    ["isolate in the host", `https://app\u2066.example.test/settings`],
  ])("a format character in the host is refused: %s", (_name, value) => {
    expect(schemaGood(value)).toBe(false);
    expect(trustSettingsUrlSchema.safeParse(value).success).toBe(false);
  });

  test.each([
    ["userinfo", "https://user:pw@app.example.test/settings"],
    ["user only", "https://app.test@evil.test/settings"],
    ["BEL", `${settingsUrl}\u0007`],
    ["bidi", `${settingsUrl}\u202e`],
    ["address in the query", `${settingsUrl}?to=boss@corp.test`],
    ["fragment", `${settingsUrl}#x`],
    ["other path", "https://app.example.test/report"],
    ["javascript", "javascript:alert(1)"],
    ["upper case scheme", "HTTPS://app.example.test/settings"],
  ])("settings link refused: %s", (_name, value) => {
    expect(goodSettings(value)).toBe(false);
  });

  test.each([
    ["a password with no user name", "https://:pw@app.example.test/settings"],
    ["text that passes the pattern but is no URL", "https://["],
  ])("the settings link schema refuses %s", (_name, value) => {
    expect(trustSettingsUrlSchema.safeParse(value).success).toBe(false);
  });

  test("the report link schema refuses 36 characters that are not a uuid", () => {
    expect(trustReportUrlSchema.safeParse(`${host}/report?mailbox=${"0".repeat(36)}`).success).toBe(false);
  });

  test("a report link of another mailbox than the view is refused", () => {
    expect(good(`${host}/report?mailbox=99999999-9999-4999-8999-999999999999`)).toBe(false);
  });
});

describe("hardening of the views", () => {
  test("a mailbox id that is not a uuid is refused (an address cannot ride in it)", () => {
    expect(
      noticeViewSchemas.trust_report_ready.safeParse({ ...ready, mailboxId: "boss@corp.test", reportUrl: null }).success
    ).toBe(false);
    expect(
      noticeViewSchemas.autonomy_paused.safeParse(paused("corrections", { mailboxId: "boss@corp.test" })).success
    ).toBe(false);
  });

  test("a duplicate category is refused", () => {
    expect(noticeViewSchemas.trust_report_ready.safeParse({ ...ready, recommended: ["info", "info"] }).success).toBe(
      false
    );
  });
});
