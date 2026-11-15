// The text views that the reply checks scan. The model can hide an address, a link or a number in a form that a
// plain pattern does not see: fullwidth letters, zero-width characters, percent codes, HTML entities, "(at)" words,
// "hxxp" and lookalike dots, slashes and digits. Each view undoes one group of these tricks. A check scans every
// view, so a form that shows in any view counts. Pure code.

// Characters that show no glyph and break a pattern: zero width, bidi marks and the soft hyphen.
const FORMAT_CHARS = /[\p{Cf}]/gu;

// Lookalikes that NFKC keeps: the ideographic full stop and the middle dots, slash lookalikes, dash lookalikes.
const DOTS = /[。·∙]/g;
const SLASHES = /[⁄∕⧸╱]/g;
const DASHES = /[‐-―−]/g;

// Letters of other scripts that look like a Latin letter. The map is small on purpose: it serves the scheme and
// header-name checks, where one lookalike letter hides a word.
const CONFUSABLES: Record<string, string> = {
  а: "a",
  е: "e",
  о: "o",
  р: "p",
  с: "c",
  х: "x",
  у: "y",
  і: "i",
  ѕ: "s",
  ј: "j",
  һ: "h",
  ԁ: "d",
  ɡ: "g",
  ο: "o",
  α: "a",
  ε: "e",
  ν: "v",
  τ: "t",
  ρ: "p",
  ι: "i",
  κ: "k",
  ѵ: "v",
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  commat: "@",
  period: ".",
  colon: ":",
  sol: "/",
  lt: "<",
  gt: ">",
  lpar: "(",
  rpar: ")",
  lsqb: "[",
  rsqb: "]",
  lbrack: "[",
  rbrack: "]",
  hyphen: "-",
  comma: ",",
};

/** Any Unicode decimal digit becomes 0–9: Arabic-Indic, fullwidth, mathematical and the others. */
export function asciiDigits(text: string): string {
  return text.replace(/\p{Nd}/gu, (char) => {
    const code = char.codePointAt(0) ?? 0;
    // Each run of decimal digits starts at a zero and holds a multiple of ten characters.
    let start = code;
    while (/^\p{Nd}$/u.test(String.fromCodePoint(start - 1))) start -= 1;
    return String((code - start) % 10);
  });
}

function foldBasics(text: string): string {
  return asciiDigits(
    text
      .replace(FORMAT_CHARS, "")
      .normalize("NFKC")
      .replace(DOTS, ".")
      .replace(SLASHES, "/")
      .replace(DASHES, "-")
      .replace(/\p{Zs}/gu, " ")
  );
}

function decodeOnce(text: string): string {
  return text
    .replace(/&#x([0-9a-f]{1,6});?/gi, (m, hex: string) => fromCode(Number.parseInt(hex, 16), m))
    .replace(/&#(\d{1,7});?/g, (m, dec: string) => fromCode(Number.parseInt(dec, 10), m))
    .replace(/&([a-z]{2,8});/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
    .replace(/%([0-9a-f]{2})/gi, (_m, hex: string) => fromCode(Number.parseInt(hex, 16), _m))
    .replace(/\\u([0-9a-f]{4})/gi, (m, hex: string) => fromCode(Number.parseInt(hex, 16), m))
    .replace(/\\x([0-9a-f]{2})/gi, (m, hex: string) => fromCode(Number.parseInt(hex, 16), m));
}

// A control character, or a code out of range, stays as the entity text.
function fromCode(code: number, fallback: string): string {
  if (code < 0x20) return fallback;
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}

// "(at)", "[at]", "{dot}", "<dot>" and "[.]" with the Polish words "małpa" and "kropka"; also "jan at firma dot pl" and "h t t p s://".
function deobfuscate(text: string): string {
  return text
    .replace(/\s*[[({<]\s*(?:at|małpa|malpa)\s*[\])}>]\s*/gi, "@")
    .replace(/\s*[[({<]\s*(?:dot|kropka)\s*[\])}>]\s*/gi, ".")
    .replace(/\s*[[({<]\s*\.\s*[\])}>]\s*/g, ".")
    .replace(/(?<=[\w.+-])\s+(?:at|małpa|malpa)\s+(?=[\w-]+\s+(?:dot|kropka)\s)/gi, "@")
    .replace(/(?<=@[\w-]+(?:\s*\.\s*[\w-]+)*)\s+(?:dot|kropka)\s+(?=[\w-])/gi, ".")
    .replace(/\bh\s?t\s?t\s?p(\s?s)?\s?:/gi, (m) => m.replace(/\s/g, ""));
}

/** NFKC, no format characters, lookalike dots, slashes, dashes and digits made plain. */
export function plainView(text: string): string {
  return foldBasics(text);
}

/** The plain view with percent codes, HTML entities and "(at)" words decoded (three rounds for double coding). */
export function decodedView(text: string): string {
  let out = foldBasics(text);
  for (let round = 0; round < 3; round += 1) {
    const next = foldBasics(decodeOnce(out));
    if (next === out) break;
    out = next;
  }
  return deobfuscate(out);
}

/** Every view of a text that a check scans. The first is the plain view. */
export function viewsOf(text: string): string[] {
  return [plainView(text), decodedView(text)];
}

/** Lookalike letters of other scripts become Latin; used for scheme and header names. */
export function skeleton(text: string): string {
  let out = "";
  for (const char of text) out += CONFUSABLES[char] ?? CONFUSABLES[char.toLowerCase()] ?? char;
  return out;
}

/** Lower case with every run of white space as one space. */
export function collapse(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}
