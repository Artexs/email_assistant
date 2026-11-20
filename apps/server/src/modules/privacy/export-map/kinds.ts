// What `org:export` writes, per table and column. Test `privacy-export-map` compares the
// keys with `information_schema`: a new table or column fails there until someone classifies it here.
export type ExportTable =
  | {
      export: true;
      // `org_id`: rows with this organization (`organizations` by its `id`). `members`: users with a membership in it.
      via: "org_id" | "members";
      columns: readonly string[];
      // Column → reason for a column that stays out of the file.
      excluded: Readonly<Record<string, string>>;
    }
  | { export: false; reason: string };

// A table of the first kind with every column: no `org_id` table has a column that holds a secret (credentials live in
// `mailbox_credentials`, which is not exported).
export const byOrg = (...columns: string[]): ExportTable => ({ export: true, via: "org_id", columns, excluded: {} });

// A table with a column that the export leaves out (a value that the database derives from another column).
export const byOrgExcluding = (excluded: Record<string, string>, ...columns: string[]): ExportTable => ({
  export: true,
  via: "org_id",
  columns,
  excluded,
});

export const secret = (reason: string): ExportTable => ({ export: false, reason });
