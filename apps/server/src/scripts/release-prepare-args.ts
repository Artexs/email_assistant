import { parseArgs } from "node:util";

export interface ReleasePrepareArgs {
  version: string;
  /** UTC date `YYYY-MM-DD`; set by `--date` (tests), else today. */
  date: string | null;
  root: string;
}

/** One version argument, `--date` and `--root` (default: the current folder). null on any bad argument; the script prints the usage. */
export function parseReleasePrepareArgs(argv: string[]): ReleasePrepareArgs | null {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: { date: { type: "string" }, root: { type: "string" } },
      allowPositionals: true,
      strict: true,
    });
    const [version] = positionals;
    if (positionals.length !== 1 || version === undefined) return null;
    if (values.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(values.date)) return null;
    if (values.root === "") return null;
    return { version, date: values.date ?? null, root: values.root ?? "." };
  } catch {
    return null;
  }
}
