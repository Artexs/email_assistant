import { existsSync, readFileSync } from "node:fs";

import type { z } from "zod";

import { HardError } from "../../platform/errors";

/** Errors hold the file name, field paths and issue codes only, never field values. */
export function readJsonFile<T>(file: string, schema: z.ZodType<T>): T {
  if (!existsSync(file)) throw new HardError(`file not found: ${file}`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new HardError(`invalid JSON: ${file}`);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join(".") || "-"}: ${issue.code}`);
    throw new HardError(`invalid file ${file}\n${issues.join("\n")}`);
  }
  return result.data;
}
