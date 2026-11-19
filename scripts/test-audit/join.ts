// Join of the static scan rows (cases-static.tsv) with the JUnit cases of the unit and int runs.
import type { JunitCase } from "./junit";

export type Suite = "unit" | "int";

export interface StaticRow {
  fields: Record<string, string>;
  key: string;
  file: string;
  line: number;
  kind: string;
  describePath: string;
  name: string;
  shared: boolean;
  flags: string[];
}

export interface TimedCase extends JunitCase {
  suite: Suite;
}

export interface JoinedCase extends TimedCase {
  key: string; // the scan key it joined to, or "unscanned"
  reason: string; // "" or why a case is unscanned: "no-row" | "ambiguous"
  via: "line" | "span" | "shared" | ""; // how it joined; "span" = a multi-line call, see joinCases
}

export interface TimedRow extends StaticRow {
  junitCount: number;
  timeS: number;
  assertions: number;
  skipped: number;
  outFlags: string[];
}

export interface JoinResult {
  rows: TimedRow[];
  cases: JoinedCase[];
}

export const SLOW_UNIT_S = 1;
export const SLOW_INT_S = 2;
export const DESCRIBE_JOINER = " > ";

export function parseStaticTsv(text: string): StaticRow[] {
  const [head, ...lines] = text.split("\n").filter((line) => line !== "");
  const names = (head as string).split("\t");
  return lines.map((line) => {
    const cells = line.split("\t");
    const fields: Record<string, string> = {};
    names.forEach((name, index) => {
      fields[name] = cells[index] ?? "";
    });
    return {
      fields,
      key: fields.key as string,
      file: fields.file as string,
      line: Number(fields.line),
      kind: fields.kind as string,
      describePath: fields.describePath as string,
      name: fields.name as string,
      shared: fields.shared === "true",
      flags: (fields.flags as string) === "" ? [] : (fields.flags as string).split(","),
    };
  });
}

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The scan name as a pattern: a `${…}` part, a printf mark (`%s`, `%p`, `%j`, …) and a `$name` mark of
// `test.each` each become a wildcard. Everything else is literal.
const NAME_WILDCARD = /\$\{(?:[^{}]|\{[^{}]*\})*\}|%[sdifjopO#%]|\$[A-Za-z_][\w.]*/g;

// The scan keeps the raw text of a template name (`\`` for a backtick) and the value of a string name.
// A pattern holds both readings: the text as it stands, and the text with its backslash escapes removed.
const unescapeName = (text: string): string =>
  text.replace(/\\([\s\S])/g, (_whole, char: string) => (char === "n" ? "\n" : char === "t" ? "\t" : char));

function patternSource(name: string, literal: (text: string) => string): string {
  let source = "";
  let last = 0;
  for (const match of name.matchAll(NAME_WILDCARD)) {
    source += escapeRegex(literal(name.slice(last, match.index)));
    source += match[0] === "%%" ? "%" : "[\\s\\S]*";
    last = (match.index ?? 0) + match[0].length;
  }
  return source + escapeRegex(literal(name.slice(last)));
}

export function namePattern(name: string): RegExp {
  return new RegExp(`^(?:${patternSource(name, (text) => text)}|${patternSource(name, unescapeName)})$`);
}

// Bun prints the classname innermost describe first (`inner > outer`). A shared row matches when its
// describe path (outer first) ends the path of the case: the describes of the runner file stand before it.
function pathEndsClass(describePath: string, classname: string): boolean {
  if (describePath === "") return true;
  const wanted = namePattern(describePath);
  const parts = classname.split(DESCRIBE_JOINER).reverse();
  for (let from = 0; from < parts.length; from += 1) {
    if (wanted.test(parts.slice(from).join(DESCRIBE_JOINER))) return true;
  }
  return false;
}

export function slowLimit(suite: Suite): number {
  return suite === "unit" ? SLOW_UNIT_S : SLOW_INT_S;
}

// Bun reports the line of the first argument of the outer call. A call that spans lines (a `test.each`
// table, a name on the next line) starts earlier than that line. The row is the nearest earlier row of the
// file whose name matches, when no other row starts between its start and the reported line.
function spanRow(
  fileRows: StaticRow[],
  junit: TimedCase,
  matches: (row: StaticRow, name: string) => boolean
): StaticRow | undefined {
  const before = fileRows.filter((row) => row.line < junit.line);
  const nearest = before[before.length - 1];
  return nearest !== undefined && matches(nearest, junit.name) ? nearest : undefined;
}

export function joinCases(staticRows: StaticRow[], timed: TimedCase[]): JoinResult {
  const byPlace = new Map<string, StaticRow[]>();
  const byFile = new Map<string, StaticRow[]>();
  const sharedByLine = new Map<number, StaticRow[]>();
  for (const row of staticRows) {
    if (row.shared) {
      sharedByLine.set(row.line, [...(sharedByLine.get(row.line) ?? []), row]);
    } else {
      const place = `${row.file}:${row.line}`;
      byPlace.set(place, [...(byPlace.get(place) ?? []), row]);
      byFile.set(row.file, [...(byFile.get(row.file) ?? []), row]);
    }
  }
  for (const list of byFile.values()) list.sort((a, b) => a.line - b.line);
  const patterns = new Map<string, RegExp>();
  const matches = (row: StaticRow, name: string): boolean => {
    let pattern = patterns.get(row.key);
    if (pattern === undefined) {
      pattern = namePattern(row.name);
      patterns.set(row.key, pattern);
    }
    return pattern.test(name);
  };

  const cases: JoinedCase[] = [];
  const byKey = new Map<string, JoinedCase[]>();
  for (const junit of timed) {
    const own = (byPlace.get(`${junit.file}:${junit.line}`) ?? []).filter((row) => matches(row, junit.name));
    let key = "unscanned";
    let reason = "no-row";
    let via: JoinedCase["via"] = "";
    const span = own.length > 0 ? undefined : spanRow(byFile.get(junit.file) ?? [], junit, matches);
    if (own.length > 0) {
      key = (own[0] as StaticRow).key;
      reason = "";
      via = "line";
    } else if (span !== undefined) {
      key = span.key;
      reason = "";
      via = "span";
    } else {
      const shared = (sharedByLine.get(junit.line) ?? []).filter(
        (row) => matches(row, junit.name) && pathEndsClass(row.describePath, junit.classname)
      );
      if (shared.length === 1) {
        key = (shared[0] as StaticRow).key;
        reason = "";
        via = "shared";
      } else if (shared.length > 1) {
        reason = "ambiguous";
      }
    }
    const joined = { ...junit, key, reason, via };
    cases.push(joined);
    if (key !== "unscanned") byKey.set(key, [...(byKey.get(key) ?? []), joined]);
  }

  const rows = staticRows.map((row): TimedRow => {
    const hits = byKey.get(row.key) ?? [];
    const outFlags = [...row.flags];
    if (hits.some((hit) => hit.time >= slowLimit(hit.suite))) outFlags.push("S9");
    if (hits.length === 0 && (row.kind === "unit" || row.kind === "int")) outFlags.push("not-run");
    return {
      ...row,
      junitCount: hits.length,
      timeS: hits.reduce((sum, hit) => sum + hit.time, 0),
      assertions: hits.reduce((sum, hit) => sum + hit.assertions, 0),
      skipped: hits.filter((hit) => hit.skipped).length,
      outFlags,
    };
  });
  return { rows, cases };
}
