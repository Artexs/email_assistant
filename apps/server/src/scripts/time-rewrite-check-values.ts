import { HOUR_MS, DAY_MS } from "@ea/core";

/**
 * Time values of source lines, for the value check of the time-spelling rewrite (`time-rewrite-check.ts`). The rules are in the plan of the ticket that adds the `MINUTE_MS` rule.
 * Pure: no git, no file, no clock. The tool writes no minute literal: the minute is derived from the core hour.
 */

const minuteMs = HOUR_MS / 60;

/** Unit names a rewrite may write or remove, with their value in milliseconds. */
const unitValues = new Map<string, number>([
  ["MINUTE_MS", minuteMs],
  ["MINUTE", minuteMs],
  ["MIN_MS", minuteMs],
  ["HOUR_MS", HOUR_MS],
  ["HOUR", HOUR_MS],
  ["DAY_MS", DAY_MS],
  ["DAY", DAY_MS],
]);

type Token =
  | { kind: "num"; value: number; integer: boolean }
  | { kind: "unit"; value: number; name: string }
  | { kind: "op"; op: "*" | "/" }
  | { kind: "open" }
  | { kind: "close" }
  | { kind: "other" };

const numberPattern = /^(?:\d[\d_]*(?:\.\d[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?/;
const identifierPattern = /^[A-Za-z_$][\w$]*/;

/** The line without comments and without the content of quoted strings (a string becomes one `""` placeholder). */
function stripText(line: string): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const ch = line[i] ?? "";
    const next = line[i + 1];
    if (ch === "/" && next === "/") {
      break;
    }
    if (ch === "/" && next === "*") {
      const end = line.indexOf("*/", i + 2);
      if (end === -1) {
        break;
      }
      out += " ";
      i = end + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < line.length && line[j] !== ch) {
        j += line[j] === "\\" ? 2 : 1;
      }
      out += '""';
      i = j + 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let rest = text;
  while (rest.length > 0) {
    const ch = rest[0] ?? "";
    if (/\s/.test(ch)) {
      rest = rest.slice(1);
      continue;
    }
    const num = numberPattern.exec(rest);
    if (num !== null) {
      const text = num[0];
      const after = rest.slice(text.length);
      const glued = /^[\w$]+/.exec(after);
      if (glued !== null) {
        // `60n`, `0x1F`: not a plain decimal number.
        tokens.push({ kind: "other" });
        rest = after.slice(glued[0].length);
        continue;
      }
      const value = Number(text.replaceAll("_", ""));
      tokens.push({ kind: "num", value, integer: Number.isSafeInteger(value) && /^[\d_]+$/.test(text) });
      rest = after;
      continue;
    }
    const id = identifierPattern.exec(rest);
    if (id !== null) {
      const unit = unitValues.get(id[0]);
      tokens.push(unit === undefined ? { kind: "other" } : { kind: "unit", value: unit, name: id[0] });
      rest = rest.slice(id[0].length);
      continue;
    }
    if (ch === "*" || ch === "/") {
      tokens.push({ kind: "op", op: ch });
    } else if (ch === "(") {
      tokens.push({ kind: "open" });
    } else if (ch === ")") {
      tokens.push({ kind: "close" });
    } else {
      tokens.push({ kind: "other" });
    }
    rest = rest.slice(1);
  }
  return tokens;
}

/** Maximal runs of number, unit, `*`, `/` and parenthesis tokens. Any other token, such as an identifier, ends a run. */
function runsOf(tokens: Token[]): Token[][] {
  const runs: Token[][] = [];
  let current: Token[] = [];
  for (const token of tokens) {
    if (token.kind === "other") {
      runs.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }
  runs.push(current);
  return runs.map(trimRun).filter((run) => run.length > 0);
}

/** Drops parentheses without a partner and operators at the start or end of the run. */
function trimRun(run: Token[]): Token[] {
  const keep = run.map(() => true);
  const open: number[] = [];
  run.forEach((token, index) => {
    if (token.kind === "open") {
      open.push(index);
    } else if (token.kind === "close") {
      if (open.pop() === undefined) {
        keep[index] = false;
      }
    }
  });
  for (const index of open) {
    keep[index] = false;
  }
  const kept = run.filter((_, index) => keep[index]);
  let start = 0;
  let end = kept.length;
  while (start < end && kept[start]?.kind === "op") {
    start += 1;
  }
  while (end > start && kept[end - 1]?.kind === "op") {
    end -= 1;
  }
  return kept.slice(start, end);
}

/** The value of a run: `*` and `/` left to right, parentheses first. `null` when the run is not well formed. */
function evaluate(run: Token[]): number | null {
  let pos = 0;
  const factor = (): number | null => {
    const token = run[pos];
    if (token === undefined) {
      return null;
    }
    pos += 1;
    if (token.kind === "num" || token.kind === "unit") {
      return token.value;
    }
    if (token.kind === "open") {
      const inner = product();
      if (inner === null || run[pos]?.kind !== "close") {
        return null;
      }
      pos += 1;
      return inner;
    }
    return null;
  };
  const product = (): number | null => {
    let value = factor();
    while (value !== null && run[pos]?.kind === "op") {
      const token = run[pos];
      pos += 1;
      const right = factor();
      if (right === null) {
        return null;
      }
      value = token?.kind === "op" && token.op === "/" ? value / right : value * right;
    }
    return value;
  };
  const value = product();
  return value !== null && pos === run.length ? value : null;
}

/** The same product without the grouping, for a run the parser cannot read. */
function flatValue(run: Token[]): number {
  let value = 1;
  let divide = false;
  for (const token of run) {
    if (token.kind === "op") {
      divide = token.op === "/";
    } else if (token.kind === "num" || token.kind === "unit") {
      value = divide ? value / token.value : value * token.value;
      divide = false;
    }
  }
  return value;
}

const timeLiterals = new Set([minuteMs, HOUR_MS, DAY_MS]);
const minuteBig = BigInt(minuteMs);

/** A run counts as a time value when it holds a unit name, or is a time chain of that plan: a time literal, a multiple of one minute, or both 60 and 1000. */
function countsAsTime(run: Token[]): boolean {
  const nums = run.flatMap((token) => (token.kind === "num" ? [token] : []));
  if (run.some((token) => token.kind === "unit") || nums.some((token) => timeLiterals.has(token.value))) {
    return true;
  }
  if (run.some((token) => token.kind === "op" && token.op === "/")) {
    return false;
  }
  const integers = nums.filter((token) => token.integer).map((token) => BigInt(token.value));
  if (integers.includes(60n) && integers.includes(1000n)) {
    return true;
  }
  const product = integers.reduce((acc, value) => acc * value, 1n);
  return integers.length > 0 && product !== 0n && product % minuteBig === 0n;
}

function round(value: number): number {
  return Number(value.toPrecision(12));
}

/** `const MINUTE = 60_000;` and the like: the declared unit name and the value of the whole initializer, when it is plain arithmetic. */
function declaredUnit(text: string): { name: string; value: number | null } | null {
  const match =
    /^\s*(?:export\s+)?(?:declare\s+)?(?:(?:const|let|var)\s+|(?:(?:public|private|protected|static|readonly)\s+)*)([A-Z_]+)\s*(?::[^=]+)?=\s*(.*?);?\s*$/.exec(
      text
    );
  const name = match?.[1];
  if (name === undefined || !unitValues.has(name)) {
    return null;
  }
  const initializer = (match?.[2] ?? "").replace(/\s+(?:as|satisfies)\s+\w+\s*$/, "");
  const tokens = tokenize(initializer);
  const value = tokens.some((token) => token.kind === "other") ? null : evaluate(tokens);
  return { name, value: value === null ? null : round(value) };
}

/** The time values of one source line, in order of appearance. Comments and string contents are not read. */
export function timeValuesOf(line: string): number[] {
  const text = stripText(line);
  const declared = declaredUnit(text);
  if (declared?.value !== undefined && declared.value !== null) {
    // A copy of a core name with the core value is the removal the rewrite wants; any other value is a time value.
    return declared.value === unitValues.get(declared.name) ? [] : [declared.value];
  }
  return runsOf(tokenize(text))
    .filter(countsAsTime)
    .map((run) => round(evaluate(run) ?? flatValue(run)));
}

/** A line that starts a block comment or continues one (a leading `*`) holds prose, not code. */
function isCommentLine(line: string): boolean {
  return /^\s*(?:\/\*|\*(?:\s|$|\/))/.test(line);
}

function sortedValues(lines: string[]): number[] {
  return lines
    .filter((line) => !isCommentLine(line))
    .flatMap(timeValuesOf)
    .sort((a, b) => a - b);
}

/** `null` when the removed and the added lines of a hunk hold the same time values; else both sorted lists. */
export function compareHunk(removed: string[], added: string[]): { removed: number[]; added: number[] } | null {
  const before = sortedValues(removed);
  const after = sortedValues(added);
  const same = before.length === after.length && before.every((value, index) => value === after[index]);
  return same ? null : { removed: before, added: after };
}

/** The 1-based numbers of the lines inside import and re-export statements. A rewrite adds and shuffles these; they hold names, not values. */
export function importLines(source: string): Set<number> {
  const lines = new Set<number>();
  const pattern =
    /^(?:import\s[^;]*?|export\s+(?:type\s+)?(?:\*|\{)[^;]*?)\bfrom\s*(["'])[^"'\n]*\1|^import\s*(["'])[^"'\n]*\2/gm;
  for (const match of source.matchAll(pattern)) {
    const first = source.slice(0, match.index).split("\n").length;
    const last = first + match[0].split("\n").length - 1;
    for (let line = first; line <= last; line += 1) {
      lines.add(line);
    }
  }
  return lines;
}
