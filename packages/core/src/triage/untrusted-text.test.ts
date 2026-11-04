import { describe, expect, test } from "bun:test";

import { markUntrustedText } from "./untrusted-text";

describe("markUntrustedText", () => {
  test("replaces email addresses", () => {
    expect(markUntrustedText("Napisz do jan.kowalski@firma.test do jutra")).toBe("Napisz do [address] do jutra");
    expect(markUntrustedText("Reply to x@evil.test now")).toBe("Reply to [address] now");
  });

  test("replaces an address in angle brackets", () => {
    const out = markUntrustedText("Kontakt: <anna@example.com>");
    expect(out).toContain("[address]");
    expect(out).not.toContain("@");
  });

  test("replaces a leftover @", () => {
    expect(markUntrustedText("ping @janek")).toBe("ping (at)janek");
  });

  test("replaces links, also mailto and links with user@host", () => {
    expect(markUntrustedText("Zobacz https://evil.test/a?b=1 teraz")).toBe("Zobacz [link] teraz");
    expect(markUntrustedText("Open www.evil.test/login please")).toBe("Open [link] please");
    expect(markUntrustedText("Click http://user@evil.test/x")).not.toContain("@");
    expect(markUntrustedText("Write mailto:boss@firma.test")).not.toContain("@");
  });

  test("replaces account numbers", () => {
    expect(markUntrustedText("Konto: PL61 1090 1014 0000 0712 1981 2874 dziękuję")).toBe(
      "Konto: [account number] dziękuję"
    );
    expect(markUntrustedText("Pay to 61 1090 1014 0000 0712 1981 2874 today")).toBe("Pay to [account number] today");
    expect(markUntrustedText("Nr 61109010140000071219812874.")).toBe("Nr [account number].");
  });

  test("replaces phone numbers", () => {
    expect(markUntrustedText("Zadzwoń: +48 600 123 456 jutro")).toBe("Zadzwoń: [phone] jutro");
    expect(markUntrustedText("Call 600-123-456 now")).toBe("Call [phone] now");
  });

  test("keeps dates and short numbers", () => {
    expect(markUntrustedText("Termin 2026-11-04, 5 plików, kwota 1200 zł")).toBe(
      "Termin 2026-11-04, 5 plików, kwota 1200 zł"
    );
    expect(markUntrustedText("Od 2026-11-04 do 2026-11-05")).toBe("Od 2026-11-04 do 2026-11-05");
  });

  test("output never contains @", () => {
    const inputs = ["a@b.test and @c and d@e", "https://x.test/?u=a@b.test", "<x@y.pl>, z@w.pl; @@"];
    for (const input of inputs) expect(markUntrustedText(input)).not.toContain("@");
  });

  test("replaces a phone number next to a date, and keeps the date", () => {
    expect(markUntrustedText("Termin 2026-11-04 600 123 456")).toBe("Termin 2026-11-04 [phone]");
  });

  test("replaces a phone number with dashes", () => {
    expect(markUntrustedText("Tel 0800-12-34-56")).toBe("Tel [phone]");
  });

  test("replaces a phone number after letters", () => {
    expect(markUntrustedText("Tel600123456")).toBe("Tel[phone]");
  });

  test("replaces a link glued to a word", () => {
    expect(markUntrustedText("foohttps://evil.test/x")).toBe("foo[link]");
    expect(markUntrustedText("xwww.evil.test")).toBe("x[link]");
  });
});
