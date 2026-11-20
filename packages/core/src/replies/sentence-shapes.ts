// Two shapes of a gap sentence that lean without a commitment word: the gap stands on the deadline of this reply or
// of a decision, and a date or term is restated outside the gap. Both read the text outside the gaps only.
// Pure code.

const NOT_LETTER_BEFORE = String.raw`(?<![\p{L}\p{N}])`;
const NOT_LETTER_AFTER = String.raw`(?![\p{L}\p{N}])`;

function words(alternatives: readonly string[]): string {
  return `${NOT_LETTER_BEFORE}(?:${alternatives.join("|")})${NOT_LETTER_AFTER}`;
}

// A weekday or a month names a term only when a term preposition stands directly before it ("by Friday", "do środy").
// After "on", "in", "w" or as a modifier ("the March delivery", "sobotniej zmiany") it names the thing the email asks
// about. English names start with a capital letter (so "may" and "march" stay verbs); Polish names are lower case.
const EN_TERM_PREPOSITION = String.raw`(?:[Bb]y|[Uu]ntil|[Ff]rom|[Bb]efore|[Aa]fter|[Nn]o later than)`;
const PL_TERM_PREPOSITION = String.raw`(?:do|od|przed|po|najpóźniej)`;

const EN_NAMES = new RegExp(
  `${NOT_LETTER_BEFORE}${EN_TERM_PREPOSITION}\\s+${words([
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
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ])}`,
  "u"
);

// Noun forms only: "sobotniej" and "sobotnich" are adjectives and name no term.
const PL_NAMES = new RegExp(
  `${NOT_LETTER_BEFORE}${PL_TERM_PREPOSITION}\\s+${words([
    "poniedziałk(?:u|iem|a)?",
    "wtor(?:ek|ku|kiem)",
    "środ(?:a|ę|y|zie|ą)",
    "czwart(?:ek|ku|kiem)",
    "piąt(?:ek|ku|kiem)",
    "sobot(?:a|ę|y|ą)",
    "sobocie",
    "niedziel(?:a|ę|i|ą)",
    "styczeń",
    "styczni(?:a|u)",
    "lut(?:y|ego|ym)",
    "marzec",
    "marca",
    "marcu",
    "kwiecień",
    "kwietni(?:a|u)",
    "maj(?:a|u|em)?",
    "czerw(?:iec|ca|cu)",
    "lip(?:iec|ca|cu)",
    "sierpień",
    "sierpni(?:a|u)",
    "wrze(?:sień|śnia|śniu)",
    "październik(?:a|u)?",
    "listopad(?:a|zie)?",
    "grud(?:zień|nia|niu)",
  ])}`,
  "iu"
);

// Terms that count wherever they stand: relative days, spans, quarters, years and numeric dates.
const PL_AND_EN_TERMS = new RegExp(
  [
    words(["jutro", "pojutrze", "dziś", "dzisiaj", "tomorrow", "today", "tonight", "kwartał\\p{L}*", "weekend\\p{L}*"]),
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

/**
 * True when the text holds a date or a term: a weekday or a month after a term preposition ("by Friday"), a year,
 * "tomorrow", "this week".
 */
export function holdsDateOrTerm(textOutsideGaps: string): boolean {
  return EN_NAMES.test(textOutsideGaps) || PL_NAMES.test(textOutsideGaps) || PL_AND_EN_TERMS.test(textOutsideGaps);
}
