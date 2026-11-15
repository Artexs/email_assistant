import { describe, expect, test } from "bun:test";

import { textTables } from "../texts";

import { aiLine, confidencePercent, hasModelMark, skillsLabel, whySuffix } from "./why-line";

describe("confidencePercent", () => {
  test("rounds down to a multiple of 5 for every confidence with up to 3 decimals", () => {
    for (let k = 0; k <= 1000; k += 1) {
      expect(confidencePercent(k / 1000), `${k}/1000`).toBe(Math.floor(k / 50) * 5);
    }
  });

  test("never rounds a value that is only a float error away from the step up", () => {
    expect(confidencePercent(0.84999999999)).toBe(80);
    expect(confidencePercent(0.999)).toBe(95);
  });

  test("clamps a value outside 0 to 1", () => {
    expect(confidencePercent(1.5)).toBe(100);
    expect(confidencePercent(7)).toBe(100);
    expect(confidencePercent(-0.3)).toBe(0);
    expect(whySuffix({ category: "info", confidence: 1.5 }, textTables.en)).toBe("100%");
    expect(whySuffix({ category: "info", confidence: -0.3 }, textTables.en)).toBeNull();
  });
});

describe("skillsLabel", () => {
  test("a blank tag never shows, and the limit of 3 counts the shown tags", () => {
    expect(skillsLabel(["   ", "legal"], textTables.en)).toBe("skills: legal");
    expect(skillsLabel(["", "a", "b", "c"], textTables.en)).toBe("skills: a, b, c");
    expect(skillsLabel(["", "  "], textTables.en)).toBeNull();
    expect(skillsLabel([], textTables.en)).toBeNull();
    expect(skillsLabel(null, textTables.en)).toBeNull();
    expect(skillsLabel(undefined, textTables.en)).toBeNull();
    expect(skillsLabel(["finanse", "prawo"], textTables.pl)).toBe("kompetencje: finanse, prawo");
  });
});

describe("aiLine", () => {
  test("no mark: the digest rule skips an empty text, the urgent rule prints it", () => {
    expect(aiLine("", null, 120)).toBeNull();
    expect(aiLine(null, null, 120)).toBeNull();
    expect(aiLine("", null, 200, { printEmpty: true })).toBe("💬 ");
    expect(aiLine(null, null, 200, { printEmpty: true })).toBeNull();
    expect(aiLine("text", null, 120)).toBe("💬 text");
  });

  test("a mark with an empty text gives the mark line, also with printEmpty", () => {
    expect(aiLine("", "80%", 120)).toBe("💬 80%");
    expect(aiLine("", "80%", 200, { printEmpty: true })).toBe("💬 80%");
    expect(aiLine(null, "80%", 120)).toBe("💬 80%");
    expect(aiLine("text", "80%", 120)).toBe("💬 text · 80%");
  });

  test("hasModelMark is false for the results that no model made", () => {
    expect([hasModelMark("blocklist"), hasModelMark("triage_error"), hasModelMark("llm_blocked")]).toEqual([
      false,
      false,
      false,
    ]);
    expect(hasModelMark("direct_request")).toBe(true);
  });
});
