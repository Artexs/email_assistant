// Output formats of the join: cases.tsv, junit-cases.tsv and timing-summary.md.
import type { JoinResult, JoinedCase, TimedRow } from "./join";

const SLOWEST_FILES = 20;
const SLOWEST_CASES = 30;

const cell = (value: string | number | boolean | string[]): string =>
  (Array.isArray(value) ? value.join(",") : String(value)).replace(/[\t\r\n]+/g, " ");

const seconds = (value: number): string => value.toFixed(3);

const EXTRA = ["junit_count", "time_s", "assertions", "skipped"];

// A JUnit case with no scan row becomes a row of its own (flag `unscanned`, key `file:line`).
function unscannedRow(item: JoinedCase, columns: string[]): Record<string, string> {
  const fields: Record<string, string> = Object.fromEntries(columns.map((name) => [name, ""]));
  Object.assign(fields, {
    key: `${item.file}:${item.line}`,
    file: item.file,
    line: String(item.line),
    kind: item.suite,
    describePath: item.classname,
    name: item.name,
    flags: item.reason === "ambiguous" ? "unscanned:ambiguous" : "unscanned",
    shared: "false",
  });
  return fields;
}

export function casesToTsv(columns: string[], result: JoinResult): string {
  const rows: Record<string, string>[] = result.rows.map((row) => ({
    ...row.fields,
    flags: row.outFlags.join(","),
    junit_count: String(row.junitCount),
    time_s: seconds(row.timeS),
    assertions: String(row.assertions),
    skipped: String(row.skipped),
  }));
  for (const item of result.cases.filter((one) => one.key === "unscanned")) {
    rows.push({
      ...unscannedRow(item, columns),
      junit_count: "1",
      time_s: seconds(item.time),
      assertions: String(item.assertions),
      skipped: item.skipped ? "1" : "0",
    });
  }
  const header = [...columns, ...EXTRA];
  return `${[header.join("\t"), ...rows.map((row) => header.map((name) => cell(row[name] ?? "")).join("\t"))].join("\n")}\n`;
}

export function junitCasesToTsv(cases: JoinedCase[]): string {
  const header = ["file", "line", "name", "classname", "time_s", "skipped", "key", "suite"];
  const lines = cases.map((item) =>
    [item.file, item.line, item.name, item.classname, seconds(item.time), item.skipped, item.key, item.suite]
      .map(cell)
      .join("\t")
  );
  return `${[header.join("\t"), ...lines].join("\n")}\n`;
}

function table(header: string[], body: (string | number)[][]): string[] {
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((line) => `| ${line.join(" | ")} |`),
  ];
}

export function timingSummary(result: JoinResult): string {
  const { rows, cases } = result;
  const out: string[] = ["# Timing summary", ""];
  const suites = ["unit", "int"] as const;
  out.push(
    "## Time per suite (sum of the case times, serial run)",
    "",
    ...table(
      ["suite", "JUnit cases", "skipped", "time (s)"],
      suites.map((suite) => {
        const list = cases.filter((item) => item.suite === suite);
        return [
          suite,
          list.length,
          list.filter((item) => item.skipped).length,
          list.reduce((sum, item) => sum + item.time, 0).toFixed(1),
        ];
      })
    ),
    ""
  );
  const perFile = new Map<string, { time: number; cases: number }>();
  for (const item of cases) {
    const entry = perFile.get(item.file) ?? { time: 0, cases: 0 };
    perFile.set(item.file, { time: entry.time + item.time, cases: entry.cases + 1 });
  }
  out.push(
    `## The ${SLOWEST_FILES} slowest files`,
    "",
    ...table(
      ["file", "cases", "time (s)"],
      [...perFile]
        .sort((a, b) => b[1].time - a[1].time || a[0].localeCompare(b[0]))
        .slice(0, SLOWEST_FILES)
        .map(([file, entry]) => [file, entry.cases, entry.time.toFixed(2)])
    ),
    "",
    `## The ${SLOWEST_CASES} slowest cases`,
    "",
    ...table(
      ["time (s)", "suite", "file:line", "name"],
      [...cases]
        .sort((a, b) => b.time - a.time)
        .slice(0, SLOWEST_CASES)
        .map((item) => [item.time.toFixed(2), item.suite, `${item.file}:${item.line}`, item.name.replace(/\|/g, "\\|")])
    ),
    ""
  );
  const unscanned = cases.filter((item) => item.key === "unscanned");
  const notRun = rows.filter((row) => row.outFlags.includes("not-run"));
  const scored = rows.filter((row: TimedRow) => row.kind === "unit" || row.kind === "int");
  const shared = rows.filter((row) => row.shared);
  const sharedCases = cases.filter((item) => shared.some((row) => row.key === item.key));
  const percent = (count: number, total: number): string => `${((100 * count) / total).toFixed(2)} %`;
  out.push(
    "## Join check",
    "",
    `- Scan rows: ${rows.length}; unit or int rows: ${scored.length}; JUnit cases: ${cases.length}.`,
    `- \`unscanned\` JUnit cases: ${unscanned.length} (${percent(unscanned.length, cases.length)} of the JUnit cases), of which ambiguous: ${unscanned.filter((item) => item.reason === "ambiguous").length}.`,
    `- \`not-run\` scan rows: ${notRun.length} (${percent(notRun.length, scored.length)} of the unit and int rows).`,
    `- Shared rows: ${shared.length}; JUnit cases joined to them: ${sharedCases.length} (not counted in \`unscanned\`).`,
    ""
  );
  return out.join("\n");
}
