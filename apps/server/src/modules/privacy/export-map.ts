// What `org:export` writes, per table and column. Test `privacy-export-map` compares the
// keys with `information_schema`: a new table or column fails there until someone classifies it here.
// The table is cut into slices by key range (`export-map/tables-*.ts`); the export order is the key order, so a slice
// holds consecutive keys. Add a new table to the slice whose range holds its name, in alphabetical order.
import type { ExportTable } from "./export-map/kinds";
import { tablesAD } from "./export-map/tables-a-d";
import { tablesEM } from "./export-map/tables-e-m";
import { tablesNS } from "./export-map/tables-n-s";
import { tablesTZ } from "./export-map/tables-t-z";

export type { ExportTable };

export const EXPORT_MAP: Readonly<Record<string, ExportTable>> = { ...tablesAD, ...tablesEM, ...tablesNS, ...tablesTZ };
