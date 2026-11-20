import { addressCaseForms, addressCasedCodePoints, normalizeAddress } from "@ea/core";

const MAX_ADDRESS_LENGTH = 254;

// Trims and lower-cases by the one address rule of `@ea/core` (`normalizeAddress`): the same form as the SQL compare
// of the match (`normalizedAddress`), also for a Greek final sigma and a Turkish dotted capital I. Null unless the value is one address: one `@`, a domain of non-empty labels with a dot, at most
// 254 characters, and no whitespace, quote, backslash, angle bracket, control, format (zero-width) or separator
// character. A value that NFKC changes (full-width letters) is null: it would match no stored address. Reviewed after
// `p@x.test.`, `p@.test` and `p@x..test` matched nothing and passed.
export function normalizeDsrAddress(input: string): string | null {
  const address = normalizeAddress(input);
  if (address.length === 0 || address.length > MAX_ADDRESS_LENGTH) return null;
  if (/[\s"\\<>\p{Cc}\p{Cf}\p{Z}]/u.test(address)) return null;
  if (address.normalize("NFKC") !== address) return null;
  const parts = address.split("@");
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  if (!local || !domain || !domain.includes(".")) return null;
  if (domain.split(".").some((label) => label === "")) return null;
  return address;
}

// Characters that can stand next to an address inside one larger word: the RFC 5322 `atext` characters and the dot of
// a local part, and letters. The pattern is case-sensitive, so the ASCII letters are both `a-z` and `A-Z`. The letters are
// every code point that has a case form under the address rule (a capital, the Kelvin sign, a final sigma: `CASED`), the
// Latin, Greek and Cyrillic ranges that hold the other non-ASCII letters, and the POSIX class (`[:alpha:]` depends on
// the database locale, the ranges and the table do not). The combining marks are word characters too: the address
// rule does not strip them, so `jose` + U+0301 + `bob@x.test` is another address than `bob@x.test` (the equality match
// agrees). The look-behind rejects the address inside a longer local part (`o'p@x.test`, `=p@x.test`, `x/p@x.test`,
// `łp@x.test`). The ranges were widened after a review.
const ATEXT = "A-Za-z0-9._%+!#$&'*/=?^`{|}~-";
const MARKS = "\\u0300-\\u036f\\u1ab0-\\u1aff\\u1dc0-\\u1dff\\u20d0-\\u20ff\\ufe20-\\ufe2f";
const LETTER_RANGES = "[:alpha:]\\u00c0-\\u00d6\\u00d8-\\u00f6\\u00f8-\\u024f\\u0370-\\u052f";

// The code points of `addressCasedCodePoints` as the ranges of a bracket expression, built once.
let casedClass: string | undefined;

function casedRanges(): string {
  if (casedClass === undefined) {
    const points = addressCasedCodePoints();
    const parts: string[] = [];
    for (let at = 0; at < points.length; ) {
      let end = at;
      while (end + 1 < points.length && (points[end + 1] as number) === (points[end] as number) + 1) end++;
      const first = String.fromCodePoint(points[at] as number);
      const last = String.fromCodePoint(points[end] as number);
      parts.push(end === at ? first : `${first}-${last}`);
      at = end + 1;
    }
    casedClass = parts.join("");
  }
  return casedClass;
}

// A character that is special in a Postgres regular expression, or inside a bracket expression, gets a backslash.
const escapeChar = (char: string): string => char.replace(/[!-/:-@[-`{-~]/u, "\\$&");

// One character of the asked address as the pattern for every form of it that the rule folds to it. A letter with one
// form is that character. A letter with more forms is a class of them; the forms of two code points (`i` and `I` with the
// combining dot above) are alternatives of the class.
function letterPattern(letter: string): string {
  const forms = addressCaseForms(letter);
  if (forms.length === 1) return escapeChar(letter);
  const single = forms.filter((form) => [...form].length === 1);
  const joined = forms.filter((form) => [...form].length > 1);
  const set = `[${single.map(escapeChar).join("")}]`;
  if (joined.length === 0) return set;
  return `(?:${[set, ...joined.map((form) => [...form].map(escapeChar).join(""))].join("|")})`;
}

// The Postgres regular expression for `text` and `json` columns (fact 5). Run it with `matchesAddress` and
// `replaceAddress`, never with the case-insensitive operator or the flag `i`: the pattern is case-sensitive and holds, for each letter of the
// address, every form that the one address rule (`normalizeAddress`) folds to it (`addressCaseForms`: `K` and the
// Kelvin sign for `k`, `ẞ` for `ß`, `Σ`, `σ` and `ς` for `σ`, `I`, `İ` and `i` or `I` with a combining dot for `i`). So the
// text match agrees with the equality match (`normalizedAddress`): a dotless `ı` is not an `i`, and `ſ` is not an `s`, which
// a case-insensitive match did not know. `jimbob@x.test`, `o'bob@x.test`, `bob@x.test.pl`, `bob@x.test_x` and
// `bob@x.testé` do not match `bob@x.test`; `bob@x.test.` (end of a sentence), `<bob@x.test>` and `"bob@x.test"` do.
// The input must be normalized (`normalizeDsrAddress`).
//
// A quote or a brace at the start of the text or after a non-`atext` character is a boundary too (found in a
// review: `'p@x.test'` and `{p@x.test}` stayed in the text); `p@x.test.vcf` is still a longer domain (a documented limit).
//
// A key and `=` in front of the address is a boundary too (`smtp.mailfrom=p@x.test` in `auth_results`, the reason that this
// column is mapped); a bare `=p@x.test` is still a longer local part. Found in testing: the look-behind of `atext`
// alone left the address in `auth_results`. A local part such as `a=p` is scrubbed too: it errs on the side of removing.
//
// With `json: true` the pattern is for the text form of a jsonb value. There a line break, a tab or a similar control
// character stands as a two-character escape (`\n`), so a letter stands in front of an address that follows a line break
// (`Regards\np@x.test`). The json pattern also accepts a look-behind of such an escape. It can scrub a little more than
// needed (`\\np@x.test`: an escaped backslash and `np@x.test`); it never scrubs less. Found in testing: the plain
// pattern left an address on its own line of a draft payload.
export function addressRegex(address: string, opts: { json?: boolean } = {}): string {
  const escaped = [...address].map(letterPattern).join("");
  const word = `${LETTER_RANGES}${casedRanges()}${MARKS}`;
  // A quote or a brace is `atext`, so it joins the local part (`o'p@x.test`, `a{p@x.test`). At the start of the text or
  // after a character that is not `atext` it is punctuation around the address (`'p@x.test'`, `{p@x.test}`).
  const starts = [`(?<![${word}${ATEXT}])`, "(?<=[A-Za-z]=)", `(?<=(?:^|[^${word}${ATEXT}])['{])`];
  if (opts.json) starts.push("(?<=\\\\[nrtbf])");
  return `(?:${starts.join("|")})${escaped}(?![A-Za-z0-9_${word}-]|\\.[A-Za-z0-9${word}])`;
}
