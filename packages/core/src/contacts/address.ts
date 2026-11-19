// The one rule that turns a sender or recipient address into the form that the sender profile keys on (the keyed hash
// of `senderKeyHash` is computed from this form, on every path). Trim, lower case with the Unicode default mapping, then
// two folds that make the JavaScript lower case and the database `lower()` agree:
//   - Greek final sigma `ς` becomes `σ`: JavaScript lowers a capital sigma at the end of a word to `ς`, the database to `σ`.
//   - The dotted capital I `İ` lowers to `i` plus a combining dot (U+0307) in JavaScript and to `i` in the database: the
//     combining dot is dropped.
// The server mirrors this rule in SQL (`contacts/address-sql.ts`) and a test compares the two on a fixed set of probes.
// It assumes that the database lowers non-ASCII letters (a UTF-8 locale such as `en_US.utf8` or `C.UTF-8`).
const COMBINING_DOT_ABOVE = "\u0307";

// The code points that `String.prototype.trim()` strips, in code-point order: tab, line feed, vertical tab, form feed,
// carriage return, space, no-break space, Ogham space mark, the en and em spaces to the hair space, line and paragraph
// separator, narrow no-break space, medium mathematical space, ideographic space and the byte order mark. The program form
// keeps `trim()`; the SQL form strips this set with `btrim(column, set)`, so both forms cut the same ends. A unit test pins
// `trim()` to this string over every code point.
export const ADDRESS_TRIM_CHARS =
  "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";

export function normalizeSenderAddress(address: string): string {
  return address.trim().toLowerCase().replaceAll("ς", "σ").replaceAll(`i${COMBINING_DOT_ABOVE}`, "i");
}
