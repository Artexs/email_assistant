// The one rule that turns a sender or recipient address into the form that the sender profile keys on (the keyed hash
// of `senderKeyHash` is computed from this form, on every path). Trim, lower case with the Unicode default mapping, then
// two folds that make the JavaScript lower case and the database `lower()` agree:
//   - Greek final sigma `ς` becomes `σ`: JavaScript lowers a capital sigma at the end of a word to `ς`, the database to `σ`.
//   - The dotted capital I `İ` lowers to `i` plus a combining dot (U+0307) in JavaScript and to `i` in the database: the
//     combining dot is dropped.
// The server mirrors this rule in SQL (`contacts/address-sql.ts`) and a test compares the two on a fixed set of probes.
// It assumes that the database lowers non-ASCII letters (a UTF-8 locale such as `en_US.utf8` or `C.UTF-8`).
const COMBINING_DOT_ABOVE = "\u0307";

export function normalizeSenderAddress(address: string): string {
  return address.trim().toLowerCase().replaceAll("ς", "σ").replaceAll(`i${COMBINING_DOT_ABOVE}`, "i");
}
