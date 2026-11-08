import { existsSync, readFileSync } from "node:fs";

import { z } from "zod";

import { HardError } from "../../platform/errors";

export const remoteTargetSchema = z
  .object({
    testAddress: z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/), // the only allowed recipient (D2)
    host: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/), // an ssh config alias; no leading "-" (it would be an ssh option)
    remoteDir: z
      .string()
      .regex(/^~?\/?[A-Za-z0-9_./-]{1,120}$/)
      .refine((s) => !s.includes("..")),
    composeArgs: z.literal("-f deploy/compose.yaml --env-file .env"),
    orgId: z.uuid(),
    mailboxId: z.uuid(),
  })
  .strict();
export type RemoteTarget = z.infer<typeof remoteTargetSchema>;

/** Errors hold the file name, field paths and issue codes only, never field values. */
export function loadRemoteTarget(file: string): RemoteTarget {
  if (!existsSync(file)) throw new HardError(`file not found: ${file}`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new HardError(`invalid JSON: ${file}`);
  }
  const result = remoteTargetSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join(".") || "-"}: ${issue.code}`);
    throw new HardError(`invalid target file ${file}\n${issues.join("\n")}`);
  }
  return result.data;
}
