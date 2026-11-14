export type DetectedLang = "pl" | "en" | "de" | "unknown";

const MIN_HITS = 3;
const MIN_RATIO = 1.5;

const polishWords = new Set(
  `i w z na do nie to jest się że o jak po ale za od dla przez przy czy tak już też tylko może proszę dziękuję
   dzień dobry pozdrawiam bardzo będzie jestem mam mamy mogę prosze dziekuje czy jeśli który która które oraz
   bez przed dziś jutro wszystko`.split(/\s+/)
);
const englishWords = new Set(
  `the and to of a in is it you that for on with are this be have we your can will please thanks thank hi
   hello could would from at by not as or if me my our but they what when about send let know best regards
   attached`.split(/\s+/)
);
const germanWords = new Set(
  `der die das und ist nicht ich sie wir bitte mit für von zu den dem ein eine einen auf auch noch sich aber
   guten tag schicken mir bis haben wird können danke freundlichen grüße über`.split(/\s+/)
);
const polishLetters = /[ąćęłńóśźż]/;

function countHits(words: readonly string[], list: ReadonlySet<string>): number {
  return words.filter((w) => list.has(w)).length;
}

// Guesses the language of a mail text from stopwords; a short or mixed text is "unknown".
export function detectLang(text: string): DetectedLang {
  const words = text.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  const scores: [Exclude<DetectedLang, "unknown">, number][] = [
    ["pl", countHits(words, polishWords) + words.filter((w) => polishLetters.test(w)).length],
    ["en", countHits(words, englishWords)],
    ["de", countHits(words, germanWords)],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  const [top, second] = scores;
  if (top === undefined || second === undefined) return "unknown";
  return top[1] >= MIN_HITS && top[1] >= MIN_RATIO * second[1] ? top[0] : "unknown";
}
