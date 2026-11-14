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
