import { sql } from "kysely";

// The SQL form of `normalizeSenderAddress` (`@ea/core`): trim, `lower()`, then the Greek final sigma (U+03C2) becomes the
// plain sigma (U+03C3) and the combining dot above (U+0307) after an `i` goes. The column is a trusted literal, never user
// input. Every read of an address in the profile pass goes through it, so the incoming sender, the Sent recipient, the
// alias, the delegate and the test sender give one form, and the key hash comes from that form.
export const normalizedAddress = (column: string) =>
  sql.raw(`replace(replace(lower(btrim(${column})), chr(962), chr(963)), 'i' || chr(775), 'i')`);
