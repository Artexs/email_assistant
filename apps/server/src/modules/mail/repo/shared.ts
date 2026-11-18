import type { Transaction } from "kysely";

import type { DB, Db } from "../../../platform/db";

export type DbOrTrx = Db | Transaction<DB>;

// SQL: the `Auto-Submitted` column is not an automatic mail: empty, or `no` (RFC 3834; parameters after `;` are ignored). The same rule as
// `isAutoSubmitted` of core. `column` is a trusted column name of this code, never user input.
export const notAutomaticSql = (column: string): string =>
  `(${column} IS NULL OR btrim(${column}) = '' OR lower(btrim(split_part(${column}, ';', 1))) = 'no')`;
