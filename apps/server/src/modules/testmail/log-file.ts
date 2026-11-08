import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  truncateSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { formatSendLogLine, parseSendLog, type SendLogLine } from "@ea/core";

import { HardError } from "../../platform/errors";

function cutPartialLastLine(path: string): void {
  if (!existsSync(path)) return;
  const buffer = readFileSync(path);
  if (buffer.length === 0 || buffer[buffer.length - 1] === 0x0a) return;
  truncateSync(path, buffer.lastIndexOf(0x0a) + 1);
}

export function appendSendLogLine(path: string, line: SendLogLine): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  cutPartialLastLine(path);
  const fd = openSync(path, "a", 0o600);
  try {
    const bytes = Buffer.from(formatSendLogLine(line));
    if (writeSync(fd, bytes) !== bytes.length) throw new HardError("send log write was cut");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function readSendLog(path: string): ReturnType<typeof parseSendLog> {
  if (!existsSync(path)) return { lines: [], badLines: [], partialLast: false };
  return parseSendLog(readFileSync(path, "utf8"));
}

export function readAllSendLogs(dir: string): { lines: SendLogLine[]; badFiles: string[] } {
  if (!existsSync(dir)) return { lines: [], badFiles: [] };
  const lines: SendLogLine[] = [];
  const badFiles: string[] = [];
  for (const name of readdirSync(dir)
    .filter((file) => file.endsWith(".jsonl"))
    .sort()) {
    const result = readSendLog(join(dir, name));
    lines.push(...result.lines);
    if (result.badLines.length > 0) badFiles.push(name);
  }
  return { lines, badFiles };
}
