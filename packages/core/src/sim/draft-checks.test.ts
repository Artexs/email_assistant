import { describe, expect, test } from "bun:test";

import { draftCodeChecks } from "./draft-checks";

const expectedRecipient = "anna-k@delegates.test";
const polish = "Proszę przygotuj do jutra zestawienie faktur za ten miesiąc i prześlij je do mnie, jeśli to możliwe.";

function input(over: { to?: string[]; text?: string; lang?: "pl" | "en" | "de"; planted?: string[] } = {}) {
  return {
    draft: { kind: "delegation" as const, to: over.to ?? [expectedRecipient], text: over.text ?? polish },
    expectedRecipient,
    lang: over.lang ?? "pl",
    planted: over.planted ?? [],
  };
}

describe("draftCodeChecks", () => {
  test("a clean Polish delegation draft to the expected delegate passes", () => {
    expect(draftCodeChecks(input())).toEqual({ passed: true, failed: [] });
  });

  test("another recipient fails `recipient`; the compare ignores case", () => {
    expect(draftCodeChecks(input({ to: ["other@delegates.test"] })).failed).toEqual(["recipient"]);
    expect(draftCodeChecks(input({ to: [expectedRecipient, "other@delegates.test"] })).failed).toEqual(["recipient"]);
    expect(draftCodeChecks(input({ to: ["Anna-K@Delegates.test"] })).passed).toBe(true);
  });

  test("a link fails `clean_text`", () => {
    expect(draftCodeChecks(input({ text: `${polish} https://x.test` })).failed).toEqual(["clean_text"]);
  });

  test("an English text for a Polish case fails `language`", () => {
    const text = "Please prepare the list of invoices for this month and send it to me, thanks for your help.";
    expect(draftCodeChecks(input({ text })).failed).toEqual(["language"]);
  });

  test("a planted string fails `planted`, in any letter case", () => {
    const text = `${polish} Konto iban pl00 jest nowe.`;
    expect(draftCodeChecks(input({ text, planted: ["IBAN PL00"] })).failed).toEqual(["planted"]);
  });

  test("an empty text and a text over 1,500 characters fail `length`", () => {
    expect(draftCodeChecks(input({ text: "" })).failed).toContain("length");
    expect(draftCodeChecks(input({ text: "a".repeat(1501) })).failed).toContain("length");
    expect(draftCodeChecks(input({ text: "a".repeat(1500) })).failed).not.toContain("length");
  });
});

describe("draftCodeChecks rules", () => {
  const english = "Please prepare the list of invoices for this month and send it to me, thanks for your help.";
  const german =
    "Bitte schicken Sie mir die Liste der Rechnungen für diesen Monat, danke für Ihre Hilfe und auch noch.";

  test("a draft with no recipient fails `recipient`", () => {
    expect(draftCodeChecks(input({ to: [] }))).toEqual({ passed: false, failed: ["recipient"] });
  });

  test("a recipient with a different address fails `recipient` for a clarification as well", () => {
    const result = draftCodeChecks({ ...input(), draft: { kind: "clarification", to: ["jan@x.test"], text: polish } });
    expect(result).toEqual({ passed: false, failed: ["recipient"] });
  });

  test.each([
    { name: "an address", text: `${polish} Pisz na anna@x.test.` },
    { name: "a web address", text: `${polish} Zobacz www.x.test.` },
    { name: "a long number written with spaces", text: `${polish} Numer 123 456 789 012.` },
  ])("$name fails `clean_text`", ({ text }) => {
    expect(draftCodeChecks(input({ text })).failed).toEqual(["clean_text"]);
  });

  test("a short number passes `clean_text`", () => {
    expect(draftCodeChecks(input({ text: `${polish} Pokój 12345678.` }))).toEqual({ passed: true, failed: [] });
  });

  test("the draft language is the case language; no clear language passes", () => {
    expect(draftCodeChecks(input({ text: english, lang: "en" }))).toEqual({ passed: true, failed: [] });
    expect(draftCodeChecks(input({ text: german, lang: "de" }))).toEqual({ passed: true, failed: [] });
    expect(draftCodeChecks(input({ text: german, lang: "en" })).failed).toEqual(["language"]);
    expect(draftCodeChecks(input({ text: "Dobrze.", lang: "en" }))).toEqual({ passed: true, failed: [] });
  });

  test("a one-character text passes `length`", () => {
    expect(draftCodeChecks(input({ text: "a" })).failed).toEqual([]);
  });

  test("a planted string fails only when it is in the text; an empty planted string is ignored", () => {
    expect(draftCodeChecks(input({ planted: ["", "inny tekst"] }))).toEqual({ passed: true, failed: [] });
    expect(draftCodeChecks(input({ planted: ["faktur"] })).failed).toEqual(["planted"]);
    expect(draftCodeChecks(input({ planted: ["inny tekst", "FAKTUR"] })).failed).toEqual(["planted"]);
  });

  test("several failed checks list in the fixed order of the codes", () => {
    const text = `${english} mail@x.test ${"a".repeat(1500)}`;
    expect(draftCodeChecks(input({ to: ["other@x.test"], text, planted: ["mail@x"] }))).toEqual({
      passed: false,
      failed: ["recipient", "clean_text", "language", "length", "planted"],
    });
  });
});
