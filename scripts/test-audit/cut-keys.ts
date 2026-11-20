// Finds the approved cases of a cut stage by name at the stage base.
// Usage: bun scripts/test-audit/cut-keys.ts --scan <cases-static.tsv> (--group <Gnn> | --keys <k1,k2,…>)
//          [--area <path prefix>] [--audit <audit dir>] --out <tsv>
// A key is `file:line` at the base of the job that wrote it, so it drifts. This tool maps each key to its
// old (file, describePath, name) triple and looks the triple up in a fresh scan at the stage base.
import * as path from "node:path";

export interface Triple {
  file: string;
  describePath: string;
  name: string;
}
export interface ScanCase extends Triple {
  key: string;
}
export type KeyStatus = "ok" | "rejected" | "missing" | "deferred-none" | "deferred-two";
export interface KeyRow extends Triple {
  oldKey: string;
  newKey: string;
  status: KeyStatus;
}
export interface KeyData {
  reject: ReadonlySet<string>;
  approved: ReadonlyMap<string, Triple>;
  cases: ReadonlyMap<string, Triple>;
}

const COLUMNS = ["old_key", "new_key", "status", "file", "describePath", "name"];
const EMPTY: Triple = { file: "", describePath: "", name: "" };

export function parseTable(text: string): Record<string, string>[] {
  const [head, ...lines] = text.split("\n").filter((line) => line !== "");
  if (head === undefined) return [];
  const names = head.split("\t");
  return lines.map((line) => {
    const cells = line.split("\t");
    return Object.fromEntries(names.map((name, i) => [name, cells[i] ?? ""]));
  });
}

function toTriple(row: Record<string, string>): Triple {
  return { file: row.file ?? "", describePath: row.describePath ?? "", name: row.name ?? "" };
}

export function tripleMap(text: string): Map<string, Triple> {
  return new Map(parseTable(text).map((row) => [row.key ?? "", toTriple(row)]));
}

export function scanCases(text: string): ScanCase[] {
  return parseTable(text).map((row) => ({ key: row.key ?? "", ...toTriple(row) }));
}

export function rejectKeys(text: string): Set<string> {
  return new Set(parseTable(text).map((row) => row.key ?? ""));
}

export function groupKeys(approvalText: string, group: string): string[] {
  const row = parseTable(approvalText).find((item) => item.group === group);
  if (!row) throw new Error(`cut-keys: group ${group} is not in approval-groups.tsv`);
  return (row.keys ?? "").split(",").filter((key) => key !== "");
}

// A name may hold a comma, so a piece that is neither `file:line` nor `file::name` continues the previous item.
export function splitKeys(list: string): string[] {
  const items: string[] = [];
  for (const piece of list.split(",")) {
    const last = items.length - 1;
    const startsItem = /:\d+$/.test(piece) || piece.includes("::");
    if (startsItem || last < 0) items.push(piece);
    else items[last] = `${items[last]},${piece}`;
  }
  return items.filter((item) => item !== "");
}

export function underArea(key: string, area: string | undefined): boolean {
  return area === undefined || key.startsWith(area);
}

function countIn(scan: readonly ScanCase[], keep: (item: ScanCase) => boolean): ScanCase[] {
  return scan.filter(keep);
}

function resolved(oldKey: string, found: ScanCase[], old: Triple): KeyRow {
  if (found.length === 1) return { oldKey, newKey: (found[0] as ScanCase).key, status: "ok", ...old };
  return { oldKey, newKey: "", status: found.length === 0 ? "deferred-none" : "deferred-two", ...old };
}

export function resolveKey(item: string, data: KeyData, scan: readonly ScanCase[]): KeyRow {
  if (data.reject.has(item)) return { oldKey: item, newKey: "", status: "rejected", ...EMPTY };
  const named = item.indexOf("::");
  if (named >= 0) {
    const file = item.slice(0, named);
    const name = item.slice(named + 2);
    const found = countIn(scan, (row) => row.file === file && row.name === name);
    return resolved(item, found, { file, describePath: "", name });
  }
  const old = data.approved.get(item) ?? data.cases.get(item);
  if (!old) return { oldKey: item, newKey: "", status: "missing", ...EMPTY };
  const found = countIn(
    scan,
    (row) => row.file === old.file && row.describePath === old.describePath && row.name === old.name
  );
  return resolved(item, found, old);
}

export function rowsToTsv(rows: readonly KeyRow[]): string {
  const lines = rows.map((row) =>
    [row.oldKey, row.newKey, row.status, row.file, row.describePath, row.name].join("\t")
  );
  return `${[COLUMNS.join("\t"), ...lines].join("\n")}\n`;
}

async function findAuditDir(root: string): Promise<string> {
  const glob = new Bun.Glob("spec/features/active/F125-*/audit");
  for await (const hit of glob.scan({ cwd: root, onlyFiles: false })) return path.join(root, hit);
  throw new Error("cut-keys: no audit folder under spec/features/active/F125-*; pass --audit <dir>");
}

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

async function main(): Promise<void> {
  const usage =
    "usage: bun scripts/test-audit/cut-keys.ts --scan <tsv> (--group <Gnn> | --keys <k1,k2>) [--area <prefix>] --out <tsv>";
  const scanPath = arg("--scan");
  const out = arg("--out");
  const group = arg("--group");
  const keys = arg("--keys");
  if (!scanPath || !out || (group === undefined) === (keys === undefined)) throw new Error(usage);
  const root = path.resolve(import.meta.dir, "../..");
  const audit = arg("--audit") ?? (await findAuditDir(root));
  const read = (file: string): Promise<string> => Bun.file(path.join(audit, file)).text();
  const data: KeyData = {
    reject: rejectKeys(await read("reject.tsv")),
    approved: tripleMap(await read("data/approved-keys.tsv")),
    cases: tripleMap(await read("data/cases.tsv")),
  };
  const items = group === undefined ? splitKeys(keys as string) : groupKeys(await read("approval-groups.tsv"), group);
  const scan = scanCases(await Bun.file(scanPath).text());
  const rows = items.filter((item) => underArea(item, arg("--area"))).map((item) => resolveKey(item, data, scan));
  await Bun.write(out, rowsToTsv(rows));
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  const summary = [...counts].map(([status, count]) => `${status} ${count}`).join(", ");
  process.stdout.write(`keys ${rows.length}${summary ? `: ${summary}` : ""}\n`);
}

if (import.meta.main) await main();
