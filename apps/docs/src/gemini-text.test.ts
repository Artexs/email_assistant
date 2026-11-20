import { describe, expect, test } from "bun:test";

import { blocksWithText, geminiClaimProblems, geminiOutsideCondition } from "./gemini-text";

describe("Gemini text on a public page", () => {
  test("a block that names Gemini needs the condition: optional, off by default", () => {
    expect(geminiOutsideCondition(["Google Gemini API: AI model"])).toEqual(["Google Gemini API: AI model"]);
    expect(geminiOutsideCondition(["Gemini: optional, off by default"])).toEqual([]);
    expect(geminiOutsideCondition(["OpenAI sorts mail"])).toEqual([]);
  });
  test("the blocks are the visible text of rows, list items and paragraphs", () => {
    expect(blocksWithText("<ul><li>A &amp; <code>Gemini</code></li></ul><p>B</p>")).toEqual(["A & Gemini", "B"]);
  });
  test("a page must not say that Gemini is removed or that OpenAI is the only provider", () => {
    expect(geminiClaimProblems("Gemini was removed from the code.")).not.toEqual([]);
    expect(geminiClaimProblems("The code supports only OpenAI.")).not.toEqual([]);
    expect(geminiClaimProblems("This install uses OpenAI. Gemini is optional, off by default.")).toEqual([]);
  });
});
