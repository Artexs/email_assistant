// CLI of the static scan: lists the test files, scans every case, writes the TSV data and a summary.
// Usage: bun scripts/test-audit/scan-cli.ts --out <dir>
import * as path from "node:path";
import { assignGroups, isTestFile, scanFile, type BodyText, type CaseRow } from "./scan";
import { createAssertingResolver, createScanProgram, readBaseOptions } from "./scan-program";
import { groupsToTsv, rowsToTsv, summarise } from "./scan-format";

const SHARED_DIRS = ["apps/server/test/", "apps/server/src/", "tools/"];

async function git(root: string, args: string[]): Promise<string[]> {
  const proc = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "inherit" });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  return text.split("\n").filter((line) => line !== "");
}

function outDirOf(argv: string[]): string {
  const index = argv.indexOf("--out");
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value) throw new Error("usage: bun scripts/test-audit/scan-cli.ts --out <dir>");
  return path.resolve(value);
}

async function main(): Promise<void> {
  const outDir = outDirOf(process.argv.slice(2));
  const root = (await git(process.cwd(), ["rev-parse", "--show-toplevel"]))[0] as string;
  const tracked = await git(root, ["ls-files", "*.ts", "*.tsx"]);
  const testFiles = tracked.filter((file) => isTestFile(file) && !file.startsWith("scripts/test-audit/"));
  const sharedFiles: string[] = [];
  for (const file of tracked) {
    if (isTestFile(file) || !SHARED_DIRS.some((dir) => file.startsWith(dir))) continue;
    const text = await Bun.file(path.join(root, file)).text();
    if (text.includes("bun:test")) sharedFiles.push(file);
  }
  const files = [...new Set([...testFiles, ...sharedFiles])].sort();

  const program = createScanProgram(
    files.map((file) => path.join(root, file)),
    readBaseOptions(root)
  );
  const resolveAsserting = createAssertingResolver(program);
  const rows: CaseRow[] = [];
  const bodies = new Map<string, BodyText>();
  for (const file of files) {
    const text = await Bun.file(path.join(root, file)).text();
    const result = scanFile(file, text, (call) => resolveAsserting(call));
    rows.push(...result.rows);
    for (const [key, body] of result.bodies) bodies.set(key, body);
  }
  rows.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  assignGroups(rows, bodies);

  const outputs: [string, string][] = [
    ["cases-static.tsv", rowsToTsv(rows)],
    ["groups.tsv", groupsToTsv(rows)],
    ["scan-summary.md", summarise(rows, [...new Set(rows.filter((row) => row.shared).map((row) => row.file))])],
  ];
  for (const [name, content] of outputs) {
    const target = path.join(outDir, name);
    await Bun.write(target, content);
    process.stdout.write(`wrote ${path.relative(root, target)}\n`);
  }
  process.stdout.write(`rows ${rows.length} from ${files.length} files\n`);
}

await main();
