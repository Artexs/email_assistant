import { describe, expect, test } from "bun:test";

import { classifyReplySentences, isSkeletonDraft, LEANING_PHRASES, type ReplySentenceCounts } from "./sentences";

const counts = (prose: number, gapSentences: number, template: number, leaning: number): ReplySentenceCounts => ({
  prose,
  gapSentences,
  template,
  leaning,
});

describe("classifyReplySentences", () => {
  test.each<[string, string, ReplySentenceCounts, boolean | undefined]>([
    [
      "a greeting and two template lines are a skeleton",
      "Dear Karin Lindqvist,\nRegarding certificate responsibility: [[accept or decline]].\nRegarding shipment arrival: [[yes or no and date]].",
      counts(0, 0, 2, 0),
      true,
    ],
    [
      "the fixed Polish thanks counts nowhere",
      "Dzień dobry,\nDziękuję za wiadomość.\nW sprawie terminu odprawy: [[tak lub nie]].",
      counts(0, 0, 1, 0),
      true,
    ],
    [
      "a real sentence and a gap sentence are not a skeleton",
      "Cześć Anna,\nDziękuję za przesłanie harmonogramu wdrożenia.\nCo do terminu odprawy: [[tak lub nie]].",
      counts(1, 1, 0, 0),
      false,
    ],
    [
      "two sentences on one line are counted apart",
      "Dear Tom Baker,\nThursday at 10:00 works for me. See you then.",
      counts(2, 0, 0, 0),
      undefined,
    ],
    ["an empty body has no sentence", "", counts(0, 0, 0, 0), true],
    ["a sentence of fewer than 3 words counts nowhere", "Hi Tom,\nOk.", counts(0, 0, 0, 0), undefined],
    [
      "a first line that ends with a full stop is no greeting",
      "Dear Tom, thanks for the update.\nRegarding the budget: [[yes or no]].",
      counts(1, 0, 1, 0),
      undefined,
    ],
    [
      "a full stop inside a gap label does not split the sentence",
      "Dzień dobry,\nW sprawie umowy: [[tak lub nie, wersja 2.1]].",
      counts(0, 0, 1, 0),
      undefined,
    ],
    [
      "an abbreviation does not end a sentence",
      "Dzień dobry,\nSpotkanie np. we wtorek o godz. 10:00 jest w planie.",
      counts(1, 0, 0, 0),
      undefined,
    ],
    [
      "a leaning phrase outside the gap counts, English",
      "Dear Anna Nowak,\nMy preference on the payment terms is: [[current or extended]].",
      counts(0, 1, 0, 1),
      undefined,
    ],
    [
      "a leaning phrase outside the gap counts, Polish",
      "Dzień dobry,\nDokumenty wyślę do [[data]].",
      counts(0, 1, 0, 1),
      undefined,
    ],
    [
      "a leaning phrase needs a whole-word match",
      "Hi Tom,\nI willingly share the agenda draft.",
      counts(1, 0, 0, 0),
      undefined,
    ],
    [
      "a leaning phrase inside a gap label does not count",
      "Hi Tom,\nRegarding the offer: [[I will accept or decline]].",
      counts(0, 0, 1, 0),
      undefined,
    ],
  ])("%s", (_name, body, expected, skeleton) => {
    expect(classifyReplySentences(body)).toEqual(expected);
    if (skeleton !== undefined) expect(isSkeletonDraft(classifyReplySentences(body))).toBe(skeleton);
  });

  test("a leaning phrase of every list is found", () => {
    for (const phrase of [...LEANING_PHRASES.en, ...LEANING_PHRASES.pl]) {
      expect(classifyReplySentences(`Hi Tom,\nWe say ${phrase} about it.`).leaning).toBe(1);
    }
  });
});
