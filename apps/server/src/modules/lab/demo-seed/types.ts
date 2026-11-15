import type { DemoRow, DemoTable } from "./tables";

export const DEMO_SEED_FORMAT = "ea-demo-seed/1";

/** The org name of an import. The `--replace` option deletes only an org with exactly this name. */
export const IMPORT_ORG_NAME = "Kordelan demo (import)";

export interface DemoSeed {
  format: typeof DEMO_SEED_FORMAT;
  scenario: string;
  runId: string;
  day: number;
  exportedAt: string;
  tables: Record<DemoTable, DemoRow[]>;
}

export type DemoSeedErrorCode =
  // Export.
  | "run_not_demo"
  | "day_out_of_range"
  | "org_mismatch"
  | "non_test_address"
  | "non_test_host"
  | "out_exists"
  // The file.
  | "bad_format"
  | "bad_seed"
  | "foreign_org_row"
  // Import.
  | "import_needs_safe_send_scope"
  | "real_host"
  | "org_id_exists"
  | "import_exists"
  | "replace_ambiguous"
  | "replace_refused";

/** `table` and `column` name where the problem is, never the value. */
export class DemoSeedError extends Error {
  constructor(
    readonly code: DemoSeedErrorCode,
    readonly table?: string,
    readonly column?: string
  ) {
    super(code);
    this.name = "DemoSeedError";
  }

  /** `code` or `code (table.column)`: the text of a CLI line. */
  get detail(): string {
    if (this.table === undefined) return this.code;
    return `${this.code} (${this.table}${this.column === undefined ? "" : `.${this.column}`})`;
  }
}
