// Two shapes of a gap sentence that lean without a commitment word: the gap stands on the deadline of this reply or
// of a decision, and a date or term is restated outside the gap. Both read the text outside the gaps only.
// Pure code.

const NOT_LETTER_BEFORE = String.raw`(?<![\p{L}\p{N}])`;
const NOT_LETTER_AFTER = String.raw`(?![\p{L}\p{N}])`;

function words(alternatives: readonly string[]): string {
  return `${NOT_LETTER_BEFORE}(?:${alternatives.join("|")})${NOT_LETTER_AFTER}`;
}

// English names start with a capital letter (so "may" and "march" stay verbs); Polish names are lower case.
const EN_NAMES = new RegExp(
  words([
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
    "January",
    "February",
    "March",
    "April",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ])
);
const EN_MAY = new RegExp(
  String.raw`${NOT_LETTER_BEFORE}(?:in|by|until|from|before|since|of|end of) May${NOT_LETTER_AFTER}`
);

const PL_AND_EN_TERMS = new RegExp(
  [
    words([
      "poniedziałk\\p{L}*",
      "wtor(?:ek|ku|kiem)",
      "środ(?:a|ę|y|zie)",
      "czwart(?:ek|ku|kiem)",
      "piąt(?:ek|ku|kiem)",
      "sobot\\p{L}*",
      "niedziel\\p{L}*",
      "styczeń",
      "styczni\\p{L}*",
      "lut(?:y|ego|ym)",
      "marzec",
      "marca",
      "marcu",
      "kwiet\\p{L}*",
      "maj(?:a|u|em)?",
      "czerw(?:iec|ca|cu)",
      "lip(?:iec|ca|cu)",
      "sierp\\p{L}*",
      "wrze(?:sień|śnia|śniu)",
      "październik\\p{L}*",
      "listopad\\p{L}*",
      "grud(?:zień|nia|niu)",
      "jutro",
      "pojutrze",
      "dziś",
      "dzisiaj",
      "tomorrow",
      "today",
      "tonight",
      "kwartał\\p{L}*",
      "weekend\\p{L}*",
    ]),
    // A relative span: "this year", "w przyszłym tygodniu", "do końca miesiąca", "first-quarter".
    String.raw`${NOT_LETTER_BEFORE}(?:this|next|last|current)\s+(?:year|week|month|quarter)${NOT_LETTER_AFTER}`,
    String.raw`${NOT_LETTER_BEFORE}(?:first|second|third|fourth)[\s-]quarter${NOT_LETTER_AFTER}`,
    String.raw`${NOT_LETTER_BEFORE}end\s+of\s+(?:the\s+|this\s+|next\s+)?(?:day|week|month|quarter|year)${NOT_LETTER_AFTER}`,
    String.raw`${NOT_LETTER_BEFORE}(?:tym|ten|tego|przyszł\p{L}+|zeszł\p{L}+|bieżąc\p{L}+)\s+(?:roku|rok|tygodniu|tygodnia|tydzień|miesiącu|miesiąca|miesiąc|kwartale|kwartału)${NOT_LETTER_AFTER}`,
    String.raw`${NOT_LETTER_BEFORE}końc\p{L}*\s+(?:dnia|tygodnia|miesiąca|roku|kwartału)${NOT_LETTER_AFTER}`,
    String.raw`${NOT_LETTER_BEFORE}20\d\d${NOT_LETTER_AFTER}`,
    String.raw`${NOT_LETTER_BEFORE}\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?${NOT_LETTER_AFTER}`,
  ].join("|"),
  "iu"
);

// "Co do terminu przekazania decyzji", "the deadline for this reply", "when I decide". The word "odpowiedź" and
// "answer" are not listed: the fixed sentence forms use them ("moja odpowiedź to", "my answer is").
const DEADLINE_OF_REPLY = new RegExp(
  [
    String.raw`${NOT_LETTER_BEFORE}(?:termin\p{L}*|dat[aęy]|kiedy)(?:\s+\p{L}+){0,2}\s+(?:odpowiedzi|decyzji|decyzję|odpowiem|zdecyduję)${NOT_LETTER_AFTER}`,
    String.raw`${NOT_LETTER_BEFORE}(?:deadline|timing|date|time)\s+(?:for|of|on|to)\s+(?:(?:this|the|my|our|your)\s+)?(?:reply|replying|answer|answering|decision|deciding|response|responding)${NOT_LETTER_AFTER}`,
    String.raw`${NOT_LETTER_BEFORE}when\s+(?:I|we)\s+(?:will\s+|can\s+|shall\s+)?(?:reply|answer|decide|respond)${NOT_LETTER_AFTER}`,
  ].join("|"),
  "iu"
);

/** True when the text names the deadline of this reply or of a decision. Pass the text with the gaps cut out. */
export function namesReplyDeadline(textOutsideGaps: string): boolean {
  return DEADLINE_OF_REPLY.test(textOutsideGaps);
}

/** True when the text holds a date or a term (a weekday, a month, a year, "tomorrow", "this week"). */
export function holdsDateOrTerm(textOutsideGaps: string): boolean {
  return EN_NAMES.test(textOutsideGaps) || EN_MAY.test(textOutsideGaps) || PL_AND_EN_TERMS.test(textOutsideGaps);
}
