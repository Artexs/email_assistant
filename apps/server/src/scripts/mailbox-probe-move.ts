import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import { z } from "zod";

import { assertTestAddress, probeMove, type ProbeMoveReport } from "../modules/mail";
import { createLog } from "../platform/log";

const log = createLog("mailbox-probe-move");

const usage = [
  "usage: printf '%s' \"$PASSWORD\" | TEST_MAILBOX_ADDRESS=<address> bun run mailbox:probe-move --host <imap host> --port <port> --address <address>",
  "  It changes the mailbox: it adds one synthetic mail and creates the folder AI/Probe-… (and the parent AI, if missing).",
  "  If the server refuses nested folders, it creates a flat folder AI-Probe-… instead. It removes all of them at the end.",
  "  It refuses unless TEST_MAILBOX_ADDRESS equals --address. The password comes only from stdin.",
].join("\n");

function readOptions() {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: { host: { type: "string" }, port: { type: "string" }, address: { type: "string" } },
      strict: true,
    });
    const port = z.coerce.number().int().min(1).max(65_535).safeParse(values.port);
    if (values.host === undefined || values.address === undefined || !port.success) return undefined;
    return { host: values.host, port: port.data, address: values.address };
  } catch {
    return undefined;
  }
}

// A terminal would show the typed password, so stdin must be a pipe.
async function readPassword(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined;
  const text = await Bun.stdin.text();
  const password = text.replace(/\r?\n$/, "");
  return password === "" ? undefined : password;
}

function flatten(prefix: string, value: unknown): string[] {
  if (Array.isArray(value)) return [`${prefix}: ${value.length === 0 ? "-" : value.join(" | ")}`];
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, inner]) => flatten(`${prefix}.${key}`, inner));
  }
  return [`${prefix}: ${String(value)}`];
}

function reportLines(report: ProbeMoveReport): string[] {
  return Object.entries(report).flatMap(([key, value]) => flatten(key, value));
}

async function main(): Promise<number> {
  const options = readOptions();
  const password = options && (await readPassword());
  if (!options || password === undefined) {
    log.error(usage);
    return 1;
  }
  // Read here, not through loadConfig: the probe needs no DB and no other key.
  assertTestAddress(options.address, process.env.TEST_MAILBOX_ADDRESS);
  const report = await probeMove(
    { host: options.host, port: options.port, user: options.address, password },
    { probeId: randomUUID(), now: new Date(), log: (line) => log.info(line) }
  );
  for (const line of reportLines(report)) log.info(line);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    log.error("failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
