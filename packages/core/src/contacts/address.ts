// The one rule that turns a sender or recipient address into the form that the sender profile keys on (the keyed hash
// of `senderKeyHash` is computed from this form, on every path). Trim, lower case with the Unicode default mapping, then
// two folds that make the JavaScript lower case and the database `lower()` agree:
//   - Greek final sigma `ς` becomes `σ`: JavaScript lowers a capital sigma at the end of a word to `ς`, the database to `σ`.
//   - The dotted capital I `İ` lowers to `i` plus a combining dot (U+0307) in JavaScript and to `i` in the database: the
//     combining dot is dropped.
// The server mirrors this rule in SQL (`platform/db/address-sql.ts`) and a test compares the two on a fixed set of probes.
// It assumes that the database lowers non-ASCII letters (a UTF-8 locale such as `en_US.utf8` or `C.UTF-8`).
const COMBINING_DOT_ABOVE = "\u0307";

// The code points that `String.prototype.trim()` strips, in code-point order: tab, line feed, vertical tab, form feed,
// carriage return, space, no-break space, Ogham space mark, the en and em spaces to the hair space, line and paragraph
// separator, narrow no-break space, medium mathematical space, ideographic space and the byte order mark. The program form
// keeps `trim()`; the SQL form strips this set with `btrim(column, set)`, so both forms cut the same ends. A unit test pins
// `trim()` to this string over every code point.
export const ADDRESS_TRIM_CHARS =
  "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";

const PRINTABLE_ASCII = /^[ -~]*$/;

// The one rule (the compare key of an address). Printable ASCII holds no `ς` and no combining dot, so it skips the two
// folds: the output stays the same, the cost goes down for the common case.
export function normalizeAddress(address: string): string {
  if (PRINTABLE_ASCII.test(address)) return address.trim().toLowerCase();
  return address.trim().toLowerCase().replaceAll("ς", "σ").replaceAll(`i${COMBINING_DOT_ABOVE}`, "i");
}

// The form of an address that is stored, shown and sent: trim and lower case, no fold. The rule form (`normalizeAddress`)
// is a compare key only: it turns `νίκος` into `νίκοσ`, which is another mailbox for a strict mail server.
export function storedAddressForm(address: string): string {
  return address.trim().toLowerCase();
}

const MAX_FINAL_SIGMA_POSITIONS = 4;

// The strings that the database `lower()` can give for a From address whose rule form is `address`: the input first, then
// each variant that holds `ς` in place of a word-final `σ` (a `σ` followed by the end or by a character that is not a
// letter), over every subset of the first four such positions (at most 16 strings, no duplicates). The database keeps a
// typed `ς` and lowers a capital sigma to `σ`, so a column read `= ANY(forms)` on `lower(from_address)` finds the realistic
// spellings with its index. A superset: the caller decides the exact match. A From with padding, a combining dot, or a
// typed `ς` after the fourth word-final `σ` is not covered.
export function addressLowerForms(address: string): string[] {
  const positions: number[] = [];
  for (let i = 0; i < address.length && positions.length < MAX_FINAL_SIGMA_POSITIONS; i++) {
    if (address[i] !== "σ") continue;
    const next = address.codePointAt(i + 1);
    if (next === undefined || !/^\p{L}$/u.test(String.fromCodePoint(next))) positions.push(i);
  }
  const forms: string[] = [];
  for (let mask = 0; mask < 1 << positions.length; mask++) {
    let form = address;
    positions.forEach((position, bit) => {
      if (mask & (1 << bit)) form = `${form.slice(0, position)}ς${form.slice(position + 1)}`;
    });
    forms.push(form);
  }
  return forms;
}

// Every single code point (1 to 0x10FFFF, no surrogates) grouped by the form that `normalizeAddress` gives it. A
// character is a case form of a letter when the rule folds it to that letter. Built once, on the first call: the scan
// of all code points takes about 0.4 s. The whitespace set folds to the empty string and joins no letter.
let caseForms: Map<string, string[]> | undefined;

function caseFormTable(): Map<string, string[]> {
  if (caseForms !== undefined) return caseForms;
  const forms = new Map<string, string[]>();
  for (let cp = 1; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const char = String.fromCodePoint(cp);
    const target = normalizeAddress(char);
    if (target === "") continue;
    const list = forms.get(target);
    if (list === undefined) forms.set(target, [char]);
    else list.push(char);
  }
  caseForms = forms;
  return forms;
}

// Every string that `normalizeAddress` folds to `letter`, with `letter` first, then the other single code points in
// code-point order, then the forms of two code points. `letter` is one code point that is already in the form of the
// rule (a lower-case letter, a digit or a punctuation character; never `ς`, which the rule folds to `σ`). The regular
// expression of the data request match (`addressRegex`, `modules/privacy/address-map.ts`) is built from these forms,
// so the text match finds exactly what the equality match finds: `K` (Kelvin sign) and `k` are forms of `k`, a dotless `ı` is
// a form of itself only. The letter `i` also takes `i` and `I` followed by the combining dot above (U+0307): the rule
// drops the dot, so a text that holds `I` and the dot is the person's address too.
export function addressCaseForms(letter: string): readonly string[] {
  const list = caseFormTable().get(letter);
  const others = (list ?? []).filter((form) => form !== letter);
  const joined = letter === "i" ? [`i${COMBINING_DOT_ABOVE}`, `I${COMBINING_DOT_ABOVE}`] : [];
  return [letter, ...others, ...joined];
}

// Every code point that has another case form under the rule (a capital, a Kelvin or Ohm sign, a final sigma, the dotted
// capital I) or is the form of such a letter, in ascending order. A letter next to an address makes the address part of a
// longer word, so the data request match (`addressRegex`) takes these as word characters, whatever the database calls a
// letter in its locale. A letter without a case form (the dotless `ı`) is not here: a range of letters covers it.
let casedCodePoints: readonly number[] | undefined;

export function addressCasedCodePoints(): readonly number[] {
  if (casedCodePoints === undefined) {
    const found: number[] = [];
    for (const [target, list] of caseFormTable()) {
      if (list.length < 2) continue;
      found.push(target.codePointAt(0) as number, ...list.map((form) => form.codePointAt(0) as number));
    }
    casedCodePoints = [...new Set(found)].sort((a, b) => a - b);
  }
  return casedCodePoints;
}
