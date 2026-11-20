import { describe, expect, test } from "bun:test";

import { markUntrustedText, removeLinks } from "./untrusted-text";

describe("markUntrustedText", () => {
  test.each([
    [
      "replaces email addresses",
      [
        ["Napisz do jan.kowalski@firma.test do jutra", "Napisz do [address] do jutra"],
        ["Reply to x@evil.test now", "Reply to [address] now"],
      ],
    ],
    [
      "replaces phone numbers",
      [
        ["Zadzwoń: +48 600 123 456 jutro", "Zadzwoń: [phone] jutro"],
        ["Call 600-123-456 now", "Call [phone] now"],
      ],
    ],
    [
      "keeps dates and short numbers",
      [
        ["Termin 2026-11-04, 5 plików, kwota 1200 zł", "Termin 2026-11-04, 5 plików, kwota 1200 zł"],
        ["Od 2026-11-04 do 2026-11-05", "Od 2026-11-04 do 2026-11-05"],
      ],
    ],
    [
      "replaces a link glued to a word",
      [
        ["foohttps://evil.test/x", "foo[link]"],
        ["xwww.evil.test", "x[link]"],
      ],
    ],
  ] as [string, [string, string][]][])("%s", (_name, pairs) => {
    for (const [input, output] of pairs) expect(markUntrustedText(input)).toBe(output);
  });

  test("replaces an address in angle brackets", () => {
    const out = markUntrustedText("Kontakt: <anna@example.com>");
    expect(out).toContain("[address]");
    expect(out).not.toContain("@");
  });

  test.each([
    ["replaces a leftover @", "ping @janek", "ping (at)janek"],
    [
      "replaces a phone number next to a date, and keeps the date",
      "Termin 2026-11-04 600 123 456",
      "Termin 2026-11-04 [phone]",
    ],
    ["replaces a phone number with dashes", "Tel 0800-12-34-56", "Tel [phone]"],
    ["replaces a phone number after letters", "Tel600123456", "Tel[phone]"],
  ])("%s", (_name, input, output) => {
    expect(markUntrustedText(input)).toBe(output);
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

  test("output never contains @", () => {
    const inputs = ["a@b.test and @c and d@e", "https://x.test/?u=a@b.test", "<x@y.pl>, z@w.pl; @@"];
    for (const input of inputs) expect(markUntrustedText(input)).not.toContain("@");
  });
});

describe("removeLinks", () => {
  test("replaces every link and keeps the rest", () => {
    expect(removeLinks("see www.a.pl and http://b.pl/c")).toBe("see [link] and [link]");
  });
});
