import { deliverFolderKeys, deliveryResults, sortFolderKeys, type CaseDelivery, type SendLogLine } from "@ea/core";
import { z } from "zod";

import { HardError } from "../../platform/errors";

import { remoteTargetSchema, type RemoteTarget } from "./target";

const BUNDLE_PATH = /^\/tmp\/ea-testmail-[0-9a-f-]{36}\.js$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SECRET_NAME = /KEY|TOKEN|PASSWORD|SECRET|HASH|PHONE|DATABASE_URL|CREDENTIALS|IMAP_USER/;

export function remoteBundlePath(runId: string): string {
  if (!UUID.test(runId)) throw new HardError("run id must be a UUID");
  return `/tmp/ea-testmail-${runId}.js`;
}

export function remoteCommand(
  target: RemoteTarget,
  command: "deliver" | "compare",
  opts: { bundlePath: string; bar?: number; minKept?: number; checkOnly?: boolean }
): string {
  const parsed = remoteTargetSchema.safeParse(target);
  if (!parsed.success) throw new HardError("invalid remote target");
  const t = parsed.data;
  const b = opts.bundlePath;
  if (!BUNDLE_PATH.test(b)) throw new HardError("invalid remote bundle path");
  if (opts.checkOnly === true && command !== "deliver") throw new HardError("--check-only is for deliver only");
  if (command === "deliver" && (opts.bar !== undefined || opts.minKept !== undefined)) {
    throw new HardError("--bar and --min-kept are for compare only");
  }
  if (opts.bar !== undefined && !(Number.isFinite(opts.bar) && opts.bar > 0 && opts.bar <= 1)) {
    throw new HardError("--bar must be a number above 0 and up to 1");
  }
  if (opts.minKept !== undefined && !(Number.isInteger(opts.minKept) && opts.minKept >= 1 && opts.minKept <= 10000)) {
    throw new HardError("--min-kept must be an integer from 1 to 10000");
  }

  let line = `cd ${t.remoteDir} && docker compose ${t.composeArgs} run --rm -T -v ${b}:${b}:ro server bun ${b} ${command} --org-id ${t.orgId} --mailbox-id ${t.mailboxId}`;
  if (opts.checkOnly === true) line += " --check-only";
  if (opts.bar !== undefined) line += ` --bar ${String(opts.bar)}`;
  if (opts.minKept !== undefined) line += ` --min-kept ${String(opts.minKept)}`;
  return `${line}; code=$?; rm -f ${b}; exit $code`;
}

/** Returns key names only, never values. */
export function findEnvValuesInBundle(bundle: string, env: Record<string, string | undefined>): string[] {
  const found: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (!SECRET_NAME.test(name) || value === undefined || value.length < 8) continue;
    if (bundle.includes(value)) found.push(name);
  }
  return found;
}

const deliverLineSchema = z.object({
  case: z.string(),
  result: z.enum(deliveryResults),
  folder: z.enum(deliverFolderKeys).nullable(),
});
type DeliverLine = z.infer<typeof deliverLineSchema>;

function isConsistent(line: DeliverLine): boolean {
  switch (line.result) {
    case "synced":
      return line.folder === "db";
    case "in_inbox":
      return line.folder === "inbox";
    case "not_found":
      return line.folder === null;
    case "moved":
    case "duplicate_removed":
      return line.folder !== null && (sortFolderKeys as readonly string[]).includes(line.folder);
  }
}

export function parseDeliverOutput(stdout: string): {
  lines: { case: string; result: CaseDelivery["result"]; folder: DeliverLine["folder"] }[];
  bad: number;
} {
  const lines: DeliverLine[] = [];
  let bad = 0;
  for (const raw of stdout.split("\n")) {
    if (!raw.startsWith("{")) continue;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      bad += 1;
      continue;
    }
    const result = deliverLineSchema.safeParse(json);
    if (result.success && isConsistent(result.data)) lines.push(result.data);
    else bad += 1;
  }
  return { lines, bad };
}

export function deliveredLogLines(
  batchId: string,
  parsed: ReturnType<typeof parseDeliverOutput>["lines"],
  now: Date
): SendLogLine[] {
  const out: SendLogLine[] = [];
  for (const line of parsed) {
    if (line.result === "not_found") continue;
    if (line.folder === null) continue;
    out.push({
      type: "delivered",
      batch: batchId,
      case: line.case,
      folder: line.folder,
      result: line.result,
      at: now.toISOString(),
    });
  }
  return out;
}
