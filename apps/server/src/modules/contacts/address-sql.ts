import { ADDRESS_TRIM_CHARS, normalizeSenderAddress } from "@ea/core";
import { sql, type RawBuilder, type Transaction } from "kysely";

import type { DB, Db } from "../../platform/db";

// The set that `btrim` strips, built once from the program set as `chr(n)` calls joined by `||`: no string literal, so no
// dependence on the string literal settings of the database. `btrim(column)` alone strips spaces only, while the program
// form strips the 25 code points of `String.prototype.trim()` (tab, NBSP, U+3000, newline, ...).
const SQL_TRIM_SET = [...ADDRESS_TRIM_CHARS].map((char) => `chr(${char.codePointAt(0)})`).join(" || ");

// The SQL form of `normalizeSenderAddress` (`@ea/core`): trim the same code points as `trim()`, `lower()`, then the Greek
// final sigma (U+03C2) becomes the plain sigma (U+03C3) and the combining dot above (U+0307) after an `i` goes. The column
// is a trusted literal, never user input. Every read of an address in the profile pass goes through it, so the incoming
// sender, the Sent recipient, the alias, the delegate and the test sender give one form, and the key hash comes from that
// form. No index or stored column holds this text, so a change of the rule needs no migration.
export const normalizedAddress = (column: string) =>
  sql.raw(`replace(replace(lower(btrim(${column}, ${SQL_TRIM_SET})), chr(962), chr(963)), 'i' || chr(775), 'i')`);

export interface DivergentCodePoint {
  cp: number;
  js: string;
  db: string;
}

// Every code point (1 to 0x10FFFF, no surrogates) where the SQL form of a one-character address differs from the program
// form, in ascending order. The difference comes from the database build (its C library and Unicode version) and from the
// Bun version, so the answer is read from the database that runs. A code point that neither form changes cannot differ,
// so only the code points that the database changes are read (about 1,500 rows, not 1.1 million).
// `form` is the SQL form under test; a test passes a broken form to prove that this check sees the break.
export async function divergentCodePoints(
  db: Db | Transaction<DB>,
  form: (column: string) => RawBuilder<unknown> = normalizedAddress
): Promise<DivergentCodePoint[]> {
  const rows = await sql<{ cp: number; db: string }>`
    select cp, ${form("chr(cp)")} as db
    from generate_series(1, 1114111) as cp
    where cp not between 55296 and 57343 and ${form("chr(cp)")} <> chr(cp)
  `.execute(db);
  const dbForm = new Map(rows.rows.map((row) => [Number(row.cp), row.db]));
  const found: DivergentCodePoint[] = [];
  for (let cp = 1; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const char = String.fromCodePoint(cp);
    const js = normalizeSenderAddress(char);
    const dbText = dbForm.get(cp) ?? char;
    if (js !== dbText) found.push({ cp, js, db: dbText });
  }
  return found;
}
