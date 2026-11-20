import { describe, expect, test } from "bun:test";

import { cutQuotedReply } from "./style-cut";

const NO_SIGNATURE = { signature: null };

describe("cutQuotedReply", () => {
  test.each([
    ["English header", "Thanks, fine.\n\nOn Tue, 3 Nov 2026 at 10:00, Anna <a@b.pl> wrote:\n> old", "Thanks, fine."],
    [
      "English header on two lines",
      "Thanks.\n\nOn Tue, 3 Nov 2026 at 10:00, Anna Nowak\n<a@b.pl> wrote:\n> old",
      "Thanks.",
    ],
    ["Polish header", "Dzięki.\n\nW dniu 3.11.2026 o 10:00 Anna Nowak pisze:\n> stare", "Dzięki."],
    ["Polish napisał(a)", "Dzięki.\n\nwt., 3 lis 2026 o 10:00 Anna Nowak <a@b.pl> napisał(a):\nstare", "Dzięki."],
    ["Polish napisała", "Dzięki.\n\nAnna Nowak <a@b.pl> napisała:\nstare", "Dzięki."],
    ["the header of our own reply quote", "Ok.\n\nOn Tue 3 Nov 10:00, Anna wrote:\n> x", "Ok."],
    ["the header of our own Polish quote", "Ok.\n\nwt. 3 lis 10:00 Anna napisał(a):\n> x", "Ok."],
    ["original message line", "Ok.\n-----Original Message-----\nFrom: x", "Ok."],
    ["our own English quote", "Ok.\n\n--- Original message ---\nFrom: x\nDate: y", "Ok."],
    ["our own Polish quote", "Ok.\n\n--- Oryginalna wiadomość ---\nOd: x", "Ok."],
    ["forward line", "FYI\n\n---------- Forwarded message ---------\nFrom: x", "FYI"],
    ["Polish forward line", "FYI\n\n---------- Wiadomość przekazana ----------\nOd: x", "FYI"],
    ["header block after a blank line", "Ok.\n\nFrom: Anna\nSent: Tuesday\nTo: me\n\nold", "Ok."],
    ["header block after a rule", "Ok.\n________________________________\nFrom: Anna\nSent: Tue", "Ok."],
    ["Polish header block", "Ok.\n\nOd: Anna\nWysłano: wtorek\nDo: ja\n\nstare", "Ok."],
    ["Polish Outlook header block", "Ok.\n\nOd: Anna\nWysłane: wtorek\nDo: Jan\nDW: Ewa\nTemat: x\n\nstare", "Ok."],
    [
      "Polish Outlook header block after a rule",
      "Ok.\n________________________________\nOd: Anna\nWysłane: wtorek\nDo: Jan\nTemat: x\n\nstare",
      "Ok.",
    ],
    [
      "Thunderbird Polish forward line",
      "FYI\n\n-------- Przekazana wiadomość --------\nTemat: x\nData: wtorek\nOd: Anna\n\nstare",
      "FYI",
    ],
  ])("cuts at %s", (_name, text, expected) => {
    expect(cutQuotedReply(text, NO_SIGNATURE)).toBe(expected);
  });

  test("a single From: line after text is part of the text", () => {
    expect(cutQuotedReply("Ok.\n\nFrom: Anna told me", NO_SIGNATURE)).toBe("Ok.\n\nFrom: Anna told me");
  });

  test("removes a line that starts with >", () => {
    expect(cutQuotedReply("Line\n> quoted\nNext", NO_SIGNATURE)).toBe("Line\nNext");
  });

  test.each([
    ["-- ", "Text\n-- \nWiktor\n+48 600 000 000"],
    ["--", "Text\n--\nWiktor\n+48 600 000 000"],
  ])("ends the text at the signature mark %j", (_mark, text) => {
    expect(cutQuotedReply(text, NO_SIGNATURE)).toBe("Text");
  });

  test("turns CRLF into LF", () => {
    expect(cutQuotedReply("A\r\nB\r\n", NO_SIGNATURE)).toBe("A\nB");
  });

  test("removes a whole line of the stored signature", () => {
    const signature = "Pozdrawiam | Wiktor Szalewski";
    expect(cutQuotedReply("Dziękuję.\n\nPozdrawiam | Wiktor Szalewski", { signature })).toBe("Dziękuję.");
  });

  test("removes each line of a stored signature of several lines", () => {
    const signature = "Pozdrawiam\nWiktor Szalewski\n+48 600 000 000";
    expect(cutQuotedReply("Dziękuję.\n\nPozdrawiam\nWiktor Szalewski\n+48 600 000 000", { signature })).toBe(
      "Dziękuję."
    );
  });

  test("removes an inline copy of the signature at the end of the last line", () => {
    const signature = "Pozdrawiam\nWiktor Szalewski";
    expect(cutQuotedReply("Dziękuję, do zobaczenia. Pozdrawiam | Wiktor Szalewski", { signature })).toBe(
      "Dziękuję, do zobaczenia."
    );
  });

  test("keeps a line that only holds a word of the signature", () => {
    expect(cutQuotedReply("Tak, Wiktor jest tutaj.", { signature: "Wiktor" })).toBe("Tak, Wiktor jest tutaj.");
  });

  test("a text that is only a quote gives an empty string", () => {
    expect(cutQuotedReply("On Tue, 3 Nov 2026, Anna wrote:\n> old", NO_SIGNATURE)).toBe("");
  });
});
