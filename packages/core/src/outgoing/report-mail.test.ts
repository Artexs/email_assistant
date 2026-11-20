import { describe, expect, test } from "bun:test";

import { renderAutonomyPausedNotice } from "../digest/notices";
import { textTables } from "../texts";

import {
  buildReportMail,
  escapeHtml,
  isLinkOfBase,
  reportMailHtml,
  reportMailMessageId,
  reportMailSubject,
  type ReportMailInput,
} from "./report-mail";

const ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-11-17T10:00:00.000Z");
const BASE = "https://app.example.test";

const input: ReportMailInput = {
  outboxId: ID,
  kind: "digest",
  mailboxAddress: "Boss@Firma.test",
  locale: "en",
  text: "📬 Digest\nOpen: https://app.example.test/activity?category=spam.",
  now: NOW,
  linkBase: BASE,
};

describe("buildReportMail", () => {
  test("the sender and the only recipient are the mailbox itself; the header holds the outbox id", () => {
    const message = buildReportMail(input);
    expect(message.from.address).toBe("Boss@Firma.test");
    expect(message.to).toEqual([{ name: "Email assistant", address: "Boss@Firma.test" }]);
    expect(message.from).toEqual(message.to[0]);
    expect(message.headers).toEqual({ "X-EA-Action-Id": ID });
    expect(message.messageId).toBe(`<ea-report-${ID}@firma.test>`);
    expect(message.date).toBe(NOW);
  });

  test("the subject is the fixed prefix and title; Polish for a pl member", () => {
    expect(buildReportMail(input).subject).toBe("[Email assistant] Digest");
    expect(buildReportMail({ ...input, locale: "pl" }).subject).toBe("[Asystent poczty] Podsumowanie");
    expect(reportMailSubject("weekly_report", "en")).toBe("[Email assistant] Weekly report");
    expect(reportMailSubject("trust_report_ready", "pl")).toBe("[Asystent poczty] Sprawdzenie poczty gotowe");
    expect(reportMailSubject("autonomy_paused", "en")).toBe("[Email assistant] Automatic moves paused");
  });

  test("text from a notice never reaches a header, whatever it holds", () => {
    const evil = "x\r\nBcc: evil@attacker.test\nSubject: hacked <evil@attacker.test>";
    const message = buildReportMail({ ...input, text: evil });
    expect(message.subject).toBe("[Email assistant] Digest");
    expect(
      JSON.stringify([message.from, message.to, message.headers, message.subject, message.messageId])
    ).not.toContain("attacker");
    expect(message.text).toBe(evil);
  });

  test("the message id is stable for one outbox id", () => {
    expect(reportMailMessageId(ID, "a@b.test")).toBe(reportMailMessageId(ID, "a@b.test"));
    expect(reportMailMessageId(ID, "a@b.test")).not.toBe(
      reportMailMessageId("22222222-2222-4222-8222-222222222222", "a@b.test")
    );
  });
});

describe("the HTML part", () => {
  test("escapes every special character and has no form", () => {
    const html = reportMailHtml(`<form action="x"><script>alert('1')</script> & "q"`, BASE);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<script");
    expect(html).toContain(
      "&lt;form action=&quot;x&quot;&gt;&lt;script&gt;alert(&#39;1&#39;)&lt;/script&gt; &amp; &quot;q&quot;"
    );
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  test("a link to the base becomes an anchor without its trailing punctuation", () => {
    const html = reportMailHtml("Open: https://app.example.test/activity?category=spam.\nNext", BASE);
    expect(html).toContain(
      '<a href="https://app.example.test/activity?category=spam">https://app.example.test/activity?category=spam</a>.'
    );
    expect(html).toContain("<br>");
  });

  test("every anchor starts with the base; a foreign link stays escaped text", () => {
    const html = reportMailHtml(
      [
        "https://evil.test/phish",
        "https://app.example.test.evil.test/x",
        "https://app.example.test@evil.test/x",
        "https://app.example.test/ok",
        "http://app.example.test/insecure",
      ].join("\n"),
      BASE
    );
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
    expect(hrefs).toEqual(["https://app.example.test/ok"]);
    expect(html).toContain("https://evil.test/phish");
  });

  test("without a base no link is an anchor", () => {
    expect(reportMailHtml("https://app.example.test/ok", null)).not.toContain("<a ");
  });

  test("isLinkOfBase accepts the origin and its paths only", () => {
    expect(isLinkOfBase("https://app.example.test", BASE)).toBe(true);
    expect(isLinkOfBase("https://app.example.test/", `${BASE}/`)).toBe(true);
    expect(isLinkOfBase("https://app.example.test#x", BASE)).toBe(true);
    expect(isLinkOfBase("https://app.example.testing/x", BASE)).toBe(false);
    expect(isLinkOfBase("https://app.example.test:8443/x", BASE)).toBe(false);
    expect(isLinkOfBase("https://app.example.test/x", null)).toBe(false);
  });
});

describe("the Polish paused notice (review N14)", () => {
  test("the mail subject and the Telegram body use the same verb: wstrzymane", () => {
    const body = renderAutonomyPausedNotice(
      { category: "info", reason: "corrections", corrections: 2, settingsUrl: null },
      textTables.pl
    ).text;
    expect(reportMailSubject("autonomy_paused", "pl")).toContain("wstrzymane");
    expect(body).toContain("wstrzymane");
    expect(body).not.toContain("wyłączone");
  });
});

describe("isLinkOfBase on the edges of the origin", () => {
  test.each([
    ["a query after the origin", "https://app.example.test?x=1", BASE, true],
    ["a base with two closing slashes", "https://app.example.test/r/1", `${BASE}//`, true],
    ["an empty url and an empty base", "", "", false],
    ["an empty url and a base of slashes", "", "//", false],
  ])("%s", (_label, url, base, expected) => {
    expect(isLinkOfBase(url, base)).toBe(expected);
  });
});

describe("the HTML part of a line with text around the links", () => {
  test("the text before, between and after two links is kept, and each anchor stands alone", () => {
    const html = reportMailHtml("Open https://app.example.test/a, then https://evil.test/b and done <b>.", BASE);
    const anchor = '<a href="https://app.example.test/a">https://app.example.test/a</a>';
    expect(html).toBe(
      `<html><body><div style="font-family:sans-serif">Open ${anchor}, then https://evil.test/b and done &lt;b&gt;.</div></body></html>`
    );
  });
});
