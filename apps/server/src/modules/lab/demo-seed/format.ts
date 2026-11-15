import { DEMO_TABLES, demoColumns, orgColumnOf, type DemoRow, type DemoTable } from "./tables";
import { DEMO_SEED_FORMAT, DemoSeedError, type DemoSeed } from "./types";

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The text of a seed file: the header on top, then each table, one row on one line. Two exports of the same rows give
 * the same bytes, and a diff of two files shows rows, not one long line.
 */
export function serializeDemoSeed(seed: DemoSeed): string {
  const head = [
    `"format": ${JSON.stringify(seed.format)}`,
    `"scenario": ${JSON.stringify(seed.scenario)}`,
    `"runId": ${JSON.stringify(seed.runId)}`,
    `"day": ${JSON.stringify(seed.day)}`,
    `"exportedAt": ${JSON.stringify(seed.exportedAt)}`,
  ];
  const tables = DEMO_TABLES.map((table) => {
    const rows = seed.tables[table].map((row) => `    ${JSON.stringify(row)}`);
    return `  ${JSON.stringify(table)}: [${rows.length === 0 ? "" : `\n${rows.join(",\n")}\n  `}]`;
  });
  return `{\n  ${head.join(",\n  ")},\n  "tables": {\n${tables.map((text) => `  ${text}`).join(",\n")}\n  }\n}\n`;
}

/**
 * Checks the shape of a seed and returns it. A seed holds exactly the tables of `DEMO_TABLES` and, in each row, exactly
 * the exported columns of the table: a secret column (`EXPORT_MAP` says which), a table of users or sessions, or a
 * column the file does not know is refused, and so is a row of another organization. It does not check values.
 */
export function checkDemoSeed(value: unknown): DemoSeed {
  if (!isObject(value) || value.format !== DEMO_SEED_FORMAT) throw new DemoSeedError("bad_format");
  const { scenario, runId, day, exportedAt, tables } = value;
  if (typeof scenario !== "string" || typeof runId !== "string" || typeof exportedAt !== "string") {
    throw new DemoSeedError("bad_seed");
  }
  if (typeof day !== "number" || !Number.isInteger(day) || day < 1 || day > 7) throw new DemoSeedError("bad_seed");
  if (!isObject(tables)) throw new DemoSeedError("bad_seed");
  const known = new Set<string>(DEMO_TABLES);
  for (const name of Object.keys(tables)) if (!known.has(name)) throw new DemoSeedError("bad_seed", name);

  const checked = {} as Record<DemoTable, DemoRow[]>;
  for (const table of DEMO_TABLES) {
    const rows = tables[table];
    if (!Array.isArray(rows)) throw new DemoSeedError("bad_seed", table);
    const columns = new Set(demoColumns(table));
    for (const row of rows) {
      if (!isObject(row)) throw new DemoSeedError("bad_seed", table);
      for (const column of Object.keys(row))
        if (!columns.has(column)) throw new DemoSeedError("bad_seed", table, column);
      for (const column of columns) if (!(column in row)) throw new DemoSeedError("bad_seed", table, column);
    }
    checked[table] = rows as DemoRow[];
  }

  const orgRows = checked.organizations;
  const orgId = orgRows[0]?.id;
  if (orgRows.length !== 1 || typeof orgId !== "string" || !UUID_TEXT.test(orgId)) {
    throw new DemoSeedError("bad_seed", "organizations", "id");
  }
  for (const table of DEMO_TABLES) {
    const column = orgColumnOf(table);
    if (checked[table].some((row) => row[column] !== orgId)) throw new DemoSeedError("foreign_org_row", table, column);
  }
  return { format: DEMO_SEED_FORMAT, scenario, runId, day, exportedAt, tables: checked };
}

/** Parses the text of a seed file and checks its shape. A text that is not JSON is `bad_format`. */
export function parseDemoSeed(text: string): DemoSeed {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new DemoSeedError("bad_format");
  }
  return checkDemoSeed(value);
}
