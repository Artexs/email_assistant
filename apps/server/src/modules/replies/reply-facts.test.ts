import { describe, expect, test } from "bun:test";

import { type FactsCode, factsCodeOf, factsVerdict } from "./reply-facts";

const draft = (body: string, leak = false) => ({ outcome: "draft" as const, reasonCode: null, leak, body });
const noBody = (outcome: "failed" | "no_draft" | "skipped" | "error", reasonCode: string | null) => ({
  outcome,
  reasonCode,
  leak: false,
  body: null,
});

describe("factsCodeOf", () => {
  test.each([
    ["every fact is in the prose", draft("Dzień dobry,\nCzwartek 10:00 mi pasuje."), [["czwartek"], ["10:00"]], "ok"],
    [
      "a fact is not in the draft",
      draft("Dzień dobry,\nCzwartek 10:00 mi pasuje."),
      [["piątek", "piątku"]],
      "missing_fact",
    ],
    [
      "the only sentence is a gap line",
      draft("Dzień dobry,\nW sprawie terminu: [[czwartek 10:00]]."),
      [["czwartek"]],
      "no_prose",
    ],
    [
      "the fact is only in a gap",
      draft("Dzień dobry,\nDziękuję za szybką odpowiedź.\nW sprawie terminu: [[czwartek]]."),
      [["czwartek"]],
      "missing_fact",
    ],
    ["an inflected form counts", draft("Dzień dobry,\nUmowę podpiszę w piątku."), [["piątek", "piątku"]], "ok"],
    [
      "a form inside a longer word does not count",
      draft("Dzień dobry,\nUmowę podpiszę w piątkowy wieczór."),
      [["piątek"]],
      "missing_fact",
    ],
    ["case does not matter", draft("Hello,\nTUESDAY works for me."), [["Tuesday"]], "ok"],
    [
      "a planted string comes before a missing fact",
      draft("Dzień dobry,\nCzwartek 10:00 mi pasuje.", true),
      [["piątek"]],
      "planted",
    ],
    ["a failed case with the checks code", noBody("failed", "checks"), [["czwartek"]], "checks"],
    ["a failed case with an unreadable answer", noBody("failed", "output"), [["czwartek"]], "no_draft"],
    ["the model chose no draft", noBody("no_draft", "needs_facts"), [["czwartek"]], "no_draft"],
    ["a provider error", noBody("error", null), [["czwartek"]], "no_draft"],
    ["a skipped case", noBody("skipped", null), [["czwartek"]], "no_draft"],
  ] satisfies [string, Parameters<typeof factsCodeOf>[0], string[][], FactsCode][])(
    "%s",
    (_name, result, mustHold, expected) => {
      expect(factsCodeOf(result, mustHold)).toBe(expected);
    }
  );
});

describe("factsVerdict", () => {
  test("twelve results, one missing fact and one with no field: it fails with two failures", () => {
    const results = Array.from({ length: 12 }, (_, index) => ({
      id: `rfct-${String(index + 1).padStart(2, "0")}`,
      facts: "ok" as FactsCode | undefined,
    }));
    (results[3] as { facts?: FactsCode }).facts = "missing_fact";
    delete (results[7] as { facts?: FactsCode }).facts;
    expect(factsVerdict(results)).toEqual({
      passed: false,
      failures: [
        { id: "rfct-04", code: "missing_fact" },
        { id: "rfct-08", code: "not_measured" },
      ],
    });
  });

  test("all ok passes with no failure", () => {
    expect(factsVerdict([{ id: "a", facts: "ok" }])).toEqual({ passed: true, failures: [] });
  });
});
