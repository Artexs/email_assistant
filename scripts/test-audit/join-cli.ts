// Usage: bun scripts/test-audit/join-cli.ts --in <dir with unit.xml and int.xml> --data <audit data dir>
// Reads <data>/cases-static.tsv; writes cases.tsv, junit-cases.tsv and timing-summary.md into <data>.
import { casesToTsv, junitCasesToTsv, timingSummary } from "./join-format";
import { joinCases, parseStaticTsv, type TimedCase } from "./join";
import { parseJunit } from "./junit";

function arg(name: string): string {
  const at = process.argv.indexOf(name);
  const value = at === -1 ? undefined : process.argv[at + 1];
  if (value === undefined) throw new Error(`usage: join-cli.ts --in <dir> --data <dir> (missing ${name})`);
  return value;
}

const input = arg("--in");
const data = arg("--data");
const staticText = await Bun.file(`${data}/cases-static.tsv`).text();
const columns = (staticText.split("\n")[0] as string).split("\t");
const timed: TimedCase[] = [];
for (const suite of ["unit", "int"] as const) {
  const xml = await Bun.file(`${input}/${suite}.xml`).text();
  timed.push(...parseJunit(xml).map((item) => ({ ...item, suite })));
}

const result = joinCases(parseStaticTsv(staticText), timed);
await Bun.write(`${data}/cases.tsv`, casesToTsv(columns, result));
await Bun.write(`${data}/junit-cases.tsv`, junitCasesToTsv(result.cases));
await Bun.write(`${data}/timing-summary.md`, timingSummary(result));
process.stdout.write(`rows ${result.rows.length}, JUnit cases ${result.cases.length}\n`);
