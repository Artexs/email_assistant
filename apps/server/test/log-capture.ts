import { spyOn } from "bun:test";

import { setLogFormat, setLogLevel, type LogLevel } from "../src/platform/log";
import { logFieldNames } from "../src/platform/log-fields";

export interface CapturedLogs {
  /** Raw console lines (stdout and stderr), one string per call, in order. */
  readonly lines: readonly string[];
  /** Restores the spies, the level and the format. Call it in finally. */
  stop(): void;
}

const BASE_KEYS: ReadonlySet<string> = new Set(["time", "level", "module", "event", "msg"]);
const FIELD_KEYS: ReadonlySet<string> = new Set(logFieldNames);

/** Spies on console.log and console.error, sets LOG_FORMAT json (setLogFormat) and the level (default "debug"). */
export function captureLogs(opts: { level?: LogLevel } = {}): CapturedLogs {
  const lines: string[] = [];
  const record = (...args: unknown[]): void => {
    lines.push(args.map(String).join(" "));
  };
  const logSpy = spyOn(console, "log").mockImplementation(record);
  const errorSpy = spyOn(console, "error").mockImplementation(record);
  setLogFormat("json");
  setLogLevel(opts.level ?? "debug");
  return {
    lines,
    stop() {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      setLogFormat("text");
      setLogLevel("info");
    },
  };
}

function parseObject(line: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // not JSON
  }
  return undefined;
}

/**
 * The list of problems; empty when every line is clean. A problem text never holds a planted value:
 * it names the value by its index.
 */
export function logProblems(lines: readonly string[], planted: readonly string[]): string[] {
  const problems: string[] = [];
  lines.forEach((line, lineIndex) => {
    const where = `line ${lineIndex}`;
    planted.forEach((value, plantedIndex) => {
      if (line.includes(value)) problems.push(`${where}: holds planted value #${plantedIndex}`);
    });
    const parsed = parseObject(line);
    if (parsed === undefined) {
      problems.push(`${where}: not one JSON object`);
      return;
    }
    for (const key of Object.keys(parsed)) {
      if (key !== "dropped_fields" && !BASE_KEYS.has(key) && !FIELD_KEYS.has(key))
        problems.push(`${where}: key not allowed (${key.slice(0, 40)})`);
    }
    if (parsed.event === "log_call_invalid") problems.push(`${where}: event log_call_invalid`);
    if ("dropped_fields" in parsed) problems.push(`${where}: has dropped_fields`);
    if (parsed.msg !== parsed.event) problems.push(`${where}: msg differs from event`);
  });
  return problems;
}

/** The parsed lines whose `event` is `event`, in order. Lines that are not JSON objects are skipped (`logProblems` reports them). */
export function eventLines(lines: readonly string[], event: string): Record<string, unknown>[] {
  return lines.flatMap((line) => {
    const parsed = parseObject(line);
    return parsed !== undefined && parsed.event === event ? [parsed] : [];
  });
}
