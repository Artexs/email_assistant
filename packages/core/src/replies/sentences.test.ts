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

  // A gap that stands on the deadline of this reply or of a decision, or a date or term restated outside the gap,
  // leans. An answer to a question the email asks, with no date and no deadline of the reply, does not.
  test.each<[string, string, ReplySentenceCounts]>([
    [
      "a gap on the deadline of the decision leans",
      "Cześć,\nCo do terminu przekazania decyzji, moja odpowiedź to [[tak lub nie]].",
      counts(0, 1, 0, 1),
    ],
    [
      "a gap on the deadline of the decision, with the date outside, leans once",
      "Cześć Halina,\nCo do terminu decyzji do środy, moja odpowiedź to [[tak lub nie]].",
      counts(0, 1, 0, 1),
    ],
    [
      "a gap on the reply before the end of the week leans",
      "Zbigniew,\nCo do odpowiedzi przed końcem tygodnia: [[tak lub nie i termin]].",
      counts(0, 1, 0, 1),
    ],
    [
      "a gap on the deadline of this reply leans, English",
      "Hi Tom,\nOn the deadline for this reply, my answer is [[yes or no]].",
      counts(0, 1, 0, 1),
    ],
    [
      "a date restated outside the gap leans (tomorrow)",
      "Dzień dobry,\nW sprawie wysłania aneksu jutro do podpisu, moja odpowiedź brzmi: [[tak lub nie]].",
      counts(0, 1, 0, 1),
    ],
    [
      "a date restated outside the gap leans (a weekday after a preposition)",
      "Halina,\nOdpowiedź na propozycję rozmowy do czwartku rano brzmi: [[tak lub nie]].",
      counts(0, 1, 0, 1),
    ],
    [
      "a date restated outside the gap leans (a year)",
      "Dzień dobry,\nOdpowiedź na pytanie o rozbudowę floty w 2027 roku brzmi: [[tak lub nie]].",
      counts(0, 1, 0, 1),
    ],
    [
      "a date restated outside the gap leans (a month after a preposition, English)",
      "Dear Karin Lindqvist,\nThe answer on trailer capacity from April is [[yes or no]].",
      counts(0, 1, 0, 1),
    ],
    [
      "a gap on a measure the manager would present leans",
      "Dear Karin Lindqvist,\nThe measures I would present to the board are [[measures for the board]].",
      counts(0, 1, 0, 1),
    ],
    [
      "a gap on a measure the manager would present leans, with the answer form",
      "Dear Karin Lindqvist,\nOn the measures I would present to the board, my answer is [[measures to present]].",
      counts(0, 1, 0, 1),
    ],
    [
      "a position phrase with words between it and the gap leans",
      "Dear Karin Lindqvist,\nMy preference on the payment terms is: [[current or extended]].",
      counts(0, 1, 0, 1),
    ],
    [
      "a term restated outside the gap leans (this year)",
      "Hi Anna,\nOn the budget for this year, my answer is [[keep or change]].",
      counts(0, 1, 0, 1),
    ],
    [
      "a date inside the gap label does not lean",
      "Dear Karin Lindqvist,\nThe answer on the call is [[yes or no and Wednesday or Thursday]].",
      counts(0, 1, 0, 0),
    ],
    [
      "an answer to a question the email asks does not lean, Polish",
      "Zbigniew,\nOdpowiedź na pytanie o budżet brzmi: [[zostawić lub zmienić]].",
      counts(0, 1, 0, 0),
    ],
    [
      "an answer to a question the email asks does not lean, English",
      "Hi Daniel,\nThe answer on the commitment duration is [[duration]].\nMy answer on discussing this by phone is [[yes or no]].",
      counts(0, 2, 0, 0),
    ],
    [
      "a payment term is no deadline of the reply",
      "Dzień dobry,\nCo do dłuższego terminu płatności, moja odpowiedź to [[tak lub nie]].",
      counts(0, 1, 0, 0),
    ],
    [
      "a delivery term with the word answer is no deadline of the reply",
      "Dzień dobry,\nW sprawie ewentualnego innego terminu dostawy moja odpowiedź to [[alternatywny termin lub brak]].",
      counts(0, 1, 0, 0),
    ],
    [
      "a weekday as a modifier does not lean, Polish",
      "Dzień dobry,\nCo do sobotniej zmiany, moja odpowiedź to [[tak lub nie]].",
      counts(0, 1, 0, 0),
    ],
    [
      "a weekday after a noun does not lean, Polish",
      "Dzień dobry,\nCo do obsługi dostaw sobotnich, moja odpowiedź to [[tak lub nie]].",
      counts(0, 1, 0, 0),
    ],
    [
      "a month after in does not lean, Polish",
      "Dzień dobry,\nCo do jej utrzymania w marcu, moja odpowiedź to [[tak lub nie]].",
      counts(0, 1, 0, 0),
    ],
    [
      "a weekday as a modifier does not lean, English",
      "Dear Karin Lindqvist,\nOn the Saturday surcharge, my answer is [[accept or decline]].",
      counts(0, 1, 0, 0),
    ],
    [
      "a month as a modifier does not lean, English",
      "Dear Karin Lindqvist,\nOn the March delivery, my answer is [[accept or decline]].",
      counts(0, 1, 0, 0),
    ],
    [
      "a position phrase before a gap that ends the sentence does not lean, Polish",
      "Dzień dobry,\nCo do pogłębionego raportowania nakładów na flotę, moje stanowisko to [[poparcie lub brak poparcia]].",
      counts(0, 1, 0, 0),
    ],
    [
      "a position phrase before a colon and a gap does not lean, English",
      "Dear Karin Lindqvist,\nOn the payment terms, my position: [[current or extended]].",
      counts(0, 1, 0, 0),
    ],
    [
      "a date in a sentence with no gap does not lean",
      "Dear Tom Baker,\nThursday at 10:00 works for me.",
      counts(1, 0, 0, 0),
    ],
    [
      "a name that starts like a month is no date",
      "Dzień dobry,\nOdpowiedź na pytanie od Marcina o majątek firmy brzmi: [[tak lub nie]].",
      counts(0, 1, 0, 0),
    ],
  ])("%s", (_name, body, expected) => {
    expect(classifyReplySentences(body)).toEqual(expected);
  });

  // The fixed template is "Regarding X: [[gap]]" with a topic X only; extra words make it a gap sentence.
  test.each<[string, string, ReplySentenceCounts]>([
    [
      "a topic and a gap stay the template, English",
      "Hi Tom,\nRegarding the budget plan: [[yes or no]].",
      counts(0, 0, 1, 0),
    ],
    [
      "a topic and a gap stay the template, Polish",
      "Dzień dobry,\nW sprawie zmiany sposobu fakturowania: [[tak lub nie]].",
      counts(0, 0, 1, 0),
    ],
    [
      "extra words after a comma make a gap sentence",
      "Dzień dobry,\nW sprawie zmiany sposobu fakturowania, moja odpowiedź brzmi: [[tak lub nie]].",
      counts(0, 1, 0, 0),
    ],
    [
      "extra words with no comma make a gap sentence",
      "Dzień dobry,\nW sprawie aneksu moja odpowiedź brzmi: [[tak lub nie]].",
      counts(0, 1, 0, 0),
    ],
    [
      "extra words make a gap sentence, English",
      "Hi Tom,\nRegarding the budget plan, my answer is: [[yes or no]].",
      counts(0, 1, 0, 0),
    ],
  ])("%s", (_name, body, expected) => {
    expect(classifyReplySentences(body)).toEqual(expected);
  });

  test("a leaning phrase of every list is found", () => {
    for (const phrase of [...LEANING_PHRASES.en, ...LEANING_PHRASES.pl]) {
      expect(classifyReplySentences(`Hi Tom,\nWe say ${phrase} about it.`).leaning).toBe(1);
    }
  });
});
