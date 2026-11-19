// Output formats of the static scan: TSV rows, groups and the summary page.
import type { CaseRow } from "./scan";

const AREAS = [
  "packages/core",
  "apps/server/src",
  "apps/server/test",
  "apps/web/src",
  "apps/web/integrations",
  "apps/web/e2e",
  "apps/docs",
  "deploy/test",
  "tools/fake-telegram",
  "tools/mail-oauth-spike",
];
const FLAGS = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"];
const BIGGEST_GROUPS = 20;

export function areaOf(file: string): string {
  return AREAS.find((area) => file.startsWith(`${area}/`)) ?? "other";
}

function cell(value: string | number | boolean | string[]): string {
  const text = Array.isArray(value) ? value.join(",") : String(value);
  return text.replace(/[\t\r\n]+/g, " ");
}

export function rowsToTsv(rows: CaseRow[]): string {
  const header = [
    "key",
    "file",
    "line",
    "kind",
    "describePath",
    "name",
    "each",
    "expectCalls",
    "matchers",
    "flags",
    "bodyGroup",
    "shapeGroup",
    "skipCondition",
    "bodyLines",
    "shared",
  ];
  const lines = rows.map((row) =>
    [
      row.key,
      row.file,
      row.line,
      row.kind,
      row.describePath,
      row.name,
      row.each,
      row.expectCalls,
      row.matchers,
      row.flags,
      row.bodyGroup,
      row.shapeGroup,
      row.skipCondition,
      row.bodyLines,
      row.shared,
    ]
      .map(cell)
      .join("\t")
  );
  return `${[header.join("\t"), ...lines].join("\n")}\n`;
}

interface Group {
  group: string;
  type: "B" | "T";
  files: number;
  cases: number;
  keys: string[];
}

function collectGroups(rows: CaseRow[]): Group[] {
  const map = new Map<string, CaseRow[]>();
  for (const row of rows) {
    for (const id of [row.bodyGroup, row.shapeGroup]) {
      if (id === "") continue;
      map.set(id, [...(map.get(id) ?? []), row]);
    }
  }
  const groups: Group[] = [...map].map(([group, members]) => ({
    group,
    type: group.startsWith("B") ? "B" : "T",
    files: new Set(members.map((row) => row.file)).size,
    cases: members.length,
    keys: members.map((row) => row.key),
  }));
  const order = (id: string): number => Number(id.slice(1));
  return groups.sort((a, b) => (a.type === b.type ? order(a.group) - order(b.group) : a.type < b.type ? -1 : 1));
}

export function groupsToTsv(rows: CaseRow[]): string {
  const header = ["group", "type", "files", "cases", "keys"].join("\t");
  const lines = collectGroups(rows).map((group) =>
    [group.group, group.type, group.files, group.cases, group.keys].map(cell).join("\t")
  );
  return `${[header, ...lines].join("\n")}\n`;
}

function table(header: string[], body: (string | number)[][]): string[] {
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((line) => `| ${line.join(" | ")} |`),
  ];
}

function countBy(rows: CaseRow[], keyOf: (row: CaseRow) => string): Map<string, CaseRow[]> {
  const map = new Map<string, CaseRow[]>();
  for (const row of rows) map.set(keyOf(row), [...(map.get(keyOf(row)) ?? []), row]);
  return map;
}

export function summarise(rows: CaseRow[], sharedFiles: string[]): string {
  const byArea = countBy(rows, (row) => areaOf(row.file));
  const areas = [...AREAS, "other"].filter((area) => byArea.has(area));
  const kinds = ["unit", "int", "e2e"];
  const out: string[] = ["# Static scan summary", "", `Total rows: ${rows.length} (one per test or it call site).`, ""];
  out.push(
    "## Rows per kind",
    "",
    ...table(
      ["kind", "rows"],
      kinds.map((kind) => [kind, rows.filter((row) => row.kind === kind).length])
    ),
    ""
  );
  out.push(
    "## Rows per area",
    "",
    ...table(
      ["area", "rows", "unit", "int", "e2e"],
      areas.map((area) => {
        const list = byArea.get(area) ?? [];
        return [area, list.length, ...kinds.map((kind) => list.filter((row) => row.kind === kind).length)];
      })
    ),
    ""
  );
  const flagged = (list: CaseRow[]): number => list.filter((row) => row.flags.length > 0).length;
  out.push(
    "## Flags per area",
    "",
    ...table(
      ["area", ...FLAGS, "flagged rows"],
      [
        ...areas.map((area) => {
          const list = byArea.get(area) ?? [];
          return [area, ...FLAGS.map((flag) => list.filter((row) => row.flags.includes(flag)).length), flagged(list)];
        }),
        ["all", ...FLAGS.map((flag) => rows.filter((row) => row.flags.includes(flag)).length), flagged(rows)],
      ]
    ),
    ""
  );
  const big = areas.filter((area) => flagged(byArea.get(area) ?? []) > 150);
  out.push(`Areas with more than 150 flagged rows: ${big.length > 0 ? big.join(", ") : "none"}.`, "");
  const groups = collectGroups(rows);
  const bGroups = groups.filter((group) => group.type === "B");
  const tGroups = groups.filter((group) => group.type === "T");
  out.push(
    "## Groups",
    "",
    `B groups (same body): ${bGroups.length}, holding ${bGroups.reduce((sum, group) => sum + group.cases, 0)} cases.`,
    `T groups (same shape, one file): ${tGroups.length}, holding ${tGroups.reduce((sum, group) => sum + group.cases, 0)} cases.`,
    ""
  );
  const biggest = [...groups]
    .sort((a, b) => b.cases - a.cases || a.group.localeCompare(b.group))
    .slice(0, BIGGEST_GROUPS);
  out.push(
    `### The ${BIGGEST_GROUPS} biggest groups`,
    "",
    ...table(
      ["group", "cases", "files", "first key"],
      biggest.map((group) => [group.group, group.cases, group.files, group.keys[0] ?? ""])
    ),
    "",
    "## Shared suite modules",
    "",
    sharedFiles.length > 0 ? sharedFiles.map((file) => `- ${file}`).join("\n") : "none",
    ""
  );
  return out.join("\n");
}
