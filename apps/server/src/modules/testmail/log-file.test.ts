import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { formatSendLogLine, type SendLogLine } from "@ea/core";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { appendSendLogLine, readAllSendLogs, readSendLog } from "./log-file";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "testmail-log-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function intent(caseId: string): SendLogLine {
  return {
    type: "intent",
    batch: "2026-01-01-x",
    case: caseId,
    attempt: 1,
    key: `ea-2026-01-01-x-${caseId}-a1`,
    hash: "a".repeat(64),
    at: "2026-01-01T10:00:00.000Z",
  };
}

describe("log file", () => {
  test("append cuts a partial last line", () => {
    const file = join(dir, "b.jsonl");
    const first = formatSendLogLine(intent("a"));
    writeFileSync(file, `${first}{"type":"int`);
    appendSendLogLine(file, intent("b"));
    expect(readFileSync(file, "utf8")).toBe(`${first}${formatSendLogLine(intent("b"))}`);
    const result = readSendLog(file);
    expect(result.badLines).toEqual([]);
    expect(result.lines.map((l) => l.case)).toEqual(["a", "b"]);
  });

  test("append creates the folder and the file", () => {
    const file = join(dir, "runs", "b.jsonl");
    appendSendLogLine(file, intent("a"));
    expect(readSendLog(file).lines).toHaveLength(1);
  });

  test("a partial line with no newline at all is cut to empty", () => {
    const file = join(dir, "b.jsonl");
    writeFileSync(file, `{"type":"int`);
    appendSendLogLine(file, intent("a"));
    expect(readFileSync(file, "utf8")).toBe(formatSendLogLine(intent("a")));
  });

  test("a missing file gives an empty result", () => {
    expect(readSendLog(join(dir, "none.jsonl"))).toEqual({ lines: [], badLines: [], partialLast: false });
  });

  test("readAllSendLogs joins files and names bad files", () => {
    writeFileSync(join(dir, "a.jsonl"), formatSendLogLine(intent("a")));
    writeFileSync(join(dir, "b.jsonl"), `garbage\n${formatSendLogLine(intent("b"))}`);
    writeFileSync(join(dir, "note.txt"), "ignored");
    const result = readAllSendLogs(dir);
    expect(result.lines.map((l) => l.case)).toEqual(["a", "b"]);
    expect(result.badFiles).toEqual(["b.jsonl"]);
    expect(readAllSendLogs(join(dir, "missing"))).toEqual({ lines: [], badFiles: [] });
  });
});
